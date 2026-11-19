// Provisioning: turns an empty Supabase project into this app's backend, with one access token.
//
//   1 project        list projects, refuse one that already holds someone else's data, detect the plan
//   2 keys           read the publishable key and a secret key (the secret stays in memory)
//   3 migrations     apply supabase/migrations in order, each with its ledger row, skipping applied ones
//   4 function-urls  store the project's own function addresses in its Vault
//   5 functions      deploy the edge functions with their imported files
//   6 owner          create the owner's account, record the install, close sign-up
//   7 storage        public `app-assets` bucket, Style Library images, upload limit
//     jobs           turn on the optional scheduled jobs (they wait for an owner)
//   8 config         write the local config file
//
// Pure functions: `fetch` and file reading are passed in, every step is safe to repeat, and progress
// is reported as events. The setup routes (app/api/setup), scripts/provision.mjs and the tests all
// call this same code. Endpoints live in management-api.ts.
export * from "./types";
export * from "./management-api";
export * from "./migrations";
export * from "./functions";
export * from "./install";
export * from "./run";
export * from "./adopt";
export * from "./guard";
export * from "./node-files";
