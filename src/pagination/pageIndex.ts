/** Where each block of the text starts: document position and page (0-based), sorted by position. */
export interface PageStart {
  pos: number;
  page: number;
}

/** The page (0-based) of the block that holds `pos`: the last block starting at or before it. */
export function pageIndexAt(starts: PageStart[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid].pos <= pos) { found = starts[mid].page; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
