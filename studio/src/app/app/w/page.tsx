import { redirect } from "next/navigation";
import { lastAppId } from "@/lib/server/last-app";
import { searchString } from "@/lib/nav-model";
import { workspaceHref } from "@/lib/workspace-schema";

/** Where sign-in and onboarding land: the Home of the last app opened, else of the main one. Its query (?guide) is kept. */
export default async function Workspaces({ searchParams }: PageProps<"/app/w">) {
  const id = await lastAppId();
  redirect(id ? `${workspaceHref(id)}${searchString(await searchParams)}` : "/app/product/new");
}
