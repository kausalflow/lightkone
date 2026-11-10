import json

import pytest
from typer.testing import CliRunner

from lightkone import settings as cfg
from lightkone import setup as su
from lightkone.cli import app
from lightkone.storage import S3Storage

ORIGIN = "https://lightkone.lab.kausalflow.com"
ENDPOINT = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"


class Resp:
    def __init__(self, status, body=b"", headers=None):
        self.status_code = status
        self.content = body if isinstance(body, bytes) else body.encode()
        self.text = self.content.decode()
        self.headers = headers or {}
        self.ok = 200 <= status < 300


class Bucket:
    """A pretend S3 bucket that keeps objects and a CORS configuration, and answers preflights by it."""

    def __init__(self, cors="", can_set_cors=True):
        self.objects = {}
        self.cors = cors
        self.can_set_cors = can_set_cors
        self.calls = []

    def request(self, method, url, data=None, headers=None, timeout=None):
        from urllib.parse import unquote

        self.calls.append((method, url, headers))
        path = unquote(url.split("?")[0].split("/papers", 1)[-1].lstrip("/"))
        if "?cors" in url:
            if method == "GET":
                return Resp(200, self.cors) if self.cors else Resp(404, "<Error><Code>NoSuchCORSConfiguration</Code></Error>")
            if method == "PUT":
                if not self.can_set_cors:
                    return Resp(403)
                assert "content-md5" in headers
                self.cors = data.decode()
                return Resp(200)
        if method == "OPTIONS":
            origin = headers["Origin"]
            if origin in su.allowed_origins(self.cors):
                return Resp(200, headers={"Access-Control-Allow-Origin": origin})
            return Resp(403)
        if method == "PUT":
            self.objects[path] = data
            return Resp(200)
        if method == "GET" and "list-type=2" in url:
            keys = "".join(f"<Contents><Key>{k}</Key></Contents>" for k in sorted(self.objects))
            return Resp(200, f"<ListBucketResult><IsTruncated>false</IsTruncated>{keys}</ListBucketResult>")
        if method == "GET":
            return Resp(200, self.objects[path]) if path in self.objects else Resp(404)
        if method == "DELETE":
            self.objects.pop(path, None)
            return Resp(204)
        return Resp(400)


def s3(bucket):
    return S3Storage(ENDPOINT, "papers", "id", "secret", session=bucket)


def test_endpoint_and_lint():
    assert su.endpoint_from("0123456789abcdef0123456789abcdef") == ENDPOINT
    assert su.endpoint_from("acct.r2.cloudflarestorage.com/") == "https://acct.r2.cloudflarestorage.com"
    base = {
        "storage.provider": "s3",
        "storage.s3.endpoint": ENDPOINT,
        "storage.s3.bucket": "papers",
        "storage.s3.accessKeyId": "id",
        "storage.s3.secretAccessKey": "secret",
    }
    assert su.lint("s3", base) is None
    assert "bucket name" in su.lint("s3", {**base, "storage.s3.endpoint": ENDPOINT + "/papers"})
    assert "r2.dev" in su.lint("s3", {**base, "storage.s3.endpoint": "https://pub-1.r2.dev"})
    assert "auto" in su.lint("s3", {**base, "storage.s3.region": "eu-west-1"})
    assert "owner/name" in su.lint("github", {"storage.github.repo": "papers", "storage.github.token": "t"})


def test_check_round_trip_leaves_nothing():
    b = Bucket()
    c = su.check(s3(b), "s3")
    assert c.ok and len(c.steps) == 4
    assert b.objects == {}


def test_check_explains_a_refused_key():
    class Refused(Bucket):
        def request(self, method, url, **kw):
            return Resp(403) if method == "PUT" else super().request(method, url, **kw)

    c = su.check(s3(Refused()), "s3")
    assert not c.ok and "Object Read & Write" in c.problem


def test_cors_rule_is_added_and_others_kept():
    other = '<?xml version="1.0"?><CORSConfiguration><CORSRule><AllowedOrigin>https://other.example</AllowedOrigin><AllowedMethod>GET</AllowedMethod></CORSRule></CORSConfiguration>'
    b = Bucket(cors=other)
    st = s3(b)
    assert not su.preflight(st, ORIGIN)
    su.put_cors(st, su.with_rule(su.get_cors(st), [ORIGIN]))
    assert su.allowed_origins(b.cors) == {"https://other.example", ORIGIN}
    assert su.preflight(st, ORIGIN)
    assert json.loads(su.wrangler_json([ORIGIN]))["rules"][0]["allowed"]["origins"] == [ORIGIN]


def test_backup_file_reads_back(tmp_path):
    s = {"storage.provider": "s3", "storage.s3.bucket": "papers"}
    assert cfg.read_backup(su.backup_text(s)) == s
    pytest.importorskip("cryptography")
    text = su.backup_text(s, "pass phrase")
    assert "papers" not in text
    assert cfg.read_backup(text, "pass phrase") == s


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("LIGHTKONE_CONFIG", str(tmp_path / "config.json"))
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _wire(monkeypatch, bucket):
    import lightkone.settings as settings_mod

    real = settings_mod.S3Storage
    monkeypatch.setattr(settings_mod, "S3Storage", lambda **kw: real(**kw, session=bucket))


def _setup(*extra, input=None):
    args = [
        "setup", "lab", "--provider", "s3",
        "--set", "endpoint=0123456789abcdef0123456789abcdef",
        "--set", "bucket=papers", "--set", "region=auto", "--set", "prefix=",
        "--set", "accessKeyId=id", "--set", "secretAccessKey=secret",
        *extra,
    ]
    return CliRunner().invoke(app, args, input=input, catch_exceptions=False)


def test_setup_adds_cors_saves_and_writes_settings_file(home, monkeypatch):
    b = Bucket()
    _wire(monkeypatch, b)
    r = _setup("--cors", "--origin", "http://localhost:5173")
    assert r.exit_code == 0, r.output
    assert "Added a CORS rule" in r.output
    assert su.allowed_origins(b.cors) == {ORIGIN, "http://localhost:5173"}
    c = cfg.load_config()
    assert c["default"] == "lab" and c["libraries"]["lab"]["storage.s3.endpoint"] == ENDPOINT
    saved = cfg.read_backup((home / "lightkone-settings-lab.json").read_text())
    assert saved["storage.s3.secretAccessKey"] == "secret"
    assert "Import settings" in r.output

    # Run again: the rule is already there.
    r = _setup("--no-settings-file")
    assert "lets https://lightkone.lab.kausalflow.com in" in r.output


def test_setup_shows_the_rule_when_the_key_cannot_set_it(home, monkeypatch):
    _wire(monkeypatch, Bucket(can_set_cors=False))
    r = _setup("--cors", "--no-settings-file")
    assert r.exit_code == 0, r.output
    assert "Admin Read & Write" in r.output
    assert "wrangler r2 bucket cors set papers" in r.output
    assert '"AllowedOrigins"' in r.output


def test_setup_stops_on_a_slip(home):
    r = CliRunner().invoke(app, ["setup", "--provider", "s3", "--set", f"endpoint={ENDPOINT}/papers", "--set", "bucket=papers", "--set", "region=auto", "--set", "prefix=", "--set", "accessKeyId=id", "--set", "secretAccessKey=s"])
    assert r.exit_code != 0 and "bucket name" in r.output
