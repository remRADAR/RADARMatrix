/**
 * RADARMatrix GitHub Read-Only Runtime Adapter (M3)
 *
 * The FIRST real execution capability in RADARMatrix. Everything
 * before this milestone was plan-only: no runtime command execution
 * existed anywhere (M1a/M2 law).
 *
 * Security law (binding, extends the M2/M2.1 model):
 * - ALLOWLIST ONLY: the adapter executes exactly the named read-only
 *   GitHub REST operations declared in the operation registry. There
 *   is no arbitrary command string, no shell, no URL injection — the
 *   caller picks an operation NAME and validated path parameters;
 *   the adapter builds the URL itself.
 * - READ-ONLY ONLY: every declared operation is an HTTP GET. The
 *   adapter has no code path that can issue a write to GitHub.
 * - DELEGATED AUTHORITY: an execution attempt must present an
 *   authority (agent identity + workspace + DelegatedGrant) and the
 *   grant must validate for THIS operation and workspace
 *   (validateGrantUse, action "read"). Agents never inherit their
 *   actor's full authority; mismatch/expiry/use-limit/tool-scope all
 *   fail closed. A successful execution consumes a grant use.
 * - APPROVAL MODEL: operations flagged requiresApproval additionally
 *   demand a valid single-use approval token, verified by an
 *   injected verifier (the M2 approvals module). No verifier
 *   configured => approval-gated operations are denied. The default
 *   GitHub registry contains NO approval-gated operations (reads of
 *   public/authorized repos are not consequential writes); the hook
 *   exists so future operation sets cannot bypass it.
 * - HONEST STATUS: without a configured token (or transport) the
 *   adapter reports status "unavailable" and denies every execution.
 *   Nothing is simulated.
 * - FAIL CLOSED: unknown operation, malformed arguments, missing
 *   authority, invalid grant, HTTP 401/403, transport failure and
 *   timeout all deny or report unavailable — never "executed".
 *
 * Not wired into the MCP gateway in M3: the adapter is a standalone,
 * unit-tested execution surface. Gateway wiring is a later,
 * owner-gated step.
 *
 * Zero runtime npm dependencies. Erasable-syntax TypeScript only
 * (Node >= 22.18 type stripping).
 */

import {
  validateGrantUse,
  recordGrantUse,
} from "../auth/delegation.ts";
import type { DelegatedGrant } from "../auth/delegation.ts";

// ---------------------------------------------------------------------------
// Operation registry (the allowlist).
// ---------------------------------------------------------------------------

export interface GitHubReadonlyOperation {
  /** Exact operation name a caller must use as request.command. */
  readonly name: string;
  readonly description: string;
  /** M3 is read-only: every operation is an HTTP GET. */
  readonly method: "GET";
  /** Path template with {param} slots. The adapter builds the URL. */
  readonly pathTemplate: string;
  readonly requiredParams: readonly string[];
  readonly optionalParams?: readonly string[];
  /** Params whose value may contain "/" (each segment is encoded). */
  readonly multiSegmentParams?: readonly string[];
  /** Approval-gated operations demand a verified single-use token. */
  readonly requiresApproval: boolean;
}

/**
 * The default M3 operation registry: read-only GitHub REST GETs.
 * Registry is injectable so future milestones can extend it — but
 * every entry must still be an HTTP GET.
 */
export const GITHUB_READONLY_OPERATIONS: Record<
  string,
  GitHubReadonlyOperation
