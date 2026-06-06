import { describe, expect, it } from "vitest";
import type { MgbaObservation } from "../src/observation";
import { detectPokemonPhase } from "../src/phase-detector";
import type { PokemonStateObservation } from "../src/pokemon-state";

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
});
