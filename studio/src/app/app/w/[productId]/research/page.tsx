"use client";
import { useParams } from "next/navigation";
import { ResearchAds } from "@/components/research-ads";

/** Research → Ads for one workspace (a product). */
export default function ResearchPage() {
  const { productId } = useParams<{ productId: string }>();
  return <ResearchAds productId={productId} />;
}
