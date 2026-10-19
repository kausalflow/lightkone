import { useEffect, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

interface Step {
  icon: IconName;
  title: string;
  body: preact.ComponentChildren;
}

/** A few cards on first use: what Lightkone is, and how to start. Help reopens it. */
export function Welcome(props: { hasDemo: boolean; onOpenDemo(): void; onAdd(): void; onHelp(): void; onClose(): void }) {
  const [at, setAt] = useState(0);
  const steps: Step[] = [
    {
      icon: "library",
      title: "Welcome to Lightkone",
      body: (
        <>
          <p>A reference manager that runs in your browser: your papers, PDFs, highlights and notes, kept in storage you choose.</p>
          <p class="muted">There is no account to make. Nothing leaves this browser until you connect a service yourself.</p>
        </>
      ),
    },
    props.hasDemo
      ? {
          icon: "file",
          title: "Try the example paper",
          body: (
            <>
              <p>
                Your library starts with one paper to try things on, <em>Transformer models: an introduction and catalog</em>. Open it, press{" "}
                <strong>Read</strong>, and select text to highlight it or add a note.
              </p>
              <p class="muted">It is tagged Example. Remove it whenever you like; it won't come back.</p>
            </>
          ),
        }
      : null,
    {
      icon: "plus",
      title: "Add your papers",
      body: (
        <>
          <p>
            <strong>Add paper</strong> takes a DOI, an arXiv id, a link or a title. Free PDFs are fetched for you.
          </p>
          <p>To bring a whole library, import a .bib from Paperpile, Zotero or Mendeley in the same place.</p>
        </>
      ),
    },
    {
      icon: "cloud",
      title: "Choose where it lives",
      body: (
        <>
          <p>For now your library is in this browser. To see it on every device, open Settings and keep it in an S3 or R2 bucket, or in a private GitHub repository.</p>
          <p class="muted">Ask and Explain use your own Claude key, also set in Settings.</p>
        </>
      ),
    },
    {
      icon: "command",
      title: "Find anything",
      body: (
        <>
          <p>
            Press <kbd>{MOD}</kbd> <kbd>K</kbd>, or the ⌘ button at the top, to jump to any tool, folder, tag or paper.
          </p>
          <p>
            Help is always one tap away: the round ? button at the top, or <kbd>?</kbd> on a keyboard.
          </p>
        </>
      ),
    },
  ].filter(Boolean) as Step[];
  const step = steps[at];
  const last = at === steps.length - 1;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowRight") setAt((i) => Math.min(steps.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setAt((i) => Math.max(0, i - 1));
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [steps.length]);

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel welcome" role="dialog" aria-label="Welcome" aria-describedby="welcome-body">
        <div class="welcome-icon">
          <Icon name={step.icon} size={26} />
        </div>
        <h2>{step.title}</h2>
        <div class="welcome-body" id="welcome-body">
          {step.body}
        </div>
        <div class="welcome-dots" aria-label={`Step ${at + 1} of ${steps.length}`}>
          {steps.map((s, i) => (
            <button key={s.title} class={i === at ? "on" : ""} aria-label={`Step ${i + 1}: ${s.title}`} onClick={() => setAt(i)} />
          ))}
        </div>
        <div class="row welcome-buttons">
          {at > 0 ? <button onClick={() => setAt(at - 1)}>Back</button> : <button class="ghost" onClick={props.onClose}>Skip</button>}
          <span class="welcome-gap" />
          {!last && (
            <button class="primary" onClick={() => setAt(at + 1)}>
              Next
            </button>
          )}
          {last && <button onClick={props.onHelp}>Open Help</button>}
          {last && props.hasDemo && (
            <button class="primary" onClick={props.onOpenDemo}>
              Open the example
            </button>
          )}
          {last && !props.hasDemo && (
            <button class="primary" onClick={props.onAdd}>
              Add a paper
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
