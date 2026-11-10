import io
import json

from lightkone.library import Library
from lightkone.mcp import Server, find_in_text, result_path
from lightkone.storage import FolderStorage


def text_of(pages):
    return "\n\f\n".join(f"[page {i + 1}]\n{t}" for i, t in enumerate(pages))


def seeded(tmp_path):
    s = FolderStorage(tmp_path)
    lib = Library(s).load()
    lib.merge(
        [
            {"title": "Attention Is All You Need", "authors": ["Vaswani, Ashish"], "year": 2017, "arxiv": "1706.03762", "tags": ["transformers"]},
            {"title": "Deep Residual Learning", "authors": ["He, Kaiming"], "year": 2016, "tags": ["vision"]},
        ]
    )
    lib.save()
    att = lib.get("1706.03762")
    res = next(p for p in lib.papers if p is not att)
    s.write(f"lightkone/text/{att['id']}.txt", text_of(["Page one text", "Page two text", "Page three"]).encode())
    s.write(
        f"lightkone/annotations/{att['id']}.json",
        json.dumps({"format": "lightkone-annotations", "version": 1, "paper": att["id"], "highlights": [{"id": "h", "page": 2, "rects": [], "text": "scaled dot-product", "note": "key idea"}]}).encode(),
    )
    return s, att, res


def call(srv, name, **args):
    r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})
    return r["result"]


def text(r):
    return r["content"][0]["text"]


