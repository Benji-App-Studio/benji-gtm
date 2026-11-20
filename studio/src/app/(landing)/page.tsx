import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { IconChart, IconCheckCircle, IconCompass, IconKey, IconLock, IconRocket, IconSparkles } from "@/components/icons";
import { LanguageMenu } from "@/components/language-menu";
import { LaunchPreview, MakePreview, MeasurePreview, ResearchPreview, SourcesPreview } from "@/components/landing/previews";
import { Logo } from "@/components/logo";
import { buttonClass, cx } from "@/components/ui";
import { APP_NAME } from "@/lib/brand-config";
import { LOCALES } from "@/lib/i18n/locales";
import { languageAlternates, localizedPath, OG_LOCALE } from "@/lib/i18n/query-locale";
import { getTranslator } from "@/lib/i18n/server";
import { getInstallConfig } from "@/lib/install/config";
import { signupOpen } from "@/lib/install/signup";
import { landingSeo, OG_SIZE } from "@/lib/landing-seo";
import { localModePage } from "@/lib/server/owner-session";
import { startWithEmail } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getTranslator();
  const seo = landingSeo(getInstallConfig()?.publicOrigin);
  const title = `${APP_NAME} · ${t("Ads that grow your app")}`;
  const description = t("Research the ads your competitors keep running, make your own versions, launch them to Meta and measure CAC, LTV and payback. For mobile app builders.");
  const images = seo.image ? [{ url: seo.image, ...OG_SIZE, alt: title }] : undefined;
  return {
    title: { absolute: title },
    description,
    // Indexed, with a canonical link and a share picture, only on a copy with a public address. The page
    // reads the language from a cookie, so each language also has an address search engines can fetch
    // (/?lang=ja: lib/i18n/query-locale.ts); every one is listed as an hreflang alternate, English as x-default.
    ...(seo.base ? { metadataBase: seo.base, alternates: { canonical: localizedPath("/", locale), languages: languageAlternates("/") } } : {}),
    robots: seo.index ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website", siteName: APP_NAME, title, description, locale: OG_LOCALE[locale], alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      ...(seo.base ? { url: new URL(localizedPath("/", locale), seo.base).toString() } : {}), ...(images ? { images } : {}),
    },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, ...(images ? { images } : {}) },
  };
}

const wrap = "mx-auto w-full max-w-[1080px] px-4 sm:px-6";

/**
 * The email field and one button. The address goes to sign-up (or log in, when sign-up is closed) in a
 * short-lived cookie set by a server action, never in the address bar; it works without JavaScript too.
 */
function StartForm({ label, button, id }: { label: string; button: string; id: string }) {
  return (
    <form action={startWithEmail} className="mx-auto flex w-full max-w-[420px] flex-col gap-2 sm:flex-row">
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} name="email" type="email" autoComplete="email" placeholder="you@example.com" required
        className="h-10 w-full min-w-0 shrink-0 rounded-control sm:h-9 sm:w-auto sm:flex-1 sm:shrink border border-hairline bg-raised px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-focus/70 focus:ring-2 focus:ring-focus/20" />
      <button type="submit" className={cx(buttonClass("primary"), "h-10 shrink-0 px-4 sm:h-9")}>{button}</button>
    </form>
  );
}

function Feature({ n, title, body, children, className }: { n: number; title: string; body: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-card", className)}>
      <div className="p-5 pb-4">
        <p className="text-xs text-muted tabular-nums">0{n}</p>
        <h3 className="mt-2 text-[15px] leading-[23px] font-medium text-ink">{title}</h3>
        <p className="mt-1 max-w-[52ch] text-sm text-muted">{body}</p>
      </div>
      <div className="flex flex-1 flex-col justify-center border-t border-line bg-canvas p-4 pt-5 sm:p-5 sm:pt-6">{children}</div>
    </section>
  );
}

/**
 * The public landing page at the site root for signed-out visitors (the proxy sends someone signed in to
 * the app). A copy run on its owner's own computer has no public page and opens the app.
 */
