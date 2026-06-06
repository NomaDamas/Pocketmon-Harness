import { chooseNameEntryRecoveryAction } from "./name-entry-recovery";
import type { MgbaObservation } from "./observation";
import { detectPokemonPhase, type PokemonPhase } from "./phase-detector";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import {
  type AutopilotAction,
  chooseStage1FastAction,
} from "./stage1-fast-autopilot";
import type { StuckMemorySnapshot } from "./stuck-memory";

const RED_HOUSE_1F_MAP_ID = 37;
const RED_HOUSE_2F_MAP_ID = 38;
const OAK_LAB_MAP_ID = 40;
const OAK_LAB_MAX_DETERMINISTIC_A = 10;
const OAK_TRIGGER_MAX_DETERMINISTIC_A = 6;
const INTRO_BOOTSTRAP_MAX_DETERMINISTIC_ACTIONS = 10;

const KNOWN_STAGE1_MAP_IDS = new Set<number>([
  RED_HOUSE_1F_MAP_ID,
  RED_HOUSE_2F_MAP_ID,
  OAK_LAB_MAP_ID,
  POKEMON_RED_STAGE1_MAP_IDS.palletTown,
  POKEMON_RED_STAGE1_MAP_IDS.route1,
  POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
]);

export interface DeterministicPolicyInput {
  observation: MgbaObservation;
  recentActions?: readonly string[];
  stuckMemory: StuckMemorySnapshot;
}

export interface DeterministicPolicyDecision {
  action?: AutopilotAction;
  expectedOutcome?:
    | "battle-progress"
    | "dialogue-progress"
    | "movement-or-map-change";
  phase: PokemonPhase;
  policy:
    | "battle"
    | "dialogue"
    | "known-stage1-route"
    | "llm-fallback"
    | "menu"
    | "name-entry"
    | "scripted-event";
  reason: string;
  waypoint: string;
}

