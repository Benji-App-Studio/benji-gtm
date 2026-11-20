// Translating English sentences that arrive as data (a stored check result, a backend's skip reason)
// by matching them against a list of m()-marked templates. A message of several sentences is matched
// sentence by sentence; a sentence no template matches goes to the backend message translator, then to
// the dictionary, then stays as it came. Values that are themselves known sentences (a source's name) are translated too.
// Plain TypeScript (the server, the browser and the Node tests).
//
//   const say = templateTranslator([m("Files go to {folder}."), …]);
//   say("Files go to workspace/u1.", useT())   → "檔案會存到 workspace/u1。"
import { translateServerMessage } from "./server-messages";
import type { Translator } from "./translate";

type Tr = Pick<Translator, "t" | "locale">;

/** Values that are numbers ({n} ads, answered {status}): matched as numbers only. */
const NUMERIC = new Set(["n", "status", "mb"]);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `values`: more known phrases that may sit inside a template's {value} (a key's name), translated there too. */
export function templateTranslator(templates: readonly string[], values: readonly string[] = []): (message: string | null | undefined, tr: Tr) => string {
  const known = new Set(templates.filter((s) => !/\{\w+\}/.test(s)));
  const knownValue = new Set([...known, ...values]);
  const patterns = templates.filter((s) => /\{\w+\}/.test(s)).map((template) => {
    const names: string[] = [];
    const source = template.split(/(\{\w+\})/).map((part) => {
      const name = part.match(/^\{(\w+)\}$/)?.[1];
      if (!name) return escape(part);
      names.push(name);
      return NUMERIC.has(name) ? "(\\d[\\d.,]*)" : "([^\\n]+?)";
    }).join("");
    return { template, names, re: new RegExp(`^${source}$`) };
  });
  const one = (text: string, tr: Tr): string | null => {
    if (known.has(text)) return tr.t(text);
    for (const { template, names, re } of patterns) {
      const found = re.exec(text);
      if (found) return tr.t(template, Object.fromEntries(names.map((name, i) => [name, knownValue.has(found[i + 1]) ? tr.t(found[i + 1]) : found[i + 1]])));
    }
    return null;
  };
  /** Not one of the templates: a backend message, else any sentence the dictionary has, else as it came. */
  const other = (text: string, tr: Tr) => {
    const server = translateServerMessage(text, tr);
    return server !== text ? server : tr.t(text);
  };
  return (message, tr) => {
    if (!message) return message ?? "";
    if (tr.locale === "en") return message;
    const text = message.trim();
    const whole = one(text, tr);
    if (whole !== null) return whole;
    const exact = tr.t(text);
    if (exact !== text) return exact;
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
    if (sentences.length < 2) return other(text, tr);
    return sentences.map((sentence) => one(sentence, tr) ?? other(sentence, tr)).join(tr.locale === "ja" || tr.locale === "zh-TW" ? "" : " ");
  };
}
