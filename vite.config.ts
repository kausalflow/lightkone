import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { docsSite } from "./scripts/docs";

// base "./" keeps the build portable: the same dist/ works on a domain root,
// a sub-path, an S3/R2 bucket website or a static file server.
export default defineConfig({
  base: "./",
  plugins: [preact(), docsSite()],
  test: { environment: "node" },
});
