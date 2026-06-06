import { describe, expect, it } from "vitest";
import type { PokemonStateObservation } from "../src/pokemon-state";
import {
  combineStage1EvaluatorOutputs,
  evaluateStage1LoopScore,
  evaluateStage1MapTransitionProgress,
  evaluateStage1RepeatedActionScore,
  evaluateStage1StuckScore,
  evaluateStage1ViridianCitySuccess,
  POKEMON_RED_STAGE1_MAP_IDS,
  STAGE1_EVALUATOR_SCHEMA_VERSION,
  STAGE1_VICTORY_CONDITION,
  type Stage1EvaluatorOutput,
  stage1EvaluatorOutputSchema,
} from "../src/stage1-evaluator";

const basePokemonState = {
  battle: false,
  battleResult: 0,
  battleType: 0,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
  menuLike: "visual-fallback",
  position: {
    x: 10,
    y: 12,
  },
  readStatus: "available",
} satisfies PokemonStateObservation;

function evaluatorOutput(
  overrides: Partial<Stage1EvaluatorOutput> = {}
): Stage1EvaluatorOutput {
  return stage1EvaluatorOutputSchema.parse({
    confidence: 0.8,
    diagnostics: [],
    progressScore: 0.5,
    progressStatus: "progress",
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
    ...overrides,
  });
}

function pokemonState(
  overrides: Partial<PokemonStateObservation> = {}
): PokemonStateObservation {
  return {
    ...basePokemonState,
    ...overrides,
    position: {
      ...basePokemonState.position,
      ...overrides.position,
    },
  };
}

const viridianRouteReplayFixture = [
  pokemonState({
    mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
    position: {
      x: 10,
      y: 12,
    },
  }),
  pokemonState({
    mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
    position: {
      x: 10,
      y: 0,
    },
  }),
  pokemonState({
    mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
    position: {
      x: 10,
      y: 35,
    },
  }),
  pokemonState({
    mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
    position: {
      x: 10,
      y: 20,
    },
  }),
  pokemonState({
    mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
    position: {
      x: 10,
      y: 0,
    },
  }),
  pokemonState({
    mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
    position: {
      x: 10,
      y: 30,
    },
  }),
] as const satisfies readonly PokemonStateObservation[];

describe("Stage 1 evaluator output schema", () => {
  it("accepts a progress-first evaluator output with diagnostics", () => {
    const output = {
      confidence: 0.82,
      diagnostics: [
        {
          category: "progress",
          evidence: ["map=1 x=4 y=8 moved toward Route 1"],
          message: "Run made northbound early-game progress.",
          severity: "info",
        },
      ],
      progressScore: 0.45,
      progressStatus: "progress",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    } satisfies Stage1EvaluatorOutput;

    expect(stage1EvaluatorOutputSchema.parse(output)).toEqual(output);
  });

  it("accepts optional metadata without making fps part of scoring", () => {
    const output = {
      confidence: 0.9,
      diagnostics: [],
      metadata: {
        extra: {
          note: "candidate guide patch observed but not activated",
        },
        fps: 59.7,
        frameEnd: 1240,
        frameStart: 1000,
        runId: "00001-stage1",
        tokenUsage: {
          totalTokens: 4096,
        },
        turn: 7,
      },
      progressScore: 1,
      progressStatus: "victory",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    } satisfies Stage1EvaluatorOutput;

    expect(stage1EvaluatorOutputSchema.parse(output)).toEqual(output);
  });

  it("rejects out-of-range progress scores and confidence", () => {
    expect(() =>
      stage1EvaluatorOutputSchema.parse({
        confidence: 0.5,
        diagnostics: [],
        progressScore: 1.1,
        progressStatus: "progress",
        schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
        victoryCondition: STAGE1_VICTORY_CONDITION,
      })
    ).toThrow();

    expect(() =>
      stage1EvaluatorOutputSchema.parse({
        confidence: -0.1,
        diagnostics: [],
        progressScore: 0.5,
        progressStatus: "progress",
        schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
        victoryCondition: STAGE1_VICTORY_CONDITION,
      })
    ).toThrow();
  });

  it("keeps the Pokemon Red Stage 1 victory condition explicit", () => {
    expect(() =>
      stage1EvaluatorOutputSchema.parse({
        confidence: 1,
        diagnostics: [],
        progressScore: 1,
        progressStatus: "victory",
        schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
        victoryCondition: "reach-pallet-town",
      })
    ).toThrow();
  });
});