export default async function Landing() {
  if (await localModePage()) redirect("/app");
  const { t } = await getTranslator();
  const open = await signupOpen();
  const start = open ? "/signup" : "/login";

  const steps = [
    { icon: <IconCompass />, title: t("Research"), body: t("See every ad your competitors run on Meta, and which ones they keep paying for.") },
    { icon: <IconSparkles />, title: t("Create"), body: t("Turn the ads that work into creatives for your app, in your words and your look.") },
    { icon: <IconRocket />, title: t("Launch"), body: t("Send the ones you approve to your Meta ad account, ready to switch on.") },
    { icon: <IconChart />, title: t("Measure"), body: t("Follow what each customer costs and earns, then research and make what's next.") },
  ];
  const trust = [
    { icon: <IconKey />, title: t("You bring your own keys"), body: t("Add your own AI, Meta and analytics keys. What you use is billed to your own accounts with those providers.") },
    { icon: <IconLock />, title: t("Your workspace is private"), body: t("Your apps, ads and numbers stay in your own workspace. Other accounts can't see them.") },
    { icon: <IconCheckCircle />, title: t("Nothing goes live by itself"), body: t("Ads reach Meta paused. You decide when they run and what they spend.") },
  ];

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
        <div className={cx(wrap, "flex h-14 items-center justify-between gap-3")}>
          <Logo href="/" />
          <nav className="flex min-w-0 items-center gap-1 sm:gap-1.5">
            <LanguageMenu align="end" side="bottom" compact />
            <a href="/login" className={buttonClass("ghost")}>{t("Log in")}</a>
            <a href={start} className={buttonClass("primary")}>{t("Get started")}</a>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className={cx(wrap, "pt-20 pb-16 text-center sm:pt-28 sm:pb-20")}>
          <h1 className="mx-auto max-w-[17ch] text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance text-ink sm:text-[52px]">{t("Grow your app with ads that already work")}</h1>
          <p className="mx-auto mt-5 max-w-[56ch] text-[15px] leading-[23px] text-muted sm:text-base">
            {t("{app} shows you the ads your competitors keep running, makes your own versions, sends them to Meta and tells you what every customer costs and earns.", { app: APP_NAME })}
          </p>
          <div className="mt-8"><StartForm id="start-email" label={t("Email")} button={t("Get started")} /></div>
          <p className="mt-3 text-xs text-muted">{t("Bring your own AI and data keys. Your workspace stays private.")}</p>
        </section>

        <section className={cx(wrap, "pb-16 sm:pb-24")}>
          <p className="mx-auto max-w-[38ch] text-center text-[22px] leading-[1.3] font-semibold tracking-[-0.02em] text-balance text-ink sm:text-[28px]">
            {t("Your competitors already paid to learn which ads work. Start from what they learned.")}
          </p>
        </section>

        <section className={cx(wrap, "grid gap-4 pb-20 md:grid-cols-2 sm:pb-28")} aria-labelledby="features-title">
          <h2 id="features-title" className="sr-only">{t("What you can do")}</h2>
          <Feature n={1} title={t("Research competitors' ads")} body={t("Every ad they run on Meta, sorted by how long they keep paying for it, with the hook, format and placements read for you.")}>
            <ResearchPreview />
          </Feature>
          <Feature n={2} title={t("Make this for your app")} body={t("Pick an ad that works and get your own version: your app, your words, your look, checked before you use it.")}>
            <MakePreview />
          </Feature>
          <Feature n={3} title={t("Launch to Meta")} body={t("Send the creatives you approve to your ad account as a campaign, an ad set and ads. They arrive paused.")}>
            <LaunchPreview />
          </Feature>
          <Feature n={4} title={t("Connect your app's data")} body={t("Bring in Meta spend with your Mixpanel, Superwall and RevenueCat data, so every number is about real customers.")}>
            <SourcesPreview />
          </Feature>
          <Feature n={5} className="md:col-span-2" title={t("Measure CAC, LTV and unit economics")} body={t("What each customer costs, what they pay you over time and what is left after ad costs, per campaign and per day.")}>
            <MeasurePreview />
          </Feature>
        </section>

        <section className="border-y border-line bg-shell">
          <div className={cx(wrap, "py-20 sm:py-24")}>
            <h2 className="text-center text-[24px] leading-[32px] font-semibold tracking-[-0.02em] text-ink sm:text-[30px] sm:leading-[38px]">{t("One system, from research to revenue")}</h2>
            <p className="mx-auto mt-3 max-w-[56ch] text-center text-sm text-muted">{t("Each step feeds the next, so what you learn from your numbers shapes what you research and make next.")}</p>
            <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, i) => (
                <li key={step.title} className="relative rounded-card border border-line bg-card p-5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-7 place-items-center rounded-control bg-accent-soft text-accent [&_svg]:size-3.5">{step.icon}</span>
                    <span className="text-xs text-muted tabular-nums">{i + 1} / 4</span>
                  </div>
                  <h3 className="mt-4 text-sm font-medium text-ink">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={cx(wrap, "py-20 sm:py-24")}>
          <h2 className="text-center text-[24px] leading-[32px] font-semibold tracking-[-0.02em] text-ink sm:text-[30px] sm:leading-[38px]">{t("Your keys, your data")}</h2>
          <div className="mx-auto mt-10 grid max-w-[900px] gap-6 sm:grid-cols-3">
            {trust.map((item) => (
              <div key={item.title}>
                <span className="grid size-7 place-items-center rounded-control border border-line bg-card text-label [&_svg]:size-3.5">{item.icon}</span>
                <h3 className="mt-3 text-sm font-medium text-ink">{item.title}</h3>
                <p className="mt-1 text-sm text-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={cx(wrap, "pb-24 sm:pb-32")}>
          <div className="rounded-frame border border-line bg-card px-5 py-14 text-center sm:py-16">
            <h2 className="text-[24px] leading-[32px] font-semibold tracking-[-0.02em] text-ink sm:text-[30px] sm:leading-[38px]">{t("Start with one competitor")}</h2>
            <p className="mx-auto mt-3 max-w-[48ch] text-sm text-muted">{t("Create your account, describe your app, and see the ads that work in your market.")}</p>
            <div className="mt-7"><StartForm id="end-email" label={t("Email")} button={t("Get started")} /></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={cx(wrap, "flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex items-center gap-4">
            <Logo href="/" />
            <span className="text-xs text-muted">© {new Date().getFullYear()} {APP_NAME}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <a href="/login" className={buttonClass("ghost", "sm")}>{t("Log in")}</a>
            {open && <a href="/signup" className={buttonClass("ghost", "sm")}>{t("Sign up")}</a>}
            <a href="/terms" className={buttonClass("ghost", "sm")}>{t("Terms of Service")}</a>
            <a href="/privacy" className={buttonClass("ghost", "sm")}>{t("Privacy Policy")}</a>
            <LanguageMenu align="end" side="top" />
          </div>
        </div>
      </footer>
    </div>
  );
}