> = {
  "github.read.file": {
    name: "github.read.file",
    description: "Read a file's contents from a repository",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/contents/{path}",
    requiredParams: ["owner", "repo", "path"],
    optionalParams: ["ref"],
    multiSegmentParams: ["path"],
    requiresApproval: false,
  },
  "github.read.directory": {
    name: "github.read.directory",
    description: "List a directory's entries in a repository",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/contents/{path}",
    requiredParams: ["owner", "repo", "path"],
    optionalParams: ["ref"],
    multiSegmentParams: ["path"],
    requiresApproval: false,
  },
  "github.read.branches": {
    name: "github.read.branches",
    description: "List a repository's branches",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/branches",
    requiredParams: ["owner", "repo"],
    requiresApproval: false,
  },
  "github.read.branch": {
    name: "github.read.branch",
    description: "Read one branch of a repository",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/branches/{branch}",
    requiredParams: ["owner", "repo", "branch"],
    requiresApproval: false,
  },
  "github.read.pull_request": {
    name: "github.read.pull_request",
    description: "Read one pull request of a repository",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/pulls/{pull_number}",
    requiredParams: ["owner", "repo", "pull_number"],
    requiresApproval: false,
  },
  "github.read.commit": {
    name: "github.read.commit",
    description: "Read one commit of a repository",
    method: "GET",
    pathTemplate: "/repos/{owner}/{repo}/commits/{sha}",
    requiredParams: ["owner", "repo", "sha"],
    requiresApproval: false,
  },
};

// ---------------------------------------------------------------------------
// Execution request / result (RuntimeExecutionRequest compatible).
// ---------------------------------------------------------------------------

/** Authority presented by the executing agent (delegated-grant model). */
export interface GitHubReadonlyAuthority {
  agent_id: string;
  workspace_id: string;
  grant: DelegatedGrant;
}

export interface GitHubReadonlyExecutionRequest {
  /** EXACT operation name from the registry. Not a command string. */
  command: string;
  /** Validated path parameters for the operation. */
  args?: Record<string, string>;
  /** Required on every execution — fail closed when absent/invalid. */
  authority?: GitHubReadonlyAuthority;
  /** Required only for approval-gated operations. */
  approvalToken?: string;
  timeoutMs?: number;
}

export interface GitHubReadonlyExecutionResult {
  status: "executed" | "unavailable" | "denied";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  notes?: string;
}

/**
 * Approval verification hook (the M2 approvals module shape). Returns
 * { valid: true } only for a signature-valid, scope-exact, unexpired,
 * unredeemed token; redemption happens inside the verifier.
 */
export interface ApprovalVerifyFn {
  (
    token: string,
    check: {
      action: string;
      resource_id: string;
      workspace_id: string;
      grant_id?: string;
    },
    now: number,
  ): { valid: boolean; reason?: string };
}

