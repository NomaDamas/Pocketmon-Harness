import {
  chooseBattlePolicyAction,
  selectBasicBattlePolicyForRivalEncounter,
} from "./battle-policy";
import { chooseNameEntryRecoveryAction } from "./name-entry-recovery";
import type { MgbaObservation } from "./observation";
import { detectPokemonPhase, type PokemonPhase } from "./phase-detector";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import {
  type AutopilotAction,
  chooseStage1FastAction,
} from "./stage1-fast-autopilot";
import {
  DEFAULT_POKEMON_RED_STARTER_PREFERENCE,
  type PokemonRedStarterControllerSequenceState,
  resolvePokemonRedStarterControllerSequenceState,
  resolvePokemonRedStarterPreference,
  resolvePokemonRedStarterSelectionPlan,
  resolvePokemonRedStarterSelectionState,
  type ValidatedPokemonRedStarterPreference,
} from "./starter-preference";
import type { StuckMemorySnapshot } from "./stuck-memory";
import {
  POST_ACTION_SETTLE_FRAMES,
  SETTLE_POLL_INTERVAL_MS,
} from "./supervisor";

const RED_HOUSE_1F_MAP_ID = 37;
const RED_HOUSE_2F_MAP_ID = 38;
const OAK_LAB_MAP_ID = 40;
const OAK_LAB_MAX_DETERMINISTIC_A = 10;
const OAK_TRIGGER_MAX_DETERMINISTIC_A = 6;
const INTRO_BOOTSTRAP_MAX_DETERMINISTIC_ACTIONS = 10;
const GENERIC_STUCK_INTERACTION_MAX_A = 1;
const GENERIC_STUCK_MOVEMENT_EDGE_THRESHOLD = 3;

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
  starterPreference?: string | null;
  stuckMemory: StuckMemorySnapshot;
}

