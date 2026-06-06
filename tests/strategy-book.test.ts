import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateStrategyBook } from "../src/strategy-book";

describe("strategy book", () => {
  it("aggregates candidate evidence into strategy entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-strategy-book-"));
    const improvementRoot = join(root, "improvements");
    const outputPath = join(root, "strategy-book.json");
    await mkdir(improvementRoot, { recursive: true });
    await writeFile(
      join(improvementRoot, "run-1.candidate.json"),
      JSON.stringify({
        audit: {
          createdAt: "2026-06-06T00:00:00.000Z",
          runId: "run-1",
          source: "trace-self-improvement",
        },
        candidateId: "candidate:run-1.avoid-no-progress-state",
        evidence: ["sameState=map=38 x=3 y=6", "observationCount=4"],
        patch: {
          action: "avoid-no-progress-state",
          recommendation: "Use deterministic name-entry recovery.",
        },
        status: "candidate",
      })
    );

    const book = await updateStrategyBook({
      improvementRoot,
      now: new Date("2026-06-06T00:00:01.000Z"),
      outputPath,
    });

    expect(book.strategies).toHaveLength(1);
    expect(book.strategies[0]).toMatchObject({
      action: "avoid-no-progress-state",
      evidenceCount: 2,
      promoted: false,
      sourceRuns: ["run-1"],
    });
    await expect(readFile(outputPath, "utf8")).resolves.toContain(
      "avoid-no-progress-state"
    );
  });
});