describe("Stage 1 Viridian City success evaluator", () => {
  it("detects Viridian City arrival from available Pokemon Red RAM state", () => {
    const output = evaluateStage1ViridianCitySuccess({
      currentState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
        position: {
          x: 18,
          y: 34,
        },
      }),
      metadata: {
        frameEnd: 1024,
        frameStart: 960,
        fps: 59.7,
      },
    });

    expect(output).toMatchObject({
      confidence: 0.95,
      metadata: {
        evaluatorId: "stage1.viridian-city-success",
        fps: 59.7,
        frameEnd: 1024,
        frameStart: 960,
      },
      progressScore: 1,
      progressStatus: "victory",
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "progress",
      evidence: ["map=1 x=18 y=34", "victoryMapId=1"],
      severity: "info",
    });
    expect(output.diagnostics[0]?.message).toContain(
      "Stage 1 victory condition reached"
    );
    expect(stage1EvaluatorOutputSchema.parse(output)).toEqual(output);
  });

  it("does not claim victory before the Viridian City map is reached", () => {
    const output = evaluateStage1ViridianCitySuccess({
      currentState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: {
          x: 10,
          y: 3,
        },
      }),
    });

    expect(output).toMatchObject({
      confidence: 0.8,
      progressScore: 0,
      progressStatus: "no-progress",
    });
    expect(output.diagnostics[0]?.evidence).toEqual([
      "map=12 x=10 y=3",
      "victoryMapId=1",
    ]);
  });

  it("detects Viridian City success only at the final replay fixture state", () => {
    const outputs = viridianRouteReplayFixture.map((currentState) =>
      evaluateStage1ViridianCitySuccess({ currentState })
    );

    expect(outputs.map((output) => output.progressStatus)).toEqual([
      "no-progress",
      "no-progress",
      "no-progress",
      "no-progress",
      "no-progress",
      "victory",
    ]);
    expect(outputs.map((output) => output.progressScore)).toEqual([
      0, 0, 0, 0, 0, 1,
    ]);
    expect(outputs.at(-1)?.diagnostics[0]?.evidence).toEqual([
      "map=1 x=10 y=30",
      "victoryMapId=1",
    ]);
  });

  it("requires available RAM map and position signals before evaluating success", () => {
    const output = evaluateStage1ViridianCitySuccess({
      currentState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
        position: {
          x: null,
          y: null,
        },
        readStatus: "unavailable",
      }),
    });

    expect(output).toMatchObject({
      confidence: 0.2,
      progressScore: 0,
      progressStatus: "unknown",
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "observation",
      severity: "warning",
    });
  });
});

