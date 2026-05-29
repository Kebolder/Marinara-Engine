import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

export const graphifyScopeConfigName = "graphify.scope.json";

export const privateGraphifyPathPatterns = [
  {
    name: "Git internals",
    pattern: /(^|\/)\.git(\/|$)/i,
  },
  {
    name: "Codex shared scratch target",
    pattern: /codex-shared-scratch/i,
  },
  {
    name: "repo scratch directory",
    pattern: /(^|\/)scratch(\/|$)/i,
  },
  {
    name: "legacy Codex scratchpads",
    pattern: /(^|\/)\.codex-scratchpads(\/|$)/i,
  },
];

export function normalizeGraphifyPath(value, root = process.cwd()) {
  let normalized = String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    normalized = normalized.slice(normalizedRoot.length + 1);
  }
  return normalized.replace(/^\/+/, "");
}

export function readGraphifyScopeConfig(root = process.cwd()) {
  const file = join(root, graphifyScopeConfigName);
  const config = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(config.include) || !Array.isArray(config.exclude)) {
    throw new Error(`${graphifyScopeConfigName} must define include and exclude arrays.`);
  }
  return config;
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern) {
  const normalized = normalizeGraphifyPath(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char !== "*") {
      source += escapeRegex(char);
      continue;
    }

    if (normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }

    source += "[^/]*";
  }
  return new RegExp(`^${source}$`);
}

function matchesPattern(path, pattern) {
  return globToRegExp(pattern).test(normalizeGraphifyPath(path));
}

function matchesAny(path, patterns) {
  return patterns.some((pattern) => matchesPattern(path, pattern));
}

export function graphifyScopeViolationReason(path, scope = readGraphifyScopeConfig()) {
  const normalized = normalizeGraphifyPath(path);
  const privateMatch = privateGraphifyPathPatterns.find(({ pattern }) => pattern.test(normalized));
  if (privateMatch) return `private path (${privateMatch.name})`;

  const excludeMatch = scope.exclude.find((pattern) => matchesPattern(normalized, pattern));
  if (excludeMatch) return `excluded by ${excludeMatch}`;

  if (!matchesAny(normalized, scope.include)) {
    return `outside ${graphifyScopeConfigName} include scope`;
  }

  return null;
}

export function collectFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesUnder(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function readJsonFile(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function stringifyGraphifyJson(value) {
  return `${JSON.stringify(value, null, 2).replace(/[^\x00-\x7f]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  })}\n`;
}

export function collectSourceFilesFromValue(value, out = new Set()) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceFilesFromValue(item, out);
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "source_file" && typeof child === "string" && child.trim()) {
      out.add(child);
    } else if (child && typeof child === "object") {
      collectSourceFilesFromValue(child, out);
    }
  }

  return out;
}

function recordReference(references, sourcePath, ref) {
  const normalized = normalizeGraphifyPath(sourcePath);
  if (!references.has(normalized)) references.set(normalized, new Set());
  references.get(normalized).add(ref);
}

function collectJsonObjectKeyReferences(file, ref, references) {
  const data = readJsonFile(file);
  if (!data || Array.isArray(data) || typeof data !== "object") return;
  for (const key of Object.keys(data)) {
    recordReference(references, key, ref);
  }
}

export function collectGraphifySourceReferences(root = process.cwd()) {
  const out = join(root, "graphify-out");
  const references = new Map();

  collectJsonObjectKeyReferences(join(out, "manifest.json"), "graphify-out/manifest.json key", references);
  collectJsonObjectKeyReferences(
    join(out, "cache", "stat-index.json"),
    "graphify-out/cache/stat-index.json key",
    references,
  );

  const graph = readJsonFile(join(out, "graph.json"));
  for (const sourceFile of collectSourceFilesFromValue(graph)) {
    recordReference(references, sourceFile, "graphify-out/graph.json source_file");
  }

  for (const file of collectFilesUnder(join(out, "cache"))) {
    if (file.endsWith(`${join("cache", "stat-index.json")}`)) continue;
    const data = readJsonFile(file);
    const sourceFiles = collectSourceFilesFromValue(data);
    const ref = `${relative(root, file).replace(/\\/g, "/")} source_file`;
    for (const sourceFile of sourceFiles) {
      recordReference(references, sourceFile, ref);
    }
  }

  return references;
}

