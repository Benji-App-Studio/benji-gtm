import { redirectLegacy } from "@/lib/server/legacy-page";

/** Old address: these analyses are under All analyses (and each app's Research › Social posts) now. */
export default async function LegacyAccounts({ searchParams }: PageProps<"/app/accounts">) {
  redirectLegacy("/app/accounts", await searchParams);
}
