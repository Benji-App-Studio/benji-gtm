import { EntryFrame } from "@/components/entry-frame";

/** Log in and sign up. (The folder keeps its old name; there is no marketing site.) */
export default function EntryLayout({ children }: LayoutProps<"/">) {
  return <EntryFrame>{children}</EntryFrame>;
}
