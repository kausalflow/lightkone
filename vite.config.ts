import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { docsSite } from "./scripts/docs";
import { versionStamp } from "./scripts/version";

// base "./" keeps the build portable: the same dist/ works on a domain root,
// a sub-path, an S3/R2 bucket website or a static file server.
export default defineConfig({
  base: "./",
  plugins: [preact(), docsSite(), versionStamp()],
  // Two pages: the landing page at the site's root, and the app at app/ (a fixed
  // address to bookmark and install). The docs are added by docsSite().
  build: { rollupOptions: { input: { landing: "index.html", app: "app/index.html" } } },
  test: { environment: "node" },
});
