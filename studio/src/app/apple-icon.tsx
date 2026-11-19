import { appIcon } from "@/lib/app-icon";

// The icon a phone or tablet uses when the app is added to its home screen (see lib/app-icon.tsx).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(size.width, { rounded: false });
}
