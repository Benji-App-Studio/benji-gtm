// A translated sentence with pieces of markup in it (a link, a <code>, a bold name). Translate the whole
// sentence with its {placeholders} left unfilled, then put the nodes in:
//   rich(t("Run {cmd} in the app's folder."), { cmd: <code>npm install</code> })
// Each language keeps its own word order, and the sentence stays one entry in the dictionaries.
import { Fragment, type ReactNode } from "react";

/** What goes between two sentences (lib/i18n/join.ts): nothing after 。 in Japanese and Traditional Chinese, a space elsewhere. */
export { sentenceGap } from "../lib/i18n/join";

export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{name && name in nodes ? nodes[name] : part}</Fragment>;
  });
}
