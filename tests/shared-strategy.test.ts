import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MgbaObservation } from "../src/observation";
import {
  observationStateKey,
  SharedStrategyMemory,
} from "../src/shared-strategy";

describe("shared strategy memory", () => {
  it("suggests a peer successful action for the same RAM state", async () => {
    const root = await mkdtemp(join(tmpdir(), "shared-strategy-"));
    const path = join(root, "batch.jsonl");
    const observation = fakeObservation({
      facing: "down",
      mapId: 38,
      x: 3,
      y: 6,
    });

    const first = new SharedStrategyMemory({
      batchId: "batch-a",
      now: () => new Date("2026-06-06T00:00:00.000Z"),
      path,
      runId: "run-a",
    });
    await first.recordActionSuccess({
      action: {
        button: "Down",
        duration: 10,
        reason: "move toward stair",
        toolName: "mgba_hold",
      },
      before: observation,
      expectedOutcome: "movement-or-map-change",
      phase: "bedroom_2f",
      success: true,
      waypoint: "stair-warp",
    });

    const second = new SharedStrategyMemory({
      batchId: "batch-a",
      path,
      runId: "run-b",
    });

    await expect(second.suggest(observation)).resolves.toMatchObject({
      action: {
        button: "Down",
        duration: 10,
        toolName: "mgba_hold",
      },
      evidenceCount: 1,
      phase: "bedroom_2f",
      stateKey: "map=38;x=3;y=6;facing=down;battle=0;dialogue=0;menu=0",
      waypoint: "stair-warp",
    });
  });

  it("does not suggest this run's own action as peer evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "shared-strategy-self-"));
    const path = join(root, "batch.jsonl");
    const observation = fakeObservation({
      facing: "up",
      mapId: 37,
      x: 4,
      y: 7,
    });
    const memory = new SharedStrategyMemory({
      batchId: "batch-a",
      path,
      runId: "run-a",
    });
    await memory.recordActionSuccess({
      action: {
        button: "Down",
        duration: 10,
        reason: "front door",
        toolName: "mgba_hold",
      },
      before: observation,
      expectedOutcome: "movement-or-map-change",
      phase: "house_1f",
      success: true,
      waypoint: "front-door-warp",
    });

    await expect(memory.suggest(observation)).resolves.toBeUndefined();
  });

  it("creates stable state keys only when RAM position is available", () => {
    expect(
      observationStateKey(
        fakeObservation({ facing: "left", mapId: 1, x: 2, y: 3 })
      )
    ).toBe("map=1;x=2;y=3;facing=left;battle=0;dialogue=0;menu=0");
    expect(
      observationStateKey({
        ...fakeObservation({ facing: "left", mapId: 1, x: 2, y: 3 }),
        state: undefined,
      })
    ).toBeUndefined();
  });
});

function fakeObservation({
  facing,
  mapId,
  x,
  y,
}: {
  facing: "down" | "left" | "right" | "up";
  mapId: number;
  x: number;
  y: number;
}): MgbaObservation {
  return {
    screenshot: {
      data: "",
      mediaType: "image/png",
      path: "/tmp/s.png",
    },
    state: {
      battle: false,
      battleResult: null,
      battleType: null,
      dialogueLike: false,
      direction: facing,
      mapId,
      menuLike: false,
      position: { x, y },
      readStatus: "available",
    },
    status: {
      activeButtons: [],
      frame: 1,
      gameCode: "POKEMON",
      gameTitle: "POKEMON RED",
    },
  };
}