describe("Stage 1 map transition progress evaluator", () => {
  it("detects the known Pallet Town to Route 1 boundary as progress", () => {
    const output = evaluateStage1MapTransitionProgress({
      currentState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: {
          x: 10,
          y: 35,
        },
      }),
      metadata: {
        frameEnd: 260,
        frameStart: 120,
        fps: 59.7,
      },
      previousState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        position: {
          x: 10,
          y: 0,
        },
      }),
    });

    expect(output).toMatchObject({
      confidence: 0.92,
      metadata: {
        evaluatorId: "stage1.map-transition-progress",
        fps: 59.7,
        frameEnd: 260,
        frameStart: 120,
      },
      progressScore: 0.55,
      progressStatus: "progress",
    });
    expect(output.diagnostics[0]?.evidence).toEqual([
      "map=0 x=10 y=0 -> map=12 x=10 y=35",
      "transition=route:pallet-to-route-1",
    ]);
    expect(stage1EvaluatorOutputSchema.parse(output)).toEqual(output);
  });

  it("detects the known Route 1 to Viridian City boundary as victory", () => {
    const output = evaluateStage1MapTransitionProgress({
      currentState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
        position: {
          x: 10,
          y: 30,
        },
      }),
      previousState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: {
          x: 10,
          y: 0,
        },
      }),
    });

    expect(output).toMatchObject({
      progressScore: 1,
      progressStatus: "victory",
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
    expect(output.diagnostics[0]?.message).toContain("victory reached");
  });

  it("validates a focused Pallet Town to Viridian City replay fixture", () => {
    const outputs = viridianRouteReplayFixture.map((currentState, index) =>
      evaluateStage1MapTransitionProgress({
        currentState,
        previousState: viridianRouteReplayFixture[index - 1],
      })
    );

    expect(outputs.map((output) => output.progressStatus)).toEqual([
      "no-progress",
      "progress",
      "progress",
      "progress",
      "progress",
      "victory",
    ]);
    expect(
      outputs.map((output) => Number(output.progressScore.toFixed(2)))
    ).toEqual([0.15, 0.45, 0.55, 0.7, 0.9, 1]);
    expect(outputs[2]?.diagnostics[0]?.evidence).toEqual([
      "map=0 x=10 y=0 -> map=12 x=10 y=35",
      "transition=route:pallet-to-route-1",
    ]);
    expect(outputs.at(-1)).toMatchObject({
      progressScore: 1,
      progressStatus: "victory",
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
    expect(outputs.at(-1)?.diagnostics[0]?.evidence).toEqual([
      "map=12 x=10 y=0 -> map=1 x=10 y=30",
      "transition=route:route-1-to-viridian",
    ]);
  });

  it("scores same-map northbound movement toward the next known boundary", () => {
    const output = evaluateStage1MapTransitionProgress({
      currentState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: {
          x: 10,
          y: 15,
        },
      }),
      previousState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: {
          x: 10,
          y: 20,
        },
      }),
    });

    expect(output.progressStatus).toBe("progress");
    expect(output.progressScore).toBeCloseTo(0.75);
    expect(output.diagnostics[0]?.message).toContain("Northbound movement");
  });

  it("flags reverse known map transitions as regressions", () => {
    const output = evaluateStage1MapTransitionProgress({
      currentState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        position: {
          x: 10,
          y: 0,
        },
      }),
      previousState: pokemonState({
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        position: {
          x: 10,
          y: 35,
        },
      }),
    });

    expect(output).toMatchObject({
      progressScore: 0.15,
      progressStatus: "regressed",
    });
    expect(output.diagnostics[0]).toMatchObject({
      evidence: [
        "map=12 x=10 y=35 -> map=0 x=10 y=0",
        "reverseTransition=route:pallet-to-route-1",
      ],
      severity: "warning",
    });
  });

  it("does not fabricate transition progress from unavailable or unknown maps", () => {
    expect(
      evaluateStage1MapTransitionProgress({
        currentState: pokemonState({
          mapId: null,
          position: {
            x: null,
            y: null,
          },
          readStatus: "unavailable",
        }),
      })
    ).toMatchObject({
      progressScore: 0,
      progressStatus: "unknown",
    });

    expect(
      evaluateStage1MapTransitionProgress({
        currentState: pokemonState({
          mapId: 99,
        }),
      })
    ).toMatchObject({
      progressScore: 0,
      progressStatus: "unknown",
    });
  });
});

