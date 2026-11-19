import { isResponse, requireUser } from "@/lib/server/auth";
import { radar, relay } from "@/lib/server/radar";

/** Jev reads a product description: category, customer, price, sales channel, channels, keywords. */
export async function POST(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { name, description, website, kind } = await request.json().catch(() => ({}));
  if (typeof name !== "string" || !name.trim() || typeof description !== "string" || description.trim().length < 15) {
    return Response.json({ error: "Give your product a name and describe it in a sentence or two." }, { status: 400 });
  }
  return relay(await radar(session, "intake", {
    name: name.trim(), description: description.trim().slice(0, 2000),
    website: typeof website === "string" ? website.trim() : undefined, kind: typeof kind === "string" ? kind : undefined,
  }));
}
