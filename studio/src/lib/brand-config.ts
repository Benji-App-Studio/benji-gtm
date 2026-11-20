// The product's name, in one place. Every screen, the page title, the logo and the docs read it from
// here, so renaming the product is a change to this file only. The tagline and description are m()-marked:
// the root layout shows them in the page's language (lib/i18n).
import { m } from "./i18n/translate";

export const APP_NAME = "Benji GTM";
/** Lower-case, no spaces: file names, download names, cookie and storage keys. */
export const APP_SLUG = "benji-gtm";
export const APP_TAGLINE = m("See what's working for your competitors");
export const APP_DESCRIPTION =
  m("Track your competitors, see which ads and posts are working for them, and turn what you learn into your own creatives.");
/** The public repository people copy; guides link to files in it. */
export const REPO_URL = "https://github.com/Benji-App-Studio/benji-gtm";
/** A file in the public repository, for "full guide" links. */
export const repoFileUrl = (path: string) => `${REPO_URL}/blob/main/${path.replace(/^\/+/, "")}`;
/** Prefix for cookies and localStorage keys (kept short and stable across renames of APP_NAME). */
export const STORAGE_PREFIX = "gtm";
/**
 * Where the Help panel's "Contact" writes to. A placeholder: set your own support address before going
 * live. While it is the placeholder (or empty) the Help panel leaves Contact out.
 */
export const CONTACT_EMAIL = "support@example.com";
/** Whether an address is one to show: not empty and not a placeholder on a reserved example domain. */
export const isRealContact = (address: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()) && !/@(.+\.)?example\.(com|org|net)$/i.test(address.trim());
