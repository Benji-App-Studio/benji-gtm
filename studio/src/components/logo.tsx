import Link from "next/link";
import { APP_NAME } from "@/lib/brand-config";

/** The product's mark (a dark square with its initial) and its name. Both come from APP_NAME. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 rounded-xs text-sm font-[550] tracking-[-0.1px] text-ink">
      <span aria-hidden className="grid size-6 place-items-center rounded-[6px] bg-primary text-xs leading-none font-semibold text-on-ink">{APP_NAME.trim().charAt(0).toUpperCase()}</span>
      {APP_NAME}
    </Link>
  );
}
