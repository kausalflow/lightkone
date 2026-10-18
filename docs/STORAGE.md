# Storage

Credentials are kept in the browser that uses them and are never written into
the library. Give each one access to a single bucket or repository.

## This browser only

No setup. The library lives in IndexedDB on this device and does not sync.
Good for trying Lightkone out.

## Using several devices

With R2/S3 or GitHub, open the same library on as many devices as you like.
Before each save Lightkone reads the library again and merges changes saved
elsewhere (by another device, or by Claude through MCP) instead of
overwriting them, and it picks them up when you return to the tab. If two
devices change the same field of the same paper, the later save's value stays.

## Cloudflare R2 (or any S3-compatible bucket)

1. Create a bucket, for example `papers`.
2. Create an R2 API token with **Object Read & Write** on that bucket only, and
   note the access key id, secret and the account endpoint
   (`https://<account-id>.r2.cloudflarestorage.com`).
3. Add a CORS rule to the bucket so the browser may call it:

```json
[
  {
    "AllowedOrigins": ["https://your-lightkone-site.example", "http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

4. In Settings choose **S3 / R2 / MinIO bucket** and fill in the endpoint,
   bucket, region `auto`, and the key.

AWS S3 and MinIO work the same way: use the regional endpoint
(`https://s3.eu-central-1.amazonaws.com`) or your MinIO URL, the region, and an
IAM key limited to the bucket. A folder in the bucket lets several libraries
share one bucket.

## Moving PDFs over from Paperpile

Paperpile keeps PDFs in your Google Drive under `Paperpile/All Papers`, and its
BibTeX names each paper's file (`file = {All Papers/H/Hinton et al. 2012 - ....pdf}`).
Lightkone uses the same layout: PDFs live under `Paperpile/All Papers/` in your
storage, named the way Paperpile names them
(`HINTON/Hinton et al. 2012 - Improving neural networks ....pdf`), and each
paper's `file` field holds that path. Copy the folder once into the bucket and
every paper finds its PDF. Nothing is renamed, and the folder stays readable by
Paperpile and by a future Google Drive storage plugin.

1. Install [rclone](https://rclone.org/install/) on your computer.
2. Connect Google Drive (read-only) and the bucket:

   ```sh
   rclone config create gdrive drive scope drive.readonly
   rclone config create r2 s3 provider Cloudflare \
     access_key_id <key id> secret_access_key <secret> \
     endpoint https://<account-id>.r2.cloudflarestorage.com
   ```

   The first command opens a browser to sign in to Google.
3. Check the folder name, then copy (add the bucket folder, if you set one, before `Paperpile/`):

   ```sh
   rclone lsd "gdrive:Paperpile"
   rclone copy "gdrive:Paperpile/All Papers" "r2:<bucket>/Paperpile/All Papers" --progress --transfers 8
   ```

   Running it again later only copies what is new.
4. In Lightkone, import Paperpile's `.bib` files (**Add paper → Import a .bib file**),
   then reload. The status bar says how many PDFs were linked.

Papers are matched by path first and by file name if the folder sits one level
off. Paperpile can also file PDFs by its own folders (`All Papers/MLDS/...`);
those match by file name. New PDFs that Lightkone downloads or you attach are
filed by first author, Paperpile's default.

## GitHub repository

1. Create a private repository (or reuse one).
2. Create a fine-grained personal access token with **Contents: read and write**
   on that repository only.
3. In Settings choose **Private GitHub repository** and enter `owner/name` and
   the token.

Each save is a commit, so the history of the library is kept. To pick up BibTeX
that Paperpile (or another tool) syncs into the same repository, set the folder
of `.bib` files, for example `paperpile`. Papers already in the library are not
duplicated; new ones are added on the next load. GitHub Enterprise works with
its API URL.
