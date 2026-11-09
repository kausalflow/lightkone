import { savedLabel } from "./core/answers";

/** Under an answer shown from the library: when Claude gave it, and a way to ask afresh. */
export function SavedNote(props: { at: string; again?: string; disabled?: boolean; onAgain?(): void; /** In place of the usual sentence. */ text?: string }) {
  return (
    <p class="saved-note muted small" role="status">
      {props.text ?? `Same request as before: the answer ${savedLabel(props.at)}, so Claude was not asked again.`}
      {props.onAgain && (
        <>
          {" "}
          <button class="link small" disabled={props.disabled} onClick={props.onAgain}>{props.again ?? "Ask again"}</button>
        </>
      )}
    </p>
  );
}
