# RADARMatrix Live Baseline — 2026-11-06

## Verified repository state

Public repository: `remRADAR/RADARMatrix`; default branch `main` at `91d95170a541a2355c409b2a2d0c8f30e1b20e71`. The clone was clean before review. This baseline is verified from a fresh clone, remote refs, authenticated GitHub PR/CI metadata, and local test execution. No remote refs or PRs were changed during baseline inspection.

PR #11 (Matrix Console prototype) is **merged** (2026-11-05). The console is present in current main, but remains a prototype/local-demo surface; PR #11's historical head commit is not an ancestor of main, consistent with squash-style integration. PR #12 (RM-IEP/1 boundary contracts) remains open Draft, based on `security/m2-2-3-authority-hardening`, not `main`. PR #13 (Stage 0.1 architecture/OS scaffold) remains open Draft, based on historical main SHA `93c1dc18…`. Neither security nor architecture PR has been merged.

Other open Draft PRs are stacked as follows: #1 and #2 target main; #3 targets main; #5 and #6 target `chat/m2-production-auth-v2`; #7 targets that chat branch; #8 targets #7's authority-provenance branch; #10 and #12 target `security/m2-2-3-authority-hardening`; #13 targets main. Their remote feature trees overlap and diverge substantially. GitHub reports successful visible checks for many branches, but green CI is not merge authorization or proof of clean integration into current main. Do not merge all branches together.

## Existing functionality

Current main includes a React/Vite Matrix Console with local/demo data, an MCP gateway and tool contracts, workspace-scoped in-memory/local foundations, plan-only specialist routing, a skill registry, and a Brand Studio. Root tests, production-mode fail-closed smoke, console typecheck, production build, and console smoke all passed on current main after installing the console lockfile dependencies. The production smoke intentionally returns 503 when auth configuration is absent.

## Incomplete functionality

Production OAuth/OIDC authentication is **NOT IMPLEMENTED**. The current auth provider is deterministic development-only identity based on configured `caller_id`; it is not cryptographic authentication. Durable production workspace storage, the full integrated Console control plane, authenticated tool execution, a real isolated local execution adapter, device identity, production audit persistence, recovery/observability, and end-to-end agent execution are not established on main. RM-IEP/1 protocol/boundary code resides on open Draft PR #12 and is not itself process isolation. RADAR OS and Halo OS are scaffolds/proposals: no built image, verified boot, signed release/update flow, or physical-device compatibility evidence exists.

## Security blockers

Do not execute arbitrary/untrusted agent code with trusted authority or credentials. Protocol validation and import-boundary tests do not provide OS process isolation. Required remaining controls include authenticated session binding, strict per-tool schemas, current grant/approval checks and single-use enforcement, isolated adapter, timeouts/cancellation, workspace/identity isolation, immutable audit evidence, and adversarial tests. The attached execution directive also requires authenticated, narrowly scoped Cloudflare service-to-service communication; a Service Binding alone is not authorization. Cloudflare account ownership discrepancy must be resolved before provisioning. No production deployment, DNS/secret changes, migrations, or resources are authorized.

## Build and infrastructure limitations

The reviewed environment lacks `lb`, `qemu-system-x86_64`, `qemu-system-aarch64`, `qemu-img`, `xorriso`, and firmware images. Therefore no Debian Live image, ISO architecture inspection, QEMU boot, firmware validation, or hardware result can be claimed. Existing Cloudflare handoff records document an account mismatch and blocked asset transfer; they are historical but still relevant until reverified. Local CI and a Vercel preview check do not establish production deployment readiness.

## Recommended order

1. Complete Stage 0.1.1 corrections on an isolated branch, run regression checks, keep PR Draft, and obtain independent Mistral Vibe review.
2. Reconcile stacked M2 security/authentication PR ancestry against current main one reviewed unit at a time; do not enable untrusted execution until every authority/isolation/audit gate is implemented and adversarially verified.
3. Complete integrated Console/backend functions only where infrastructure and owner authorization exist; preserve demo-only truth labels until connected and verified.
4. Resolve the Cloudflare account/source-of-truth discrepancy and obtain explicit authorization before any resource or production change.
5. Proceed to reproducible RADAR OS development images and QEMU evidence only after required toolchains, source/pinning policy, firmware, and owner decisions are available; keep Halo OS integration and physical compatibility as later evidence-based gates.

**Scope note:** this is a baseline and correction milestone, not a claim that the complete RADARMatrix ecosystem is production-ready. Independent review is still required.
