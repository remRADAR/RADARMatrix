---
name: radar-repo-operations
description: Repository release and documentation operations for remRADAR projects. Use when recording milestones, building or publishing themed HTML wiki pages, creating GitHub tags and releases, updating GitHub milestones, or synchronizing repository-operation guidance into RADARMatrix.
---

# RADAR Repository Operations

Use this skill for an authorized release/documentation pass on a remRADAR repository. Treat repository code and configuration as the source of truth; treat wiki pages and release prose as verified summaries, never as evidence of deployment.

## 1. Inspect before changing

1. Confirm the repository, current branch, clean/dirty state, latest commit, package version, project instructions, and existing release/tag/milestone state.
2. Read the project README and any `CLAUDE.md`, `AGENTS.md`, or release instructions.
3. Identify the canonical theme source. For RADARSite this is `src/app/globals.css`; record the dark/light colors, typography, radius, rule, motion, and reduced-motion tokens before editing wiki HTML.
4. Inspect `public/wiki/` and compare every navigation link with a real file. Do not leave links to unwritten pages.
5. Inspect RADARMatrix's `apps/agent-skills/` before adding a skill. Its `registry.json` is the source of truth and `skill-manifest.json` is generated.

## 2. Record milestones accurately

Create or update a repository milestone record such as `docs/MILESTONES.md`. Use commit hashes and dates from Git history. Separate completed work from pending validation or deployment. For the RADARSite release train, the verified completed milestones are:

- `ed58ff5`: three reusable ticker stacks for brand logos, partners, and projects.
- `caacf2f`: Studio admin repair and release-health/pending-issue detection.
- `87bc3fe`: late-arriving canonical release-platform discovery and verified-link merging.

If GitHub Milestones are requested, create one milestone per coherent delivery unit with a factual description and close it only when the work is complete. Do not invent production deployment, live credentials, or external platform state.

## 3. Build the themed HTML wiki family

Keep static HTML under `public/wiki/` as the canonical build source. Reuse the token block and accessibility behavior from the project theme rather than introducing a second design language. Every page should preserve:

- Editorial Brutalist black/paper field, ink, flare, secondary, and muted tokens.
- Archivo plus Space Mono typography.
- Zero-radius corners and 2px rules.
- Dark/light theme toggle, visible focus, dot-grid treatment, and reduced-motion fallback.
- A repository back-link and a clear statement that code/configuration outrank wiki prose.

After adding pages, run an HTML/reference check that confirms local `href` targets exist. Keep page names stable and lowercase with `.html` suffixes. Update the home page navigation when pages are added.

## 4. Create a release

Use the package version unless the user explicitly approves a version change. For a first release at `package.json` version `0.1.0`, use annotated tag `v0.1.0` and a GitHub release with:

- a concise release title;
- the project version and release commit;
- completed milestone summary with commit links;
- validation commands and results;
- known limitations or warnings, especially unverified deployment/integration claims;
- links to the repository and published wiki.

Before tagging, commit documentation and source changes, run the project's appropriate lint/typecheck/build or focused contract tests, then verify the tag points at the intended commit. Do not force-move an existing tag.

## 5. Publish the wiki safely

GitHub's wiki page API is not available as a normal REST endpoint. Check whether `<owner>/<repo>.wiki.git` exists. If it does, clone it and publish Markdown/HTML according to the enabled wiki format. If it does not, initialize the wiki through GitHub's web interface, then push or create the pages. Preserve the themed HTML family in the main repository even when GitHub's native wiki renderer cannot display the same static shell. Report the exact published URL and any GitHub wiki initialization limitation.

## 6. Synchronize RADARMatrix

Add the skill as `apps/agent-skills/skills/radar-repo-operations/SKILL.md`, add a stable `radar-repo-operations` entry to `apps/agent-skills/registry.json`, and attach it to the lead profile when it is relevant to repository operation planning. Keep `allowedMcpTools` empty and `accessMode` plan-only. Run `npm run manifest:agent`; never hand-edit `skill-manifest.json`. Add a short entry to `apps/agent-skills/README.md` only if the library layout needs explaining. Run the relevant Matrix tests, inspect the diff, commit, and push the authorized branch.

## 7. Final verification

Re-check both working trees, commit IDs, tag/release URLs, milestone state, wiki page availability, local wiki links, skill validation, and generated manifest freshness. Report completed actions separately from limitations. Never claim that a page is published, a release exists, or a skill is installed until the corresponding remote or validator check succeeds.
