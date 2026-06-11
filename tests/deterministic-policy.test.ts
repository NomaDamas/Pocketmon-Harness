import { describe, expect, it, vi } from "vitest";
import { chooseBattlePolicyAction } from "../src/battle-policy";
import {
  chooseDeterministicPolicyAction,
  OAK_DIALOGUE_PHASE_CHECKPOINTS,
} from "../src/deterministic-policy";
import {
  createBoundedLlmFallbackInvocationEvent,
  LlmFallbackGate,
} from "../src/fallback-gate";
import type { MgbaObservation } from "../src/observation";
import type {
  PokemonBattleActionState,
  PokemonStateObservation,
} from "../src/pokemon-state";
import { POKEMON_RED_STAGE1_MAP_IDS } from "../src/stage1-evaluator";
import {
  POKEMON_RED_STARTER_PREFERENCES,
  type PokemonRedStarterPreference,
  type PokemonRedStarterSelectionPlan,
  resolvePokemonRedStarterSelectionPlan,
} from "../src/starter-preference";
import {
  POST_ACTION_SETTLE_FRAMES,
  SETTLE_POLL_INTERVAL_MS,
} from "../src/supervisor";
import {
  RIVAL_BATTLE_STATE_FIXTURES,
  rivalBattleObservation,
} from "./fixtures/rival-battle-states";

type DeterministicPolicyAction = NonNullable<
  ReturnType<typeof chooseDeterministicPolicyAction>["action"]
>;
type DeterministicPolicyDecision = ReturnType<
  typeof chooseDeterministicPolicyAction
>;

interface StarterSelectionTraceEntry {
  button: string;
  phase: string;
  policy: string;
  selectedInputSequence: readonly string[];
  toolName: string;
  waypoint: string;
}

const baseState: PokemonStateObservation = {
  battle: false,
  battleResult: null,
  battleType: null,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: 38,
  menuLike: "visual-fallback",
  position: { x: 3, y: 1 },
  readStatus: "available",
};

const emptyStuckMemory = {
  failedMovementEdges: [],
  recentRecoveryAttempts: [],
  repeatedStateContexts: [],
  stuckEvents: 0,
};

const battleActionState: PokemonBattleActionState = {
  canRun: true,
  items: [],
  moves: [{ moveId: 33, name: "Tackle", pp: 35, slot: 1 }],
  party: [],
  readStatus: "available",
  ui: {
    cursorIndex: 0,
    mode: "main-menu",
    source: "ram",
  },
};

function observation(state: PokemonStateObservation): MgbaObservation {
  return {
    screenshot: {
      data: "screen",
      mediaType: "image/png",
      path: "/tmp/screen.png",
    },
    state,
    status: {
      activeButtons: [],
      frame: 1,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    },
  };
}

function starterSelectionPositions(
  plan: PokemonRedStarterSelectionPlan
): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const current = {
    x: plan.approachFrom.x,
    y: plan.approachFrom.y,
  };

  for (const step of plan.sequence) {
    positions.push({ ...current });
    if (step.toolName !== "mgba_hold") {
      continue;
    }
    switch (step.button) {
      case "Down":
        current.y += 1;
        break;
      case "Left":
        current.x -= 1;
        break;
      case "Right":
        current.x += 1;
        break;
      case "Up":
        current.y -= 1;
        break;
      default:
        break;
    }
  }

  return positions;
}

function actionLogEntry(action: DeterministicPolicyAction): string {
  if (action.toolName === "mgba_hold") {
    return `hold: {"button":"${action.button}","duration":${action.duration ?? 10}}`;
  }
  return `tap: {"button":"${action.button}"}`;
}

function selectedStarterFromReason(
  reason: string
): PokemonRedStarterPreference {
  for (const preference of POKEMON_RED_STARTER_PREFERENCES) {
    if (reason.toLowerCase().includes(`${preference} starter`)) {
      return preference;
    }
  }
  throw new Error(`Unable to resolve selected starter from reason: ${reason}`);
}

function simulateStarterSelectionRun(
  preference: PokemonRedStarterPreference,
  fallbackAnalyst?: (decision: DeterministicPolicyDecision) => void
): {
  actionTrace: StarterSelectionTraceEntry[];
  selectedStarter: PokemonRedStarterPreference;
} {
  const plan = resolvePokemonRedStarterSelectionPlan(preference);
  const recentActions: string[] = [];
  const actionTrace: StarterSelectionTraceEntry[] = [];
  let selectedStarter: PokemonRedStarterPreference | undefined;
  let starterPromptOpen = false;

  for (const position of starterSelectionPositions(plan)) {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: starterPromptOpen ? true : "visual-fallback",
        mapId: 40,
        menuLike: "visual-fallback",
        position,
      }),
      recentActions,
      starterPreference: preference,
      stuckMemory: emptyStuckMemory,
    });

    if (decision.policy === "llm-fallback") {
      fallbackAnalyst?.(decision);
    }
    expect(decision.policy).not.toBe("llm-fallback");
    expect(decision.action).toBeDefined();
    const action = decision.action;
    if (!action) {
      throw new Error("Starter selection policy did not return an action");
    }

    actionTrace.push({
      button: action.button,
      phase: decision.phase,
      policy: decision.policy,
      selectedInputSequence:
        decision.controllerState?.selectedInputSequence ?? [],
      toolName: action.toolName,
      waypoint: decision.waypoint,
    });
    if (action.toolName === "mgba_tap" && action.button === "A") {
      selectedStarter = selectedStarterFromReason(action.reason);
      starterPromptOpen = true;
    }
    recentActions.push(actionLogEntry(action));
  }

  if (!selectedStarter) {
    throw new Error(`No starter selection tap emitted for ${preference}`);
  }

  return {
    actionTrace,
    selectedStarter,
  };
}

