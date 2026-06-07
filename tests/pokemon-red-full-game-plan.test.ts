import { describe, expect, it } from "vitest";
import {
  getActiveGoalStages,
  getFullGameCompletionStage,
  getRuntimeMemoryLayers,
  POKEMON_RED_FULL_GAME_OBJECTIVE,
  POKEMON_RED_GOAL_STAGES,
  POKEMON_RED_MEMORY_LAYERS,
} from "../src/pokemon-red-full-game-plan";

describe("Pokemon Red full-game plan", () => {
  it("extends the project objective beyond Viridian City to champion completion", () => {
    expect(POKEMON_RED_GOAL_STAGES.map((stage) => stage.objective)).toEqual([
      "reach-player-control",
      "reach-viridian-city",
      "deliver-oaks-parcel-and-get-pokedex",
      "beat-brock",
      "clear-badges-hms-and-dungeons",
      POKEMON_RED_FULL_GAME_OBJECTIVE,
    ]);
    expect(getFullGameCompletionStage()).toMatchObject({
      completionSignal: "Champion is defeated and credits can roll.",
      objective: POKEMON_RED_FULL_GAME_OBJECTIVE,
      status: "planned",
    });
  });

  it("keeps current controller authority honest while full-game stages remain planned", () => {
    expect(getActiveGoalStages().map((stage) => stage.id)).toEqual([
      "stage0-control-bootstrap",
      "stage1-viridian-route",
    ]);
    expect(
      POKEMON_RED_GOAL_STAGES.filter((stage) => stage.status === "planned").map(
        (stage) => stage.id
      )
    ).toEqual([
      "stage2-oaks-parcel",
      "stage3-brock",
      "stage4-badges-hms-dungeons",
      "stage5-elite-four-champion",
    ]);
  });

  it("documents layered memory as runtime, proposal, and reference authority", () => {
    expect(getRuntimeMemoryLayers().map((layer) => layer.id)).toEqual([
      "control-memory",
      "mode-phase-memory",
      "world-route-memory",
      "rule-memory",
      "skill-library",
      "trace-failure-memory",
      "shared-strategy-memory",
    ]);
    expect(POKEMON_RED_MEMORY_LAYERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authority: "proposal",
          id: "candidate-promotion-memory",
        }),
        expect.objectContaining({
          authority: "reference",
          id: "manual-roadmap-memory",
        }),
      ])
    );
  });
});
