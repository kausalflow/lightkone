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
| `PAGES_DOMAIN` | variable (optional) | A custom domain, e.g. `lightkone.lab.kausalflow.com`. |
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

## The page service

`functions/api/page.ts` (at `/api/page?url=<page>`) fetches a web page for
saving it into the library, because browsers don't let one site read another's
pages. It answers JSON, never HTML, so nothing it fetches can run as part of
the site, and it fetches only public http(s) addresses on the usual ports,
checking each redirect, up to 5 MB.

## Limits on the services

The services under `/api/` (PDF, web pages, published versions, arXiv, equations, MCP
address) are for the site's own app. `functions/api/_middleware.ts` refuses
calls that a browser says come from another website, and limits each address
to a number of calls a minute per service (30 for PDFs, 120 for equations; see
`LIMITS`), answering `429` with `Retry-After` beyond that. Normal use stays far
below these.

Those counts are kept per Cloudflare server. For a hard limit across the whole
network, also add a rate limiting rule in the dashboard (the free plan
includes one): your domain's zone → **Security → WAF → Rate limiting rules →
Create rule**, with *URI Path starts with `/api/`*, counting by IP, for example
**50 requests per 10 seconds**, action **Block** for 10 seconds.

## Other hosts

Copy `dist/` to any static host (GitHub Pages, Netlify, S3 + CloudFront, an
internal nginx). Paths are relative, so it also works under a sub-path.
