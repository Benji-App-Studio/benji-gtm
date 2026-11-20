import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { sanitizeNext } from "@/lib/auth/flows";
import { getTranslator } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t("You're already signed in"), robots: { index: false } };
}

const TYPES = new Set(["signup", "invite", "magiclink", "recovery", "email"]);

/**
 * An emailed sign-in link opened in a browser where someone is already signed in: ask before their
 * session is replaced (lib/auth/flows.ts confirmStep sends people here). The buttons are plain links, so
 * nothing is fetched ahead and the one-time link isn't used until the person chooses.
 */
export default async function SwitchAccount({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await getTranslator();
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  const tokenHash = one(query.token_hash);
  const type = one(query.type);
  const next = sanitizeNext(one(query.next));
  if (!tokenHash || !type || !TYPES.has(type)) redirect("/login?error=confirm");
  const link = new URLSearchParams({ token_hash: tokenHash, type, ...(next ? { next } : {}) });

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  // Nobody is signed in any more: use the link straight away.
  if (!data?.claims?.sub) redirect(`/auth/confirm?${link.toString()}`);
  const email = (data.claims.email as string | undefined) ?? "";

  return (
    <div className="text-center">
      <h1 className="text-display font-semibold">{t("You're already signed in")}</h1>
      <p className="mt-2 text-sm text-muted">
        {email ? t("You're signed in as {email}. To use this link, you'll be signed out of that account first.", { email }) : t("To use this link, you'll be signed out of the account you're using now.")}
      </p>
      <div className="mt-6 grid gap-2">
        <a href={`/auth/confirm?${link.toString()}&switch=1`} className={`${buttonClass("primary")} h-8 w-full`}>{t("Sign out and continue")}</a>
        <Link href="/app" className={`${buttonClass("secondary")} h-8 w-full`}>{t("Stay signed in")}</Link>
      </div>
    </div>
  );
}
