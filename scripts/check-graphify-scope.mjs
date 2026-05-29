import {
  findGraphifyScopeViolations,
  pruneGraphifyOutOfScopeEntries,
  readGraphifyScopeConfig,
} from "./graphify-scope.mjs";

const root = process.cwd();
const shouldFix = process.argv.includes("--fix");
const scope = readGraphifyScopeConfig(root);

if (shouldFix) {
  const summary = pruneGraphifyOutOfScopeEntries(root, scope);
  console.log(
    [
      "Pruned Graphify out-of-scope entries:",
      `manifest=${summary.manifestEntries}`,
      `statIndex=${summary.statIndexEntries}`,
      `cacheFiles=${summary.cacheFiles}`,
      `graphNodes=${summary.graphNodes}`,
      `graphLinks=${summary.graphLinks}`,
      `graphHyperedges=${summary.graphHyperedges}`,
    ].join(" "),
  );
}

const violations = findGraphifyScopeViolations(root, scope);

if (violations.length > 0) {
  const preview = violations
    .slice(0, 25)
    .map(({ sourcePath, reason, refs }) => {
      const refText = refs.slice(0, 3).join("; ");
      const suffix = refs.length > 3 ? `; ...and ${refs.length - 3} more refs` : "";
      return `- ${sourcePath} (${reason}) via ${refText}${suffix}`;
    })
    .join("\n");
  const suffix = violations.length > 25 ? `\n- ...and ${violations.length - 25} more` : "";
  throw new Error(
    [
      "Graphify output contains paths outside the canonical graphify.scope.json source scope.",
      "Run `node scripts/check-graphify-scope.mjs --fix`, then rebuild Graphify with the same source scope.",
      preview + suffix,
    ].join("\n"),
  );
}

console.log("Graphify scope check passed.");
