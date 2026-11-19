import { notFound } from "next/navigation";
import { PreviewScreen } from "@/components/preview/preview-screen";

/**
 * Development only: the shell, the shared components and the settings screens on sample data, with no
 * session and no backend (requests are answered in the browser). Not found in a production build.
 *   /preview                 the list of screens
 *   /preview/settings/keys?role=member|legacy   &fail=1 makes the install request fail
 */
export default async function Preview({ params, searchParams }: PageProps<"/preview/[[...view]]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await params;
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return <PreviewScreen view={(view ?? []).join("/")} role={one(query.role) ?? "owner"} fail={one(query.fail) === "1"} />;
}
