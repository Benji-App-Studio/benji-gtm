"use client";
// Appearance: Light / Dark / System. Applies at once by swapping data-theme on <html> (every colour
// is a CSS variable), and remembers the choice in a cookie and localStorage.
import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { applyTheme, parseTheme, type Theme } from "@/lib/theme";
import { Segmented } from "./ui";

export const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: m("Light") },
  { value: "dark", label: m("Dark") },
  { value: "system", label: m("System") },
];

// The current choice is read from <html data-theme> itself, so it stays right even when a page comes
// back from the router cache with an older server render.
const subscribe = (notify: () => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const current = () => parseTheme(document.documentElement.getAttribute("data-theme"));

/** The theme in use. `initial` is what the server rendered with (the cookie's value), when the caller knows it. */
export function useTheme(initial?: Theme): Theme | undefined {
  return useSyncExternalStore<Theme | undefined>(subscribe, current, () => initial);
}

export function Appearance({ initial }: { initial: Theme }) {
  const { t } = useT();
  const theme = useTheme(initial) ?? initial;
  return <Segmented label={t("Theme")} options={THEME_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))} value={theme} onChange={applyTheme} />;
}
