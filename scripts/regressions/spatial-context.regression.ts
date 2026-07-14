import assert from "node:assert/strict";
import type {
  GameMap,
  SpatialContextDefinition,
  SpatialDefinitionIssueCode,
  SpatialLocation,
} from "../../packages/shared/src/index.js";
import {
  resolveSpatialBreadcrumb,
  resolveSpatialDestinations,
  spatialContextDefinitionSchema,
  spatialContextSnapshotSchema,
  validateSpatialArchive,
  validateSpatialContextDefinition,
  validateSpatialTransition,
} from "../../packages/shared/src/index.js";
import {
  buildSpatialMapDraftPrompt,
  buildSpatialMapExpansionPrompt,
  normalizeSpatialMapExpansionPlan,
  normalizeSpatialMapPlan,
} from "../../packages/server/src/services/spatial-context/ai-draft.js";
import {
  buildOwnerSpatialProjection,
  formatOwnerSpatialBreadcrumb,
  formatOwnerSpatialPrompt,
  injectOwnerSpatialPrompt,
  omitAuthoritativeGameLocation,
  projectGameSnapshotLocation,
} from "../../packages/server/src/services/spatial-context/projection.js";
import {
  selectBoundGameMapForLocation,
  updateGameMapBinding,
} from "../../packages/server/src/services/spatial-context/game-map-binding.js";

function location(
  id: string,
  name: string,
  overrides: Partial<Omit<SpatialLocation, "id" | "name">> = {},
): SpatialLocation {
  return {
    id,
    name,
    parentId: null,
    kind: "place",
    description: `Description for ${name}.`,
    lorebookEntryIds: [],
    childPresentation: "list",
    links: [],
    status: "active",
    sortOrder: 0,
    ...overrides,
  };
}

function definition(
  locations: SpatialLocation[],
  overrides: Partial<Omit<SpatialContextDefinition, "locations">> = {},
): SpatialContextDefinition {
  return {
    schemaVersion: 1,
    ownerMode: "roleplay",
    enabled: true,
    locations,
    startingLocationId: locations[0]?.id ?? null,
    revision: 4,
    ...overrides,
  };
}

function issueCodes(value: SpatialContextDefinition): SpatialDefinitionIssueCode[] {
  return validateSpatialContextDefinition(value).issues.map((entry) => entry.code);
}

const snapshotInput = {
  id: "snapshot-1",
  chatId: "chat-1",
  messageId: "message-1",
  swipeIndex: 0,
  currentLocationId: null,
  definitionRevision: 0,
  source: "bootstrap" as const,
  transitionCommandId: null,
  transitionPayloadHash: null,
  createdAt: new Date(0).toISOString(),
};
assert.equal(spatialContextSnapshotSchema.safeParse(snapshotInput).success, true);
assert.equal(spatialContextSnapshotSchema.safeParse({ ...snapshotInput, messageId: "" }).success, false);

const validDefinition = definition(
  [
    location("world", "Known World", {
      kind: "region",
      childPresentation: "map",
    }),
    location("capital", "Capital City", {
      parentId: "world",
      kind: "settlement",
      childPresentation: "map",
      placement: { x: 52, y: 45 },
    }),
    location("market", "Market", {
      parentId: "capital",
      placement: { x: 22, y: 70 },
      sortOrder: 2,
    }),
    location("tower", "Wizard Tower", {
      parentId: "capital",
      kind: "building",
      childPresentation: "layers",
      lorebookEntryIds: ["lore_parent"],
      placement: { x: 72, y: 30 },
      sortOrder: 1,
    }),
    location("tower_ground", "Ground Floor", {
      parentId: "tower",
      kind: "floor",
      layerOrder: 0,
      sortOrder: 0,
    }),
    location("tower_library", "Library", {
      parentId: "tower",
      kind: "floor",
      layerOrder: 1,
      sortOrder: 1,
      modelMemory: "The restricted shelf conceals a key.",
      lorebookEntryIds: ["lore_library"],
      links: [
        {
          targetId: "tower",
          label: "Stairs down",
          bidirectional: false,
          state: "available",
        },
        {
          targetId: "market",
          label: "Secret passage",
          bidirectional: false,
          state: "hidden",
        },
      ],
    }),
    location("tower_observatory", "Observatory", {
      parentId: "tower",
      kind: "floor",
      layerOrder: 2,
      sortOrder: 2,
      links: [
        {
          targetId: "tower_library",
          label: "Spiral stairs",
          bidirectional: true,
          state: "available",
        },
      ],
    }),
  ],
  { startingLocationId: "tower_library" },
);

