import type { ReactNode } from "react";
import { Logo } from "./logo";

/** The pages outside the app (log in, sign up): the product's mark above one small panel, centred. */
export function EntryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center bg-shell px-4 pt-[12vh] pb-10">
      <Logo href="/login" />
      <main className="mt-8 w-full max-w-[380px] rounded-card border border-hairline bg-canvas px-6 py-8 sm:px-8">{children}</main>
    </div>
  );
}
