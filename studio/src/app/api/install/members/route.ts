import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";
import type { InstallMember } from "@/lib/install/types";

/** Everyone who may use this install. */
export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  return relay(await callFunction<{ members: InstallMember[] }>("install", session, "members"));
}

/**
 * The link Supabase makes signs the person in and then sends them to the project's Site URL, which on a
 * self-hosted install is rarely this app, and nowhere lets them choose a password. So the link handed to
 * the owner is this app's own /invite page, carrying the same one-time token after the # (never sent to
 * a server or kept in its logs); that page checks the token and sets the password.
 */
function inviteHref(origin: string, link: string): string {
  try {
    const url = new URL(link);
    const token = url.searchParams.get("token");
    const type = url.searchParams.get("type");
    if (!token || (type !== "invite" && type !== "recovery")) return link;
    return `${origin}/invite#token=${encodeURIComponent(token)}&type=${type}`;
  } catch {
    return link;
  }
}

/** Adds a person by email. Owner only; the backend enforces it. */
export async function POST(request: NextRequest) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  if (typeof body?.email !== "string" || !body.email.trim()) return Response.json({ error: "Type the person's email address." }, { status: 400 });
  const result = await callFunction<{ member: InstallMember; inviteLink?: string }>("install", session, "members/add", { body: { email: body.email.trim() } });
  if (result.ok && typeof result.data.inviteLink === "string") result.data.inviteLink = inviteHref(request.nextUrl.origin, result.data.inviteLink);
  return relay(result);
}
