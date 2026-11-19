// Where a probability becomes a decision, per provider.
//
// The TypeSafe numbers are the ones the code always used; they were tuned on Jev's calibrated
// probabilities ("0.7" there means right about 70 times in 100) and are unchanged.
//
// A general model asked for a probability reports its own feeling of confidence, which is not
// calibrated: answers pile up near 0 and 100, the few that land in between collect on round numbers
// (50 above all, its "can't tell"), and a stated 70 to 90 is right less often than it claims. The
// OpenAI numbers below are STARTING VALUES reasoned from that, NOT measured: run
// scripts/ai-calibration.ts on recorded cases and replace them with what it suggests.
import type { AiProvider, Judge } from "./judge.ts";

export interface Thresholds {
  qa: {
    /** A policy check fails at or above this probability of a violation. */
    failAt: number;
    /** …and warns at or above this one. */
    warnAt: number;
    /** A part of a static's pitch counts as missing (a warning) at or above this. */
    missingAt: number;
  };
  discover: {
    /** A judged competitor is pre-selected at or above this expected closeness (0 to 4). */
    preselectSimilarity: number;
  };
  partners: {
    /** A bio counts as declaring a tie to the brand at or above this (the creator is listed). */
    bioDeclared: number;
    /** …and makes the partnership "confirmed" at or above this. */
    bioConfirmed: number;
  };
}

export const THRESHOLDS: Record<AiProvider, Thresholds> = {
  typesafe: {
    qa: { failAt: 0.7, warnAt: 0.35, missingAt: 0.5 },
    discover: { preselectSimilarity: 2.5 },
    partners: { bioDeclared: 0.5, bioConfirmed: 0.6 },
  },
  // NEEDS A TUNING RUN (scripts/ai-calibration.ts). Reasoning for each starting value:
  openai: {
    qa: {
      // Overconfident at the top: a stated 0.7 is right less often than 0.7, so failing needs more.
      failAt: 0.8,
      // Little lands between 0.1 and 0.5, so a stated 0.25 already means the model saw something. A
      // warning costs a person one look; a missed violation costs a rejected ad, so warn early.
      warnAt: 0.25,
      // 0.5 is the model's habitual "can't tell": a threshold right on it would warn on every shrug.
      missingAt: 0.6,
    },
    // An expected score is anchored by the rubric's wording, so it carries over better than a raw
    // probability. Raised a notch so an even split between "related" (2) and "close substitute" (3),
    // which rounds to exactly 2.5, no longer pre-selects.
    discover: { preselectSimilarity: 2.6 },
    // Clear of the 0.5 habit to list a creator; clearly leaning yes to call it confirmed.
    partners: { bioDeclared: 0.6, bioConfirmed: 0.7 },
  },
};

/** True for the providers whose numbers above are reasoned guesses, not yet measured. */
export const NEEDS_TUNING: Record<AiProvider, boolean> = { typesafe: false, openai: true };

/**
 * The thresholds for a provider, or for whoever answers as `judge`. No provider (a test fake, a bare
 * TypeSafe client, older callers) reads as TypeSafe, so nothing changes until a judge says otherwise.
 */
export function thresholdsFor(source?: AiProvider | Pick<Judge, "provider"> | null): Thresholds {
  const provider = typeof source === "string" ? source : source?.provider;
  return THRESHOLDS[provider === "openai" ? "openai" : "typesafe"];
}
