# Hosting

Lightkone is a static site (`npm run build` writes `dist/`), so any static
host works. The repository deploys to Cloudflare Pages: free for private
repositories, and in the same account as an R2 bucket for storage.

## Cloudflare Pages from GitHub Actions

`.github/workflows/deploy.yml` publishes on every push to `main` once these
are set in the repository (Settings → Secrets and variables → Actions):

| Name | Kind | Value |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Shown on the Cloudflare dashboard's account home, right sidebar. |
| `CLOUDFLARE_API_TOKEN` | secret | My Profile → API Tokens → Create Token → Custom token, permission **Account · Cloudflare Pages · Edit**, limited to your account. |
| `PAGES_DOMAIN` | variable (optional) | A custom domain, e.g. `lightkone.lab.leima.is`. |
| `PAGES_PROJECT` | variable (optional) | Pages project name; defaults to `lightkone`. |

The first run creates the Pages project; the app is then at
`https://<project>.pages.dev`.

For a custom domain, set `PAGES_DOMAIN`, then point DNS at Pages:

add a `CNAME` from the domain to `<project>.pages.dev` (proxied, if the zone is
on Cloudflare). The deploy token only manages Pages, so it cannot add the record.

If storage is an S3/R2 bucket, add the site's address to the bucket's CORS
rule (see [STORAGE.md](STORAGE.md)).

## The PDF service

`functions/api/pdf.ts` is a Cloudflare Pages Function, deployed with the site
at `/api/pdf`. Given a DOI and a contact email it asks
[Unpaywall](https://unpaywall.org) for a legal open-access copy and passes the
PDF through, because publishers do not let browsers download from another
site. It fetches only URLs Unpaywall returns for that DOI. arXiv PDFs do not
need it. On other hosts, either run the same function elsewhere and set its URL
under **Settings → PDFs**, or go without DOI downloads.

## The published-version service

`functions/api/published.ts` (at `/api/published?arxiv=<ids>`) tells **Tidy
up** which arXiv preprints have been published: first from the DOI and journal
reference authors added on arXiv, then from Semantic Scholar. Semantic
Scholar limits anonymous requests; for steadier results, request a free key at
https://www.semanticscholar.org/product/api and add it to the Pages project as
the secret `S2_API_KEY`.

## Other hosts

Copy `dist/` to any static host (GitHub Pages, Netlify, S3 + CloudFront, an
internal nginx). Paths are relative, so it also works under a sub-path.
