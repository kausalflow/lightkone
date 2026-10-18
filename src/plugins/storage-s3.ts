import { AwsClient } from "aws4fetch";
import type { LightkonePlugin, StorageAdapter } from "../core/types";

// Any S3-compatible bucket: Cloudflare R2, AWS S3, MinIO, Backblaze B2, Wasabi.
// Requests are signed in the browser, so the bucket needs a CORS rule that
// allows this site's origin (see docs/STORAGE.md). Use a key scoped to this
// one bucket.

export interface S3Config {
  endpoint: string;
  bucket: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
}

export function s3Storage(cfg: S3Config): StorageAdapter {
  if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("S3 storage needs an endpoint, a bucket, an access key id and a secret.");
  }
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: cfg.region || "auto",
  });
  const root = `${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}`;
  const prefix = (cfg.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const full = (path: string) => (prefix ? `${prefix}/${path}` : path);
  const url = (path: string) => `${root}/${full(path).split("/").map(encodeURIComponent).join("/")}`;

  return {
    async read(path) {
      const r = await client.fetch(url(path));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Storage read failed (${r.status}): ${path}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async write(path, data, contentType = "application/octet-stream") {
      const r = await client.fetch(url(path), { method: "PUT", body: data as BodyInit, headers: { "Content-Type": contentType } });
      if (!r.ok) throw new Error(`Storage write failed (${r.status}): ${path}`);
    },
    async list(listPrefix) {
      const keys: string[] = [];
      let token: string | null = null;
      do {
        const q = new URLSearchParams({ "list-type": "2", prefix: full(listPrefix) });
        if (token) q.set("continuation-token", token);
        const r = await client.fetch(`${root}?${q}`);
        if (!r.ok) throw new Error(`Storage list failed (${r.status})`);
        const xml = new DOMParser().parseFromString(await r.text(), "application/xml");
        xml.querySelectorAll("Contents > Key").forEach((k) => keys.push((k.textContent ?? "").slice(prefix ? prefix.length + 1 : 0)));
        token = xml.querySelector("IsTruncated")?.textContent === "true" ? xml.querySelector("NextContinuationToken")?.textContent ?? null : null;
      } while (token);
      return keys;
    },
    async remove(path) {
      const r = await client.fetch(url(path), { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error(`Storage delete failed (${r.status}): ${path}`);
    },
  };
}

const plugin: LightkonePlugin = {
  id: "storage-s3",
  name: "S3-compatible storage",
  storage: [
    {
      id: "s3",
      label: "S3 / R2 / MinIO bucket",
      description: "A bucket you own. Cloudflare R2 is free up to 10 GB with no download fees; AWS S3 and MinIO work the same way.",
      fields: [
        { name: "endpoint", label: "Endpoint", placeholder: "https://<account>.r2.cloudflarestorage.com" },
        { name: "bucket", label: "Bucket", placeholder: "papers" },
        { name: "region", label: "Region", placeholder: "auto (R2) or e.g. eu-central-1" },
        { name: "prefix", label: "Folder in the bucket (optional)", placeholder: "team-a" },
        { name: "accessKeyId", label: "Access key id" },
        { name: "secretAccessKey", label: "Secret access key", type: "password" },
      ],
      create: (c) => s3Storage(c as unknown as S3Config),
    },
  ],
};
export default plugin;
