export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
  /** Real format of the file; older entries derive it from the extension. */
  format?: string;
}

const KEY = "loma:recent";
const MAX = 12;

export function loadRecent(): RecentFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentFile[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function rememberRecent(path: string, name: string, format: string): RecentFile[] {
  const next = [{ path, name, openedAt: Date.now(), format }, ...loadRecent().filter((r) => r.path !== path)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function forgetRecent(path: string): RecentFile[] {
  const next = loadRecent().filter((r) => r.path !== path);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
