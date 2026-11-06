/**
 * RADARMatrix shared test harness.
 *
 * Why this exists:
 * The suites historically printed "\u2717 <name>: <message>" inside a catch block
 * and continued. Nothing counted those failures and the orchestrator ended with
 * an unconditional `process.exit(0)`, so `npm test` exited 0 while printing
 * failures. That is a fail-open harness: CI could not distinguish pass from
 * fail, and the string guard ("no swallowed \u2717 lines") only worked if someone
 * read the output.
 *
 * This module gives every suite one shared, process-wide failure counter and a
 * single place that decides the exit status. A suite that records a failure can
 * no longer be reported as passing.
 */

const failures = [];

/**
 * Record a failed assertion/test. Must be called from every catch block that
 * previously only logged.
 * @param {string} label
 * @param {unknown} [error]
 */
export function recordFailure(label, error) {
  const detail = error instanceof Error ? error.message : error === undefined ? "" : String(error);
  const text = detail ? `${label}: ${detail}` : String(label);
  failures.push(text);
}

/**
 * @returns {readonly string[]} recorded failures (copy)
 */
export function getFailures() {
  return failures.slice();
}

/** @returns {number} */
export function getFailureCount() {
  return failures.length;
}

export function resetFailures() {
  failures.length = 0;
}

/**
 * Wrap a single test body so an assertion error is recorded, printed, and
 * counted. Returns true on pass, false on failure.
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
export async function check(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    recordFailure(name, error);
    console.log(`  \u2717 ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