export interface DeterministicPolicyDecision {
  action?: AutopilotAction;
  controllerRoutine?: DeterministicControllerRoutine;
  controllerState?: PokemonRedStarterControllerSequenceState;
  expectedOutcome?: DeterministicExpectedOutcome;
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

export interface DeterministicControllerRoutine {
  button: "A";
  checkpoints: readonly OakDialoguePhaseCheckpoint[];
  configuredMaxRepeatedInputs: number;
  expectedOutcome: "oak-dialogue-progress";
  name: "oak-dialogue-advance";
  repeatedInputsObserved: number;
  runtimeSource: "RuntimeGameState";
  settle: {
    pollIntervalMs: typeof SETTLE_POLL_INTERVAL_MS;
    strategy: "post-action-frame-settle";
    targetFrames: typeof POST_ACTION_SETTLE_FRAMES;
  };
}

export interface OakDialoguePhaseCheckpoint {
  readonly deterministicAdvance: "tap-a-and-settle";
  readonly expectedDialogueMarkers: readonly string[];
  readonly expectedGameplayStateIdentifiers: readonly string[];
  readonly expectedPostAdvanceMarkers: readonly string[];
  readonly id:
    | "oak-lab-script-dialogue"
    | "pallet-oak-forced-event"
    | "starter-selection-prompt";
  readonly phase: Extract<
    PokemonPhase,
    "lab_before_starter" | "oak_forced_walk_or_dialogue" | "starter_selection"
  >;
  readonly runtimeSource: "RuntimeGameState";
}

export const OAK_DIALOGUE_PHASE_CHECKPOINTS = {
  lab_before_starter: {
    deterministicAdvance: "tap-a-and-settle",
    expectedDialogueMarkers: [
      "state.dialogueLike=true",
      "Oak Lab scripted dialogue or confirmation prompt is active",
    ],
    expectedGameplayStateIdentifiers: [
      "state.readStatus=available",
      "state.mapId=40",
      "phase=lab_before_starter",
    ],
    expectedPostAdvanceMarkers: [
      "state.dialogueLike changes",
      "phase changes to starter_selection or rival_battle",
      "battle flag changes when rival battle opens",
    ],
    id: "oak-lab-script-dialogue",
    phase: "lab_before_starter",
    runtimeSource: "RuntimeGameState",
  },
  oak_forced_walk_or_dialogue: {
    deterministicAdvance: "tap-a-and-settle",
    expectedDialogueMarkers: [
      "state.dialogueLike=true",
      "or Pallet north boundary Oak trigger is blocked by repeated Up movement",
    ],
    expectedGameplayStateIdentifiers: [
      "state.readStatus=available",
      "state.mapId=0",
      "phase=oak_forced_walk_or_dialogue",
      "state.position.x=8..12",
      "state.position.y<=2",
    ],
    expectedPostAdvanceMarkers: [
      "state.dialogueLike changes",
      "player position changes during forced walk",
      "state.mapId changes to 40 when Oak Lab loads",
      "phase changes to lab_before_starter",
    ],
    id: "pallet-oak-forced-event",
    phase: "oak_forced_walk_or_dialogue",
    runtimeSource: "RuntimeGameState",
  },
  starter_selection: {
    deterministicAdvance: "tap-a-and-settle",
    expectedDialogueMarkers: [
      "state.dialogueLike=true",
      "starter confirmation prompt is active",
    ],
    expectedGameplayStateIdentifiers: [
      "state.readStatus=available",
      "state.mapId=40",
      "phase=starter_selection",
      "state.position.y=2",
      "state.position.x is configured starter Pokeball coordinate",
    ],
    expectedPostAdvanceMarkers: [
      "state.dialogueLike changes",
      "phase changes to lab_before_starter or rival_battle",
      "battle flag changes when rival battle opens",
    ],
    id: "starter-selection-prompt",
    phase: "starter_selection",
    runtimeSource: "RuntimeGameState",
  },
} as const satisfies Record<
  Extract<
    PokemonPhase,
    "lab_before_starter" | "oak_forced_walk_or_dialogue" | "starter_selection"
  >,
  OakDialoguePhaseCheckpoint
>;

type ControllerStateAction = AutopilotAction & {
  controllerState?: PokemonRedStarterControllerSequenceState;
};

export type DeterministicExpectedOutcome =
  | "battle-progress"
  | "dialogue-progress"
  | "movement-or-map-change"
  | "oak-dialogue-progress";

export function chooseDeterministicPolicyAction({
  observation,
  recentActions = [],
  starterPreference = DEFAULT_POKEMON_RED_STARTER_PREFERENCE,
  stuckMemory,
}: DeterministicPolicyInput): DeterministicPolicyDecision {
  const validatedStarterPreference =
    resolvePokemonRedStarterPreference(starterPreference);
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

  const battleDecision = chooseRivalBattlePhaseAction(state, detected);
  if (battleDecision) {
    return battleDecision;
  }

  const oakDialogueDecision = chooseOakDialogueAdvanceAction(
    state,
    recentActions,
    detected,
    validatedStarterPreference
  );
  if (oakDialogueDecision) {
    return oakDialogueDecision;
  }

  const oakLabDecision = chooseOakLabDeterministicAction({
    detected,
    recentActions,
    starterPreference: validatedStarterPreference,
    state,
    stuckMemory,
  });
  if (oakLabDecision) {
    return oakLabDecision;
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

function chooseRivalBattlePhaseAction(
  state: NonNullable<MgbaObservation["state"]>,
  detected: ReturnType<typeof detectPokemonPhase>
): DeterministicPolicyDecision | undefined {
  if (state.battle !== true) {
    return;
  }

  const battleAction = chooseBattlePolicyAction({
    battlePolicy: selectBasicBattlePolicyForRivalEncounter(),
    runtimeGameState: state,
  });
  if (!battleAction) {
    return {
      expectedOutcome: "battle-progress",
      phase: detected.phase,
      policy: "battle",
      reason:
        "BattlePolicy found no valid executable action for the current RAM battle UI; deterministic rival battle event is controller-owned and blocked for guarded recovery.",
      waypoint: detected.waypoint,
    };
  }

  return {
    action: {
      button: battleAction.buttons[0],
      buttons: battleAction.buttons,
      reason: battleAction.reason,
      toolName: "mgba_tap",
    },
    expectedOutcome: "battle-progress",
    phase: detected.phase,
    policy: "battle",
    reason: "rival battle phase is controller-owned by BattlePolicy",
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

function chooseOakDialogueAdvanceAction(
  state: NonNullable<MgbaObservation["state"]>,
  recentActions: readonly string[],
  detected: ReturnType<typeof detectPokemonPhase>,
  starterPreference: ValidatedPokemonRedStarterPreference
): DeterministicPolicyDecision | undefined {
  if (state.dialogueLike !== true || !isOakDialoguePhase(detected.phase)) {
    return;
  }
  const maxDeterministicA =
    state.mapId === OAK_LAB_MAP_ID
      ? OAK_LAB_MAX_DETERMINISTIC_A
      : OAK_TRIGGER_MAX_DETERMINISTIC_A;
  const repeatedA = recentTapCount(recentActions, "A");
  if (detected.phase === "starter_selection") {
    const starterConfirmation = chooseStarterSelectionConfirmAction(
      detected,
      state,
      starterPreference,
      "StarterSelectionPolicy: confirmed Oak Lab starter prompt is active; only confirm when RAM position matches the configured starter preference.",
      repeatedA
    );
    if (starterConfirmation) {
      return starterConfirmation;
    }
  }
  if (repeatedA >= maxDeterministicA) {
    if (detected.phase === "starter_selection") {
      return chooseStarterSelectionConfirmAction(
        detected,
        state,
        starterPreference,
        "StarterSelectionPolicy: repeated A presses remain controller-owned during starter selection; LLM fallback is disabled for this execution phase.",
        repeatedA
      );
    }
    return {
      action: {
        button: "A",
        reason:
          "OakDialogueAdvanceRoutine: repeated Oak dialogue verification reached the configured cap; invoke the bounded RuntimeGameState routine before any fallback analyst path is considered.",
        toolName: "mgba_tap",
      },
      controllerRoutine: createOakDialogueAdvanceRoutine({
        maxDeterministicA,
        phase: detected.phase,
        repeatedA,
      }),
      expectedOutcome: "oak-dialogue-progress",
      phase: detected.phase,
      policy: "scripted-event",
      reason: `Oak dialogue received ${repeatedA} repeated A taps without transition; deterministic Oak-dialogue advancement routine must run before fallback analyst consideration`,
      waypoint: detected.waypoint,
    };
  }
  return {
    action: {
      button: "A",
      reason:
        "ScriptedEventPolicy: confirmed Oak dialogue is active; advance it with A before considering LLM fallback.",
      toolName: "mgba_tap",
    },
    controllerRoutine: createOakDialogueAdvanceRoutine({
      maxDeterministicA,
      phase: detected.phase,
      repeatedA,
    }),
    expectedOutcome: "oak-dialogue-progress",
    phase: detected.phase,
    policy: "scripted-event",
    reason:
      "RAM/phase evidence identifies Oak dialogue; deterministic controller owns dialogue advance",
    waypoint: detected.waypoint,
  };
}

function isOakDialoguePhase(phase: PokemonPhase): boolean {
  return (
    phase === "oak_forced_walk_or_dialogue" ||
    phase === "lab_before_starter" ||
    phase === "starter_selection"
  );
}

function chooseOakLabDeterministicAction({
  detected,
  recentActions,
  starterPreference,
  state,
  stuckMemory,
}: {
  detected: ReturnType<typeof detectPokemonPhase>;
  recentActions: readonly string[];
  starterPreference: ValidatedPokemonRedStarterPreference;
  state: NonNullable<MgbaObservation["state"]>;
  stuckMemory: StuckMemorySnapshot;
}): DeterministicPolicyDecision | undefined {
  if (state.mapId !== OAK_LAB_MAP_ID) {
    return;
  }
  return chooseOakLabScriptAction(
    state,
    recentActions,
    detected,
    stuckMemory,
    starterPreference
  );
}

function chooseOakLabScriptAction(
  state: NonNullable<MgbaObservation["state"]>,
  recentActions: readonly string[],
  detected: ReturnType<typeof detectPokemonPhase>,
  stuckMemory: StuckMemorySnapshot,
  starterPreference: ValidatedPokemonRedStarterPreference
): DeterministicPolicyDecision | undefined {
  const repeatedA = recentTapCount(recentActions, "A");
  if (
    state.dialogueLike !== true &&
    state.menuLike !== true &&
    state.position.x !== null &&
    state.position.y !== null
  ) {
    const routeAction = chooseOakLabWaypointAction(
      state,
      stuckMemory,
      recentActions,
      starterPreference
    );
    if (routeAction) {
      const decision: DeterministicPolicyDecision = {
        action: routeAction,
        expectedOutcome:
          routeAction.toolName === "mgba_hold"
            ? "movement-or-map-change"
            : "dialogue-progress",
        phase: detected.phase,
        policy: "known-stage1-route",
        reason:
          "Oak Lab RAM position is available and no confirmed dialogue/menu is active; route to the next lab waypoint instead of spamming A.",
        waypoint: detected.waypoint,
      };
      if (routeAction.controllerState) {
        decision.controllerState = routeAction.controllerState;
      }
      return decision;
    }
    if (hasRecentTap(recentActions, "A")) {
      if (detected.phase === "starter_selection") {
        return chooseStarterSelectionConfirmAction(
          detected,
          state,
          starterPreference,
          "StarterSelectionPolicy: starter interaction did not yet verify progress; continue controller confirmation instead of invoking LLM fallback.",
          repeatedA
        );
      }
      return {
        phase: detected.phase,
        policy: "llm-fallback",
        reason:
          "Oak Lab waypoint movement and interaction both failed without RAM progress; fallback analyst must inspect the blocked script state.",
        waypoint: detected.waypoint,
      };
    }
  }
  if (repeatedA >= OAK_LAB_MAX_DETERMINISTIC_A) {
    if (detected.phase === "starter_selection") {
      return chooseStarterSelectionConfirmAction(
        detected,
        state,
        starterPreference,
        "StarterSelectionPolicy: Oak Lab starter selection exceeded the generic scripted A cap, but fallback remains disabled until RAM leaves starter selection.",
        repeatedA
      );
    }
    return {
      action: {
        button: "A",
        reason:
          "OakDialogueAdvanceRoutine: Oak Lab scripted flow reached the repeated-input cap; invoke the bounded RuntimeGameState routine before any fallback analyst path is considered.",
        toolName: "mgba_tap",
      },
      phase: detected.phase,
      controllerRoutine: createOakDialogueAdvanceRoutine({
        maxDeterministicA: OAK_LAB_MAX_DETERMINISTIC_A,
        phase: detected.phase,
        repeatedA,
      }),
      expectedOutcome: "oak-dialogue-progress",
      policy: "scripted-event",
      reason: `Oak Lab scripted flow received ${repeatedA} repeated A taps without transition; deterministic Oak-dialogue advancement routine must run before fallback analyst consideration`,
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
    controllerRoutine: createOakDialogueAdvanceRoutine({
      maxDeterministicA: OAK_LAB_MAX_DETERMINISTIC_A,
      phase: detected.phase,
      repeatedA,
    }),
    expectedOutcome: "oak-dialogue-progress",
    phase: detected.phase,
    policy: "scripted-event",
    reason:
      "Oak Lab mapId=40 is a known Stage 1 scripted segment; LLM should not drive one-step dialogue decisions",
    waypoint: detected.waypoint,
  };
}

function chooseOakLabWaypointAction(
  state: NonNullable<MgbaObservation["state"]>,
  stuckMemory: StuckMemorySnapshot,
  recentActions: readonly string[],
  starterPreference: ValidatedPokemonRedStarterPreference
): ControllerStateAction | undefined {
  const x = state.position.x;
  const y = state.position.y;
  if (x === null || y === null) {
    return;
  }
  const fixedStarterAction = chooseFixedStarterSequenceAction({
    recentActions,
    starterPreference,
    stuckMemory,
    state,
  });
  if (fixedStarterAction) {
    return fixedStarterAction;
  }
  const starterPlan = resolvePokemonRedStarterSelectionPlan(starterPreference, {
    x,
    y,
  });
  const starterState = resolvePokemonRedStarterSelectionState({
    starterPreference,
    state,
  });
  const starterWaypoint = starterPlan.waypoint;
  const targetX = starterWaypoint.x;
  const targetY = starterWaypoint.y;
  const sequenceText = starterPlan.sequenceButtons.join(" -> ");
  if (starterState.active) {
    return {
      button: "A",
      reason: `StarterSelectionPolicy: ${starterState.reason}; choose the ${starterWaypoint.label} Pokeball with A using controller state, not visual scene ambiguity.`,
      toolName: "mgba_tap",
    };
  }
  if (
    x < targetX &&
    !blockedAt(state, "Right", stuckMemory) &&
    recentHoldCount(recentActions, "Right") < 3
  ) {
    return {
      button: "Right",
      duration: 10,
      reason: `OakLabRoutePolicy: execute ${sequenceText} to reach and choose the ${starterWaypoint.label} Pokeball.`,
      toolName: "mgba_hold",
    };
  }
  if (
    x > targetX &&
    !blockedAt(state, "Left", stuckMemory) &&
    recentHoldCount(recentActions, "Left") < 3
  ) {
    return {
      button: "Left",
      duration: 10,
      reason: `OakLabRoutePolicy: execute ${sequenceText} to reach and choose the ${starterWaypoint.label} Pokeball.`,
      toolName: "mgba_hold",
    };
  }
  if (
    y > targetY &&
    !blockedAt(state, "Up", stuckMemory) &&
    recentHoldCount(recentActions, "Up") < 3
  ) {
    return {
      button: "Up",
      duration: 10,
      reason: `OakLabRoutePolicy: execute ${sequenceText} to reach and choose the ${starterWaypoint.label} Pokeball.`,
      toolName: "mgba_hold",
    };
  }
  if (
    y < targetY &&
    !blockedAt(state, "Down", stuckMemory) &&
    recentHoldCount(recentActions, "Down") < 3
  ) {
    return {
      button: "Down",
      duration: 10,
      reason: `OakLabRoutePolicy: execute ${sequenceText} to reach and choose the ${starterWaypoint.label} Pokeball.`,
      toolName: "mgba_hold",
    };
  }
  if (hasRecentTap(recentActions, "A")) {
    return;
  }
  return {
    button: "A",
    reason: `OakLabRoutePolicy: execute ${sequenceText} to reach and choose the ${starterWaypoint.label} Pokeball.`,
    toolName: "mgba_tap",
  };
}

function chooseFixedStarterSequenceAction({
  recentActions,
  starterPreference,
  stuckMemory,
  state,
}: {
  recentActions: readonly string[];
  starterPreference: ValidatedPokemonRedStarterPreference;
  stuckMemory: StuckMemorySnapshot;
  state: NonNullable<MgbaObservation["state"]>;
}): ControllerStateAction | undefined {
  const controllerState = resolvePokemonRedStarterControllerSequenceState({
    starterPreference,
    state,
  });
  if (!controllerState || controllerState.sequenceComplete) {
    return;
  }
  const step = controllerState.currentStep;
  if (!step) {
    return;
  }
  if (
    step.toolName === "mgba_hold" &&
    (blockedAt(state, step.button, stuckMemory) ||
      recentHoldCount(recentActions, step.button) >= 3)
  ) {
    return;
  }
  if (
    step.toolName === "mgba_tap" &&
    hasRecentTap(recentActions, step.button) &&
    !isStarterSelectionTapStep(step.button)
  ) {
    return;
  }
  return {
    button: step.button,
    controllerState,
    duration: step.duration,
    reason: `${step.reason} ${controllerState.reason}; using controller state, not visual scene ambiguity. Selected input sequence cursor=${controllerState.sequenceCursor}: ${controllerState.selectedInputSequence.join(" -> ")}. Fixed configured starter controller sequence: ${controllerState.selectedInputSequence.join(" -> ")}.`,
    toolName: step.toolName,
  };
}

function isStarterSelectionTapStep(button: string): boolean {
  return button === "A";
}

function chooseStarterSelectionConfirmAction(
  detected: ReturnType<typeof detectPokemonPhase>,
  state: NonNullable<MgbaObservation["state"]>,
  starterPreference: ValidatedPokemonRedStarterPreference,
  reason: string,
  repeatedA = 0
): DeterministicPolicyDecision | undefined {
  const starterState = resolvePokemonRedStarterSelectionState({
    starterPreference,
    state,
  });
  if (!starterState.active) {
    return {
      action: {
        button: "B",
        reason: `StarterSelectionPolicy: RAM is at a starter-selection coordinate, but it is not the configured ${starterState.target.label} waypoint; cancel/decline this prompt before deterministic routing chooses the configured starter.`,
        toolName: "mgba_tap",
      },
      expectedOutcome: "dialogue-progress",
      phase: detected.phase,
      policy: "menu",
      reason:
        "configured starter preference does not match the current Oak Lab Pokeball RAM position",
      waypoint: "advance-oak-lab-script",
    };
  }
  const controllerState = resolvePokemonRedStarterControllerSequenceState({
    starterPreference,
    state,
  });
  return {
    action: {
      button: "A",
      reason: `${reason} ${starterState.reason}; choose the ${starterState.target.label} Pokeball.`,
      toolName: "mgba_tap",
    },
    ...(controllerState ? { controllerState } : {}),
    controllerRoutine: createOakDialogueAdvanceRoutine({
      maxDeterministicA: OAK_LAB_MAX_DETERMINISTIC_A,
      phase: detected.phase,
      repeatedA,
    }),
    expectedOutcome: "oak-dialogue-progress",
    phase: detected.phase,
    policy: "scripted-event",
    reason:
      "starter_selection is a deterministic controller execution phase; LLM fallback is disabled until RAM/phase leaves starter selection",
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
  if (state.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity) {
    return {
      expectedOutcome: "movement-or-map-change",
      phase: detected.phase,
      policy: "known-stage1-route",
      reason:
        "RuntimeGameState reports Viridian City; Stage 1 route movement is complete and no LLM fallback is needed.",
      waypoint: detected.waypoint,
    };
  }
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
      }) ??
      chooseGenericStuckInteractionAction({
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

function chooseGenericStuckInteractionAction({
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
  if (failedMovementEdgeCountAt(state, stuckMemory) < 3) {
    return;
  }
  const repeatedA = recentTapCount(recentActions, "A");
  if (repeatedA >= GENERIC_STUCK_INTERACTION_MAX_A) {
    return {
      phase: detected.phase,
      policy: "llm-fallback",
      reason:
        "generic stuck interaction recovery already tried A without verified progress; fallback analyst must inspect",
      waypoint: detected.waypoint,
    };
  }
  return {
    action: {
      button: "A",
      reason:
        "GenericStuckInteractionPolicy: multiple movement edges failed at the same RAM state; interact once before handing control to LLM.",
      toolName: "mgba_tap",
    },
    expectedOutcome: "dialogue-progress",
    phase: detected.phase,
    policy: "dialogue",
    reason:
      "same-state movement exhausted; deterministic controller tests one interaction before fallback",
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
      action: {
        button: "A",
        reason:
          "OakDialogueAdvanceRoutine: Pallet Oak trigger reached the repeated-input cap; invoke the bounded RuntimeGameState routine before any fallback analyst path is considered.",
        toolName: "mgba_tap",
      },
      controllerRoutine: createOakDialogueAdvanceRoutine({
        maxDeterministicA: OAK_TRIGGER_MAX_DETERMINISTIC_A,
        phase: detected.phase,
        repeatedA,
      }),
      expectedOutcome: "oak-dialogue-progress",
      phase: detected.phase,
      policy: "scripted-event",
      reason: `Oak trigger candidate received ${repeatedA} repeated A taps without transition; deterministic Oak-dialogue advancement routine must run before fallback analyst consideration`,
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
    controllerRoutine: createOakDialogueAdvanceRoutine({
      maxDeterministicA: OAK_TRIGGER_MAX_DETERMINISTIC_A,
      phase: detected.phase,
      repeatedA,
    }),
    expectedOutcome: "oak-dialogue-progress",
    phase: detected.phase,
    policy: "scripted-event",
    reason:
      "Pallet north boundary movement is exhausted, matching the forced Oak introduction trigger",
    waypoint: detected.waypoint,
  };
}

function createOakDialogueAdvanceRoutine({
  maxDeterministicA,
  phase,
  repeatedA,
}: {
  maxDeterministicA: number;
  phase: PokemonPhase;
  repeatedA: number;
}): DeterministicControllerRoutine {
  const checkpoint = getOakDialoguePhaseCheckpoint(phase);
  return {
    button: "A",
    checkpoints: checkpoint ? [checkpoint] : [],
    configuredMaxRepeatedInputs: maxDeterministicA,
    expectedOutcome: "oak-dialogue-progress",
    name: "oak-dialogue-advance",
    repeatedInputsObserved: repeatedA,
    runtimeSource: "RuntimeGameState",
    settle: {
      pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
      strategy: "post-action-frame-settle",
      targetFrames: POST_ACTION_SETTLE_FRAMES,
    },
  };
}

export function getOakDialoguePhaseCheckpoint(
  phase: PokemonPhase
): OakDialoguePhaseCheckpoint | undefined {
  if (!isOakDialogueCheckpointPhase(phase)) {
    return;
  }
  return OAK_DIALOGUE_PHASE_CHECKPOINTS[phase];
}

function isOakDialogueCheckpointPhase(
  phase: PokemonPhase
): phase is OakDialoguePhaseCheckpoint["phase"] {
  return (
    phase === "lab_before_starter" ||
    phase === "oak_forced_walk_or_dialogue" ||
    phase === "starter_selection"
  );
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

function failedMovementEdgeCountAt(
  state: NonNullable<MgbaObservation["state"]>,
  stuckMemory: StuckMemorySnapshot
): number {
  return stuckMemory.failedMovementEdges.filter(
    (edge) =>
      edge.attempts >= GENERIC_STUCK_MOVEMENT_EDGE_THRESHOLD &&
      edge.context.includes(`map=${state.mapId}`) &&
      edge.context.includes(`x=${state.position.x}`) &&
      edge.context.includes(`y=${state.position.y}`)
  ).length;
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

function recentHoldCount(
  recentActions: readonly string[],
  button: string
): number {
  return recentActions.filter(
    (action) =>
      action.includes("hold") && action.includes(`"button":"${button}"`)
  ).length;
}

function hasRecentTap(
  recentActions: readonly string[],
  button: string
): boolean {
  return recentActions.some(
    (action) =>
      action.includes("tap") && action.includes(`"button":"${button}"`)
  );
}
