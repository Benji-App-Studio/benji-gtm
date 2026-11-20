"use client";
// Settings pieces for accounts mode (a database that hosts separate accounts, each with its own keys,
// storage and plan): the "Plan & usage" panel, and the note shown instead of a page an account doesn't
// have (Members; Updates and the Desktop runner for anyone but staff). Paid plans come later: the
// upgrade buttons are there, disabled, saying "Coming soon".
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { planName } from "@/lib/install/plan-name";
import { sentenceGap } from "../rich";
import type { InstallState, PlanState } from "@/lib/install/types";
import { useInstall } from "@/lib/install/use-install";
import { formatBytes } from "@/lib/storage-usage";
import { IconLock } from "../icons";
import { Badge, Button, cx, SettingsGroup, SettingsRow } from "../ui";
import { pageVisible, type SettingsPageKey } from "./pages";
import { SettingsRowsSkeleton } from "./settings-ui";

/** used / max as a share for the small bars (0 to 1; 0 when nothing is allowed). */
export const share = (used: number, max: number) => (max > 0 ? Math.min(1, Math.max(0, used / max)) : 0);

function Meter({ used, max, label, text }: { used: number; max: number; label: string; text: string }) {
  const ratio = share(used, max);
  const tone = ratio >= 1 ? "bg-warn" : ratio >= 0.8 ? "bg-caution" : "bg-accent";
  return (
    <div className="grid w-full gap-1.5 sm:w-56">
      <span className="text-right text-sm text-ink tabular-nums">{text}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-control" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <div className={cx("h-full rounded-full", tone)} style={{ width: `${Math.max(used > 0 ? 2 : 0, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

/** Settings > General in accounts mode: the plan, what it allows and what is used, and the upgrade buttons (coming soon). */
export function PlanUsage({ install }: { install: InstallState }) {
  const { t } = useT();
  const plan: PlanState | null | undefined = install.plan;
  if (install.mode !== "accounts" || !plan) return null;
  const storageCap = plan.limits.storageGb * 1e9;
  return (
    <SettingsGroup
      title={t("Plan & usage")}
      description={t("What your plan includes and how much of it is used. Generations count from the first of the month.")}
      action={<span className="flex items-center gap-2"><Badge tone="accent">{planName(plan, t)}</Badge>{plan.staff && plan.id !== "staff" && <Badge>{t("Staff")}</Badge>}</span>}>
      <SettingsRow label={t("Apps")} description={t("Each app has its own research, creatives and connections.")}>
        <Meter used={plan.usage.apps} max={plan.limits.maxApps} label={t("Apps")} text={t("{used} of {max}", { used: plan.usage.apps, max: plan.limits.maxApps })} />
      </SettingsRow>
      <SettingsRow label={t("Storage")} description={t("Saved ad media, generated creatives and your uploads.")}>
        <Meter used={plan.usage.storageBytes} max={storageCap} label={t("Storage")} text={t("{used} of {max}", { used: formatBytes(plan.usage.storageBytes), max: formatBytes(storageCap) })} />
      </SettingsRow>
      <SettingsRow label={t("Generations this month")} description={t("Images and videos made in the Studio.")}>
        <Meter used={plan.usage.generationsThisMonth} max={plan.limits.monthlyGenerations} label={t("Generations this month")} text={t("{used} of {max}", { used: plan.usage.generationsThisMonth, max: plan.limits.monthlyGenerations })} />
      </SettingsRow>
      {plan.platform && (
        <SettingsRow label={t("Whole platform (staff only)")} description={t("Every account's files against the project's safety limit. Each account's plan is the real limit.")}>
          <Meter used={plan.platform.usedBytes} max={plan.platform.safetyBytes} label={t("Whole platform (staff only)")} text={t("{used} of {max}", { used: formatBytes(plan.platform.usedBytes), max: formatBytes(plan.platform.safetyBytes) })} />
        </SettingsRow>
      )}
      <SettingsRow label={t("More room")} description={t("Bigger plans and extra storage are on the way.")}>
        <span className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled title={t("Coming soon")}>{t("Get more storage")}</Button>
          <Button size="sm" disabled title={t("Coming soon")}>{t("Upgrade")}</Button>
          <span className="text-xs text-muted">{t("Coming soon")}</span>
        </span>
      </SettingsRow>
    </SettingsGroup>
  );
}

/** A settings page that accounts mode leaves out: a short note in its place (someone may still follow an old link). */
export function HiddenInAccounts({ page, children }: { page: SettingsPageKey; children: ReactNode }) {
  const { t, locale } = useT();
  const gap = sentenceGap(locale);
  const { install, loading } = useInstall();
  if (loading && !install) return <SettingsRowsSkeleton />;
  if (pageVisible(page, install)) return <>{children}</>;
  return (
    <div className="flex items-start gap-2.5 rounded-small border border-line bg-card px-3 py-2.5 text-sm">
      <IconLock className="mt-[3px] size-3.5 shrink-0 text-muted" />
      <p className="text-label"><span className="font-medium text-ink">{t("This page isn't part of your account.")}</span>{gap}{t("Your keys, storage and plan are under Settings.")}</p>
    </div>
  );
}
