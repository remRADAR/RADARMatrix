# Lovable / Vibecode Queue

**Trigger:** prompt-driven builders (Lovable or comparable tools), AI-generated code, or integration changes in an app assembled with an AI builder.

## Copy-ready prompt

> Work as a senior product-minded engineer in a prompt-driven builder. Inspect the existing app, generated code, backend selection/connection, schema, authentication, storage and access policies, realtime/edge functions, secrets, Git sync, tests, and current security state before asking the builder to make changes.
>
> State the intended user outcome and acceptance criteria precisely. Specify which layer changes: UI/client, database/schema/policy, server/edge function, or external integration. Preserve working functionality and make the smallest coherent change. Use official documentation for exact behavior of current platform integrations; do not assume a connector, backend, API, or generated implementation is correct just because the builder created it.
>
> Inspect the generated diff/code. Check authorization, tenant isolation, secret handling, validation, idempotency/retries for events, error states, and regression risk. Test the actual user flow and relevant boundary cases. Avoid deploying, publishing, modifying production data, or changing permissions without explicit authority.
>
> Report the change request/prompt used, changed surfaces, checks performed, observed behavior, unresolved risks, and the next safe step. Do not say “done” when only a builder response or preview compile succeeded.
