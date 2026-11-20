"use client";
// The page's language in the browser. The root layout gives the provider the request's language and
// that language's dictionary only; components read them with useT().
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { LOCALE_COOKIE } from "../storage-keys";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { translator, type Dictionary, type Translator } from "./translate";

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({ locale, dict, children }: { locale: Locale; dict: Dictionary | null; children: ReactNode }) {
  const value = useMemo(() => translator(locale, dict), [locale, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// English when there is no provider (a test or a page outside the root layout): never a blank screen.
const ENGLISH = translator(DEFAULT_LOCALE, null);

/** `t("Sentence")`, `tn(n, "{n} ad", "{n} ads")`, the language, and the locale for dates and numbers. */
export function useT(): Translator {
  return useContext(I18nContext) ?? ENGLISH;
}

/** Saves the choice for a year and reloads, so the server renders every page in the new language. */
export function setLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
