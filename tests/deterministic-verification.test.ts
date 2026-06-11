import { describe, expect, it } from "vitest";
import { OAK_DIALOGUE_PHASE_CHECKPOINTS } from "../src/deterministic-policy";
import {
  resolveDeterministicVerificationExpectedOutcome,
  verifyDeterministicOutcome,
  verifyPokemonRedStarterSelectionSequence,
} from "../src/deterministic-verification";
import type { MgbaObservation } from "../src/observation";
import { detectPokemonPhase } from "../src/phase-detector";
import type { PokemonStateObservation } from "../src/pokemon-state";
import type { AutopilotAction } from "../src/stage1-fast-autopilot";
import {
  POKEMON_RED_STARTER_CONTROLLER_SEQUENCES,
  POKEMON_RED_STARTER_PREFERENCES,
} from "../src/starter-preference";
import {
  POST_ACTION_SETTLE_FRAMES,
  SETTLE_POLL_INTERVAL_MS,
} from "../src/supervisor";

const oakAdvance: AutopilotAction = {
  button: "A",
  reason: "advance Oak dialogue",
  toolName: "mgba_tap",
};

const baseState: PokemonStateObservation = {
  battle: false,
  battleResult: null,
  battleType: null,
  dialogueLike: true,
  direction: "up",
  mapId: 0,
  menuLike: false,
  position: { x: 10, y: 1 },
  readStatus: "available",
};

function observation(
  state: PokemonStateObservation,
  frame: number
): MgbaObservation {
  return {
    screenshot: {
      data: "screen",
      mediaType: "image/png",
      path: "/tmp/screen.png",
    },
    state,
    status: {
      activeButtons: [],
      frame,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    },
  };
}

