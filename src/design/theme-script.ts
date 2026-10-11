/**
 * Runs before first paint (inline in <head>) so there is no flash of the wrong theme.
 * Preference lives in localStorage under "kasboek-theme": system | light | dark | darkplus.
 * Sets data-theme (explicit choices only) and data-mode (light | dark, always) on <html>.
 */
export const THEME_STORAGE_KEY = "kasboek-theme";

export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var r=document.documentElement;var dark=t==="dark"||t==="darkplus"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);if(t!=="system")r.setAttribute("data-theme",t);r.setAttribute("data-mode",dark?"dark":"light")}catch(e){}})();`;
