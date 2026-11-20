"use client";
// A quiet bar at the top of the app when the database is behind the code (after a `git pull` or a fork
// sync, before the update is applied: install.updateNeeded). The owner gets the link to setup's Updates
// view; a member is asked to tell the owner. Nothing shows while the install loads, or when it is up to date.
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { canManage, useInstall } from "@/lib/install/use-install";
import { IconRefresh } from "../icons";

export const UPDATES_HREF = "/setup#updates";

export function UpdateBanner() {
  const { t } = useT();
  const { install } = useInstall();
  if (!install || install.updateNeeded !== true) return null;
  return (
    <div role="status" className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line bg-card px-4 py-1.5 text-xs text-label">
      <IconRefresh className="size-3.5 shrink-0 text-caution" aria-hidden />
      <span>{t("This copy has database changes to apply.")}</span>
      {canManage(install)
        ? <Link href={UPDATES_HREF} className="rounded-xs font-medium text-accent hover:underline">{t("Apply the update")}</Link>
        : <span className="text-muted">{t("Ask the owner to apply the update.")}</span>}
    </div>
  );
}
