# Moving from Paperpile

This page takes a Paperpile library, with its folders, labels and PDFs, into
Lightkone. Plan for about an hour for a library of a few thousand papers,
most of it waiting for PDFs to copy.

## What comes over

| In Paperpile | In Lightkone |
| --- | --- |
| Papers and their details (title, authors, journal, DOI, arXiv id, abstract, the rest of the BibTeX fields) | Papers, with every field kept. Unknown fields go out again unchanged in exported BibTeX. |
| Citation keys | Kept as they are. Lightkone never changes a key once given, so your LaTeX keeps compiling. |
| Labels | Tags. Paperpile writes labels into the BibTeX `keywords` field, and Lightkone reads that field as tags. |
| Folders | Folders, with the same nesting, read from where Paperpile filed each PDF in Google Drive. |
| PDFs in Google Drive | PDFs in your Lightkone storage, in the same layout and with the same file names. |
| Starred papers | Not in BibTeX, so they don't come over. Star them again in Lightkone. |
| Highlights and notes made in Paperpile's viewer | Not in BibTeX either. Highlights that Paperpile saved into the PDF file itself still show in any PDF viewer, but Lightkone's highlights start fresh. |

A paper that sits in several of your .bib files (say, in both a "Thesis" and
a "Machine learning" export) is added once. Lightkone matches papers by DOI,
arXiv id and title, and merges their tags and folders.

## Before you start: pick where the library will live

Decide this first, because the library is easiest to fill once in its final
home. Lightkone does not yet move a whole library from one storage to another.
You can export a .bib and import it elsewhere, but notes and highlights stay
behind.

- **This browser only** is fine for a first look, but it can't take a folder
  of PDFs in one go and lives on one device. Don't migrate a real library
  into it.
- **Cloudflare R2** is what most people should pick: free up to 10 GB, fast
  and cheap beyond that, and it works on every device.
- **AWS S3 or MinIO** are the same as R2 from Lightkone's side. Use them if
  your institution already runs them.