export function chooseDeterministicPolicyAction({
  observation,
  recentActions = [],
  stuckMemory,
}: DeterministicPolicyInput): DeterministicPolicyDecision {
  const detected = detectPokemonPhase({
    observation,
    recentActions,
    stuckMemory,
  });
  const nameEntryAction = chooseNameEntryRecoveryAction(
    observation.state,
    recentActions
  );
  if (nameEntryAction) {
    return {
      action: {
        button: nameEntryAction.button,
        reason: nameEntryAction.reason,
        toolName: nameEntryAction.toolName,
      },
      expectedOutcome: "dialogue-progress",
      phase: detected.phase,
      policy: "name-entry",
      reason: nameEntryAction.reason,
      waypoint: detected.waypoint,
    };
  }

  const state = observation.state;
  if (!state || state.readStatus !== "available") {
    const introAction = chooseIntroBootstrapAction(recentActions, detected);
    if (introAction) {
      return introAction;
    }
    return {
      phase: detected.phase,
      policy: "llm-fallback",
      reason:
        "RAM state unavailable after deterministic intro bootstrap budget; fallback analyst may use vision.",
      waypoint: detected.waypoint,
    };
  }

  if (state.battle) {
    return {
      action: {
        button: "A",
        reason: "BattlePolicy: advance/select the default battle option.",
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      phase: detected.phase,
      policy: "battle",
      reason: "battle RAM flag is active",
      waypoint: detected.waypoint,
    };
  }

  if (state.mapId === OAK_LAB_MAP_ID) {
    const labDecision = chooseOakLabScriptAction(recentActions, detected);
    if (labDecision) {
      return labDecision;
    }
  }

  if (state.dialogueLike === true) {
    if (recentTapCount(recentActions, "A") >= OAK_TRIGGER_MAX_DETERMINISTIC_A) {
      return {
        phase: detected.phase,
        policy: "llm-fallback",
        reason:
          "dialogue advanced with A repeatedly without clear state transition; fallback analyst must inspect",
        waypoint: detected.waypoint,
      };
    }
    return {
      action: {
        button: "A",
        reason: "DialoguePolicy: advance forced dialogue.",
        toolName: "mgba_tap",
      },
      expectedOutcome: "dialogue-progress",
      phase: detected.phase,
      policy: "dialogue",
      reason: "dialogue-like state is active",
      waypoint: detected.waypoint,
    };
  }

  if (state.menuLike === true) {
    return {
      action: {
        button: "B",
        reason: "MenuPolicy: close unexpected menu-like state.",
        toolName: "mgba_tap",
      },
      expectedOutcome: "dialogue-progress",
      phase: detected.phase,
      policy: "menu",
      reason: "menu-like state is active",
      waypoint: detected.waypoint,
    };
  }

  if (state.mapId !== null && KNOWN_STAGE1_MAP_IDS.has(state.mapId)) {
    const decision = chooseKnownStage1Action({
      detected,
      observation,
      recentActions,
      state,
      stuckMemory,
    });
    if (decision) {
      return decision;
    }
  }

  return {
    phase: detected.phase,
    policy: "llm-fallback",
    reason: `no deterministic policy for mapId=${state.mapId ?? "unknown"}`,
    waypoint: detected.waypoint,
  };
}

function chooseIntroBootstrapAction(
  recentActions: readonly string[],
  detected: ReturnType<typeof detectPokemonPhase>
): DeterministicPolicyDecision | undefined {
  const bootstrapActions = recentActions.filter(
    (action) =>
      action.includes("tap") &&
      (action.includes('"button":"A"') || action.includes('"button":"Start"'))
  ).length;
  if (bootstrapActions >= INTRO_BOOTSTRAP_MAX_DETERMINISTIC_ACTIONS) {
    return;
  }
  const button = hasRecentTap(recentActions, "Start") ? "A" : "Start";
  return {
    action: {
      button,
      reason:
        "IntroBootstrapPolicy: RAM is unavailable before controllable overworld; advance title/intro dialogue without LLM.",
      toolName: "mgba_tap",
    },
    expectedOutcome: "dialogue-progress",
    phase: detected.phase === "unknown" ? "title_or_intro" : detected.phase,
    policy: "scripted-event",
    reason:
      "pre-overworld RAM unavailable; deterministic intro bootstrap has authority",
    waypoint: "reach-controllable-overworld",
  };
}

function chooseOakLabScriptAction(
  recentActions: readonly string[],
  detected: ReturnType<typeof detectPokemonPhase>
): DeterministicPolicyDecision | undefined {
  const repeatedA = recentTapCount(recentActions, "A");
  if (repeatedA >= OAK_LAB_MAX_DETERMINISTIC_A) {
    return {
      phase: detected.phase,
      policy: "llm-fallback",
      reason: `Oak Lab scripted flow received ${repeatedA} repeated A taps without transition; fallback analyst must inspect`,
      waypoint: detected.waypoint,
    };
  }
  return {
    action: {
      button: "A",
      reason:
        "ScriptedEventPolicy: Oak Lab intro/starter/rival dialogue is active or ambiguous; advance/confirm with A deterministically.",
      toolName: "mgba_tap",
    },
    expectedOutcome: "dialogue-progress",
    phase: detected.phase,
    policy: "scripted-event",
    reason:
      "Oak Lab mapId=40 is a known Stage 1 scripted segment; LLM should not drive one-step dialogue decisions",
    waypoint: detected.waypoint,
  };
}

function chooseKnownStage1Action({
  detected,
  observation,
  recentActions,
  state,
  stuckMemory,
}: {
  detected: ReturnType<typeof detectPokemonPhase>;
  observation: MgbaObservation;
  recentActions: readonly string[];
  state: NonNullable<MgbaObservation["state"]>;
  stuckMemory: StuckMemorySnapshot;
}): DeterministicPolicyDecision | undefined {
  const action = chooseStage1FastAction(observation, stuckMemory, {
    unknownFallback: "llm",
  });
  if (!action) {
    return;
  }
  if (action.toolName === "mgba_tap" && action.button === "A") {
    return (
      choosePalletOakTriggerAction({
        detected,
        recentActions,
        state,
        stuckMemory,
      }) ?? {
        policy: "llm-fallback",
        phase: detected.phase,
        reason:
          "known Stage 1 route exhausted movement candidates; fallback analyst must inspect unexpected event or collision state",
        waypoint: detected.waypoint,
      }
    );
  }
  return {
    action,
    expectedOutcome:
      action.toolName === "mgba_hold"
        ? "movement-or-map-change"
        : "dialogue-progress",
    phase: detected.phase,
    policy: "known-stage1-route",
    reason: `known Stage 1 mapId=${state.mapId}; deterministic controller has authority`,
    waypoint: detected.waypoint,
  };
}

function choosePalletOakTriggerAction({
  detected,
  recentActions,
  state,
  stuckMemory,
}: {
  detected: ReturnType<typeof detectPokemonPhase>;
  recentActions: readonly string[];
  state: NonNullable<MgbaObservation["state"]>;
  stuckMemory: StuckMemorySnapshot;
}): DeterministicPolicyDecision | undefined {
  if (!isPalletOakTriggerCandidate(state, stuckMemory)) {
    return;
  }
  const repeatedA = recentTapCount(recentActions, "A");
  if (repeatedA >= OAK_TRIGGER_MAX_DETERMINISTIC_A) {
    return {
      phase: detected.phase,
      policy: "llm-fallback",
      reason: `Oak trigger candidate received ${repeatedA} repeated A taps without transition; fallback analyst must inspect`,
      waypoint: detected.waypoint,
    };
  }
  return {
    action: {
      button: "A",
      reason:
        "ScriptedEventPolicy: Pallet north boundary/Oak trigger is blocking movement; advance forced Oak dialogue deterministically.",
      toolName: "mgba_tap",
    },
    expectedOutcome: "dialogue-progress",
    phase: detected.phase,
    policy: "scripted-event",
    reason:
      "Pallet north boundary movement is exhausted, matching the forced Oak introduction trigger",
    waypoint: detected.waypoint,
  };
}

function isPalletOakTriggerCandidate(
  state: NonNullable<MgbaObservation["state"]>,
  stuckMemory: StuckMemorySnapshot
): boolean {
  if (
    state.mapId !== POKEMON_RED_STAGE1_MAP_IDS.palletTown ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return false;
  }
  if (state.position.y > 2 || state.position.x < 8 || state.position.x > 12) {
    return false;
  }
  return (
    blockedAt(state, "Up", stuckMemory) ||
    stuckMemory.repeatedStateContexts.some(
      (context) =>
        context.attempts >= 3 &&
        context.context.includes(`map=${state.mapId}`) &&
        context.context.includes(`x=${state.position.x}`) &&
        context.context.includes(`y=${state.position.y}`)
    )
  );
}

function blockedAt(
  state: NonNullable<MgbaObservation["state"]>,
  button: string,
  stuckMemory: StuckMemorySnapshot
): boolean {
  return stuckMemory.failedMovementEdges.some(
    (edge) =>
      edge.attempts >= 3 &&
      edge.action === `hold:${button}` &&
      edge.context.includes(`map=${state.mapId}`) &&
      edge.context.includes(`x=${state.position.x}`) &&
      edge.context.includes(`y=${state.position.y}`)
  );
}

function recentTapCount(
  recentActions: readonly string[],
  button: string
): number {
  let count = 0;
  for (const action of [...recentActions].reverse()) {
    if (action.includes("tap") && action.includes(`"button":"${button}"`)) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function hasRecentTap(recentActions: readonly string[], button: string): boolean {
  return recentActions.some(
    (action) => action.includes("tap") && action.includes(`"button":"${button}"`)
  );
}
