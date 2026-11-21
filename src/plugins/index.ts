import { register } from "../core/plugins";
import browser from "./storage-browser";
import s3 from "./storage-s3";
import github from "./storage-github";
import lookup from "./lookup";
import related from "./related";
import claude from "./claude";
import dullaby from "./dullaby";
import pdfs from "./pdfs";
import bibsync from "./bibsync";
import health from "./health";
import ereader from "./ereader";

/** The plugins that ship with Lightkone. They use the same API as outside plugins. */
export function registerBuiltins(): void {
  [browser, s3, github, lookup, related, pdfs, health, claude, dullaby, ereader, bibsync].forEach(register);
}
