// The questions the product form asks (onboarding, Add product, Edit), shared with the AI product
// profile: "Replace with AI insight" fills the same fields, with the same option values. The insight
// edge function's schema (supabase/functions/insight/core.ts PRODUCT_ANSWERS) is a twin of these.
import type { ProductKind } from "./db";

export type Question = { key: string; label: string; placeholder?: string; options?: { value: string; label: string }[] };

/** One standard set of questions for every product, plus a few that fit what it is. */
export const KIND_QUESTIONS: Record<ProductKind, Question[]> = {
  saas: [
    { key: "buyerRole", label: "Who buys it?", placeholder: "Founders, marketing managers, recruiters…" },
    { key: "useCase", label: "What job does it do for them?", placeholder: "Book more demos, close the books faster…" },
    { key: "pricingModel", label: "How is it priced?", options: [{ value: "free_trial", label: "Free trial, then paid" }, { value: "freemium", label: "Freemium" }, { value: "subscription", label: "Subscription" }, { value: "contract", label: "Annual contracts / sales-led" }] },
  ],
  mobile_app: [
    { key: "appPlatforms", label: "Which platforms?", options: [{ value: "ios", label: "iOS" }, { value: "android", label: "Android" }, { value: "both", label: "iOS and Android" }] },
    { key: "useCase", label: "What does someone use it for?", placeholder: "Track habits, plan trips, learn Spanish…" },
    { key: "monetization", label: "How does it make money?", options: [{ value: "subscription", label: "Subscription" }, { value: "freemium", label: "Free with paid upgrades" }, { value: "paid", label: "Paid upfront" }, { value: "ads", label: "Ads" }] },
  ],
  physical_product: [
    { key: "productType", label: "What is the product?", placeholder: "Desk lamps, water bottles, phone cases…" },
  ],
  clothing: [
    { key: "style", label: "What style is it?", placeholder: "Streetwear, minimalist basics, athleisure…" },
    { key: "dropModel", label: "How do you release?", options: [{ value: "drops", label: "Limited drops" }, { value: "always_on", label: "Always-on collection" }, { value: "both", label: "Both" }] },
  ],
  food_beverage: [
    { key: "productType", label: "What do you make?", placeholder: "Energy drink, hot sauce, protein bars…" },
    { key: "availability", label: "Where can people get it?", options: [{ value: "online", label: "Online only" }, { value: "stores", label: "In stores" }, { value: "both", label: "Online and in stores" }] },
  ],
  restaurant: [
    { key: "cuisine", label: "What do you serve?", placeholder: "Smash burgers, poke bowls, coffee…" },
    { key: "city", label: "Which city or area?", placeholder: "Austin, London, delivery only…" },
    { key: "locations", label: "How many locations?", options: [{ value: "1", label: "One" }, { value: "2-5", label: "2–5" }, { value: "6+", label: "6 or more" }, { value: "planned", label: "Not open yet" }] },
  ],
  local_service: [
    { key: "serviceType", label: "What service do you offer?", placeholder: "Freight trucking, cleaning, plumbing…" },
    { key: "serviceArea", label: "Where do you operate?", placeholder: "Texas, Greater London, nationwide…" },
  ],
  creator_education: [
    { key: "topic", label: "What do you teach or cover?", placeholder: "Day trading, UX design, fitness…" },
    { key: "format", label: "What do people buy?", options: [{ value: "course", label: "A course" }, { value: "coaching", label: "Coaching" }, { value: "community", label: "A paid community" }, { value: "newsletter", label: "A newsletter" }] },
  ],
  other: [{ key: "productType", label: "In a few words, what is it?", placeholder: "" }],
};

export const PRICES = [{ value: "budget", label: "Budget" }, { value: "mid", label: "Mid-range" }, { value: "premium", label: "Premium" }];
export const SALES = [
  { value: "online_store", label: "Our own website / online store" }, { value: "retail", label: "Shops and retail partners" }, { value: "app_store", label: "App Store / Google Play" },
  { value: "sales_team", label: "A sales team or demos" }, { value: "physical_location", label: "A place people visit" }, { value: "marketplace", label: "Marketplaces (Amazon, Etsy…)" },
];

/** Every kind-specific question, once, by key (with "differentiator", asked for every kind). */
export const ALL_QUESTIONS: Question[] = [
  ...new Map(Object.values(KIND_QUESTIONS).flat().map((q) => [q.key, q])).values(),
  { key: "differentiator", label: "What makes it different?" },
];
