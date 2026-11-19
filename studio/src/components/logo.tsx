import Link from "next/link";
import { APP_NAME } from "@/lib/brand-config";

/** The product's mark (a dark square with its initial) and its name. Both come from APP_NAME. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-sm text-[15px] font-medium tracking-[-0.01em] text-ink">
      <span aria-hidden className="grid size-6 place-items-center rounded-md bg-primary text-xs leading-none font-semibold text-on-ink">{APP_NAME.trim().charAt(0).toUpperCase()}</span>
      {APP_NAME}
    </Link>
  );
}
