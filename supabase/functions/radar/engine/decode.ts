// The judge (_shared/ai: OpenAI, or TypeSafe's Jev) decodes every post in one call each: its format,
// whether it names a product, its hook, the job each sentence of its script does (hook, setup, method,
// CTA…) and what's on screen meanwhile, and what each comment is about. Every question about a post
// goes in that one call (on OpenAI the judge splits a long script into a few parallel requests).
import { accountError, type Judge, type JudgeError } from "../../_shared/ai/judge.ts";
import { choice, noul, type Questions } from "../../_shared/ai/questions.ts";
import { NO_FORMAT } from "./formats.ts";
import type { Decoded, Format, Reel, Role, Workflow } from "./types.ts";

const MAX_SENTENCES = 30;
const MAX_COMMENTS = 30;

// What kind of opening the post uses: its first spoken line, or the caption's first line when silent.
export const HOOK_TYPES = {
  question: "Opens with a question to the viewer ('Did you know...?', 'Want to...?').",
  bold_claim: "Opens with a bold or surprising claim ('I pay zero tax', 'This app is insane').",
  number_list: "Opens by promising a number of things ('3 mistakes...', '5 countries...').",
  story: "Opens mid-story or with a personal event ('I overstayed my visa by 2 days').",
  pov: "Opens with a POV, scene or relatable situation ('POV: ...', 'When the officer asks...').",
  warning: "Opens with a warning or 'stop doing this' ('Don't make this mistake').",
  news: "Opens with news or a change ('Breaking:', 'Starting August...', 'X just announced').",
  how_to: "Opens by promising to show how ('Here's how to...', 'How I got...').",
  curiosity_gap: "Opens with a tease that withholds the answer ('Nobody talks about this', 'Wait for it').",
  other: "None of these: a greeting, music only, or no clear hook.",
};

// What viewers are most likely seeing while each line is said (from the script; Jev doesn't see the video).
export const VISUALS = {
  talking_head: "The creator talking to camera.",
  screen_demo: "A screen recording or app/website demo.",
  product_shot: "The product shown, held or used up close.",
  text_on_screen: "Text, a list or a graphic on screen carries the point.",
  broll: "Lifestyle, location or travel footage over the voice-over.",
  proof_shot: "A result or proof shown: numbers, a screenshot, a before/after.",
  reaction: "Reacting to or stitching another clip, comment or headline.",
  skit: "An acted scene, POV or sketch.",
};

// What a comment is about, for audience insights.
export const COMMENT_THEMES = {
  buy_intent: "Wants to buy, try or sign up: asks for the link, price or where to get it, or says they bought, ordered or downloaded it.",
  how_question: "Asks how it works, how to do it, or for details or steps.",
  objection: "A doubt, objection or complaint: too expensive, doesn't work, looks like a scam, a bad experience.",
  feature_request: "Wishes it did something else, or asks for a version, feature, size or flavour.",
  relates: "Relates personally: shares their own story, situation or problem.",
  tag_friend: "Tags or mentions someone else to show them.",
  praise: "Praise or excitement without a question.",
  skeptic: "Disagrees with the claim or corrects the creator.",
  other: "Jokes, emojis only, spam or off-topic.",
};

const COMPETITORS_NICHE = "The rules of living and travelling abroad: visas and digital nomad visas, stay limits like Schengen 90/180, overstays, residency and citizenship routes, tax residency and the 183-day rule, border systems, and tracking days or trips abroad.";

/**
 * Decodes posts for one workflow against its formats. `ad`: the posts are paid ads, which always sell
 * something and whose shots the scan reads from the video itself, so "does it mention a product" and
 * "what's on screen" aren't asked.
 */
