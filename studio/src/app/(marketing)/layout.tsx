import { EntryFrame } from "@/components/entry-frame";

/** Log in, sign up and the password pages, in the narrow entry frame. (The public landing page is app/(landing).) */
export default function EntryLayout({ children }: LayoutProps<"/">) {
  return <EntryFrame>{children}</EntryFrame>;
}
