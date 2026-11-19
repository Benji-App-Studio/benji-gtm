import { notFound } from "next/navigation";

/**
 * Any address under /app that no page answers: shows the app's own "This page isn't here" (not-found.tsx,
 * inside the app's frame) instead of the framework's bare 404 page.
 */
export default async function MissingPage({ params }: PageProps<"/app/[...missing]">) {
  await params;
  notFound();
}
