function basename(p: string): string {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : p;
}

function fileUrlToNativePath(href: string): string | null {
  try {
    const u = new URL(href.trim());
    if (u.protocol !== 'file:') return null;
    const plat = window.electronAPI.platform;
    let pathname = decodeURIComponent(u.pathname);
    if (plat === 'win32') {
      if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
      return pathname.replace(/\//g, '\\');
    }
    return pathname;
  } catch {
    return null;
  }
}

function firstFileUrlFromLines(blob: string): string | null {
  for (const line of blob.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const head = t.split('#')[0]?.trim() ?? t;
    if (head.startsWith('file:')) return head;
  }
  return null;
}

function pathFromFileLike(file: File, isAllowedName: (name: string) => boolean): string | null {
  if (!isAllowedName(file.name)) return null;
  const extended = file as File & { path?: string };
  if (typeof extended.path === 'string' && extended.path.length > 0) return extended.path;
  try {
    const p = window.electronAPI.getPathForFile(file);
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

function tryPathFromFileUrlString(href: string, isAllowedName: (name: string) => boolean): string | null {
  const p = fileUrlToNativePath(href);
  if (p && isAllowedName(basename(p))) return p;
  return null;
}

function tryNativePathString(raw: string, isAllowedName: (name: string) => boolean): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith('file:')) return tryPathFromFileUrlString(t, isAllowedName);
  if (t.startsWith('/') && isAllowedName(basename(t))) return t;
  if (/^[a-zA-Z]:[\\/]/.test(t) && isAllowedName(basename(t))) return t;
  return null;
}

export function resolveDroppedFilePath(
  e: { dataTransfer: DataTransfer | null },
  isAllowedName: (name: string) => boolean,
): string | null {
  const dt = e.dataTransfer;
  if (!dt) return null;

  const f0 = dt.files[0];
  if (f0) {
    const p = pathFromFileLike(f0, isAllowedName);
    if (p) return p;
  }

  const chunks: string[] = [];
  const push = (s: string) => {
    if (s) chunks.push(s);
  };
  push(dt.getData('text/uri-list'));
  push(dt.getData('text/plain'));

  for (const type of dt.types) {
    if (type === 'text/uri-list' || type === 'text/plain') continue;
    try {
      const data = dt.getData(type);
      if (!data || data.length > 65536) continue;
      push(data);
    } catch {
      /* invalid type for getData in some hosts */
    }
  }

  for (const blob of chunks) {
    const href = firstFileUrlFromLines(blob) ?? (blob.trim().startsWith('file:') ? blob.trim() : null);
    if (href) {
      const p = tryPathFromFileUrlString(href, isAllowedName);
      if (p) return p;
    }
  }

  for (const blob of chunks) {
    for (const line of blob.split(/\r?\n/)) {
      const p = tryNativePathString(line, isAllowedName);
      if (p) return p;
    }
  }

  return null;
}
