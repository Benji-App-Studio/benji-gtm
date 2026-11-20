// The request's language on the server: the saved choice (cookie) or the browser's languages.
import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE } from "../storage-keys";
import { dictionaryFor } from "./dictionaries";
import { chooseLocale, type Locale } from "./locales";
import { translator, type Translator } from "./translate";

export async function getLocale(): Promise<Locale> {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  return chooseLocale(jar.get(LOCALE_COOKIE)?.value, head.get("accept-language"));
}

/** `t` and `tn` for a server component or route. */
export async function getTranslator(): Promise<Translator> {
  const locale = await getLocale();
  return translator(locale, dictionaryFor(locale));
}
