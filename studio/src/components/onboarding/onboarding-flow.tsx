"use client";
// The first run, in three short steps: your app (a name and one link), your AI key (with the exact steps,
// checked live, skippable), and your competitors (picked from suggestions or typed). The app is saved at
// the end of step 1 without finishing onboarding (app/api/onboarding), so the AI can read its link while
// the next steps are filled in; Finish saves the competitors, starts the first collection when a
// collecting key is set, and opens Research. The rules are in lib/onboarding.ts.
// "New app" (a second, third… app, components/onboarding/new-app.tsx) runs the same steps with
// mode="new": the key step only when no AI key is connected yet, and the first run's state left alone.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { featureState } from "@/lib/capabilities";
import { formatMoney } from "@/lib/i18n/format";
import { useT } from "@/lib/i18n/client";
import { serverErrorText, translateServerMessage } from "@/lib/i18n/server-messages";
import type { InstallState, KeyState } from "@/lib/install/types";
import { useInstall } from "@/lib/install/use-install";
import { appStepProblem, competitorKey, detectLink, flowSteps, freshSuggestions, MAX_COMPETITORS, nameAfterLookup, toggleCompetitor, type DetectedLink, type FlowMode } from "@/lib/onboarding";
import { categoryLabel, type StoreListing } from "@/lib/app-store";
import { IconArrowRight, IconCheck, IconCheckCircle, IconExternal, IconKey, IconPlus, IconX } from "../icons";
import { Badge, Button, Card, cx, Field, inputClass, Spinner } from "../ui";

export interface OnboardingDraft { id: string; name: string; link: string }

type Suggestion = { name: string; full?: string; iconUrl?: string | null; from: "store" | "ai" };

async function post<T>(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as T & { error?: string } };
  }
}

/**
 * `mode`: "first" for the first run after sign-up (in its own frame), "new" for New app inside the app.
 * `aiKeyReady`: New app leaves the key step out when an AI key was already connected when it started.
 */
export function OnboardingFlow({ draft, mode = "first", aiKeyReady = false, className }: { draft: OnboardingDraft | null; mode?: FlowMode; aiKeyReady?: boolean; className?: string }) {
  const { t } = useT();
  // Decided once, when the run starts: connecting a key on the key step doesn't take the step away.
  const [steps] = useState(() => flowSteps(mode, aiKeyReady));
  const [index, setIndex] = useState(draft ? 1 : 0);
  const step = steps[Math.min(index, steps.length - 1)];
  const [productId, setProductId] = useState<string | null>(draft?.id ?? null);
  const [name, setName] = useState(draft?.name ?? "");
  const [link, setLink] = useState(draft?.link ?? "");
  const [competitors, setCompetitors] = useState<string[]>([]);
  const words = { app: t("Your app"), key: t("AI key"), competitors: t("Competitors") };
  const labels = steps.map((s) => words[s]);
  const heading = useRef<HTMLHeadingElement>(null);
  // Each step's heading takes focus, so a keyboard or screen reader starts at the top of the new step.
  useEffect(() => { heading.current?.focus(); }, [index]);
  const back = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => setIndex((i) => Math.min(steps.length - 1, i + 1));

  return (
    <div className={className ?? "px-4 pt-8 pb-10 sm:px-12 sm:pt-10"}>
      <Progress step={index} labels={labels} />
      <h1 ref={heading} tabIndex={-1} className="mt-6 text-display font-semibold outline-none">
        {step === "app" ? (mode === "new" ? t("Which app do you want to add?") : t("What's your app?")) : step === "key" ? t("Connect your AI key") : t("Who are your competitors?")}
      </h1>
      {step === "app" && <AppStep mode={mode} name={name} link={link} productId={productId} onName={setName} onLink={setLink}
        onSaved={(id) => { setProductId(id); next(); }} />}
      {step === "key" && <KeyStep productId={productId} onBack={back} onNext={next} />}
      {step === "competitors" && productId && <CompetitorStep mode={mode} productId={productId} name={name} picked={competitors} onPicked={setCompetitors} onBack={back} />}
    </div>
  );
}

