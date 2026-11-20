"use client";
// The language picker: each language in its own words. Choosing one saves it in a cookie and reloads,
// so the server renders the page in that language (lib/i18n/client.tsx).
import { setLocale, useT } from "@/lib/i18n/client";
import { LOCALE_NAMES, LOCALES } from "@/lib/i18n/locales";
import { IconChevronDown } from "./icons";
import { cx, Menu, MenuItem } from "./ui";

function Globe({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5Z" />
    </svg>
  );
}

/** `compact`: on a phone only the globe shows (the language's name is still in the label), for tight headers. */
export function LanguageMenu({ align = "start", side = "top", compact = false, className }: { align?: "start" | "end"; side?: "top" | "bottom"; compact?: boolean; className?: string }) {
  const { t, locale } = useT();
  return (
    <Menu label={t("Language")} align={align} side={side} width={180} trigger={(props) => (
      <button {...props} aria-label={`${t("Language")}: ${LOCALE_NAMES[locale]}`}
        className={cx("inline-flex h-7 items-center gap-1.5 rounded-control px-2 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink", className)}>
        <Globe className="size-3.5" /><span className={cx(compact && "max-sm:hidden")}>{LOCALE_NAMES[locale]}</span><IconChevronDown className={cx("size-3", compact && "max-sm:hidden")} />
      </button>
    )}>
      {LOCALES.map((code) => (
        <MenuItem key={code} checked={code === locale} onSelect={() => { if (code !== locale) setLocale(code); }}>
          <span lang={code}>{LOCALE_NAMES[code]}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}
