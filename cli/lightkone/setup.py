"""`lightkone setup`: set up where a library lives, check it, and let the web app in.

The steps the web app can't take for itself, because a browser is held back by
CORS until the bucket allows it: the terminal is not, so it can put the CORS
rule on the bucket, check that the rule works for the app's address, and write
a settings file the app imports (Settings → Backup → Import settings).
"""

from __future__ import annotations

import base64
import datetime as _dt
import hashlib
import json
import os
import re
import secrets
import stat
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from lightkone.storage import S3Storage, Storage, StorageError

R2_HOST = "r2.cloudflarestorage.com"
METHODS = ("GET", "PUT", "DELETE", "HEAD")
#: The web app's settings backups use the same key derivation (src/core/settings.ts).
ITERATIONS = 310_000


def origin_of(url: str) -> str:
    """The scheme and host of an address: what a CORS rule names."""
    p = urlsplit(url if "://" in url else f"https://{url}")
    return f"{p.scheme}://{p.netloc}"


def endpoint_from(text: str) -> str:
    """An S3 endpoint from what was typed: a full address, a host, or a bare R2 account id."""
    t = text.strip().rstrip("/")
    if re.fullmatch(r"[0-9a-f]{32}", t):
        return f"https://{t}.{R2_HOST}"
    if t and "://" not in t:
        t = f"https://{t}"
    return t


def lint(provider: str, s: dict) -> Optional[str]:
    """A slip in the settings, found before any request (the web app's check does the same)."""

    def v(k: str) -> str:
        return (s.get(f"storage.{provider}.{k}") or "").strip()

    if provider == "s3":
        missing = [
            label
            for k, label in [
                ("endpoint", "endpoint"),
                ("bucket", "bucket"),
                ("accessKeyId", "access key id"),
                ("secretAccessKey", "secret access key"),
            ]
            if not v(k)
        ]
        if missing:
            return "Missing: " + ", ".join(missing) + "."
        p = urlsplit(v("endpoint"))
        if p.scheme not in ("http", "https") or not p.netloc:
            return "The endpoint should be an address like https://<account id>.r2.cloudflarestorage.com."
        path = p.path.strip("/")
        if path:
            if path.split("/")[-1] == v("bucket"):
                return f"The endpoint includes the bucket name: use {p.scheme}://{p.netloc} as the endpoint."
            return f"The endpoint has a path after the host: use {p.scheme}://{p.netloc}."
        if p.netloc.endswith(".r2.dev"):
            return "That is the bucket's public r2.dev address, not its S3 endpoint (https://<account id>.r2.cloudflarestorage.com)."
        if p.netloc.endswith(R2_HOST) and v("region") not in ("", "auto"):
            return "R2 uses the region auto."
        if re.search(r"\s", v("accessKeyId") + v("secretAccessKey")):
            return "A key has a space in it: paste it again."
    if provider == "github":
        if not v("repo") or not v("token"):
            return "Missing: repository and token."
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", v("repo")):
            return "The repository should be owner/name, e.g. kausalflow/papers."
    return None


@dataclass
class Check:
    steps: list = field(default_factory=list)  # (label, ok, detail)
    problem: str = ""

    @property
    def ok(self) -> bool:
        return not self.problem


def explain(provider: str, step: str, message: str) -> str:
    """What a failed step most likely means."""
    m = re.search(r"\b([45]\d\d)\b", message)
    status = int(m.group(1)) if m else 0
    if provider == "s3":
        if status == 403:
            return (
                "The key can read but not write: give it Object Read & Write on this bucket."
                if step in ("write", "remove")
                else "The key was refused: check the key id and secret, and that the key covers this bucket (R2: Object Read & Write, this bucket under Specify bucket(s))."
            )
        if status == 404:
            return "No bucket by that name at this endpoint: check the name (case matters) and the account."
        if status == 400:
            return "The bucket refused the request: usually the region (auto for R2, the bucket's own region for AWS)."
        if status == 0:
            return f"Could not reach the endpoint: {message}"
    if provider == "github":
        if status == 401:
            return "GitHub refused the token: it has expired, was revoked, or was not copied whole."
        if status == 404:
            return "GitHub can't see that repository: check owner/name, and that the token was given this repository."
        if status == 403:
            return "The token can read but not write: give it Contents: Read and write."
    return message


