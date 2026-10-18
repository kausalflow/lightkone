import { useEffect, useState } from "preact/hooks";
import type { Paper, StorageAdapter } from "./core/types";
import { annotationsPath, parseAnnotations, type Highlight } from "./core/annotations";
import { keptPart, noteName, obsidianNote, zip } from "./core/obsidian";

// Export notes to an Obsidian vault: straight into a folder where the browser
// allows it (Chrome and Edge on a computer), otherwise as a .zip to unpack there.

interface DirHandle {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{ getFile(): Promise<File>; createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
}
const picker = (globalThis as { showDirectoryPicker?: (o?: object) => Promise<DirHandle> }).showDirectoryPicker;
const decoder = new TextDecoder();

export function ObsidianPanel(props: { papers: Paper[]; inView: Paper[]; storage: StorageAdapter; onClose(): void }) {
  const [annotated, setAnnotated] = useState<Set<string> | null>(null);
  const [which, setWhich] = useState<"notes" | "view">("notes");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    props.storage
      .list("lightkone/annotations/")
      .catch(() => [] as string[])
      .then((keys) => setAnnotated(new Set(keys.filter((k) => k.endsWith(".json")).map((k) => k.slice("lightkone/annotations/".length, -5)))));
  }, [props.storage]);

  const withNotes = props.papers.filter((p) => !p.trashed && (p.notes?.trim() || annotated?.has(p.id)));
  const chosen = which === "notes" ? withNotes : props.inView.filter((p) => !p.trashed);
  const app = location.origin + location.pathname;

  async function highlightsOf(p: Paper): Promise<Highlight[]> {
    if (!annotated?.has(p.id)) return [];
    const raw = await props.storage.read(annotationsPath(p.id)).catch(() => null);
    return parseAnnotations(raw && decoder.decode(raw), p.id);
  }

  async function toFolder() {
    let dir: DirHandle;
    try {
      dir = await picker!({ id: "obsidian", mode: "readwrite" });
    } catch {
      return; // cancelled
    }
    setWorking(true);
    setMessage(null);
    let n = 0;
    try {
      for (const p of chosen) {
        const file = await dir.getFileHandle(noteName(p), { create: true });
        const before = await (await file.getFile()).text().catch(() => "");
        const w = await file.createWritable();
        await w.write(obsidianNote(p, await highlightsOf(p), app, keptPart(before)));
        await w.close();
        setMessage(`Writing notes… ${++n} of ${chosen.length}`);
      }
      setMessage(`Wrote ${n} note${n === 1 ? "" : "s"} to "${dir.name}". Your own notes below the marker line were kept.`);
    } catch (e) {
      setMessage(`Stopped after ${n}: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  }

  async function toZip() {
    setWorking(true);
    const files = [];
    for (const p of chosen) files.push({ name: noteName(p), text: obsidianNote(p, await highlightsOf(p), app) });
    const url = URL.createObjectURL(new Blob([zip(files)], { type: "application/zip" }));
    Object.assign(document.createElement("a"), { href: url, download: `lightkone-notes-${new Date().toISOString().slice(0, 10)}.zip` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`Downloaded ${files.length} note${files.length === 1 ? "" : "s"}. Unpack the .zip into your vault.`);
    setWorking(false);
  }

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel">
        <h2>Export to Obsidian</h2>
        <p class="muted">
          One note per paper, named <code>@citekey.md</code>, with its details as properties, your notes, and each highlight linked back to its page here.
          {picker ? " Export again any time: what you write below the marker line in a note is kept." : ""}
        </p>
        <div class="providers">
          <label class={`provider ${which === "notes" ? "on" : ""}`}>
            <input type="radio" name="which" checked={which === "notes"} onChange={() => setWhich("notes")} />
            <strong>Papers with highlights or notes</strong>
            <span class="muted small">{annotated ? `${withNotes.length} paper${withNotes.length === 1 ? "" : "s"}` : "Counting…"}</span>
          </label>
          <label class={`provider ${which === "view" ? "on" : ""}`}>
            <input type="radio" name="which" checked={which === "view"} onChange={() => setWhich("view")} />
            <strong>All papers in the current view</strong>
            <span class="muted small">{props.inView.filter((p) => !p.trashed).length} papers</span>
          </label>
        </div>
        {message && <p class="message" role="status">{message}</p>}
        <div class="row">
          {picker ? (
            <>
              <button class="primary" disabled={working || !chosen.length || !annotated} onClick={toFolder}>Choose vault folder…</button>
              <button disabled={working || !chosen.length || !annotated} onClick={toZip}>Download .zip</button>
            </>
          ) : (
            <button class="primary" disabled={working || !chosen.length || !annotated} onClick={toZip}>Download .zip</button>
          )}
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
