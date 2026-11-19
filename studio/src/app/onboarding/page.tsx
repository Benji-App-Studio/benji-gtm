import type { Metadata } from "next";
import { ProductForm } from "@/components/product-form";

export const metadata: Metadata = { title: "Set up your first app" };

export default function Onboarding() {
  return (
    <div className="px-4 pt-6 pb-10 sm:px-8 sm:pt-8">
      <h1 className="text-display font-medium">Tell us about your product</h1>
      <p className="mt-1.5 mb-7 max-w-xl text-sm text-muted">This becomes your first app&apos;s profile. Every competitor search and analysis starts from it, and you can change it any time.</p>
      <ProductForm />
    </div>
  );
}
