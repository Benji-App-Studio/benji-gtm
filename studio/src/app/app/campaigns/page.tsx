import { redirectLegacy } from "@/lib/server/legacy-page";

/** Old address: these analyses are under All analyses (and each app's Research › Social posts) now. */
export default async function LegacyCampaigns({ searchParams }: PageProps<"/app/campaigns">) {
  redirectLegacy("/app/campaigns", await searchParams);
}
