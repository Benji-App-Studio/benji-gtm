"use client";
// The warning before an action that adds files (collect ads, save media, generate, upload): at 95% a clear
// "almost full" line with a way to free up space; at 100% the action is refused (`useStorageGuard().block`
// disables its button) with the same way out. Nothing shows below 95%.
import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { guardFor, type AddAction } from "@/lib/storage-usage";
import { useStorage } from "@/lib/use-storage";
import { cx } from "./ui";

export const STORAGE_HREF = "/app/settings/storage";

/** What to say (or refuse) before `action`; `adding` is the bytes it will add when known. */
export function useStorageGuard(action: AddAction, adding = 0) {
  const { t } = useT();
  const { summary } = useStorage();
  return guardFor(action, summary, adding, t);
}

export function StorageNotice({ action, adding = 0, className }: { action: AddAction; adding?: number; className?: string }) {
  const { t } = useT();
  const guard = useStorageGuard(action, adding);
  if (!guard.message) return null;
  return (
    <div role={guard.block ? "alert" : "status"} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-small border px-3 py-2 text-xs", guard.block ? "border-warn/30 bg-warn-soft text-ink" : "border-caution/30 bg-caution-soft text-caution-ink", className)}>
      <span className="min-w-0 flex-[1_1_240px]">{guard.message}</span>
      <Link href={STORAGE_HREF} className="shrink-0 rounded-xs font-medium text-accent hover:underline">{t("Free up space")}</Link>
    </div>
  );
}
