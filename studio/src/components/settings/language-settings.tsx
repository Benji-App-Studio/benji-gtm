"use client";
// Settings › Language: the language the app speaks, saved to the account (so it follows the person to
// another browser) and to this browser's cookie, which every page renders from.
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/locales";
import { saveLocale } from "../nav/sidebar";
import { cx, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { SettingsPage } from "./settings-ui";

export function LanguageSettings() {
  const { t, locale } = useT();
  const [saving, setSaving] = useState<Locale | null>(null);
  const choose = (code: Locale) => {
    if (code === locale || saving) return;
    setSaving(code);
    void saveLocale(code);
  };
  return (
    <SettingsPage page="language">
      <SettingsGroup>
        <SettingsRow label={t("Language")} description={t("Menus, pages and messages. Your competitors' ads and your own copy stay in the language they were written in.")}
          below={
            <div role="radiogroup" aria-label={t("Language")} className="mt-3 grid gap-1.5 @sm:grid-cols-2">
              {LOCALES.map((code) => (
                <button key={code} type="button" role="radio" aria-checked={code === locale} onClick={() => choose(code)} disabled={Boolean(saving)}
                  className={cx("flex h-9 items-center justify-between gap-2 rounded-control border px-3 text-left text-sm transition-colors disabled:opacity-60",
                    code === locale ? "border-accent/50 bg-accent-soft text-ink" : "border-hairline bg-raised text-label hover:bg-hover hover:text-ink")}>
                  <span lang={code}>{LOCALE_NAMES[code]}</span>
                  {saving === code ? <Spinner className="size-3.5" /> : code === locale ? <span aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
                </button>
              ))}
            </div>
          } />
      </SettingsGroup>
    </SettingsPage>
  );
}
