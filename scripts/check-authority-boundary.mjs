import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
const root = process.cwd();
const protectedModules = {
  "apps/mcp-server/src/auth/server-composition.ts": new Set(["tests/server-authority.helper.mjs", "tests/m2-2-2-provenance.test.mjs", "tests/m2-2-3-authority-hardening.test.mjs", "tests/m2-2-4-composition-boundary.test.mjs", "tests/m2223-composition-child.mjs", "tests/m2224-boundary-child.mjs"]),
  "apps/mcp-server/src/auth/authority-state.ts": new Set(["apps/mcp-server/src/auth/delegation.ts", "apps/mcp-server/src/auth/server-composition.ts", "tests/m2224-boundary-child.mjs"]),
};
const sourceRoots = ["apps", "packages", "tests", "scripts"];
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
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
const repoPath = (file) => path.relative(root, file).split(path.sep).join("/");
function resolveRelative(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].map((x) => `${base}${x}`)];
  for (const candidate of candidates) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return repoPath(candidate);
  return null;
}
function checkImport(importer, specifier) {
  const target = resolveRelative(importer, specifier);
  if (!target || !protectedModules[target]) return;
  if (!protectedModules[target].has(repoPath(importer))) violations.push(`${repoPath(importer)} imports protected module ${target}`);
}
for (const sourceRoot of sourceRoots) for (const file of walk(path.join(root, sourceRoot))) {
  const ext = path.extname(file);
  const kind = ext === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const loaderNames = new Set(["require"]);
  function collectLoaders(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "createRequire") loaderNames.add(node.name.text);
    ts.forEachChild(node, collectLoaders);
  }
  collectLoaders(source);
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) checkImport(file, node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkImport(file, node.moduleSpecifier.text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) checkImport(file, node.moduleReference.expression.text);
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [arg] = node.arguments;
        if (!arg || !ts.isStringLiteral(arg)) violations.push(`${repoPath(file)} uses a non-literal dynamic import`);
        else checkImport(file, arg.text);
      }
      const callee = node.expression;
      const directLoader = ts.isIdentifier(callee) && loaderNames.has(callee.text);
      const resolveLoader = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "require";
      if (directLoader || resolveLoader) {
        const [arg] = node.arguments;
        if (!arg || !ts.isStringLiteral(arg)) violations.push(`${repoPath(file)} uses a non-literal require/createRequire target`);
        else checkImport(file, arg.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (repoPath(file) === "apps/mcp-server/src/auth/delegation.ts") for (const statement of source.statements) if (ts.isFunctionDeclaration(statement) && statement.name?.text === "initializeServerAuthority" && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) violations.push("delegation.ts exports unrestricted initializeServerAuthority");
}
if (violations.length) { console.error("Authority boundary check failed:"); for (const violation of violations) console.error(`- ${violation}`); process.exit(1); }
console.log("Authority boundary check passed: complete source scan and protected module loading policy are clean.");