describe("Stage 1 loop-score evaluator", () => {
  it("detects a stationary repeated state/action cycle as stuck behavior", () => {
    const state = pokemonState({
      direction: "up",
      mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      position: {
        x: 10,
        y: 12,
      },
    });
    const output = evaluateStage1LoopScore({
      history: [
        { action: "mgba_hold:Up", state, turn: 1 },
        { action: "mgba_hold:Up", state, turn: 2 },
        { action: "mgba_hold:Up", state, turn: 3 },
        { action: "mgba_hold:Up", state, turn: 4 },
      ],
      metadata: {
        frameEnd: 720,
        frameStart: 120,
        fps: 59.7,
      },
    });

    expect(output).toMatchObject({
      confidence: 0.65,
      metadata: {
        evaluatorId: "stage1.loop-score",
        extra: {
          loop: {
            cycleLength: 1,
            loopScore: 1,
            repeats: 4,
            usableHistoryLength: 4,
          },
        },
        fps: 59.7,
        frameEnd: 720,
        frameStart: 120,
      },
      progressScore: 0,
      progressStatus: "stuck",
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "loop",
      evidence: [
        "cycleLength=1",
        "repeats=4",
        "loopScore=1",
        "map:0|x:10|y:12|dir:up|overworld:no-dialogue:no-menu|action:mgba_hold:Up",
      ],
      severity: "warning",
    });
    expect(output.diagnostics[1]).toMatchObject({
      category: "repeated-action",
      severity: "warning",
    });
    expect(stage1EvaluatorOutputSchema.parse(output)).toEqual(output);
  });

  it("detects a two-state action bounce as a cyclical loop", () => {
    const northTile = pokemonState({
      direction: "down",
      mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
      position: {
        x: 8,
        y: 11,
      },
    });
    const southTile = pokemonState({
      direction: "up",
      mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
      position: {
        x: 8,
        y: 12,
      },
    });

    const output = evaluateStage1LoopScore({
      history: [
        { action: "mgba_hold:Up", state: southTile, turn: 1 },
        { action: "mgba_hold:Down", state: northTile, turn: 2 },
        { action: "mgba_hold:Up", state: southTile, turn: 3 },
        { action: "mgba_hold:Down", state: northTile, turn: 4 },
        { action: "mgba_hold:Up", state: southTile, turn: 5 },
        { action: "mgba_hold:Down", state: northTile, turn: 6 },
      ],
    });

    expect(output.progressStatus).toBe("no-progress");
    expect(output.progressScore).toBeCloseTo(1 / 6);
    expect(output.metadata?.extra?.loop).toMatchObject({
      cycleLength: 2,
      loopScore: 2 / 3,
      repeats: 3,
      usableHistoryLength: 6,
    });
    expect(output.diagnostics).toHaveLength(1);
    expect(output.diagnostics[0]?.message).toContain("emerging cycle");
  });

  it("does not penalize repeated northbound action when RAM position changes", () => {
    const output = evaluateStage1LoopScore({
      history: [
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 30 },
          }),
          turn: 1,
        },
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 29 },
          }),
          turn: 2,
        },
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 28 },
          }),
          turn: 3,
        },
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 27 },
          }),
          turn: 4,
        },
      ],
    });

    expect(output).toMatchObject({
      progressScore: 0.5,
      progressStatus: "no-progress",
    });
    expect(output.metadata?.extra?.loop).toMatchObject({
      loopScore: 0,
      usableHistoryLength: 4,
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "loop",
      severity: "info",
    });
  });

  it("requires usable state/action history before evaluating cycles", () => {
    const output = evaluateStage1LoopScore({
      history: [
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            readStatus: "unavailable",
          }),
        },
      ],
    });

    expect(output).toMatchObject({
      confidence: 0.2,
      progressScore: 0,
      progressStatus: "unknown",
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "observation",
      severity: "warning",
    });
  });
});

describe("Stage 1 repeated-action-score evaluator", () => {
  it("detects excessive equivalent stationary actions at the three-attempt trigger", () => {
    const state = pokemonState({
      mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      position: {
        x: 10,
        y: 12,
      },
    });
    const output = evaluateStage1RepeatedActionScore({
      history: [
        { action: "mgba_hold:Up", state, turn: 1 },
        {
          action: 'hold: {"button":"Up","duration":12}',
          state,
          turn: 2,
        },
        {
          input: {
            button: "Up",
            duration: 24,
          },
          state,
          toolName: "mgba_hold",
          turn: 3,
        },
      ],
      metadata: {
        frameEnd: 480,
        frameStart: 120,
        fps: 59.7,
      },
    });

    expect(output).toMatchObject({
      confidence: 0.6,
      metadata: {
        evaluatorId: "stage1.repeated-action-score",
        extra: {
          repeatedAction: {
            actionKey: "hold:up",
            currentRunLength: 3,
            maxRunLength: 3,
            positionChanged: false,
            progressDelta: 0,
            repetitionScore: 1,
            repetitionThreshold: 3,
            usableActionCount: 3,
            windowSize: 10,
          },
        },
        fps: 59.7,
        frameEnd: 480,
        frameStart: 120,
      },
      progressScore: 0,
      progressStatus: "stuck",
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "repeated-action",
      evidence: [
        "action=hold:up",
        "currentRunLength=3",
        "maxRunLength=3",
        "repetitionThreshold=3",
        "positionChanged=false",
        "first=map=0 x=10 y=12",
        "current=map=0 x=10 y=12",
        "progressDelta=0",
        "map=0 x=10 y=12|action:hold:up",
        "map=0 x=10 y=12|action:hold:up",
        "map=0 x=10 y=12|action:hold:up",
      ],
      severity: "warning",
    });
    expect(stage1EvaluatorOutputSchema.parse(output)).toEqual(output);
  });

  it("does not classify repeated northbound movement as stuck when RAM progress changes", () => {
    const output = evaluateStage1RepeatedActionScore({
      history: [
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 30 },
          }),
          turn: 1,
        },
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 29 },
          }),
          turn: 2,
        },
        {
          action: "mgba_hold:Up",
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 28 },
          }),
          turn: 3,
        },
      ],
    });

    expect(output.progressStatus).toBe("progress");
    expect(output.progressScore).toBeCloseTo(0.62);
    expect(output.diagnostics[0]).toMatchObject({
      category: "repeated-action",
      severity: "info",
    });
    expect(output.diagnostics[0]?.evidence).toContain("positionChanged=true");
    expect(output.metadata?.extra?.repeatedAction).toMatchObject({
      actionKey: "hold:up",
      currentRunLength: 3,
      positionChanged: true,
    });
  });

  it("does not trigger when the current repeated-action run is below threshold", () => {
    const output = evaluateStage1RepeatedActionScore({
      history: [
        { action: "mgba_hold:Left", turn: 1 },
        { action: "mgba_hold:Left", turn: 2 },
        { action: "mgba_hold:Up", turn: 3 },
      ],
    });

    expect(output).toMatchObject({
      confidence: 0.6,
      progressScore: 0.5,
      progressStatus: "no-progress",
    });
    expect(output.diagnostics[0]).toMatchObject({
      evidence: [
        "currentRunLength=1",
        "maxRunLength=2",
        "repetitionThreshold=3",
      ],
      severity: "info",
    });
  });

  it("requires at least two usable action observations before scoring repetition", () => {
    const output = evaluateStage1RepeatedActionScore({
      history: [{ action: "   " }, { turn: 2 }],
    });

    expect(output).toMatchObject({
      confidence: 0.2,
      progressScore: 0,
      progressStatus: "unknown",
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "observation",
      evidence: ["usableActionCount=0", "windowSize=10"],
      severity: "warning",
    });
  });
});