- **A private GitHub repository** keeps the full history of every change and
  is the easiest way to keep Paperpile and Lightkone in step while you switch
  (see [Keeping Paperpile running while you switch](#keeping-paperpile-running-while-you-switch)).
  GitHub limits file and repository size, though, so a large PDF collection is
  better in a bucket.

[Where your library lives](STORAGE.md) explains each one and how to set it up.
Set your storage up and save it in **Settings** before step 3.

## Step 1: get your BibTeX out of Paperpile

Pick one of these two ways.

**Once, by hand.** In Paperpile, select all papers (open *All Papers*, then
press Ctrl+A or ⌘A), then **Export → BibTeX**, and save the .bib file. A
large library may take a moment to export.

**Kept up to date, automatically.** Click your profile picture at the top
right → **Workflows and Integrations** → add a **BibTeX Export** workflow.
Choose what to export (your whole library, a folder or a label), then where
to: Google Drive, GitHub, or a link. Choose **GitHub** if you will use GitHub
storage (see the section on keeping Paperpile running). You can add several
workflows, for example one per top-level folder. Lightkone merges them.

Check **Settings → BibTeX** in Paperpile, because it decides what the
export contains. Keep abstracts in: Lightkone uses them for search, Ask and
New on arXiv. The `file` field must be included, because it is how each
paper finds its PDF and its folders.

A line like this in the .bib means it is all there:

```bibtex
file = {All Papers/MLDS/MachineLearning/Wager et al. 2013 - Dropout training as adaptive regularization.pdf},
```

## Step 2: understand where Paperpile keeps your PDFs

Paperpile stores PDFs in your Google Drive, in **My Drive → Paperpile →
All Papers**. Inside it:

- papers you never put in a folder are filed by first author, in a folder
  named after the surname in capitals: `All Papers/HINTON/Hinton et al. 2012 - Improving neural networks ....pdf`;
- papers in your own folders sit in those folders:
  `All Papers/MLDS/MachineLearning/NeuralNetworks/....pdf`.

Lightkone keeps PDFs in exactly the same layout, under a folder called
`papers/` in your storage: `papers/All Papers/HINTON/...`. So the move is one
copy of the *All Papers* folder, with nothing renamed, and each paper's `file`
field then points at its PDF.

Lightkone makes folders from the second kind of path
(`MLDS/MachineLearning/NeuralNetworks`) and skips the author folders, which
are not folders you made. The sibling folders *Starred Papers* and *Trashed
Papers* in Drive hold only shortcuts and old files. Don't copy them.

If Paperpile's Drive sync is off (**Settings → Data and files** in Paperpile),
turn it on and wait for it to finish first. Otherwise the folder in Drive is
incomplete.

## Step 3: copy the PDFs into your storage

The steps depend on your storage. For buckets, the tool is
[rclone](https://rclone.org/install/), which copies between Google Drive and
almost anything else, can be stopped and resumed, and only copies what is new
when run again. Install it on your computer first.

### Cloudflare R2

1. Set up the bucket, token and CORS rule as in [Cloudflare R2](STORAGE.md#cloudflare-r2),
   and save it in Lightkone's Settings.
2. Connect rclone to Google Drive (read-only) and to R2. The first command
   opens a browser to sign in to Google.

   ```sh
   rclone config create gdrive drive scope drive.readonly
   rclone config create r2 s3 provider Cloudflare \
     access_key_id <access key id> secret_access_key <secret access key> \
     endpoint https://<account id>.r2.cloudflarestorage.com
   ```

3. Check that rclone sees the folder, then copy it:

   ```sh
   rclone lsd "gdrive:Paperpile"
   rclone copy "gdrive:Paperpile/All Papers" "r2:<bucket>/papers/All Papers" --progress --transfers 8
   ```

   If you set **Folder in the bucket** in Lightkone's settings (say `lab`), put
   it in front: `r2:<bucket>/lab/papers/All Papers`.

4. Check the result: `rclone size "r2:<bucket>/papers"` should be close to
   `rclone size "gdrive:Paperpile/All Papers"`.

### AWS S3

The same as R2, with an AWS remote. Use an IAM user whose policy allows
`s3:ListBucket`, `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on this
bucket only.

```sh
rclone config create s3 s3 provider AWS \
  access_key_id <access key id> secret_access_key <secret access key> region <region, e.g. eu-central-1>
rclone copy "gdrive:Paperpile/All Papers" "s3:<bucket>/papers/All Papers" --progress --transfers 8
```

If you already use the AWS CLI, `aws s3 sync "<local copy of All Papers>"
"s3://<bucket>/papers/All Papers"` does the same from a local copy.

### MinIO or another S3-compatible store

```sh
rclone config create minio s3 provider Minio \
  access_key_id <access key id> secret_access_key <secret access key> endpoint https://minio.example.org
rclone copy "gdrive:Paperpile/All Papers" "minio:<bucket>/papers/All Papers" --progress --transfers 8
```

### A private GitHub repository

GitHub has no direct copy from Drive, so the PDFs go through your computer:

1. Download *All Papers*. Either use `rclone copy "gdrive:Paperpile/All Papers"
   "./All Papers"`, or right-click the folder at drive.google.com and choose
   **Download**. Drive sends large folders as several zip files; unzip them
   all into one *All Papers* folder.
2. Clone the repository you set up for Lightkone, and move the folder in:

   ```sh
   git clone https://github.com/<owner>/<repo>.git
   mkdir -p <repo>/papers
   mv "All Papers" <repo>/papers/
   cd <repo>
   git add papers
   git commit -m "PDFs from Paperpile"
   git push
   ```

Mind GitHub's limits. A single file over 100 MB is refused, so find any with
`find "papers/All Papers" -size +100M` and leave them out. GitHub also asks
that repositories stay under about 5 GB, so check yours with `du -sh "papers"`
before pushing. If it is larger, a bucket is the better home for the PDFs.

### This browser only

A browser library can't take a folder of PDFs. Lightkone downloads free
copies itself (arXiv, and open-access papers through Unpaywall once you give
a contact email under **Settings → PDFs**), and **Attach PDF** on a paper adds
one file at a time. For a real library, choose one of the storages above.

## Step 4: import the BibTeX

1. Open Lightkone, with your storage chosen and saved in Settings.
2. **Add paper → Import a .bib file**, and pick the file from step 1. Repeat
   for each .bib if you have several.
3. Reload the page. Lightkone then looks through `papers/` and links each
   paper to its PDF. The status line at the bottom of the side bar says how
   many PDFs were linked and how many papers were put in folders.

Linking matches the `file` path first, then the file name alone, so a PDF
still links when it sits one folder off. A big import doesn't fetch free
PDFs on its own (only imports of up to 20 papers do). Use **Get free PDF** on
any paper still missing one.

## Step 5: check and tidy

- Search `no:pdf` to list the papers whose PDF didn't link, and use
  **Attach PDF** or **Get free PDF** on them. Usually these are papers that
  never had a PDF in Paperpile, or whose file was renamed in Drive.
- Open a few folders in the side bar and compare them with Paperpile.
- Run **Tidy up** once. It finds the same paper entered twice and arXiv
  preprints that have since been published, and fills in the journal, DOI and
  pages, keeping your citation keys.
- When the list says some PDFs haven't been read for search yet, press
  **Read them now**, so full-text search and Ask can see inside your papers.
  Papers you open in the reader are read on their own.

## Keeping Paperpile running while you switch

If you use GitHub storage, Lightkone can pick up what you still add in
Paperpile:

1. In Paperpile, add a **BibTeX Export** workflow to GitHub, writing into a
   folder of your Lightkone repository, for example `paperpile/`.
2. In Lightkone's **Settings**, under *Private GitHub repository*, set
   **Folder of .bib files to import** to `paperpile`.

Each time Lightkone opens, it reads every .bib in that folder and adds the
papers it doesn't have yet. Papers already there are left as you changed them
in Lightkone. PDFs Paperpile files after the first copy can be copied again
the same way: rclone, or git, only adds what is new.

With a bucket, re-import the newest export from time to time, and re-run the
same `rclone copy`. Both only add what is new.

## After the move

- Overleaf and LaTeX: see [Writing with your library](WRITING.md) for keeping
  a .bib in a GitHub repository in step with a folder, the way Paperpile's
  Overleaf export did.
- Other devices: open the same Lightkone site there and use **Settings →
  Backup → Export settings** here and **Import settings** there (with a
  passphrase, the file is encrypted), so you don't type keys twice.
- Lightkone doesn't touch your Google Drive or Paperpile. Keep them as long as
  you like.
