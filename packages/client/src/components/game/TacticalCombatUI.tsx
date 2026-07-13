// ──────────────────────────────────────────────
// Game: Tactical (grid) Combat UI
//
// A Fire Emblem / Final Fantasy Tactics style grid battle that runs entirely
// off the shared pure engine (`packages/shared/src/features/tactical-combat`).
// The client renders + animates; the SERVER resolves actions (start + action
// endpoints) so the seeded RNG stays authoritative. Client-side we only use the
// engine's PURE read helpers (movement/target/forecast/summary) for highlights
// and previews — never to mutate battle state.
//
// Visual language mirrors GameCombatUI where practical: HP/MP bars, floating
// damage numbers, crit flashes, sprite/emoji/initial tokens, SFX hooks, and the
// same `onCombatEnd(outcome, CombatSummary)` contract that drives GM narration.
//
// The root is TRANSLUCENT over GameSurface's crossfaded scene background (like
// classic GameCombatUI): a dark scrim + radial vignette let the scene art show
// through while the grid stays readable. Terrain palettes are themed by the
// authoritative `state.environment` so restored snapshots keep their look.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sword,
  Sparkles,
  Shield,
  Backpack,
  Hourglass,
  Wind,
  Footprints,
  ScrollText,
  Crown,
  Skull,
  X,
  Trophy,
  SkullIcon,
  Flag,
  Eye,
  EyeOff,
  Heart,
  Droplets,
  Crosshair,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { audioManager } from "../../lib/game-audio";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useTacticalCombatStart, useTacticalCombatAction } from "../../hooks/use-game";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import {
  TERRAIN_DATA,
  CLASS_PROFILES,
  getMovementRange,
  getTargetsInRange,
  forecastAttack,
  buildTacticalSummary,
  type Combatant,
  type CombatSummary,
  type CombatSkill,
  type TacticalCombatState,
  type TacticalUnit,
  type TacticalAction,
  type TacticalEvent,
  type TacticalCoord,
  type TacticalTerrain,
  type TacticalClass,
} from "@marinara-engine/shared";

// ── Props ──

interface TacticalCombatUIProps {
  chatId: string;
  /** Player party combatants (same array classic GameCombatUI receives). */
  party: Combatant[];
  /** Enemy combatants. */
  enemies: Combatant[];
  /** Difficulty label from the game setup (engine normalizes unknowns to "normal"). */
  difficulty?: string;
  /**
   * Scene-derived battlefield environment (e.g. "forest", "snow", "spaceship").
   * Drives the initial terrain theming; the authoritative palette source once
   * the battle starts is `state.environment` (so restored snapshots keep theme).
   */
  environment?: string | null;
  /** Scene-derived starting formation (e.g. "ambush", "surrounded"). Passed to the start endpoint. */
  formation?: string | null;
  /** Restore an in-progress battle after a refresh (from chat metadata snapshot). */
  initialState?: TacticalCombatState | null;
  /** The party combatant that is the player's own persona (gets the crown marker). */
  playerCombatantId?: string | null;
  /** Called when combat ends. Same contract as classic GameCombatUI → drives GM narration. */
  onCombatEnd: (outcome: "victory" | "defeat" | "flee", summary: CombatSummary) => void;
  /** Lets the GM adjudicate a freeform maneuver (parity with classic, currently unused UI-side). */
  onCustomInstruction?: (instruction: string) => void;
}

// ── SFX (reuse classic combat sound tags) ──

const SFX = {
  start: "sfx:combat:sword-unsheathe",
  select: "sfx:ui:menu-confirm",
  hover: "sfx:ui:menu-hover",
  attack: "sfx:combat:sword-swing",
  crit: "sfx:combat:sword-swing-2",
  miss: "sfx:combat:sword-swing-3",
  hit: "sfx:combat:spell-hit",
  magic: "sfx:combat:magic-cast",
  defend: "sfx:combat:chainmail",
  item: "sfx:ui:potion",
  victory: "sfx:ui:coin-pickup",
  defeat: "sfx:ui:menu-cancel",
} as const;

// ── Environment terrain palettes ──
//
// Keyed by plain string so the file compiles regardless of whether the shared
// `TacticalEnvironment` union has landed yet. Every entry is a full terrain map;
// unknown environments fall back to "default" (the original colours). The
// resolved palette comes from the AUTHORITATIVE `state.environment` first, then
// the `environment` prop, then "default".

const TERRAIN_PALETTES: Record<string, Record<TacticalTerrain, string>> = {
  default: {
    plains: "#40714a",
    forest: "#274a30",
    mountain: "#5c5142",
    ruin: "#4a4f5c",
    water: "#1f4f78",
    wall: "#23232b",
  },
  forest: {
    plains: "#3a6b3f",
    forest: "#1f3f26",
    mountain: "#4f4a3a",
    ruin: "#454b45",
    water: "#215a6b",
    wall: "#26241c",
  },
  plains: {
    plains: "#4e8a4f",
    forest: "#2f5c34",
    mountain: "#6a5c44",
    ruin: "#565b5f",
    water: "#2a6187",
    wall: "#2a2a2a",
  },
  mountains: {
    plains: "#5a6650",
    forest: "#37472f",
    mountain: "#6b5f4c",
    ruin: "#575a5f",
    water: "#2b5570",
    wall: "#312e28",
  },
  snow: {
    plains: "#cdd8e3",
    forest: "#8fa8a0",
    mountain: "#aeb9c6",
    ruin: "#9aa4b2",
    water: "#7fb8d6",
    wall: "#7d8794",
  },
  desert: {
    plains: "#c9a55f",
    forest: "#8a7a3e",
    mountain: "#a8894f",
    ruin: "#b09a6a",
    water: "#3f8fa0",
    wall: "#6e5a38",
  },
  wasteland: {
    plains: "#8a7a53",
    forest: "#6a6136",
    mountain: "#7d6b4a",
    ruin: "#7a6f5c",
    water: "#4a6b63",
    wall: "#4d4436",
  },
  volcanic: {
    plains: "#5a3a34",
    forest: "#4a3128",
    mountain: "#6e3d2c",
    ruin: "#5c453e",
    water: "#b1441f",
    wall: "#2a1c18",
  },
  water: {
    plains: "#3d7a6a",
    forest: "#245c4c",
    mountain: "#4a6157",
    ruin: "#456058",
    water: "#1c6f8f",
    wall: "#213a3c",
  },
  swamp: {
    plains: "#4a5f3a",
    forest: "#2f4529",
    mountain: "#4e5240",
    ruin: "#495046",
    water: "#3a5f4a",
    wall: "#25302a",
  },
  cave: {
    plains: "#3e3a44",
    forest: "#33403a",
    mountain: "#4a4148",
    ruin: "#454049",
    water: "#2a4a5c",
    wall: "#1b1920",
  },
  dungeon: {
    plains: "#3d3a42",
    forest: "#34413a",
    mountain: "#4a4550",
    ruin: "#4c4652",
    water: "#274a5c",
    wall: "#1a1820",
  },
  ruins: {
    plains: "#5a5648",
    forest: "#3f4a36",
    mountain: "#5e564a",
    ruin: "#63615a",
    water: "#3a5a68",
    wall: "#332f28",
  },
  city: {
    plains: "#5c5f66",
    forest: "#3f5240",
    mountain: "#5e5a54",
    ruin: "#6a6a72",
    water: "#3a5c7a",
    wall: "#33343c",
  },
  castle: {
    plains: "#5a5850",
    forest: "#3c4a38",
    mountain: "#615a4c",
    ruin: "#66625a",
    water: "#385a72",
    wall: "#302d2a",
  },
  mansion: {
    plains: "#5b504a",
    forest: "#3f4a3a",
    mountain: "#5e544a",
    ruin: "#665c52",
    water: "#3f5a6a",
    wall: "#332b26",
  },
  spaceship: {
    plains: "#3a4550",
    forest: "#31424c",
    mountain: "#465562",
    ruin: "#4a5763",
    water: "#2f6a86",
    wall: "#1e262e",
  },
};

