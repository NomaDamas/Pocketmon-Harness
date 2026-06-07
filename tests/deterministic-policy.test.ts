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
  });

  it("falls back when Oak Lab scripted A advance exceeds its cap", () => {
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
