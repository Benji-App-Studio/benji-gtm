import type { Metadata } from "next";
import { ProductForm } from "@/components/product-form";

export const metadata: Metadata = { title: "Set up your first app" };

export default function Onboarding() {
  return (
    <div className="px-4 pt-8 pb-10 sm:px-12 sm:pt-12">
      <h1 className="text-display font-semibold">Tell us about your product</h1>
      <p className="mt-1 mb-8 max-w-xl text-sm text-muted">This becomes your first app&apos;s profile. Every competitor search and analysis starts from it, and you can change it any time.</p>
      <ProductForm />
    </div>
  );
}
