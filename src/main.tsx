import { render } from "preact";
import { registerBuiltins } from "./plugins";
import { App } from "./app";
import "./styles.css";

registerBuiltins();
render(<App />, document.getElementById("app")!);

// The service worker (at the site's root, above app/) lets the installed app open offline; only in built releases.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("../sw.js").catch(() => {}));
}
