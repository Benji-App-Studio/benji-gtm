import type { ReactNode } from "react";
import { LanguageMenu } from "./language-menu";
import { Logo } from "./logo";

/**
 * The pages outside the app (log in, sign up, password reset), Linear's way: the product's small mark,
 * then one narrow column on the plain background, lots of space around it, and the language picker at the foot.
 */
export function EntryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center bg-canvas px-4 pt-[14vh] pb-6">
      <Logo href="/" />
      <main className="mt-10 w-full max-w-[340px]">{children}</main>
      <footer className="mt-auto pt-16"><LanguageMenu align="start" side="top" /></footer>
    </div>
  );
}
