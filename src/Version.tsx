import { useEffect, useState } from "preact/hooks";
import { BUILD } from "./core/version";

/** Which release this copy is, and a reload when the site has a newer one (version.json, scripts/version.ts). */
export function VersionLine() {
  const [live, setLive] = useState<typeof BUILD | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD || !BUILD.commit) return;
    fetch(new URL("../version.json", location.href), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => v?.commit && v.commit !== BUILD.commit && setLive(v))
      .catch(() => {});
  }, []);
  return (
    <p class="muted small version">
      Lightkone {BUILD.label}
      {live && (
        <>
          {". "}The site now has {live.label}.{" "}
          <button type="button" class="link" onClick={() => location.reload()}>
            Reload to update
          </button>
        </>
      )}
    </p>
  );
}
