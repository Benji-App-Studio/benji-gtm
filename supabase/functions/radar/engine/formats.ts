// Formats a run sorts posts into: a library of common short-form formats; Jev picks the closest for
// each post. Unused ones simply stay empty.
import type { Format } from "./types.ts";

export const NO_FORMAT = "no_clear_format";

export const LIBRARY: Format[] = [
  { id: "storytime", name: "storytime / it happened to me", description: "A first-person story told as it unfolds or looking back (a mistake, a win, something that went wrong), turning into a lesson or warning." },
  { id: "how_to_steps", name: "how to, step by step", description: "Teaches how to do one thing in numbered or clear steps the viewer can follow." },
  { id: "proof_then_method", name: "I did X, here's how", description: "Opens with a result the creator achieved ('I got...', 'I made...', 'I did it in 3 days'), then shows the method." },
  { id: "listicle", name: "N things / ranked list", description: "A numbered list or ranking: tips, places, tools, mistakes, options." },
  { id: "myth_vs_reality", name: "myth vs reality", description: "Names a common belief or mistake and corrects it ('stop doing X', 'X is NOT true', 'everyone gets this wrong')." },
  { id: "news_update", name: "breaking news / update", description: "Announces something new or just changed (a law, a launch, a trend, a price) and what it means for the viewer." },
  { id: "explainer", name: "explainer", description: "Explains how something works or what a concept means, plainly, without a personal story or list." },
  { id: "expert_answers", name: "the expert answers", description: "A professional or authority introduces their credentials and answers a common or viewer question." },
  { id: "hack_or_secret", name: "hack / secret nobody tells you", description: "Frames a tip as a little-known hack, loophole or secret ('nobody talks about this', 'gatekept')." },
  { id: "comparison", name: "this vs that", description: "Compares two or more options side by side and picks or weighs them." },
  { id: "pov_skit", name: "POV / relatable skit", description: "A short acted scene, POV or meme about a relatable situation, light on explanation." },
  { id: "day_in_life", name: "day in the life / series episode", description: "A diary-style episode of the creator's day or routine, often numbered ('day 12 of...')." },
  { id: "reaction", name: "reaction / stitch", description: "Reacts to, stitches or responds to another video, comment or headline." },
  { id: "silent_text", name: "silent text-on-screen", description: "Music only or almost no speech: the message is in on-screen text and the caption, meant to be saved." },
  { id: "product_demo", name: "product demo / review", description: "Shows a specific app, product or service in use, demos what it does or reviews it." },
  { id: "ugc_testimonial", name: "UGC testimonial", description: "A creator talks to camera about how a product or brand helped them, in a casual first-person way, usually with a link or code." },
  { id: "challenge_or_test", name: "challenge / I tested it", description: "The creator tries something (a method, a product, a challenge) and shows what happened." },
  { id: "behind_the_scenes", name: "behind the scenes / build in public", description: "Shows how something is made or built, the process, numbers or the team behind it." },
  { id: "motivational", name: "motivation / mindset", description: "An inspirational or mindset message, often over b-roll, about freedom, discipline or a life change." },
];
