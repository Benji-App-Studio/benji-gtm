// The first step: from a founder's few lines about their product, Jev works out the category, the
// customer, the price tier, where it sells and which channels matter, then picks the search
// keywords most likely to surface competitors. Jev doesn't write; it chooses among options here.
import type { Judge } from "../../_shared/ai/judge.ts";
import { choice, noul, score } from "../../_shared/ai/questions.ts";
import type { Platform } from "./types.ts";

export interface Question { key: string; label: string; placeholder?: string; kind: "text" | "textarea" | "select"; options?: { value: string; label: string }[] }

interface Category { label: string; keywords: string[]; questions: Question[] }

export const CATEGORIES: Record<string, Category> = {
  apparel: { label: "Clothing & apparel", keywords: ["streetwear brand", "t-shirt brand", "clothing brand", "graphic tees", "sustainable fashion brand", "athleisure brand", "hoodie brand"],
    questions: [{ key: "style", label: "What style is it?", placeholder: "Streetwear, minimalist basics, athleisure…", kind: "text" }] },
  beverage: { label: "Drinks & beverages", keywords: ["energy drink", "energy drink brand", "sparkling water brand", "functional beverage", "healthy soda", "protein drink", "coffee brand", "tea brand"],
    questions: [{ key: "productType", label: "What kind of drink?", placeholder: "Energy drink, sparkling water, cold brew…", kind: "text" }] },
  food_brand: { label: "Packaged food & snacks", keywords: ["healthy snacks", "snack brand", "protein bar", "granola brand", "hot sauce brand", "candy brand", "chips brand"],
    questions: [{ key: "productType", label: "What kind of food?", placeholder: "Protein bars, hot sauce, chips…", kind: "text" }] },
  restaurant: { label: "Restaurant or food chain", keywords: ["burger restaurant", "fast casual restaurant", "pizza restaurant", "coffee shop", "food truck", "dessert shop", "sushi restaurant"],
    questions: [
      { key: "cuisine", label: "What do you serve?", placeholder: "Smash burgers, poke bowls, coffee…", kind: "text" },
      { key: "city", label: "Which city or area?", placeholder: "Austin, London, online delivery only…", kind: "text" },
    ] },
  consumer_app: { label: "Consumer app", keywords: ["productivity app", "habit tracker app", "budgeting app", "travel app", "fitness app", "dating app", "language learning app", "ai app"],
    questions: [{ key: "useCase", label: "What does someone use it for?", placeholder: "Track habits, plan trips, learn Spanish…", kind: "text" }] },
  b2b_software: { label: "B2B software / SaaS", keywords: ["b2b saas", "saas startup", "ai tool for business", "crm software", "marketing software", "sales software", "developer tools"],
    questions: [
      { key: "buyerRole", label: "Who buys it?", placeholder: "Founders, marketing managers, recruiters…", kind: "text" },
      { key: "useCase", label: "What job does it do for them?", placeholder: "Book more demos, close the books faster…", kind: "text" },
    ] },
  beauty: { label: "Beauty & skincare", keywords: ["skincare brand", "clean beauty brand", "makeup brand", "haircare brand", "fragrance brand", "nail polish brand"],
    questions: [{ key: "productType", label: "What kind of product?", placeholder: "Serum, lip balm, shampoo…", kind: "text" }] },
  fitness_health: { label: "Fitness & wellness", keywords: ["fitness brand", "supplement brand", "protein powder", "gym wear brand", "wellness brand", "creatine"],
    questions: [{ key: "productType", label: "What kind of product?", placeholder: "Pre-workout, yoga mats, online coaching…", kind: "text" }] },
  home_goods: { label: "Home & lifestyle", keywords: ["home decor brand", "candle brand", "kitchenware brand", "furniture brand", "bedding brand"],
    questions: [{ key: "productType", label: "What kind of product?", placeholder: "Candles, cookware, rugs…", kind: "text" }] },
  creator_education: { label: "Course, coaching or community", keywords: ["online course", "coaching business", "paid community", "newsletter", "cohort course"],
    questions: [{ key: "topic", label: "What do you teach or cover?", placeholder: "Day trading, UX design, fitness…", kind: "text" }] },
  other: { label: "Something else", keywords: ["startup", "new brand", "small business"],
    questions: [{ key: "productType", label: "In a few words, what is it?", placeholder: "", kind: "text" }] },
};

const CUSTOMERS = { consumers: "Sold to individual people (consumers).", businesses: "Sold to companies or professionals.", both: "Sold to both people and businesses." };
const PRICES = { budget: "Budget or mass-market prices.", mid: "Mid-range prices.", premium: "Premium or luxury prices.", unknown: "Not clear from the description." };
const SALES = {
  online_store: "Their own online store or website (direct to consumer).",
  retail: "Shops, supermarkets or retail partners.",
  app_store: "The App Store or Google Play.",
  sales_team: "A sales team, demos or contracts.",
  physical_location: "A physical location people visit (restaurant, studio, shop).",
  marketplace: "Marketplaces like Amazon, Etsy or Shopify stores of others.",
};

