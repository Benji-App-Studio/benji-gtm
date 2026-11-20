// The settings API's own error sentences (api() in settings-ui.tsx), and saying any error in the viewer's
// language. Plain TypeScript, so the Node tests load it.
import { m, type Translator } from "../../lib/i18n/translate";

/** api()'s sentence when the request never reached the server. */
export const NO_CONNECTION = m("The request didn't go through. Check your connection and try again.");
/** api()'s sentence when the server answered an error without one of its own. */
export const failedWith = (status: number) => `That didn't work (error ${status}). Try again.`;
const FAILED = /^That didn't work \(error (\d+)\)\. Try again\.$/;

/** An error from api() in the viewer's language: its own two messages are translated; a server's reason is shown as it came. */
export function sayError(t: Translator["t"], error: string): string {
  const status = FAILED.exec(error)?.[1];
  return status ? t("That didn't work (error {status}). Try again.", { status }) : t(error);
}
