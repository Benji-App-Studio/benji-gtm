"use client";
import { useParams } from "next/navigation";
import { StudioView } from "@/components/studio/studio-view";

/** The creative studio for one workspace (a product). */
export default function StudioPage() {
  const { productId } = useParams<{ productId: string }>();
  return <StudioView productId={productId} />;
}
