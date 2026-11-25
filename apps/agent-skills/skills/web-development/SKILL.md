---
name: web-development
description: Portable coordination checklist for web-app changes that cross frontend and backend concerns. Use when a web task needs an end-to-end project-context review; defer focused accessibility, security, performance, SEO, API, design, and framework work to the matching account skill.
---

# Web Development

Inspect the actual project, routes, components, stack, tests, data/auth boundaries, and deployment state before editing. Convert the user's goal into observable acceptance criteria and preserve project conventions.

Deliver coherent behavior across responsive layout, interaction states, semantic markup, accessibility, validation, API/data handling, security, performance, and maintainability. Test loading, empty, error, and success states as applicable. Adapt implementation to the detected stack instead of assuming one.

Check relevant WCAG 2.2 criteria and use risk-appropriate web security verification (OWASP ASVS-style where suitable). Review authorization boundaries, input handling, secrets, error disclosure, dependencies, and data access. Never weaken security or expose secrets to make a feature work.

Keep changes scoped and reversible. Prefer isolated preview/build/test. Do not change production domains, data, deployment, variables, or permissions without authorization. Verify the diff and report exact checks, observed results, unknowns, and next approval gate.
