"use client";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { ProjectView } from "@/components/project-view";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  return <Suspense><ProjectView id={id} /></Suspense>;
}
