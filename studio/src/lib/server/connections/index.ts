import "server-only";
// Verifying a workspace's connections. Each provider has its own file with one function. Meta,
// RevenueCat and AppStack read their APIs through the metrics edge function (remote.ts), which holds
// the keys; a check that can't run (no key yet) answers `pending`, and the connection stays "set".
import type { ConnectionKey } from "@/lib/workspace";
import { verifyAppStack } from "./appstack";
import { verifyMeta } from "./meta";
import { verifyRevenueCat } from "./revenuecat";
import { verifyStorage } from "./storage";
import type { Verifier } from "./verifier";

export { type Verifier, type VerifyContext, type VerifyResult } from "./verifier";

export const VERIFIERS: Record<ConnectionKey, Verifier> = {
  meta: verifyMeta,
  revenuecat: verifyRevenueCat,
  appstack: verifyAppStack,
  storage: verifyStorage,
};
