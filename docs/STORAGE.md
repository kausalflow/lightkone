# Where your library lives

Lightkone has no server of its own for your papers. The library is a few
plain files in storage you choose, and the app reads and writes them straight
from your browser. Choose it in **Settings → Where your library lives**.

## What is stored

Whatever the storage, the files are the same:

| Path | What it is |
| --- | --- |
| `lightkone/library.json` | Every paper, with its folders, tags, notes and stars. |
| `lightkone/library.bib` | The whole library as BibTeX, rewritten on every save, for LaTeX. |
| `lightkone/annotations/<id>.json` | Highlights and their notes, one file per paper. |
| `lightkone/text/`, `citations.json`, `equations.json`, `new-on-arxiv.json` | Work done once and kept (PDF text for search, the citation map, equations) so it isn't done again. Safe to delete; it is rebuilt. |
| `papers/All Papers/...` | The PDFs, filed by first author like Paperpile (`papers/All Papers/HINTON/Hinton et al. 2012 - ....pdf`). |

These are open formats (JSON, BibTeX, PDF), so you can back them up, read them
with other tools, or leave with them.

## Choosing

| | This browser only | Cloudflare R2 | AWS S3 / MinIO | Private GitHub repository |
| --- | --- | --- | --- | --- |
| Setup | None | About 10 minutes | About 15 minutes | About 5 minutes |
| Cost | Free | Free up to 10 GB, then about $0.015 per GB a month | Your AWS or MinIO costs | Free |
| Several devices | No | Yes | Yes | Yes |
| History of changes | No | No (turn on bucket versioning if you want it) | With bucket versioning | Every save is a commit |
| Large PDF collections | Limited by the browser | Yes | Yes | Up to about 5 GB; no file over 100 MB |
| Claude and other AI apps (MCP) | No | Yes | Yes | Yes |
| Shared with a group | No | Yes, by handing out keys | Yes, by handing out keys | Yes, through the repository's collaborators |

If unsure, pick **Cloudflare R2**.

Credentials stay in the browser that uses them. They are never written into
the library or sent to Lightkone's site. Give each key or token access to one
bucket or one repository only.

## This browser only

No setup. The library lives in this browser's storage (IndexedDB) on this
device. It is the default, and it is good for trying Lightkone out.

Keep in mind:

- It doesn't sync. Another browser or device sees a different, empty library.
- Clearing the site's data in the browser deletes the library. Lightkone asks
  the browser to keep its data (Settings says whether it agreed), but don't
  keep your only copy here.
- PDFs come in one at a time: downloaded free copies, or **Attach PDF**.

Lightkone can't yet move a whole library out of this browser into a bucket or
repository. **Export .bib** (the download button at the top) takes the papers,
tags and citation keys, but not notes or highlights. So choose your real
storage before you put much work in.

## Cloudflare R2

R2 is Cloudflare's object storage: S3-compatible, with no fees for
downloads.

