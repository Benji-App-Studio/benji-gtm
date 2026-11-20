// English sentences saved to the database (warnings on a composed ad, a batch's notes) are kept in English
// so every reader and the AI see the same text. This puts one back into the reader's language when it was
// built from a known template (an m()-marked sentence with {values}): the values are read back out of the
// saved text and the template is translated with them. Anything else is looked up as it is.
import type { Vars } from "./i18n/translate";

type Words = (text: string, vars?: Vars) => string;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The template's {values} as named groups, so a filled-in sentence gives them back. */
function matcher(template: string): { re: RegExp; names: string[] } {
  const names: string[] = [];
  const pattern = template.split(/(\{\w+\})/).map((part) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (!name) return escape(part);
    names.push(name);
    return "([\\s\\S]*?)";
  }).join("");
  return { re: new RegExp(`^${pattern}$`), names };
}

/** `saved` in the reader's language: through the first template it was filled from, else looked up as is. */
export function storedWords(saved: string, templates: readonly string[], t: Words): string {
  for (const template of templates) {
    const { re, names } = matcher(template);
    const found = re.exec(saved);
    if (!found) continue;
    // Each value is translated too when it's a known word (a role like "Headline"); free text stays.
    const vars = Object.fromEntries(names.map((name, i) => [name, t(found[i + 1])]));
    return t(template, vars);
  }
  return t(saved);
}
