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

- DNS on Cloudflare: Pages adds the record itself.
- DNS elsewhere: add a `CNAME` from the domain to `<project>.pages.dev`.

If storage is an S3/R2 bucket, add the site's address to the bucket's CORS
rule (see [STORAGE.md](STORAGE.md)).

## Other hosts

Copy `dist/` to any static host (GitHub Pages, Netlify, S3 + CloudFront, an
internal nginx). Paths are relative, so it also works under a sub-path.
