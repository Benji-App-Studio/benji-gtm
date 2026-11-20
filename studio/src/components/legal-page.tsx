import "server-only";
// /terms and /privacy: the text from studio/content/legal (lib/legal.ts), in the landing page's frame (the
// same header, column width and footer), with the "Draft" banner while LEGAL_FINAL is false and a note on
// pages in a language the text isn't written in yet.
import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { getTranslator } from "@/lib/i18n/server";
import { type Block, fillLegal, type Inline, LEGAL_FINAL, type LegalDoc, legalFile, parseLegal } from "@/lib/legal";
import { LanguageMenu } from "./language-menu";
import { Logo } from "./logo";
import { buttonClass, cx } from "./ui";

/**
 * Where the files are: the app folder at run time, or studio/ from the repository root. The folder is
 * traced into the build by next.config.ts (outputFileTracingIncludes), so the bundler is told not to
 * trace these reads itself (it would otherwise take in the whole project).
 */
function legalDir(): string {
  for (const dir of [path.join(/*turbopackIgnore: true*/ process.cwd(), "content", "legal"), path.join(/*turbopackIgnore: true*/ process.cwd(), "studio", "content", "legal")]) {
    if (fs.existsSync(/*turbopackIgnore: true*/ dir)) return dir;
  }
  throw new Error("The legal texts are missing (studio/content/legal).");
}

function readLegal(doc: LegalDoc, locale: string) {
  const dir = legalDir();
  const { file, translated } = legalFile(doc, locale, (name) => fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, name)));
  return { blocks: parseLegal(fillLegal(fs.readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ dir, file), "utf8"))), translated };
}

export async function legalMetadata(doc: LegalDoc): Promise<Metadata> {
  const { t } = await getTranslator();
  return {
    title: doc === "terms" ? t("Terms of Service") : t("Privacy Policy"),
    // Kept out of search results until the reviewed text replaces the draft.
    robots: LEGAL_FINAL ? undefined : { index: false, follow: false },
  };
}

const wrap = "mx-auto w-full max-w-[1080px] px-4 sm:px-6";

function Text({ inline }: { inline: Inline[] }) {
  return <>{inline.map((part, i) => {
    let node: ReactNode = part.text;
    if (part.bold) node = <strong className="font-medium text-ink">{node}</strong>;
    if (part.href) node = <a href={part.href} className="font-medium text-accent [overflow-wrap:anywhere] hover:underline">{node}</a>;
    return <Fragment key={i}>{node}</Fragment>;
  })}</>;
}

function Render({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, i) => {
    switch (block.kind) {
      case "h1": return <h1 key={i} className="text-[28px] leading-[1.2] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]"><Text inline={block.inline} /></h1>;
      case "h2": return <h2 key={i} className="mt-10 text-[17px] leading-[25px] font-medium text-ink"><Text inline={block.inline} /></h2>;
      case "h3": return <h3 key={i} className="mt-6 text-[15px] font-medium text-ink"><Text inline={block.inline} /></h3>;
      case "ul": return <ul key={i} className="mt-3 grid list-disc gap-1.5 pl-5">{block.items.map((item, j) => <li key={j}><Text inline={item} /></li>)}</ul>;
      default: return <p key={i} className="mt-3"><Text inline={block.inline} /></p>;
    }
  })}</>;
}

export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, locale } = await getTranslator();
  const { blocks, translated } = readLegal(doc, locale);
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
        <div className={cx(wrap, "flex h-14 items-center justify-between gap-3")}>
          <Logo href="/" />
          <nav className="flex items-center gap-1.5">
            <a href="/login" className={buttonClass("ghost")}>{t("Log in")}</a>
          </nav>
        </div>
      </header>

      <main className={cx(wrap, "flex-1 py-12 sm:py-16")}>
        <div className="mx-auto max-w-[720px]">
          {!LEGAL_FINAL && (
            <p role="note" className="mb-8 rounded-card border border-caution/40 bg-caution-soft px-4 py-3 text-sm font-medium text-caution-ink">
              {t("Draft — replace with your reviewed legal text before launch.")}
            </p>
          )}
          {!translated && (
            <p role="note" lang={locale} className="mb-8 rounded-card border border-line bg-card px-4 py-3 text-sm text-label">
              {t("This page is available in English only for now. The English text is the one that applies.")}
            </p>
          )}
          <article lang={translated ? locale : "en"} className="text-sm leading-[22px] text-label">
            <Render blocks={blocks} />
          </article>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className={cx(wrap, "flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex items-center gap-4">
            <Logo href="/" />
            <span className="text-xs text-muted">© {new Date().getFullYear()} {APP_NAME}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <a href="/terms" className={buttonClass("ghost", "sm")}>{t("Terms of Service")}</a>
            <a href="/privacy" className={buttonClass("ghost", "sm")}>{t("Privacy Policy")}</a>
            <LanguageMenu align="end" side="top" />
          </div>
        </div>
      </footer>
    </div>
  );
}
