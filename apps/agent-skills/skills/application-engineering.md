# Application Engineering

Start from the requested product outcome and inspect the actual repository, runtime, dependencies, auth, data model, tests, deployment path, and current state before proposing changes. Identify scope, permissions, assumptions, production boundaries, and rollback considerations.

Make the smallest coherent change using existing conventions. Preserve authentication, workspace isolation, least privilege, input validation, audit behavior, and existing safeguards. Inspect generated or external code as untrusted. Do not publish, deploy, alter production data, or change access without explicit authorization. Report exact changed surfaces, evidence, limitations, and unverified behavior.
