"use client";
// The navigation's words in the viewer's language. The model (lib/nav-model.ts) holds only keys and
// addresses; each label is written out here as a t() call, so the translation check can see it.
import { Fragment, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import type { AppSection, AppSettingsTab, ResearchTab, StudioTab } from "@/lib/nav-model";

export function useNavLabels() {
  const { t } = useT();
  const section: Record<AppSection, string> = {
    home: t("Home"), research: t("Research"), studio: t("Studio"), launch: t("Launch"), measure: t("Measure"), settings: t("App settings"),
  };
  /** One line each: what the section is for (the Help panel and the command menu's hints). */
  const blurb: Record<AppSection, string> = {
    home: t("How the app is doing, and the one thing to do next."),
    research: t("The ads, apps and posts that work for your competitors."),
    studio: t("Make your own ads from what works, in your brand."),
    launch: t("Send approved ads to your Meta ad account, paused until you switch them on."),
    measure: t("What your ads cost next to what customers pay you."),
    settings: t("The app's profile, brand and connected accounts."),
  };
  const research: Record<ResearchTab, string> = { ads: t("Ads"), "app-store": t("App stores"), social: t("Social posts") };
  const studio: Record<StudioTab, string> = { create: t("Create"), remix: t("Remix"), templates: t("Templates") };
  const appSettings: Record<AppSettingsTab, string> = { profile: t("Profile"), brand: t("Brand"), connections: t("Connections"), advanced: t("Advanced") };
  return { section, blurb, research, studio, appSettings, allApps: t("All apps"), analyses: t("All analyses") };
}

/**
 * A translated sentence with elements in its {slots}: `withParts(sentence, { paused: <Term …/> })`.
 * The sentence stays whole for translators; each language puts the slot where its grammar wants it.
 */
export function withParts(text: string, parts: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name && name in parts ? <Fragment key={i}>{parts[name]}</Fragment> : piece;
  });
}

/** One short line for each ad term a new user meets first (for ui.tsx Term). */
export function useTermTips() {
  const { t } = useT();
  return {
    cac: t("Customer acquisition cost: what you spent on ads for each new paying customer."),
    ltv: t("Lifetime value: what one paying customer pays you over time."),
    ltvCac: t("Lifetime value divided by acquisition cost. Above 3 is healthy; below 1 loses money on every customer."),
    roas: t("Return on ad spend: revenue divided by what the ads cost."),
    cpi: t("Cost per install: ad spend divided by installs."),
    payback: t("How many months until a customer has paid back what it cost to win them."),
    adSet: t("The part of a Meta campaign that holds the budget, audience and placements; its ads sit inside it."),
    paused: t("Created in your ad account but switched off: nothing spends until you turn it on in Ads Manager."),
  };
}
