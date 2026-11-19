import { detectPlan, inspect, installOwned, listMigrations, listProjects, managementApi, projectProblem, ProvisionError } from "@/lib/server/provision";
import { isResponse } from "@/lib/server/auth";
import { NO_STORE, provisionDeps, readSetupBody, refuseError, setupCaller, targetRef } from "@/lib/server/provision/request-access";

/**
 * Looks at one project without changing it: is it empty (a new install), prepared before (an update,
 * with how many database changes are still to apply), or holding someone else's data (refused)?
 */
export async function POST(request: Request) {
  const caller = await setupCaller(request);
  if (isResponse(caller)) return caller;
  const input = await readSetupBody(request);
  if (isResponse(input)) return input;
  const ref = targetRef(caller, input.body);
  if (isResponse(ref)) return ref;
  try {
    const api = managementApi((url, init) => fetch(url, init), input.token);
    const project = (await listProjects(api)).find((candidate) => candidate.ref === ref);
    if (!project) throw new ProvisionError("no_project", "This access token can't see that project. Use a token from the Supabase account that owns it.");
    const problem = projectProblem(project);
    if (problem) throw new ProvisionError("not_ready", problem);
    const inspection = await inspect(api, ref);
    const applied = new Set(inspection.applied.map((row) => row.version));
    const migrations = await listMigrations(provisionDeps().files);
    const { plan } = await detectPlan(api, project);
    return Response.json({
      project: { ref: project.ref, name: project.name, region: project.region },
      state: inspection.state,
      pending: migrations.filter((migration) => !applied.has(migration.version)).length,
      applied: inspection.applied.length,
      owned: inspection.state === "update" ? await installOwned(api, ref) : false,
      plan,
    }, { headers: NO_STORE });
  } catch (error) {
    return refuseError(error);
  }
}
