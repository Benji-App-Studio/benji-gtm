"use client";
// Settings → Appearance: the theme, for this device only.
import { useT } from "@/lib/i18n/client";
import type { Theme } from "@/lib/theme";
import { Appearance } from "../appearance";
import { SettingsGroup, SettingsRow } from "../ui";
import { SettingsPage } from "./settings-ui";

export function AppearanceSettings({ initial }: { initial: Theme }) {
  const { t } = useT();
  return (
    <SettingsPage page="appearance">
      <SettingsGroup>
        <SettingsRow label={t("Theme")} description={t("Light, dark, or the same as this device. It applies at once and is remembered in this browser.")}>
          <Appearance initial={initial} />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
