/** Re-mounts on every page switch, so each page's content eases in instead of snapping. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
