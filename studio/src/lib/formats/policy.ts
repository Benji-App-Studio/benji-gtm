// Copy the format, never the asset. Checks a recreated creative before anyone runs it: it must not
// name a competitor (POLICY.md IP-2, IP-5), reuse a run of their exact words (IP-2), or use a phrase
// the workspace rules out (its POLICY.md rule, or the brand kit's forbidden claims). Issues start
// with the rule id, like the QA agent's output.
import type { Claim } from "./angles";
import type { AppContext, FormatCard } from "./types";

const SHINGLE = 6;
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);

function shingles(text: string): Set<string> {
  const list = words(text), out = new Set<string>();
  for (let i = 0; i + SHINGLE <= list.length; i++) out.add(list.slice(i, i + SHINGLE).join(" "));
  return out;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A claim as a whole-word, case-insensitive pattern ("treat*" also matches "treatment"). */
function claimPattern(text: string): RegExp {
  const prefix = text.endsWith("*");
  const stem = prefix ? text.slice(0, -1) : text;
  const lead = /^[\p{L}\p{N}]/u.test(stem) ? "(?<![\\p{L}\\p{N}])" : "";
  const trail = prefix ? "" : /[\p{L}\p{N}]$/u.test(stem) ? "(?![\\p{L}\\p{N}])" : "";
  return new RegExp(`${lead}${escape(stem)}${trail}`, "iu");
}

/** Competitor names and handles a creative must never mention (from the card's examples and the workspace). */
export function namesToAvoid(card: Pick<FormatCard, "examples">, app: Pick<AppContext, "competitorNames" | "brandKit" | "name">): string[] {
  const ours = new Set([app.brandKit.appName, app.name].map((n) => n.toLowerCase()));
  const raw = [...card.examples.map((e) => e.account), ...app.competitorNames];
  const names = raw.flatMap((name) => {
    const clean = name.replace(/^@/, "").trim();
    // "@rivalhandle" is matched as is; "Rival Days" also as its words joined.
    return [clean, clean.replace(/[\s_.-]+/g, "")];
  });
  return [...new Set(names.filter((n) => n.length >= 3 && !ours.has(n.toLowerCase())))];
}

/**
 * What's wrong with a creative's text, if anything. Empty means it's safe to run. Names and copied
 * lines are checked everywhere (the prompt too); ruled-out claims only in what viewers see or hear
 * (`viewer`), since the prompt itself says what the presenter must not be.
 */
export function policyIssues(texts: string[], card: Pick<FormatCard, "examples" | "hookLine">, app: Pick<AppContext, "competitorNames" | "brandKit" | "name">, claims: Claim[], viewer: string[] = texts): string[] {
  const text = texts.filter(Boolean).join("\n");
  const issues: string[] = [];
  for (const name of namesToAvoid(card, app)) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])@?${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) issues.push(`IP-5: Names a competitor or their creator (“${name}”).`);
  }
  const ours = new Set<string>();
  for (const t of texts) shingles(t).forEach((s) => ours.add(s));
  for (const source of [card.hookLine, ...card.examples.map((e) => e.hook)]) {
    const hit = [...shingles(source)].find((s) => ours.has(s));
    if (hit) { issues.push(`IP-2: Reuses ${SHINGLE}+ words of a competitor's line (“${hit}…”). Rewrite it in your own words.`); break; }
  }
  const seen = viewer.filter(Boolean).join("\n");
  for (const claim of claims) {
    if (claim.text.trim() && claimPattern(claim.text).test(seen)) issues.push(`${claim.rule}: Uses “${claim.text.replace(/\*$/, "…")}”, which the policy rules out.`);
  }
  return issues;
}
