import { THEME_STORAGE_KEY } from "./theme-script";

export type ThemeChoice = "system" | "light" | "dark" | "darkplus";
export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark", "darkplus"];

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return t === "light" || t === "dark" || t === "darkplus" ? t : "system";
  } catch {
    return "system";
  }
}

/** Same attributes as the inline script in theme-script.ts, applied after the user picks. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const dark =
    choice === "dark" ||
    choice === "darkplus" ||
    (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  root.setAttribute("data-mode", dark ? "dark" : "light");
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* private mode: the choice just lasts for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
}

const EVENT = "kasboek-theme-change";

/** For useSyncExternalStore: re-read when the theme changes here or in another tab. */
export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