assert.deepEqual(validateSpatialContextDefinition(validDefinition), { valid: true, issues: [] });
assert.equal(spatialContextDefinitionSchema.safeParse(validDefinition).success, true);
const legacyDefinitionWithoutLoreRefs = JSON.parse(JSON.stringify(validDefinition)) as Record<string, unknown>;
for (const legacyLocation of legacyDefinitionWithoutLoreRefs.locations as Array<Record<string, unknown>>) {
  delete legacyLocation.lorebookEntryIds;
}
const parsedLegacyDefinition = spatialContextDefinitionSchema.parse(legacyDefinitionWithoutLoreRefs);
assert.ok(parsedLegacyDefinition.locations.every((entry) => entry.lorebookEntryIds.length === 0));

const aiPrompt = buildSpatialMapDraftPrompt({
  ownerMode: "game",
  size: "small",
  sourceContext: '{"setting":"foggy coast"}',
  instructions: "Include a lighthouse and old sewers.",
});
assert.match(aiPrompt.messages[0]!.content, /never more than 12/);
assert.match(aiPrompt.messages[0]!.content, /one relevant emoji grapheme/);
assert.match(aiPrompt.messages[1]!.content, /lighthouse and old sewers/);
assert.equal(aiPrompt.maxTokens, 6_000);

const aiDraft = normalizeSpatialMapPlan(
  {
    startingLocationKey: "harbor",
    locations: [
      {
        key: "world",
        parentKey: null,
        name: "The Shrouded Coast",
        kind: "region",
        icon: "world map",
        description: "A stormy coastline of isolated settlements.",
        childPresentation: "map",
      },
      {
        key: "harbor",
        parentKey: "world",
        name: "Gloam Harbor",
        kind: "settlement",
        icon: "busy port",
        description: "A crowded port beneath a permanent bank of fog.",
        modelMemory: "The harbor master hides a smuggling ledger.",
        links: [{ targetKey: "lighthouse", label: "Cliff road", bidirectional: true }],
      },
      {
        key: "lighthouse",
        parentKey: "world",
        name: "Blackglass Lighthouse",
        kind: "building",
        icon: "beacon 🔦 at night",
        description: "A black stone lighthouse above the cliffs.",
        links: [{ targetKey: "missing", label: "Impossible road" }],
      },
      {
        key: "tower",
        parentKey: "world",
        name: "Saltwatch Tower",
        kind: "building",
        description: "A watchtower overlooking the harbor.",
      },
      {
        key: "tower-ground",
        parentKey: "tower",
        name: "Ground Floor",
        kind: "floor",
        description: "The tower entrance.",
      },
      {
        key: "tower-top",
        parentKey: "tower",
        name: "Top Floor",
        kind: "floor",
        description: "The signal room.",
      },
      {
        key: "cycle-a",
        parentKey: "cycle-b",
        name: "Cycle A",
        description: "",
      },
      {
        key: "cycle-b",
        parentKey: "cycle-a",
        name: "Cycle B",
        description: "",
      },
    ],
  },
  { ownerMode: "game", revision: 7, enabled: false, size: "small" },
);
assert.equal(aiDraft.ownerMode, "game");
assert.equal(aiDraft.revision, 7);
assert.equal(aiDraft.enabled, false);
assert.equal(spatialContextDefinitionSchema.safeParse(aiDraft).success, true);
assert.equal(aiDraft.locations.find((entry) => entry.id === aiDraft.startingLocationId)?.name, "Gloam Harbor");
assert.ok(aiDraft.locations.every((entry) => /^loc_[A-Za-z0-9_-]+$/u.test(entry.id)));
const aiWorld = aiDraft.locations.find((entry) => entry.name === "The Shrouded Coast")!;
const aiHarbor = aiDraft.locations.find((entry) => entry.name === "Gloam Harbor")!;
const aiLighthouse = aiDraft.locations.find((entry) => entry.name === "Blackglass Lighthouse")!;
const aiTower = aiDraft.locations.find((entry) => entry.name === "Saltwatch Tower")!;
const aiFloors = aiDraft.locations.filter((entry) => entry.parentId === aiTower.id);
assert.equal(aiWorld.childPresentation, "map");
assert.equal(aiWorld.icon, "🌊");
assert.equal(aiHarbor.icon, "⚓");
assert.equal(aiLighthouse.icon, "🔦");
assert.ok(aiHarbor.placement);
assert.ok(aiLighthouse.placement);
assert.equal(aiHarbor.links[0]?.targetId, aiLighthouse.id);
assert.equal(aiLighthouse.links.length, 0);
assert.equal(aiTower.childPresentation, "layers");
assert.deepEqual(
  aiFloors.map((entry) => entry.layerOrder),
  [0, 1],
);
assert.equal(aiDraft.locations.find((entry) => entry.name === "Cycle A")?.parentId, null);
assert.equal(aiDraft.locations.find((entry) => entry.name === "Cycle B")?.parentId, null);

