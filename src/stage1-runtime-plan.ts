import type { PokemonStateObservation } from "./pokemon-state";
import { STAGE1_VIRIDIAN_ACTIVE_RULES } from "./stage1-active-rules";
import { STAGE1_VIRIDIAN_ACTIVE_SKILLS } from "./stage1-active-skills";
import {
  evaluateStage1ViridianCitySuccess,
  POKEMON_RED_STAGE1_MAP_IDS,
} from "./stage1-evaluator";
import type { StuckMemorySnapshot } from "./stuck-memory";

export interface Stage1RuntimePlanInput {
  recentActions?: readonly string[];
  state?: PokemonStateObservation;
  stuckMemory?: StuckMemorySnapshot;
}

export function formatStage1RuntimePlan({
  recentActions = [],
  state,
  stuckMemory,
}: Stage1RuntimePlanInput): string {
  if (!state || state.readStatus !== "available") {
    return [
      "\n\nStage 1 Rule Memory Read:",
      "- status: unavailable",
      "- fallback: use vision and supervised button tools only; do not reset or reload ROM",
    ].join("\n");
  }

  const mode = detectMode(state);
  const activeRules = selectRuntimeRules(state, stuckMemory);
  const selectedSkill = selectRuntimeSkill(state, stuckMemory);
  const victory = evaluateStage1ViridianCitySuccess({
    currentState: state,
  });

  return [
    "\n\nStage 1 Rule Memory Read:",
    `- objective: reach Viridian City mapId=${POKEMON_RED_STAGE1_MAP_IDS.viridianCity}`,
    `- mode: ${mode}`,
    `- mapId: ${formatValue(state.mapId)} position: x=${formatValue(state.position.x)} y=${formatValue(state.position.y)}`,
    `- evaluator: victory=${victory.progressStatus === "victory"} progress=${victory.progressStatus}`,
    `- active rules: ${activeRules.map((rule) => rule.id).join(", ") || "none"}`,
    `- recommended skill: ${selectedSkill?.id ?? "fallback:vision-guided-supervised-control"}`,
    `- recommended action: ${formatRecommendedAction(selectedSkill)}`,
    `- recent action diversity guard: ${recentActions.length >= 3 ? "avoid same-state/same-action repetition at 3+ attempts" : "collect evidence before declaring a loop"}`,
    "- control boundary: only mgba_tap/mgba_tap_many/mgba_hold/mgba_hold_many/mgba_release; never reset, reload, or delete saves",
  ].join("\n");
}

function detectMode(state: PokemonStateObservation): string {
  if (state.battle) {
    return "battle";
  }
  if (state.menuLike === true) {
    return "menu";
  }
  if (state.dialogueLike === true) {
    return "dialogue";
  }
  return "overworld";
}

function selectRuntimeRules(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot | undefined
) {
  return STAGE1_VIRIDIAN_ACTIVE_RULES.filter((rule) => {
    if (rule.scope === "control") {
      return true;
    }
    if (state.battle) {
      return rule.scope === "battle";
    }
    if (
      state.mapId === POKEMON_RED_STAGE1_MAP_IDS.palletTown ||
      state.mapId === POKEMON_RED_STAGE1_MAP_IDS.route1
    ) {
      if (
        stuckMemory &&
        (hasThreeAttemptLoop(stuckMemory) || stuckMemory.stuckEvents > 0)
      ) {
        return ["mode", "navigation", "route-guide"].includes(rule.scope);
      }
      return ["mode", "navigation", "route-guide", "story"].includes(
        rule.scope
      );
    }
    return rule.scope === "mode";
  }).slice(0, 5);
}

function selectRuntimeSkill(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot | undefined
) {
  if (
    stuckMemory &&
    (hasThreeAttemptLoop(stuckMemory) || stuckMemory.stuckEvents > 0)
  ) {
    return STAGE1_VIRIDIAN_ACTIVE_SKILLS.find(
      (skill) => skill.id === "skill:route-1.lateral-obstacle-recovery"
    );
  }
  if (
    state.mapId === POKEMON_RED_STAGE1_MAP_IDS.palletTown ||
    state.mapId === POKEMON_RED_STAGE1_MAP_IDS.route1
  ) {
    return STAGE1_VIRIDIAN_ACTIVE_SKILLS.find(
      (skill) => skill.id === "skill:route-1.follow-north-path"
    );
  }
  if (state.dialogueLike === true) {
    return STAGE1_VIRIDIAN_ACTIVE_SKILLS.find(
      (skill) => skill.id === "skill:stage1.advance-blocking-text"
    );
  }
  return;
}

function formatRecommendedAction(
  skill: (typeof STAGE1_VIRIDIAN_ACTIVE_SKILLS)[number] | undefined
): string {
  const candidate = skill?.output.actionCandidates[0];
  if (!candidate) {
    return "observe -> choose one safe supervised action";
  }
  return `${candidate.toolCall.toolName} ${(candidate.toolCall.buttons ?? []).join("+")} for ${candidate.toolCall.durationFrames ?? "default"} frames`;
}

function formatValue(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

function hasThreeAttemptLoop(stuckMemory: StuckMemorySnapshot): boolean {
  return stuckMemory.failedMovementEdges.some((edge) => edge.attempts >= 3);
}
