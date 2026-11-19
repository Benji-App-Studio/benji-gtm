import { listProjects, managementApi, projectProblem } from "@/lib/server/provision";
import { isResponse } from "@/lib/server/auth";
import { NO_STORE, readSetupBody, refuseError, setupCaller } from "@/lib/server/provision/request-access";

/**
 * The Supabase projects the pasted access token can see, so the person picks one from a list instead
 * of copying a project reference. The token is used for this one call and not kept.
 */
export async function POST(request: Request) {
  const caller = await setupCaller(request);
  if (isResponse(caller)) return caller;
  const input = await readSetupBody(request);
  if (isResponse(input)) return input;
  try {
    const projects = await listProjects(managementApi((url, init) => fetch(url, init), input.token));
    return Response.json({
      projects: projects.map((project) => ({ ref: project.ref, name: project.name, region: project.region, ready: !projectProblem(project), problem: projectProblem(project) })),
    }, { headers: NO_STORE });
  } catch (error) {
    return refuseError(error);
  }
}