// ── Terrain icons ──
// The painted tile textures carry the base terrain look, so only
// environment-specific flavour overrides render as icons.
const TERRAIN_ICON_OVERRIDES: Record<string, Partial<Record<TacticalTerrain, string>>> = {
  desert: { forest: "🌵", mountain: "🏜️" },
  wasteland: { forest: "🌵" },
  volcanic: { mountain: "🌋", water: "🌋" },
  snow: { forest: "🌲", mountain: "🏔️" },
  swamp: { forest: "🌿", water: "💧" },
  cave: { forest: "", mountain: "🪨" },
  dungeon: { forest: "", mountain: "🪨" },
  spaceship: { forest: "", mountain: "", ruin: "🛰️", water: "⚡" },
  city: { forest: "🌳", ruin: "🏚️" },
  castle: { ruin: "🏰" },
  mansion: { ruin: "🏛️" },
};

function resolveTerrainIcon(env: string | undefined, terrain: TacticalTerrain): string {
  return (env ? TERRAIN_ICON_OVERRIDES[env]?.[terrain] : undefined) ?? "";
}

// Per-tile depth: raised terrain (mountain/wall) reads embossed; the rest recessed.
function tileShadow(terrain: TacticalTerrain): string {
  if (terrain === "mountain" || terrain === "wall") {
    return "inset 0 2px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.45)";
  }
  return "inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -3px 5px rgba(0,0,0,0.35)";
}

// ~0.88 alpha suffix so terrain colours stay readable but the scene shows through.
const TILE_ALPHA = "e0";

// Painted top-down tile textures (packages/client/public/tactical/). The palette
// colour is layered over them as a tint so environment themes still recolour the field.
const TILE_TEXTURES: Record<TacticalTerrain, string> = {
  plains: "/tactical/plains.webp",
  forest: "/tactical/forest.webp",
  mountain: "/tactical/mountain.webp",
  ruin: "/tactical/ruin.webp",
  water: "/tactical/water.webp",
  wall: "/tactical/wall.webp",
};

// Tint strength over the texture: a light wash for the default look, stronger
// when an environment theme needs to recolour the painted art (e.g. snow, volcanic).
const TILE_TINT_ALPHA = "3d";
const TILE_TINT_ALPHA_THEMED = "73";

// ── Animation timing (per event kind) ──

const EVENT_DELAY: Record<string, number> = {
  move: 340,
  phase: 950,
  damage: 640,
  crit: 820,
  counter: 640,
  heal: 640,
  miss: 560,
  skill: 500,
  item: 560,
  status: 480,
  terrain: 400,
  defeat: 620,
  victory: 700,
  "defeat-end": 700,
  flee: 700,
};

// ── Sprite shape detection (mirrors GameCombatUI.resolveSpriteKind) ──

type SpriteKind = { kind: "url"; value: string } | { kind: "emoji"; value: string } | { kind: "none" };

function resolveSprite(sprite: string | null | undefined): SpriteKind {
  if (!sprite) return { kind: "none" };
  const trimmed = sprite.trim();
  if (!trimmed) return { kind: "none" };
  if (/^(https?:|\/|data:|blob:)/i.test(trimmed)) return { kind: "url", value: trimmed };
  if (trimmed.length <= 12 && /\p{Extended_Pictographic}/u.test(trimmed)) return { kind: "emoji", value: trimmed };
  return { kind: "none" };
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic color ring from a unit id, so companions stay visually distinct.
function ringColorFor(id: string, side: "party" | "enemy"): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = side === "party" ? 200 + (hash % 60) : 350 + (hash % 40);
  return `hsl(${hue % 360} 70% 55%)`;
}

// Read the authoritative environment off state without depending on the shared
// type having the field yet (the engine agent adds `environment?: TacticalEnvironment`).
function environmentOf(state: TacticalCombatState | null): string | undefined {
  return (state as { environment?: string } | null)?.environment ?? undefined;
}

// ── Class helpers ──
//
// R3-A adds `TacticalClass`, `CLASS_PROFILES`, and `TacticalUnit.unitClass?`. Old
// snapshots predate `unitClass`, so every read goes through `unitClassOf`, which
// falls back to "fighter" for absent/invalid values.

const CLASS_ICONS: Record<TacticalClass, typeof Sword> = {
  fighter: Sword,
  knight: Shield,
  rogue: Wind,
  archer: Crosshair,
  mage: Sparkles,
  healer: Heart,
};

function unitClassOf(unit: TacticalUnit): TacticalClass {
  const uc = (unit as { unitClass?: string }).unitClass;
  return uc && Object.prototype.hasOwnProperty.call(CLASS_PROFILES, uc) ? (uc as TacticalClass) : "fighter";
}

// "Rng 1" for melee, "Rng 2-3" for spread ranges (min===max collapses to one number).
function rangeText(range: { min: number; max: number }): string {
  return range.min === range.max ? `Rng ${range.min}` : `Rng ${range.min}-${range.max}`;
}

// ── Transient render state (positions + hp during animation) ──