export const COMMON_QUESTIONS: Question[] = [
  { key: "audience", label: "Who is it for?", placeholder: "Gen Z gamers, busy parents, finance teams…", kind: "text" },
  { key: "price", label: "Price point", kind: "select", options: Object.entries(PRICES).filter(([k]) => k !== "unknown").map(([value, label]) => ({ value, label: label.replace(/ prices\.$/, "").replace(/\.$/, "") })) },
  { key: "salesChannel", label: "Where do people buy it?", kind: "select", options: Object.entries(SALES).map(([value, label]) => ({ value, label: label.replace(/\.$/, "") })) },
  { key: "region", label: "Which market?", placeholder: "Worldwide, US, UK, India…", kind: "text" },
  { key: "knownCompetitors", label: "Competitors you already know (optional)", placeholder: "@celsiusofficial, Liquid Death, monster.energy…", kind: "textarea" },
];

const CHANNEL_QUESTION: Record<Platform, string> = {
  instagram: "Instagram (reels and posts)", tiktok: "TikTok", youtube: "YouTube Shorts", x: "X (Twitter)", linkedin: "LinkedIn",
};

/** Two- and three-word phrases from the description (never the product's own name), as extra keyword candidates. */
function phrases(text: string, name: string): string[] {
  const own = new Set(name.toLowerCase().split(/\s+/));
  const stop = new Set("a an the and or for of to in on with my our your is are it its this that we i you they be by at as from into who what which how app brand product new".split(" "));
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (gram.some((word) => stop.has(word) || own.has(word))) continue;
      out.add(gram.join(" "));
    }
  }
  return [...out].slice(0, 16);
}

export interface Intake {
  category: string;
  categoryLabel: string;
  categoryConfidence: number;
  guesses: Record<string, string>;
  platformScores: Record<Platform, number>;
  questions: Question[];
  keywords: { keyword: string; fit: number }[];
}

export async function runIntake(client: Judge, input: { name: string; description: string; website?: string; kind?: string }): Promise<Intake> {
  const product = { name: input.name, description: input.description, website: input.website ?? null, ...(input.kind ? { founder_says_it_is: input.kind.replace(/_/g, " ") } : {}) };
  const channelQuestions = Object.fromEntries(Object.entries(CHANNEL_QUESTION).map(([platform, label]) => [
    `channel_${platform}`,
    score(`How important is ${label} as a channel for reaching the buyers of \`product\`?`, [
      "Irrelevant: its buyers aren't there.", "Minor.", "Useful.", "Important.", "Essential: where this kind of product wins its customers.",
    ]),
  ]));
  const first = await client.systemOne({
    state: { product },
    questions: {
      category: choice("Which category best describes `product`?", Object.fromEntries(Object.entries(CATEGORIES).map(([id, c]) => [id, c.label]))),
      customer: choice("Who buys `product`?", CUSTOMERS),
      price: choice("What price tier is `product`?", PRICES),
      sales: choice("Where do people most likely buy `product`?", SALES),
      ...channelQuestions,
    },
  });
  const answers = first.answers as unknown as Record<string, { choice: string; confidence: number; score: number }>;
  const category = answers.category.choice as string;
  const pool = [...new Set([...CATEGORIES[category].keywords, ...phrases(input.description, input.name)])];
  const second = await client.systemOne({
    state: { product, category: CATEGORIES[category].label },
    questions: Object.fromEntries(pool.map((keyword, i) => [`k${i}`, noul(
      `Would searching Instagram or TikTok for "${keyword}" surface brands or businesses that compete with \`product\` for the same customers?`,
    )])),
  });
  const fits = second.answers as Record<string, { noul: number }>;
  const keywords = pool.map((keyword, i) => ({ keyword, fit: fits[`k${i}`].noul })).sort((a, b) => b.fit - a.fit);
  return {
    category,
    categoryLabel: CATEGORIES[category].label,
    categoryConfidence: answers.category.confidence,
    guesses: {
      audience: { consumers: "Consumers", businesses: "Businesses", both: "Consumers and businesses" }[answers.customer.choice as "consumers"] ?? "",
      price: answers.price.choice === "unknown" ? "mid" : answers.price.choice,
      salesChannel: answers.sales.choice,
      region: "Worldwide",
    },
    platformScores: Object.fromEntries(Object.keys(CHANNEL_QUESTION).map((p) => [p, Math.round(answers[`channel_${p}`].score * 10) / 10])) as Record<Platform, number>,
    questions: [...CATEGORIES[category].questions, ...COMMON_QUESTIONS],
    keywords: keywords.slice(0, 12),
  };
}