function executeKnownPalletToViridianRoute({
  maxSteps,
}: {
  maxSteps: number;
}): {
  decisions: DeterministicPolicyDecision[];
  finalState: PokemonStateObservation;
  steps: number;
} {
  let runtimeGameState: PokemonStateObservation = {
    ...baseState,
    mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
    position: { x: 10, y: 12 },
    readStatus: "available",
  };
  const recentActions: string[] = [];
  const decisions: DeterministicPolicyDecision[] = [];

  for (let step = 1; step <= maxSteps; step += 1) {
    const decision = chooseDeterministicPolicyAction({
      observation: observation(runtimeGameState),
      recentActions,
      stuckMemory: emptyStuckMemory,
    });
    decisions.push(decision);

    if (decision.policy === "llm-fallback") {
      return { decisions, finalState: runtimeGameState, steps: step };
    }
    if (!decision.action) {
      return { decisions, finalState: runtimeGameState, steps: step };
    }

    recentActions.push(actionLogEntry(decision.action));
    runtimeGameState = applyKnownRouteAction(runtimeGameState, decision.action);
  }

  return { decisions, finalState: runtimeGameState, steps: maxSteps };
}

function applyKnownRouteAction(
  runtimeGameState: PokemonStateObservation,
  action: DeterministicPolicyAction
): PokemonStateObservation {
  if (action.toolName !== "mgba_hold") {
    return runtimeGameState;
  }

  const { mapId, position } = runtimeGameState;
  if (mapId === POKEMON_RED_STAGE1_MAP_IDS.palletTown) {
    if (action.button === "Right") {
      return stateAt(mapId, Math.min((position.x ?? 0) + 1, 10), position.y);
    }
    if (action.button === "Left") {
      return stateAt(mapId, Math.max((position.x ?? 0) - 1, 0), position.y);
    }
    if (action.button === "Up" && position.y === 0) {
      return stateAt(POKEMON_RED_STAGE1_MAP_IDS.route1, 10, 35);
    }
    if (action.button === "Up") {
      return stateAt(mapId, position.x, Math.max((position.y ?? 0) - 1, 0));
    }
    if (action.button === "Down") {
      return stateAt(mapId, position.x, (position.y ?? 0) + 1);
    }
  }

  if (mapId === POKEMON_RED_STAGE1_MAP_IDS.route1) {
    if (action.button === "Up" && position.y === 0) {
      return stateAt(POKEMON_RED_STAGE1_MAP_IDS.viridianCity, 10, 30);
    }
    if (action.button === "Up") {
      return stateAt(mapId, position.x, Math.max((position.y ?? 0) - 1, 0));
    }
    if (action.button === "Left") {
      return stateAt(mapId, Math.max((position.x ?? 0) - 1, 0), position.y);
    }
    if (action.button === "Right") {
      return stateAt(mapId, (position.x ?? 0) + 1, position.y);
    }
    if (action.button === "Down") {
      return stateAt(mapId, position.x, (position.y ?? 0) + 1);
    }
  }

  return runtimeGameState;
}

function stateAt(
  mapId: number,
  x: number | null,
  y: number | null
): PokemonStateObservation {
  return {
    ...baseState,
    mapId,
    position: { x, y },
    readStatus: "available",
  };
}

