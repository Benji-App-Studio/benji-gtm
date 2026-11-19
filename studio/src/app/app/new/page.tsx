"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CompetitorForm } from "@/components/competitor-form";
import { AccountForm, CampaignForm } from "@/components/direct-forms";
import { ConnectFor, FreeRoute, useGate } from "@/components/research/gates";
import { Card, columnClass, Page, PageHeader, Spinner } from "@/components/ui";
import { IconChevronRight } from "@/components/icons";
import { useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { TYPE_COPY, type ProjectType } from "@/lib/types";

const TITLE: Record<ProjectType, string> = { competitors: "Find your competitors", account: "Analyze one account", campaign: "Analyze a brand campaign" };

function NewAnalysis() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get("type");
  const type = (["competitors", "account", "campaign"] as ProjectType[]).find((t) => t === requested) ?? null;
  const back = () => router.push("/app/new");
  // An analysis collects posts (the collector's key) and reads them (the AI's key): without either it can't start.
  const { locked, also, checking } = useGate(["research.collect", "ai"]);
  const [products] = useCached<ProductRow[]>("/api/products");
  const app = Array.isArray(products) ? products.find((p) => p.is_primary) ?? products[0] : undefined;
  const crumbs = [{ label: "Home", href: "/app" }, ...(type ? [{ label: "New analysis", href: "/app/new" }, { label: TYPE_COPY[type].label }] : [{ label: "New analysis" }])];

  // Until the install has answered, neither the form nor the locked state: one never flashes before the other.
  if (checking || locked) {
    return (
      <Page className={columnClass}>
        <PageHeader crumbs={crumbs} title="New analysis" subtitle="An analysis collects accounts' recent posts and reads what works in them." />
        <Card>{locked && !checking
          ? <ConnectFor state={locked} also={also} otherwise={<FreeRoute productId={app?.id} />} />
          : <p className="flex items-center gap-2 p-4 text-sm text-muted" role="status"><Spinner />Checking what&apos;s connected…</p>}</Card>
      </Page>
    );
  }

  if (type) {
    return (
      <Page className={columnClass}>
        <PageHeader crumbs={crumbs} title={TITLE[type]} subtitle={TYPE_COPY[type].blurb} />
        {type === "competitors" ? <CompetitorForm onBack={back} /> : type === "account" ? <AccountForm onBack={back} /> : <CampaignForm onBack={back} />}
      </Page>
    );
  }
  return (
    <Page className={columnClass}>
      <PageHeader crumbs={crumbs} title="What do you want to analyze?" subtitle="Each analysis collects recent posts, reads what works in them and keeps every run." />
      <Card className="divide-y divide-line overflow-hidden">
        {(Object.keys(TYPE_COPY) as ProjectType[]).map((key) => (
          <button key={key} type="button" onClick={() => router.push(`/app/new?type=${key}`)} className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-hover">
            <span className="min-w-0 flex-1">
              <h2 className="text-sm font-medium">{TYPE_COPY[key].label}</h2>
              <p className="mt-0.5 text-caption text-muted">{TYPE_COPY[key].blurb}</p>
              <span className="mt-1 block text-xs font-medium text-accent">{key === "competitors" ? "Starts from your app's profile" : "You enter the handles"}</span>
            </span>
            <IconChevronRight className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-ink" />
          </button>
        ))}
      </Card>
    </Page>
  );
}

export default function NewAnalysisPage() {
  return <Suspense><NewAnalysis /></Suspense>;
}
