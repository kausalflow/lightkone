export function builtFiles(dir?: string): string[];
export function fingerprints(dir?: string): string;
export function verify(site: string, dir?: string, fetchFile?: (url: string) => Promise<Buffer>): Promise<string[]>;