describe("chooseDeterministicPolicyAction", () => {
  it("chooses the Red bedroom stair route without LLM fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 38,
        position: { x: 5, y: 1 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Right",
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
  });

  it("avoids walking into the bedroom SNES lane from the initial lower-left position", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 38,
        position: { x: 3, y: 6 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Down",
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
  });

  it("escapes the blocked bedroom left wall instead of oscillating Up and Down", () => {
    for (const y of [4, 5]) {
      const decision = chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId: 38,
          position: { x: 0, y },
        }),
        stuckMemory: emptyStuckMemory,
      });

      expect(decision).toMatchObject({
        action: {
          button: "Right",
          toolName: "mgba_hold",
        },
        policy: "known-stage1-route",
      });
    }
  });

  it("crosses right from the lower bedroom row instead of returning to the blocked left wall", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 38,
        position: { x: 1, y: 7 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Right",
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
  });

  it("chooses the Red house 1F exit route without LLM fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 37,
        position: { x: 7, y: 4 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Down",
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
  });

  it("replays RuntimeGameState mapId 38 -> 37 -> 0 with zero LLM fallback calls", () => {
    const fallbackAnalyst = vi.fn((_: DeterministicPolicyDecision) => {
      throw new Error("known Stage 1 house route must not invoke LLM fallback");
    });
    const replay = [
      {
        expectedButton: "Right",
        mapId: 38,
        position: { x: 5, y: 1 },
      },
      {
        expectedButton: "Down",
        mapId: 37,
        position: { x: 7, y: 4 },
      },
      {
        expectedButton: "Right",
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        position: { x: 2, y: 7 },
      },
    ] as const;

    const decisions = replay.map(({ mapId, position }) =>
      chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId,
          position,
          readStatus: "available",
        }),
        stuckMemory: emptyStuckMemory,
      })
    );

    for (const decision of decisions) {
      if (decision.policy === "llm-fallback") {
        fallbackAnalyst(decision);
      }
    }

    expect(replay.map((entry) => entry.mapId)).toEqual([38, 37, 0]);
    expect(decisions.map((decision) => decision.policy)).toEqual([
      "known-stage1-route",
      "known-stage1-route",
      "known-stage1-route",
    ]);
    expect(decisions.map((decision) => decision.action?.button)).toEqual(
      replay.map((entry) => entry.expectedButton)
    );
    expect(
      decisions.every((decision) => decision.action?.toolName === "mgba_hold")
    ).toBe(true);
    expect(fallbackAnalyst).not.toHaveBeenCalled();
  });

  it("replays RuntimeGameState from Red house through Viridian City with zero LLM fallback calls", () => {
    const fallbackAnalyst = vi.fn((_: DeterministicPolicyDecision) => {
      throw new Error(
        "known Stage 1 route replay must not invoke LLM fallback"
      );
    });
    const replay = [
      {
        expectedButton: "Right",
        expectedPhase: "bedroom_2f",
        mapId: 38,
        position: { x: 5, y: 1 },
      },
      {
        expectedButton: "Down",
        expectedPhase: "house_1f",
        mapId: 37,
        position: { x: 7, y: 4 },
      },
      {
        expectedButton: "Right",
        expectedPhase: "pallet_before_oak",
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        position: { x: 2, y: 7 },
      },
      {
        expectedButton: "Up",
        expectedPhase: "pallet_before_oak",
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        position: { x: 10, y: 12 },
      },
      {
        expectedButton: "Up",
        expectedPhase: "route1",
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: { x: 10, y: 35 },
      },
      {
        expectedButton: "Up",
        expectedPhase: "route1",
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: { x: 10, y: 20 },
      },
      {
        expectedButton: "Up",
        expectedPhase: "route1",
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: { x: 10, y: 0 },
      },
      {
        expectedButton: undefined,
        expectedPhase: "viridian",
        mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
        position: { x: 10, y: 30 },
      },
    ] as const;

    const decisions = replay.map(({ mapId, position }) =>
      chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId,
          position,
          readStatus: "available",
        }),
        stuckMemory: emptyStuckMemory,
      })
    );

    for (const decision of decisions) {
      if (decision.policy === "llm-fallback") {
        fallbackAnalyst(decision);
      }
    }

    expect(replay.map((entry) => entry.mapId)).toEqual([
      38, 37, 0, 0, 12, 12, 12, 1,
    ]);
    expect(decisions.map((decision) => decision.policy)).toEqual(
      Array.from({ length: replay.length }, () => "known-stage1-route")
    );
    expect(decisions.map((decision) => decision.phase)).toEqual(
      replay.map((entry) => entry.expectedPhase)
    );
    expect(decisions.map((decision) => decision.action?.button)).toEqual(
      replay.map((entry) => entry.expectedButton)
    );
    expect(decisions.at(-1)?.action).toBeUndefined();
    expect(decisions.at(-1)).toMatchObject({
      expectedOutcome: "movement-or-map-change",
      phase: "viridian",
      policy: "known-stage1-route",
      waypoint: "stage1-complete",
    });
    expect(fallbackAnalyst).not.toHaveBeenCalled();
  });

  it("executes the known Pallet-to-Viridian route to completion without invoking the LLM", () => {
    const fallbackAnalyst = vi.fn((_: DeterministicPolicyDecision) => {
      throw new Error("known route execution must not invoke LLM fallback");
    });

    const run = executeKnownPalletToViridianRoute({ maxSteps: 50 });

    for (const decision of run.decisions) {
      if (decision.policy === "llm-fallback") {
        fallbackAnalyst(decision);
      }
    }

    expect(fallbackAnalyst).not.toHaveBeenCalled();
    expect(run.steps).toBeLessThanOrEqual(50);
    expect(run.finalState).toMatchObject({
      mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      position: { x: 10, y: 30 },
      readStatus: "available",
    });
    expect(run.decisions.at(-1)?.action).toBeUndefined();
    expect(run.decisions.at(-1)).toMatchObject({
      phase: "viridian",
      policy: "known-stage1-route",
      reason: expect.stringContaining("RuntimeGameState reports Viridian City"),
      waypoint: "stage1-complete",
    });
    expect(run.decisions.map((decision) => decision.policy)).not.toContain(
      "llm-fallback"
    );
    expect(
      run.decisions
        .slice(0, -1)
        .every((decision) => decision.action?.toolName === "mgba_hold")
    ).toBe(true);
  });

  it("aligns left on Red house 1F upper row before descending", () => {
    for (const position of [
      { x: 7, y: 1 },
      { x: 4, y: 3 },
    ]) {
      const decision = chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId: 37,
          position,
        }),
        stuckMemory: emptyStuckMemory,
      });

      expect(decision).toMatchObject({
        action: {
          button: "Left",
          toolName: "mgba_hold",
        },
        policy: "known-stage1-route",
      });
    }
  });

  it("keeps LLM fallback out of known Route 1 pathfinding", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 12,
        position: { x: 10, y: 18 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Up",
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
  });

  it("requires LLM fallback only for unknown RAM maps", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 99,
        position: { x: 1, y: 1 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("llm-fallback");
    expect(decision.action).toBeUndefined();
  });

  it("routes bounded LLM fallback invocation only when route/action resolution is unknown", () => {
    const fallbackAnalyst = vi.fn(
      (_event: ReturnType<typeof createBoundedLlmFallbackInvocationEvent>) =>
        undefined
    );
    const fallbackGate = new LlmFallbackGate({ maxAttemptsPerEdge: 1 });
    const resolvedRouteDecisions = [
      chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId: 38,
          position: { x: 5, y: 1 },
          readStatus: "available",
        }),
        stuckMemory: emptyStuckMemory,
      }),
      chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
          position: { x: 10, y: 18 },
          readStatus: "available",
        }),
        stuckMemory: emptyStuckMemory,
      }),
      chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
          position: { x: 10, y: 30 },
          readStatus: "available",
        }),
        stuckMemory: emptyStuckMemory,
      }),
    ];

    for (const decision of resolvedRouteDecisions) {
      if (decision.policy === "llm-fallback") {
        const admission = fallbackGate.beginInvocation({ decision });
        if (!("allowed" in admission || "recoveryAction" in admission)) {
          fallbackAnalyst(
            createBoundedLlmFallbackInvocationEvent({
              admission,
              decision,
            })
          );
        }
      }
    }

    expect(resolvedRouteDecisions).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({
          button: "Right",
          toolName: "mgba_hold",
        }),
        policy: "known-stage1-route",
      }),
      expect.objectContaining({
        action: expect.objectContaining({
          button: "Up",
          toolName: "mgba_hold",
        }),
        policy: "known-stage1-route",
      }),
      expect.objectContaining({
        phase: "viridian",
        policy: "known-stage1-route",
        waypoint: "stage1-complete",
      }),
    ]);
    expect(resolvedRouteDecisions.at(-1)?.action).toBeUndefined();
    expect(fallbackAnalyst).not.toHaveBeenCalled();

    const unknownRouteDecision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 99,
        position: { x: 1, y: 1 },
        readStatus: "available",
      }),
      stuckMemory: emptyStuckMemory,
    });
    expect(unknownRouteDecision).toMatchObject({
      phase: "unknown",
      policy: "llm-fallback",
      reason: "no deterministic policy for mapId=99",
      waypoint: "fallback-analysis",
    });
    expect(unknownRouteDecision.action).toBeUndefined();

    const admission = fallbackGate.beginInvocation({
      decision: unknownRouteDecision,
    });
    if ("allowed" in admission || "recoveryAction" in admission) {
      throw new Error("unknown route/action resolution should admit fallback");
    }
    const event = createBoundedLlmFallbackInvocationEvent({
      admission,
      decision: unknownRouteDecision,
    });
    fallbackAnalyst(event);

    expect(fallbackAnalyst).toHaveBeenCalledTimes(1);
    expect(fallbackAnalyst).toHaveBeenCalledWith(
      expect.objectContaining({
        controlOwner: "llm-fallback",
        directControl: false,
        phase: "unknown",
        policy: "llm-fallback",
        reason: "no deterministic policy for mapId=99",
        type: "llm-fallback-invocation",
        validationReason: expect.stringContaining(
          "deterministic controller gap"
        ),
        waypoint: "fallback-analysis",
      })
    );
  });

  it("uses BasicBattlePolicy for valid battle actions before LLM fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        battle: true,
        battleActionState,
        battleType: 1,
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        reason: expect.stringContaining("move slot 1"),
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      policy: "battle",
    });
    expect(decision.action?.buttons).toEqual(["A"]);
  });

  it("preserves the full BasicBattlePolicy button sequence for battle execution", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        battle: true,
        battleActionState: {
          ...battleActionState,
          ui: {
            cursorIndex: 3,
            mode: "main-menu",
            source: "ram",
          },
        },
        battleType: 1,
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Up",
        buttons: ["Up", "Up", "Up", "A"],
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      policy: "battle",
    });
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES
  )("uses BattlePolicy as the sole rival battle action selector for $id", (fixture) => {
    const battlePolicyAction = chooseBattlePolicyAction({
      runtimeGameState: fixture.runtimeGameState,
    });
    const decision = chooseDeterministicPolicyAction({
      observation: rivalBattleObservation(fixture.runtimeGameState),
      stuckMemory: emptyStuckMemory,
    });

    if (!battlePolicyAction) {
      expect(decision.policy).toBe("battle");
      expect(decision.action).toBeUndefined();
      expect(decision.expectedOutcome).toBe("battle-progress");
      expect(decision.reason).toContain("BattlePolicy");
      expect(decision.reason).not.toContain("fallback");
      return;
    }

    expect(decision).toMatchObject({
      action: {
        button: battlePolicyAction.buttons[0],
        buttons: battlePolicyAction.buttons,
        reason: battlePolicyAction.reason,
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      phase: "rival_battle",
      policy: "battle",
    });
    expect(decision.policy).not.toBe("llm-fallback");
    expect(decision.reason).toContain("BattlePolicy");
    expect(decision.reason).not.toContain("fallback");
    expect(decision.action?.reason).not.toContain("fallback");
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES.filter(
      (fixture) => "buttons" in fixture.expectedDecision
    )
  )("sources supported rival battle controls from BattlePolicy instead of fallback or ad hoc selectors for $id", (fixture) => {
    const battlePolicyAction = chooseBattlePolicyAction({
      runtimeGameState: fixture.runtimeGameState,
    });
    const decision = chooseDeterministicPolicyAction({
      observation: rivalBattleObservation(fixture.runtimeGameState),
      stuckMemory: emptyStuckMemory,
    });

    expect(battlePolicyAction).toBeDefined();
    if (!battlePolicyAction) {
      return;
    }

    expect(decision.policy).toBe("battle");
    expect(decision.reason).toBe(
      "rival battle phase is controller-owned by BattlePolicy"
    );
    expect(decision.action).toStrictEqual({
      button: battlePolicyAction.buttons[0],
      buttons: battlePolicyAction.buttons,
      reason: battlePolicyAction.reason,
      toolName: "mgba_tap",
    });

    const decisionText = [decision.reason, decision.action?.reason]
      .join(" ")
      .toLowerCase();
    expect(decisionText).toContain("battlepolicy");
    for (const adHocSelectorSignal of [
      "fallback",
      "pathfinder",
      "scripted",
      "dialogue",
      "default battle tap",
      "advance visible state",
      "close menu-like state",
      "probe",
    ]) {
      expect(decisionText).not.toContain(adHocSelectorSignal);
    }
  });

  it("does not issue a default battle tap when no valid executable battle action exists", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        battle: true,
        battleActionState: {
          ...battleActionState,
          ui: {
            cursorIndex: null,
            mode: "unknown",
            source: "ram",
          },
        },
        battleType: 1,
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("battle");
    expect(decision.action).toBeUndefined();
    expect(decision.expectedOutcome).toBe("battle-progress");
    expect(decision.reason).toContain("no valid executable action");
    expect(decision.reason).toContain("deterministic rival battle event");
    expect(decision.reason).toContain("controller-owned");
    expect(decision.reason).not.toContain("fallback");
  });

  it("bootstraps title or intro screens without LLM when RAM is unavailable", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: null,
        position: { x: null, y: null },
        readStatus: "unavailable",
      }),
      recentActions: [],
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("scripted-event");
    expect(decision.phase).toBe("title_or_intro");
    expect(decision.waypoint).toBe("reach-controllable-overworld");
    expect(decision.action).toMatchObject({
      button: "Start",
      toolName: "mgba_tap",
    });
  });

  it("continues intro bootstrap with A after Start has been tried", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: null,
        position: { x: null, y: null },
        readStatus: "unavailable",
      }),
      recentActions: ['tap: {"button":"Start"}'],
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("scripted-event");
    expect(decision.action).toMatchObject({
      button: "A",
      toolName: "mgba_tap",
    });
  });

  it("does not alternate back to Start after intro A presses", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: null,
        position: { x: null, y: null },
        readStatus: "unavailable",
      }),
      recentActions: ['tap: {"button":"Start"}', 'tap: {"button":"A"}'],
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.action).toMatchObject({
      button: "A",
      toolName: "mgba_tap",
    });
  });

  it("hands intro bootstrap to fallback after repeated no-RAM actions", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: null,
        position: { x: null, y: null },
        readStatus: "unavailable",
      }),
      recentActions: [
        'tap: {"button":"Start"}',
        ...Array.from({ length: 9 }, () => 'tap: {"button":"A"}'),
      ],
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("llm-fallback");
    expect(decision.action).toBeUndefined();
  });

  it("routes inside Oak Lab before interacting when no confirmed dialogue is active", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 5, y: 3 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Left",
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
  });

  it("uses the deterministic default starter target when no preference is configured", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 5, y: 3 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Left",
        reason: expect.stringContaining("center Charmander starter"),
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
  });

  it("routes to the configured Oak Lab starter preference", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 5, y: 3 },
      }),
      starterPreference: " Squirtle ",
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Right",
        toolName: "mgba_hold",
      },
      policy: "known-stage1-route",
    });
    expect(decision.action?.reason).toContain("Right -> Up -> A -> A");
    expect(decision.action?.reason).toContain("right Squirtle starter");
  });

  it.each([
    {
      position: { x: 5, y: 3 },
      preference: "bulbasaur",
      sequence: "Left -> Left -> Left -> Up -> A -> A",
      expectedButton: "Left",
    },
    {
      position: { x: 4, y: 3 },
      preference: "bulbasaur",
      sequence: "Left -> Left -> Left -> Up -> A -> A",
      expectedButton: "Left",
    },
    {
      position: { x: 3, y: 3 },
      preference: "bulbasaur",
      sequence: "Left -> Left -> Left -> Up -> A -> A",
      expectedButton: "Left",
    },
    {
      position: { x: 2, y: 3 },
      preference: "bulbasaur",
      sequence: "Left -> Left -> Left -> Up -> A -> A",
      expectedButton: "Up",
    },
    {
      position: { x: 2, y: 2 },
      preference: "bulbasaur",
      sequence: "Left -> Left -> Left -> Up -> A -> A",
      expectedButton: "A",
    },
    {
      position: { x: 4, y: 3 },
      preference: "charmander",
      sequence: "Left -> Up -> A -> A",
      expectedButton: "Up",
    },
    {
      position: { x: 6, y: 3 },
      preference: "squirtle",
      sequence: "Right -> Up -> A -> A",
      expectedButton: "Up",
    },
  ])("follows the fixed $preference starter sequence at RAM position $position.x,$position.y", ({
    expectedButton,
    position,
    preference,
    sequence,
  }) => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position,
      }),
      starterPreference: preference,
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: expectedButton,
      },
      policy: "known-stage1-route",
    });
    expect(decision.action?.reason).toContain(
      `Fixed configured starter controller sequence: ${sequence}`
    );
  });

  it("chooses the starter from explicit RAM phase/controller state without visual ambiguity", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: "visual-fallback",
        mapId: 40,
        menuLike: "visual-fallback",
        position: { x: 4, y: 2 },
      }),
      starterPreference: "charmander",
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        reason: expect.stringContaining("RAM mapId=40 x=4 y=2"),
        toolName: "mgba_tap",
      },
      phase: "starter_selection",
      policy: "known-stage1-route",
      waypoint: "select-starter",
    });
    expect(decision.action?.reason).toContain("controller state");
    expect(decision.action?.reason).toContain("not visual scene ambiguity");
    expect(decision.controllerState).toMatchObject({
      kind: "pokemon-red-starter-selected-input-sequence",
      runtimeSource: "RuntimeGameState",
      selectedInputSequence: ["Left", "Up", "A", "A"],
      sequenceCursor: 2,
      target: {
        id: "oak-lab-starter-charmander",
      },
    });
  });

  it("integrates the selected starter input sequence into controller state flow without fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 6, y: 3 },
      }),
      starterPreference: "squirtle",
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Up",
        toolName: "mgba_hold",
      },
      controllerState: {
        currentPosition: {
          mapId: 40,
          x: 6,
          y: 3,
        },
        currentStep: {
          button: "Up",
          toolName: "mgba_hold",
        },
        kind: "pokemon-red-starter-selected-input-sequence",
        runtimeSource: "RuntimeGameState",
        selectedInputSequence: ["Right", "Up", "A", "A"],
        sequenceCursor: 1,
        waypoint: "advance-oak-lab-script",
      },
      phase: "lab_before_starter",
      policy: "known-stage1-route",
    });
    expect(decision.policy).not.toBe("llm-fallback");
    expect(decision.action?.reason).toContain("Selected input sequence");
  });

  it("confirms active starter dialogue only for the configured starter preference", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 40,
        menuLike: "visual-fallback",
        position: { x: 6, y: 2 },
      }),
      starterPreference: "squirtle",
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        reason: expect.stringContaining("right Squirtle starter"),
        toolName: "mgba_tap",
      },
      phase: "starter_selection",
      policy: "scripted-event",
      waypoint: "select-starter",
    });
    expect(decision.controllerRoutine?.checkpoints).toEqual([
      OAK_DIALOGUE_PHASE_CHECKPOINTS.starter_selection,
    ]);
    expect(
      decision.controllerRoutine?.checkpoints[0]?.expectedDialogueMarkers
    ).toContain("starter confirmation prompt is active");
    expect(
      decision.controllerRoutine?.checkpoints[0]
        ?.expectedGameplayStateIdentifiers
    ).toContain("state.position.x is configured starter Pokeball coordinate");
    expect(decision.policy).not.toBe("llm-fallback");
  });

  it("does not confirm a non-configured starter prompt from generic Pokeball phase detection", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 40,
        menuLike: "visual-fallback",
        position: { x: 4, y: 2 },
      }),
      starterPreference: "squirtle",
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "B",
        reason: expect.stringContaining("configured right Squirtle starter"),
        toolName: "mgba_tap",
      },
      phase: "starter_selection",
      policy: "menu",
      waypoint: "advance-oak-lab-script",
    });
    expect(decision.action?.reason).not.toContain(
      "center Charmander starter Pokeball"
    );
    expect(decision.policy).not.toBe("llm-fallback");
  });

  it.each(
    POKEMON_RED_STARTER_PREFERENCES
  )("produces identical starter-selection actions and selected starter across repeated %s runs", (preference) => {
    const runs = Array.from({ length: 5 }, () =>
      simulateStarterSelectionRun(preference)
    );

    expect(runs.map((run) => run.actionTrace)).toEqual(
      Array.from({ length: runs.length }, () => runs[0]?.actionTrace)
    );
    expect(runs.map((run) => run.selectedStarter)).toEqual(
      Array.from({ length: runs.length }, () => preference)
    );
  });

  it.each(
    POKEMON_RED_STARTER_PREFERENCES
  )("does not invoke the LLM fallback analyst during the deterministic %s starter-selection sequence", (preference) => {
    const fallbackAnalyst = vi.fn((_: DeterministicPolicyDecision) => {
      throw new Error(
        "starter-selection sequence must not invoke LLM fallback"
      );
    });

    const run = simulateStarterSelectionRun(preference, fallbackAnalyst);

    expect(run.selectedStarter).toBe(preference);
    expect(run.actionTrace.map((entry) => entry.policy)).not.toContain(
      "llm-fallback"
    );
    expect(fallbackAnalyst).not.toHaveBeenCalled();
  });

  it.each(
    POKEMON_RED_STARTER_PREFERENCES
  )("honors configured %s starter preference during Stage 1 without fallback", (preference) => {
    const plan = resolvePokemonRedStarterSelectionPlan(preference);
    const run = simulateStarterSelectionRun(preference);

    expect(run.selectedStarter).toBe(preference);
    expect(run.actionTrace.map((entry) => entry.button)).toEqual(
      plan.sequenceButtons
    );
    expect(run.actionTrace.map((entry) => entry.selectedInputSequence)).toEqual(
      Array.from(
        { length: plan.sequenceButtons.length },
        () => plan.sequenceButtons
      )
    );
    expect(run.actionTrace.map((entry) => entry.policy)).not.toContain(
      "llm-fallback"
    );
    expect(run.actionTrace.at(-1)).toMatchObject({
      button: "A",
      phase: "starter_selection",
      policy: "scripted-event",
      toolName: "mgba_tap",
      waypoint: "select-starter",
    });
  });

  it("confirms Bulbasaur preference triggers the explicit starter selection trace", () => {
    expect(simulateStarterSelectionRun("bulbasaur")).toEqual({
      actionTrace: [
        {
          button: "Left",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Left", "Left", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "Left",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Left", "Left", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "Left",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Left", "Left", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "Up",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Left", "Left", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "A",
          phase: "starter_selection",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Left", "Left", "Up", "A", "A"],
          toolName: "mgba_tap",
          waypoint: "select-starter",
        },
        {
          button: "A",
          phase: "starter_selection",
          policy: "scripted-event",
          selectedInputSequence: ["Left", "Left", "Left", "Up", "A", "A"],
          toolName: "mgba_tap",
          waypoint: "select-starter",
        },
      ],
      selectedStarter: "bulbasaur",
    });
  });

  it("confirms Charmander preference triggers the expected explicit selection sequence", () => {
    expect(simulateStarterSelectionRun("charmander")).toEqual({
      actionTrace: [
        {
          button: "Left",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "Up",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "A",
          phase: "starter_selection",
          policy: "known-stage1-route",
          selectedInputSequence: ["Left", "Up", "A", "A"],
          toolName: "mgba_tap",
          waypoint: "select-starter",
        },
        {
          button: "A",
          phase: "starter_selection",
          policy: "scripted-event",
          selectedInputSequence: ["Left", "Up", "A", "A"],
          toolName: "mgba_tap",
          waypoint: "select-starter",
        },
      ],
      selectedStarter: "charmander",
    });
  });

  it("confirms Squirtle preference triggers the expected explicit selection sequence", () => {
    expect(simulateStarterSelectionRun("squirtle")).toEqual({
      actionTrace: [
        {
          button: "Right",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Right", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "Up",
          phase: "lab_before_starter",
          policy: "known-stage1-route",
          selectedInputSequence: ["Right", "Up", "A", "A"],
          toolName: "mgba_hold",
          waypoint: "advance-oak-lab-script",
        },
        {
          button: "A",
          phase: "starter_selection",
          policy: "known-stage1-route",
          selectedInputSequence: ["Right", "Up", "A", "A"],
          toolName: "mgba_tap",
          waypoint: "select-starter",
        },
        {
          button: "A",
          phase: "starter_selection",
          policy: "scripted-event",
          selectedInputSequence: ["Right", "Up", "A", "A"],
          toolName: "mgba_tap",
          waypoint: "select-starter",
        },
      ],
      selectedStarter: "squirtle",
    });
  });

  it("continues starter selection with controller A after prior A attempts instead of LLM fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: "visual-fallback",
        mapId: 40,
        menuLike: "visual-fallback",
        position: { x: 4, y: 2 },
      }),
      recentActions: Array.from({ length: 12 }, () => 'tap: {"button":"A"}'),
      starterPreference: "charmander",
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      expectedOutcome: "dialogue-progress",
      phase: "starter_selection",
      policy: "known-stage1-route",
      waypoint: "select-starter",
    });
    expect(decision.policy).not.toBe("llm-fallback");
    expect(decision.action?.reason).toContain("controller state");
  });

  it("keeps confirmed starter-selection dialogue controller-owned after the generic Oak Lab A cap", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 40,
        position: { x: 4, y: 2 },
      }),
      recentActions: Array.from({ length: 10 }, () => 'tap: {"button":"A"}'),
      starterPreference: "charmander",
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      phase: "starter_selection",
      policy: "scripted-event",
      waypoint: "select-starter",
    });
    expect(decision.controllerRoutine).toMatchObject({
      checkpoints: [OAK_DIALOGUE_PHASE_CHECKPOINTS.starter_selection],
      repeatedInputsObserved: 10,
    });
    expect(decision.policy).not.toBe("llm-fallback");
  });

  it("rejects unsupported starter preferences before Oak Lab route selection", () => {
    expect(() =>
      chooseDeterministicPolicyAction({
        observation: observation({
          ...baseState,
          mapId: 40,
          position: { x: 5, y: 3 },
        }),
        starterPreference: "pikachu",
        stuckMemory: emptyStuckMemory,
      })
    ).toThrow("Unsupported Pokemon Red starter preference");
  });

  it("does not repeat a blocked Oak Lab waypoint movement edge", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 4, y: 4 },
      }),
      stuckMemory: {
        failedMovementEdges: [
          {
            action: "hold:Up",
            attempts: 3,
            context: "map=40 x=4 y=4 facing=up",
            lastSeenTurn: 3,
          },
        ],
        recentRecoveryAttempts: [],
        repeatedStateContexts: [],
        stuckEvents: 1,
      },
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
    });
  });

  it("does not repeat the same Oak Lab hold action three times even before stuck memory catches up", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 4, y: 4 },
      }),
      recentActions: Array.from(
        { length: 3 },
        () => 'hold: {"button":"Up","duration":10}'
      ),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
    });
  });

  it("falls back after Oak Lab movement and interaction both failed without progress", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 4, y: 4 },
      }),
      recentActions: [
        'hold: {"button":"Up","duration":10}',
        'hold: {"button":"Up","duration":10}',
        'hold: {"button":"Up","duration":10}',
        'tap: {"button":"A"}',
      ],
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("llm-fallback");
    expect(decision.action).toBeUndefined();
  });

  it("handles confirmed Oak Lab scripted dialogue without LLM fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 40,
        position: { x: 5, y: 3 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      policy: "scripted-event",
    });
    expect(decision.controllerRoutine).toMatchObject({
      button: "A",
      checkpoints: [OAK_DIALOGUE_PHASE_CHECKPOINTS.lab_before_starter],
      configuredMaxRepeatedInputs: 10,
      expectedOutcome: "oak-dialogue-progress",
      name: "oak-dialogue-advance",
      repeatedInputsObserved: 0,
      runtimeSource: "RuntimeGameState",
      settle: {
        pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
        strategy: "post-action-frame-settle",
        targetFrames: POST_ACTION_SETTLE_FRAMES,
      },
    });
    expect(
      decision.controllerRoutine?.checkpoints[0]?.expectedDialogueMarkers
    ).toContain("Oak Lab scripted dialogue or confirmation prompt is active");
    expect(
      decision.controllerRoutine?.checkpoints[0]
        ?.expectedGameplayStateIdentifiers
    ).toContain("state.mapId=40");
    expect(
      decision.controllerRoutine?.checkpoints[0]?.expectedPostAdvanceMarkers
    ).toContain("phase changes to starter_selection or rival_battle");
  });

  it("invokes the Oak dialogue routine before fallback when Oak Lab scripted A reaches its cap", () => {
    const fallbackAnalyst = vi.fn((_: DeterministicPolicyDecision) => {
      throw new Error("Oak Lab dialogue routine must run before fallback");
    });
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 40,
        position: { x: 5, y: 3 },
      }),
      recentActions: Array.from({ length: 10 }, () => 'tap: {"button":"A"}'),
      stuckMemory: emptyStuckMemory,
    });

    if (decision.policy === "llm-fallback") {
      fallbackAnalyst(decision);
    }
    expect(fallbackAnalyst).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      action: {
        button: "A",
        reason: expect.stringContaining("OakDialogueAdvanceRoutine"),
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      policy: "scripted-event",
    });
    expect(decision.controllerRoutine).toMatchObject({
      configuredMaxRepeatedInputs: 10,
      name: "oak-dialogue-advance",
      repeatedInputsObserved: 10,
      settle: {
        pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
        targetFrames: POST_ACTION_SETTLE_FRAMES,
      },
    });
  });

  it("advances the Pallet north Oak trigger deterministically when movement is blocked", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 0,
        position: { x: 10, y: 1 },
      }),
      stuckMemory: {
        failedMovementEdges: [
          {
            action: "hold:Up",
            attempts: 3,
            context: "map=0 x=10 y=1 facing=up",
            lastSeenTurn: 1,
          },
          {
            action: "hold:Left",
            attempts: 3,
            context: "map=0 x=10 y=1 facing=up",
            lastSeenTurn: 2,
          },
          {
            action: "hold:Right",
            attempts: 3,
            context: "map=0 x=10 y=1 facing=up",
            lastSeenTurn: 3,
          },
        ],
        recentRecoveryAttempts: [],
        repeatedStateContexts: [],
        stuckEvents: 1,
      },
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      policy: "scripted-event",
    });
  });

  it("advances confirmed Pallet Oak dialogue with deterministic A before fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 0,
        position: { x: 10, y: 1 },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      phase: "oak_forced_walk_or_dialogue",
      policy: "scripted-event",
    });
    expect(decision.controllerRoutine).toMatchObject({
      button: "A",
      checkpoints: [OAK_DIALOGUE_PHASE_CHECKPOINTS.oak_forced_walk_or_dialogue],
      configuredMaxRepeatedInputs: 6,
      expectedOutcome: "oak-dialogue-progress",
      name: "oak-dialogue-advance",
      repeatedInputsObserved: 0,
      runtimeSource: "RuntimeGameState",
      settle: {
        pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
        strategy: "post-action-frame-settle",
        targetFrames: POST_ACTION_SETTLE_FRAMES,
      },
    });
    expect(
      decision.controllerRoutine?.checkpoints[0]?.expectedDialogueMarkers
    ).toContain("state.dialogueLike=true");
    expect(
      decision.controllerRoutine?.checkpoints[0]
        ?.expectedGameplayStateIdentifiers
    ).toContain("state.position.y<=2");
    expect(
      decision.controllerRoutine?.checkpoints[0]?.expectedPostAdvanceMarkers
    ).toContain("state.mapId changes to 40 when Oak Lab loads");
    expect(decision.reason).toContain("Oak dialogue");
  });

  it("keeps advancing Oak dialogue with A on the turn before analyst fallback is allowed", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 0,
        position: { x: 10, y: 1 },
      }),
      recentActions: Array.from({ length: 5 }, () => 'tap: {"button":"A"}'),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      phase: "oak_forced_walk_or_dialogue",
      policy: "scripted-event",
    });
    expect(decision.controllerRoutine).toMatchObject({
      configuredMaxRepeatedInputs: 6,
      name: "oak-dialogue-advance",
      repeatedInputsObserved: 5,
      settle: {
        pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
        targetFrames: POST_ACTION_SETTLE_FRAMES,
      },
    });
    expect(decision.reason).toContain("deterministic controller owns dialogue");
  });

  it("invokes the Oak dialogue routine before fallback when confirmed Pallet Oak dialogue reaches its cap", () => {
    const fallbackAnalyst = vi.fn((_: DeterministicPolicyDecision) => {
      throw new Error("Pallet Oak dialogue routine must run before fallback");
    });
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        dialogueLike: true,
        mapId: 0,
        position: { x: 10, y: 1 },
      }),
      recentActions: Array.from({ length: 6 }, () => 'tap: {"button":"A"}'),
      stuckMemory: emptyStuckMemory,
    });

    if (decision.policy === "llm-fallback") {
      fallbackAnalyst(decision);
    }
    expect(fallbackAnalyst).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      action: {
        button: "A",
        reason: expect.stringContaining("OakDialogueAdvanceRoutine"),
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      phase: "oak_forced_walk_or_dialogue",
      policy: "scripted-event",
    });
    expect(decision.controllerRoutine).toMatchObject({
      configuredMaxRepeatedInputs: 6,
      name: "oak-dialogue-advance",
      repeatedInputsObserved: 6,
      settle: {
        pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
        targetFrames: POST_ACTION_SETTLE_FRAMES,
      },
    });
    expect(decision.reason).toContain("Oak dialogue received 6 repeated A");
    expect(decision.reason).toContain("before fallback analyst consideration");
  });

  it("invokes the Oak dialogue routine before fallback when the Oak trigger reaches its no-transition cap", () => {
    const fallbackAnalyst = vi.fn((_: DeterministicPolicyDecision) => {
      throw new Error("Pallet Oak trigger routine must run before fallback");
    });
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 0,
        position: { x: 10, y: 1 },
      }),
      recentActions: Array.from({ length: 6 }, () => 'tap: {"button":"A"}'),
      stuckMemory: {
        failedMovementEdges: [
          {
            action: "hold:Up",
            attempts: 3,
            context: "map=0 x=10 y=1 facing=up",
            lastSeenTurn: 1,
          },
          {
            action: "hold:Left",
            attempts: 3,
            context: "map=0 x=10 y=1 facing=up",
            lastSeenTurn: 2,
          },
          {
            action: "hold:Right",
            attempts: 3,
            context: "map=0 x=10 y=1 facing=up",
            lastSeenTurn: 3,
          },
        ],
        recentRecoveryAttempts: [],
        repeatedStateContexts: [],
        stuckEvents: 1,
      },
    });

    if (decision.policy === "llm-fallback") {
      fallbackAnalyst(decision);
    }
    expect(fallbackAnalyst).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      action: {
        button: "A",
        reason: expect.stringContaining("OakDialogueAdvanceRoutine"),
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      policy: "scripted-event",
    });
    expect(decision.controllerRoutine).toMatchObject({
      configuredMaxRepeatedInputs: 6,
      name: "oak-dialogue-advance",
      repeatedInputsObserved: 6,
      settle: {
        pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
        targetFrames: POST_ACTION_SETTLE_FRAMES,
      },
    });
  });

  it("tries one deterministic interaction before LLM fallback after repeated same-state movement failures", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 38,
        position: { x: 3, y: 6 },
      }),
      stuckMemory: {
        failedMovementEdges: [
          {
            action: "hold:Up",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 1,
          },
          {
            action: "hold:Right",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 2,
          },
          {
            action: "hold:Left",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 3,
          },
          {
            action: "hold:Down",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 4,
          },
        ],
        recentRecoveryAttempts: [],
        repeatedStateContexts: [],
        stuckEvents: 1,
      },
    });

    expect(decision).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      policy: "dialogue",
    });
  });

  it("hands generic stuck interaction to fallback after A was already tried", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 38,
        position: { x: 3, y: 6 },
      }),
      recentActions: ['tap: {"button":"A"}'],
      stuckMemory: {
        failedMovementEdges: [
          {
            action: "hold:Up",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 1,
          },
          {
            action: "hold:Right",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 2,
          },
          {
            action: "hold:Left",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 3,
          },
          {
            action: "hold:Down",
            attempts: 3,
            context: "map=38 x=3 y=6 facing=up",
            lastSeenTurn: 4,
          },
        ],
        recentRecoveryAttempts: [],
        repeatedStateContexts: [],
        stuckEvents: 1,
      },
    });

    expect(decision.policy).toBe("llm-fallback");
    expect(decision.action).toBeUndefined();
  });
});
