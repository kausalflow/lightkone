# Sharing and devices

## Your library on several devices

With a bucket or a GitHub repository (see [Where your library lives](STORAGE.md)),
every device that uses the same storage settings sees the same library.
Move the settings with **Settings → Backup**: **Export settings** on one
device (with a passphrase, the file is encrypted) and **Import settings** on
the other.

Changes merge rather than overwrite: before each save, Lightkone reads what
other devices (or Claude through MCP) saved and keeps both, paper by paper
and field by field.

## On a phone

Install Lightkone from the browser menu (**Install app** in Chrome, **Add to
Home Screen** in Safari). Then:

- it opens offline, with the library and the last 25 PDFs you opened;
- on Android it appears in the share menu: share a paper's page, or an arXiv
  or DOI link, to Lightkone and it is added. Share a downloaded PDF (from
  Files or Chrome's Downloads) and the paper is added with its PDF. A page
  saved with Chrome's Download (an .mhtml file) is added as a saved web page.

On a computer, drop PDF files or saved pages on Lightkone to add them, or drag the **+ Lightkone** button from the Add panel to the
bookmarks bar. Clicked on a paper's page, it adds that paper; on any other page,
it saves the page as you see it, which works for sites that turn Lightkone's
page reader away. The same bookmark works in Chrome on a phone: Add papers has
the steps and a button to copy its address.

## Shared libraries

A shared library lives where a group can reach it: a private GitHub
repository with collaborators, or a bucket whose keys you hand out. It is
opened next to your own library. Who may read and who may write is decided
there, so Lightkone needs no accounts.

1. Open **Shared libraries** (side bar, *Organize*).
2. **Join or start another**: give it a name, choose where it lives, and give
   your own token or key for it. An empty repository or bucket starts a new
   shared library; one that already holds a Lightkone library is joined.
3. Press the invite button to copy a link. The link carries where the library
   lives, never your token or key. Whoever opens it adds their own.

Set **Your name** in the same panel, so papers you add to a shared library
show who added them. With a read-only token, the library opens read only.
In a paper's details, **Copy to…** copies a paper, with its PDF, between your
library and a shared one.