1. **Create the bucket.** At [dash.cloudflare.com](https://dash.cloudflare.com),
   open **R2 Object Storage** (the first time, R2 asks you to add a payment
   method, even for the free tier) → **Create bucket**. Name it, for example
   `papers`. Leave the location on Automatic.
2. **Make a key for it.** On the R2 overview page, open **Manage API tokens**
   → **Create API token**:
   - Permissions: **Object Read & Write**.
   - Specify bucket(s): **Apply to specific buckets only**, and pick `papers`.
   - Create it, then copy the **Access Key ID** and the **Secret Access Key**.
     The secret is shown only once.
   - Note the endpoint under *Use jurisdiction-specific endpoints for S3
     clients*: `https://<account id>.r2.cloudflarestorage.com`.
3. **Let the browser in (CORS).** Open the bucket → **Settings** → **CORS
   Policy** → **Add CORS policy**, and paste this, with your Lightkone site's
   address:

   ```json
   [
     {
       "AllowedOrigins": ["https://lightkone.lab.leima.is"],
       "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Add `"http://localhost:5173"` to *AllowedOrigins* if you also run Lightkone
   locally.
4. **Tell Lightkone.** In **Settings**, choose **S3 / R2 / MinIO bucket**:
   - Endpoint: `https://<account id>.r2.cloudflarestorage.com`
   - Bucket: `papers`
   - Region: `auto`
   - Folder in the bucket: leave empty, or a name such as `lab` to keep
     several libraries in one bucket
   - Access key id and Secret access key from step 2

   Then **Save**. The side bar's status line shows the bucket once it opens.

Don't make the bucket public, and don't add a custom domain to it. Lightkone
signs each request with your key, so the bucket stays private.

## AWS S3

1. In the S3 console, **Create bucket**. Keep *Block all public access* on.
2. In IAM, create a user for Lightkone with this policy (replace `papers`),
   then create an access key for it (**Security credentials → Create access
   key**, use case *Application running outside AWS*):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::papers" },
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::papers/*" }
     ]
   }
   ```

3. Open the bucket → **Permissions** → **Cross-origin resource sharing
   (CORS)** → **Edit**, and paste the same JSON as for R2 above.
4. In Lightkone's **Settings**, choose **S3 / R2 / MinIO bucket**. The
   endpoint is the regional one, `https://s3.<region>.amazonaws.com` (for
   example `https://s3.eu-central-1.amazonaws.com`), the region is that region,
   and the key is the one from step 2.

## MinIO and other S3-compatible stores

Anything that speaks the S3 API and allows CORS works the same way
(MinIO, Ceph, Wasabi, Backblaze B2's S3 API, and others).

- Endpoint: the server's address, for example `https://minio.example.org`.
- Region: whatever the server is configured with, often `us-east-1`.
- Create a user or service account limited to the one bucket.
- CORS: MinIO allows browser requests from any origin by default. If yours is
  locked down, set `MINIO_API_CORS_ALLOW_ORIGIN` to your Lightkone site's
  address. Other stores use the same CORS JSON as above.

The store must be reachable over HTTPS from the browsers that use it.

## Private GitHub repository

1. **Create a private repository**, for example `papers`, on GitHub. It may be
   empty.
2. **Make a token** at **GitHub → Settings → Developer settings → Personal
   access tokens → Fine-grained tokens → Generate new token**:
   - Repository access: **Only select repositories**, and pick that one.
   - Permissions → Repository permissions → **Contents: Read and write**.
     (Metadata: Read-only is added by itself.)
   - Pick an expiry you are comfortable with, and note when it runs out.
     Lightkone stops saving when the token expires.
3. In Lightkone's **Settings**, choose **Private GitHub repository**:
   - Repository: `owner/name`
   - Token: the one from step 2
   - Branch: leave empty for the default branch
   - Folder of .bib files to import: optional. Lightkone reads every .bib in
     that folder each time it opens and adds the papers it lacks. Point
     Paperpile's or Zotero's BibTeX export there to keep them in step (see
     [Moving from Paperpile](PAPERPILE.md#keeping-paperpile-running-while-you-switch)).
   - GitHub Enterprise API URL: only for GitHub Enterprise Server, for example
     `https://github.example.com/api/v3`.

Each save is a commit, so the repository holds the full history of your
library, and you can see or undo any change on GitHub. Mind GitHub's limits:
no file over 100 MB, and repositories are best kept under about 5 GB, so very
large PDF collections are better in a bucket.

## Using several devices

With a bucket or a repository, open the same Lightkone site on any device and
enter the same storage settings. To avoid typing keys again, use **Settings →
Backup → Export settings** on one device and **Import settings** on the
other. With a passphrase, the file is encrypted.

Before each save, Lightkone reads the library again and merges what was saved
elsewhere (by another device, or by Claude through MCP) instead of
overwriting it. It also picks up changes when you come back to its tab. If
two devices change the same field of the same paper, the later save wins.

The installed app (Install app, from the browser menu) also keeps an offline
copy of the library and the last 25 PDFs you opened. Changes made offline are
saved when you are back online.

## Troubleshooting

- **"Could not open … Failed to fetch"** with a bucket almost always means
  CORS: the bucket's rule doesn't list the site's exact address (scheme and
  host, no trailing slash).
- **403 or "Access Denied"**: the key can't reach that bucket, or the bucket
  name or endpoint is wrong. For R2, check the token is scoped to this bucket
  with *Object Read & Write*.
- **GitHub 404**: the token can't see the repository. Fine-grained tokens see
  only the repositories picked when they were made.
- **GitHub 401**: the token has expired or was revoked. Make a new one and
  replace it in Settings.
