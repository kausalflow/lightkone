# Set up with AI

Most of setting up Lightkone is setting up storage: a bucket or a repository,
a key for it, and (for a bucket) a CORS rule that lets the site in. An AI
assistant can do much of that for you, and Lightkone gives it what it needs.
This page shows the ways, from least to most automatic.

The examples use `https://lightkone.lab.kausalflow.com`. If you run your own
copy, use its address instead.

## Ask any assistant, with the real docs

Assistants guess when they don't know a tool. Point them at the docs instead:

- **One page:** every docs page has a **Copy page for AI** button at the
  bottom. It copies the page as Markdown, with its address, ready to paste
  into Claude or any other assistant.
- **All of it:** the whole documentation is one text file at
  [`/llms-full.txt`](https://lightkone.lab.kausalflow.com/llms-full.txt), and a
  short map of it at [`/llms.txt`](https://lightkone.lab.kausalflow.com/llms.txt)
  (the [llms.txt](https://llmstxt.org) convention). Give an assistant either
  link, or attach the file, and ask your question.

## Check your storage in the app

In **Settings → Where your library lives**, fill in the bucket or repository,
then press **Check these settings**. Lightkone looks at the settings for
common slips (the bucket name inside the endpoint, a public `r2.dev` address,
a wrong region), then lists the library, saves a small test file, reads it
back and removes it.

If a step fails, it says what is most likely wrong and how to fix it. For a
CORS problem it shows the exact rule your bucket needs, with this site's
address filled in. **Copy for an AI assistant** copies the whole report, with
your settings but **without your keys**, so you can paste it into Claude and
ask for step-by-step help.

Nothing is saved until you press **Save**.

## Let Claude Code set up Cloudflare R2

If you have [Claude Code](https://claude.com/claude-code) (or another coding
assistant that can run commands), it can create the bucket and its CORS rule
for you with Cloudflare's `wrangler` tool. Only one step stays with you: R2
access keys can only be made in the Cloudflare dashboard.

Open a terminal in an empty folder, start Claude Code, and paste this:

```text
Set up Cloudflare R2 storage for Lightkone, a reference manager that keeps its
library in a bucket I own. Lightkone's docs: https://lightkone.lab.kausalflow.com/llms-full.txt
(read the "Cloudflare R2" section of docs/STORAGE.md first).

1. Check that Node.js is installed, then run `npx wrangler login` and wait for
   me to sign in in the browser.
2. Create a private bucket called `papers` (ask me if I want another name):
   `npx wrangler r2 bucket create papers`. Do not make it public and do not
   add a custom domain.
3. Write cors.json in wrangler's format and apply it with
   `npx wrangler r2 bucket cors set papers --file cors.json`, allowing origin
   https://lightkone.lab.kausalflow.com, methods GET, PUT, DELETE and HEAD,
   all headers, exposing ETag, max age 3600. Show me
   `npx wrangler r2 bucket cors list papers` afterwards.
4. Find my account id (`npx wrangler whoami`) and tell me the endpoint:
   https://<account id>.r2.cloudflarestorage.com
5. Tell me how to make the access key myself: R2 overview → Manage API tokens
   → Create API token, permission Object Read & Write, applied to the papers
   bucket only. Don't ask me to paste the secret into this chat.
6. Finally list what to type in Lightkone: Settings → S3 / R2 / MinIO bucket →
   Endpoint, Bucket, Region `auto`, Access key id, Secret access key, then
   Check these settings.
```

Then make the key as it describes, enter the settings in Lightkone, and press
**Check these settings**.

Claude on claude.ai can do the same with the Cloudflare connector, which can
create R2 buckets; ask it to follow
[the R2 steps](STORAGE.md#cloudflare-r2) and to tell you the dashboard
steps it can't do.

## A private GitHub repository instead

A repository needs no CORS rule, so the AI part is short. Ask your assistant
(or Claude Code, with the GitHub CLI) to create a **private** repository, then
make a fine-grained token yourself at **GitHub → Settings → Developer settings
→ Fine-grained tokens**, with **Contents: Read and write** on that one
repository. See [Private GitHub repository](STORAGE.md#private-github-repository).

## On the command line

With Python, `pipx install lightkone` then `lightkone setup` does the same as
the in-app check and the CORS step together: it asks for the bucket, checks it,
adds the CORS rule for the web app (given a key allowed to), and writes a
settings file to import in the web app. A coding assistant can run it for
you too. See [The command line](CLI.md#starting-fresh-lightkone-setup).

If the web app already works, bring its settings to the command line instead:
**Settings → Backup → Export settings**, then
`lightkone login --from-backup <file>`.

## Keeping keys safe

- Paste keys into Lightkone's Settings, not into a chat. **Copy for an AI
  assistant** leaves them out on purpose.
- Use a key scoped to the one bucket or repository Lightkone uses.
- If a key ever ends up somewhere it shouldn't, delete it (R2: Manage API
  tokens; GitHub: Fine-grained tokens) and make a new one.
