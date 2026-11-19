"use client";
// The header every product page shares: crumbs (product → page), title, subtitle and actions.
import type { ComponentProps, ReactNode } from "react";
import { useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { workspaceHref } from "@/lib/workspace-schema";
import { PageHeader } from "../ui";

/** A product's name, from the list the sidebar already keeps cached. */
export function useProductName(productId: string): string | undefined {
  const [list] = useCached<ProductRow[]>("/api/products");
  return Array.isArray(list) ? list.find((p) => p.id === productId)?.name : undefined;
}

type Props = Omit<ComponentProps<typeof PageHeader>, "crumbs" | "title"> & {
  productId: string;
  /** The page's name in the sidebar: the last crumb, and the title unless one is given. */
  page: string;
  title?: ReactNode;
  /** The product's name when the page already has it (else it comes from the cached list). */
  name?: string;
};

/** A crumb is a way back, not the title: a very long name is cut short there (the page shows it in full). */
const CRUMB_MAX = 40;
const crumb = (label: string) => (label.length > CRUMB_MAX ? `${label.slice(0, CRUMB_MAX - 1).trimEnd()}…` : label);

export function ProductPageHeader({ productId, page, title, name, ...rest }: Props) {
  const cached = useProductName(productId);
  return <PageHeader crumbs={[{ label: crumb(name || cached || "App"), href: workspaceHref(productId) }, { label: page }]} title={title ?? page} {...rest} />;
}
