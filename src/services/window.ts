import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/platform";

const win = () => (isTauri() ? getCurrentWindow() : null);

export const minimizeWindow = () => void win()?.minimize();
export const toggleMaximizeWindow = () => void win()?.toggleMaximize();
export const destroyWindow = () => void win()?.destroy();
export const setNativeTitle = (title: string) => void win()?.setTitle(title);
export const startDragging = () => void win()?.startDragging();

/** Intercepts the native close request (e.g. Alt+F4) so unsaved changes can be handled. */
export function onCloseRequested(handler: () => void): () => void {
  const w = win();
  if (!w) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  void w
    .onCloseRequested((event) => {
      event.preventDefault();
      handler();
    })
    .then((fn) => (cancelled ? fn() : (unlisten = fn)));
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export async function isMaximized(): Promise<boolean> {
  return (await win()?.isMaximized()) ?? false;
}

export function onResized(handler: () => void): () => void {
  const w = win();
  if (!w) return () => {};
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  void w.onResized(handler).then((fn) => (cancelled ? fn() : (unlisten = fn)));
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
