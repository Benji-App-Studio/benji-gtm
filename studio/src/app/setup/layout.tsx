import { APP_NAME } from "@/lib/brand-config";

/** Setup has its own plain frame: no sidebar, because there is no app to navigate yet. */
export default function SetupLayout({ children }: LayoutProps<"/setup">) {
  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 text-[20px] font-medium tracking-[-0.02em] sm:px-6">{APP_NAME}</div>
      </header>
      <main className="@container min-w-0 flex-1">{children}</main>
    </>
  );
}
