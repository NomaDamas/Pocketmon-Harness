import { describe, expect, it, vi } from "vitest";
import {
  BASIC_BATTLE_POLICY,
  BASIC_BATTLE_POLICY_RULE_ORDER,
  BATTLE_POLICY_REQUIRED_INPUTS,
  type BattlePolicyAction,
  chooseBattlePolicyAction,
  enumerateValidBattleActions,
  selectBasicBattlePolicyForRivalEncounter,
} from "../src/battle-policy";
import { chooseDeterministicPolicyAction } from "../src/deterministic-policy";
import { getRivalBattleLlmControlGuard } from "../src/fallback-gate";
import { detectPokemonPhase } from "../src/phase-detector";
import { chooseStage1FastAction } from "../src/stage1-fast-autopilot";
import {
  RIVAL_BATTLE_BASE_ACTION_STATE,
  RIVAL_BATTLE_STATE_FIXTURES,
  type RivalBattleFixtureId,
  type RivalBattleStateFixture,
  rivalBattleObservation,
} from "./fixtures/rival-battle-states";

const mainMenuRivalBattleFixture = rivalBattleFixture("rival-battle-main-menu");
const runtimeGameState = mainMenuRivalBattleFixture.runtimeGameState;
const battleActionState = RIVAL_BATTLE_BASE_ACTION_STATE;

const emptyStuckMemory = {
  failedMovementEdges: [],
  recentRecoveryAttempts: [],
  repeatedStateContexts: [],
  stuckEvents: 0,
};

interface CommonBattleFixture {
  expectedButtons: readonly string[];
  expectedId: string;
  expectedKind: string;
  fixtureId: RivalBattleFixtureId | "wild-battle-run-only";
  name: string;
}

type SupportedRivalBattleStateFixture = RivalBattleStateFixture & {
  expectedDecision: Extract<
    RivalBattleStateFixture["expectedDecision"],
    { buttons: readonly string[] }
  >;
};

const commonBattleFixtures: readonly CommonBattleFixture[] = [
  {
    expectedButtons: ["A"],
    expectedId: "fight:1",
    expectedKind: "fight",
    fixtureId: "rival-battle-main-menu",
    name: "main menu with a usable move",
  },
  {
    expectedButtons: ["Up", "A"],
    expectedId: "fight:1",
    expectedKind: "fight",
    fixtureId: "rival-battle-move-select",
    name: "move select with cursor below first usable move",
  },
  {
    expectedButtons: ["A"],
    expectedId: "item:1",
    expectedKind: "item",
    fixtureId: "rival-battle-bag-item-select",
    name: "bag item select with a usable potion",
  },
  {
    expectedButtons: ["A"],
    expectedId: "switch:2",
    expectedKind: "switch",
    fixtureId: "rival-battle-party-select",
    name: "party select with a conscious bench member",
  },
  {
    expectedButtons: ["A"],
    expectedId: "run",
    expectedKind: "run",
    fixtureId: "wild-battle-run-only",
    name: "main menu run-only wild battle",
  },
];

const BATTLE_POLICY_REPEATABILITY_RUNS = 10;

function isSupportedRivalBattleFixture(
  fixture: RivalBattleStateFixture
): fixture is SupportedRivalBattleStateFixture {
  return "buttons" in fixture.expectedDecision;
}

