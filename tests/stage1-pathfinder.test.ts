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

  it("aligns horizontally after exiting Red's house before walking north", () => {
    const plan = planStage1Path({
      state: {
        ...route1State,
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        position: { x: 2, y: 7 },
      },
    });

    expect(plan).toMatchObject({
      action: "Right",
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

  it("returns no movement plan after RuntimeGameState reports Viridian City", () => {
    expect(
      planStage1Path({
        state: {
          ...route1State,
          mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
          position: { x: 10, y: 30 },
        },
      })
    ).toBeUndefined();
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

  it("does not block the edge before 3 no-progress attempts", () => {
    const stuckMemory: StuckMemorySnapshot = {
      failedMovementEdges: [
        {
          action: "hold:Up",
          attempts: 2,
          context: "map=12 x=10 y=18 facing=up",
          lastSeenTurn: 6,
        },
      ],
      repeatedStateContexts: [],
      recentRecoveryAttempts: [],
      stuckEvents: 0,
    };

    const plan = planStage1Path({ state: route1State, stuckMemory });

    expect(plan).toMatchObject({
      action: "Up",
      backtrackingActive: false,
      blockedActions: [],
    });
  });

  it("blocks only failed edges matching the current RuntimeGameState position", () => {
    const stuckMemory: StuckMemorySnapshot = {
      failedMovementEdges: [
        {
          action: "hold:Up",
          attempts: 3,
          context: "map=12 x=10 y=19 facing=up",
          lastSeenTurn: 7,
        },
      ],
      repeatedStateContexts: [],
      recentRecoveryAttempts: [],
      stuckEvents: 1,
    };

    const plan = planStage1Path({ state: route1State, stuckMemory });

    expect(plan).toMatchObject({
      action: "Up",
      backtrackingActive: false,
      blockedActions: [],
    });
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
