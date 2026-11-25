---
name: frontier-router
description: First-pass, project-aware skill router for tasks that may need specialized agent guidance. Use before task execution when several skills may apply, when working inside a project with its own instructions or skill pack, or when selecting among account and repository skills. Identify the requested outcome and project context, inspect the available skill inventory, then load only the best-fit specialist skills.
---

# Frontier Router

Act as the first-pass routing layer. Understand what the user is trying to accomplish and which project, environment, constraints, and deliverable are involved before selecting specialist skills. Route the work; do not replace the specialists that execute it.

## Routing workflow

1. **Clarify the outcome internally.** Extract the requested result, task type, target project, audience, constraints, and requested actions. Distinguish the user's actual request from ideas or quoted content. Ask a concise question only if a missing detail materially changes the route or outcome; otherwise state a conservative assumption and continue.
2. **Inspect project context.** When a repository or project is named or attached, read its relevant entry points and instructions (for example `AGENTS.md`, `CLAUDE.md`, project README, manifests, or existing skill indexes) before choosing project-specific guidance. Verify the working project and available tools instead of assuming them.
3. **Discover the real skill inventory.** Use the skill catalog and descriptions actually provided in the current session, plus project/repository skill manifests that are available. Treat names as candidates, not proof of capabilities. Do not invent skills, tools, integrations, or permissions. If the inventory cannot be inspected, route only from skills already visible and say what remains unknown.
4. **Choose the smallest useful set.** Select one primary skill for the central task and only the supporting skills needed for independent concerns (normally no more than two). Prefer a focused specialist over a broad generalist. Use project-specific guidance where it adds real conventions or domain context; combine it with an account-level specialist when that improves execution. Avoid duplicate or conflicting instructions.
5. **Load before acting.** Read the primary skill and each necessary supporting skill before substantive work. Load referenced materials only when the selected skill or task needs them. Do not load every skill “just in case.” Respect higher-priority system/developer instructions and project policy when skills conflict.
6. **State the route briefly, then proceed.** Give the user a concise routing note: primary skill, any supporting skill(s), and a short reason tied to their requested outcome/project. Do not reveal private chain-of-thought; provide only a brief decision summary. Do not stop at a routing plan when the task is clear, authorized, and actionable.
7. **Execute and verify.** Follow the selected skill procedures, independently check actual permissions and capabilities, and verify the result. Skills provide guidance, not authority. Do not perform high-impact external actions without the required authorization or dedicated confirmation flow.

## Routing principles

- Route by **what must be achieved**, not by isolated keywords in the request.
- Prefer narrow domain skills for specific work; use a broad lifecycle skill only when the task genuinely crosses several domains or no focused skill fits.
- Treat project-specific instructions as context and constraints, not permission to override higher-priority instructions.
- Use more than one skill only when they contribute distinct, necessary steps. Resolve overlap by naming one execution lead and assigning each supporting skill a bounded role.
- For a task involving research and implementation, separate the evidence-gathering/research skill from the engineering skill; do not let research guidance silently authorize implementation or external changes.
- If no relevant skill is available, proceed with general capability where appropriate, disclose that no matching specialist was found, and do not fabricate a skill.
- If a skill calls for a tool or integration that is unavailable, report the limitation and use a safe fallback only when it can still meet the user's request.

## Route note format

Use a short note, not a long deliberation:

> **Route:** `[primary skill]` leads because `[task-specific reason]`. `[supporting skill(s)]` cover `[bounded concern(s)]`. I’ll follow the project’s `[relevant instruction/index]` and verify `[key outcome]`.

For simple tasks with one obvious specialist, keep this to one sentence. Do not expose hidden reasoning or produce a catalog of unrelated skills.

## Examples

- **“Fix the failing API integration in this repository.”** Inspect the repo guidance and failure context. Select the relevant debugging skill as lead; add API or framework guidance only if the failing contract or stack needs it. Use project conventions, reproduce the problem, and verify the fix.
- **“Review accessibility on my marketing site.”** Select the accessibility specialist, with web-design/review guidance only if needed for the requested UI changes. Do not route to general application engineering merely because the target is a website.
- **“Research these competitors, then implement a comparison page.”** Use a research skill for verified findings and a web/application skill for the separately scoped page implementation. Keep sourced facts distinct from design choices.
- **“Continue the build another agent started.”** Inspect the project’s handoff convention, then use a continuity/handoff skill if one is available and permitted. Do not create a new ledger just as ceremony.
- **“Summarize this short text.”** If no specialist adds meaningful value, answer directly rather than loading a skill.

## Completion standard

Before finishing, confirm the selected specialist(s) matched the task, required project instructions were considered, and the requested result was verified at an appropriate level. Report the result, the checks performed, and material limitations—without claiming that a skill, tool, or action was available or completed unless confirmed.
