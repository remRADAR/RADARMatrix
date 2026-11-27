# RADARMeta Continuous Monitoring Workflow

Use this reference only when the user requests a recurring or point-in-time read-only monitoring cycle.

## Cycle

1. Read the last validated state. Keep `PREVIOUS STATE`, `CURRENT STATE`, and an append-only `CHANGE LOG` distinct.
2. Verify the account identity, current read scopes, available fields, source timestamp, and practical page limit. Never infer tool support from platform capability.
3. Collect a timestamped account snapshot and paginate the newest content until reaching the previous known item, source exhaustion, or a disclosed limit. Record exact coverage, cursors/pages, IDs/timestamps/types, and which insight queries were/weren't available.
4. Deliberately sample insights when a full scan is impractical; report sample design and coverage. Do not interpret missing values as zero.
5. Compare confirmed values; distinguish observations from inference and do not claim causation from correlation. Track content series only when observed.
6. Validate the current collection before state mutation. If a critical step fails, retain the last reliable baseline, mark the current state incomplete, and do not promote it.
7. After completing the report, append a dated change record, save validated current state, and then promote it as the next baseline without erasing history.

## Report

Use **AUDIT TIMESTAMP; ACCOUNT; DATA PERIOD; READ-ONLY SCOPE; COVERAGE/LIMITATIONS; ACCOUNT; CONTENT; PERFORMANCE; COMMUNITY SIGNALS; NETWORK OPPORTUNITIES; TREND OPPORTUNITIES; BRAND POSITIONING; RISKS/UNKNOWN; RECOMMENDED ACTIONS**.

For each changed item state previous baseline/time, current value/time, calculable change, evidence/sample, interpretation, and recommendation. Explicitly label unavailable fields `UNKNOWN — NOT EXPOSED BY CURRENT CONNECTOR`. Recommendations are not actions; monitoring mode never invokes write operations.
