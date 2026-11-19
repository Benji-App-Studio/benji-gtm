// Shapes shared by the creatives edge function, its tests and the local runner (plain TypeScript,
// no runtime APIs, so Deno and Node both load it).

export type CreativeStyle = "ugc_video" | "ai_video" | "image" | "reddit" | "tweet";
export type Verdict = "pass" | "warn" | "fail";
export type CheckVerdict = Verdict | "skipped";

/** Which category rules apply: health, visas/residency/tax, or general only. */
export type PolicyProfile = "health" | "immigration_tax" | "general";

/** What QA checks a creative against, frozen on the batch when it's created. */
export interface QaContext {
  appName: string;
  /** Other spellings that are still right ("Acme Pro"). */
  aliases?: string[];
  /** Names that must never appear: a former name and the like. */
  blockedNames?: string[];
  competitors: string[];
  policy: PolicyProfile;
  forbiddenClaims: string[];
  /** One line on what the product is, so Jev reads the ad in context. */
  description?: string;
  /** The brand system's closed offer list (exact wordings and names) and what it never offers. */
  offers?: { allowed: string[]; notOffered: string[] };
  /** Words the brand's voice never uses. */
  avoidWords?: string[];
  /**
   * The exact on-image words we asked for (Style Library quotes, template slots, composed copy): the
   * spelling check compares what OCR read against them.
   */
  intendedText?: string[];
  /**
   * Verified facts (the brand system's facts, and offers with a source): any price, %, rating or count
   * on screen or in the ad copy must be one of these numbers or an offer's wording. Absent on older
   * batches (the facts check doesn't run); an empty list means nothing is verified.
   */
  facts?: { label: string; value: string }[];
  /** Brand wording: say `use`, never `avoid` ("licensed provider", not "dermatologist"). */
  substitutions?: { avoid: string; use: string; note?: string }[];
  /** When `when` is said, `phrase` must be said too ("prescription" → "if it's right for you"). */
  requiredPhrases?: { when: string; phrase: string }[];
  /** Person images used as references, with their consent and possible-minor flags (product_assets). */
  people?: { assetId: string; consent: "confirmed" | "unknown" | "not_given"; possibleMinor: boolean }[];
  /** The real logo, for the logo fidelity check. */
  logoUrl?: string;
  /** The batch's Meta placement for safe-zone checks ("stories_reels" when it makes 9:16). */
  placement?: string;
}

/**
 * One line of text read off an image or a video frame: macOS Vision on the runner (measured), or an
 * OpenAI vision model on the server (core/ocr.ts: sizes, contrast and confidence are its estimates).
 */
/** A box on the image as shares of its width and height, origin top-left. */
export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** For video: the second the frame was taken at. */
  at?: number;
}

export interface OcrLine {
  text: string;
  confidence: number;
  /** Line height as a share of the image height. */
  heightFrac: number;
  /** WCAG contrast ratio between the line's darkest and lightest pixels (1–21). */
  contrast: number;
  /** For video: the second the frame was taken at. */
  at?: number;
  /** Where the line is (macOS Vision measures it; the vision model estimates it). Absent on older reads. */
  box?: NormBox;
}

/** A word the vision model judged misspelled (product labels included), with what it should say. */
export interface Misspelling { text: string; suggestion: string }

/** The vision model's comparison of a logo drawn on the image with the brand's real logo file. */
export interface LogoRead {
  /** A logo mark (a symbol or a wordmark) is drawn on the image. */
  visible: boolean;
  /** Whether it is the real logo: "no" means redrawn or altered. */
  matches: "yes" | "no" | "unsure";
  note?: string;
  /** The real logo it was compared with, and the image file read (a new file or logo is compared again). */
  logoUrl: string;
  source?: string;
  model?: string;
  error?: string;
}

export interface OcrResult {
  /** `vision`: the runner's macOS Vision. `openai`: the server's vision model. `none`: nothing was read. */
  engine: "vision" | "openai" | "none";
  frames: number;
  lines: OcrLine[];
  error?: string;
  /** Server reads: the model that read it, and the storage path of the file it read (a new file is read again). */
  model?: string;
  source?: string;
  /** Faces on the image (video: on its frames). Absent when faces weren't looked for. */
  faces?: NormBox[];
  /** Server reads: words the vision model judged misspelled. */
  misspellings?: Misspelling[];
  /** The logo comparison (server, OpenAI vision), when the batch has a real logo and none is placed. */
  logo?: LogoRead;
}

/** Text we know is in a creative because we put it there. */
export interface KnownCopy {
  headline?: string;
  body?: string;
  author?: string;
  community?: string;
  hook?: string;
  /** Template creatives: the smallest font size used, as a share of the image height, and the text/background contrast. */
  minTextFrac?: number;
  contrast?: number;
  /** Composed ads: the words set on the plate (eyebrow, headline, subhead, offer, cta, legal), as last composed. */
  composed?: { copy?: Record<string, unknown> | null } | null;
}

/** One A/B copy variant (creatives.copy_variants). */
export interface CopyVariant { label?: string; voice?: string; primary_text?: string | null; headline?: string | null; description?: string | null }

/** The ad's text outside the image: what Launch sends to Meta. */
export interface AdCopy {
  primaryText?: string | null;
  headline?: string | null;
  description?: string | null;
  variants?: CopyVariant[];
}

export interface QaInput {
  style: CreativeStyle;
  kind: "video" | "image";
  /** "9:16", "4:5"…: decides the safe-zone check. */
  aspect?: string;
  /** What the generator was asked for (for AI media, the closest thing we have to its script). */
  prompt?: string | null;
  copy?: KnownCopy;
  ocr?: OcrResult | null;
  /** Our real logo file is placed on the image (a logo overlay or a composed ad's logo slot): the model drew none. */
  logoPlaced?: boolean;
  /** Our real product is in the picture (product images sent as references, or a composed ad's cut-out): its printed packaging is on the image too. */
  realProduct?: boolean;
  /** Primary text, headline, description and the A/B copy variants. */
  adCopy?: AdCopy;
}

export interface QaCheck {
  id: string;
  label: string;
  verdict: CheckVerdict;
  reason: string;
  /** POLICY.md rule IDs this check covers. */
  rules: string[];
  probability?: number;
  evidence?: string;
}

export interface QaViolation { id: string; where: string; text: string; fix?: string }

export interface QaReport {
  verdict: Verdict;
  checks: QaCheck[];
  /** In POLICY.md's QA output format. */
  violations: QaViolation[];
  needsHuman: string[];
  notes: string[];
  textSeen: string[];
  model?: string;
  tokens?: number;
  ranAt: string;
}
