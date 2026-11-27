import { createGrantIntegrityService } from "../../auth/delegation.ts";
import {
  createD1DurableExecutionRuntime,
  type D1Binding,
  type ProviderExecutionPolicy,
} from "./d1-runtime.ts";

export interface DurableExecutionWorkerEnv {
  readonly EXECUTION_DB: D1Binding;
  readonly DURABLE_EXECUTION_ENABLED?: string;
  readonly GRANT_INTEGRITY_SECRET?: string;
}

/** Trusted server-composition seam. No request data enters this factory. */
export function createRuntimeFromWorkerEnv(
  env: DurableExecutionWorkerEnv,
  providers: Readonly<Record<string, ProviderExecutionPolicy>> = {},
) {
  if (env?.DURABLE_EXECUTION_ENABLED !== "true" || !env.EXECUTION_DB) return null;
  const grantIntegrity = createGrantIntegrityService(env.GRANT_INTEGRITY_SECRET);
  if (!grantIntegrity) return null;
  try {
    return createD1DurableExecutionRuntime(env.EXECUTION_DB, grantIntegrity, true, providers);
  } catch {
    return null;
  }
}

/**
 * The production Worker has no execution HTTP surface. The current Vercel
 * gateway is Node-based and its trusted auth pipeline is not ported here.
 * Health is informational only; every other path remains closed.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ ok: true, consequential_execution: "disabled" }, {
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json({ error: "execution_surface_unavailable" }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  },
};
