# RADARMatrix Usage Tutorial

RADARMatrix is the intelligence, memory, governance, and audit layer for RADARCharts and connected AI workflows. The current repository is an **integration foundation**, not a deployed production service. It defines MCP tool contracts, role boundaries, workspace isolation, audit expectations, and security requirements; it does not yet provide a live hosted endpoint, database, OAuth issuer, or Instagram publishing connection.

## 1. Understand the current repository

The repository is organized around a small MCP gateway foundation:

| Path | Purpose |
|---|---|
| `apps/mcp-server/src/mcp-gateway.ts` | Gateway pipeline and request handling foundation |
| `apps/mcp-server/src/chatgpt-app-contract.ts` | Tool definitions and contract metadata |
| `apps/mcp-server/src/providers/` | Authentication, authorization, and membership boundaries |
| `apps/mcp-server/.well-known/` | OAuth protected-resource metadata foundation |
| `tests/` | Contract and gateway behavior tests |
| `ARCHITECTURE.md` | System design and component responsibilities |
| `SECURITY.md` | Threat model and security requirements |
| `docs/V0.8-CHATGPT-INTEGRATION.md` | ChatGPT integration roadmap |
| `docs/USAGE-TUTORIAL.md` | This operating tutorial |

The repository deliberately separates the **contract layer** from future infrastructure. A passing test means the foundation contract behaves as expected; it does not mean that production authentication, persistence, deployment, or Meta access is live.

## 2. Run the foundation locally

Use Node.js with ECMAScript module support. From the repository root, run:

```bash
npm test
```

The command runs both suites. You can run them independently:

```bash
npm run test:gateway
npm run test:contract
```

Before opening a pull request or making a deployment decision, also run:

```bash
node --check apps/mcp-server/src/mcp-gateway.ts
node --check tests/v0.7-gateway.test.mjs
node --check tests/v0.8-chatgpt-contract.test.mjs
git diff --check
```

The current tests are contract-level foundation tests. They validate authentication context assumptions, role permissions, workspace isolation, request validation, tool metadata, write-operation gating, audit expectations, and immutability expectations.

## 3. Learn the seven foundation tools

RADARMatrix currently defines five read tools and two write tools.

| Tool | Use it for | Minimum role |
|---|---|---|
| `radar.search` | Search canonical data and documents | `VIEWER` |
| `radar.recall` | Retrieve decisions and historical context | `VIEWER` |
| `radar.get_context` | Load workspace context and configuration | `VIEWER` |
| `radar.get_project` | Read project metadata and related entities | `VIEWER` |
| `radar.get_entity` | Read an entity and its relationships | `VIEWER` |
| `radar.remember` | Add durable workspace memory | `CONTRIBUTOR` |
| `radar.record_decision` | Record a decision and rationale | `EDITOR` |

Every request should be associated with a workspace. The workspace is the isolation boundary: a caller must not be able to read or write another workspace’s data.

## 4. Use the memory and decision workflow

When you want RADARMatrix to remember something, provide durable, reusable context rather than a temporary instruction. A good memory includes the subject, the factual content, its source, its scope, and an optional review date.

For example:

```text
Remember for workspace remRADAR:
Our Instagram brand voice is direct, culturally literate, concise, and never uses fabricated urgency. All sponsored collaborations require disclosure review before publication.
Source: approved brand policy, 2026-09-05.
```

When a meaningful product or brand decision is made, record both the decision and the reasoning:

```text
Record this decision for workspace remRADAR:
Decision: Instagram collaboration acceptance remains human-approved during the pilot.
Rationale: Familiarity with a page is not sufficient evidence of current identity, rights, safety, or commercial terms.
Alternatives considered: automatic acceptance for frequent collaborators; full manual review for all requests.
Review date: after the first 14-day observation period.
```

Memories and decisions should be treated as durable records. Corrections should be appended as new, versioned context rather than silently rewriting history.

## 5. Use the planned Instagram workflow

The Instagram integration should be operated in stages:

### Observe-only mode

Start by connecting the official Instagram Professional account and collecting permitted read-only signals: account identity, webhook events, comments, messages, mentions, Insights, connector permissions, and health warnings. Do not publish, reply, message, or accept collaborations in this mode.

### Approval mode

Next, let RADARMatrix draft captions, carousels, replies, discussion prompts, newsletter opt-in language, and collaboration assessments. Every public or sensitive action enters an approval queue. You can approve, edit, reject, or defer it.

### Governed execution

Only after approval does the rate-governance layer check consent, brand policy, rights, account state, sliding-window capacity, token-bucket capacity, provider usage signals, circuit breakers, and idempotency. The action then executes through the official connector and records a provider receipt.

### Measurement mode

After execution, inspect outcomes such as reach, views, comments, shares, saves, replies, opt-outs, complaints, errors, and approval quality. Optimize for meaningful audience response and brand health—not artificial activity volume or guaranteed algorithmic reach.

## 6. Apply brand policy before action

Create a versioned brand policy containing:

