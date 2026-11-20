"use client";
// "New app": a second, third… app, in the same three steps as the first run (onboarding-flow.tsx): the app's
// link, the AI key (only when none is connected yet) and competitors. The plan's app limit is checked
// before the first step, so nobody fills in a form the database would refuse at the end. The full profile
// (stage, audience, links…) stays on the app's own App settings › Profile.
import Link from "next/link";
import { featureState } from "@/lib/capabilities";
import { useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { useInstall } from "@/lib/install/use-install";
import { ALL_APPS_HREF } from "@/lib/nav-model";
import { appLimit } from "@/lib/onboarding";
import { IconLock } from "../icons";
import { Button, ButtonLink, Card, columnClass, Page, PageHeader, Spinner } from "../ui";
import { OnboardingFlow } from "./onboarding-flow";

const PLAN_HREF = "/app/settings";

export function NewAppFlow() {
  const { t } = useT();
  const { install, loading } = useInstall();
  const [products] = useCached<ProductRow[]>("/api/products");
  const crumbs = [{ label: t("All apps"), href: ALL_APPS_HREF }, { label: t("New app") }];
  const header = <PageHeader crumbs={crumbs} title={t("New app")} />;

  // The plan and the AI key are known first: the limit before any step, and whether the key step is needed.
  if ((loading && !install) || products === undefined) {
    return (
      <Page className={columnClass}>
        {header}
        <Card className="flex items-center gap-2 p-4 text-sm text-muted" role="status"><Spinner className="size-3.5" />{t("Checking your plan…")}</Card>
      </Page>
    );
  }

  const count = Array.isArray(products) ? products.length : 0;
  const limit = appLimit(install?.plan, count);
  if (limit.reached && limit.max !== null) {
    return (
      <Page className={columnClass}>
        {header}
        <Card className="grid gap-3 p-5">
          <div className="flex items-start gap-3">
            <IconLock className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="min-w-0">
              <h1 className="text-sm font-medium text-ink">{t("Your plan has no room for another app")}</h1>
              <p className="mt-1 text-sm text-muted">{limit.max === 1
                ? t("Your plan allows 1 app. Delete an app you no longer need to add another.")
                : t("Your plan allows {n} apps. Delete an app you no longer need to add another.", { n: limit.max })}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:pl-7">
            <Button size="sm" disabled title={t("Coming soon")}>{t("Upgrade — coming soon")}</Button>
            <ButtonLink href={PLAN_HREF} size="sm" variant="secondary">{t("Settings")} › {t("General & plan")}</ButtonLink>
            <Link href={ALL_APPS_HREF} className="rounded-xs px-1 text-sm font-medium text-accent hover:underline">{t("All apps")}</Link>
          </div>
        </Card>
      </Page>
    );
  }

  const aiKeyReady = Boolean(install) && featureState("ai", install).ok;
  return (
    <Page className={columnClass}>
      {header}
      <OnboardingFlow draft={null} mode="new" aiKeyReady={aiKeyReady} className="pb-10" />
    </Page>
  );
}