export function findGraphifyScopeViolations(root = process.cwd(), scope = readGraphifyScopeConfig(root)) {
  const violations = [];
  for (const [sourcePath, refs] of collectGraphifySourceReferences(root)) {
    const reason = graphifyScopeViolationReason(sourcePath, scope);
    if (reason) {
      violations.push({
        sourcePath,
        reason,
        refs: [...refs].sort(),
      });
    }
  }
  return violations.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function pruneJsonObjectKeys(file, scope) {
  const data = readJsonFile(file);
  if (!data || Array.isArray(data) || typeof data !== "object") return 0;

  let removed = 0;
  for (const key of Object.keys(data)) {
    if (graphifyScopeViolationReason(key, scope)) {
      delete data[key];
      removed += 1;
    }
  }

  if (removed > 0) {
    writeFileSync(file, stringifyGraphifyJson(data));
  }
  return removed;
}

function skipWhitespace(text, index) {
  let next = index;
  while (/\s/.test(text[next] ?? "")) next += 1;
  return next;
}

function parseJsonStringAt(text, start) {
  let index = start + 1;
  let escaped = false;
  while (index < text.length) {
    const char = text[index];
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === '"') {
      const raw = text.slice(start, index + 1);
      return { value: JSON.parse(raw), end: index + 1 };
    }
    index += 1;
  }
  throw new Error("Unterminated JSON object key.");
}

function findJsonValueEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      if (depth === 0) return index;
      depth -= 1;
    } else if (char === "," && depth === 0) {
      return index;
    }
  }

  return text.length;
}

function findJsonBlockEnd(text, start, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  throw new Error(`Unterminated JSON block starting at ${start}.`);
}

function findTopLevelArrayRange(text, key) {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex < 0) return null;
  const arrayStart = text.indexOf("[", keyIndex);
  if (arrayStart < 0) return null;
  const arrayEnd = findJsonBlockEnd(text, arrayStart, "[", "]");
  return { arrayStart, arrayEnd };
}

function splitTopLevelArrayObjects(content) {
  const entries = [];
  let index = skipWhitespace(content, 0);

  while (index < content.length) {
    while (content[index] === ",") index = skipWhitespace(content, index + 1);
    if (index >= content.length) break;
    if (content[index] !== "{") {
      index += 1;
      continue;
    }

    const entryStart = index;
    const entryEnd = findJsonBlockEnd(content, entryStart, "{", "}");
    entries.push(content.slice(entryStart, entryEnd));
    index = skipWhitespace(content, entryEnd);
  }

  return entries;
}

function pruneGraphArrayObjects(text, key, shouldRemove) {
  const range = findTopLevelArrayRange(text, key);
  if (!range) return { text, removed: 0 };

  const inner = text.slice(range.arrayStart + 1, range.arrayEnd - 1);
  const entries = splitTopLevelArrayObjects(inner);
  if (entries.length === 0) return { text, removed: 0 };

  const kept = [];
  let removed = 0;
  for (const entry of entries) {
    const value = JSON.parse(entry);
    if (shouldRemove(value)) {
      removed += 1;
    } else {
      kept.push(entry);
    }
  }

  if (removed === 0) return { text, removed: 0 };

  const replacement = kept.length > 0 ? `[\n${kept.map((entry) => `    ${entry}`).join(",\n")}\n  ]` : "[]";
  return {
    text: `${text.slice(0, range.arrayStart)}${replacement}${text.slice(range.arrayEnd)}`,
    removed,
  };
}

