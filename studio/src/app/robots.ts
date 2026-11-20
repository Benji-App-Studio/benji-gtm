import type { MetadataRoute } from "next";
import { getInstallConfig } from "@/lib/install/config";
import { landingSeo, robotsRules } from "@/lib/landing-seo";

// Read at request time: the public address comes from the deployment's settings.
export const dynamic = "force-dynamic";

/**
 * A copy with a public address lets search engines read its public pages (never the app, the API or
 * setup); a copy without one asks them to stay out entirely.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = getInstallConfig()?.publicOrigin ?? null;
  const seo = landingSeo(origin);
  return { rules: robotsRules(origin), ...(seo.base ? { host: seo.base.origin } : {}) };
}
