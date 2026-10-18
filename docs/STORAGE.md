# Storage

Credentials are kept in the browser that uses them and are never written into
the library. Give each one access to a single bucket or repository.

## This browser only

No setup. The library lives in IndexedDB on this device and does not sync.
Good for trying Lightkone out.

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