const loreSourceMap = new Map([["source_1", "entry_lighthouse"]]);
const strictLorePrompt = buildSpatialMapDraftPrompt({
  ownerMode: "game",
  size: "small",
  sourceContext: '{"setting":"foggy coast"}',
  groundingMode: "lore_strict",
  loreCatalog: "source_1 | Coast Canon | Blackglass Lighthouse | A black lighthouse guards the harbor.",
});
assert.match(strictLorePrompt.messages[0]!.content, /Strict canon mode/);
assert.match(strictLorePrompt.messages[1]!.content, /source_1 \| Coast Canon \| Blackglass Lighthouse/);

const groundedDraft = normalizeSpatialMapPlan(
  {
    startingLocationKey: "lighthouse",
    locations: [
      {
        key: "lighthouse",
        name: "Blackglass Lighthouse",
        description: "A black lighthouse guards the harbor.",
        sourceKeys: ["source_1", "source_missing", "source_1"],
      },
    ],
  },
  {
    ownerMode: "game",
    revision: 0,
    enabled: false,
    size: "small",
    sourceEntryIdsByKey: loreSourceMap,
    requireLoreSource: true,
  },
);
assert.deepEqual(groundedDraft.locations[0]?.lorebookEntryIds, ["entry_lighthouse"]);
assert.throws(
  () =>
    normalizeSpatialMapPlan(
      { locations: [{ key: "invented", name: "Invented Plaza", sourceKeys: ["source_missing"] }] },
      {
        ownerMode: "game",
        revision: 0,
        enabled: false,
        size: "small",
        sourceEntryIdsByKey: loreSourceMap,
        requireLoreSource: true,
      },
    ),
  /did not cite a valid lore source/,
);

const groundedExpansion = normalizeSpatialMapExpansionPlan(
  {
    locations: [
      {
        key: "canon-annex",
        name: "Canon Annex",
        description: "A source-backed annex.",
        sourceKeys: ["source_1"],
      },
    ],
  },
  {
    definition: validDefinition,
    targetLocationId: "capital",
    size: "small",
    sourceEntryIdsByKey: loreSourceMap,
    requireLoreSource: true,
  },
);
assert.deepEqual(groundedExpansion.locations.slice(0, validDefinition.locations.length), validDefinition.locations);
assert.deepEqual(groundedExpansion.locations.at(-1)?.lorebookEntryIds, ["entry_lighthouse"]);

const cappedAiDraft = normalizeSpatialMapPlan(
  {
    locations: Array.from({ length: 20 }, (_, index) => ({
      key: `place-${index}`,
      parentKey: null,
      name: `Place ${index}`,
      description: "",
    })),
  },
  { ownerMode: "roleplay", revision: 0, enabled: false, size: "small" },
);
assert.equal(cappedAiDraft.locations.length, 12);
assert.throws(
  () =>
    normalizeSpatialMapPlan({ locations: [] }, { ownerMode: "roleplay", revision: 0, enabled: false, size: "small" }),
  /did not return any locations/,
);