describe("verifyDeterministicOutcome", () => {
  it("forces Oak routine actions through Oak-specific post-action verification", () => {
    expect(
      resolveDeterministicVerificationExpectedOutcome({
        controllerRoutine: {
          button: "A",
          checkpoints: [
            OAK_DIALOGUE_PHASE_CHECKPOINTS.oak_forced_walk_or_dialogue,
          ],
          configuredMaxRepeatedInputs: 6,
          expectedOutcome: "oak-dialogue-progress",
          name: "oak-dialogue-advance",
          repeatedInputsObserved: 2,
          runtimeSource: "RuntimeGameState",
          settle: {
            pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
            strategy: "post-action-frame-settle",
            targetFrames: POST_ACTION_SETTLE_FRAMES,
          },
        },
        expectedOutcome: "dialogue-progress",
      })
    ).toBe("oak-dialogue-progress");
  });

  it("verifies Oak dialogue progress from RAM/phase evidence after A", () => {
    const verification = verifyDeterministicOutcome({
      action: oakAdvance,
      after: observation(
        {
          ...baseState,
          dialogueLike: false,
          position: { x: 10, y: 3 },
        },
        220
      ),
      before: observation(baseState, 100),
      expectedOutcome: "oak-dialogue-progress",
    });

    expect(verification).toEqual({
      diagnostics: [],
      reason:
        "Oak dialogue RAM/phase progressed (oak_forced_walk_or_dialogue -> pallet_before_oak)",
      success: true,
    });
  });

  it.each([
    {
      after: {
        ...baseState,
        mapId: 40,
        position: { x: 5, y: 3 },
      },
      before: baseState,
      name: "Pallet forced Oak event loads Oak Lab",
      reason:
        "Oak dialogue RAM/phase progressed (oak_forced_walk_or_dialogue -> lab_before_starter)",
    },
    {
      after: {
        ...baseState,
        mapId: 40,
        position: { x: 4, y: 2 },
      },
      before: {
        ...baseState,
        mapId: 40,
        position: { x: 5, y: 3 },
      },
      name: "Oak Lab script reaches starter selection",
      reason:
        "Oak dialogue RAM/phase progressed (lab_before_starter -> starter_selection)",
    },
    {
      after: {
        ...baseState,
        battle: true,
        battleType: 1,
        mapId: 40,
        position: { x: 4, y: 2 },
      },
      before: {
        ...baseState,
        mapId: 40,
        position: { x: 4, y: 2 },
      },
      name: "starter selection prompt opens rival battle",
      reason:
        "Oak dialogue RAM/phase progressed (starter_selection -> rival_battle)",
    },
  ])("verifies successful Oak dialogue checkpoint replay: $name", ({
    after,
    before,
    reason,
  }) => {
    const verification = verifyDeterministicOutcome({
      action: oakAdvance,
      after: observation(after, 220),
      before: observation(before, 100),
      expectedOutcome: "oak-dialogue-progress",
    });

    expect(verification).toEqual({
      diagnostics: [],
      reason,
      success: true,
    });
  });

  it("verifies the deterministic Oak dialogue replay completes at rival battle", () => {
    const replay = [
      observation(baseState, 100),
      observation(
        {
          ...baseState,
          mapId: 40,
          position: { x: 5, y: 3 },
        },
        220
      ),
      observation(
        {
          ...baseState,
          mapId: 40,
          position: { x: 4, y: 2 },
        },
        340
      ),
      observation(
        {
          ...baseState,
          battle: true,
          battleType: 1,
          mapId: 40,
          position: { x: 4, y: 2 },
        },
        460
      ),
    ];

    const stepResults = replay.slice(1).map((after, index) =>
      verifyDeterministicOutcome({
        action: oakAdvance,
        after,
        before: replay[index] as MgbaObservation,
        expectedOutcome: "oak-dialogue-progress",
      })
    );

    expect(stepResults).toEqual([
      {
        diagnostics: [],
        reason:
          "Oak dialogue RAM/phase progressed (oak_forced_walk_or_dialogue -> lab_before_starter)",
        success: true,
      },
      {
        diagnostics: [],
        reason:
          "Oak dialogue RAM/phase progressed (lab_before_starter -> starter_selection)",
        success: true,
      },
      {
        diagnostics: [],
        reason:
          "Oak dialogue RAM/phase progressed (starter_selection -> rival_battle)",
        success: true,
      },
    ]);
    expect(
      replay.map((step) => detectPokemonPhase({ observation: step }).phase)
    ).toEqual([
      "oak_forced_walk_or_dialogue",
      "lab_before_starter",
      "starter_selection",
      "rival_battle",
    ]);
    expect(
      detectPokemonPhase({
        observation: replay.at(-1) as MgbaObservation,
      })
    ).toMatchObject({
      phase: "rival_battle",
      waypoint: "win-current-battle",
    });
  });

  it("detects stalled Oak dialogue when frame advances but RAM and phase do not", () => {
    const verification = verifyDeterministicOutcome({
      action: oakAdvance,
      after: observation({ ...baseState }, 220),
      before: observation(baseState, 100),
      expectedOutcome: "oak-dialogue-progress",
    });

    expect(verification.success).toBe(false);
    expect(verification.reason).toContain("stalled Oak dialogue state");
    expect(verification.reason).toContain(
      "phase remained oak_forced_walk_or_dialogue"
    );
    expect(verification.diagnostics).toHaveLength(1);
    expect(verification.diagnostics[0]).toMatchObject({
      kind: "oak-dialogue-checkpoint-failed",
      runtimeSource: "RuntimeGameState",
    });
    expect(verification.diagnostics[0]?.evidence).toEqual([
      "expectedAction=mgba_tap:A",
      "before.runtime=phase=oak_forced_walk_or_dialogue;readStatus=available;mapId=0;x=10;y=1;battle=false;dialogueLike=true;menuLike=false;frame=100",
      "after.runtime=phase=oak_forced_walk_or_dialogue;readStatus=available;mapId=0;x=10;y=1;battle=false;dialogueLike=true;menuLike=false;frame=220",
      "checkpoint=pallet-oak-forced-event",
      "expectedDialogue=state.dialogueLike=true | or Pallet north boundary Oak trigger is blocked by repeated Up movement",
      "expectedGameplay=state.readStatus=available | state.mapId=0 | phase=oak_forced_walk_or_dialogue | state.position.x=8..12 | state.position.y<=2",
      "expectedPostAdvance=state.dialogueLike changes | player position changes during forced walk | state.mapId changes to 40 when Oak Lab loads | phase changes to lab_before_starter",
    ]);
  });

  it("rejects Oak checkpoint mismatches even when RAM changes", () => {
    const verification = verifyDeterministicOutcome({
      action: oakAdvance,
      after: observation(
        {
          ...baseState,
          dialogueLike: false,
          mapId: 37,
          position: { x: 3, y: 6 },
        },
        220
      ),
      before: observation(baseState, 100),
      expectedOutcome: "oak-dialogue-progress",
    });

    expect(verification.success).toBe(false);
    expect(verification.reason).toBe(
      "Oak dialogue did not produce expected RAM/phase progression (oak_forced_walk_or_dialogue -> house_1f)"
    );
    expect(verification.diagnostics).toHaveLength(1);
    expect(verification.diagnostics[0]).toMatchObject({
      kind: "oak-dialogue-checkpoint-failed",
      message:
        "Oak dialogue post-action state did not match an expected checkpoint transition.",
      runtimeSource: "RuntimeGameState",
    });
    expect(verification.diagnostics[0]?.evidence).toEqual([
      "expectedAction=mgba_tap:A",
      "before.runtime=phase=oak_forced_walk_or_dialogue;readStatus=available;mapId=0;x=10;y=1;battle=false;dialogueLike=true;menuLike=false;frame=100",
      "after.runtime=phase=house_1f;readStatus=available;mapId=37;x=3;y=6;battle=false;dialogueLike=false;menuLike=false;frame=220",
      "checkpoint=pallet-oak-forced-event",
      "expectedDialogue=state.dialogueLike=true | or Pallet north boundary Oak trigger is blocked by repeated Up movement",
      "expectedGameplay=state.readStatus=available | state.mapId=0 | phase=oak_forced_walk_or_dialogue | state.position.x=8..12 | state.position.y<=2",
      "expectedPostAdvance=state.dialogueLike changes | player position changes during forced walk | state.mapId changes to 40 when Oak Lab loads | phase changes to lab_before_starter",
    ]);
  });

  it("does not count lost RAM evidence after Oak A as dialogue progress", () => {
    const verification = verifyDeterministicOutcome({
      action: oakAdvance,
      after: observation(
        {
          ...baseState,
          mapId: null,
          position: { x: null, y: null },
          readStatus: "unavailable",
        },
        220
      ),
      before: observation(baseState, 100),
      expectedOutcome: "oak-dialogue-progress",
    });

    expect(verification.success).toBe(false);
    expect(verification.reason).toContain("lost RAM/phase evidence");
    expect(verification.reason).toContain("readStatus=unavailable");
    expect(verification.diagnostics[0]?.evidence).toContain(
      "after.runtime=phase=unknown;readStatus=unavailable;mapId=null;x=null;y=null;battle=false;dialogueLike=true;menuLike=false;frame=220"
    );
  });

  it("returns bounded RuntimeGameState diagnostics for generic dialogue failures", () => {
    const verification = verifyDeterministicOutcome({
      action: oakAdvance,
      after: observation(
        {
          ...baseState,
          dialogueLike: false,
          mapId: 37,
          position: { x: 3, y: 6 },
        },
        100
      ),
      before: observation(
        {
          ...baseState,
          dialogueLike: false,
          mapId: 37,
          position: { x: 3, y: 6 },
        },
        100
      ),
      expectedOutcome: "dialogue-progress",
    });

    expect(verification).toMatchObject({
      reason: "no dialogue/script progress after mgba_tap:A",
      success: false,
    });
    expect(verification.diagnostics).toHaveLength(1);
    expect(verification.diagnostics[0]).toMatchObject({
      kind: "dialogue-progress-not-observed",
      message:
        "Expected dialogue, menu, script, map, position, or battle transition was not observed.",
      runtimeSource: "RuntimeGameState",
    });
    expect(verification.diagnostics[0]?.evidence.length).toBeLessThanOrEqual(8);
    expect(verification.diagnostics[0]?.evidence).toEqual([
      "expectedAction=mgba_tap:A",
      "before.runtime=phase=house_1f;readStatus=available;mapId=37;x=3;y=6;battle=false;dialogueLike=false;menuLike=false;frame=100",
      "after.runtime=phase=house_1f;readStatus=available;mapId=37;x=3;y=6;battle=false;dialogueLike=false;menuLike=false;frame=100",
    ]);
  });
});

