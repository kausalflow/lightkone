# Releasing

The live site (https://lightkone.lab.kausalflow.com) is what people use, so
nothing reaches it untested. Changes go to a staging site first, and reach the
live site only with a release: a version tag. GitHub Actions does the work
(`.github/workflows/ci.yml` and `deploy.yml`).

## How a change travels

1. **Every pull request** runs `npm run check` (types and tests) and the build.
2. **Every merge to `main`** deploys to the staging site,
   https://staging.lightkone.pages.dev. The app there shows a **Staging** tag
   beside its name. After the deploy, the workflow:
   - opens the site in a browser (`scripts/smoke.mjs`): the landing page, docs
     and app load, the app opens with its example papers and Chats, with no
     errors, `/api/` answers, and `version.json` names the commit just built;
   - checks that the site sends exactly the files this commit builds
     (`npm run verify`).
3. **A version tag** (`v0.2.0`, matching `package.json`) deploys the same way
   to the live site, runs the same checks there (on both
   https://lightkone.pages.dev and the custom domain), and makes the GitHub
   release. The release gets notes listing the pull requests merged since the
   last one, and `fingerprints.txt`: the SHA-256 of every built file.

The live site keeps the last release until the next tag, however many merges
come in between.

## Making a release

1. Try the merged changes on staging.
2. Open a pull request titled **Lightkone 0.2.0** that sets `version` in
   `package.json` (and `package-lock.json`, with
   `npm version 0.2.0 --no-git-tag-version`). Merge it.
3. Tag that commit on `main` and push the tag:

   ```sh
   git checkout main && git pull
   git tag v0.2.0 && git push origin v0.2.0
   ```

   Or on GitHub: **Releases → Draft a new release**, tag `v0.2.0` on `main`,
   **Publish**. The workflow adds the notes and fingerprints if the release
   has none.
4. Watch the **Deploy** run under **Actions**. When it is green, the live site
   is on the new version; Help and Settings show it (`Lightkone 0.2.0 · date ·
   commit`), and open apps offer **Reload to update**.

A tag that does not match `package.json` stops before deploying.

### Version numbers

While Lightkone is 0.x: the middle number for new features (0.2.0 → 0.3.0),
the last for fixes only (0.2.0 → 0.2.1). Say in the release notes when a
release changes how the library is stored, and what an older copy of the app
does with it.

## Putting an earlier release back

**Actions → Deploy → Run workflow**, with the tag to put back (for example
`v0.2.0`) as *release*. It builds that tag and deploys it to the live site,
with the same checks. Cloudflare's dashboard can also roll back: Workers &
Pages → lightkone → Deployments → a production deployment → **Rollback**.

## Check it yourself

The build is reproducible: the same commit builds byte for byte the same
files. Anyone can check that a site sends exactly the code of a release, and
so that the code holding their API keys is the code in this repository:

```sh
git checkout v0.2.0 && npm ci && npm run build
npm run verify -- https://lightkone.pages.dev/
```

`npm run verify -- --list` prints the fingerprints, to compare with
`fingerprints.txt` on the release. A custom domain on a Cloudflare zone can
change pages on the way (email obfuscation, Rocket Loader), so check the
`pages.dev` address, or turn those off for the domain.

## Staging is a separate site

Staging has its own address, so the browser keeps its library settings,
keys and offline papers apart from the live site's:

- Copy your settings over with **Settings → Export settings** on the live site
  and **Import settings** on staging.
- An S3 or R2 bucket must allow the staging address in its CORS rule (see
  [STORAGE.md](STORAGE.md)), as it does the live one.
- The services under `/api/` that need secrets (`MCP_SECRET` for the AI app
  address, `S2_API_KEY`) read them from the Pages project's **Preview**
  environment on staging: Workers & Pages → lightkone → Settings → Variables
  and Secrets, and add them for Preview as well as Production.

Staging and preview deployments are not indexed by search engines.

## Checking a site by hand

```sh
npm run smoke -- https://staging.lightkone.pages.dev/   # the browser check
npm run verify -- https://staging.lightkone.pages.dev/  # same files as this build
```

The browser check needs Chromium: `npx playwright install chromium`.