const expansionPrompt = buildSpatialMapExpansionPrompt({
  definition: validDefinition,
  targetLocationId: "capital",
  size: "small",
  sourceContext: '{"setting":"foggy coast"}',
  instructions: "Add a riverside district with an inn.",
});
assert.match(expansionPrompt.messages[0]!.content, /Return only new locations/);
assert.match(expansionPrompt.messages[0]!.content, /one relevant emoji grapheme/);
assert.match(expansionPrompt.messages[1]!.content, /Capital City/);
assert.match(expansionPrompt.messages[1]!.content, /riverside district/);

const expandedDefinition = normalizeSpatialMapExpansionPlan(
  {
    locations: [
      {
        key: "riverside",
        parentKey: null,
        name: "Riverside District",
        kind: "place",
        description: "A working district along the capital river.",
        childPresentation: "map",
      },
      {
        key: "silver-inn",
        parentKey: "riverside",
        name: "Silver Minnow Inn",
        kind: "building",
        icon: "beer mug",
        description: "A crowded inn for river traders.",
      },
      {
        key: "cellar",
        parentKey: "silver-inn",
        name: "Flooded Cellar",
        kind: "room",
        description: "A cellar connected to old drainage tunnels.",
      },
    ],
  },
  { definition: validDefinition, targetLocationId: "capital", size: "small" },
);
assert.equal(spatialContextDefinitionSchema.safeParse(expandedDefinition).success, true);
assert.equal(expandedDefinition.startingLocationId, validDefinition.startingLocationId);
assert.equal(expandedDefinition.revision, validDefinition.revision);
assert.deepEqual(expandedDefinition.locations.slice(0, validDefinition.locations.length), validDefinition.locations);
const riverside = expandedDefinition.locations.find((entry) => entry.name === "Riverside District")!;
const silverInn = expandedDefinition.locations.find((entry) => entry.name === "Silver Minnow Inn")!;
assert.equal(riverside.parentId, "capital");
assert.ok(riverside.placement);
assert.equal(silverInn.parentId, riverside.id);
assert.equal(silverInn.icon, "🍺");
assert.ok(
  expandedDefinition.locations
    .slice(validDefinition.locations.length)
    .every((entry) => entry.icon && !/[A-Za-z]/u.test(entry.icon)),
);
assert.ok(expandedDefinition.locations.slice(validDefinition.locations.length).every((entry) => entry.id.startsWith("loc_")));
assert.throws(
  () =>
    normalizeSpatialMapExpansionPlan(
      { locations: [{ key: "x", name: "X" }] },
      { definition: validDefinition, targetLocationId: "missing", size: "small" },
    ),
  /active location/,
);

assert.deepEqual(
  resolveSpatialBreadcrumb(validDefinition, "tower_library").map((entry) => entry.id),
  ["world", "capital", "tower", "tower_library"],
);
assert.deepEqual(resolveSpatialBreadcrumb(validDefinition, "missing"), []);

const libraryDestinations = resolveSpatialDestinations(validDefinition, "tower_library");
assert.deepEqual(
  libraryDestinations.map((entry) => ({ id: entry.id, relation: entry.relation })),
  [
    { id: "tower", relation: "leave" },
    { id: "tower_observatory", relation: "link" },
  ],
);
assert.equal(
  libraryDestinations.some((entry) => entry.id === "market"),
  false,
);

assert.deepEqual(
  resolveSpatialDestinations(validDefinition, "tower").map((entry) => ({
    id: entry.id,
    relation: entry.relation,
  })),
  [
    { id: "capital", relation: "leave" },
    { id: "tower_ground", relation: "enter" },
    { id: "tower_library", relation: "enter" },
    { id: "tower_observatory", relation: "enter" },
  ],
);

const acceptedTransition = validateSpatialTransition(validDefinition, "tower_library", {
  destinationId: "tower_observatory",
  expectedDefinitionRevision: 4,
  expectedCurrentLocationId: "tower_library",
  commandId: "move-1",
});
assert.equal(acceptedTransition.ok, true);
if (acceptedTransition.ok) {
  assert.equal(acceptedTransition.destination.relation, "link");
}

