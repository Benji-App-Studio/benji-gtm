// The questions the product form asks (onboarding, Add product, Edit), shared with the AI product
// profile: "Replace with AI insight" fills the same fields, with the same option values. The insight
// edge function's schema (supabase/functions/insight/core.ts PRODUCT_ANSWERS) is a twin of these.
import type { ProductKind } from "./db";
import { m } from "./i18n/translate";

export type Question = { key: string; label: string; placeholder?: string; options?: { value: string; label: string }[] };

/** One standard set of questions for every product, plus a few that fit what it is. */
export const KIND_QUESTIONS: Record<ProductKind, Question[]> = {
  saas: [
    { key: "buyerRole", label: m("Who buys it?"), placeholder: m("Founders, marketing managers, recruiters…") },
    { key: "useCase", label: m("What job does it do for them?"), placeholder: m("Book more demos, close the books faster…") },
    { key: "pricingModel", label: m("How is it priced?"), options: [{ value: "free_trial", label: m("Free trial, then paid") }, { value: "freemium", label: m("Freemium") }, { value: "subscription", label: m("Subscription") }, { value: "contract", label: m("Annual contracts / sales-led") }] },
  ],
  mobile_app: [
    { key: "appPlatforms", label: m("Which platforms?"), options: [{ value: "ios", label: "iOS" }, { value: "android", label: "Android" }, { value: "both", label: m("iOS and Android") }] },
    { key: "useCase", label: m("What does someone use it for?"), placeholder: m("Track habits, plan trips, learn Spanish…") },
    { key: "monetization", label: m("How does it make money?"), options: [{ value: "subscription", label: m("Subscription") }, { value: "freemium", label: m("Free with paid upgrades") }, { value: "paid", label: m("Paid upfront") }, { value: "ads", label: m("Ads") }] },
  ],
  physical_product: [
    { key: "productType", label: m("What is the product?"), placeholder: m("Desk lamps, water bottles, phone cases…") },
  ],
  clothing: [
    { key: "style", label: m("What style is it?"), placeholder: m("Streetwear, minimalist basics, athleisure…") },
    { key: "dropModel", label: m("How do you release?"), options: [{ value: "drops", label: m("Limited drops") }, { value: "always_on", label: m("Always-on collection") }, { value: "both", label: m("Both") }] },
  ],
  food_beverage: [
    { key: "productType", label: m("What do you make?"), placeholder: m("Energy drink, hot sauce, protein bars…") },
    { key: "availability", label: m("Where can people get it?"), options: [{ value: "online", label: m("Online only") }, { value: "stores", label: m("In stores") }, { value: "both", label: m("Online and in stores") }] },
  ],
  restaurant: [
    { key: "cuisine", label: m("What do you serve?"), placeholder: m("Smash burgers, poke bowls, coffee…") },
    { key: "city", label: m("Which city or area?"), placeholder: m("Austin, London, delivery only…") },
    { key: "locations", label: m("How many locations?"), options: [{ value: "1", label: m("One") }, { value: "2-5", label: "2–5" }, { value: "6+", label: m("6 or more") }, { value: "planned", label: m("Not open yet") }] },
  ],
  local_service: [
    { key: "serviceType", label: m("What service do you offer?"), placeholder: m("Freight trucking, cleaning, plumbing…") },
    { key: "serviceArea", label: m("Where do you operate?"), placeholder: m("Texas, Greater London, nationwide…") },
  ],
  creator_education: [
    { key: "topic", label: m("What do you teach or cover?"), placeholder: m("Day trading, UX design, fitness…") },
    { key: "format", label: m("What do people buy?"), options: [{ value: "course", label: m("A course") }, { value: "coaching", label: m("Coaching") }, { value: "community", label: m("A paid community") }, { value: "newsletter", label: m("A newsletter") }] },
  ],
  other: [{ key: "productType", label: m("In a few words, what is it?"), placeholder: "" }],
};

export const PRICES = [{ value: "budget", label: m("Budget-friendly") }, { value: "mid", label: m("Mid-range") }, { value: "premium", label: m("Premium") }];
export const SALES = [
  { value: "online_store", label: m("Our own website / online store") }, { value: "retail", label: m("Shops and retail partners") }, { value: "app_store", label: m("App Store / Google Play") },
  { value: "sales_team", label: m("A sales team or demos") }, { value: "physical_location", label: m("A place people visit") }, { value: "marketplace", label: m("Marketplaces (Amazon, Etsy…)") },
];

/** Every kind-specific question, once, by key (with "differentiator", asked for every kind). */
export const ALL_QUESTIONS: Question[] = [
  ...new Map(Object.values(KIND_QUESTIONS).flat().map((q) => [q.key, q])).values(),
  { key: "differentiator", label: m("What makes it different?") },
];
