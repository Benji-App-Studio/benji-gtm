// Appearance: light, dark, or follow the OS. The choice lives in a cookie (so the server renders
// <html data-theme> before the first paint, with no light flash) and in localStorage (a backup that
// restores the cookie if it is cleared).
import { cookieWrites, legacyKey, THEME_KEY, writeCookie } from "./storage-keys";

export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
/**
 * The cookie (and localStorage key) the choice is kept under. On the server read it with readCookie
 * (lib/storage-keys.ts), which also finds a choice saved under the cookie's earlier name.
 */
export const THEME_COOKIE = THEME_KEY;
export const DEFAULT_THEME: Theme = "light";

export const parseTheme = (value: string | null | undefined): Theme =>
  THEMES.includes(value as Theme) ? (value as Theme) : DEFAULT_THEME;

/**
 * Runs in <head> before the page paints. With the cookie in place it does nothing. Without it, it
 * takes the choice from localStorage, or from where it was kept under the earlier name (cookie, then
 * localStorage), applies it and writes it under the current name. What was under the earlier name is
 * then removed, so it is read once.
 */
export const THEME_RESTORE_SCRIPT = (() => {
  const old = legacyKey(THEME_KEY);
  const [keep, drop] = cookieWrites(THEME_KEY, "__THEME__").map((cookie) => JSON.stringify(cookie));
  return `(function(){try{var k=${JSON.stringify(THEME_KEY)},o=${JSON.stringify(old)};`
    + `var c=function(n){var p=document.cookie.split("; ");for(var i=0;i<p.length;i++)if(p[i].indexOf(n+"=")===0)return p[i].slice(n.length+1);return null};`
    + `var ok=function(t){return t==="light"||t==="dark"||t==="system"};`
    + `if(c(k)===null){var t=localStorage.getItem(k);`
    + `if(!ok(t)&&o){t=c(o);if(!ok(t))t=localStorage.getItem(o)}`
    + `if(ok(t)){document.documentElement.setAttribute("data-theme",t);document.cookie=${keep}.replace("__THEME__",t);localStorage.setItem(k,t)}}`
    + (old && drop ? `if(c(o)!==null)document.cookie=${drop};localStorage.removeItem(o)` : "")
    + `}catch(e){}})();`;
})();

/** Browser only: switch the page to a theme at once and remember it (cookie for the server, localStorage as a backup). */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  writeCookie(THEME_KEY, theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
    const old = legacyKey(THEME_KEY);
    if (old) localStorage.removeItem(old);
  } catch { /* storage blocked: the cookie alone remembers the choice */ }
}
