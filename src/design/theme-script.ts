/**
 * Runs before first paint (inline in <head>) so there is no flash of the wrong theme.
 * Preference lives in localStorage under "kasboek-theme": system | light | dark ("darkplus", a retired third theme, reads as dark).
 * Sets data-theme (explicit choices only) and data-mode (light | dark, always) on <html>, and lang from
 * the language cookie so the document language is right before the first paint.
 */
export const THEME_STORAGE_KEY = "kasboek-theme";

export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";if(t==="darkplus")t="dark";var r=document.documentElement;var dark=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);if(t!=="system")r.setAttribute("data-theme",t);r.setAttribute("data-mode",dark?"dark":"light");var l=document.cookie.match(/(?:^|; )kasboek-lang=(en|nl)/);r.setAttribute("lang",l?l[1]:"en")}catch(e){}})();`;
