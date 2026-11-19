import { APP_NAME } from "@/lib/brand-config";

/** Setup has its own plain frame: no sidebar, because there is no app to navigate yet. */
export default function SetupLayout({ children }: LayoutProps<"/setup">) {
  return (
    <>
      <header className="border-b border-header-line">
        <div className="mx-auto flex h-11 max-w-[748px] items-center gap-2 px-4 text-sm font-[550] tracking-[-0.1px] sm:px-6">
          <span aria-hidden className="grid size-6 place-items-center rounded-[6px] bg-primary text-xs leading-none font-semibold text-on-ink">{APP_NAME.trim().charAt(0).toUpperCase()}</span>
          {APP_NAME}
        </div>
      </header>
      <main className="@container min-w-0 flex-1">{children}</main>
    </>
  );
}
