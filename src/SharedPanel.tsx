import { useState } from "preact/hooks";
import type { Settings } from "./core/settings";
import { inviteLink, newSharedId, sharedLibraries, withShared, type Invite, type SharedLibrary } from "./core/shared";
import { storageProviders } from "./core/plugins";

// Only storage a group can reach together.
const SHAREABLE = ["github", "s3"];

/** Join, start, switch to and leave shared libraries. */
export function SharedPanel(props: { settings: Settings; invite?: Invite | null; activeId: string; onSave(s: Settings): void; onName(name: string): void; onClose(): void }) {
  const list = sharedLibraries(props.settings);
  const [editing, setEditing] = useState<SharedLibrary | null>(() =>
    props.invite ? { id: newSharedId(), name: props.invite.name, provider: props.invite.provider, config: props.invite.config } : list.length ? null : { id: newSharedId(), name: "", provider: "github", config: {} },
  );
  const [copied, setCopied] = useState<string | null>(null);
  const providers = storageProviders().filter((p) => SHAREABLE.includes(p.id));
  const save = (next: SharedLibrary[], active = props.activeId) => props.onSave({ ...withShared(props.settings, next), "libraries.active": active });

  function copyInvite(l: SharedLibrary) {
    const fields = providers.find((p) => p.id === l.provider)?.fields ?? [];
    navigator.clipboard?.writeText(inviteLink(location.href, l, fields)).then(() => {
      setCopied(l.id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide shared-panel">
        <h2>Shared libraries</h2>
        <p class="muted">
          A shared library lives where your group can all reach it: a private GitHub repository, or a bucket. Who can read it and who can change it is
          set there, so nothing here needs an account. On GitHub, add people under the repository's Settings → Collaborators and give them Read or
          Write. Each person uses their own token, which stays in their own browser.
        </p>
        <label class="field">
          <span>Your name, shown on papers you add to a shared library</span>
          <input value={props.settings["profile.name"] ?? ""} placeholder="L" onInput={(e) => props.onName(e.currentTarget.value)} />
        </label>
        {props.invite && <p class="message">You were invited to <strong>{props.invite.name}</strong>. Add your own token or key below to open it.</p>}
        {list.length > 0 && (
          <ul class="shared-list">
            <li class={props.activeId === "" ? "on" : ""}>
              <div>
                <strong>My library</strong>
                <div class="small muted">Your own, as set in Settings.</div>
              </div>
              {props.activeId !== "" && <button onClick={() => save(list, "")}>Open</button>}
            </li>
            {list.map((l) => (
              <li key={l.id} class={props.activeId === l.id ? "on" : ""}>
                <div>
                  <strong>{l.name}</strong>
                  <div class="small muted">{l.provider === "github" ? `GitHub · ${l.config.repo ?? ""}` : `${l.config.bucket ?? ""} · ${l.config.endpoint ?? ""}`}</div>
                </div>
                <div class="row left">
                  {props.activeId !== l.id && <button class="primary" onClick={() => save(list, l.id)}>Open</button>}
                  <button onClick={() => copyInvite(l)} title="A link with where it lives, never your token">{copied === l.id ? "Copied" : "Copy invite link"}</button>
                  <button onClick={() => setEditing(l)}>Edit</button>
                  <button
                    class="link danger"
                    onClick={() => confirm(`Leave "${l.name}" on this device? The library itself stays where it is.`) && save(list.filter((x) => x.id !== l.id), props.activeId === l.id ? "" : props.activeId)}
                  >
                    Leave
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {editing ? (
          <form
            class="shared-form"
            onSubmit={(e) => {
              e.preventDefault();
              const next = list.some((l) => l.id === editing.id) ? list.map((l) => (l.id === editing.id ? editing : l)) : [...list, editing];
              setEditing(null);
              save(next, editing.id);
            }}
          >
            <h3>{list.some((l) => l.id === editing.id) ? `Edit ${editing.name}` : "Join or start a shared library"}</h3>
            <label class="field">
              <span>Name</span>
              <input value={editing.name} placeholder="Cosmology group" onInput={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span>Where it lives</span>
              <select value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.currentTarget.value, config: {} })}>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            {providers
              .find((p) => p.id === editing.provider)
              ?.fields.filter((f) => f.name !== "bibFolder")
              .map((f) => (
                <label key={f.name} class="field">
                  <span>{f.label}</span>
                  {(() => {
                    const value = editing.config[f.name] ?? "";
                    const onInput = (e: Event) => setEditing({ ...editing, config: { ...editing.config, [f.name]: (e.currentTarget as HTMLInputElement).value } });
                    return f.type === "password" ? (
                      <input type="password" autoComplete="off" value={value} placeholder={f.placeholder} onInput={onInput} />
                    ) : (
                      <input type="text" autoComplete="off" value={value} placeholder={f.placeholder} onInput={onInput} />
                    );
                  })()}
                  {f.help && <span class="muted small">{f.help}</span>}
                </label>
              ))}
            <p class="small muted">An empty repository or bucket starts a new shared library; one that already holds a Lightkone library is joined.</p>
            <div class="row left">
              <button class="primary" type="submit" disabled={!editing.name.trim()}>Save and open</button>
              {(list.length > 0 || props.invite) && <button type="button" onClick={() => setEditing(null)}>Cancel</button>}
            </div>
          </form>
        ) : (
          <div class="row left">
            <button onClick={() => setEditing({ id: newSharedId(), name: "", provider: "github", config: {} })}>Join or start another</button>
          </div>
        )}
        <div class="row">
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
