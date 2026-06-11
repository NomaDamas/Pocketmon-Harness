import type { MgbaObservation } from "./observation";
import type { PokemonStateObservation } from "./pokemon-state";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import { isOakLabStarterSelectionPosition } from "./starter-preference";
import type { StuckMemorySnapshot } from "./stuck-memory";

export type PokemonPhase =
  | "bedroom_2f"
  | "house_1f"
  | "lab_before_starter"
  | "name_entry"
  | "oak_forced_walk_or_dialogue"
  | "pallet_after_starter"
  | "pallet_before_oak"
  | "rival_battle"
  | "route1"
  | "starter_selection"
  | "title_or_intro"
  | "unknown"
  | "viridian";

export interface PhaseDetectionInput {
  observation: Pick<MgbaObservation, "state">;
  recentActions?: readonly string[];
  stuckMemory?: StuckMemorySnapshot;
}

export interface PhaseDetection {
  phase: PokemonPhase;
  reason: string;
  waypoint: string;
}

const RED_HOUSE_1F_MAP_ID = 37;
const RED_HOUSE_2F_MAP_ID = 38;
const OAK_LAB_MAP_ID = 40;
const NAME_ENTRY_MAP_ID = 158;

export function detectPokemonPhase({
  observation,
  stuckMemory,
}: PhaseDetectionInput): PhaseDetection {
  const state = observation.state;
  if (!state || state.readStatus !== "available") {
    return phase("unknown", "ram-unavailable", "fallback-analysis");
  }
  if (state.mapId === null) {
    return phase("unknown", "mapId-unavailable", "fallback-analysis");
  }
  if (state.mapId === NAME_ENTRY_MAP_ID) {
    return phase("name_entry", "name-entry-map", "finish-name-entry");
  }
  if (state.battle) {
    return phase(
      "rival_battle",
      "deterministic-rival-battle-event",
      "win-current-battle"
    );
  }
  if (state.mapId === RED_HOUSE_2F_MAP_ID) {
    return phase("bedroom_2f", "red-bedroom-map", "stair-warp");
  }
  if (state.mapId === RED_HOUSE_1F_MAP_ID) {
    return phase("house_1f", "red-house-1f-map", "front-door-warp");
  }
  if (state.mapId === OAK_LAB_MAP_ID) {
    const oakLabPhase = classifyOakLabPhase(state);
    return phase(
      oakLabPhase,
      oakLabPhase === "starter_selection"
        ? "oak-lab-starter-ram-controller-target"
        : "oak-lab-map",
      oakLabPhase === "starter_selection"
        ? "select-starter"
        : "advance-oak-lab-script"
    );
  }
  if (state.mapId === POKEMON_RED_STAGE1_MAP_IDS.palletTown) {
    if (isOakTriggerCandidate(state, stuckMemory)) {
      return phase(
        "oak_forced_walk_or_dialogue",
        "pallet-north-trigger-or-blocked-event",
        "advance-oak-forced-event"
      );
    }
    return phase("pallet_before_oak", "pallet-town-map", "north-grass-trigger");
  }
  if (state.mapId === POKEMON_RED_STAGE1_MAP_IDS.route1) {
    return phase("route1", "route-1-map", "viridian-city-warp");
  }
  if (state.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity) {
    return phase("viridian", "viridian-city-map", "stage1-complete");
  }
  return phase(
    "unknown",
    `unsupported-map:${state.mapId}`,
    "fallback-analysis"
  );
}

function classifyOakLabPhase(state: PokemonStateObservation): PokemonPhase {
  if (state.battle) {
    return "rival_battle";
  }
  if (isOakLabStarterSelectionPosition(state)) {
    return "starter_selection";
  }
  return "lab_before_starter";
}

function isOakTriggerCandidate(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot | undefined
): boolean {
  if (state.position.x === null || state.position.y === null) {
    return false;
  }
  if (state.position.y > 2 || state.position.x < 8 || state.position.x > 12) {
    return false;
  }
  if (state.dialogueLike === true) {
    return true;
  }
  return (
    stuckMemory?.failedMovementEdges.some(
      (edge) =>
        edge.attempts >= 3 &&
        edge.action === "hold:Up" &&
        edge.context.includes(`map=${state.mapId}`) &&
        edge.context.includes(`x=${state.position.x}`) &&
        edge.context.includes(`y=${state.position.y}`)
    ) ?? false
  );
}

function phase(
  phaseName: PokemonPhase,
  reason: string,
  waypoint: string
): PhaseDetection {
  return { phase: phaseName, reason, waypoint };
}