- Voice, tone, vocabulary, and prohibited phrasing.
- Approved claims and evidence requirements.
- Visual identity and accessibility requirements.
- Rights, licensing, and attribution rules.
- Sponsorship and collaboration disclosures.
- Moderation and escalation rules.
- Consent and newsletter opt-in language.
- Topics requiring human review.
- Crisis and account-recovery procedures.

When the policy changes, increment its version. Any public action should record the policy version that approved it.

## 7. Use community administration safely

For comments and messages, ask RADARMatrix to classify the queue before drafting responses:

```text
Review today’s Instagram community activity. Group items into support, praise, criticism, safety concern, collaboration, press, spam, and urgent escalation. Draft responses but do not send anything.
```

Require human approval for public replies during the pilot. For DMs, enforce user-initiated context, the applicable response window, automation disclosure, opt-out handling, and human escalation. Do not use RADARMatrix for unsolicited cold-DM campaigns or repeated contact after a user declines.

## 8. Use the safety dashboard

The safety view should be checked before enabling mutations. Ask for:

```text
Show the current Instagram account health, connector permissions, webhook verification status, event backlog, rate usage, circuit breakers, pending incidents, and recovery warnings.
```

A healthy account is not simply “connected.” It should have a verified account identity, expected permissions, valid webhook signatures, normal queue latency, no unexplained provider errors, no open circuit breaker, and a current brand-policy version.

## 9. Stop activity immediately when needed

Use a precise stop command:

```text
Pause all Instagram publishing and messaging for the remRADAR account. Keep evidence capture and read-only health monitoring active. Create an incident report with the trigger, current queue, provider errors, permissions, and last successful receipts.
```

For a wider incident:

```text
Open the RADARMatrix workspace emergency stop for all Instagram mutations. Do not delete content or evidence. Cancel only jobs that have not been submitted to the provider.
```

The emergency stop should block new mutations, suppress retries, preserve receipts, and leave official account recovery available. It should not automatically delete posts, rotate credentials blindly, or submit repeated appeals.

## 10. Recover an old brand page

Use the recovery workflow only if you are authorized to recover the brand account. First classify the problem: forgotten access, lost email or phone, hacked account, two-factor-authentication issue, disabled account, ownership dispute, or connector permission failure.

Then ask:

```text
Start an official Instagram recovery case for the old brand page. Do not attempt to bypass enforcement. Prepare a factual timeline, ownership-evidence checklist, known account identifiers, prior administrator information, and the official Meta recovery route. Do not store passwords, OTPs, recovery codes, or private keys.
```

The authorized owner must complete sensitive verification directly in Meta or Instagram’s official interface. If access is restored, do not resume automation immediately. Revalidate identity, security settings, administrators, linked assets, permissions, recent activity, and account status first; then run one approved low-risk canary.

## 11. Understand what is not live yet

The repository currently does not prove that the following are deployed:

| Capability | Current repository status |
|---|---|
| Live MCP endpoint | Not deployed by this repository |
| Real OAuth/OIDC validation | Foundation only |
| Database or vector store | Not connected |
| Instagram connector | Not implemented or authorized here |
| Meta webhook endpoint | Architecture requirement, not deployed here |
| Automatic publishing or messaging | Not enabled here |
| Account restoration | Official workflow guidance only |

Treat the repository as the governance and integration foundation until deployment, credentials, connector permissions, database persistence, webhook verification, and runtime checks have all been completed.

## 12. A practical first-week operating routine

On day one, run the tests and review `ARCHITECTURE.md` and `SECURITY.md`. On day two, finalize the brand policy and account ownership map. On day three, connect one official Instagram Professional account in observe-only mode. On day four, verify webhook signatures, deduplication, queue health, and emergency stops. On day five, create drafts without publishing. On day six, approve one low-risk action and verify the receipt. On day seven, review errors, opt-outs, complaints, content quality, and account health before expanding.

The core habit is simple: **ask RADARMatrix to observe first, draft second, govern third, execute fourth, and measure fifth.** Keep sensitive recovery and identity verification in the official Meta or Instagram interface.

## 13. Use the connected Brand Studio API

The local Brand Studio now reads workspace state through the gateway adapter and persists it to a durable JSON workspace file at `.data/workspace.json` by default. The storage path can be changed with `RADARMATRIX_DATA_FILE`. This JSON adapter is suitable for local development and verification; production should replace it with the planned database-backed repository while preserving the same gateway contract.

Run the application with:

```bash
npm run brand:dev
```

The current development identity is `admin_123`, the development workspace is `w_dev`, and membership is explicit rather than wildcarded. These fixtures are not production authentication.

The local API exposes `GET /api/workspace`, `POST /api/assets`, `POST /api/content`, and `POST /api/emergency-stop`. Write routes pass through the gateway adapter. They require explicit approval, and content or message-like actions can additionally require consent. Rate governance runs before execution, audit events are appended to durable state, and the emergency-stop route persists a mutation pause while leaving read-only monitoring available.

A production deployment must replace the development caller fixture with verified OAuth/OIDC authentication, durable membership storage, a database or equivalent transactional store, signed webhook ingestion, secret management, and deployment-level observability before enabling real Instagram actions.
