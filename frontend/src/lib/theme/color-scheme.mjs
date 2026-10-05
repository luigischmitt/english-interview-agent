/**
 * Light/dark mode resolution. Pure logic shared by the pre-paint bootstrap script and the toggle.
 * The stored value is a preference ("light" | "dark" | "system"); the applied value is a scheme ("light" | "dark").
 */
export const COLOR_SCHEME_STORAGE_KEY = "eia:color-scheme";
export const COLOR_PREFERENCES = ["light", "dark", "system"];
/** The site opens in light mode until the user picks Escuro or Sistema. */
export const DEFAULT_COLOR_PREFERENCE = "light";

/** Anything that is not a known preference (null, tampered, old value) means the default (light). */
export function parseColorPreference(stored) {
  return COLOR_PREFERENCES.includes(stored) ? stored : DEFAULT_COLOR_PREFERENCE;
}

/** Preference + OS setting -> the scheme to apply. */
export function resolveColorScheme(preference, systemPrefersDark) {
  const parsed = parseColorPreference(preference);
  if (parsed === "system") return systemPrefersDark ? "dark" : "light";
  return parsed;
}

/** DaisyUI theme name that goes with a scheme. */
export function daisyThemeFor(scheme) {
  return scheme === "dark" ? "interview-dark" : "interview-light";
}

/** Reads the stored preference; storage can throw (private mode, blocked site data). */
export function readStoredPreference(storage) {
  try {
    return parseColorPreference(storage?.getItem(COLOR_SCHEME_STORAGE_KEY));
  } catch {
    return DEFAULT_COLOR_PREFERENCE;
  }
}

/** Persists a preference (including "system", which differs from the light default). Returns false if storage is unavailable. */
export function writeStoredPreference(storage, preference) {
  try {
    storage.setItem(COLOR_SCHEME_STORAGE_KEY, parseColorPreference(preference));
    return true;
  } catch {
    return false;
  }
}

/** Applies a scheme to <html>: attribute, DaisyUI theme and native color-scheme (scrollbars, form controls). */
export function applyColorScheme(root, scheme) {
  root.setAttribute("data-color-scheme", scheme);
  root.setAttribute("data-theme", daisyThemeFor(scheme));
  root.style.colorScheme = scheme;
}

/**
 * Inline script that runs while the HTML is parsed (before first paint). It must stay self-contained and
 * mirror resolveColorScheme; tests execute it in a sandbox against the pure functions.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var p="light";try{var s=localStorage.getItem(${JSON.stringify(COLOR_SCHEME_STORAGE_KEY)});if(s==="light"||s==="dark"||s==="system")p=s}catch(e){}var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var c=d?"dark":"light",r=document.documentElement;r.setAttribute("data-color-scheme",c);r.setAttribute("data-theme",d?"interview-dark":"interview-light");r.style.colorScheme=c}catch(e){}})();`;
