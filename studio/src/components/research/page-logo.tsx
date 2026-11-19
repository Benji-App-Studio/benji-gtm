"use client";

// A Facebook Page's profile picture (a competitor's logo), from its Page id. Facebook's public
// `graph.facebook.com/<id>/picture` link redirects to the current picture and never expires, unlike the
// picture links inside scraped ads. Without a Page id, or when the picture won't load, the name's first
// letter stands in.

import { useState } from "react";
import { cx } from "../ui";

export const pageLogoUrl = (pageId: string) => `https://graph.facebook.com/${encodeURIComponent(pageId)}/picture?type=large`;

const SIZE = { xs: "size-5 text-xs", sm: "size-6 text-xs", md: "size-8 text-xs" } as const;

export function PageLogo({ pageId, name, size = "md", className }: { pageId: string | null | undefined; name: string; size?: keyof typeof SIZE; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = cx("shrink-0 rounded-full", SIZE[size], className);
  if (!pageId || failed === pageId) {
    return <span className={cx(box, "grid place-items-center bg-control font-medium text-label uppercase")} aria-hidden>{name.trim().charAt(0) || "?"}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={pageLogoUrl(pageId)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(pageId)}
      className={cx(box, "border border-line bg-raised object-cover")} />
  );
}