interface RenderUnit {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

function renderMapFromState(state: TacticalCombatState): Map<string, RenderUnit> {
  const m = new Map<string, RenderUnit>();
  for (const u of state.units) m.set(u.id, { id: u.id, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp });
  return m;
}

interface FloatingPopup {
  id: number;
  unitId: string;
  text: string;
  tone: "damage" | "crit" | "heal" | "miss" | "status";
}

interface PhaseBanner {
  text: string;
  tone: "player" | "enemy";
}

// A staged clone: the selected unit teleported to `to` so pure helpers
// (forecast/targets) reflect the post-move position without mutating real state.
function withStagedMove(
  state: TacticalCombatState,
  unitId: string,
  to: TacticalCoord | null,
): TacticalCombatState {
  if (!to) return state;
  const units = state.units.map((u) => (u.id === unitId ? { ...u, x: to.x, y: to.y } : u));
  return { ...state, units };
}

type UiMode =
  | { kind: "idle" }
  | { kind: "unit"; unitId: string }
  | { kind: "skills"; unitId: string }
  | { kind: "target"; unitId: string; action: "attack" | "skill" | "item"; skill?: CombatSkill; itemName?: string };

const DEFAULT_ITEM_NAME = "Potion";

export function TacticalCombatUI({
  chatId,
  party,
  enemies,
  environment,
  formation,
  initialState,
  playerCombatantId,
  onCombatEnd,
}: TacticalCombatUIProps) {
  const manifest = useGameAssetStore((s) => s.manifest);
  const assets = manifest?.assets ?? null;
  const startMut = useTacticalCombatStart();
  const actionMut = useTacticalCombatAction();
  const updateMeta = useUpdateChatMetadata();

  const [state, setState] = useState<TacticalCombatState | null>(initialState ?? null);
  const [starting, setStarting] = useState(!initialState);
  const [startError, setStartError] = useState<string | null>(null);

  const [ui, setUi] = useState<UiMode>({ kind: "idle" });
  const [stagedMove, setStagedMove] = useState<TacticalCoord | null>(null);
  const [inspectTile, setInspectTile] = useState<TacticalCoord | null>(null);
  const [showThreat, setShowThreat] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [fleeConfirm, setFleeConfirm] = useState(false);

  // Animation state.
  const [animUnits, setAnimUnits] = useState<Map<string, RenderUnit> | null>(null);
  const [popups, setPopups] = useState<FloatingPopup[]>([]);
  const [banner, setBanner] = useState<PhaseBanner | null>(null);
  const [critFlash, setCritFlash] = useState(false);
  const animatingRef = useRef(false);
  const [animating, setAnimating] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const popupIdRef = useRef(0);
  const endedRef = useRef(false);

  const playSfx = useCallback((tag: string) => audioManager.playSfx(tag, assets), [assets]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  // ── Persist snapshot to chat metadata after every authoritative state change ──
  const persistSnapshot = useCallback(
    (snap: TacticalCombatState | null) => {
      updateMeta.mutate({ id: chatId, gameTacticalCombatSnapshot: snap });
    },
    [chatId, updateMeta],
  );

  // ── Start a fresh battle (unless restoring) ──
  useEffect(() => {
    if (initialState) return; // restored — do not re-create
    let cancelled = false;
    setStarting(true);
    setStartError(null);
    // Typed intermediate (not a fresh literal) so environment/formation reach the
    // POST body even though the hook's mutationFn type predates these fields.
    const startPayload: {
      chatId: string;
      party: Combatant[];
      enemies: Combatant[];
      environment?: string;
      formation?: string;
    } = { chatId, party, enemies };
    if (environment) startPayload.environment = environment;
    if (formation) startPayload.formation = formation;
    startMut
      .mutateAsync(startPayload)
      .then((res) => {
        if (cancelled) return;
        // Engine does NOT set isPlayer — the client marks the persona's combatant.
        const playerId = playerCombatantId ?? party[0]?.id ?? null;
        const marked: TacticalCombatState = {
          ...res.state,
          units: res.state.units.map((u) =>
            u.side === "party" && (playerId ? u.id === playerId : false) ? { ...u, isPlayer: true } : u,
          ),
        };
        setState(marked);
        setStarting(false);
        persistSnapshot(marked);
        playSfx(SFX.start);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStarting(false);
        setStartError(err instanceof Error ? err.message : "Failed to start the tactical battle.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // ── Derived: units currently rendered (anim positions during playback) ──
  const liveState = state;

  // Authoritative environment → terrain palette (restored snapshots keep theme).
  const activeEnvironment = useMemo(
    () => environmentOf(liveState) ?? environment ?? undefined,
    [liveState, environment],
  );
  const palette = useMemo(
    () => TERRAIN_PALETTES[activeEnvironment ?? "default"] ?? TERRAIN_PALETTES.default,
    [activeEnvironment],
  );
  // Stronger palette tint over the painted textures when a themed environment applies.
  const tileTintAlpha =
    activeEnvironment && TERRAIN_PALETTES[activeEnvironment] ? TILE_TINT_ALPHA_THEMED : TILE_TINT_ALPHA;

  const selectedUnitId = ui.kind === "idle" ? null : ui.unitId;
  const selectedUnit = useMemo(
    () => (liveState && selectedUnitId ? liveState.units.find((u) => u.id === selectedUnitId) ?? null : null),
    [liveState, selectedUnitId],
  );

  // Movement range for the selected (un-acted, un-moved) party unit.
  const movementTiles = useMemo(() => {
    if (!liveState || !selectedUnit || animating) return [];
    if (selectedUnit.hasMoved || selectedUnit.hasActed) return [];
    return getMovementRange(liveState, selectedUnit.id);
  }, [liveState, selectedUnit, animating]);

  const movementKeys = useMemo(() => new Set(movementTiles.map((t) => `${t.x},${t.y}`)), [movementTiles]);

  // Threat overlay: union of tiles any living enemy can attack (reachable + attack range).
  const threatKeys = useMemo(() => {
    if (!liveState || !showThreat) return new Set<string>();
    const keys = new Set<string>();
    for (const e of liveState.units) {
      if (e.side !== "enemy" || e.hp <= 0) continue;
      const reach = [{ x: e.x, y: e.y }, ...getMovementRange(liveState, e.id)];
      for (const tile of reach) {
        for (let dy = -e.attackRange.max; dy <= e.attackRange.max; dy++) {
          for (let dx = -e.attackRange.max; dx <= e.attackRange.max; dx++) {
            const d = Math.abs(dx) + Math.abs(dy);
            if (d < e.attackRange.min || d > e.attackRange.max) continue;
            const tx = tile.x + dx;
            const ty = tile.y + dy;
            if (tx < 0 || ty < 0 || tx >= liveState.grid.width || ty >= liveState.grid.height) continue;
            keys.add(`${tx},${ty}`);
          }
        }
      }
    }
    return keys;
  }, [liveState, showThreat]);

  // Staged post-move state, used for target highlighting + forecast.
  const stagedState = useMemo(
    () => (liveState && selectedUnit ? withStagedMove(liveState, selectedUnit.id, stagedMove) : liveState),
    [liveState, selectedUnit, stagedMove],
  );

  // Valid targets for the current target-selection mode.
  const targetIds = useMemo(() => {
    if (!stagedState || ui.kind !== "target" || !selectedUnit) return new Set<string>();
    const from = stagedMove ?? { x: selectedUnit.x, y: selectedUnit.y };
    if (ui.action === "attack") {
      return new Set(getTargetsInRange(stagedState, selectedUnit.id, from));
    }
    if (ui.action === "skill" && ui.skill) {
      const skill = ui.skill;
      if (skill.type === "attack") {
        // Attack skills reach at least range 2.
        const ids: string[] = [];
        for (const u of stagedState.units) {
          if (u.side === selectedUnit.side || u.hp <= 0) continue;
          const d = Math.abs(u.x - from.x) + Math.abs(u.y - from.y);
          const max = Math.max(selectedUnit.attackRange.max, 2);
          if (d >= 1 && d <= max) ids.push(u.id);
        }
        return new Set(ids);
      }
      // heal/buff → allies within support range 2; debuff → enemies within 2.
      const wantAlly = skill.type !== "debuff";
      const ids: string[] = [];
      for (const u of stagedState.units) {
        if (u.hp <= 0) continue;
        const isAlly = u.side === selectedUnit.side;
        if (wantAlly !== isAlly) continue;
        const d = Math.abs(u.x - from.x) + Math.abs(u.y - from.y);
        if (d <= 2) ids.push(u.id);
      }
      return new Set(ids);
    }
    if (ui.action === "item") {
      // Item (heal) → allies within range 2.
      const ids: string[] = [];
      for (const u of stagedState.units) {
        if (u.hp <= 0 || u.side !== selectedUnit.side) continue;
        const d = Math.abs(u.x - from.x) + Math.abs(u.y - from.y);
        if (d <= 2) ids.push(u.id);
      }
      return new Set(ids);
    }
    return new Set<string>();
  }, [stagedState, ui, selectedUnit, stagedMove]);

  // Forecast for a hovered/selected target (attack + attack-skills only).
  const [forecastTargetId, setForecastTargetId] = useState<string | null>(null);
  const forecast = useMemo(() => {
    if (!stagedState || !selectedUnit || !forecastTargetId) return null;
    if (ui.kind !== "target") return null;
    if (ui.action === "item") return null;
    if (ui.action === "skill" && ui.skill && ui.skill.type !== "attack") return null;
    return forecastAttack(stagedState, selectedUnit.id, forecastTargetId);
  }, [stagedState, selectedUnit, forecastTargetId, ui]);

  const spawnPopup = useCallback((unitId: string, text: string, tone: FloatingPopup["tone"]) => {
    const id = ++popupIdRef.current;
    setPopups((prev) => [...prev, { id, unitId, text, tone }]);
    const t = setTimeout(() => setPopups((prev) => prev.filter((p) => p.id !== id)), 1200);
    timersRef.current.push(t);
  }, []);

  // Applies one event's visual effect to the working render map + fires popups/sfx/banner.
  const applyEventVisual = useCallback(
    (ev: TacticalEvent, working: Map<string, RenderUnit>) => {
      switch (ev.kind) {
        case "move": {
          if (ev.actorId && ev.to) {
            const u = working.get(ev.actorId);
            if (u) {
              u.x = ev.to.x;
              u.y = ev.to.y;
            }
          }
          break;
        }
        case "phase": {
          const tone: PhaseBanner["tone"] =
            ev.phase === "enemy" || /enemy/i.test(ev.text) ? "enemy" : "player";
          setBanner({ text: ev.text, tone });
          break;
        }
        case "damage":
        case "counter": {
          if (ev.targetId && typeof ev.amount === "number") {
            const u = working.get(ev.targetId);
            if (u) u.hp = Math.max(0, u.hp - ev.amount);
            spawnPopup(ev.targetId, `-${ev.amount}`, "damage");
          }
          playSfx(SFX.hit);
          break;
        }
        case "crit": {
          if (ev.targetId && typeof ev.amount === "number") {
            const u = working.get(ev.targetId);
            if (u) u.hp = Math.max(0, u.hp - ev.amount);
            spawnPopup(ev.targetId, `-${ev.amount}!`, "crit");
          }
          setCritFlash(true);
          const t = setTimeout(() => setCritFlash(false), 220);
          timersRef.current.push(t);
          playSfx(SFX.crit);
          break;
        }
        case "heal": {
          if (ev.targetId && typeof ev.amount === "number") {
            const u = working.get(ev.targetId);
            if (u) u.hp = Math.min(u.maxHp, u.hp + ev.amount);
            spawnPopup(ev.targetId, `+${ev.amount}`, "heal");
          }
          playSfx(SFX.item);
          break;
        }
        case "miss": {
          if (ev.targetId) spawnPopup(ev.targetId, "Miss", "miss");
          playSfx(SFX.miss);
          break;
        }
        case "status": {
          if (ev.targetId && ev.statusName) spawnPopup(ev.targetId, ev.statusName, "status");
          break;
        }
        case "skill": {
          playSfx(SFX.magic);
          break;
        }
        case "defeat": {
          if (ev.targetId) {
            const u = working.get(ev.targetId);
            if (u) u.hp = 0;
          }
          break;
        }
        case "victory":
          playSfx(SFX.victory);
          break;
        case "defeat-end":
          playSfx(SFX.defeat);
          break;
        default:
          break;
      }
    },
    [playSfx, spawnPopup],
  );

  // ── End-of-battle handoff ──
  const maybeEnd = useCallback(
    (s: TacticalCombatState) => {
      if (!s.outcome || endedRef.current) return;
      endedRef.current = true;
      const summary = buildTacticalSummary(s);
      // Clear the persisted snapshot so a refresh doesn't re-enter the finished battle.
      persistSnapshot(null);
      // buildTacticalSummary already maps to classic outcome values ("victory"|"defeat"|"flee").
      const t = setTimeout(() => onCombatEnd(summary.outcome, summary), 1400);
      timersRef.current.push(t);
    },
    [onCombatEnd, persistSnapshot],
  );

  // ── Event animation player ──
  // Plays the server-returned events sequentially over a working copy of the
  // pre-action render map, then reconciles to the authoritative final state.
  // `onSettled` fires once, after the final state is committed (used to re-select
  // a unit that only moved so the player can immediately pick its action).
  const playEvents = useCallback(
    (
      events: TacticalEvent[],
      finalState: TacticalCombatState,
      preState: TacticalCombatState,
      onSettled?: (final: TacticalCombatState) => void,
    ) => {
      clearTimers();
      if (events.length === 0) {
        // No events to animate — release the lock sendAction set before flight.
        animatingRef.current = false;
        setAnimating(false);
        setState(finalState);
        persistSnapshot(finalState);
        maybeEnd(finalState);
        onSettled?.(finalState);
        return;
      }
      // Already locked by sendAction; keep it set through the animation + finalize.
      animatingRef.current = true;
      setAnimating(true);
      const working = renderMapFromState(preState);
      setAnimUnits(new Map(working));

      let elapsed = 0;
      events.forEach((ev, i) => {
        elapsed += i === 0 ? 0 : (EVENT_DELAY[events[i - 1].kind] ?? 500);
        const t = setTimeout(() => {
          applyEventVisual(ev, working);
          setAnimUnits(new Map(working));
        }, elapsed);
        timersRef.current.push(t);
      });

      // Finalize after the last event's dwell time.
      const finishAt = elapsed + (EVENT_DELAY[events[events.length - 1].kind] ?? 500);
      const done = setTimeout(() => {
        animatingRef.current = false;
        setAnimating(false);
        setAnimUnits(null);
        setBanner(null);
        setState(finalState);
        persistSnapshot(finalState);
        maybeEnd(finalState);
        onSettled?.(finalState);
      }, finishAt);
      timersRef.current.push(done);
    },
    [clearTimers, persistSnapshot, applyEventVisual, maybeEnd],
  );

  // ── Reset transient UI selection ──
  const resetSelection = useCallback(() => {
    setUi({ kind: "idle" });
    setStagedMove(null);
    setForecastTargetId(null);
  }, []);

  // ── Send one action to the server ──
  const sendAction = useCallback(
    (action: TacticalAction, onSettled?: (final: TacticalCombatState) => void) => {
      if (!liveState || animatingRef.current) return;
      const preState = liveState;
      // Lock SYNCHRONOUSLY — before the request leaves — so the network-flight
      // window is guarded too. Without this, a second click during flight posts
      // the STALE pre-action state, whose response cancels this animation and
      // commits a pre-kill state (enemy revived, unit teleported back). The lock
      // now covers request flight + animation + commit; playEvents / the catch
      // below own its release.
      animatingRef.current = true;
      setAnimating(true);
      resetSelection();
      actionMut
        .mutateAsync({ chatId, state: preState, action })
        .then((res) => {
          playEvents(res.events, res.state, preState, onSettled);
        })
        .catch((err: unknown) => {
          // Release the lock so a rejected action doesn't wedge the grid.
          animatingRef.current = false;
          setAnimating(false);
          const msg = err instanceof Error ? err.message : "That action was rejected.";
          toast.error(msg);
        });
    },
    [liveState, chatId, actionMut, playEvents, resetSelection],
  );

  // ── Interaction handlers ──

  const onTileClick = useCallback(
    (x: number, y: number) => {
      if (!liveState || animating) return;
      setInspectTile({ x, y });
      const key = `${x},${y}`;

      // Target selection: tap a valid target token handled by onTokenClick; tapping a
      // tile in target mode is a no-op except to inspect.
      if (ui.kind === "target") return;

      // If a party unit is selected and this tile is in movement range → stage move.
      if ((ui.kind === "unit" || ui.kind === "skills") && selectedUnit && movementKeys.has(key)) {
        if (selectedUnit.hasMoved) return;
        playSfx(SFX.hover);
        setStagedMove(x === selectedUnit.x && y === selectedUnit.y ? null : { x, y });
        setUi({ kind: "unit", unitId: selectedUnit.id });
        return;
      }
    },
    [liveState, animating, ui, selectedUnit, movementKeys, playSfx],
  );

  const onTokenClick = useCallback(
    (unit: TacticalUnit) => {
      if (!liveState || animating) return;
      setInspectTile({ x: unit.x, y: unit.y });

      // Target selection mode — confirm target if valid.
      if (ui.kind === "target") {
        if (!targetIds.has(unit.id)) return;
        setForecastTargetId(unit.id);
        return;
      }

      // Select a controllable party unit (alive, un-acted).
      if (unit.side === "party" && unit.hp > 0 && !unit.hasActed && liveState.phase === "player") {
        playSfx(SFX.select);
        setStagedMove(null);
        setForecastTargetId(null);
        setUi({ kind: "unit", unitId: unit.id });
        return;
      }

      // Otherwise just inspect (enemy or acted unit).
      resetSelection();
    },
    [liveState, animating, ui, targetIds, playSfx, resetSelection],
  );

  // ── Commit a pure move, then re-select the same unit so it can still act. ──
  const commitMove = useCallback(() => {
    if (!selectedUnit || !stagedMove || selectedUnit.hasMoved) return;
    const unitId = selectedUnit.id;
    playSfx(SFX.select);
    sendAction({ type: "move", unitId, to: stagedMove }, (final) => {
      // Only re-open the action menu if the battle continues and the mover can still act.
      if (final.outcome || final.phase !== "player") return;
      const u = final.units.find((x) => x.id === unitId);
      if (!u || u.hp <= 0 || u.hasActed) return;
      setUi({ kind: "unit", unitId });
    });
  }, [selectedUnit, stagedMove, playSfx, sendAction]);

  const chooseAction = useCallback(
    (actionId: "attack" | "skills" | "item" | "defend" | "wait") => {
      if (!selectedUnit || !liveState) return;
      playSfx(SFX.select);
      const to = stagedMove ?? undefined;
      switch (actionId) {
        case "attack":
          setUi({ kind: "target", unitId: selectedUnit.id, action: "attack" });
          setForecastTargetId(null);
          break;
        case "skills":
          setUi({ kind: "skills", unitId: selectedUnit.id });
          break;
        case "item":
          setUi({ kind: "target", unitId: selectedUnit.id, action: "item", itemName: DEFAULT_ITEM_NAME });
          setForecastTargetId(null);
          break;
        case "defend":
          sendAction({ type: "defend", unitId: selectedUnit.id, to });
          break;
        case "wait":
          sendAction({ type: "wait", unitId: selectedUnit.id, to });
          break;
      }
    },
    [selectedUnit, liveState, stagedMove, playSfx, sendAction],
  );

  const chooseSkill = useCallback(
    (skill: CombatSkill) => {
      if (!selectedUnit) return;
      playSfx(SFX.select);
      setUi({ kind: "target", unitId: selectedUnit.id, action: "skill", skill });
      setForecastTargetId(null);
    },
    [selectedUnit, playSfx],
  );

  const confirmTarget = useCallback(() => {
    if (!selectedUnit || ui.kind !== "target" || !forecastTargetId) return;
    const to = stagedMove ?? undefined;
    if (ui.action === "attack") {
      sendAction({ type: "attack", unitId: selectedUnit.id, targetId: forecastTargetId, to });
    } else if (ui.action === "skill" && ui.skill) {
      sendAction({ type: "skill", unitId: selectedUnit.id, skillName: ui.skill.name, targetId: forecastTargetId, to });
    } else if (ui.action === "item") {
      sendAction({
        type: "item",
        unitId: selectedUnit.id,
        itemName: ui.itemName ?? DEFAULT_ITEM_NAME,
        targetId: forecastTargetId,
        to,
      });
    }
  }, [selectedUnit, ui, forecastTargetId, stagedMove, sendAction]);

  // Support-skill (heal/buff/debuff) targets have no forecast — tapping confirms directly.
  const onSupportTarget = useCallback(
    (targetId: string) => {
      if (!selectedUnit || ui.kind !== "target") return;
      const to = stagedMove ?? undefined;
      if (ui.action === "skill" && ui.skill) {
        sendAction({ type: "skill", unitId: selectedUnit.id, skillName: ui.skill.name, targetId, to });
      } else if (ui.action === "item") {
        sendAction({ type: "item", unitId: selectedUnit.id, itemName: ui.itemName ?? DEFAULT_ITEM_NAME, targetId, to });
      }
    },
    [selectedUnit, ui, stagedMove, sendAction],
  );

  const endTurn = useCallback(() => {
    resetSelection();
    sendAction({ type: "endTurn" });
  }, [resetSelection, sendAction]);

  const confirmFlee = useCallback(() => {
    setFleeConfirm(false);
    resetSelection();
    sendAction({ type: "flee" });
  }, [resetSelection, sendAction]);

  // ── Render helpers ──

  const gridW = liveState?.grid.width ?? 0;
  const gridH = liveState?.grid.height ?? 0;
  const isPlayerPhaseNow = liveState?.phase === "player" && !animating;

  const renderUnits = useMemo(() => {
    if (!liveState) return [];
    return liveState.units.map((u) => {
      const anim = animUnits?.get(u.id);
      let x = anim?.x ?? u.x;
      let y = anim?.y ?? u.y;
      // Staged-move preview: while nothing is animating, render the selected unit's
      // token at its staged destination so the move reads as INSTANT feedback. The
      // token tweens there via UnitToken's framer-motion animate on left/top.
      if (!animUnits && stagedMove && selectedUnitId === u.id) {
        x = stagedMove.x;
        y = stagedMove.y;
      }
      return {
        unit: u,
        x,
        y,
        hp: anim?.hp ?? u.hp,
      };
    });
  }, [liveState, animUnits, stagedMove, selectedUnitId]);

  // ── Loading / error states (translucent so the scene shows through) ──
  if (starting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950/60 text-white/80 backdrop-blur-sm">
        <Sword className="h-8 w-8 animate-pulse text-amber-300" />
        <p className="text-sm">Deploying the tactical battlefield…</p>
      </div>
    );
  }

  if (startError || !liveState) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950/70 p-6 text-center text-white/80 backdrop-blur-sm">
        <SkullIcon className="h-8 w-8 text-red-400" />
        <p className="text-sm">{startError ?? "The battlefield failed to load."}</p>
        <button
          type="button"
          onClick={() => onCombatEnd("flee", { outcome: "flee", rounds: 0, party: [], enemies: [] })}
          className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
        >
          Retreat to story
        </button>
      </div>
    );
  }

  const outcome = liveState.outcome;
  const isPlayerPhase = isPlayerPhaseNow;
  // Raw player-phase flag (ignores `animating`) so the End Turn / Flee controls
  // stay visible-but-disabled during resolution instead of vanishing — dropped
  // clicks then read as "greyed out", not "the button disappeared".
  const playerPhase = liveState.phase === "player";

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-950/60 text-white select-none">
      {/* One-off keyframes for shimmer / range pulse / ready glow (self-contained). */}
      <style>{`
        @keyframes tc-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes tc-move-range { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.55; } }
        @keyframes tc-ready-glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(56,189,248,0); } 50% { box-shadow: 0 0 9px 2px rgba(56,189,248,0.55); } }
      `}</style>

      {/* Radial vignette so the grid reads against the scene art without an opaque fill. */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 40%, rgba(2,6,23,0.15) 0%, rgba(2,6,23,0.45) 60%, rgba(2,6,23,0.78) 100%)",
        }}
      />

      {/* Crit flash overlay */}
      {critFlash && <div className="pointer-events-none absolute inset-0 z-30 animate-pulse bg-white/25" />}

      {/* Top bar: round/phase + controls */}
      <div className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black/40 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wide",
              liveState.phase === "player" ? "bg-sky-500/25 text-sky-200" : "bg-red-500/25 text-red-200",
            )}
          >
            {liveState.phase === "player" ? "Player Phase" : "Enemy Phase"}
          </span>
          <span className="text-xs font-semibold text-white/60">Round {liveState.round}</span>
          <span className="hidden text-[0.65rem] font-medium uppercase tracking-wider text-white/40 sm:inline">
            {liveState.difficulty}
          </span>
          {animating && (
            <span className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[0.65rem] font-semibold text-white/70">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300 shadow-[0_0_6px_1px_rgba(252,211,77,0.7)]" />
              Resolving…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowThreat((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold transition-colors",
              showThreat
                ? "border-red-400/40 bg-red-500/20 text-red-100"
                : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10",
            )}
            title="Toggle enemy threat range"
          >
            {showThreat ? <Eye size={13} /> : <EyeOff size={13} />}
            <span className="hidden sm:inline">Threat</span>
          </button>
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white/70 transition-colors hover:bg-white/10"
            title="Combat log"
          >
            <ScrollText size={13} />
            <span className="hidden sm:inline">Log</span>
          </button>
          {playerPhase && (
            <>
              <button
                type="button"
                onClick={endTurn}
                disabled={animating}
                className={cn(
                  "rounded-lg border border-amber-300/30 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-100 transition-colors hover:bg-amber-500/30",
                  animating && "cursor-not-allowed opacity-40 hover:bg-amber-500/20",
                )}
              >
                End Turn
              </button>
              <button
                type="button"
                onClick={() => setFleeConfirm(true)}
                disabled={animating}
                className={cn(
                  "flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white/60 transition-colors hover:bg-white/10",
                  animating && "cursor-not-allowed opacity-40 hover:bg-white/5",
                )}
                title="Flee the battle"
              >
                <Flag size={13} />
                <span className="hidden sm:inline">Flee</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Battlefield */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-auto p-2 sm:p-4">
        <div
          className="relative"
          style={{
            aspectRatio: `${gridW} / ${gridH}`,
            width: "min(100%, calc((100vh - 14rem) * " + gridW + " / " + gridH + "))",
            maxWidth: "100%",
          }}
        >
          {/* Tile grid */}
          <div
            className="absolute inset-0 grid gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${gridW}, 1fr)`,
              gridTemplateRows: `repeat(${gridH}, 1fr)`,
            }}
          >
            {liveState.grid.tiles.flatMap((row, y) =>
              row.map((terrain, x) => {
                const key = `${x},${y}`;
                const inMove = movementKeys.has(key);
                const inThreat = threatKeys.has(key);
                const isStaged = stagedMove?.x === x && stagedMove?.y === y;
                const isInspected = inspectTile?.x === x && inspectTile?.y === y;
                const icon = resolveTerrainIcon(activeEnvironment, terrain);
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => onTileClick(x, y)}
                    className={cn(
                      "group relative overflow-hidden rounded-[3px] transition-all duration-150",
                      isInspected && "ring-1 ring-white/70",
                    )}
                    style={{ backgroundColor: palette[terrain] + TILE_ALPHA, boxShadow: tileShadow(terrain) }}
                    title={TERRAIN_DATA[terrain].label}
                  >
                    {/* Painted terrain texture (rotated per-tile for variety) */}
                    <span
                      className="pointer-events-none absolute inset-0"
                      style={{
                        backgroundImage: `url(${TILE_TEXTURES[terrain]})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        transform: `rotate(${((x * 7 + y * 13) % 4) * 90}deg) scale(1.03)`,
                      }}
                    />
                    {/* Environment palette tint over the texture */}
                    <span
                      className="pointer-events-none absolute inset-0"
                      style={{ backgroundColor: palette[terrain] + tileTintAlpha }}
                    />
                    {/* Top-light depth gradient */}
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/25" />
                    {/* Water shimmer (CSS only) */}
                    {terrain === "water" && (
                      <span
                        className="pointer-events-none absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(115deg, transparent 30%, rgba(125,211,252,0.35) 50%, transparent 70%)",
                          backgroundSize: "200% 200%",
                          animation: "tc-shimmer 3.5s linear infinite",
                        }}
                      />
                    )}
                    {icon && (
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[0.7em] opacity-45">
                        {icon}
                      </span>
                    )}
                    {inMove && !isStaged && (
                      <span
                        className="pointer-events-none absolute inset-0 bg-sky-400/40 ring-1 ring-inset ring-sky-300/60"
                        style={{ animation: "tc-move-range 1.5s ease-in-out infinite" }}
                      />
                    )}
                    {inThreat && (
                      <span className="pointer-events-none absolute inset-0 bg-red-500/20 ring-1 ring-inset ring-red-400/30" />
                    )}
                    {isStaged && (
                      <span className="pointer-events-none absolute inset-0 animate-pulse bg-sky-300/50 ring-2 ring-inset ring-sky-200" />
                    )}
                  </button>
                );
              }),
            )}
          </div>

          {/* Unit tokens */}
          {renderUnits.map(({ unit, x, y, hp }) => {
            const isSel = selectedUnitId === unit.id;
            const isTarget = ui.kind === "target" && targetIds.has(unit.id);
            const isForecastTarget = forecastTargetId === unit.id;
            const dead = hp <= 0;
            const ready =
              !dead &&
              !isSel &&
              isPlayerPhase &&
              unit.side === "party" &&
              !unit.hasActed &&
              !unit.hasMoved;
            return (
              <UnitToken
                key={unit.id}
                unit={unit}
                hp={hp}
                gridW={gridW}
                gridH={gridH}
                x={x}
                y={y}
                selected={isSel}
                targetable={isTarget}
                forecastTarget={isForecastTarget}
                dead={dead}
                ready={ready}
                onClick={() => {
                  if (isTarget && ui.kind === "target" && ui.action !== "attack") {
                    const isSupport = ui.action === "item" || (ui.action === "skill" && ui.skill?.type !== "attack");
                    if (isSupport) {
                      onSupportTarget(unit.id);
                      return;
                    }
                  }
                  onTokenClick(unit);
                }}
              />
            );
          })}

          {/* Floating damage popups */}
          <AnimatePresence>
            {popups.map((p) => {
              const target = renderUnits.find((r) => r.unit.id === p.unitId);
              if (!target) return null;
              const left = ((target.x + 0.5) / gridW) * 100;
              const top = ((target.y + 0.5) / gridH) * 100;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 0, scale: 0.7 }}
                  animate={{ opacity: 1, y: -24, scale: p.tone === "crit" ? 1.35 : 1 }}
                  exit={{ opacity: 0, y: -38 }}
                  transition={{ duration: 0.5 }}
                  className={cn(
                    "pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-sm font-black drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]",
                    p.tone === "damage" && "text-red-300",
                    p.tone === "crit" && "text-amber-300",
                    p.tone === "heal" && "text-emerald-300",
                    p.tone === "miss" && "text-white/70 italic",
                    p.tone === "status" && "text-violet-300 text-xs",
                  )}
                  style={{ left: `${left}%`, top: `${top}%` }}
                >
                  {p.text}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Phase banner sweep (FE-style, tinted by side) */}
        <AnimatePresence>
          {banner && (
            <motion.div
              key={banner.text}
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ duration: 0.45 }}
              className={cn(
                "pointer-events-none absolute left-0 right-0 top-1/2 z-30 -translate-y-1/2 py-4 text-center text-2xl font-black uppercase tracking-widest text-white drop-shadow-lg",
                banner.tone === "enemy"
                  ? "bg-gradient-to-r from-red-950/0 via-red-800/70 to-red-950/0"
                  : "bg-gradient-to-r from-sky-950/0 via-sky-700/70 to-sky-950/0",
              )}
            >
              {banner.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Inspect card (terrain + unit) */}
      {inspectTile && !outcome && (
        <TileInspect state={liveState} tile={inspectTile} onClose={() => setInspectTile(null)} />
      )}

      {/* Action menu / target forecast (bottom sheet on mobile, side card on desktop) */}
      {isPlayerPhase && selectedUnit && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-2 sm:justify-end sm:p-4">
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/15 bg-slate-900/85 p-3 shadow-2xl backdrop-blur-md sm:w-72">
            <div className="mb-2 flex items-center justify-between">
              <span className="truncate text-sm font-bold text-white">
                {selectedUnit.isPlayer && <Crown className="mr-1 inline h-3.5 w-3.5 text-amber-300" />}
                {selectedUnit.name}
              </span>
              <button type="button" onClick={resetSelection} className="text-white/50 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {/* Action menu */}
            {ui.kind === "unit" && (
              <>
                {selectedUnit.hasMoved && !selectedUnit.hasActed && (
                  <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1.5 text-[0.7rem] italic text-white/60">
                    <Footprints className="h-3.5 w-3.5 text-sky-300" />
                    Already moved — choose an action.
                  </p>
                )}
                <div className="grid grid-cols-3 gap-1.5">
                  {stagedMove && !selectedUnit.hasMoved && (
                    <ActionButton
                      icon={Footprints}
                      label="Move"
                      color="text-sky-300"
                      onClick={commitMove}
                      disabled={animating}
                    />
                  )}
                  {getTargetsInRange(stagedState ?? liveState, selectedUnit.id, stagedMove ?? undefined).length > 0 && (
                    <ActionButton icon={Sword} label="Attack" color="text-red-300" onClick={() => chooseAction("attack")} disabled={animating} />
                  )}
                  {selectedUnit.skills.length > 0 && (
                    <ActionButton
                      icon={Sparkles}
                      label="Skills"
                      color="text-sky-300"
                      onClick={() => chooseAction("skills")}
                      disabled={animating}
                    />
                  )}
                  <ActionButton icon={Backpack} label="Item" color="text-emerald-300" onClick={() => chooseAction("item")} disabled={animating} />
                  <ActionButton icon={Shield} label="Defend" color="text-amber-300" onClick={() => chooseAction("defend")} disabled={animating} />
                  <ActionButton icon={Hourglass} label="Wait" color="text-white/70" onClick={() => chooseAction("wait")} disabled={animating} />
                  {stagedMove && (
                    <ActionButton
                      icon={Wind}
                      label="Reset Move"
                      color="text-white/60"
                      onClick={() => setStagedMove(null)}
                      disabled={animating}
                    />
                  )}
                </div>
              </>
            )}

            {/* Skill list */}
            {ui.kind === "skills" && (
              <div className="flex flex-col gap-1.5">
                {selectedUnit.skills.map((skill) => {
                  const cd = selectedUnit.skillCooldowns[skill.name] ?? 0;
                  const ready = cd <= 0 && selectedUnit.mp >= skill.mpCost && !animating;
                  return (
                    <button
                      type="button"
                      key={skill.id ?? skill.name}
                      disabled={!ready}
                      onClick={() => chooseSkill(skill)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs transition-colors",
                        ready
                          ? "border-sky-400/30 bg-sky-500/10 text-white hover:bg-sky-500/20"
                          : "border-white/10 bg-white/5 text-white/40",
                      )}
                    >
                      <span className="font-semibold">{skill.name}</span>
                      <span className="flex items-center gap-1.5 text-[0.65rem] text-white/60">
                        <span className="uppercase">{skill.type}</span>
                        {skill.mpCost > 0 && <span className="text-sky-300">{skill.mpCost} MP</span>}
                        {cd > 0 && <span className="text-amber-300">CD {cd}</span>}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setUi({ kind: "unit", unitId: selectedUnit.id })}
                  className="mt-1 text-center text-xs text-white/50 hover:text-white"
                >
                  ← Back
                </button>
              </div>
            )}

            {/* Target / forecast */}
            {ui.kind === "target" && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-white/70">
                  {ui.action === "attack"
                    ? "Select a target"
                    : ui.action === "item"
                      ? "Select an ally"
                      : ui.skill?.type === "attack"
                        ? "Select a target"
                        : ui.skill?.type === "debuff"
                          ? "Select an enemy"
                          : "Select an ally"}
                </p>
                {targetIds.size === 0 && (
                  <p className="text-xs italic text-white/50">
                    {(() => {
                      const isAttack = ui.action === "attack" || (ui.action === "skill" && ui.skill?.type === "attack");
                      if (isAttack) {
                        const range = selectedUnit.attackRange;
                        const rng = range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
                        if (range.min > 1) {
                          const cls = unitClassOf(selectedUnit);
                          const plural = `${CLASS_PROFILES[cls].label.toLowerCase()}s`;
                          return `No targets in range ${rng} — ${plural} can't strike adjacent foes.`;
                        }
                        return `No targets in range ${rng}.`;
                      }
                      if (ui.action === "skill" && ui.skill?.type === "debuff") return "No enemies in range.";
                      return "No allies in range.";
                    })()}
                  </p>
                )}