def check(storage: Storage, provider: str) -> Check:
    """List the library, then save, read back and remove a small test file."""
    c = Check()
    probe = f"lightkone/.setup-check-{secrets.token_hex(4)}.txt"
    body = f"Lightkone setup check {_dt.datetime.now(_dt.timezone.utc).isoformat()}".encode()
    step = "list"
    try:
        n = len(storage.list("lightkone/"))
        c.steps.append(("List the library's files", True, f"{n} in lightkone/" if n else "empty: a new library starts here"))
        step = "write"
        storage.write(probe, body, "text/plain")
        c.steps.append(("Save a small test file", True, ""))
        step = "read"
        if storage.read(probe) != body:
            raise StorageError("The file read back differs from the one saved.")
        c.steps.append(("Read it back", True, ""))
        step = "remove"
        storage.remove(probe)
        c.steps.append(("Remove the test file", True, ""))
    except Exception as e:  # requests' errors as well as StorageError
        label = {"list": "List the library's files", "write": "Save a small test file", "read": "Read it back", "remove": "Remove the test file"}[step]
        c.steps.append((label, False, str(e)))
        c.problem = explain(provider, step, str(e))
        if step in ("read", "remove"):
            try:
                storage.remove(probe)
            except Exception:
                pass
    return c


# ------------------------------------------------------------------- CORS


def cors_rule_xml(origins: list[str]) -> str:
    return (
        "<CORSRule>"
        + "".join(f"<AllowedOrigin>{o}</AllowedOrigin>" for o in origins)
        + "".join(f"<AllowedMethod>{m}</AllowedMethod>" for m in METHODS)
        + "<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader>"
        + "<MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule>"
    )


def allowed_origins(xml: str) -> set[str]:
    return {o.strip() for o in re.findall(r"<AllowedOrigin>([^<]*)</AllowedOrigin>", xml)}


def with_rule(existing: str, origins: list[str]) -> str:
    """The bucket's CORS rules with one for these origins added; other rules are kept as they are."""
    rule = cors_rule_xml(origins)
    if existing and "</CORSConfiguration>" in existing:
        body = re.sub(r"^\s*<\?xml[^>]*>\s*", "", existing)
        return body.replace("</CORSConfiguration>", rule + "</CORSConfiguration>")
    return f'<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">{rule}</CORSConfiguration>'


def get_cors(s3: S3Storage) -> str:
    """The bucket's CORS rules as XML ("" when there are none)."""
    r = s3._request("GET", "", {"cors": ""})
    if r.status_code == 404:
        return ""
    if not r.ok:
        raise StorageError(f"Reading the bucket's CORS rules failed ({r.status_code})")
    return r.text


def put_cors(s3: S3Storage, xml: str) -> None:
    body = xml.encode("utf-8")
    md5 = base64.b64encode(hashlib.md5(body).digest()).decode()
    r = s3._request("PUT", "", {"cors": ""}, body, extra={"content-md5": md5, "content-type": "application/xml"})
    if not r.ok:
        raise StorageError(f"Setting the bucket's CORS rules failed ({r.status_code})")


def preflight(s3: S3Storage, origin: str) -> bool:
    """Whether a browser at `origin` may write to the bucket: the CORS check a browser makes first."""
    key = s3._full("lightkone/library.json")
    r = s3.http.request(
        "OPTIONS",
        s3.endpoint + s3._url_path(key),
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type,x-amz-content-sha256,x-amz-date",
        },
        timeout=30,
    )
    allow = r.headers.get("Access-Control-Allow-Origin", "") if hasattr(r, "headers") else ""
    return r.ok and allow in (origin, "*")


def cors_json(origins: list[str]) -> str:
    """The same rule as the Cloudflare dashboard and AWS console take it."""
    return json.dumps(
        [
            {
                "AllowedOrigins": origins,
                "AllowedMethods": list(METHODS),
                "AllowedHeaders": ["*"],
                "ExposeHeaders": ["ETag"],
                "MaxAgeSeconds": 3600,
            }
        ],
        indent=2,
    )


def wrangler_json(origins: list[str]) -> str:
    """The same rule in the format `wrangler r2 bucket cors set --file` takes."""
    return json.dumps(
        {
            "rules": [
                {
                    "allowed": {"origins": origins, "methods": list(METHODS), "headers": ["*"]},
                    "exposeHeaders": ["ETag"],
                    "maxAgeSeconds": 3600,
                }
            ]
        },
        indent=2,
    )


# --------------------------------------------------------- settings file


def backup_text(settings: dict, passphrase: str = "", now: Optional[_dt.datetime] = None) -> str:
    """A settings file in the web app's backup format, to import under Settings → Backup."""
    now = now or _dt.datetime.now(_dt.timezone.utc)
    out: dict = {"format": "lightkone-settings", "version": 1, "exported": now.strftime("%Y-%m-%dT%H:%M:%S.000Z")}
    if passphrase:
        try:
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
        except ImportError:
            raise ValueError("Encrypting the file needs the cryptography package: pip install 'lightkone[crypto]'.")
        salt, iv = os.urandom(16), os.urandom(12)
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(passphrase.encode("utf-8"))
        data = AESGCM(key).encrypt(iv, json.dumps(settings).encode("utf-8"), None)
        b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731
        out["encrypted"] = {"salt": b64(salt), "iv": b64(iv), "data": b64(data), "iterations": ITERATIONS}
    else:
        out["settings"] = settings
    return json.dumps(out, indent=2) + "\n"


def write_private(path: Path, text: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
