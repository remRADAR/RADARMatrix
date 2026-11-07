# RADARMatrix Handoff

## Checkpoint: Matrix Console prototype

- Branch: `prototype/matrix-console-v1`
- Base verified: `main` at `93c1dc18f04faae015c0afdd196c854278f5bee1`
- Scope: standalone `apps/matrix-console/` React + TypeScript + Vite demo UI
- State: local demonstration data only; no model, agent execution, durable storage, GitHub app connection, Cloudflare storage, browser takeover or terminal is exposed
- Screens: Overview, RADAR Chat, Agent Network, Skills Library, Knowledge Centre, Task Centre, Connections & Settings, plus honest future surfaces for Operator Screen, Matrix IDE, Cloud Computer and Halo OS
- Deployment: not started; Cloudflare staging remains gated on frontend verification and connector-specific deployment setup
- Owner decisions pending: confirm public staging timing/URL after smoke test; no production changes authorized

- Prototype commit: `acd03a9bab953f24b8f7d115ec372421e6a7f35f`
- Draft PR: https://github.com/remRADAR/RADARMatrix/pull/11
- Verification: `npm test`, `npm run test:deployment`, `npm run typecheck`, `npm run build:matrix-console`, `npm run test:matrix-console`, HTTP root/route-manifest smoke, and `git diff --check` all passed.
- Cloudflare baseline: account `825459f1f313c6c9427bf6718bbd4907`, workers.dev subdomain `radarcharts-cache`, two existing Workers, no `radarmatrix-prototype`.
- Cloudflare deployment: not claimed. The connector can create the Worker, but its execution runtime rejected unauthenticated fetches from the temporary asset CDN and GitHub/CDN sources; static asset upload therefore stopped before any resource was created.

## Checkpoint: Cloudflare static asset manifest

- Commit: `d65dc8ec7ea6b1f417695296ead76f430bd817ce`
- Manifest: `apps/matrix-console/cloudflare-assets-manifest.json`
- Generator: `scripts/create-cloudflare-assets-manifest.mjs`
- Runbook: `docs/CLOUDFLARE-STAGING-ASSET-UPLOAD.md`
- Manifest validation: four files, deterministic Cloudflare SHA-256/base64+extension hashes, raw-byte sizes, `git diff --check` passed.
- Deployment diagnosis: the active Cloudflare connector authorizes account `f3ea4523accdd48e8469707368b39799` (`remradar` workers.dev), while the previously inspected staging account is `825459f1f313c6c9427bf6718bbd4907` (`radarcharts-cache`). The manifest registration request against `825459f1f313c6c9427bf6718bbd4907` was rejected with HTTP 403 / error 10000 before upload; no bytes or Worker resources were changed.


## Checkpoint: connected Cloudflare retarget

- Connected account: `f3ea4523accdd48e8469707368b39799`
- Connected workers.dev subdomain: `remradar`
- Build verification: typecheck, production build, Matrix Console smoke, manifest regeneration, and diff check passed.
- Manifest registration: succeeded for `radarmatrix-prototype`; Cloudflare returned three upload buckets covering all four assets.
- No asset bytes uploaded and no Worker deployment performed in this checkpoint.

## Checkpoint: connected-account upload attempt

- Manifest registration succeeded for account `f3ea4523accdd48e8469707368b39799` / subdomain `remradar`.
- Cloudflare returned three asset buckets for the four verified build files.
- Asset upload did not start because the Cloudflare execution runtime cannot read the sandbox filesystem and its outbound policy rejects the temporary CDN/GitHub mirrors used to bridge raw bytes.
- No partial asset upload, Worker version, deployment, route, DNS record, or secret was created.

## Checkpoint: RADAR OS Stage 1 setup (BLK-2 real-kernel evidence)

- Branch: `stage-1/blk2-real-kernel-validation`, stacked on the Stage 0.1.2 branch (`architecture/stage-0-1-2-image-validation-corrections`, PR #18) at head `6caadd8`.
- PR lineage preserved: #14 -> #15 -> #16 -> #18; PR #17 (Halo OS PWA) remains a separate workstream. No merges, closes, rebases, DNS, or deploy actions taken.
- Executable-bit incident (transport artifact): the GitHub contents API resets mode 100755 -> 100644 on pushed files. Red runs 42331593152, 42348935554 (exit 1) and 42349265380, 42349323490 (exit 126) never reached an assertion. Heals: `f85287a`, `c4601e3`, `6caadd8` (same content also applied to the Stage 1 branch as `81001c8`). All internal invocations now use explicit interpreter prefixes; repository-tree mode restoration lands via the real-kernel validation workflow's git-client commit.
- New CI (push to `stage-1/**` only): `.github/workflows/radar-os-real-kernel-validation.yml` downloads four pinned REAL Debian kernels (bookworm/trixie x amd64/arm64) from immutable snapshot `20261101T000000Z`, records their actual file(1) descriptors, and runs the real `validate-image.sh` end-to-end against ISO fixtures built with xorriso from those kernels. Same-architecture kernels must validate; cross-architecture metadata and descriptor-less (compressed) kernels must fail closed. Machine-generated evidence is committed to `os/radar-os/evidence/real-kernel-validation.json`.
- Prepared, owner-gated: `.github/workflows/radar-os-stage1-build.yml` (workflow_dispatch ONLY, hard gate `owner_base_approval`). Real live-build from the immutable snapshot, real validation, QEMU boot (SeaBIOS for amd64, AAVMF for arm64), full logs/ISO/evidence artifacts, optional two-build reproducibility comparison that fails on differing digests. It has NOT been dispatched.
- `auto/config` now honors `RADAR_OS_DISTRIBUTION` (bookworm|trixie, default trixie); unsupported suites fail closed; `os/radar-os/tests/distribution.test.sh` covers default, explicit passthrough, and fail-closed.
- Debian base decision: PENDING owner approval. Assessment: `docs/os/DEBIAN-BASE-ASSESSMENT.md` (recommendation: Debian 13 trixie). No production Stage 1 build has run.
- Honest boundary: no genuine Debian Live ISO has been built and no QEMU boot of a real image has run yet; the earlier BusyBox initramfs ISO remains historical illustration only and does not count as Debian Live evidence.
