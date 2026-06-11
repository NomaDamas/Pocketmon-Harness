import { describe, expect, it } from "vitest";
import type { MgbaObservation } from "../src/observation";
import { detectPokemonPhase } from "../src/phase-detector";
import type { PokemonStateObservation } from "../src/pokemon-state";
import { POKEMON_RED_STAGE1_MAP_IDS } from "../src/stage1-evaluator";
import {
  RIVAL_BATTLE_STATE_FIXTURES,
  rivalBattleObservation,
} from "./fixtures/rival-battle-states";

const baseState: PokemonStateObservation = {
  battle: false,
  battleResult: null,
  battleType: null,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: 38,
  menuLike: "visual-fallback",
  position: { x: 5, y: 1 },
  readStatus: "available",
};

function observation(state: PokemonStateObservation): MgbaObservation {
  return {
    screenshot: { data: "screen", mediaType: "image/png", path: "/tmp/s.png" },
    state,
    status: {
      activeButtons: [],
      frame: 1,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    },
  };
}

describe("detectPokemonPhase", () => {
  it.each([
    {
      expectedPhase: "bedroom_2f",
      expectedWaypoint: "stair-warp",
      label: "Red bedroom 2F",
      mapId: 38,
      position: { x: 3, y: 6 },
    },
    {
      expectedPhase: "house_1f",
      expectedWaypoint: "front-door-warp",
      label: "Red house 1F",
      mapId: 37,
      position: { x: 3, y: 7 },
    },
    {
      expectedPhase: "pallet_before_oak",
      expectedWaypoint: "north-grass-trigger",
      label: "Pallet Town before Oak trigger",
      mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      position: { x: 10, y: 6 },
    },
    {
      expectedPhase: "route1",
      expectedWaypoint: "viridian-city-warp",
      label: "Route 1",
      mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
      position: { x: 5, y: 8 },
    },
    {
      expectedPhase: "viridian",
      expectedWaypoint: "stage1-complete",
      label: "Viridian City",
      mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      position: { x: 18, y: 27 },
    },
  ])("classifies $label from available RuntimeGameState map/position evidence", ({
    expectedPhase,
    expectedWaypoint,
    mapId,
    position,
  }) => {
    expect(
      detectPokemonPhase({
        observation: observation({
          ...baseState,
          battle: false,
          mapId,
          position,
          readStatus: "available",
        }),
      })
    ).toMatchObject({
      phase: expectedPhase,
      waypoint: expectedWaypoint,
    });
  });

  it("classifies known Stage 1 route phases and waypoints", () => {
    expect(
      detectPokemonPhase({ observation: observation(baseState) })
    ).toMatchObject({ phase: "bedroom_2f", waypoint: "stair-warp" });
    expect(
      detectPokemonPhase({
        observation: observation({ ...baseState, mapId: 37 }),
      })
    ).toMatchObject({ phase: "house_1f", waypoint: "front-door-warp" });
    expect(
      detectPokemonPhase({
        observation: observation({ ...baseState, mapId: 12 }),
      })
    ).toMatchObject({ phase: "route1", waypoint: "viridian-city-warp" });
  });

  it("classifies Oak Lab starter selection from RAM Pokeball coordinates", () => {
    expect(
      detectPokemonPhase({
        observation: observation({
          ...baseState,
          mapId: 40,
          position: { x: 4, y: 2 },
        }),
      })
    ).toMatchObject({
      phase: "starter_selection",
      reason: "oak-lab-starter-ram-controller-target",
      waypoint: "select-starter",
    });
  });

  it("keeps non-Pokeball Oak Lab positions in the pre-starter script phase", () => {
    expect(
      detectPokemonPhase({
        observation: observation({
          ...baseState,
          mapId: 40,
          position: { x: 5, y: 3 },
        }),
      })
    ).toMatchObject({
      phase: "lab_before_starter",
      waypoint: "advance-oak-lab-script",
    });
  });

  it("classifies Pallet Oak trigger from RAM position and stuck memory", () => {
    expect(
      detectPokemonPhase({
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
              lastSeenTurn: 3,
            },
          ],
          recentRecoveryAttempts: [],
          repeatedStateContexts: [],
          stuckEvents: 1,
        },
      })
    ).toMatchObject({
      phase: "oak_forced_walk_or_dialogue",
      waypoint: "advance-oak-forced-event",
    });
  });

  it("does not classify the Pallet Oak trigger from repeated movement before the 3-attempt threshold", () => {
    expect(
      detectPokemonPhase({
        observation: observation({
          ...baseState,
          mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          position: { x: 10, y: 1 },
        }),
        stuckMemory: {
          failedMovementEdges: [
            {
              action: "hold:Up",
              attempts: 2,
              context: "map=0 x=10 y=1 facing=up",
              lastSeenTurn: 2,
            },
          ],
          recentRecoveryAttempts: [],
          repeatedStateContexts: [],
          stuckEvents: 0,
        },
      })
    ).toMatchObject({
      phase: "pallet_before_oak",
      waypoint: "north-grass-trigger",
    });
  });

  it("classifies confirmed Pallet north dialogue as the Oak forced-dialogue phase", () => {
    expect(
      detectPokemonPhase({
        observation: observation({
          ...baseState,
          dialogueLike: true,
          mapId: 0,
          position: { x: 10, y: 1 },
        }),
      })
    ).toMatchObject({
      phase: "oak_forced_walk_or_dialogue",
      waypoint: "advance-oak-forced-event",
    });
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES
  )("classifies rival battle fixture $id as the battle phase", (fixture) => {
    expect(
      detectPokemonPhase({
        observation: rivalBattleObservation(fixture.runtimeGameState),
      })
    ).toMatchObject({
      phase: "rival_battle",
      reason: "deterministic-rival-battle-event",
      waypoint: "win-current-battle",
    });
  });

  it("lets the RuntimeGameState battle flag override otherwise known overworld maps", () => {
    expect(
      detectPokemonPhase({
        observation: observation({
          ...baseState,
          battle: true,
          mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
          position: { x: 18, y: 27 },
        }),
      })
    ).toMatchObject({
      phase: "rival_battle",
      reason: "deterministic-rival-battle-event",
      waypoint: "win-current-battle",
    });
  });

  it.each([
    {
      expectedReason: "ram-unavailable",
      label: "unavailable RAM",
      state: { ...baseState, readStatus: "unavailable" as const },
    },
    {
      expectedReason: "mapId-unavailable",
      label: "null mapId",
      state: { ...baseState, mapId: null },
    },
    {
      expectedReason: "unsupported-map:99",
      label: "unsupported map",
      state: { ...baseState, mapId: 99 },
    },
  ])("keeps $label phase detection bounded to fallback analysis", ({
    expectedReason,
    state,
  }) => {
    expect(
      detectPokemonPhase({
        observation: observation(state),
      })
    ).toMatchObject({
      phase: "unknown",
      reason: expectedReason,
      waypoint: "fallback-analysis",
    });
  });
});
