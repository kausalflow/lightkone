# Questions and fixes

## Questions

**Is there an account?** No. Lightkone has no accounts. Your settings are in
your browser and your library is in your storage.

**What happens if I clear my browser data?** Your settings and keys go with
it (keep a backup from **Settings → Backup**). A library in a bucket or on
GitHub is untouched. A library kept in this browser only is lost.

**Can I move my library from this browser to a bucket later?** Not in one
step yet. **Export .bib** and import it into the new storage to carry papers,
tags and keys, but notes and highlights stay behind.

**Do I need a Claude key?** Only for Ask, Explain, Summarize, Cite this's
check, and adding a paper from a plain description. Everything else works
without one.

**Will the example papers come back?** No. Once removed, they stay gone. Only
a brand-new library in this browser gets them, never a bucket, repository or
shared library.

**Does Lightkone change my Paperpile library or Google Drive?** No. It only
reads what you export or copy.

## When something goes wrong

**"Could not open …: Failed to fetch"** with a bucket: the bucket's CORS rule
doesn't allow the site. Add the exact address (for example
`https://lightkone.lab.leima.is`) to *AllowedOrigins*. See
[Where your library lives](STORAGE.md#cloudflare-r2).

**403, Access Denied, or 404 from GitHub**: the key or token can't reach that
bucket or repository. Check the bucket name and endpoint, or that the
fine-grained token was given this repository with *Contents: Read and write*.

**It stopped saving after weeks of working**: a GitHub token has expired.
Make a new one and replace it in Settings.

**PDFs didn't link after importing from Paperpile**: check they were copied
to `papers/All Papers/` in the same storage (with your bucket folder in front,
if you set one), then reload. Search `no:pdf` for the ones still missing. See
[Moving from Paperpile](PAPERPILE.md#step-5-check-and-tidy).

**"No free PDF found"**: the paper has no legal open-access copy, or no
contact email is set under **Settings → PDFs** (needed for non-arXiv papers).
Use **Attach PDF**.

**"Not saved" at the top**: the last save didn't reach your storage, and a
message says why. Your changes are still in the open page, and the next change
saves everything again, so keep the tab open until it says *Saved*. If it
keeps failing, check the storage details in Settings. In the installed app
while offline, changes are kept and saved once you are back online.

**Ask says to add a key**: paste your Anthropic API key under
**Settings → Claude**.
