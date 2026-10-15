import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { emptyHeaderFooter } from "../pagination/headerFooter";
import { DEFAULT_PAGE, type AppState, type Preferences, type ThemeMode } from "./types";

const STORAGE_KEY = "loma:settings";
export const UNTITLED = "Document sans titre";

const defaultPrefs: Preferences = { fontFamily: "Inter", fontSizePt: 11, autosave: true };

type Persisted = Pick<AppState, "theme" | "prefs" | "ruler" | "navPane" | "textBounds">;

function loadPersisted(): Partial<Persisted> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Persisted>;
  } catch {
    return {};
  }
}

function initialState(): AppState {
  const saved = loadPersisted();
  return {
    theme: saved.theme ?? "light",
    view: "backstage",
    tab: "home",
    ribbonCollapsed: false,
    zoom: 100,
    navPane: saved.navPane ?? true,
    ruler: saved.ruler ?? true,
    marks: false,
    bookmarks: true,
    textBounds: saved.textBounds ?? true,
    spellcheck: true,
    page: DEFAULT_PAGE,
    headerFooter: emptyHeaderFooter(),
    docStyles: {},
    watermark: null,
    styleTarget: "h1",
    hfKind: "header",
    equationPos: null,
    prefs: { ...defaultPrefs, ...saved.prefs },
    doc: { title: UNTITLED, path: null, dirty: false, format: "docx", lossy: [] },
    dialog: null,
    find: { open: false, replace: false, nonce: 0 },
    painter: null,
    importReport: null,
    pendingAction: null,
    toast: null,
    docRevision: 0,
  };
}

type Patch = Partial<AppState> | ((s: AppState) => Partial<AppState>);

interface Store {
  state: AppState;
  set: (patch: Patch) => void;
  notify: (message: string, kind?: "info" | "error") => void;
}

const StoreContext = createContext<Store | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    (s: AppState, patch: Patch) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) }),
    undefined,
    initialState,
  );
  const toastId = useRef(0);

  const set = useCallback((patch: Patch) => dispatch(patch), []);
  const notify = useCallback((message: string, kind: "info" | "error" = "info") => {
    dispatch({ toast: { id: ++toastId.current, message, kind } });
  }, []);

  // Persist user settings.
  useEffect(() => {
    const data: Persisted = { theme: state.theme, prefs: state.prefs, ruler: state.ruler, navPane: state.navPane, textBounds: state.textBounds };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: settings are simply not remembered */
    }
  }, [state.theme, state.prefs, state.ruler, state.navPane, state.textBounds]);

  // Resolve the theme (including "system") onto <html data-theme>.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = state.theme === "system" ? (mq.matches ? "dark" : "light") : state.theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [state.theme]);

  // End-to-end tests read the app state through this hook; it does not exist in production builds.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __lomaState?: AppState }).__lomaState = state;
  }, [state]);

  const value = useMemo(() => ({ state, set, notify }), [state, set, notify]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useApp must be used inside AppStoreProvider");
  return ctx;
}

export const THEME_LABELS: Record<ThemeMode, string> = { light: "Clair", dark: "Sombre", system: "Système" };
