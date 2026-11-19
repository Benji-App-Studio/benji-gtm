import { PREPARE_STEPS, provision, UPDATE_STEPS, type ProgressEvent } from "@/lib/server/provision";
import { isResponse } from "@/lib/server/auth";
import { provisionDeps, readSetupBody, refuseError, setupCaller, targetRef } from "@/lib/server/provision/request-access";

// Applying every migration and deploying seven functions takes a minute or two.
export const maxDuration = 300;

/**
 * Prepares the project (a first run) or brings it up to date (the owner, later): database changes,
 * function addresses, the backend functions and the Style Library images. Progress is streamed as one
 * JSON object per line; the last line is `{ type: "result", ok, failed? }`. Safe to call again after
 * a failure: finished work is skipped.
 */
export async function POST(request: Request) {
  const caller = await setupCaller(request);
  if (isResponse(caller)) return caller;
  const input = await readSetupBody(request);
  if (isResponse(input)) return input;
  const ref = targetRef(caller, input.body);
  if (isResponse(ref)) return ref;
  let deps;
  try { deps = provisionDeps(); } catch (error) { return refuseError(error); }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      // If the page is closed the work still finishes; there is just nobody to tell.
      const send = (line: unknown) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)); } catch { open = false; }
      };
      const result = await provision(
        { accessToken: input.token, ref, steps: caller.mode === "owner" ? UPDATE_STEPS : PREPARE_STEPS, appOrigin: caller.appOrigin ?? undefined },
        deps,
        (event: ProgressEvent) => send({ type: "event", ...event }),
      ).catch(() => ({ ok: false as const, failed: { step: "project" as const, code: "unexpected", message: "Something unexpected went wrong. Press Retry." } }));
      send({ type: "result", ok: result.ok, failed: result.failed ?? null });
      if (open) controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
