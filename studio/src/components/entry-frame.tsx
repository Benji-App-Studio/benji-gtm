import type { ReactNode } from "react";
import { Logo } from "./logo";

/** The pages outside the app (log in, sign up), Linear's way: the product's small mark, then one narrow column on the plain background, lots of space around it. */
export function EntryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center bg-canvas px-4 pt-[14vh] pb-12">
      <Logo href="/login" />
      <main className="mt-10 w-full max-w-[340px]">{children}</main>
    </div>
  );
}
