import { describe, expect, it } from "vitest";
import { chooseDeterministicPolicyAction } from "../src/deterministic-policy";
import type { MgbaObservation } from "../src/observation";
import type { PokemonStateObservation } from "../src/pokemon-state";

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

  it("handles Oak Lab scripted dialogue without LLM fallback", () => {
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
        button: "A",
        toolName: "mgba_tap",
      },
      policy: "scripted-event",
    });
  });

  it("falls back when Oak Lab scripted A advance exceeds its cap", () => {
    const decision = chooseDeterministicPolicyAction({
      observation: observation({
        ...baseState,
        mapId: 40,
        position: { x: 5, y: 3 },
      }),
      recentActions: Array.from({ length: 10 }, () => 'tap: {"button":"A"}'),
      stuckMemory: emptyStuckMemory,
    });

    expect(decision.policy).toBe("llm-fallback");
    expect(decision.action).toBeUndefined();
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

  it("falls back when the Oak trigger A advance exceeds its no-transition cap", () => {
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

    expect(decision.policy).toBe("llm-fallback");
    expect(decision.action).toBeUndefined();
  });
});
