// Stand-ins for OpenAI's Responses API, for tests (no network). Not used by any function.

/** A finished Responses API answer whose text is `answers` as JSON. */
export function completed(answers: unknown, usage = { input_tokens: 100, output_tokens: 20 }, model = "test-model"): Response {
  return Response.json({ model, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: typeof answers === "string" ? answers : JSON.stringify(answers) }] }], usage });
}

/** An OpenAI error answer. */
export function failed(status: number, message = `error ${status}`, extra: { code?: string; headers?: Record<string, string> } = {}): Response {
  return Response.json({ error: { message, ...(extra.code ? { code: extra.code } : {}) } }, { status, headers: extra.headers });
}

/**
 * Valid answers for whatever a request's schema asks: `yes`% for a yes/no, everything on the first
 * option of a choice (or on `pick(options)`), everything on `level` for a score.
 */
export function answersFor(body: any, o: { yes?: number; level?: number; pick?: (options: string[]) => string } = {}): Record<string, unknown> {
  const properties = body.text.format.schema.properties as Record<string, any>;
  return Object.fromEntries(Object.entries(properties).map(([id, shape]) => {
    if (shape.type === "integer") return [id, o.yes ?? 20];
    if (shape.type === "array") {
      const options = shape.items.properties.option.enum as string[];
      return [id, [{ option: o.pick?.(options) ?? options[0], percent: 100 }]];
    }
    return [id, Object.fromEntries((shape.required as string[]).map((key, level) => [key, level === (o.level ?? 0) ? 100 : 0]))];
  }));
}

export interface FakeCall { url: string; headers: Record<string, string>; body: any }

/** A fetch that records each request and answers with `reply` (default: valid answers to everything asked). */
export function fakeOpenAi(reply: (body: any, call: number) => Response | Promise<Response> = (body) => completed(answersFor(body))) {
  const calls: FakeCall[] = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body });
    const call = calls.length;
    return Promise.resolve().then(() => reply(body, call));
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

/** The question ids a request asked, in order. */
export const askedIds = (body: any): string[] => body.text.format.schema.required;
/** The prompt the model was sent. */
export const promptOf = (body: any): string => body.input[1].content[0].text;
