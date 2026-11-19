import type { NextRequest } from "next/server";
import { IMAGE_PROVIDERS, type ImageProvider } from "@/lib/image-provider";
import { isResponse, requireUser } from "@/lib/server/auth";
import { readImageProvider, saveImageProvider } from "@/lib/server/image-provider";

// Who makes this product's GPT Image 2.5 images by default: Higgsfield or OpenAI. The Studio, the
// Playground and template remakes start from it; picking the other one there remembers it here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/products/[id]/image-provider">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ provider: await readImageProvider(session, id) });
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/products/[id]/image-provider">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (!IMAGE_PROVIDERS.includes(body?.provider)) return Response.json({ error: "Pick Higgsfield or OpenAI." }, { status: 400 });
  const result = await saveImageProvider(session, id, body.provider as ImageProvider);
  return Response.json({ provider: body.provider, ...result });
}
