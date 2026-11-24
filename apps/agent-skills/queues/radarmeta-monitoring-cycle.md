# RADARMeta — Continuous Monitoring Cycle

**Source:** RADARMeta monitoring workflow in the supplied Drive skill bundle.

## Copy-ready prompt

> Run one read-only RADARMeta monitoring cycle for the user-designated social account. First verify the account identity, available read scopes, tool support, reporting period, and persistent-state location. Never assume a connector exposes a field because the social platform supports it. Do not call write tools during monitoring.
>
> Read the previous validated state before collecting. Keep distinct `PREVIOUS STATE`, `CURRENT STATE`, and append-only `CHANGE LOG` records. Collect a timestamped account snapshot and the newest available post inventory. Paginate until the previous newest known post is reached, the source ends, or a practical limit is hit. Record pages/cursors, coverage, post IDs/timestamps/types, and queried insights. Query insights only where supported; deliberately sample and disclose anything not sampled.
>
> Compare only confirmed values. Do not turn missing data into zero; do not infer causation from correlation. Classify each finding **OBSERVED FACT**, **DATA-BASED INFERENCE**, **RECOMMENDATION**, or **UNKNOWN**. Track recurring series only when evidence supports them, including Artist Spotlight, Creative Spotlight, Release Radar, New Music Alert, Article Spotlight, RADARMusic, BTS, and Community/Music Conversation.
>
> Validate data before changing state. If a critical collection step fails or is incomplete, preserve the last reliable baseline, mark the current cycle incomplete, do not promote it, and report the failure. After a complete report, append the dated comparison, save the validated current state, then promote it to the next baseline without erasing history.
>
> Report: **AUDIT TIMESTAMP; ACCOUNT; DATA PERIOD; READ-ONLY SCOPE; COVERAGE/LIMITATIONS; ACCOUNT; CONTENT; PERFORMANCE; COMMUNITY SIGNALS; NETWORK OPPORTUNITIES; TREND OPPORTUNITIES; BRAND POSITIONING; RISKS/UNKNOWN; RECOMMENDED ACTIONS**. For each changed item, include previous baseline, current state, change (only if calculable), evidence/sample, interpretation, and recommendation. Explicitly state unavailable fields as `UNKNOWN — NOT EXPOSED BY CURRENT CONNECTOR`. Recommendations remain unexecuted.