assert.deepEqual(
  validateSpatialTransition(validDefinition, "tower_library", {
    destinationId: "tower_observatory",
    expectedDefinitionRevision: 3,
    expectedCurrentLocationId: "tower_library",
    commandId: "move-2",
  }),
  {
    ok: false,
    code: "spatial_transition_stale_definition",
    message: "The hierarchical map changed. Review the available destinations.",
  },
);
assert.equal(
  validateSpatialTransition(validDefinition, "tower_library", {
    destinationId: "tower_observatory",
    expectedDefinitionRevision: 4,
    expectedCurrentLocationId: "tower_ground",
    commandId: "move-3",
  }).ok,
  false,
);
assert.deepEqual(
  validateSpatialTransition(validDefinition, "tower_library", {
    destinationId: "market",
    expectedDefinitionRevision: 4,
    expectedCurrentLocationId: "tower_library",
    commandId: "move-4",
  }),
  {
    ok: false,
    code: "spatial_destination_unreachable",
    message: "The selected destination is not reachable from the current location.",
  },
);

assert.equal(
  validateSpatialArchive(validDefinition, "tower_library", {
    currentLocationId: "tower_library",
  }).ok,
  false,
);
assert.deepEqual(
  validateSpatialArchive(validDefinition, "tower_library", {
    currentLocationId: "tower_library",
    replacementLocationId: "tower_ground",
  }),
  { ok: true },
);
assert.equal(
  validateSpatialArchive(validDefinition, "tower", {
    currentLocationId: "tower_library",
  }).ok,
  false,
);

const duplicateIds = definition([location("same", "First"), location("same", "Second")]);
assert.ok(issueCodes(duplicateIds).includes("duplicate_location_id"));
assert.equal(spatialContextDefinitionSchema.safeParse(duplicateIds).success, false);

const duplicateLoreRefs = definition([
  location("duplicate_lore", "Duplicate Lore", {
    lorebookEntryIds: ["entry_same", "entry_same"],
  }),
]);
assert.ok(issueCodes(duplicateLoreRefs).includes("duplicate_lorebook_entry_id"));
assert.equal(spatialContextDefinitionSchema.safeParse(duplicateLoreRefs).success, false);

const missingParent = definition([location("orphan", "Orphan", { parentId: "missing" })]);
assert.ok(issueCodes(missingParent).includes("parent_missing"));

const parentCycle = definition(
  [location("cycle_a", "Cycle A", { parentId: "cycle_b" }), location("cycle_b", "Cycle B", { parentId: "cycle_a" })],
  { startingLocationId: "cycle_a" },
);
assert.ok(issueCodes(parentCycle).includes("parent_cycle"));

const deepLocations = Array.from({ length: 21 }, (_, index) =>
  location(`depth_${index}`, `Depth ${index}`, {
    parentId: index === 0 ? null : `depth_${index - 1}`,
  }),
);
assert.ok(issueCodes(definition(deepLocations)).includes("maximum_depth_exceeded"));

const invalidLayers = definition(
  [
    location("layer_parent", "Layer Parent", { childPresentation: "layers" }),
    location("layer_one", "Layer One", { parentId: "layer_parent", layerOrder: 1 }),
    location("layer_two", "Layer Two", { parentId: "layer_parent", layerOrder: 1 }),
    location("layer_missing", "Layer Missing", { parentId: "layer_parent" }),
  ],
  { startingLocationId: "layer_one" },
);
assert.ok(issueCodes(invalidLayers).includes("duplicate_layer_order"));
assert.ok(issueCodes(invalidLayers).includes("layer_order_missing"));

const missingLink = definition([
  location("link_source", "Link Source", {
    links: [
      {
        targetId: "missing_target",
        bidirectional: false,
        state: "available",
      },
    ],
  }),
]);
assert.ok(issueCodes(missingLink).includes("link_target_missing"));

const manyLinkTargets = Array.from({ length: 51 }, (_, index) =>
  location(`link_target_${index}`, `Link Target ${index}`),
);
const tooManyLinks = definition([
  location("many_links", "Many Links", {
    links: manyLinkTargets.map((target) => ({
      targetId: target.id,
      bidirectional: false,
      state: "available",
    })),
  }),
  ...manyLinkTargets,
]);
assert.ok(issueCodes(tooManyLinks).includes("too_many_links"));
assert.equal(spatialContextDefinitionSchema.safeParse(tooManyLinks).success, false);

