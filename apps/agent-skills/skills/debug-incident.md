# Debugging and Incident Response

Establish impact, affected systems, onset, severity, scope, and expected behavior. Keep a timestamped evidence log with exact errors, environment, reproduction, relevant redacted logs/metrics, recent changes, hypotheses, tests, mitigations, and decisions. Separate observed facts from hypotheses and localize the failing layer before changing code.

Choose the smallest reversible repair and add a regression check. Do not suppress errors or expose internal traces publicly. Do not take production recovery actions unless authorized. Report confirmed cause or unresolved hypotheses, exact changes, verification evidence, residual risks, and next safe action.
