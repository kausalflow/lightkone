"""Lightkone as a local MCP server: ``lightkone mcp``.

Claude Code, Claude desktop or any MCP client starts it as a subprocess and
talks JSON-RPC over standard input and output (one message per line). It
works on the same files as the web app and the rest of the CLI, in whatever
storage the chosen library lives (a folder, S3/R2 or a GitHub repository),
and offers the same tools and prompts as the site's ``/mcp`` address.

Nothing but the replies is written to standard output; messages for people
go to standard error.
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any, Callable, IO, Optional

from lightkone import __version__
from lightkone.bibtex import paper_to_bibtex
from lightkone.library import Library, Paper, clean_folder

PROTOCOL = "2025-06-18"
TEXT_DIR = "lightkone/text/"
CITATIONS_PATH = "lightkone/citations.json"
BRANCHES_PATH = "lightkone/branches.json"
RESULTS_DIR = "lightkone/branches/"


def text_path(paper_id: str) -> str:
    return f"{TEXT_DIR}{paper_id}.txt"


def annotations_path(paper_id: str) -> str:
    return f"lightkone/annotations/{paper_id}.json"


class ToolError(Exception):
    """A plain message for the AI app, shown as a tool error."""


# --- helpers shared with the web app's formats ---


def brief(p: Paper) -> dict:
    authors = p.get("authors") or []
    out = {
        "id": p.get("id"),
        "key": p.get("key"),
        "title": p.get("title"),
        "authors": [*authors[:3], "et al."] if len(authors) > 4 else authors,
        "year": p.get("year"),
        "venue": p.get("venue"),
        "tags": p.get("tags") or [],
        "folders": p.get("folders") or None,
        "starred": p.get("starred") or None,
        "arxiv": p.get("arxiv"),
        "doi": p.get("doi"),
        "pdf": bool(p.get("pdf")),
    }
    return {k: v for k, v in out.items() if v is not None}


def find_in_text(text: str, words: list) -> Optional[dict]:
    """The page of the first word and a snippet around it; None unless every word occurs (as the app's findInText)."""
    if not words:
        return None
    lower = text.lower()
    first = -1
    for w in words:
        at = lower.find(w)
        if at < 0:
            return None
        if first < 0:
            first = at
    page = text.count("\f", 0, first) + 1
    page_start = text.rfind("\n\f\n", 0, first)
    begin = 0 if page_start < 0 else page_start + 3
    start = max(begin, first - 80)
    cut = start > begin and start > 0
    if cut:
        sp = text.find(" ", start)
        start = min(first, sp + 1 if sp >= 0 else start)
    raw = re.sub(r"^\[page \d+\]\s*", "", text[start : first + 140])
    raw = re.sub(r"\s+", " ", raw).strip()
    return {
        "page": page,
        "snippet": f"{'…' if cut else ''}{raw}{'…' if first + 140 < len(text) else ''}",
    }


def pages_of(text: str, start: int = 1, end: Optional[int] = None) -> tuple:
    pages = text.split("\n\f\n")
    return "\n\n".join(pages[max(0, start - 1) : end]), len(pages)


def _fnv(s: str) -> str:
    """The app's short hash (FNV-1a over UTF-16 code units, base 36)."""
    h = 2166136261
    data = s.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h = ((h ^ (data[i] | data[i + 1] << 8)) * 16777619) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        h, r = divmod(h, 36)
        out = digits[r] + out
        if not h:
            return out


def result_path(scope: str, roots: list) -> str:
    """Where the app keeps a branch's last result (explore.ts resultPath)."""
    if scope == "library":
        return f"{RESULTS_DIR}library.json"
    if scope.startswith("folder:"):
        name = re.sub(r"[^a-z0-9]+", "-", scope[7:].lower()).strip("-")
        return f"{RESULTS_DIR}folder-{name}-{_fnv(scope)}.json"
    return f"{RESULTS_DIR}roots-{_fnv('|'.join(sorted(r['oa'] for r in roots)))}.json"


def _json_file(lib: Library, path: str, fmt: str) -> Optional[dict]:
    raw = lib.storage.read(path)
    if raw is None:
        return None
    try:
        data = json.loads(raw.decode("utf-8"))
    except ValueError:
        return None
    return data if isinstance(data, dict) and data.get("format") == fmt else None


def _dump(x: Any) -> str:
    return json.dumps(x, indent=1, ensure_ascii=False)


# --- the tools ---


class Server:
    """The tools and prompts, over one library. ``resolve`` and ``openalex`` are swappable for tests."""

    def __init__(
        self,
        library: Library,
        resolve: Optional[Callable[[str], Optional[dict]]] = None,
        openalex: Optional[Callable[[list], dict]] = None,
        text_scan: int = 2000,
    ):
        self.lib = library
        self._resolve = resolve
        self._openalex = openalex
        self.text_scan = text_scan

    # Each call reads the library again, so changes made in the app show up.
    def _fresh(self) -> Library:
        self.lib.load()
        return self.lib

    def _find(self, ref: Any) -> Paper:
        r = str(ref or "").strip()
        p = self.lib.get(re.sub(r"^arxiv:", "", r, flags=re.I)) if r else None
        if not p:
            raise ToolError(f'No paper "{r}" in the library. Use search_papers to find its id or citation key.')
        return p

    def search_papers(self, a: dict) -> str:
        found = self.lib.search(str(a.get("query") or ""))
        limit = min(100, int(a.get("limit") or 20))
        return _dump({"total": len(found), "papers": [brief(p) for p in found[:limit]]})

    def get_paper(self, a: dict) -> str:
        p = self._find(a.get("paper"))
        f = _json_file(self.lib, annotations_path(p["id"]), "lightkone-annotations")
        hl = [
            {"page": h.get("page"), "text": h.get("text"), "note": h.get("note")}
            for h in (f or {}).get("highlights") or []
            if (f or {}).get("paper") == p["id"]
        ]
        rec = {k: v for k, v in p.items() if k != "fields"}
        rec.update(
            highlights=hl,
            full_text_available=self.lib.storage.read(text_path(p["id"])) is not None,
            bibtex=paper_to_bibtex(p),
        )
        return _dump(rec)

    def read_paper(self, a: dict) -> str:
        p = self._find(a.get("paper"))
        raw = self.lib.storage.read(text_path(p["id"]))
        if raw is None:
            where = (
                f" Its arXiv page is https://arxiv.org/abs/{p['arxiv']}."
                if p.get("arxiv")
                else f" Its DOI is {p['doi']}." if p.get("doi") else ""
            )
            if p.get("pdf"):
                return f'The text of "{p.get("title")}" has not been extracted yet: open the paper once in Lightkone\'s reader.{where}'
            return f'"{p.get("title")}" has no PDF in the library.{where} The abstract: {p.get("abstract") or "(none)"}'
        end = a.get("to_page")
        text, n = pages_of(raw.decode("utf-8", errors="replace"), int(a.get("from_page") or 1), int(end) if end else None)
        return f'"{p.get("title")}" ({n} pages)\n\n{text}'

    def list_tags(self, a: dict) -> str:
        return _dump({"tags": dict(self.lib.tag_counts()), "folders": dict(self.lib.folder_counts())})

    def search_full_text(self, a: dict) -> str:
        words = str(a.get("words") or "").lower().split()
        if not words:
            raise ToolError("Give some words to look for.")
        limit = min(50, int(a.get("limit") or 20))
        stored = {k[len(TEXT_DIR) : -4] for k in self.lib.storage.list(TEXT_DIR) if k.endswith(".txt")}
        pool = [p for p in self.lib.search(str(a.get("within") or "")) if p.get("id") in stored]
        scan = pool[: self.text_scan]
        hits = []
        for p in scan:
            raw = self.lib.storage.read(text_path(p["id"]))
            hit = raw is not None and find_in_text(raw.decode("utf-8", errors="replace"), words)
            if hit:
                hits.append({**brief(p), **hit})
                if len(hits) >= limit:
                    break
        note = (
            f"Searched the {len(scan)} most recently added of {len(pool)} papers with text; narrow it with `within` to search the rest."
            if len(pool) > len(scan)
            else f"Searched {len(scan)} papers with text."
        )
        return _dump({"note": note, "papers": hits})

    def _graph(self):
        from lightkone.citations import build_graph, load_citations

        store = load_citations(self.lib)
        return store, build_graph(self.lib.papers, store)

    def get_citations(self, a: dict) -> str:
        p = self._find(a.get("paper"))
        store, g = self._graph()
        if p["id"] not in store["works"]:
            return f'No references for "{p.get("title")}" yet: run `lightkone map` or open the citation map in Lightkone once.'
        n = g.nodes[p["id"]]
        out = {
            "paper": brief(p),
            "cited_by_count": n.cited or None,
            "cites": [brief(g.nodes[i].paper) for i in n.cites],
            "cited_by": [brief(g.nodes[i].paper) for i in n.cited_by],
        }
        return _dump({k: v for k, v in out.items() if v is not None})

    def find_missing_papers(self, a: dict) -> str:
        _, g = self._graph()
        if not g.known:
            return "The citation map is empty: run `lightkone map` or open the map in Lightkone once."
        top = g.missing[: min(50, int(a.get("limit") or 15))]
        works = self._works([oa for oa, _ in top]) if top else {}
        key_of = lambda i: g.nodes[i].paper.get("key", i) if i in g.nodes else i  # noqa: E731
        missing = []
        for oa, by in top:
            w = works.get(oa) or {}
            row = {
                "openalex": oa,
                "title": w.get("title"),
                "authors": (w.get("authors") or [])[:3] or None,
                "year": w.get("year"),
                "doi": w.get("doi"),
                "arxiv": w.get("arxiv"),
                "cited_by_library": [key_of(i) for i in by],
            }
            missing.append({k: v for k, v in row.items() if v is not None})
        return _dump({"papers_with_references": g.known, "missing": missing})

    def _works(self, ids: list) -> dict:
        if self._openalex:
            return self._openalex(ids)
        from lightkone.citations import OpenAlex, works_by_id

        return works_by_id(ids, OpenAlex())

    def list_branches(self, a: dict) -> str:
        store = _json_file(self.lib, BRANCHES_PATH, "lightkone-branches")
        items = (store or {}).get("items") or []
        if not items:
            return "No Branches kept yet. They are made in Lightkone's citation map, under Branches."
        want = str(a.get("branch") or "").strip().lower()
        chosen = [b for b in items if b.get("id") == want or want in b.get("name", "").lower()] if want else items
        if not chosen:
            raise ToolError(f'No branch "{a.get("branch")}". Kept: {"; ".join(b.get("name", "") for b in items)}')
        limit = min(50, int(a.get("limit") or (20 if want else 5)))
        by_id = {p.get("id"): p for p in self.lib.papers}
        out = []
        for b in chosen:
            scope = b.get("scope") or ""
            r = _json_file(self.lib, result_path(scope, b.get("roots") or []), "lightkone-branch-result")
            if r:
                cands = []
                for c in (r.get("candidates") or [])[:limit]:
                    d = c.get("draft") or {}
                    own = by_id.get(c.get("paperId"))
                    row = {
                        "title": d.get("title"),
                        "authors": (d.get("authors") or [])[:3],
                        "year": c.get("year") or None,
                        "doi": d.get("doi"),
                        "arxiv": d.get("arxiv"),
                        "cited_by_count": c.get("cited"),
                        "in_library": own.get("key") if own else None,
                        "cites_roots": len(c.get("citesRoots") or []) or None,
                        "cited_by_roots": len(c.get("citedByRoots") or []) or None,
                        "shared_references": c.get("shared") or None,
                    }
                    cands.append({k: v for k, v in row.items() if v is not None})
            else:
                cands = "Not opened yet: open this branch in Lightkone once to read its neighbourhood."
            grows = (
                "the whole library"
                if scope == "library"
                else f"folder {scope[7:]}" if scope.startswith("folder:") else [x.get("title") for x in b.get("roots") or []]
            )
            row = {"id": b.get("id"), "name": b.get("name"), "grows_from": grows, "results_from": (r or {}).get("at"), "candidates": cands}
            out.append({k: v for k, v in row.items() if v is not None})
        return _dump(out)

    def export_bibtex(self, a: dict) -> str:
        refs = a.get("papers") or []
        if refs:
            chosen = [self._find(r) for r in refs]
        elif a.get("query") is not None:
            chosen = self.lib.search(str(a["query"]))[:500]
        else:
            raise ToolError("Give `papers` or a `query`.")
        if not chosen:
            raise ToolError("No papers matched.")
        return "\n".join(paper_to_bibtex(p) for p in chosen)

    def add_paper(self, a: dict) -> str:
        ident = str(a.get("identifier") or "")
        if self._resolve:
            d = self._resolve(ident)
        else:
            from lightkone.lookup import resolve

            d = resolve(ident)
        if not d:
            raise ToolError(f'Could not find a paper for "{ident}". Give a DOI or an arXiv id.')
        d["tags"] = list(dict.fromkeys([*(d.get("tags") or []), *(a.get("tags") or [])]))
        added, updated = self.lib.merge([d])
        self.lib.save()
        p = (added or updated or [self.lib.find_duplicate(d)])[0]
        return f"{'Added' if added else 'Already in the library'}: {json.dumps(brief(p) if p else None, ensure_ascii=False)}"

    def tag_papers(self, a: dict) -> str:
        add = [t.strip() for t in a.get("add") or [] if t.strip()]
        remove = set(a.get("remove") or [])
        add_f = [f for f in (clean_folder(x) for x in a.get("add_folders") or []) if f]
        remove_f = {clean_folder(x) for x in a.get("remove_folders") or []}
        papers = [self._find(r) for r in a.get("papers") or []]
        if not papers:
            raise ToolError("Name at least one paper.")
        done = []
        for p in papers:
            p["tags"] = list(dict.fromkeys([*(t for t in p.get("tags") or [] if t not in remove), *add]))
            p["folders"] = list(dict.fromkeys([*(f for f in p.get("folders") or [] if f not in remove_f), *add_f]))
            done.append(f"{p['key']}: tags {', '.join(p['tags']) or '(none)'}; folders {', '.join(p['folders']) or '(none)'}")
        self.lib.save()
        return "\n".join(done)

    def add_note(self, a: dict) -> str:
        p = self._find(a.get("paper"))
        p["notes"] = "\n\n".join(x for x in [p.get("notes"), str(a.get("text") or "").strip()] if x)
        self.lib.save()
        return f"Saved to the notes of {p['key']}."

    # --- JSON-RPC ---

    def handle(self, msg: Any) -> Optional[dict]:
        """Answer one message; notifications (no id) get None."""
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
            return _fail(msg.get("id") if isinstance(msg, dict) else None, -32600, "Invalid request")
        if "id" not in msg:
            return None
        mid, method, params = msg["id"], msg["method"], msg.get("params") or {}
        if method == "initialize":
            asked = str(params.get("protocolVersion") or PROTOCOL)
            return _ok(
                mid,
                {
                    "protocolVersion": asked if re.fullmatch(r"\d{4}-\d{2}-\d{2}", asked) else PROTOCOL,
                    "capabilities": {"tools": {"listChanged": False}, "prompts": {"listChanged": False}},
                    "serverInfo": {"name": "lightkone", "title": "Lightkone paper library", "version": __version__},
                    "instructions": INSTRUCTIONS,
                },
            )
        if method == "ping":
            return _ok(mid, {})
        if method == "tools/list":
            return _ok(mid, {"tools": TOOLS})
        if method == "prompts/list":
            return _ok(mid, {"prompts": [{k: v for k, v in p.items() if k != "text"} for p in PROMPTS]})
        if method == "prompts/get":
            prompt = next((p for p in PROMPTS if p["name"] == params.get("name")), None)
            if not prompt:
                return _fail(mid, -32602, f"Unknown prompt {params.get('name')}")
            args = params.get("arguments") or {}
            lacking = [x["name"] for x in prompt["arguments"] if x.get("required") and not str(args.get(x["name"]) or "").strip()]
            if lacking:
                return _fail(mid, -32602, f"Missing {', '.join(lacking)}")
            return _ok(mid, {"description": prompt["description"], "messages": [{"role": "user", "content": {"type": "text", "text": prompt["text"](args)}}]})
        if method == "tools/call":
            name = params.get("name")
            if name not in TOOL_NAMES:
                return _fail(mid, -32602, f"Unknown tool {name}")
            try:
                self._fresh()
                text = getattr(self, name)(params.get("arguments") or {})
                return _ok(mid, {"content": [{"type": "text", "text": text}]})
            except Exception as e:  # every failure goes back to the AI app as words
                return _ok(mid, {"content": [{"type": "text", "text": str(e) or type(e).__name__}], "isError": True})
        return _fail(mid, -32601, f"Method not found: {method}")

    def serve(self, inp: IO[str] = sys.stdin, out: IO[str] = sys.stdout) -> None:
        """Read one JSON message per line until input ends."""
        for line in inp:
            line = line.strip()
            if not line:
                continue
            try:
                body = json.loads(line)
            except ValueError:
                reply: Any = _fail(None, -32700, "Parse error")
            else:
                if isinstance(body, list):
                    reply = [r for r in (self.handle(m) for m in body) if r is not None] or None
                else:
                    reply = self.handle(body)
            if reply is not None:
                out.write(json.dumps(reply, ensure_ascii=False) + "\n")
                out.flush()


def _ok(mid: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _fail(mid: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


INSTRUCTIONS = (
    "This is a researcher's own paper library. Search it before answering questions about papers they have read, "
    "cite papers by their citation key, and read the full text (read_paper) when the abstract is not enough. "
    "Ask before adding papers or changing tags and notes unless the researcher asked for it."
)

PAPER = {"type": "string", "description": "The paper's id or citation key (from search_papers), or its DOI or arXiv id."}
RO = {"readOnlyHint": True}

# Same names, descriptions and inputs as the site's server (src/mcp/server.ts).
TOOLS: list = [
    {
        "name": "search_papers",
        "description": "Search the researcher's paper library. Words match title, authors, abstract, tags and notes; filters: tag:x author:x year:2020 year:2015-2020 has:pdf has:notes "
        'in:"Folder/Sub" is:starred is:recent (recently read). An empty query lists the most recently added papers.',
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}}, "required": ["query"]},
        "annotations": RO,
    },
    {
        "name": "get_paper",
        "description": "One paper's full record: abstract, the researcher's notes, highlights with their notes, and its BibTeX.",
        "inputSchema": {"type": "object", "properties": {"paper": PAPER}, "required": ["paper"]},
        "annotations": RO,
    },
    {
        "name": "read_paper",
        "description": "The full text of a paper, extracted from its PDF, with [page N] markers. Long papers can be read a few pages at a time. "
        "Math is as the PDF's text layer gives it, so equations may be garbled.",
        "inputSchema": {"type": "object", "properties": {"paper": PAPER, "from_page": {"type": "integer", "minimum": 1}, "to_page": {"type": "integer", "minimum": 1}}, "required": ["paper"]},
        "annotations": RO,
    },
    {
        "name": "list_tags",
        "description": "All tags and folders in the library, with how many papers are in each (a folder counts the folders inside it).",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": RO,
    },
    {
        "name": "search_full_text",
        "description": "Find words inside the papers' full text (every word must occur), with the page and a snippet. "
        "Only papers whose text Lightkone has extracted are searched. Narrow it with `within`, a search_papers query "
        '(like "tag:qft" or "year:2018-2024"), to search more of the right papers at once.',
        "inputSchema": {
            "type": "object",
            "properties": {
                "words": {"type": "string"},
                "within": {"type": "string", "description": "A search_papers query; only papers it finds are searched."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
            },
            "required": ["words"],
        },
        "annotations": RO,
    },
    {
        "name": "get_citations",
        "description": "How a paper connects to the rest of the library: the library papers it cites and the library papers that cite it, "
        "from the citation map (references from OpenAlex, fetched when the researcher opens the map in Lightkone).",
        "inputSchema": {"type": "object", "properties": {"paper": PAPER}, "required": ["paper"]},
        "annotations": RO,
    },
    {
        "name": "find_missing_papers",
        "description": "Works that several papers in the library cite but the library does not have, most shared first: likely gaps in the reading. "
        "Add one with add_paper by its DOI or arXiv id.",
        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 15}}},
        "annotations": {"readOnlyHint": True, "openWorldHint": True},
    },
    {
        "name": "list_branches",
        "description": "The researcher's kept Branches: citation neighbourhoods grown from chosen papers, a folder or the whole library, "
        "with the strongest candidates from the last time each was opened in Lightkone. Name one to see more of its candidates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "branch": {"type": "string", "description": "A branch's name or id; leave out to list them all."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            },
        },
        "annotations": RO,
    },
    {
        "name": "export_bibtex",
        "description": "BibTeX for chosen papers, or for every paper a search_papers query finds (up to 500), ready for a .bib file.",
        "inputSchema": {
            "type": "object",
            "properties": {"papers": {"type": "array", "items": PAPER}, "query": {"type": "string", "description": "A search_papers query, used when `papers` is not given."}},
        },
        "annotations": RO,
    },
    {
        "name": "add_paper",
        "description": "Add a paper to the library by DOI, arXiv id, or a link containing either. Metadata comes from Crossref or arXiv. Optionally tag it.",
        "inputSchema": {"type": "object", "properties": {"identifier": {"type": "string"}, "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["identifier"]},
    },
    {
        "name": "tag_papers",
        "description": 'Add or remove tags, and put papers into or take them out of folders (paths like "Physics/QFT"), for one or more papers.',
        "inputSchema": {
            "type": "object",
            "properties": {
                "papers": {"type": "array", "items": PAPER, "minItems": 1},
                "add": {"type": "array", "items": {"type": "string"}},
                "remove": {"type": "array", "items": {"type": "string"}},
                "add_folders": {"type": "array", "items": {"type": "string"}},
                "remove_folders": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["papers"],
        },
    },
    {
        "name": "add_note",
        "description": "Append text to a paper's notes (the free-text notes on the paper, not a highlight).",
        "inputSchema": {"type": "object", "properties": {"paper": PAPER, "text": {"type": "string"}}, "required": ["paper", "text"]},
    },
]
TOOL_NAMES = {t["name"] for t in TOOLS}

PROMPTS: list = [
    {
        "name": "find_in_library",
        "title": "What do I have on…",
        "description": "Find the papers in your library on a topic, with what your notes say about them.",
        "arguments": [{"name": "topic", "description": "The topic, method or question.", "required": True}],
        "text": lambda a: f"Find the papers in my Lightkone library about: {a.get('topic')}\n\n"
        "Use search_papers with a few different wordings, and search_full_text for terms that may only appear in the body. "
        "For the most relevant few, use get_paper to see my notes and highlights. Answer with a short list grouped by theme, "
        "each paper as its citation key, title and year, and one line on why it fits. Say plainly if the library has little on it.",
    },
    {
        "name": "cite_draft",
        "title": "Cite this draft",
        "description": "Suggest citations from your library for a paragraph or section, with BibTeX.",
        "arguments": [{"name": "text", "description": "The draft text (LaTeX is fine).", "required": True}],
        "text": lambda a: "Suggest citations from my Lightkone library for this draft. For each claim that needs one, search the library "
        "(search_papers, then search_full_text or read_paper to check the paper really says it). Only cite papers that are in the library. "
        "Return the draft with \\cite{key} added where they belong, then a short list of claims you could not support, then export_bibtex for the keys you used.\n\n"
        + str(a.get("text")),
    },
    {
        "name": "reading_gaps",
        "title": "What am I missing?",
        "description": "Papers your library keeps citing but does not have, and the strongest new candidates in your Branches.",
        "arguments": [{"name": "focus", "description": "Optional: a topic, folder or branch to focus on."}],
        "text": lambda a: f"Look for gaps in my Lightkone library{', focusing on ' + a['focus'] if a.get('focus') else ''}. "
        "Use find_missing_papers for works several of my papers cite that I don't have, and list_branches for the strongest candidates in my kept Branches. "
        "Pick the ten most worth reading, say in a line each why (which of my papers lead to it), and ask before adding any with add_paper.",
    },
    {
        "name": "explain_paper",
        "title": "Walk me through a paper",
        "description": "Read a paper in your library and explain it at research level, with your own notes and highlights.",
        "arguments": [{"name": "paper", "description": "Citation key, title words, DOI or arXiv id.", "required": True}],
        "text": lambda a: f'Walk me through "{a.get("paper")}" from my Lightkone library. Find it (search_papers if needed), read get_paper for my notes and highlights, '
        "then read_paper. Explain the setup, the key steps and assumptions, and the result, at graduate level with the math kept. "
        "Then use get_citations to say how it connects to the other papers I have.",
    },
]