function Progress({ step, labels }: { step: number; labels: string[] }) {
  const { t } = useT();
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label={t("Step {n} of {total}", { n: step + 1, total: labels.length })}>
      {labels.map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === step ? "step" : undefined}>
          <span className={cx("grid size-5 place-items-center rounded-full text-[11px] font-medium", i < step ? "bg-win text-on-ink" : i === step ? "bg-accent-fill text-on-accent" : "bg-control text-muted")}>
            {i < step ? <IconCheck className="size-3" /> : i + 1}
          </span>
          <span className={cx(i === step ? "font-medium text-ink" : "text-muted", i !== step && "hidden sm:inline")}>{label}</span>
          {i < labels.length - 1 && <span className="h-px w-4 bg-line sm:w-6" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

// MARK: Step 1: your app

function AppStep({ mode, name, link, productId, onName, onLink, onSaved }: {
  mode: FlowMode; name: string; link: string; productId: string | null; onName: (v: string) => void; onLink: (v: string) => void; onSaved: (id: string) => void;
}) {
  const { t } = useT();
  const [listing, setListing] = useState<StoreListing | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);
  // The name a link suggested, so a later link can replace it (but never a name typed by hand), and the
  // name as it is now, read when Apple answers (typed meanwhile, it stays).
  const autoName = useRef("");
  const nameNow = useRef(name);
  useEffect(() => { nameNow.current = name; }, [name]);
  const detected: DetectedLink | null = link.trim() ? detectLink(link) : null;
  const problem = appStepProblem(name, link);

  // A store link is looked up once it's typed: its name, icon and category.
  const detectedUrl = detected?.url ?? "";
  const detectedKind = detected?.kind ?? null;
  useEffect(() => {
    if (!detectedUrl) return;
    let live = true;
    const timer = setTimeout(async () => {
      setLooking(true);
      const result = await post<{ listing: StoreListing | null; name: string }>("/api/onboarding", { action: "lookup", link: detectedUrl });
      if (!live) return;
      setLooking(false);
      setListing(result.data.listing ?? null);
      const next = nameAfterLookup(nameNow.current, autoName.current, result.data.name ?? "");
      if (next !== null) { autoName.current = next; onName(next); }
    }, detectedKind === "app_store" ? 150 : 500);
    return () => { live = false; clearTimeout(timer); };
  }, [detectedUrl, detectedKind, onName]);
  const shownListing = detectedUrl ? listing : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (problem) return;
    setBusy(true); setError("");
    const result = await post<{ product?: { id: string } }>("/api/onboarding", { action: "create", name: name.trim(), link: link.trim(), productId, mode });
    setBusy(false);
    if (!result.ok || !result.data.product?.id) return setError(result.data.error ?? t("Couldn't save your app. Check your connection and try again."));
    onSaved(result.data.product.id);
  }

  return (
    <form onSubmit={submit} className="mt-1" noValidate>
      <p className="mb-6 max-w-xl text-sm text-muted">{t("Two things to start. The AI fills in the rest from your link, and you can change any of it later.")}</p>
      <Card className="grid gap-4 p-4">
        <Field label={t("App Store link or website")} hint={tried && problem === "link"
          ? <span className="text-warn">{t("That doesn't look like a link. Paste your App Store link or your website's address.")}</span>
          : detected?.kind === "app_store" ? t("An App Store link: we read your app's name, icon and category from it.")
          : detected?.kind === "google_play" ? t("A Google Play link: the AI reads it once your key is connected.")
          : detected ? t("A website: the AI reads it once your key is connected.")
          : t("Optional, but it saves you typing. Paste a link from the App Store, Google Play or your site.")}>
          <input className={inputClass} value={link} onChange={(e) => onLink(e.target.value)} inputMode="url" autoComplete="url" autoFocus
            placeholder="https://apps.apple.com/app/id1234567890" aria-invalid={tried && problem === "link"} />
        </Field>
        {(looking || shownListing) && (
          <div className="flex min-h-12 items-center gap-3 rounded-inner border border-line bg-raised px-3 py-2" role="status">
            {looking && !shownListing ? <><Spinner className="size-3.5" /><span className="text-sm text-muted">{t("Looking it up on the App Store…")}</span></> : shownListing && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {shownListing.iconUrl ? <img src={shownListing.iconUrl} alt="" className="size-9 shrink-0 rounded-[9px] border border-line" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{shownListing.name}</p>
                  {/* Apple's category in the viewer's language (lib/app-store.ts APP_STORE_CATEGORIES). */}
                  <p className="truncate text-xs text-muted">{[categoryLabel(shownListing, t), shownListing.developer].filter(Boolean).join(" · ")}</p>
                </div>
                <Badge tone="win">{t("Found")}</Badge>
              </>
            )}
          </div>
        )}
        <Field label={t("App name")} hint={tried && problem === "name" ? <span className="text-warn">{t("Give your app a name.")}</span> : undefined}>
          <input className={inputClass} value={name} maxLength={120} onChange={(e) => onName(e.target.value)} placeholder={t("For example: Trailmix")} aria-invalid={tried && problem === "name"} />
        </Field>
      </Card>
      {error && <p role="alert" className="mt-4 text-sm text-warn">{error}</p>}
      <div className={cx("mt-5 flex flex-wrap-reverse items-center gap-3", mode === "first" ? "justify-between" : "justify-end")}>
        {/* A full page load: the example answers from sample data, apart from the real app. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        {mode === "first" && <a href="/example" className="rounded-xs text-sm font-medium text-accent hover:underline">{t("Look around an example first")}</a>}
        <Button type="submit" disabled={busy}>{busy ? <><Spinner className="size-3.5" />{t("Saving…")}</> : <>{t("Continue")}<IconArrowRight /></>}</Button>
      </div>
    </form>
  );
}

// MARK: Step 2: your AI key

const OPENAI_KEYS_URL = "https://platform.openai.com/api-keys";
const OPENAI_BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";
const APIFY_TOKENS_URL = "https://console.apify.com/settings/integrations";

/** Whether this account can add keys itself (accounts mode, an install's owner, or an install with no owner). */
const canAddKeys = (install: InstallState | null) => !install || install.mode === "accounts" || install.role === "owner" || install.role === "account" || !install.owned;

function KeyStep({ productId, onBack, onNext }: { productId: string | null; onBack: () => void; onNext: () => void }) {
  const { t, intl } = useT();
  const { install, loading, refresh } = useInstall();
  const ai = featureState("ai", install, null, { t, intl });
  const aiReady = Boolean(install) && ai.ok;
  const collectReady = Boolean(install) && featureState("research.collect", install, null, { t, intl }).ok;
  const [showApify, setShowApify] = useState(false);

  async function saved(name: string) {
    await refresh();
    // The AI can now read the app's link: start it, so the profile and suggestions are ready sooner.
    if (name === "OPENAI_API_KEY" && productId) void post(`/api/products/${productId}/insight`, { action: "start" });
  }

  return (
    <div className="mt-1">
      <p className="mb-6 max-w-xl text-sm text-muted">{t("The AI reads your competitors' ads, fills in your app's profile and helps write your ads. It runs on your own OpenAI account, so you only pay OpenAI for what you use.")}</p>
      {loading ? <Card className="flex items-center gap-2 p-4 text-sm text-muted"><Spinner className="size-3.5" />{t("Checking your keys…")}</Card>
        : aiReady ? (
          <Card className="flex items-center gap-3 p-4">
            <IconCheckCircle className="size-4 shrink-0 text-win" />
            <p className="text-sm">{t("Your AI key is connected and works.")}</p>
          </Card>
        ) : !canAddKeys(install) ? (
          <Card className="p-4 text-sm text-muted">{t("The owner of this workspace adds the keys in Settings. You can carry on now: everything that needs the AI waits for it.")}</Card>
        ) : (
          <Card className="grid gap-4 p-4">
            <ol className="ml-4 list-decimal space-y-1.5 text-sm text-ink">
              <li>{t("Sign in to OpenAI, or create a free account.")} <Out href={OPENAI_KEYS_URL}>{t("Open the keys page")}</Out></li>
              <li>{t("Add at least $5 of credit under Billing.")} <Out href={OPENAI_BILLING_URL}>{t("Open Billing")}</Out></li>
              <li>{t("Click Create new secret key. Keep Owned by: You and Permissions: All, then click Create secret key.")}</li>
              <li>{t("Copy the key and paste it below.")}</li>
            </ol>
            <KeyField name="OPENAI_API_KEY" label={t("Your OpenAI key")} hint={t("Starts with sk-proj- (older keys sk-)")} onSaved={() => { void saved("OPENAI_API_KEY"); }} />
          </Card>
        )}

      {!loading && canAddKeys(install) && (
        <Card className="mt-3 p-4">
          {collectReady ? (
            <p className="flex items-center gap-3 text-sm"><IconCheckCircle className="size-4 shrink-0 text-win" />{t("One-click ad collection is on.")}</p>
          ) : (
            <>
              <button type="button" onClick={() => setShowApify(!showApify)} aria-expanded={showApify} className="flex w-full items-center justify-between gap-3 text-left">
                <span>
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{t("Collect competitors' ads in one click")}<Badge>{t("Optional")}</Badge></span>
                  <span className="mt-0.5 block text-xs text-muted">{t("Without it you bring ads in with a free Chrome extension, which takes a few minutes per competitor.")}</span>
                </span>
                <IconPlus className={cx("size-3.5 shrink-0 text-muted transition-transform", showApify && "rotate-45")} />
              </button>
              {showApify && (
                <div className="mt-4 grid gap-4 border-t border-line pt-4">
                  <ol className="ml-4 list-decimal space-y-1.5 text-sm text-ink">
                    <li>{t("Create a free Apify account. The free plan includes $5 of collecting a month.")} <Out href={APIFY_TOKENS_URL}>{t("Open Apify")}</Out></li>
                    <li>{t("Under Personal API tokens, click Create a new token, then Create.")}</li>
                    <li>{t("Copy the token (it is shown once) and paste it below.")}</li>
                  </ol>
                  <KeyField name="APIFY_TOKEN" label={t("Your Apify token")} hint={t("Starts with apify_api_")} onSaved={() => { void saved("APIFY_TOKEN"); }} />
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>{t("Back")}</Button>
        <span className="flex flex-wrap items-center gap-2">
          {!aiReady && !loading && <Button variant="ghost" onClick={onNext}>{t("Skip for now")}</Button>}
          <Button onClick={onNext} disabled={loading || (!aiReady && canAddKeys(install))}>{t("Continue")}<IconArrowRight /></Button>
        </span>
      </div>
    </div>
  );
}

function Out({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{children}<IconExternal className="size-3" /></a>;
}

/** One key: paste, check live with the service (PUT /api/install/keys/[name]), and say whether it works. */
function KeyField({ name, label, hint, onSaved }: { name: string; label: string; hint: string; onSaved: (key: KeyState) => void }) {
  const { t, locale } = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  /** Saved but not proven yet (it waits for its pair, or the service has no quick check): the backend's reason. */
  const [unchecked, setUnchecked] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setBusy(true); setError(""); setOk(false); setUnchecked("");
    const result = await post<{ key?: KeyState }>(`/api/install/keys/${name}`, { value: value.trim() }, "PUT");
    setBusy(false);
    if (!result.ok || !result.data.key) return setError(serverErrorText(result.data, { t, locale }, t("Couldn't check the key. Check your connection and try again.")));
    const saved = result.data.key;
    if (saved.status === "failed") return setError(saved.message ? translateServerMessage(saved.message, { t, locale }) : t("The last check of this key failed. Paste a new key."));
    setOk(saved.status === "ok"); setValue("");
    if (saved.status !== "ok") setUnchecked(saved.message ? translateServerMessage(saved.message, { t, locale }) : t("Saved. It hasn't been checked yet."));
    onSaved(result.data.key);
  }

  return (
    <form onSubmit={save} className="grid gap-1.5">
      <label htmlFor={`key-${name}`} className="text-xs font-medium text-muted">{label}</label>
      <div className="flex flex-wrap gap-2">
        <input id={`key-${name}`} className={cx(inputClass, "min-w-0 flex-[1_1_200px] font-mono")} type="password" autoComplete="off" spellCheck={false} value={value} onChange={(e) => { setValue(e.target.value); setError(""); }} placeholder={t("Paste the key here")} aria-describedby={`key-${name}-hint`} />
        <Button type="submit" disabled={busy || !value.trim()}>{busy ? <><Spinner className="size-3.5" />{t("Checking…")}</> : <><IconKey />{t("Check and save")}</>}</Button>
      </div>
      <p id={`key-${name}-hint`} className="text-xs text-muted">{hint}</p>
      {error && <p role="alert" className="text-sm text-warn">{error}</p>}
      {ok && <p role="status" className="text-sm text-win">{t("It works. The key is saved for your account only.")}</p>}
      {unchecked && <p role="status" className="text-sm text-muted">{unchecked}</p>}
    </form>
  );
}

// MARK: Step 3: your competitors

/** How long the step waits for the AI's suggestions while it reads the app's link. */
const AI_WAIT_MS = 120_000;

function CompetitorStep({ mode, productId, name, picked, onPicked, onBack }: { mode: FlowMode; productId: string; name: string; picked: string[]; onPicked: (list: string[]) => void; onBack: () => void }) {
  const { t, intl } = useT();
  const { install } = useInstall();
  const [typed, setTyped] = useState("");
  const [store, setStore] = useState<Suggestion[]>([]);
  const [ai, setAi] = useState<Suggestion[]>([]);
  const [reading, setReading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aiOn = Boolean(install) && featureState("ai", install).ok;
  const collectOn = Boolean(install) && featureState("research.collect", install).ok;
  const metaApiOn = Boolean(install) && featureState("research.metaApi", install).ok;

  // Suggestions: apps like it on the App Store at once; the AI's when its read of the link is done (asked again while it reads).
  useEffect(() => {
    let live = true;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const result = await post<{ appStore?: { name: string; full: string; iconUrl: string | null }[]; ai?: string[]; reading?: boolean }>("/api/onboarding", { action: "suggest", productId });
      if (!live) return;
      setLoaded(true);
      setStore((result.data.appStore ?? []).map((a) => ({ name: a.name, full: a.full, iconUrl: a.iconUrl, from: "store" as const })));
      setAi((result.data.ai ?? []).map((n) => ({ name: n, from: "ai" as const })));
      const still = Boolean(result.data.reading) && Date.now() - started < AI_WAIT_MS;
      setReading(still);
      if (still) timer = setTimeout(ask, 4_000);
    };
    void ask();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [productId]);

  const full = picked.length >= MAX_COMPETITORS;
  const add = (value: string) => {
    const next = toggleCompetitor(picked, value);
    if (next !== picked) onPicked(next);
  };
  const shown = (list: Suggestion[]) => {
    const fresh = new Set(freshSuggestions(list.map((s) => s.name), picked, name).map(competitorKey));
    return list.filter((s) => fresh.has(competitorKey(s.name)));
  };
  const suggestions = [...shown(ai), ...shown(store)].filter((s, i, all) => all.findIndex((o) => competitorKey(o.name) === competitorKey(s.name)) === i).slice(0, 10);

  // After Finish, when collecting could cost money: the most it can cost, and the person's own yes.
  const [offer, setOffer] = useState<{ free: number; paid: number; usd: number } | null>(null);

  /** A full page load: the app's pages check onboarding on the server. */
  const open = (extra = "") => {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/app/w/${productId}/research?guide=ads${extra}`);
  };

  async function finish(list: string[]) {
    setBusy(true); setError("");
    const result = await post<{ product?: { id: string }; followed?: number }>("/api/onboarding", { action: "finish", productId, competitors: list, mode });
    if (!result.ok) { setBusy(false); return setError(result.data.error ?? t("Couldn't finish. Check your connection and try again.")); }
    // A collecting key is set: free sources start at once; anything that costs money waits for a yes with its cost shown.
    if (list.length && (collectOn || metaApiOn)) {
      const plan = await post<{ free?: number; paid?: number; usd?: number }>(`/api/research/${productId}`, { action: "plan" });
      const free = plan.data.free ?? 0, paid = plan.data.paid ?? 0;
      if (plan.ok && paid > 0) { setBusy(false); return setOffer({ free, paid, usd: plan.data.usd ?? 0 }); }
      if (plan.ok && free > 0) await post(`/api/research/${productId}`, { action: "pull", spend: false });
    }
    open();
  }

  async function collect(spend: boolean) {
    setBusy(true);
    await post(`/api/research/${productId}`, { action: "pull", spend });
    open();
  }

  if (offer) {
    return (
      <div className="mt-1">
        <p className="mb-6 max-w-xl text-sm text-muted">{t("Your competitors are saved. Collect their ads now?")}</p>
        <Card className="grid gap-3 p-4" role="group" aria-labelledby="collect-offer">
          <p id="collect-offer" className="text-sm font-medium">{t("Collect their ads now, for up to {usd} of your Apify credit", { usd: formatMoney(intl, offer.usd, "USD", { decimals: 2 }) })}</p>
          <p className="text-sm text-muted">{t("Apify bills your account per ad, and stops at that amount. Most collections cost less: a competitor with 30 live ads costs for 30.")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { void collect(true); }} disabled={busy}>{busy ? <Spinner className="size-3.5" /> : null}{t("Collect, up to {usd}", { usd: formatMoney(intl, offer.usd, "USD", { decimals: 2 }) })}</Button>
            {offer.free > 0 && <Button variant="secondary" onClick={() => { void collect(false); }} disabled={busy}>{t("Free sources only")}</Button>}
            <Button variant="ghost" onClick={() => open()} disabled={busy}>{t("Not now")}</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-1">
      <p className="mb-6 max-w-xl text-sm text-muted">{t("Pick up to five. You'll see the ads they're running, and which ones have run the longest: those are the ones that work.")}</p>
      <Card className="grid gap-4 p-4">
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { add(typed); setTyped(""); } }} className="grid gap-1.5">
          <label htmlFor="competitor-name" className="text-xs font-medium text-muted">{t("Add a competitor")}</label>
          <div className="flex gap-2">
            <input id="competitor-name" className={inputClass} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={full} placeholder={t("For example: Calm, or calm.com")} autoFocus aria-describedby="competitor-hint" />
            <Button type="submit" variant="secondary" disabled={full || !typed.trim()}><IconPlus />{t("Add")}</Button>
          </div>
          <p id="competitor-hint" className="text-xs text-muted">{t("A name, their Facebook page or their website.")}</p>
        </form>

        <div>
          <p className="mb-2 text-xs font-medium text-muted">{t("Your list")} <span className="tabular-nums">{picked.length}/{MAX_COMPETITORS}</span></p>
          {picked.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <li key={p}><button type="button" onClick={() => add(p)} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5 text-sm text-ink hover:bg-hover" aria-label={t("Remove {name}", { name: p })}>
                  <span className="max-w-48 truncate">{p}</span><IconX className="size-3 text-muted" />
                </button></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">{t("Nobody yet. Pick from the suggestions or type a name above.")}</p>}
        </div>

        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">{t("Suggestions")}{(reading || !loaded) && <Spinner className="size-3" />}</p>
          {suggestions.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <li key={`${s.from}-${s.name}`}>
                  <button type="button" onClick={() => add(s.name)} disabled={full} title={s.full ?? s.name}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-raised px-2.5 text-sm text-ink transition-colors hover:bg-hover disabled:opacity-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {s.iconUrl ? <img src={s.iconUrl} alt="" className="size-4 rounded-[4px]" /> : <IconPlus className="size-3 text-muted" />}
                    <span className="max-w-48 truncate">{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : loaded && !reading ? (
            <p className="text-sm text-muted">{aiOn ? t("No suggestions this time. Type the names you know.") : t("Connect your AI key for suggestions, or type the names you know.")}</p>
          ) : null}
          {reading && <p className="mt-2 text-xs text-muted">{t("The AI is reading your app's link to suggest more. They appear here in a minute.")}</p>}
        </div>
      </Card>
      <p className="mt-3 text-xs text-muted">{collectOn
        ? t("When you finish, you see the most collecting their ads can cost, and nothing is spent until you say yes.")
        : metaApiOn ? t("When you finish, their ads start coming in by themselves, for free.")
        : t("Next you bring in their ads. It takes a couple of minutes, and the page shows you how.")}</p>
      {error && <p role="alert" className="mt-3 text-sm text-warn">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={busy}>{t("Back")}</Button>
        <span className="flex flex-wrap items-center gap-2">
          {!picked.length && <Button variant="ghost" onClick={() => { void finish([]); }} disabled={busy}>{t("Skip for now")}</Button>}
          <Button onClick={() => { void finish(picked); }} disabled={busy || !picked.length}>{busy ? <><Spinner className="size-3.5" />{t("Finishing…")}</> : <>{t("Finish")}<IconArrowRight /></>}</Button>
        </span>
      </div>
    </div>
  );
}

