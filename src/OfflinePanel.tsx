import { useEffect, useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { OFFLINE_LIMITS, offlineLimit, setOfflineLimit, type OfflineStorage } from "./core/offline";
import { Icon } from "./icons";

// Choose which PDFs stay on this device to read without a network, for a trip
// say, within a size limit. The 25 opened last are kept as well, on their own.

export const bytesText = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(n >= 10e9 ? 0 : 1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

export function OfflinePanel(props: {
  papers: Paper[];
  inView: Paper[];
  view: string;
  storage: OfflineStorage;
  kept: Map<string, number>;
  onKeep(papers: Paper[], onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<string>;
  onRelease(paths: string[]): Promise<void>;
  onClose(): void;
}) {
  const [limit, setLimit] = useState(offlineLimit);
  const [quota, setQuota] = useState<number | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => e.quota && setQuota(e.quota)).catch(() => {});
    return () => stop.current?.abort();
  }, []);

  const used = [...props.kept.values()].reduce((a, b) => a + b, 0);
  const byPdf = new Map(props.papers.filter((p) => p.pdf).map((p) => [p.pdf!, p]));
  const shown = props.inView.filter((p) => !p.trashed);
  const toKeep = shown.filter((p) => p.pdf && !props.kept.has(p.pdf));
  const noPdf = shown.filter((p) => !p.pdf).length;
  const list = [...props.kept.entries()].map(([path, size]) => ({ path, size, paper: byPdf.get(path) })).sort((a, b) => (a.paper?.title ?? a.path).localeCompare(b.paper?.title ?? b.path));

  async function keep() {
    stop.current = new AbortController();
    setMessage(null);
    setProgress([0, toKeep.length]);
    try {
      setMessage(await props.onKeep(toKeep, (d, t) => setProgress([d, t]), stop.current.signal));
    } finally {
      setProgress(null);
      stop.current = null;
    }
  }

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && !progress && props.onClose()}>
      <div class="panel offline-panel">
        <h2>Offline papers</h2>
        <p class="muted">
          Keep PDFs on this device to read them, highlight them and take notes with no network, on a trip say. They stay until you remove them. The 25 you opened last are kept as well, on their own.
          Highlights and notes made offline are saved when you are back online.
        </p>

        <div class="offline-use">
          <div class="meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label="Space used by offline papers">
            <span style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
          </div>
          <p class="small">
            <strong>{props.kept.size} {props.kept.size === 1 ? "paper" : "papers"}</strong>, {bytesText(used)} of{" "}
            <select value={limit} aria-label="Space for offline papers" onChange={(e) => { const n = Number(e.currentTarget.value); setLimit(n); setOfflineLimit(n); }}>
              {OFFLINE_LIMITS.map((n) => <option key={n} value={n}>{bytesText(n)}</option>)}
            </select>
            {quota ? <span class="muted"> · this browser allows about {bytesText(quota)}</span> : null}
          </p>
        </div>

        <div class="row">
          <button class="primary" disabled={Boolean(progress) || !toKeep.length} onClick={keep}>
            <Icon name="download" /> {toKeep.length ? `Keep the ${toKeep.length} ${toKeep.length === 1 ? "paper" : "papers"} in ${props.view}` : `Everything in ${props.view} is kept`}
          </button>
          {progress && <button onClick={() => stop.current?.abort()}>Stop</button>}
        </div>
        <p class="muted small">
          To choose papers, close this, pick a folder, tag, Starred or a search, and come back. Or use <strong>Keep offline</strong> on a paper.
          {noPdf ? ` ${noPdf} in this view ${noPdf === 1 ? "has" : "have"} no PDF and ${noPdf === 1 ? "is" : "are"} skipped.` : ""}
        </p>
        {progress && <p class="message" role="status">Downloading {Math.min(progress[0] + 1, progress[1])} of {progress[1]}…</p>}
        {!progress && message && <p class="message" role="status">{message}</p>}

        {list.length > 0 && (
          <>
            <div class="offline-head">
              <h3>Kept on this device</h3>
              <button class="link small" disabled={Boolean(progress)} onClick={() => confirm(`Remove all ${list.length} papers from this device? They stay in your library.`) && props.onRelease(list.map((k) => k.path))}>
                Remove all
              </button>
            </div>
            <ul class="offline-list">
              {list.map((k) => (
                <li key={k.path}>
                  <span class="title">{k.paper?.title ?? k.path.split("/").pop()}</span>
                  <span class="muted small">{bytesText(k.size)}</span>
                  <button class="icon-btn" disabled={Boolean(progress)} aria-label="Remove from this device" title="Remove from this device" onClick={() => props.onRelease([k.path])}>
                    <Icon name="x" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p class="muted small">
          For the app itself to open with no network, install it from the browser menu (<strong>Install app</strong> or <strong>Add to Home Screen</strong>) and open it once before you go.
        </p>
        <div class="row">
          <button onClick={props.onClose} disabled={Boolean(progress)}>Close</button>
        </div>
      </div>
    </div>
  );
}
