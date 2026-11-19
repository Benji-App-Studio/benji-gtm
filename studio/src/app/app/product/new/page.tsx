"use client";
import { useRouter } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { Page, PageHeader } from "@/components/ui";
import { refresh } from "@/lib/client-cache";
import { workspaceHref } from "@/lib/workspace-schema";

export default function NewProduct() {
  const router = useRouter();
  return (
    <Page className="max-w-3xl">
      <PageHeader crumbs={[{ label: "Home", href: "/app" }, { label: "New app" }]} title="Add an app"
        subtitle="Each app keeps its own profile, brand, competitors and creatives. You can change every answer later." />
      {/* Lands on the new app's Home (its setup list and next step), like the first app does. `replace`, so Back
          doesn't return to an empty copy of this form; the sidebar's list of apps is refreshed on the way. */}
      <ProductForm onDone={(row) => { refresh("/api/products").catch(() => {}); refresh("/api/workspaces").catch(() => {}); router.replace(workspaceHref(row.id)); }} />
    </Page>
  );
}
