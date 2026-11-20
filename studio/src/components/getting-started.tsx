"use client";
// The getting-started guide: four steps from nothing to a first result, each done or not from the app's
// real data (lib/workspace-setup.ts), each opening the page that does it with ?guide=<step>, where
// <CoachMarks /> points at the button to press. It stays on the app's Home until every step is done or
// it is closed (remembered per account and app).
//
//   <GettingStarted id={productId} />                       the full card, on the app's Home
//   <GettingStartedCompact id={productId} onNavigate={…} />  one line and a progress bar, for the sidebar
//   <CoachMarks />                                          once in the app shell: the pulse and tooltip
// Elements a step points at carry data-guide="ads" | "make" | "launch" | "results", and a page's
// "connect" button data-guide="connect" (ConnectState).
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { refresh as refreshCached, useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { useInstall } from "@/lib/install/use-install";
import { shouldFillProfile } from "@/lib/onboarding";
import { guideKey } from "@/lib/ui-state";
import { useClosedFlag } from "@/lib/use-ui-state";
import type { WorkspaceCounts } from "@/lib/workspace-schema";
import { GUIDE_PARAM, guideAsk, guideStatus, guideSteps, isGuideKey, type GuideKey, type GuideStep } from "@/lib/workspace-setup";
import { IconArrowRight, IconCheck, IconLock, IconSparkles, IconX } from "./icons";
import { overlayOpen } from "./layers";
import { Badge, Card, cx, Spinner } from "./ui";
import { isWorkspace, useWorkspace } from "./workspace/parts";

// MARK: The guide's state

/** The four steps, how far along the app is, and whether the guide was closed (kept on the account: lib/ui-state.ts). */
export function useGuide(id: string) {
  const [counted] = useCached<{ counts?: WorkspaceCounts }>(`/api/workspaces/${id}/counts`);
  const [workspace] = useWorkspace(id);
  const { install, loading } = useInstall();
  const { closed, close, reopen } = useClosedFlag(guideKey(id));
  const counts = counted === undefined || loading ? undefined : counted?.counts ?? null;
  const app = isWorkspace(workspace) ? { id, connections: workspace.connections } : { id };
  const steps = guideSteps(id, counts, install, app);
  const status = guideStatus(steps);
  const appName = isWorkspace(workspace) ? workspace.brandKit.appName || workspace.name : "";
  // Hidden while it can't be told whether it was closed, so a closed guide never flashes.
  return { steps, status, closed, close, reopen, appName, show: closed === false && !status.complete };
}

/** The words of each step (All apps shows them too). */
export function useGuideWords(appName: string) {
  const { t } = useT();
  return (key: GuideKey) => ({
    ads: { title: t("Get a competitor's ads in"), body: t("See what they're running, and which ads have run the longest.") },
    // The button on each ad says "Make for <app>" (research-ads.tsx AdCard).
    make: { title: t("Make one of their ads for your app"), body: appName ? t("Open an ad and press Make for {app}.", { app: appName }) : t("Open an ad and press Make for your app.") },
    launch: { title: t("Send it to Meta, paused"), body: t("It arrives as a paused ad: nothing spends until you publish it.") },
    results: { title: t("See your results"), body: t("Connect RevenueCat, Superwall or Mixpanel, or your Meta spend, to see CAC, LTV and what each ad brought in.") },
  })[key];
}

// MARK: The full card

/** The guide on the app's Home. Null once every step is done or it was closed. */
export function GettingStarted({ id, className }: { id: string; className?: string }) {
  const { t } = useT();
  const { steps, status, show, close, reopen, appName, closed } = useGuide(id);
  const words = useGuideWords(appName);
  useProfileFill(id);
  // A bare ?guide (Help > Get started, the command menu: lib/nav-model.ts guideHref) reopens the guide here,
  // scrolled into view with its next step marked, even when it was closed or every step is done.
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asked = guideAsk(params.get(GUIDE_PARAM)) === "reopen";
  const [opened, setOpened] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  // Once per visit with ?guide (the address loses it straight after).
  const handled = useRef(false);
  useEffect(() => {
    if (!asked) { handled.current = false; return; }
    // Wait until the account is known: the closed flag is kept per account.
    if (closed === null) return;
    if (handled.current) return;
    handled.current = true;
    const open = async () => {
      reopen();
      setOpened(true);
      const query = new URLSearchParams(window.location.search);
      query.delete(GUIDE_PARAM);
      router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
    };
    void open();
  }, [asked, closed, reopen, router, pathname]);
  useEffect(() => {
    if (opened) card.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  }, [opened]);
  const close2 = () => { setOpened(false); close(); };
  if (!show && !opened) return null;
  return (
    <Card ref={card} className={cx("p-3 sm:p-4", className)} aria-label={t("Getting started")}>
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><IconSparkles className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{t("Getting started")}</h2>
          <p className="text-xs text-muted">{status.loading ? t("Checking what's done…") : status.complete ? t("All four steps are done. Open any of them again whenever you like.") : t("{done} of {total} done. Each step opens the page and shows you what to press.", { done: status.done, total: status.total })}</p>
        </div>
        <button type="button" onClick={close2} aria-label={t("Close the guide")} title={t("Close the guide")} className="grid size-7 shrink-0 place-items-center rounded-control text-faint transition hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
      </div>
      <Bar done={status.done} total={status.total} className="mt-3" />
      <ol className="mt-2">
        {steps.map((step, i) => <StepRow key={step.key} step={step} n={i + 1} current={status.current?.key === step.key} pointed={opened && status.current?.key === step.key} words={words(step.key)} />)}
      </ol>
      <p className="mt-2 border-t border-line pt-2.5 text-xs text-muted">
        {t("Want to see where this leads?")}{" "}
        {/* A full page load: the example answers from sample data, apart from the real app. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/example" className="rounded-xs font-medium text-accent hover:underline">{t("See an example app")}</a>
      </p>
    </Card>
  );
}

function StepRow({ step, n, current, pointed = false, words }: { step: GuideStep; n: number; current: boolean; pointed?: boolean; words: { title: string; body: string } }) {
  const { t } = useT();
  return (
    <li>
      <Link href={step.href} aria-current={current ? "step" : undefined}
        className={cx("-mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 py-2 transition-colors hover:bg-hover", current && "bg-accent-soft/50", pointed && "coach-ring")}>
        <span className={cx("grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium tabular-nums",
          step.done ? "bg-win text-on-ink" : current ? "bg-accent-fill text-on-accent" : "bg-control text-muted")}>
          {step.done === null ? <Spinner className="size-2.5" /> : step.done ? <IconCheck className="size-3" /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm", step.done ? "text-muted line-through decoration-faint" : "font-medium text-ink")}>
            {words.title}
            {step.locked && <Badge><IconLock className="mr-1 size-3" />{t("Needs a key")}</Badge>}
          </span>
          {!step.done && <span className="block text-xs text-muted">{words.body}</span>}
        </span>
        {current && <span className="hidden shrink-0 items-center gap-1 text-xs font-medium text-accent sm:inline-flex">{t("Show me")}<IconArrowRight className="size-3.5" /></span>}
      </Link>
    </li>
  );
}

function Bar({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <div className={cx("h-1 overflow-hidden rounded-full bg-control", className)} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <div className="h-full rounded-full bg-accent-fill transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </div>
  );
}

// MARK: The compact card (sidebar)

/** One line for the sidebar: the step to do next and how far along the app is. Null when done, closed or loading. */
export function GettingStartedCompact({ id, onNavigate, className }: { id: string; onNavigate?: () => void; className?: string }) {
  const { t } = useT();
  const { status, show, appName } = useGuide(id);
  const words = useGuideWords(appName);
  if (!show || !status.current) return null;
  return (
    <Link href={status.current.href} onClick={() => onNavigate?.()}
      className={cx("block rounded-small border border-line bg-card px-3 py-2.5 transition-colors hover:border-hairline hover:bg-raised", className)}>
      <span className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-ink">{t("Getting started")}</span>
        <span className="text-muted tabular-nums">{status.done}/{status.total}</span>
      </span>
      <Bar done={status.done} total={status.total} className="mt-1.5" />
      <span className="mt-1.5 block text-xs text-muted">{t("Next: {step}", { step: words(status.current.key).title })}</span>
    </Link>
  );
}

// MARK: Filling the profile from the AI's read of the link

/**
 * An app made by the three-step start has a name and a link only. When the AI's read of that link is
 * done, its profile fills the empty fields once (the Product tab shows it, with Undo). Anything typed by
 * hand is never replaced (lib/onboarding.ts shouldFillProfile).
 */
function useProfileFill(id: string) {
  const [products] = useCached<ProductRow[]>("/api/products");
  const product = Array.isArray(products) ? products.find((p) => p.id === id) : undefined;
  const asked = useRef(false);
  const ready = Boolean(product && shouldFillProfile(product as Parameters<typeof shouldFillProfile>[0]));
  useEffect(() => {
    if (!ready || asked.current) return;
    asked.current = true;
    void fetch(`/api/products/${id}/insight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply" }) })
      .then((r) => (r.ok ? refreshCached("/api/products") : null)).catch(() => null);
  }, [ready, id]);
}

// MARK: Coach marks

const subscribeNothing = () => () => {};

/**
 * On a page opened from the guide (?guide=<step>): scrolls the button to press into view, rings it with a
 * pulse and shows one short line beside it. Goes away on Escape, on "Got it", or when the button is
 * pressed. No library: a fixed ring over the element's box, kept in place while the page scrolls.
 */
export function CoachMarks() {
  const params = useSearchParams();
  const pathname = usePathname();
  const asked = params.get(GUIDE_PARAM);
  const key = isGuideKey(asked) ? asked : null;
  // A new ?guide= starts a new mark (keyed, so its state starts fresh).
  return key ? <CoachMark key={`${key}-${pathname}`} step={key} /> : null;
}

function CoachMark({ step }: { step: GuideKey }) {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [target, setTarget] = useState<{ el: Element; kind: "step" | "connect" } | null>(null);
  const [gone, setGone] = useState(false);
  // Hidden while a dialog, sheet or drawer is open on top of the page (it would sit over it otherwise).
  const [covered, setCovered] = useState(false);

  const done = useCallback(() => {
    setGone(true);
    const query = new URLSearchParams(window.location.search);
    query.delete(GUIDE_PARAM);
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  }, [router, pathname]);

  // The page may still be loading: look for the element for a few seconds.
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const find = () => {
      // A page that needs a key or a connection first (Launch, Measure) points at its connect button instead.
      const connect = document.querySelector(`[data-guide="connect"]`);
      const own = document.querySelector(`[data-guide="${step}"]`);
      const el = connect && (step === "launch" || step === "results") ? null : own;
      const found = el ?? connect;
      if (found) {
        found.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        setTarget({ el: found, kind: el ? "step" : "connect" });
        return;
      }
      if (++tries < 40) timer = setTimeout(find, 250);
    };
    find();
    return () => clearTimeout(timer);
  }, [step]);

  // Follow the element while the page scrolls or resizes; pressing it ends the mark.
  useEffect(() => {
    if (!target) return;
    const place = () => {
      setBox(target.el.isConnected ? target.el.getBoundingClientRect() : null);
      setCovered(overlayOpen());
    };
    place();
    const onPress = () => done();
    // Escape belongs to an open dialog first; it only dismisses the mark when nothing is on top.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !overlayOpen()) done(); };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    target.el.addEventListener("click", onPress);
    window.addEventListener("keydown", onKey);
    const tick = setInterval(place, 400);
    // Dialogs open and close without scrolling: notice them at once rather than on the next tick.
    const observer = new MutationObserver(() => setCovered(overlayOpen()));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "aria-modal"] });
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      target.el.removeEventListener("click", onPress);
      window.removeEventListener("keydown", onKey);
      clearInterval(tick);
      observer.disconnect();
    };
  }, [target, done]);

  if (!mounted || gone || covered || !box || (box.width === 0 && box.height === 0)) return null;
  const tip = target?.kind === "connect" ? t("First add the key this needs. It's checked when you save it.") : {
    ads: t("Start here: bring in a competitor's ads."),
    make: t("Press this on an ad you like to make the same kind of ad for your app."),
    launch: t("Send a creative to Meta. It arrives paused: nothing spends until you publish it."),
    results: t("Connect where your results live: RevenueCat, Superwall, Mixpanel or your Meta spend."),
  }[step];
  const pad = 6;
  const width = Math.min(280, window.innerWidth - 32);
  const below = box.bottom + 12 + 90 < window.innerHeight;
  const left = Math.max(16, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 16));
  return createPortal(
    <>
      <div aria-hidden className="coach-ring pointer-events-none fixed z-[35] rounded-[12px]"
        style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
      <div role="status" className="fixed z-[36] rounded-inner border border-line bg-card p-3 text-sm text-ink shadow-raised"
        style={{ width, left, ...(below ? { top: box.bottom + 12 } : { top: Math.max(16, box.top - 12 - 84) }) }}>
        <p>{tip}</p>
        <div className="mt-2 flex justify-end"><button type="button" onClick={done} className="rounded-xs text-xs font-medium text-accent hover:underline">{t("Got it")}</button></div>
      </div>
    </>,
    document.body,
  );
}