def test_handshake_and_lists(tmp_path):
    srv = Server(Library(FolderStorage(tmp_path)))
    init = srv.handle({"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})
    assert init["result"]["protocolVersion"] == "2025-06-18"
    assert set(init["result"]["capabilities"]) == {"tools", "prompts"}
    tools = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"]
    assert [t["name"] for t in tools] == [
        "search_papers", "get_paper", "read_paper", "list_tags", "search_full_text", "get_citations",
        "find_missing_papers", "list_branches", "export_bibtex", "add_paper", "tag_papers", "add_note",
    ]
    assert srv.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    assert srv.handle({"jsonrpc": "2.0", "id": 2, "method": "nope"})["error"]["code"] == -32601
    prompts = srv.handle({"jsonrpc": "2.0", "id": 3, "method": "prompts/list"})["result"]["prompts"]
    assert [p["name"] for p in prompts] == ["find_in_library", "cite_draft", "reading_gaps", "explain_paper"]
    got = srv.handle({"jsonrpc": "2.0", "id": 4, "method": "prompts/get", "params": {"name": "cite_draft", "arguments": {"text": "Attention helps."}}})
    assert "Attention helps." in got["result"]["messages"][0]["content"]["text"]
    assert "\\cite{key}" in got["result"]["messages"][0]["content"]["text"]
    assert srv.handle({"jsonrpc": "2.0", "id": 5, "method": "prompts/get", "params": {"name": "cite_draft"}})["error"]["code"] == -32602


def test_reads(tmp_path):
    s, att, _ = seeded(tmp_path)
    srv = Server(Library(s))
    found = json.loads(text(call(srv, "search_papers", query="tag:transformers")))
    assert found["total"] == 1 and found["papers"][0]["id"] == att["id"]
    paper = json.loads(text(call(srv, "get_paper", paper="arXiv:1706.03762")))
    assert paper["highlights"] == [{"page": 2, "text": "scaled dot-product", "note": "key idea"}]
    assert paper["full_text_available"] is True
    assert paper["bibtex"].startswith("@")
    page = text(call(srv, "read_paper", paper=att["key"], from_page=2, to_page=2))
    assert "(3 pages)" in page and "Page two text" in page and "Page one text" not in page
    assert call(srv, "read_paper", paper="missing")["isError"] is True
    tags = json.loads(text(call(srv, "list_tags")))
    assert tags["tags"] == {"transformers": 1, "vision": 1}


def test_full_text(tmp_path):
    s, att, _ = seeded(tmp_path)
    srv = Server(Library(s))
    hit = json.loads(text(call(srv, "search_full_text", words="TWO text")))
    assert hit["papers"][0]["id"] == att["id"] and hit["papers"][0]["page"] == 2
    assert "Page two text" in hit["papers"][0]["snippet"]
    assert json.loads(text(call(srv, "search_full_text", words="page", within="tag:vision")))["papers"] == []
    assert call(srv, "search_full_text", words=" ")["isError"] is True


def test_find_in_text_matches_app():
    t = text_of(["alpha beta", "gamma " * 40 + "delta epsilon"])
    hit = find_in_text(t, ["delta"])
    assert hit["page"] == 2 and hit["snippet"].startswith("…") and "delta epsilon" in hit["snippet"]
    assert find_in_text(t, ["alpha", "zeta"]) is None


def test_citations_and_missing(tmp_path):
    s, att, res = seeded(tmp_path)
    asked = []

    def openalex(ids):
        asked.append(ids)
        return {"W9": {"title": "Layer Normalization", "authors": ["Ba, Jimmy"], "year": 2016, "arxiv": "1607.06450"}}

    srv = Server(Library(s), openalex=openalex)
    assert "map" in text(call(srv, "get_citations", paper=att["key"]))
    at = "2026-11-01T00:00:00Z"
    s.write(
        "lightkone/citations.json",
        json.dumps({"format": "lightkone-citations", "version": 1, "works": {att["id"]: {"oa": "W1", "refs": ["W2", "W9"], "at": at}, res["id"]: {"oa": "W2", "refs": ["W9"], "at": at}}}).encode(),
    )
    c = json.loads(text(call(srv, "get_citations", paper=att["key"])))
    assert [p["id"] for p in c["cites"]] == [res["id"]] and c["cited_by"] == []
    m = json.loads(text(call(srv, "find_missing_papers")))
    assert asked == [["W9"]]
    assert m["missing"][0]["title"] == "Layer Normalization"
    assert sorted(m["missing"][0]["cited_by_library"]) == sorted([att["key"], res["key"]])


def test_branches(tmp_path):
    s, _, _ = seeded(tmp_path)
    srv = Server(Library(s))
    assert "No Branches" in text(call(srv, "list_branches"))
    s.write("lightkone/branches.json", json.dumps({"format": "lightkone-branches", "version": 1, "items": [{"id": "b1", "name": "Whole library", "scope": "library", "roots": [], "seen": [], "made": "2026-11-01"}]}).encode())
    assert "Not opened" in json.loads(text(call(srv, "list_branches")))[0]["candidates"]
    s.write(
        result_path("library", []),
        json.dumps({"format": "lightkone-branch-result", "version": 1, "at": "2026-11-02", "scope": "library", "roots": [], "library": True,
                    "candidates": [{"oa": "W5", "draft": {"title": "Layer Normalization", "authors": ["Ba, Jimmy"]}, "year": 2016, "cited": 9000, "refs": [], "citesRoots": ["W1"], "citedByRoots": [], "shared": 3, "libraryLinks": [], "score": 1}]}).encode(),
    )
    [b] = json.loads(text(call(srv, "list_branches", branch="whole")))
    assert b["grows_from"] == "the whole library" and b["results_from"] == "2026-11-02"
    assert b["candidates"][0] == {"title": "Layer Normalization", "authors": ["Ba, Jimmy"], "year": 2016, "cited_by_count": 9000, "cites_roots": 1, "shared_references": 3}
    assert call(srv, "list_branches", branch="nope")["isError"] is True


def test_bibtex_and_writes(tmp_path):
    s, att, _ = seeded(tmp_path)
    srv = Server(Library(s), resolve=lambda i: {"title": "Fast dropout training", "authors": ["Wang, Sida"], "year": 2013, "doi": "10.1234/x"})
    assert text(call(srv, "export_bibtex", query="")).count("\n@") + 1 == 2
    assert "Deep Residual" in text(call(srv, "export_bibtex", query="tag:vision"))
    assert call(srv, "export_bibtex")["isError"] is True
    assert text(call(srv, "add_paper", identifier="10.1234/x", tags=["dropout"])).startswith("Added")
    assert text(call(srv, "add_paper", identifier="10.1234/x")).startswith("Already")
    key = Library(s).load().get("10.1234/x")["key"]
    call(srv, "tag_papers", papers=[key], add=["regularization"], remove=["dropout"], add_folders=["ML/Reg"])
    call(srv, "add_note", paper=key, text="Compare with Wager 2013.")
    p = Library(s).load().get(key)
    assert p["tags"] == ["regularization"] and p["folders"] == ["ML/Reg"] and p["notes"] == "Compare with Wager 2013."


def test_picks_up_changes_made_elsewhere(tmp_path):
    s, _, _ = seeded(tmp_path)
    srv = Server(Library(s).load())
    other = Library(s).load()
    other.merge([{"title": "A paper added in the app", "authors": ["X, Y"], "year": 2020}])
    other.save()
    assert json.loads(text(call(srv, "search_papers", query="added in the app")))["total"] == 1


def test_stdio(tmp_path):
    s, _, _ = seeded(tmp_path)
    inp = io.StringIO(
        '{"jsonrpc":"2.0","id":1,"method":"ping"}\n\n'
        '{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
        "{nope\n"
        '[{"jsonrpc":"2.0","id":2,"method":"ping"},{"jsonrpc":"2.0","id":3,"method":"ping"}]\n'
    )
    out = io.StringIO()
    Server(Library(s)).serve(inp, out)
    lines = [json.loads(x) for x in out.getvalue().splitlines()]
    assert lines[0] == {"jsonrpc": "2.0", "id": 1, "result": {}}
    assert lines[1]["error"]["code"] == -32700
    assert [r["id"] for r in lines[2]] == [2, 3]