function pruneCompactJsonObjectKeys(file, scope) {
  if (!existsSync(file)) return 0;
  const original = readFileSync(file, "utf8");
  const trailingNewline = /\r?\n$/.test(original);
  const text = original.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return 0;

  const entries = [];
  let removed = 0;
  let index = skipWhitespace(text, 1);

  while (index < text.length - 1) {
    while (text[index] === ",") index = skipWhitespace(text, index + 1);
    if (text[index] === "}") break;

    const entryStart = index;
    const key = parseJsonStringAt(text, index);
    index = skipWhitespace(text, key.end);
    if (text[index] !== ":") throw new Error(`Invalid JSON object in ${file}.`);
    index = skipWhitespace(text, index + 1);

    const valueEnd = findJsonValueEnd(text, index);
    const entry = text.slice(entryStart, valueEnd);
    if (graphifyScopeViolationReason(key.value, scope)) {
      removed += 1;
    } else {
      entries.push(entry);
    }
    index = skipWhitespace(text, valueEnd);
  }

  if (removed > 0) {
    writeFileSync(file, `{${entries.join(",")}}${trailingNewline ? "\n" : ""}`);
  }

  return removed;
}

function pruneGraphJson(file, scope) {
  if (!existsSync(file)) {
    return { graphNodes: 0, graphLinks: 0, graphHyperedges: 0 };
  }

  let text = readFileSync(file, "utf8");
  const graph = JSON.parse(text);
  if (!graph || typeof graph !== "object") {
    return { graphNodes: 0, graphLinks: 0, graphHyperedges: 0 };
  }

  const removedNodeIds = new Set();
  const nodeResult = pruneGraphArrayObjects(text, "nodes", (node) => {
    const reason = node?.source_file ? graphifyScopeViolationReason(node.source_file, scope) : null;
    if (!reason) return false;
    if (node?.id) removedNodeIds.add(node.id);
    return true;
  });
  text = nodeResult.text;

  const liveNodeIds = new Set(
    Array.isArray(graph.nodes)
      ? graph.nodes.filter((node) => !removedNodeIds.has(node.id)).map((node) => node.id)
      : [],
  );

  const linkResult = pruneGraphArrayObjects(text, "links", (link) => {
    const reason = link?.source_file ? graphifyScopeViolationReason(link.source_file, scope) : null;
    const dangling =
      (link?.source && !liveNodeIds.has(link.source)) || (link?.target && !liveNodeIds.has(link.target));
    return Boolean(reason || dangling);
  });
  text = linkResult.text;

  const hyperedgeResult = pruneGraphArrayObjects(text, "hyperedges", (hyperedge) => {
    const reason = hyperedge?.source_file
      ? graphifyScopeViolationReason(hyperedge.source_file, scope)
      : null;
    return Boolean(reason);
  });
  text = hyperedgeResult.text;

  if (nodeResult.removed || linkResult.removed || hyperedgeResult.removed) {
    writeFileSync(file, text);
  }

  return {
    graphNodes: nodeResult.removed,
    graphLinks: linkResult.removed,
    graphHyperedges: hyperedgeResult.removed,
  };
}

export function pruneGraphifyOutOfScopeEntries(root = process.cwd(), scope = readGraphifyScopeConfig(root)) {
  const out = join(root, "graphify-out");
  const summary = {
    manifestEntries: pruneJsonObjectKeys(join(out, "manifest.json"), scope),
    statIndexEntries: pruneCompactJsonObjectKeys(join(out, "cache", "stat-index.json"), scope),
    cacheFiles: 0,
    graphNodes: 0,
    graphLinks: 0,
    graphHyperedges: 0,
  };

  for (const file of collectFilesUnder(join(out, "cache"))) {
    if (file.endsWith(`${join("cache", "stat-index.json")}`)) continue;
    const data = readJsonFile(file);
    const sourceFiles = collectSourceFilesFromValue(data);
    if ([...sourceFiles].some((sourceFile) => graphifyScopeViolationReason(sourceFile, scope))) {
      rmSync(file, { force: true });
      summary.cacheFiles += 1;
    }
  }

  Object.assign(summary, pruneGraphJson(join(out, "graph.json"), scope));
  return summary;
}
