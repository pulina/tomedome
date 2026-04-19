import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, sep, normalize as pathNormalize } from 'node:path';
import { app } from 'electron';

const sessionAllowedRealpaths = new Set<string>();

export function addSessionAllowedReadPath(resolvedRealpath: string): void {
  sessionAllowedRealpaths.add(resolvedRealpath);
}

export async function resolveAllowedReadPath(rawPath: string): Promise<string> {
  const normalized = pathNormalize(rawPath.trim());
  const resolved = await realpath(normalized);
  if (sessionAllowedRealpaths.has(resolved)) return resolved;

  const roots = new Set<string>();
  for (const key of ['home', 'documents', 'downloads', 'desktop', 'music', 'pictures', 'videos'] as const) {
    try {
      roots.add(resolve(app.getPath(key)));
    } catch {
      /* ignore */
    }
  }
  roots.add(resolve(homedir()));

  for (const root of roots) {
    const prefix = root.endsWith(sep) ? root : root + sep;
    if (resolved === root || resolved.startsWith(prefix)) return resolved;
  }

  throw new Error('Path not allowed');
}