                {forecast && forecastTargetId && (
                  <ForecastPanel
                    forecast={forecast}
                    attacker={selectedUnit}
                    defender={liveState.units.find((u) => u.id === forecastTargetId) ?? null}
                  />
                )}

                <div className="flex gap-2">
                  {forecast && forecastTargetId && (
                    <button
                      type="button"
                      onClick={confirmTarget}
                      disabled={animating}
                      className={cn(
                        "flex-1 rounded-lg bg-red-500/80 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-red-500",
                        animating && "cursor-not-allowed opacity-40 hover:bg-red-500/80",
                      )}
                    >
                      Confirm
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setForecastTargetId(null);
                      setUi({ kind: "unit", unitId: selectedUnit.id });
                    }}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Combat log drawer */}
      {logOpen && (
        <div className="absolute inset-0 z-40 flex" onClick={() => setLogOpen(false)}>
          <div className="ml-auto h-full w-full max-w-sm border-l border-white/10 bg-slate-950/95 backdrop-blur" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="text-sm font-bold">Combat Log</span>
              <button type="button" onClick={() => setLogOpen(false)} className="text-white/50 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="h-[calc(100%-3.25rem)] overflow-y-auto px-4 py-3 text-xs leading-relaxed">
              {liveState.log.map((ev, i) => (
                <p
                  key={i}
                  className={cn(
                    "border-b border-white/5 py-1",
                    ev.kind === "phase" && "font-bold text-amber-200",
                    ev.kind === "crit" && "font-semibold text-amber-300",
                    ev.kind === "defeat" && "text-red-300",
                    ev.kind === "heal" && "text-emerald-300",
                    ev.kind === "miss" && "italic text-white/50",
                  )}
                >
                  {ev.text}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Flee confirm */}
      {fleeConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-white/15 bg-slate-900 p-5 text-center">
            <Flag className="mx-auto mb-2 h-6 w-6 text-amber-300" />
            <p className="mb-4 text-sm text-white/90">Retreat from this battle? The GM will narrate your escape.</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmFlee}
                className="flex-1 rounded-lg bg-amber-500/80 px-3 py-2 text-sm font-bold text-white hover:bg-amber-500"
              >
                Flee
              </button>
              <button
                type="button"
                onClick={() => setFleeConfirm(false)}
                className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outcome screen */}
      {outcome && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center backdrop-blur">
          {outcome === "victory" && <Trophy className="h-14 w-14 text-amber-300" />}
          {outcome === "defeat" && <SkullIcon className="h-14 w-14 text-red-400" />}
          {outcome === "fled" && <Wind className="h-14 w-14 text-sky-300" />}
          <h2
            className={cn(
              "text-3xl font-black uppercase tracking-widest",
              outcome === "victory" && "text-amber-300",
              outcome === "defeat" && "text-red-400",
              outcome === "fled" && "text-sky-300",
            )}
          >
            {outcome === "victory" ? "Victory" : outcome === "defeat" ? "Defeat" : "Retreated"}
          </h2>
          <p className="text-sm text-white/60">Returning to the story…</p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──

interface UnitTokenProps {
  unit: TacticalUnit;
  hp: number;
  gridW: number;
  gridH: number;
  x: number;
  y: number;
  selected: boolean;
  targetable: boolean;
  forecastTarget: boolean;
  dead: boolean;
  ready: boolean;
  onClick: () => void;
}

function UnitToken({
  unit,
  hp,
  gridW,
  gridH,
  x,
  y,
  selected,
  targetable,
  forecastTarget,
  dead,
  ready,
  onClick,
}: UnitTokenProps) {
  const left = ((x + 0.5) / gridW) * 100;
  const top = ((y + 0.5) / gridH) * 100;
  const cellW = 100 / gridW;
  const sprite = resolveSprite(unit.sprite);
  const ring = ringColorFor(unit.id, unit.side);
  const ClassIcon = CLASS_ICONS[unitClassOf(unit)];
  const hpPct = unit.maxHp > 0 ? Math.max(0, (hp / unit.maxHp) * 100) : 0;
  const hpColor = hpPct > 60 ? "bg-emerald-500" : hpPct > 25 ? "bg-amber-500" : "bg-red-500";
  const mpPct = unit.maxMp > 0 ? Math.max(0, (unit.mp / unit.maxMp) * 100) : 0;

  const style: CSSProperties = {
    left: `${left}%`,
    top: `${top}%`,
    width: `${cellW * 0.9}%`,
  };

  return (
    <motion.button
      type="button"
      onClick={onClick}
      animate={{ left: `${left}%`, top: `${top}%` }}
      whileHover={{ scale: dead ? 1 : 1.09 }}
      transition={{ type: "tween", duration: 0.25 }}
      style={style}
      className={cn(
        "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center",
        dead && "opacity-30 grayscale",
        unit.hasActed && unit.side === "party" && !dead && "opacity-60 grayscale",
      )}
    >
      <div
        className={cn(
          "relative flex aspect-square w-full items-center justify-center rounded-full border-2 shadow-lg drop-shadow-[0_2px_3px_rgba(0,0,0,0.6)]",
          selected && "ring-2 ring-sky-300 ring-offset-1 ring-offset-slate-900",
          targetable && "ring-2 ring-red-400 animate-pulse",
          forecastTarget && "ring-2 ring-red-300 ring-offset-1 ring-offset-slate-900",
        )}
        style={{
          borderColor: ring,
          backgroundColor: unit.side === "party" ? "rgba(30,58,90,0.9)" : "rgba(90,30,40,0.9)",
          animation: ready ? "tc-ready-glow 1.8s ease-in-out infinite" : undefined,
        }}
      >
        {sprite.kind === "url" ? (
          <img src={sprite.value} alt={unit.name} className="h-full w-full rounded-full object-cover" />
        ) : sprite.kind === "emoji" ? (
          <span className="text-[min(4vw,1.5rem)] leading-none">{sprite.value}</span>
        ) : (
          <span className="text-[min(3vw,0.9rem)] font-black text-white/90">{initialsOf(unit.name)}</span>
        )}
        {unit.isPlayer && (
          <Crown className="absolute -top-2 left-1/2 h-3 w-3 -translate-x-1/2 text-amber-300 drop-shadow" />
        )}
        {unit.isBoss && (
          <Skull className="absolute -top-2 left-1/2 h-3 w-3 -translate-x-1/2 text-red-300 drop-shadow" />
        )}
        {dead && <SkullIcon className="absolute inset-0 m-auto h-1/2 w-1/2 text-white/70" />}
        {/* Class badge (corner, side-tinted) */}
        {!dead && (
          <span
            className="absolute -bottom-0.5 -right-0.5 flex h-[13px] w-[13px] items-center justify-center rounded-full border shadow-sm"
            style={{
              backgroundColor: unit.side === "party" ? "rgba(30,58,90,0.95)" : "rgba(90,30,40,0.95)",
              borderColor: ring,
            }}
          >
            <ClassIcon className="h-2 w-2 text-white/90" />
          </span>
        )}
      </div>
      {/* HP bar */}
      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-black/60">
        <div className={cn("h-full transition-all duration-300", hpColor)} style={{ width: `${hpPct}%` }} />
      </div>
      {unit.maxMp > 0 && (
        <div className="mt-[1px] h-[2px] w-full overflow-hidden rounded-full bg-black/60">
          <div className="h-full bg-sky-400 transition-all duration-300" style={{ width: `${mpPct}%` }} />
        </div>
      )}
    </motion.button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  color,
  onClick,
  disabled,
}: {
  icon: typeof Sword;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-1 py-2.5 text-[0.68rem] font-semibold text-white/85 transition-colors hover:bg-white/15 active:scale-95",
        disabled && "cursor-not-allowed opacity-40 hover:bg-white/5 active:scale-100",
      )}
    >
      <Icon className={cn("h-5 w-5", color)} />
      {label}
    </button>
  );
}

function ForecastPanel({
  forecast,
  attacker,
  defender,
}: {
  forecast: ReturnType<typeof forecastAttack>;
  attacker: TacticalUnit;
  defender: TacticalUnit | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/40 p-2 text-xs"
    >
      <ForecastSide
        unit={attacker}
        tone="text-sky-200"
        headerBg="bg-sky-500/20"
        damage={forecast.damage}
        hit={forecast.hitChance}
        crit={forecast.critChance}
      />
      {forecast.counter && defender ? (
        <ForecastSide
          unit={defender}
          tone="text-red-200"
          headerBg="bg-red-500/20"
          label="counters"
          damage={forecast.counter.damage}
          hit={forecast.counter.hitChance}
          crit={forecast.counter.critChance}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg bg-white/5 text-center text-[0.65rem] text-white/40">
          <span className="font-semibold">{defender?.name ?? "Target"}</span>
          {defender && <ClassChip unit={defender} muted />}
          <span>no counter</span>
        </div>
      )}
    </motion.div>
  );
}

function ForecastSide({
  unit,
  tone,
  headerBg,
  label,
  damage,
  hit,
  crit,
}: {
  unit: TacticalUnit;
  tone: string;
  headerBg: string;
  label?: string;
  damage: number;
  hit: number;
  crit: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg bg-white/5">
      <div className={cn("truncate px-1.5 py-1 text-[0.65rem] font-bold", headerBg, tone)}>
        {unit.name}
        {label && <span className="font-normal text-white/50"> {label}</span>}
      </div>
      <div className="px-1.5 pb-1.5 pt-1">
        <div className="mb-1">
          <ClassChip unit={unit} />
        </div>
        <div className="flex items-baseline gap-1">
          <Sword className="h-3 w-3 text-white/50" />
          <span className="text-base font-black text-white">{damage}</span>
        </div>
        <div className="flex justify-between text-[0.6rem] text-white/60">
          <span>Hit {Math.round(hit)}%</span>
          <span className="text-amber-300/80">Crit {Math.round(crit)}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Class chip: lucide icon + label + attack-range text ──
function ClassChip({ unit, muted }: { unit: TacticalUnit; muted?: boolean }) {
  const cls = unitClassOf(unit);
  const profile = CLASS_PROFILES[cls];
  const Icon = CLASS_ICONS[cls];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[0.6rem] font-semibold",
        muted ? "text-white/50" : "text-white/80",
      )}
    >
      <Icon className={cn("h-3 w-3", muted ? "text-white/50" : "text-sky-300")} />
      <span>{profile.label}</span>
      <span className="text-white/45">· {rangeText(unit.attackRange)}</span>
    </span>
  );
}

function TileInspect({
  state,
  tile,
  onClose,
}: {
  state: TacticalCombatState;
  tile: TacticalCoord;
  onClose: () => void;
}) {
  const terrain = state.grid.tiles[tile.y]?.[tile.x];
  if (!terrain) return null;
  const info = TERRAIN_DATA[terrain];
  const unit = state.units.find((u) => u.x === tile.x && u.y === tile.y && u.hp > 0);
  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-20 w-44 rounded-xl border border-white/10 bg-slate-900/95 p-2.5 text-xs shadow-xl backdrop-blur sm:left-4 sm:top-16">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-bold text-white">{info.label}</span>
        <button type="button" onClick={onClose} className="text-white/40 hover:text-white">
          <X size={13} />
        </button>
      </div>
      <div className="flex gap-2 text-[0.65rem] text-white/60">
        <span>Def +{info.defenseBonus}</span>
        <span>Avoid +{info.avoidBonus}%</span>
      </div>
      {unit && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="flex items-center gap-1 font-semibold text-white">
            {unit.isPlayer && <Crown className="h-3 w-3 text-amber-300" />}
            {unit.isBoss && <Skull className="h-3 w-3 text-red-300" />}
            <span className="truncate">{unit.name}</span>
            <span className="ml-auto text-[0.6rem] text-white/40">Lv {unit.level}</span>
          </div>
          <div className="mt-1">
            <ClassChip unit={unit} />
          </div>
          <div className="mt-1 flex items-center gap-1 text-[0.65rem] text-white/70">
            <Heart className="h-3 w-3 text-red-400" />
            {unit.hp}/{unit.maxHp}
            {unit.maxMp > 0 && (
              <>
                <Droplets className="ml-1 h-3 w-3 text-sky-400" />
                {unit.mp}/{unit.maxMp}
              </>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[0.6rem] text-white/50">
            <span>ATK {unit.attack}</span>
            <span>DEF {unit.defense}</span>
            <span>SPD {unit.speed}</span>
            <span>MOV {unit.movement}</span>
          </div>
          {unit.statusEffects.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {unit.statusEffects.map((e, i) => (
                <span key={i} className="rounded bg-violet-500/20 px-1 text-[0.55rem] text-violet-200">
                  {e.name} ({e.turnsLeft})
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TacticalCombatUI;