describe("Stage 1 stuck-score evaluator", () => {
  it("detects lack of meaningful progress across the configured observation window", () => {
    const state = pokemonState({
      mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
      position: {
        x: 10,
        y: 20,
      },
    });
    const output = evaluateStage1StuckScore({
      history: [
        { frame: 120, state, turn: 1 },
        { frame: 240, state, turn: 2 },
        { frame: 360, state, turn: 3 },
        { frame: 480, state, turn: 4 },
      ],
      metadata: {
        frameEnd: 480,
        frameStart: 120,
        fps: 59.7,
      },
      windowSize: 4,
    });

    expect(output).toMatchObject({
      confidence: 0.7,
      metadata: {
        evaluatorId: "stage1.stuck-score",
        extra: {
          stuck: {
            bestProgressDelta: 0,
            minimumMeaningfulProgressDelta: 0.05,
            stuckScore: 1,
            stuckScoreThreshold: 0.8,
            usableWindowLength: 4,
            windowSize: 4,
          },
        },
        fps: 59.7,
        frameEnd: 480,
        frameStart: 120,
      },
      progressScore: 0,
      progressStatus: "stuck",
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "stuck",
      evidence: [
        "windowSize=4",
        "first=map=12 x=10 y=20 score=0.7",
        "current=map=12 x=10 y=20 score=0.7",
        "bestProgressDelta=0",
        "minimumMeaningfulProgressDelta=0.05",
        "stuckScore=1",
      ],
      severity: "warning",
    });
    expect(stage1EvaluatorOutputSchema.parse(output)).toEqual(output);
  });

  it("reports progress when the observation window advances toward Viridian City", () => {
    const output = evaluateStage1StuckScore({
      history: [
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 30 },
          }),
          turn: 1,
        },
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 27 },
          }),
          turn: 2,
        },
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 24 },
          }),
          turn: 3,
        },
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 21 },
          }),
          turn: 4,
        },
      ],
      windowSize: 4,
    });

    expect(output.progressStatus).toBe("progress");
    expect(output.progressScore).toBeCloseTo(0.69);
    expect(output.metadata?.extra?.stuck).toMatchObject({
      minimumMeaningfulProgressDelta: 0.05,
      stuckScore: 0,
      usableWindowLength: 4,
      windowSize: 4,
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "progress",
      severity: "info",
    });
  });

  it("uses custom window and progress thresholds to tune stuck detection", () => {
    const output = evaluateStage1StuckScore({
      history: [
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 30 },
          }),
        },
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 28 },
          }),
        },
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            position: { x: 10, y: 26 },
          }),
        },
      ],
      minimumMeaningfulProgressDelta: 0.2,
      windowSize: 3,
    });

    expect(output.progressStatus).toBe("stuck");
    expect(output.progressScore).toBeCloseTo(0.128);
    expect(output.metadata?.extra?.stuck).toMatchObject({
      minimumMeaningfulProgressDelta: 0.2,
      windowSize: 3,
    });
    expect(
      Number(
        (output.metadata?.extra?.stuck as { stuckScore: number }).stuckScore
      )
    ).toBeCloseTo(0.8);
  });

  it("requires a full usable observation window before scoring stuck behavior", () => {
    const output = evaluateStage1StuckScore({
      history: [
        {
          state: pokemonState({
            readStatus: "unavailable",
          }),
        },
        {
          state: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
            position: { x: 10, y: 12 },
          }),
        },
      ],
      windowSize: 3,
    });

    expect(output).toMatchObject({
      confidence: 0.2,
      progressScore: 0,
      progressStatus: "unknown",
    });
    expect(output.diagnostics[0]).toMatchObject({
      category: "observation",
      evidence: ["usableWindowLength=1", "windowSize=3"],
      severity: "warning",
    });
  });
});