export interface GitHubReadonlyConfig {
  /** GitHub access token. Absent => adapter unavailable, all denied. */
  token?: string;
  /** Defaults to https://api.github.com. */
  baseUrl?: string;
  /** Transport (injectable for deterministic tests). Defaults to fetch. */
  fetchImpl?: typeof fetch;
  /** Operation registry. Defaults to GITHUB_READONLY_OPERATIONS. */
  operations?: Record<string, GitHubReadonlyOperation>;
  /** Approval verifier for approval-gated operations. */
  approvalVerifier?: ApprovalVerifyFn;
  /** Clock override (epoch seconds) for deterministic tests. */
  now?: number;
  /** Per-request timeout (default 10_000 ms). */
  defaultTimeoutMs?: number;
  /** Response body cap (default 1 MiB). Larger bodies are truncated. */
  maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

function isNonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Builds the request path from a template and validated arguments.
 * Multi-segment params are split on "/" and EACH segment is encoded
 * separately (so "docs/a b.md" works); single-segment params are
 * encoded whole. The caller never controls the URL structure.
 */
function buildPath(
  op: GitHubReadonlyOperation,
  args: Record<string, string>,
): string {
  let path = op.pathTemplate;
  const slots = op.pathTemplate.match(/\{([a-z_]+)\}/g) || [];
  for (const slot of slots) {
    const key = slot.slice(1, -1);
    const value = args[key];
    const multi = (op.multiSegmentParams || []).includes(key);
    const encoded = multi
      ? value.split("/").map(encodeURIComponent).join("/")
      : encodeURIComponent(value);
    path = path.replace("{" + key + "}", encoded);
  }
  return path;
}

// ---------------------------------------------------------------------------
// Adapter.
// ---------------------------------------------------------------------------

export interface GitHubReadonlyAdapter {
  readonly id: string;
  readonly status: "connected" | "unavailable";
  describe(): { id: string; capabilities: string[]; status: string };
  execute(
    request: GitHubReadonlyExecutionRequest,
  ): Promise<GitHubReadonlyExecutionResult>;
}

export function createGitHubReadOnlyAdapter(
  config: GitHubReadonlyConfig | undefined,
): GitHubReadonlyAdapter {
  const cfg: GitHubReadonlyConfig = config ? config : {};
  const token: string | undefined =
    typeof cfg.token === "string" && cfg.token.length > 0 ? cfg.token : undefined;
  const baseUrl: string = isNonEmptyString(cfg.baseUrl) ? cfg.baseUrl : "https://api.github.com";
  const operations: Record<string, GitHubReadonlyOperation> =
    cfg.operations && typeof cfg.operations === "object"
      ? cfg.operations
      : GITHUB_READONLY_OPERATIONS;
  const fetchImpl: typeof fetch | undefined =
    typeof cfg.fetchImpl === "function" ? cfg.fetchImpl : fetch;
  const approvalVerifier: ApprovalVerifyFn | undefined =
    typeof cfg.approvalVerifier === "function" ? cfg.approvalVerifier : undefined;
  const defaultTimeoutMs: number =
    typeof cfg.defaultTimeoutMs === "number" &&
    Number.isFinite(cfg.defaultTimeoutMs) &&
    cfg.defaultTimeoutMs > 0
      ? cfg.defaultTimeoutMs
      : DEFAULT_TIMEOUT_MS;
  const maxResponseBytes: number =
    typeof cfg.maxResponseBytes === "number" &&
    Number.isFinite(cfg.maxResponseBytes) &&
    cfg.maxResponseBytes > 0
      ? cfg.maxResponseBytes
      : DEFAULT_MAX_RESPONSE_BYTES;

  const configured: boolean = token !== undefined && fetchImpl !== undefined;

  function nowSeconds(): number {
    if (typeof cfg.now === "number" && Number.isFinite(cfg.now)) {
      return cfg.now;
    }
    return Math.floor(Date.now() / 1000);
  }

  function deny(reason: string, stderr?: string): GitHubReadonlyExecutionResult {
    return {
      status: "denied",
      exitCode: null,
      stdout: "",
      stderr: stderr !== undefined ? stderr : "",
      notes: reason,
    };
  }

  return {
    id: "github-readonly",
    status: configured ? "connected" : "unavailable",
    describe() {
      return {
        id: "github-readonly",
        capabilities: Object.keys(operations).sort(),
        status: configured ? "connected" : "unavailable",
      };
    },

    async execute(
      request: GitHubReadonlyExecutionRequest,
    ): Promise<GitHubReadonlyExecutionResult> {
      // 0. Configuration gate — fail closed, honest status.
      if (!configured) {
        return {
          status: "unavailable",
          exitCode: null,
          stdout: "",
          stderr: "",
          notes: token === undefined ? "no_token_configured" : "no_transport_available",
        };
      }

      // 1. Request shape.
      if (!request || typeof request !== "object") {
        return deny("malformed_request");
      }
      if (!isNonEmptyString(request.command)) {
        return deny("missing_command");
      }

      // 2. Allowlist — the command must be an exact registered
      //    operation name. No substring, no path, no command strings.
      const op: GitHubReadonlyOperation | undefined =
        operations[request.command];
      if (op === undefined) {
        return deny("operation_not_in_allowlist");
      }

      // 3. Argument validation (fail closed, exact registry contract).
      const args: Record<string, string> =
        request.args && typeof request.args === "object" ? request.args : {};
      for (const key of op.requiredParams) {
        if (!isNonEmptyString(args[key])) {
          return deny("missing_or_invalid_argument", key);
        }
      }
      const knownParams = new Set<string>([
        ...(op.requiredParams || []),
        ...(op.optionalParams || []),
      ]);
      for (const key of Object.keys(args)) {
        if (!knownParams.has(key)) {
          return deny("unknown_argument", key);
        }
        if (!isNonEmptyString(args[key])) {
          return deny("missing_or_invalid_argument", key);
        }
      }

      // 4. Delegated authority — mandatory on EVERY execution.
      const authority = request.authority;
      if (!authority || typeof authority !== "object") {
        return deny("missing_authority");
      }
      if (!isNonEmptyString(authority.agent_id)) {
        return deny("missing_authority");
      }
      if (!isNonEmptyString(authority.workspace_id)) {
        return deny("missing_authority");
      }
      const grant = authority.grant;
      if (!grant || typeof grant !== "object") {
        return deny("missing_authority");
      }

      const requestPath = buildPath(op, args);

      // 5. Approval gate — only for approval-gated operations.
      if (op.requiresApproval) {
        if (approvalVerifier === undefined) {
          return deny("approval_verifier_unavailable");
        }
        if (!isNonEmptyString(request.approvalToken)) {
          return deny("approval_required");
        }
        const approval = approvalVerifier(
          request.approvalToken as string,
          {
            action: op.name,
            resource_id: requestPath,
            workspace_id: authority.workspace_id,
            grant_id: grant.grant_id,
          },
          nowSeconds(),
        );
        if (!approval || approval.valid !== true) {
          return deny("approval_denied", approval && approval.reason);
        }
      }

      // 6. Grant validation — this operation, this agent, this
      //    workspace, action "read", unexpired, under use limit.
      const grantCheck = validateGrantUse(
        grant,
        {
          agent_id: authority.agent_id,
          workspace_id: authority.workspace_id,
          tool: op.name,
          action: "read",
        },
        nowSeconds(),
      );
      if (!grantCheck.valid) {
        return deny("authority_denied", grantCheck.reason);
      }

      // 7. Transport — read-only GET, credentials in headers only,
      //    never echoed into results.
      const url = baseUrl + requestPath;
      const timeoutMs: number =
        typeof request.timeoutMs === "number" &&
        Number.isFinite(request.timeoutMs) &&
        request.timeoutMs > 0
          ? request.timeoutMs
          : defaultTimeoutMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = (await fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: "Bearer " + token,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "radarmatrix-github-readonly",
          },
          signal: controller.signal,
        })) as Response;
      } catch (error) {
        const name: string =
          error && typeof error === "object" && "name" in error
            ? String((error as { name: unknown }).name)
            : "";
        return {
          status: "unavailable",
          exitCode: null,
          stdout: "",
          stderr: name,
          notes:
            name === "AbortError"
              ? "timeout"
              : "transport_failure",
        };
      } finally {
        clearTimeout(timer);
      }

      let body: string = "";
      try {
        body = await response.text();
      } catch {
        return {
          status: "unavailable",
          exitCode: null,
          stdout: "",
          stderr: "",
          notes: "response_read_failure",
        };
      }
      const truncated: boolean =
        Buffer.byteLength(body, "utf8") > maxResponseBytes;
      const stdout: string = truncated
        ? Buffer.from(body, "utf8").subarray(0, maxResponseBytes).toString("utf8")
        : body;

      if (response.status >= 200 && response.status < 300) {
        // 8. Success — consume one grant use AFTER a verified
        //    execution (double-count refusal handled by the module).
        if (!recordGrantUse(grant)) {
          return deny("grant_use_limit_reached");
        }
        return {
          status: "executed",
          exitCode: response.status,
          stdout,
          stderr: "",
          notes: truncated ? "response_truncated" : undefined,
        };
      }
      if (response.status === 401 || response.status === 403) {
        return {
          status: "denied",
          exitCode: response.status,
          stdout: "",
          stderr,
          notes: "http_" + response.status,
        };
      }
      if (response.status === 404 || response.status === 422) {
        return {
          status: "denied",
          exitCode: response.status,
          stdout: "",
          stderr,
          notes: "http_" + response.status,
        };
      }
      return {
        status: "unavailable",
        exitCode: response.status,
        stdout: "",
        stderr,
        notes: "http_" + response.status,
      };
    },
  };
}