describe("verifyPokemonRedStarterSelectionSequence", () => {
  it.each(
    POKEMON_RED_STARTER_PREFERENCES
  )("runs the configured %s starter sequence and verifies the expected choice consistently", (preference) => {
    const verification = verifyPokemonRedStarterSelectionSequence({
      repetitions: 5,
      starterPreference: preference,
    });

    expect(verification).toMatchObject({
      expectedStarter: preference,
      repetitions: 5,
      runtimeSource: "RuntimeGameState",
      sequenceButtons: POKEMON_RED_STARTER_CONTROLLER_SEQUENCES[preference],
      success: true,
    });
    expect(verification.reason).toContain("verified consistently");
    expect(
      verification.runs.map((run) => ({
        confirmedStarter: run.confirmedStarter,
        finalPosition: run.finalPosition,
        selectedStarter: run.selectedStarter,
        sequenceButtons: run.sequenceButtons,
      }))
    ).toEqual(
      Array.from({ length: 5 }, () => ({
        confirmedStarter: preference,
        finalPosition: {
          mapId: verification.expectedTarget.mapId,
          x: verification.expectedTarget.x,
          y: verification.expectedTarget.y,
        },
        selectedStarter: preference,
        sequenceButtons: POKEMON_RED_STARTER_CONTROLLER_SEQUENCES[preference],
      }))
    );
  });

  it("defaults to the deterministic configured starter sequence", () => {
    const verification = verifyPokemonRedStarterSelectionSequence({});

    expect(verification).toMatchObject({
      expectedStarter: "charmander",
      expectedTarget: {
        id: "oak-lab-starter-charmander",
        x: 4,
        y: 2,
      },
      sequenceButtons: ["Left", "Up", "A", "A"],
      success: true,
    });
  });

  it("rejects invalid repeat counts before reporting verification evidence", () => {
    expect(() =>
      verifyPokemonRedStarterSelectionSequence({
        repetitions: 0,
        starterPreference: "charmander",
      })
    ).toThrow("Starter selection verification repetitions must be >= 1.");
  });
});
