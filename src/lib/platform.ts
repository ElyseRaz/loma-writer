/** True when running inside the Tauri webview (false in a plain browser, e.g. `vite dev`). */
export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
