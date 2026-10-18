import { render } from "preact";
import { registerBuiltins } from "./plugins";
import { App } from "./app";
import "./styles.css";

registerBuiltins();
render(<App />, document.getElementById("app")!);
