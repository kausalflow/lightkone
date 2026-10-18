import type { LightkonePlugin, Lookup, PaperAction, StorageProvider, Importer } from "./types";

// Every capability (storage, lookups, importers, paper actions) arrives through
// a plugin, including the built-in ones, so outside plugins are first-class.
const plugins = new Map<string, LightkonePlugin>();

export function register(plugin: LightkonePlugin): void {
  if (!plugin?.id || !plugin.name) throw new Error("A plugin needs an id and a name.");
  plugins.set(plugin.id, plugin);
}

export function unregister(id: string): void {
  plugins.delete(id);
}

export const allPlugins = (): LightkonePlugin[] => [...plugins.values()];
export const storageProviders = (): StorageProvider[] => allPlugins().flatMap((p) => p.storage ?? []);
export const lookups = (): Lookup[] => allPlugins().flatMap((p) => p.lookups ?? []);
export const importers = (): Importer[] => allPlugins().flatMap((p) => p.importers ?? []);
export const actions = (): (PaperAction & { plugin: string })[] =>
  allPlugins().flatMap((p) => (p.actions ?? []).map((a) => ({ ...a, plugin: p.id })));

/**
 * Loads a plugin from a URL. The module's default export is a LightkonePlugin
 * or a function returning one. Plugins run with full page access, so only
 * load code you trust.
 */
export async function loadPluginFromUrl(url: string): Promise<LightkonePlugin> {
  const mod = await import(/* @vite-ignore */ url);
  const exported = mod.default ?? mod.plugin;
  const plugin: LightkonePlugin = typeof exported === "function" ? await exported() : exported;
  register(plugin);
  return plugin;
}
