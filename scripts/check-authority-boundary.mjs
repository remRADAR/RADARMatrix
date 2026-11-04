import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const protectedModules = {
  "apps/mcp-server/src/auth/server-composition.ts": new Set([
    "tests/server-authority.helper.mjs",
    "tests/m2-2-2-provenance.test.mjs",
    "tests/m2-2-3-authority-hardening.test.mjs",
    "tests/m2-2-4-composition-boundary.test.mjs",
    "tests/m2223-composition-child.mjs",
    "tests/m2224-boundary-child.mjs",
  ]),
  "apps/mcp-server/src/auth/authority-state.ts": new Set([
    "apps/mcp-server/src/auth/delegation.ts",
    "apps/mcp-server/src/auth/server-composition.ts",
    "tests/m2224-boundary-child.mjs",
  ]),
};

const sourceRoots = ["apps", "packages", "tests", "scripts"];
const sourceExtensions = new Set([".ts", ".js", ".mjs", ".cjs"]);
const violations = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute));
    else if (sourceExtensions.has(path.extname(entry.name))) result.push(absolute);
  }
  return result;
}

function repoPath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function resolveRelative(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, `${base}.cjs`];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return repoPath(candidate);
  }
  return null;
}

function checkImport(importer, specifier) {
  const target = resolveRelative(importer, specifier);
  if (!target || !protectedModules[target]) return;
  const allowed = protectedModules[target];
  const importerPath = repoPath(importer);
  if (!allowed.has(importerPath)) {
    violations.push(`${importerPath} imports protected module ${target}`);
  }
}

for (const sourceRoot of sourceRoots) {
  for (const file of walk(path.join(root, sourceRoot))) {
    const text = fs.readFileSync(file, "utf8");
    const scriptKind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        checkImport(file, node.moduleSpecifier.text);
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        checkImport(file, node.moduleSpecifier.text);
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (expression && ts.isStringLiteral(expression)) checkImport(file, expression.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [argument] = node.arguments;
        if (argument && ts.isStringLiteral(argument)) checkImport(file, argument.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);

    if (file.endsWith("apps/mcp-server/src/auth/delegation.ts")) {
      for (const statement of source.statements) {
        if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
        if (statement.name.text === "initializeServerAuthority" && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          violations.push("delegation.ts exports unrestricted initializeServerAuthority");
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Authority boundary check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Authority boundary check passed: protected modules have only approved imports and delegation.ts exposes no unrestricted initializer.");
