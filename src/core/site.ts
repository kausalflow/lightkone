// The app lives one folder below the site (<site>/app/), next to the landing
// page and the docs; the site's own services sit at <site>/api/ and <site>/mcp/.
// So a service path is taken from the folder above the app, wherever the site is
// hosted (a domain root or a sub-path). Outside a browser, paths stay as given.

export function site(path: string): string {
  if (typeof location === "undefined" || /^[a-z]+:/i.test(path)) return path;
  return new URL(path, new URL("../", location.href)).href;
}
