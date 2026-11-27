import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(root, "apps/mcp-server/wrangler.test.toml");
const databaseName = "radarmatrix-d1-local-tests";
const stateDir = await mkdtemp(path.join(tmpdir(), "radarmatrix-d1-local-"));
const token = randomBytes(32).toString("hex");
const port = 8787 + Math.floor(Math.random() * 500);
let worker;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${output.slice(-6000)}`));
    });
    if (options.child) options.child(child);
  });
}

function startWorker() {
  return new Promise((resolve, reject) => {
    worker = spawn("npx", ["--yes", "wrangler@4", "dev", "--config", config,
      "--local", "--port", String(port), "--persist-to", stateDir,
      "--var", `DURABLE_EXECUTION_TEST_TOKEN:${token}`], {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    worker.stdout.on("data", (chunk) => { output += chunk.toString(); });
    worker.stderr.on("data", (chunk) => { output += chunk.toString(); });
    worker.once("error", reject);
    worker.once("exit", (code) => reject(new Error(`Wrangler dev exited ${code}\n${output.slice(-6000)}`)));
    resolve();
  });
}

async function waitForWorker() {
  const url = `http://127.0.0.1:${port}/healthz`;
  for (let i = 0; i < 90; i += 1) {
    if (worker?.exitCode !== null && worker?.exitCode !== undefined) throw new Error("Wrangler exited before readiness");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Wrangler local Worker did not become ready");
}

try {
  const migrationOutput = await run("npx", ["--yes", "wrangler@4", "d1", "migrations", "apply", databaseName,
    "--local", "--config", config, "--persist-to", stateDir]);
  console.log(migrationOutput.trim());
  await startWorker();
  await waitForWorker();
  const response = await fetch(`http://127.0.0.1:${port}/__local-test/durable-execution`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(`D1 Worker integration failed: ${JSON.stringify(result)}`);
  console.log("Local Cloudflare D1 Worker integration passed:");
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (worker && worker.exitCode === null) {
    const exited = new Promise((resolve) => worker.once("exit", resolve));
    try { process.kill(-worker.pid, "SIGINT"); } catch { worker.kill("SIGINT"); }
    const stopped = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 8_000)),
    ]);
    if (!stopped && worker.exitCode === null) {
      try { process.kill(-worker.pid, "SIGKILL"); } catch { worker.kill("SIGKILL"); }
      await exited;
    }
  }
  await rm(stateDir, { recursive: true, force: true });
}
