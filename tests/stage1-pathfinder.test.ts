import { describe, expect, it } from "vitest";
import type { PokemonStateObservation } from "../src/pokemon-state";
import { POKEMON_RED_STAGE1_MAP_IDS } from "../src/stage1-evaluator";
import { planStage1Path } from "../src/stage1-pathfinder";
import type { StuckMemorySnapshot } from "../src/stuck-memory";

const route1State: PokemonStateObservation = {
  battle: false,
  battleResult: null,
  battleType: null,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
  menuLike: "visual-fallback",
  position: { x: 10, y: 18 },
  readStatus: "available",
};

describe("planStage1Path", () => {
  it("skips the Pallet Town orientation waypoint after leaving the house", () => {
    const plan = planStage1Path({
      state: {
        ...route1State,
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        position: { x: 10, y: 12 },
      },
    });

    expect(plan).toMatchObject({
      action: "Up",
      nextWaypoint: {
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          x: 10,
          y: 0,
        },
      },
    });
  });

  it("uses Dijkstra route planning toward Viridian City on Route 1", () => {
    const plan = planStage1Path({ state: route1State });

    expect(plan).toMatchObject({
      action: "Up",
      backtrackingActive: false,
      method: "dijkstra",
      targetNodeId: "goal:viridian-city",
    });
    expect(plan?.path.at(-1)).toBe("goal:viridian-city");
    expect(plan?.reason).toContain("press/hold Up");
  });

  it("backtracks laterally after the same local Up edge fails at least 3 times", () => {
    const stuckMemory: StuckMemorySnapshot = {
      failedMovementEdges: [
        {
          action: "hold:Up",
          attempts: 3,
          context: "map=12 x=10 y=18 facing=up",
          lastSeenTurn: 7,
        },
      ],
      repeatedStateContexts: [],
      recentRecoveryAttempts: [],
      stuckEvents: 1,
    };

    const plan = planStage1Path({ state: route1State, stuckMemory });

    expect(plan).toMatchObject({
      action: "Left",
      backtrackingActive: true,
      blockedActions: ["Up"],
    });
    expect(plan?.reason).toContain("blocked=Up");
  });

  it("does not produce a route movement plan during battle", () => {
    expect(
      planStage1Path({
        state: {
          ...route1State,
          battle: true,
        },
      })
    ).toBeUndefined();
  });
});
