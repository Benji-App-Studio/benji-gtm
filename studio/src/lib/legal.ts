// The Terms and Privacy pages (/terms, /privacy): their text lives in studio/content/legal/<doc>.<locale>.md
// and is shown by components/legal-page.tsx.
//
// The text is a DRAFT template until whoever runs the deployment has it reviewed and fills in the
// [BRACKETED] placeholders. While LEGAL_FINAL is false the pages show a "Draft" banner and ask search
// engines not to index them. Set it to true only once the reviewed text is in place.
//
// Languages: only English is written (legal text should be translated after it is reviewed, not before,
// so every language says the same reviewed thing). A page in another language shows the English text
// with a note saying so; drop a reviewed `<doc>.<locale>.md` next to the English file to serve that
// language instead.
//
// Plain TypeScript (legal.test.ts): the markdown subset the files use (headings, paragraphs, "- " lists,
// **bold** and [links](https://…)) is parsed here into blocks; nothing is ever rendered as raw HTML.
import { APP_NAME, CONTACT_EMAIL, isRealContact } from "./brand-config";

/** Flip to true once the reviewed legal text replaces the draft: removes the banner and lets the pages be indexed. */
export const LEGAL_FINAL = false;

export const LEGAL_DOCS = ["terms", "privacy"] as const;
export type LegalDoc = typeof LEGAL_DOCS[number];

export type Inline = { text: string; bold?: boolean; href?: string };
export type Block =
  | { kind: "h1" | "h2" | "h3"; inline: Inline[] }
  | { kind: "p"; inline: Inline[] }
  | { kind: "ul"; items: Inline[][] };

/** The placeholders the files use: {{app}} and {{contact}} (CONTACT_EMAIL, or a bracketed reminder while it is the example address). */
export function fillLegal(markdown: string, contact = CONTACT_EMAIL): string {
  const address = isRealContact(contact) ? contact : "[CONTACT EMAIL: set CONTACT_EMAIL in studio/src/lib/brand-config.ts]";
  return markdown.replaceAll("{{app}}", APP_NAME).replaceAll("{{contact}}", address);
}

/** A web or mail link, or a path on this site ("/x", never "//host" or "/\host", which browsers read as another site). */
const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?![/\\]))/i;

/** **bold**, [text](link) and bare email addresses (as mailto links); everything else is plain text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    if (match[1] !== undefined) out.push({ text: match[1], bold: true });
    else if (match[2] !== undefined) out.push(SAFE_HREF.test(match[3]) ? { text: match[2], href: match[3] } : { text: match[2] });
    else out.push({ text: match[4], href: `mailto:${match[4]}` });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The blocks of a markdown file: "#", "##", "###" headings, "- " lists, and paragraphs split by blank lines. */
export function parseLegal(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", inline: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ kind: "ul", items: list.map(parseInline) });
    paragraph = [];
    list = null;
  };
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line) { flush(); continue; }
    if (heading) {
      flush();
      blocks.push({ kind: (["h1", "h2", "h3"] as const)[heading[1].length - 1], inline: parseInline(heading[2]) });
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (paragraph.length) { blocks.push({ kind: "p", inline: parseInline(paragraph.join(" ")) }); paragraph = []; }
      (list ??= []).push(item[1]);
      continue;
    }
    // A line under a list item continues it; otherwise it is part of the paragraph.
    if (list) list[list.length - 1] += ` ${line}`;
    else paragraph.push(line);
  }
  flush();
  return blocks;
}

/** The file to read for a document in a language: the language's own if it exists, else English. */
export function legalFile(doc: LegalDoc, locale: string, exists: (name: string) => boolean): { file: string; translated: boolean } {
  const own = `${doc}.${locale}.md`;
  if (locale !== "en" && exists(own)) return { file: own, translated: true };
  return { file: `${doc}.en.md`, translated: locale === "en" };
}