export function decoder(client: Judge, workflow: Workflow, formats: Format[], o: { ad?: boolean } = {}) {
  // Campaigns look for the brand; elsewhere any app, tool or service counts, named or not
  // ("I use an app that counts it", "this free tool").
  const brand = workflow.mode === "campaign" || workflow.mode === "project" ? workflow.brand : undefined;
  const product = brand
    ? `the brand ${brand}`
    : "an app, tool, website or service, named or unnamed (\"I use an app that...\", \"this free tool\")";

  const formatCriteria = Object.fromEntries([
    ...formats.map((format) => [format.id, `${format.name}: ${format.description}`]),
    [NO_FORMAT, "None of the other formats fits: a one-off, a plain post, or a mix with no clear template."],
  ]);

  const roleCriteria: Record<Role, string> = {
    hook: "The opening line or claim meant to stop the scroll and make the viewer keep watching.",
    setup: "Context, the problem, a story or the situation that leads into the point.",
    product: `Mentions, shows or recommends ${product}.`,
    method: "The actual tip, steps, instructions or how it works.",
    benefit: "The result, outcome or what the viewer gains.",
    proof: "Evidence: numbers, a result shown, a testimonial or credentials.",
    cta: "Asks the viewer to act: follow, comment, save, share, click a link or download.",
    other: "Filler, a joke aside, or anything that does none of the above.",
  };

  // Keyword searches pull in strays; competitors' own posts are always kept.
  const judgesTopic = (reel: Reel) => workflow.mode === "competitors" || (workflow.mode === "project" && Boolean(reel.niche));

  function questions(reel: Reel, sentences: string[]): Questions {
    const asked: Questions = {
      ...(reel.topComments?.length ? {
        // The closest public signal to conversion: viewers asking for the link or price, or saying they bought.
        buyer_intent: noul(
          "Do the viewer comments in `comments` show people wanting to buy, try or sign up for what the post shows (asking for the link, price or where to get it, or saying they bought, ordered or downloaded it)?",
          { true: "Several comments show buying or trying intent.", false: "Comments are reactions, jokes, opinions or unrelated; no real intent to buy or try." },
        ),
      } : {}),
      format: choice(
        "Which recurring content format does this reel follow? Judge the premise and structure of the whole reel from `caption` and `script`, not its topic.",
        formatCriteria,
      ),
      ...(o.ad ? {} : { mentions_product: noul(`Does this reel mention ${product}? Use \`caption\` and \`script\`.`) }),
      hook_type: choice(
        "What kind of hook opens this reel? Judge `script[0]` (its first spoken line), or the first line of `caption` if the reel has no speech.",
        HOOK_TYPES,
      ),
    };
    if (judgesTopic(reel)) {
      asked.on_topic = noul(
        "Is this reel about the niche described in `niche`? Use `caption` and `script`; the script may be in any language or be song lyrics.",
        workflow.mode === "competitors" ? {
          true: "Mainly about visas, residency, citizenship, immigration, border or stay rules, overstays, or tax residency for people living, working or travelling abroad; or an app for logging trips, countries visited or days abroad.",
          false: "Mainly about something else that only matched a keyword: budgeting or expense apps, general tax tips not tied to living abroad, gadgets, or sightseeing.",
        } : {
          true: "About the topics in `niche`, or aimed at the same buyers and their related needs: content those buyers would watch, even if it never mentions a product.",
          false: "About something unrelated that only shares a word with the search terms (a different product category, audience or subject).",
        },
      );
    }
    const video = !o.ad && reel.platform !== "x" && reel.platform !== "linkedin";
    sentences.forEach((_, index) => {
      asked[`role_${index}`] = choice(
        `In the reel's script, what job does sentence \`script[${index}]\` do? Read it in the context of the whole \`script\`.`,
        roleCriteria,
      );
      if (video) {
        asked[`visual_${index}`] = choice(
          `While \`script[${index}]\` is said, what are viewers most likely seeing? Infer from the words, the caption and the whole \`script\`.`,
          VISUALS,
        );
      }
    });
    (reel.topComments ?? []).slice(0, MAX_COMMENTS).forEach((_, index) => {
      asked[`comment_${index}`] = choice(`What is viewer comment \`comments[${index}]\` about, in reply to this post?`, COMMENT_THEMES);
    });
    return asked;
  }

  async function decode(reel: Reel): Promise<Decoded> {
    const segments = reel.transcript.slice(0, MAX_SENTENCES);
    const sentences = segments.map((segment) => segment.text);
    const { answers, usage } = await client.systemOne({
      state: {
        creator: `@${reel.owner}`,
        platform: reel.platform ?? "instagram",
        ...(o.ad
          ? { note: "A paid ad: `caption` is its ad copy (headline, primary text, button); `script` is what's said in its video, or its copy's sentences when nothing is said." }
          : reel.platform === "x" || reel.platform === "linkedin" ? { note: "A text post: `script` is the post's sentences, `caption` its full text." } : {}),
        ...(reel.topComments?.length ? { comments: reel.topComments.slice(0, MAX_COMMENTS) } : {}),
        caption: reel.caption.slice(0, 1500),
        duration_seconds: reel.durationSec,
        script: sentences.length ? sentences : ["(no speech: the reel is music or on-screen text only)"],
        ...(workflow.mode === "competitors" ? { niche: COMPETITORS_NICHE } : {}),
        ...(workflow.mode === "project" && reel.niche ? { niche: `The niche around this product: ${workflow.productDescription}${workflow.audience ? ` Its buyers: ${workflow.audience}.` : ""} Search terms: ${(workflow.keywords ?? []).join(", ")}.` } : {}),
      },
      questions: questions(reel, sentences),
    });
    const format = answers.format as { choice: string; confidence: number; probabilities: Record<string, number> };
    return {
      id: reel.id,
      format: format.choice,
      formatConfidence: format.confidence,
      formatProbabilities: format.probabilities,
      mentionsProduct: answers.mentions_product ? (answers.mentions_product as { noul: number }).noul : null,
      onTopic: answers.on_topic ? (answers.on_topic as { noul: number }).noul : null,
      hookType: (answers.hook_type as { choice: string }).choice,
      buyerIntent: answers.buyer_intent ? (answers.buyer_intent as { noul: number }).noul : null,
      comments: (reel.topComments ?? []).slice(0, MAX_COMMENTS).map((text, index) => ({ text, theme: (answers[`comment_${index}`] as { choice: string }).choice })),
      roles: segments.map((segment, index) => {
        const role = answers[`role_${index}`] as { choice: Role; confidence: number };
        const visual = answers[`visual_${index}`] as { choice: string } | undefined;
        return { text: segment.text, start: segment.start, role: role.choice, confidence: role.confidence, ...(visual ? { visual: visual.choice } : {}) };
      }),
      inputTokens: usage.input_tokens,
    };
  }

  /**
   * Decodes `reels` a few at a time. `onDecoded` fires after each one (for progress and saving);
   * a post that fails twice is skipped, so one bad post never sinks a run.
   */
  async function decodeAll(reels: Reel[], o: { concurrency?: number; onDecoded?: (result: Decoded) => void | Promise<void>; onFailed?: (reel: Reel, error: unknown) => void; shouldStop?: () => boolean } = {}) {
    const queue = [...reels];
    let tokens = 0, failed = 0;
    // A refused key (revoked, out of credit) stops every lane and is thrown: skipping each post would
    // turn it into a run with no breakdowns and no reason.
    let refused: JudgeError | null = null;
    await Promise.all(Array.from({ length: o.concurrency ?? 8 }, async () => {
      for (let reel = queue.shift(); reel && !refused; reel = queue.shift()) {
        if (o.shouldStop?.()) return;
        let result: Decoded | null = null;
        for (let attempt = 0; attempt < 2 && !result && !refused; attempt++) {
          try {
            result = await decode(reel);
          } catch (error) {
            refused ??= accountError(error, client.provider);
            if (attempt === 1 && !refused) { failed++; o.onFailed?.(reel, error); }
          }
        }
        if (result) {
          tokens += result.inputTokens;
          await o.onDecoded?.(result);
        }
      }
    }));
    if (refused) throw refused;
    return { tokens, failed };
  }

  return { decode, decodeAll };
}