describe("BattlePolicy action inputs", () => {
  it("provides reusable rival battle RAM-state fixtures for representative phases", () => {
    expect(RIVAL_BATTLE_STATE_FIXTURES.map((fixture) => fixture.phase)).toEqual(
      [
        "main-menu",
        "move-select",
        "bag-item-select",
        "party-select",
        "unsupported-ui",
      ]
    );

    for (const fixture of RIVAL_BATTLE_STATE_FIXTURES) {
      expect(fixture.runtimeGameState).toMatchObject({
        battle: true,
        battleResult: 0,
        battleType: 1,
        mapId: 40,
        readStatus: "available",
      });
      expect(fixture.runtimeGameState.battleActionState).toMatchObject({
        readStatus: "available",
        ui: { source: "ram" },
      });
      expect(fixture.runtimeGameState.position.x).not.toBeNull();
      expect(fixture.runtimeGameState.position.y).not.toBeNull();
    }
  });

  it("uses BasicBattlePolicy rule ordering for deterministic choices", () => {
    expect(BASIC_BATTLE_POLICY_RULE_ORDER).toEqual([
      "fight",
      "item",
      "switch",
      "run",
    ]);
  });

  it("selects BasicBattlePolicy for rival battle entry-point handlers", () => {
    const selectedPolicy = selectBasicBattlePolicyForRivalEncounter();
    const selectedAction = chooseBattlePolicyAction({
      battlePolicy: selectedPolicy,
      runtimeGameState,
    });

    expect(selectedPolicy).toBe(BASIC_BATTLE_POLICY);
    expect(selectedPolicy).toMatchObject({
      id: "basic-battle-policy",
      ruleOrder: BASIC_BATTLE_POLICY_RULE_ORDER,
    });
    expect(selectedAction).toMatchObject({
      id: "fight:1",
      kind: "fight",
    });
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES.filter(isSupportedRivalBattleFixture)
  )("selects supported $label actions from configured BasicBattlePolicy priorities", (fixture) => {
    const actions = enumerateValidBattleActions({
      runtimeGameState: fixture.runtimeGameState,
    });
    const expectedAction = highestConfiguredPriorityAction(actions);
    const selectedAction = chooseBattlePolicyAction({
      runtimeGameState: fixture.runtimeGameState,
    });

    expect(actions.length).toBeGreaterThan(0);
    expect(expectedAction).toBeDefined();
    expect(selectedAction).toEqual(expectedAction);
    expect(selectedAction).toMatchObject({
      id: fixture.expectedDecision.id,
      kind: fixture.expectedDecision.kind,
    });
    expect(
      actions.some(
        (action) =>
          configuredBattlePolicyRank(action.kind) <
          configuredBattlePolicyRank(selectedAction?.kind)
      )
    ).toBe(false);
  });

  it("keeps simultaneous rival battle main-menu choices ordered by configured controller priorities", () => {
    const actions = enumerateValidBattleActions({
      runtimeGameState: {
        ...runtimeGameState,
        battleActionState: {
          ...battleActionState,
          canRun: true,
        },
      },
    });
    const selectedAction = chooseBattlePolicyAction({
      runtimeGameState: {
        ...runtimeGameState,
        battleActionState: {
          ...battleActionState,
          canRun: true,
        },
      },
    });

    expect(actions.map((action) => action.kind)).toEqual(
      BASIC_BATTLE_POLICY_RULE_ORDER
    );
    expect(actions.map((action) => action.kind)).toEqual([
      "fight",
      "item",
      "switch",
      "run",
    ]);
    expect(selectedAction).toEqual(highestConfiguredPriorityAction(actions));
    expect(selectedAction).toMatchObject({
      id: "fight:1",
      kind: "fight",
    });
  });

  it("documents the runtime battle inputs required for deterministic enumeration", () => {
    expect(BATTLE_POLICY_REQUIRED_INPUTS).toEqual([
      "runtimeGameState.readStatus",
      "runtimeGameState.battle",
      "runtimeGameState.battleType",
      "runtimeGameState.battleResult",
      "runtimeGameState.battleActionState.readStatus",
      "runtimeGameState.battleActionState.ui.mode",
      "runtimeGameState.battleActionState.ui.cursorIndex",
      "runtimeGameState.battleActionState.moves[].moveId",
      "runtimeGameState.battleActionState.moves[].pp",
      "runtimeGameState.battleActionState.moves[].disabled",
      "runtimeGameState.battleActionState.items[].itemId",
      "runtimeGameState.battleActionState.items[].quantity",
      "runtimeGameState.battleActionState.items[].usableInBattle",
      "runtimeGameState.battleActionState.items[].disabled",
      "runtimeGameState.battleActionState.party[].speciesId",
      "runtimeGameState.battleActionState.party[].hp",
      "runtimeGameState.battleActionState.party[].active",
      "runtimeGameState.battleActionState.party[].fainted",
      "runtimeGameState.battleActionState.canRun",
    ]);
  });

  it("enumerates valid fight, item, switch, and run actions from runtime game state", () => {
    const actions = enumerateValidBattleActions({
      runtimeGameState: {
        ...runtimeGameState,
        battleActionState: { ...battleActionState, canRun: true },
      },
    });

    expect(actions.map((action) => action.id)).toEqual([
      "fight:1",
      "item:1",
      "switch:2",
      "run",
    ]);
    expect(actions.map((action) => action.kind)).toEqual([
      "fight",
      "item",
      "switch",
      "run",
    ]);
    expect(actions[0]?.buttons).toEqual(["A"]);
  });

  it("does not enumerate battle actions when runtime state is unavailable or not in battle", () => {
    expect(
      enumerateValidBattleActions({
        battleState: battleActionState,
        runtimeGameState: {
          ...runtimeGameState,
          readStatus: "unavailable",
        },
      })
    ).toEqual([]);
    expect(
      enumerateValidBattleActions({
        battleState: battleActionState,
        runtimeGameState: {
          ...runtimeGameState,
          battle: false,
        },
      })
    ).toEqual([]);
  });

  it("uses battle action state validity instead of exposing impossible battle choices", () => {
    const actions = enumerateValidBattleActions({
      battleState: {
        ...battleActionState,
        canRun: false,
        items: [],
        moves: battleActionState.moves.map((move) => ({ ...move, pp: 0 })),
        party: battleActionState.party.map((partyMember) => ({
          ...partyMember,
          hp: 0,
        })),
      },
      runtimeGameState,
    });

    expect(actions).toEqual([]);
  });

  it("chooses the first deterministic valid battle action without using fallback planning", () => {
    const action = chooseBattlePolicyAction({
      battleState: {
        ...battleActionState,
        ui: {
          cursorIndex: 3,
          mode: "main-menu",
          source: "ram",
        },
      },
      runtimeGameState,
    });

    expect(action).toMatchObject({
      buttons: ["Up", "Up", "Up", "A"],
      id: "fight:1",
      kind: "fight",
    });
  });

  it("wires rival battle phases through BattlePolicy before analyst fallback", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: rivalBattleObservation({
        ...runtimeGameState,
        battleActionState: {
          ...battleActionState,
          ui: {
            cursorIndex: 3,
            mode: "main-menu",
            source: "ram",
          },
        },
      }),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision).toMatchObject({
      action: {
        button: "Up",
        buttons: ["Up", "Up", "Up", "A"],
        reason: expect.stringContaining("BattlePolicy"),
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      phase: "rival_battle",
      policy: "battle",
    });
  });

  it("uses BattlePolicy for the fast Stage 1 battle controller path", () => {
    const action = chooseStage1FastAction(
      rivalBattleObservation({
        ...runtimeGameState,
        battleActionState: {
          ...battleActionState,
          ui: {
            cursorIndex: 3,
            mode: "main-menu",
            source: "ram",
          },
        },
      }),
      emptyStuckMemory
    );

    expect(action).toMatchObject({
      button: "Up",
      buttons: ["Up", "Up", "Up", "A"],
      reason: expect.stringContaining("BattlePolicy"),
      toolName: "mgba_tap",
    });
    expect(action?.reason).not.toContain("fallback");
  });

  it("does not fast-probe unsupported battle UI outside BattlePolicy", () => {
    const action = chooseStage1FastAction(
      rivalBattleObservation(
        rivalBattleFixture("rival-battle-unsupported-ui").runtimeGameState
      ),
      emptyStuckMemory
    );

    expect(action).toBeUndefined();
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES.filter(isSupportedRivalBattleFixture)
  )("keeps $label detection and entry flows on BattlePolicy without analyst fallback", (fixture) => {
    const fallbackAnalyst = vi.fn((_: unknown) => {
      throw new Error("rival battle entry must remain controller-primary");
    });
    const observation = rivalBattleObservation(fixture.runtimeGameState);
    const battlePolicyAction = chooseBattlePolicyAction({
      runtimeGameState: fixture.runtimeGameState,
    });
    const detected = detectPokemonPhase({
      observation,
      stuckMemory: emptyStuckMemory,
    });
    const deterministicDecision = chooseDeterministicPolicyAction({
      observation,
      stuckMemory: emptyStuckMemory,
    });
    const fastAction = chooseStage1FastAction(observation, emptyStuckMemory);
    const rivalBattleGuard = getRivalBattleLlmControlGuard(
      deterministicDecision
    );

    if (deterministicDecision.policy === "llm-fallback" || rivalBattleGuard) {
      fallbackAnalyst(deterministicDecision);
    }

    expect(detected).toEqual({
      phase: "rival_battle",
      reason: "deterministic-rival-battle-event",
      waypoint: "win-current-battle",
    });
    expect(battlePolicyAction).toMatchObject({
      buttons: fixture.expectedDecision.buttons,
      id: fixture.expectedDecision.id,
      kind: fixture.expectedDecision.kind,
    });
    expect(deterministicDecision).toMatchObject({
      action: {
        button: fixture.expectedDecision.buttons[0],
        buttons: fixture.expectedDecision.buttons,
        reason: battlePolicyAction?.reason,
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      phase: "rival_battle",
      policy: "battle",
      reason: "rival battle phase is controller-owned by BattlePolicy",
      waypoint: "win-current-battle",
    });
    expect(fastAction).toMatchObject({
      button: fixture.expectedDecision.buttons[0],
      buttons: fixture.expectedDecision.buttons,
      reason: battlePolicyAction?.reason,
      toolName: "mgba_tap",
    });
    expect(fallbackAnalyst).not.toHaveBeenCalled();
  });

  it("guard-stops unsupported rival battle UI without invoking analyst fallback", () => {
    const fallbackAnalyst = vi.fn((_: unknown) => {
      throw new Error("unsupported rival battle UI must be controller-guarded");
    });
    const fixture = rivalBattleFixture("rival-battle-unsupported-ui");
    const observation = rivalBattleObservation(fixture.runtimeGameState);
    const detected = detectPokemonPhase({
      observation,
      stuckMemory: emptyStuckMemory,
    });
    const deterministicDecision = chooseDeterministicPolicyAction({
      observation,
      stuckMemory: emptyStuckMemory,
    });
    const fastAction = chooseStage1FastAction(observation, emptyStuckMemory);
    const rivalBattleGuard = getRivalBattleLlmControlGuard(
      deterministicDecision
    );

    if (deterministicDecision.policy === "llm-fallback") {
      fallbackAnalyst(deterministicDecision);
    }

    expect(detected.phase).toBe("rival_battle");
    expect(deterministicDecision).toMatchObject({
      expectedOutcome: "battle-progress",
      phase: "rival_battle",
      policy: "battle",
      waypoint: "win-current-battle",
    });
    expect(deterministicDecision.action).toBeUndefined();
    expect(deterministicDecision.reason).toContain("BattlePolicy");
    expect(deterministicDecision.reason).not.toContain("fallback");
    expect(fastAction).toBeUndefined();
    expect(rivalBattleGuard).toMatchObject({
      reason: expect.stringContaining("must not open tool-enabled LLM"),
    });
    expect(fallbackAnalyst).not.toHaveBeenCalled();
  });

  it.each(
    commonBattleFixtures
  )("chooses valid deterministic BasicBattlePolicy action for $name", ({
    expectedButtons,
    expectedId,
    expectedKind,
    fixtureId,
  }) => {
    const fixture = battleStateFixture(fixtureId);
    const action = chooseBattlePolicyAction({
      runtimeGameState: fixture.runtimeGameState,
    });

    expect(action).toMatchObject({
      buttons: expectedButtons,
      id: expectedId,
      kind: expectedKind,
    });
    expect(action?.buttons.length).toBeGreaterThan(0);
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES
  )("matches fixture-specific rival battle decision for $id", (fixture) => {
    const expected = fixture.expectedDecision;
    const battlePolicyAction = chooseBattlePolicyAction({
      runtimeGameState: fixture.runtimeGameState,
    });
    const deterministicDecision = chooseDeterministicPolicyAction({
      observation: rivalBattleObservation(fixture.runtimeGameState),
      stuckMemory: emptyStuckMemory,
    });
    const fastAction = chooseStage1FastAction(
      rivalBattleObservation(fixture.runtimeGameState),
      emptyStuckMemory
    );

    if ("controllerGuarded" in expected) {
      expect(battlePolicyAction).toBeUndefined();
      expect(deterministicDecision.policy).toBe(expected.policy);
      expect(deterministicDecision.action).toBe(expected.action);
      expect(deterministicDecision.reason).toContain(expected.reasonIncludes);
      expect(deterministicDecision.reason).not.toContain("fallback");
      expect(fastAction).toBeUndefined();
      return;
    }

    expect(battlePolicyAction).toMatchObject({
      buttons: expected.buttons,
      id: expected.id,
      kind: expected.kind,
    });
    expect(targetNameForBattlePolicyAction(battlePolicyAction)).toBe(
      expected.targetName
    );
    expect(targetTypeForBattlePolicyAction(battlePolicyAction)).toBe(
      expected.targetType
    );
    expect(deterministicDecision).toMatchObject({
      action: {
        button: expected.buttons[0],
        buttons: expected.buttons,
        reason: expect.stringContaining("BattlePolicy"),
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      phase: "rival_battle",
      policy: expected.policy,
    });
    expect(deterministicDecision.policy).not.toBe("llm-fallback");
    expect(deterministicDecision.action?.reason).not.toContain("fallback");
    expect(fastAction).toMatchObject({
      button: expected.buttons[0],
      buttons: expected.buttons,
      reason: expect.stringContaining("BattlePolicy"),
      toolName: "mgba_tap",
    });
    expect(fastAction?.reason).not.toContain("fallback");
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES
  )("returns identical BattlePolicy decisions across repeated $label runs", (fixture) => {
    const decisions = Array.from(
      { length: BATTLE_POLICY_REPEATABILITY_RUNS },
      () =>
        chooseBattlePolicyAction({
          runtimeGameState: fixture.runtimeGameState,
        })
    );

    expect(decisions).toEqual(
      Array.from(
        { length: BATTLE_POLICY_REPEATABILITY_RUNS },
        () => decisions[0]
      )
    );
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES
  )("replays identical rival battle controller decisions from fixed $label RAM states", (fixture) => {
    const decisions = Array.from(
      { length: BATTLE_POLICY_REPEATABILITY_RUNS },
      () => {
        const fixedRuntimeGameState = structuredClone(fixture.runtimeGameState);
        const battlePolicyAction = chooseBattlePolicyAction({
          runtimeGameState: fixedRuntimeGameState,
        });
        const deterministicDecision = chooseDeterministicPolicyAction({
          observation: rivalBattleObservation(fixedRuntimeGameState),
          stuckMemory: emptyStuckMemory,
        });
        const fastAction = chooseStage1FastAction(
          rivalBattleObservation(fixedRuntimeGameState),
          emptyStuckMemory
        );

        return {
          battlePolicy: battlePolicyReplaySnapshot(battlePolicyAction),
          deterministicPolicy: {
            action: deterministicDecision.action
              ? {
                  button: deterministicDecision.action.button,
                  buttons: deterministicDecision.action.buttons,
                  toolName: deterministicDecision.action.toolName,
                }
              : undefined,
            expectedOutcome: deterministicDecision.expectedOutcome,
            phase: deterministicDecision.phase,
            policy: deterministicDecision.policy,
            waypoint: deterministicDecision.waypoint,
          },
          fastController: fastAction
            ? {
                button: fastAction.button,
                buttons: fastAction.buttons,
                toolName: fastAction.toolName,
              }
            : undefined,
        };
      }
    );

    expect(decisions).toEqual(
      Array.from(
        { length: BATTLE_POLICY_REPEATABILITY_RUNS },
        () => decisions[0]
      )
    );

    if ("controllerGuarded" in fixture.expectedDecision) {
      expect(decisions[0]).toMatchObject({
        battlePolicy: undefined,
        deterministicPolicy: {
          action: undefined,
          expectedOutcome: "battle-progress",
          policy: "battle",
        },
        fastController: undefined,
      });
      return;
    }

    expect(decisions[0]).toMatchObject({
      battlePolicy: {
        buttons: fixture.expectedDecision.buttons,
        id: fixture.expectedDecision.id,
        kind: fixture.expectedDecision.kind,
        targetName: fixture.expectedDecision.targetName,
        targetType: fixture.expectedDecision.targetType,
      },
      deterministicPolicy: {
        action: {
          button: fixture.expectedDecision.buttons[0],
          buttons: fixture.expectedDecision.buttons,
          toolName: "mgba_tap",
        },
        expectedOutcome: "battle-progress",
        policy: "battle",
      },
      fastController: {
        button: fixture.expectedDecision.buttons[0],
        buttons: fixture.expectedDecision.buttons,
        toolName: "mgba_tap",
      },
    });
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES.filter(isSupportedRivalBattleFixture)
  )("produces identical controller actions from identical $label RuntimeGameState inputs", (fixture) => {
    const controllerActions = Array.from(
      { length: BATTLE_POLICY_REPEATABILITY_RUNS },
      () => {
        const fixedRuntimeGameState = structuredClone(fixture.runtimeGameState);
        const decision = chooseDeterministicPolicyAction({
          observation: rivalBattleObservation(fixedRuntimeGameState),
          stuckMemory: emptyStuckMemory,
        });

        expect(decision.policy).toBe("battle");
        expect(decision.policy).not.toBe("llm-fallback");

        return {
          button: decision.action?.button,
          buttons: decision.action?.buttons,
          toolName: decision.action?.toolName,
        };
      }
    );

    expect(controllerActions).toEqual(
      Array.from(
        { length: BATTLE_POLICY_REPEATABILITY_RUNS },
        () => controllerActions[0]
      )
    );
    expect(controllerActions[0]).toEqual({
      button: fixture.expectedDecision.buttons[0],
      buttons: fixture.expectedDecision.buttons,
      toolName: "mgba_tap",
    });
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES.filter(isSupportedRivalBattleFixture)
  )("replays supported $label decisions without invoking the LLM fallback", (fixture) => {
    const fallbackAnalyst = vi.fn((_: unknown) => {
      throw new Error("supported rival battle state must not invoke LLM");
    });
    const decisions = Array.from(
      { length: BATTLE_POLICY_REPEATABILITY_RUNS },
      () => {
        const decision = chooseDeterministicPolicyAction({
          observation: rivalBattleObservation(
            structuredClone(fixture.runtimeGameState)
          ),
          stuckMemory: emptyStuckMemory,
        });

        if (decision.policy === "llm-fallback") {
          fallbackAnalyst(decision);
        }

        return {
          action: decision.action
            ? {
                button: decision.action.button,
                buttons: decision.action.buttons,
                reason: decision.action.reason,
                toolName: decision.action.toolName,
              }
            : undefined,
          expectedOutcome: decision.expectedOutcome,
          phase: decision.phase,
          policy: decision.policy,
          reason: decision.reason,
          waypoint: decision.waypoint,
        };
      }
    );

    expect(decisions).toEqual(
      Array.from(
        { length: BATTLE_POLICY_REPEATABILITY_RUNS },
        () => decisions[0]
      )
    );
    expect(fallbackAnalyst).not.toHaveBeenCalled();
    expect(decisions[0]).toMatchObject({
      action: {
        button: fixture.expectedDecision.buttons[0],
        buttons: fixture.expectedDecision.buttons,
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      phase: "rival_battle",
      policy: "battle",
      reason: "rival battle phase is controller-owned by BattlePolicy",
    });
    expect(decisions[0]?.action?.reason).toContain("BattlePolicy");
    expect(decisions[0]?.action?.reason).not.toContain("fallback");
  });

  it.each(
    commonBattleFixtures
  )("keeps LLM fallback out of supported BasicBattlePolicy fixture: $name", ({
    expectedButtons,
    fixtureId,
  }) => {
    const fixture = battleStateFixture(fixtureId);
    const decision = chooseDeterministicPolicyAction({
      observation: rivalBattleObservation(fixture.runtimeGameState),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("battle");
    expect(decision.policy).not.toBe("llm-fallback");
    expect(decision.expectedOutcome).toBe("battle-progress");
    expect(decision.action).toMatchObject({
      buttons: expectedButtons,
      toolName: "mgba_tap",
    });
    expect(decision.action?.button).toBe(expectedButtons[0]);
    expect(decision.action?.reason).not.toContain("fallback");
  });

  it("only exposes actions executable from the current battle UI", () => {
    const actions = enumerateValidBattleActions({
      battleState: {
        ...battleActionState,
        ui: {
          cursorIndex: 1,
          mode: "move-select",
          source: "ram",
        },
      },
      runtimeGameState,
    });

    expect(actions.map((action) => action.id)).toEqual(["fight:1"]);
    expect(actions[0]?.buttons).toEqual(["Up", "A"]);
    expect(actions.every((action) => action.buttons.length > 0)).toBe(true);
  });

  it("orders main-menu choices by valid BasicBattlePolicy rules", () => {
    const action = chooseBattlePolicyAction({
      battleState: {
        ...battleActionState,
        moves: battleActionState.moves.map((move) => ({ ...move, pp: 0 })),
      },
      runtimeGameState,
    });

    expect(action).toMatchObject({
      buttons: ["Down", "A"],
      id: "item:1",
      kind: "item",
    });
  });

  it("prioritizes rival battle moves by slot instead of RAM array order", () => {
    const action = chooseBattlePolicyAction({
      battleState: {
        ...battleActionState,
        moves: [
          { moveId: 45, name: "Growl", pp: 40, slot: 2 },
          { moveId: 33, name: "Tackle", pp: 35, slot: 1 },
        ],
        ui: {
          cursorIndex: 0,
          mode: "move-select",
          source: "ram",
        },
      },
      runtimeGameState,
    });

    expect(action).toMatchObject({
      buttons: ["A"],
      id: "fight:1",
      kind: "fight",
    });
    expect(targetNameForBattlePolicyAction(action)).toBe("Tackle");
  });

  it("prioritizes lower item and party slots after higher-priority actions are exhausted", () => {
    const itemAction = chooseBattlePolicyAction({
      battleState: {
        ...battleActionState,
        items: [
          {
            itemId: 21,
            name: "Second Potion",
            quantity: 1,
            slot: 2,
            usableInBattle: true,
          },
          {
            itemId: 20,
            name: "First Potion",
            quantity: 1,
            slot: 1,
            usableInBattle: true,
          },
        ],
        moves: battleActionState.moves.map((move) => ({ ...move, pp: 0 })),
        ui: {
          cursorIndex: 0,
          mode: "bag-item-select",
          source: "ram",
        },
      },
      runtimeGameState,
    });
    const switchAction = chooseBattlePolicyAction({
      battleState: {
        ...battleActionState,
        items: [],
        moves: battleActionState.moves.map((move) => ({ ...move, pp: 0 })),
        party: [
          battleActionState.party[0],
          {
            active: false,
            hp: 10,
            name: "Later Bench",
            slot: 3,
            speciesId: 165,
          },
          {
            active: false,
            hp: 12,
            name: "First Bench",
            slot: 2,
            speciesId: 36,
          },
        ],
        ui: {
          cursorIndex: 1,
          mode: "party-select",
          source: "ram",
        },
      },
      runtimeGameState,
    });

    expect(itemAction).toMatchObject({
      buttons: ["A"],
      id: "item:1",
      kind: "item",
    });
    expect(targetNameForBattlePolicyAction(itemAction)).toBe("First Potion");
    expect(switchAction).toMatchObject({
      buttons: ["A"],
      id: "switch:2",
      kind: "switch",
    });
    expect(targetNameForBattlePolicyAction(switchAction)).toBe("First Bench");
  });

  it("does not use random or stochastic tie-breaking for rival battle priority", () => {
    const randomSpy = vi.spyOn(Math, "random");
    try {
      const decisions = Array.from(
        { length: BATTLE_POLICY_REPEATABILITY_RUNS },
        () =>
          chooseBattlePolicyAction({
            battleState: {
              ...battleActionState,
              moves: [
                { moveId: 45, name: "Growl", pp: 40, slot: 2 },
                { moveId: 33, name: "Tackle", pp: 35, slot: 1 },
              ],
            },
            runtimeGameState,
          })
      );

      expect(randomSpy).not.toHaveBeenCalled();
      expect(decisions.map((decision) => decision?.id)).toEqual(
        Array.from(
          { length: BATTLE_POLICY_REPEATABILITY_RUNS },
          () => "fight:1"
        )
      );
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("does not select legal targets that the current unsupported UI cannot execute", () => {
    const actions = enumerateValidBattleActions({
      battleState: {
        ...battleActionState,
        ui: {
          cursorIndex: null,
          mode: "unknown",
          source: "ram",
        },
      },
      runtimeGameState,
    });

    expect(actions).toEqual([]);
  });
});

function rivalBattleFixture(id: RivalBattleFixtureId) {
  const fixture = RIVAL_BATTLE_STATE_FIXTURES.find(
    (candidate) => candidate.id === id
  );
  if (!fixture) {
    throw new Error(`Missing rival battle fixture: ${id}`);
  }
  return fixture;
}

function battleStateFixture(
  id: CommonBattleFixture["fixtureId"]
): RivalBattleStateFixture {
  if (id === "wild-battle-run-only") {
    return {
      id: "rival-battle-main-menu",
      label: "Wild battle run-only main menu",
      phase: "main-menu",
      expectedDecision: {
        buttons: ["A"],
        fallbackAllowed: false,
        id: "run",
        kind: "run",
        policy: "battle",
        targetName: "run",
        targetType: "run",
      },
      runtimeGameState: {
        ...runtimeGameState,
        battleActionState: {
          ...battleActionState,
          canRun: true,
          items: [],
          moves: battleActionState.moves.map((move) => ({ ...move, pp: 0 })),
          party: battleActionState.party.map((partyMember) => ({
            ...partyMember,
            hp: partyMember.active ? partyMember.hp : 0,
          })),
          ui: {
            cursorIndex: 3,
            mode: "main-menu",
            source: "ram",
          },
        },
        battleType: 0,
      },
    };
  }
  return rivalBattleFixture(id);
}

function battlePolicyReplaySnapshot(action: BattlePolicyAction | undefined):
  | {
      buttons: readonly string[];
      id: string;
      kind: string;
      targetName: string | undefined;
      targetType: string | undefined;
    }
  | undefined {
  if (!action) {
    return;
  }
  return {
    buttons: action.buttons,
    id: action.id,
    kind: action.kind,
    targetName: targetNameForBattlePolicyAction(action),
    targetType: targetTypeForBattlePolicyAction(action),
  };
}

function highestConfiguredPriorityAction(
  actions: readonly BattlePolicyAction[]
): BattlePolicyAction | undefined {
  return [...actions].sort(compareByConfiguredBattlePolicyPriority)[0];
}

function compareByConfiguredBattlePolicyPriority(
  left: BattlePolicyAction,
  right: BattlePolicyAction
): number {
  return (
    configuredBattlePolicyRank(left.kind) -
      configuredBattlePolicyRank(right.kind) ||
    battlePolicyTargetRank(left) - battlePolicyTargetRank(right) ||
    left.id.localeCompare(right.id)
  );
}

function configuredBattlePolicyRank(
  kind: BattlePolicyAction["kind"] | undefined
): number {
  if (!kind) {
    return Number.MAX_SAFE_INTEGER;
  }

  const rank = BASIC_BATTLE_POLICY_RULE_ORDER.indexOf(kind);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function battlePolicyTargetRank(action: BattlePolicyAction): number {
  switch (action.target.type) {
    case "item":
      return action.target.item.slot;
    case "move":
      return action.target.move.slot;
    case "party":
      return action.target.partyMember.slot;
    case "run":
      return 0;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

function targetNameForBattlePolicyAction(
  action: BattlePolicyAction | undefined
): string | undefined {
  if (!action) {
    return;
  }
  switch (action.target.type) {
    case "item":
      return action.target.item.name ?? `item:${action.target.item.slot}`;
    case "move":
      return action.target.move.name ?? `move:${action.target.move.slot}`;
    case "party":
      return (
        action.target.partyMember.name ??
        `party:${action.target.partyMember.slot}`
      );
    case "run":
      return "run";
    default:
      return;
  }
}

function targetTypeForBattlePolicyAction(
  action: BattlePolicyAction | undefined
): BattlePolicyAction["target"]["type"] | undefined {
  return action?.target.type;
}