assert.equal(
  spatialContextDefinitionSchema.safeParse({
    ...validDefinition,
    ownerMode: "conversation",
  }).success,
  false,
);
assert.equal(
  spatialContextDefinitionSchema.safeParse({
    ...validDefinition,
    locations: validDefinition.locations.map((entry) =>
      entry.id === "capital" ? { ...entry, placement: { x: 101, y: 50 } } : entry,
    ),
  }).success,
  false,
);
assert.equal(
  spatialContextDefinitionSchema.safeParse({
    ...validDefinition,
    locations: Array.from({ length: 501 }, (_, index) => location(`wide_${index}`, `Wide ${index}`)),
  }).success,
  false,
);

const boundMap: GameMap = {
  id: "tower-map",
  type: "node",
  name: "Wizard Tower",
  description: "A local tower map.",
  spatialLocationId: "tower",
  nodes: [
    {
      id: "library-node",
      emoji: "📚",
      label: "Library",
      x: 50,
      y: 50,
      discovered: true,
      spatialLocationId: "tower_library",
    },
  ],
  edges: [],
  partyPosition: "library-node",
};
assert.equal(boundMap.spatialLocationId, "tower");
assert.equal(boundMap.nodes?.[0]?.spatialLocationId, "tower_library");

const worldMap: GameMap = {
  id: "world-map",
  type: "grid",
  name: "Known World",
  description: "The regional map.",
  spatialLocationId: "world",
  width: 1,
  height: 1,
  cells: [
    {
      x: 0,
      y: 0,
      emoji: "🏙️",
      label: "Capital City",
      discovered: true,
      terrain: "city",
    },
  ],
  partyPosition: { x: 0, y: 0 },
};
const gameMetadata = {
  gameMaps: [worldMap, boundMap],
  gameMap: worldMap,
  activeGameMapId: "world-map",
};

const cellBoundMetadata = updateGameMapBinding(gameMetadata, {
  target: "cell",
  mapId: "world-map",
  x: 0,
  y: 0,
  spatialLocationId: "capital",
});
assert.equal((cellBoundMetadata.gameMaps as GameMap[])[0]?.cells?.[0]?.spatialLocationId, "capital");
assert.equal(cellBoundMetadata.activeGameMapId, "world-map");
assert.equal((cellBoundMetadata.gameMap as GameMap).id, "world-map");

const nodeClearedMetadata = updateGameMapBinding(gameMetadata, {
  target: "node",
  mapId: "tower-map",
  nodeId: "library-node",
  spatialLocationId: null,
});
assert.equal((nodeClearedMetadata.gameMaps as GameMap[])[1]?.nodes?.[0]?.spatialLocationId, undefined);
assert.equal(nodeClearedMetadata.activeGameMapId, "world-map");

const mapReboundMetadata = updateGameMapBinding(gameMetadata, {
  target: "map",
  mapId: "tower-map",
  spatialLocationId: "tower_library",
});
assert.equal((mapReboundMetadata.gameMaps as GameMap[])[1]?.spatialLocationId, "tower_library");
assert.equal(mapReboundMetadata.activeGameMapId, "world-map");

const ancestorSelectedMetadata = selectBoundGameMapForLocation(gameMetadata, validDefinition, "tower_library");
assert.equal(ancestorSelectedMetadata.activeGameMapId, "tower-map");
assert.equal((ancestorSelectedMetadata.gameMap as GameMap).id, "tower-map");

const exactSelectedMetadata = selectBoundGameMapForLocation(
  {
    ...gameMetadata,
    gameMaps: [worldMap, boundMap, { ...worldMap, id: "library-map", spatialLocationId: "tower_library" }],
  },
  validDefinition,
  "tower_library",
);
assert.equal(exactSelectedMetadata.activeGameMapId, "library-map");

const unboundDefinition = definition([location("unbound-region", "Unbound Region", { kind: "region" })]);
const unboundSelectionMetadata = selectBoundGameMapForLocation(gameMetadata, unboundDefinition, "unbound-region");
assert.equal(unboundSelectionMetadata, gameMetadata);

