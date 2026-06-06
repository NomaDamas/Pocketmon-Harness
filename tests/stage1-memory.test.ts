import { describe, expect, it } from "vitest";
import {
  createMemoryMetadata,
  createStage1MemoryExport,
  STAGE1_MEMORY_GAME,
  STAGE1_MEMORY_SCHEMA_VERSION,
  STAGE1_MEMORY_STAGE,
  type Stage1MemoryRecord,
  serializeStage1MemoryExport,
  validateStage1MemoryExport,
  validateStage1MemoryRecord,
} from "../src/stage1-memory";

const createdAt = new Date("2026-06-06T00:00:00.000Z");
const exportedAt = new Date("2026-06-06T00:01:00.000Z");

function record(
  overrides: Partial<Stage1MemoryRecord> = {}
): Stage1MemoryRecord {
  return validateStage1MemoryRecord({
    content: {
      summary: "Walk north from Pallet Town toward Route 1.",
    },
    game: STAGE1_MEMORY_GAME,
    id: "rule:route-1.walk-north",
    kind: "rule",
    metadata: createMemoryMetadata({
      confidence: 0.8,
      createdAt,
      frameWindow: {
        endFrame: 640,
        fps: 60,
        startFrame: 0,
      },
      source: {
        kind: "base-guide",
        label: "Pokemon Red Stage 1 base guide",
      },
      tags: ["viridian"],
    }),
    schemaVersion: STAGE1_MEMORY_SCHEMA_VERSION,
    scope: "route-guide",
    stage: STAGE1_MEMORY_STAGE,
    status: "active",
    version: "1.0.0",
    ...overrides,
  });
}

describe("stage1 memory primitives", () => {
  it("validates a Pokemon Red Stage 1 memory record with source and frame metadata", () => {
    const parsed = record();

    expect(parsed).toMatchObject({
      game: "pokemon-red",
      id: "rule:route-1.walk-north",
      kind: "rule",
      metadata: {
        confidence: 0.8,
        frameWindow: {
          endFrame: 640,
          fps: 60,
          startFrame: 0,
        },
        source: {
          kind: "base-guide",
        },
      },
      schemaVersion: "pokemon-red-stage1-memory/v1",
      stage: "stage1",
    });
  });

  it("rejects mismatched ID prefixes and out-of-range confidence", () => {
    expect(() => record({ id: "skill:route-1.walk-north" })).toThrow(
      "id prefix must match kind"
    );
    expect(() =>
      record({
        metadata: createMemoryMetadata({
          confidence: 1.1,
          createdAt,
          source: {
            kind: "base-guide",
            label: "Pokemon Red Stage 1 base guide",
          },
        }),
      })
    ).toThrow();
  });

  it("rejects invalid frame windows while keeping fps optional metadata", () => {
    expect(() =>
      createMemoryMetadata({
        confidence: 0.7,
        createdAt,
        frameWindow: {
          endFrame: 10,
          startFrame: 11,
        },
        source: {
          kind: "trace-evidence",
          label: "loop window evidence",
        },
      })
    ).toThrow("endFrame must be greater than or equal to startFrame");
  });

  it("creates deterministic exports and rejects duplicate record IDs", () => {
    const laterRecord = record({
      id: "skill:route-1.follow-path",
      kind: "skill",
      scope: "skill",
    });
    const earlierRecord = record();

    const memoryExport = createStage1MemoryExport(
      [laterRecord, earlierRecord],
      exportedAt
    );

    expect(memoryExport.records.map((item) => item.id)).toEqual([
      "rule:route-1.walk-north",
      "skill:route-1.follow-path",
    ]);
    expect(serializeStage1MemoryExport(memoryExport)).toMatchSnapshot();
    expect(() =>
      validateStage1MemoryExport({
        ...memoryExport,
        records: [earlierRecord, earlierRecord],
      })
    ).toThrow("record IDs must be unique");
  });
});