describe("Stage 1 evaluator aggregation", () => {
  it("returns schema-conformant aggregate outputs for multiple evaluators", () => {
    const aggregate = combineStage1EvaluatorOutputs(
      [
        {
          evaluatorId: "route-progress",
          output: evaluatorOutput({
            metadata: {
              frameEnd: 300,
              frameStart: 120,
              tokenUsage: {
                inputTokens: 100,
                outputTokens: 20,
              },
            },
            progressScore: 0.7,
            progressStatus: "progress",
          }),
        },
        {
          evaluatorId: "repeated-action",
          output: evaluatorOutput({
            metadata: {
              frameEnd: 420,
              frameStart: 240,
              tokenUsage: {
                inputTokens: 30,
                reasoningTokens: 10,
                totalTokens: 45,
              },
            },
            progressScore: 0.3,
            progressStatus: "no-progress",
          }),
        },
      ],
      {
        metadata: {
          runId: "stage1-schema-conformance",
        },
      }
    );

    expect(stage1EvaluatorOutputSchema.parse(aggregate)).toEqual(aggregate);
    expect(aggregate).toMatchObject({
      metadata: {
        frameEnd: 420,
        frameStart: 120,
        runId: "stage1-schema-conformance",
        tokenUsage: {
          inputTokens: 130,
          outputTokens: 20,
          reasoningTokens: 10,
          totalTokens: 45,
        },
      },
      progressStatus: "progress",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  });

  it("normalizes and merges component outputs into one weighted score", () => {
    const aggregate = combineStage1EvaluatorOutputs([
      {
        evaluatorId: "map-transition",
        output: evaluatorOutput({
          confidence: 0.75,
          diagnostics: [
            {
              category: "progress",
              message: "Route 1 map transition detected.",
              severity: "info",
            },
          ],
          metadata: {
            frameEnd: 640,
            frameStart: 0,
          },
          progressScore: 0.8,
          progressStatus: "progress",
        }),
        weight: 2,
      },
      {
        evaluatorId: "loop",
        output: evaluatorOutput({
          confidence: 0.5,
          diagnostics: [
            {
              category: "loop",
              evidence: ["same-state/same-action repeated 3 times"],
              message: "Loop behavior detected.",
              severity: "warning",
            },
          ],
          metadata: {
            frameEnd: 1280,
            frameStart: 641,
          },
          progressScore: 0.2,
          progressStatus: "stuck",
        }),
      },
    ]);

    expect(aggregate.progressScore).toBeCloseTo(0.6);
    expect(aggregate.confidence).toBeCloseTo(2 / 3);
    expect(aggregate.progressStatus).toBe("stuck");
    expect(aggregate.diagnostics).toHaveLength(3);
    expect(aggregate.metadata).toMatchObject({
      evaluatorId: "stage1.aggregate",
      extra: {
        aggregate: {
          componentCount: 2,
          components: [
            {
              evaluatorId: "loop",
            },
            {
              evaluatorId: "map-transition",
            },
          ],
        },
      },
      frameEnd: 1280,
      frameStart: 0,
    });
  });

  it("lets Viridian victory dominate the aggregate score and status", () => {
    const aggregate = combineStage1EvaluatorOutputs([
      {
        evaluatorId: "viridian-success",
        output: evaluateStage1ViridianCitySuccess({
          currentState: pokemonState({
            mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
            position: {
              x: 18,
              y: 34,
            },
          }),
        }),
      },
      {
        evaluatorId: "repeated-action",
        output: evaluatorOutput({
          diagnostics: [
            {
              category: "repeated-action",
              message: "Repeated north taps were observed.",
              severity: "warning",
            },
          ],
          progressScore: 0.1,
          progressStatus: "stuck",
        }),
      },
    ]);

    expect(aggregate.progressScore).toBe(1);
    expect(aggregate.progressStatus).toBe("victory");
  });

  it("keeps fps and token usage diagnostic instead of score-driving", () => {
    const first = combineStage1EvaluatorOutputs([
      {
        evaluatorId: "tool-error",
        output: evaluatorOutput({
          metadata: {
            fps: 30,
            tokenUsage: {
              totalTokens: 100,
            },
          },
          progressScore: 0.4,
        }),
      },
    ]);
    const second = combineStage1EvaluatorOutputs([
      {
        evaluatorId: "tool-error",
        output: evaluatorOutput({
          metadata: {
            fps: 120,
            tokenUsage: {
              totalTokens: 10_000,
            },
          },
          progressScore: 0.4,
        }),
      },
    ]);

    expect(first.progressScore).toBe(second.progressScore);
    expect(first.metadata?.tokenUsage).toEqual({ totalTokens: 100 });
    expect(second.metadata?.tokenUsage).toEqual({ totalTokens: 10_000 });
  });

  it("aggregates multiple named evaluator outputs deterministically", () => {
    const inputs = [
      {
        evaluatorId: "z-route-progress",
        output: evaluatorOutput({
          diagnostics: [
            {
              category: "progress",
              message: "Northbound route progress detected.",
              severity: "info",
            },
          ],
          progressScore: 0.8,
          progressStatus: "progress",
        }),
        weight: 2,
      },
      {
        evaluatorId: "a-loop-check",
        output: evaluatorOutput({
          diagnostics: [
            {
              category: "loop",
              message: "No repeated action loop detected.",
              severity: "info",
            },
          ],
          progressScore: 0.4,
          progressStatus: "no-progress",
        }),
      },
      {
        evaluatorId: "m-stuck-check",
        output: evaluatorOutput({
          diagnostics: [
            {
              category: "stuck",
              message: "Stationary movement evidence crossed threshold.",
              severity: "warning",
            },
          ],
          progressScore: 0.2,
          progressStatus: "stuck",
        }),
      },
    ];

    const aggregate = combineStage1EvaluatorOutputs(inputs);
    const reversedAggregate = combineStage1EvaluatorOutputs(
      [...inputs].reverse()
    );

    expect(reversedAggregate).toEqual(aggregate);
    expect(aggregate.metadata).toMatchObject({
      extra: {
        aggregate: {
          components: [
            {
              evaluatorId: "a-loop-check",
            },
            {
              evaluatorId: "m-stuck-check",
            },
            {
              evaluatorId: "z-route-progress",
            },
          ],
        },
      },
    });
    expect(aggregate.diagnostics.at(-1)?.evidence).toEqual([
      "a-loop-check: score=0.4 status=no-progress weight=1",
      "m-stuck-check: score=0.2 status=stuck weight=1",
      "z-route-progress: score=0.8 status=progress weight=2",
    ]);
  });

  it("rejects invalid evaluator outputs and weights before aggregation", () => {
    expect(() =>
      combineStage1EvaluatorOutputs([
        {
          output: {
            confidence: 1,
            diagnostics: [],
            progressScore: 2,
            progressStatus: "progress",
            schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
            victoryCondition: STAGE1_VICTORY_CONDITION,
          },
        },
      ])
    ).toThrow();

    expect(() =>
      combineStage1EvaluatorOutputs([
        {
          output: evaluatorOutput(),
          weight: 0,
        },
      ])
    ).toThrow("Stage 1 evaluator weights must be positive finite numbers");
  });
});