const ownerProjection = buildOwnerSpatialProjection("chat-roleplay", validDefinition, "tower_library");
assert.ok(ownerProjection);
assert.equal(ownerProjection.chatId, "chat-roleplay");
assert.equal(ownerProjection.currentLocationId, "tower_library");
assert.equal(ownerProjection.modelMemory, "The restricted shelf conceals a key.");
assert.deepEqual(ownerProjection.lorebookEntryIds, ["lore_library"]);
assert.deepEqual(
  ownerProjection.destinations.map(({ id }) => id),
  ["tower", "tower_observatory"],
);

const ownerBlock = formatOwnerSpatialPrompt(ownerProjection);
assert.match(ownerBlock, /Current path: Known World > Capital City > Wizard Tower > Library/);
assert.match(ownerBlock, /Private model context:\nThe restricted shelf conceals a key\./);
assert.match(ownerBlock, /Observatory \[tower_observatory\] — Spiral stairs/);
assert.doesNotMatch(ownerBlock, /Description for Market|Secret passage|placement|layerOrder|awarenessSummary/);

const injectedOnce = injectOwnerSpatialPrompt(
  [
    { role: "system" as const, content: "Base instructions" },
    { role: "user" as const, content: "Hello" },
  ],
  ownerProjection,
);
const injectedTwice = injectOwnerSpatialPrompt(injectedOnce, ownerProjection);
assert.equal(injectedTwice.filter((message) => message.content.includes("<spatial_context")).length, 1);
assert.equal(injectedTwice.find((message) => message.content.includes("<spatial_context"))?.content, ownerBlock);

const wideProjection = buildOwnerSpatialProjection(
  "chat-wide",
  definition([
    location("hub", "Hub", {
      description: "H".repeat(4_100),
      modelMemory: "M".repeat(8_100),
    }),
    ...Array.from({ length: 60 }, (_, index) =>
      location(`destination_${String(index).padStart(2, "0")}`, `Destination ${String(index).padStart(2, "0")}`, {
        parentId: "hub",
        sortOrder: index,
      }),
    ),
    location("archived_secret", "Archived Secret", {
      parentId: "hub",
      description: "Never expose this archived description.",
      modelMemory: "Never expose this archived memory.",
      status: "archived",
      sortOrder: 100,
    }),
  ]),
  "hub",
);
assert.ok(wideProjection);
assert.equal(wideProjection.description.length, 4_000);
assert.equal(wideProjection.modelMemory?.length, 8_000);
assert.equal(wideProjection.destinations.length, 50);
assert.equal(wideProjection.omittedDestinationCount, 10);
const wideBlock = formatOwnerSpatialPrompt(wideProjection);
assert.match(wideBlock, /10 additional destinations omitted/);
assert.doesNotMatch(wideBlock, /Destination 50|Archived Secret|Never expose/);

const escapedProjection = buildOwnerSpatialProjection(
  "chat-escaped",
  definition([
    location("escaped", "Room <One>", {
      description: "Use <care> & caution.",
      modelMemory: "Do not close </spatial_context> early.",
    }),
  ]),
  "escaped",
);
assert.ok(escapedProjection);
const escapedBlock = formatOwnerSpatialPrompt(escapedProjection);
assert.match(escapedBlock, /Room &lt;One>|Use &lt;care> &amp; caution/);
assert.doesNotMatch(escapedBlock, /Do not close <\/spatial_context> early/);

const gameProjection = buildOwnerSpatialProjection(
  "chat-game",
  { ...validDefinition, ownerMode: "game" },
  "tower_library",
);
assert.ok(gameProjection);
assert.equal(formatOwnerSpatialBreadcrumb(gameProjection), "Known World > Capital City > Wizard Tower > Library");
assert.deepEqual(projectGameSnapshotLocation({ location: "Model guess", weather: "Rain" }, gameProjection), {
  location: "Known World > Capital City > Wizard Tower > Library",
  weather: "Rain",
});
assert.deepEqual(omitAuthoritativeGameLocation({ location: "Model guess", time: "Noon" }, gameProjection), {
  time: "Noon",
});
assert.deepEqual(omitAuthoritativeGameLocation({ location: "Legacy", time: "Noon" }, null), {
  location: "Legacy",
  time: "Noon",
});

process.stdout.write("Spatial context regression passed.\n");
