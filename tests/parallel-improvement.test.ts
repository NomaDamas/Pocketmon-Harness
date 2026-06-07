import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { improveParallelBatch } from "../src/parallel-improvement";
import {
  inspectPromoteCandidate,
  promoteParallelProposal,
} from "../src/parallel-promote";

describe("parallel improvement pipeline", () => {
  it("groups runs by batch, scores hypotheses, and writes proposal files", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallel-improvement-"));
    const runsDir = join(root, "runs");
    const candidatesDir = join(root, "candidates");
    await writeRun({
      batchId: "batch-a",
      milestoneFurthest: "first-map-transition",
      runId: "run-a",
      runsDir,
      hypothesis: "pathfinder-first",
      events: [
        observation(1, 38, 3, 6),
        observation(1, 37, 4, 7),
        verification(true),
      ],
    });
    await writeRun({
      batchId: "batch-a",
      milestoneFurthest: "player-control-reached",
      runId: "run-b",
      runsDir,
      hypothesis: "dialogue-recovery",
      events: [observation(1, 38, 3, 6), verification(false)],
    });

    const result = await improveParallelBatch({
      batchId: "batch-a",
      candidatesDir,
      now: new Date("2026-06-06T00:00:00.000Z"),
      runsDir,
    });

    expect(result.proposal.summary).toMatchObject({
      bestRunId: "run-a",
      runCount: 2,
    });
    expect(result.proposal.strategyTree.root.children[0]?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "hypothesis-branch",
          status: "promising",
          title: "pathfinder-first",
        }),
        expect.objectContaining({
          kind: "hypothesis-branch",
          status: "pruned",
          title: "dialogue-recovery",
        }),
      ])
    );
    await expect(
      readFile(join(candidatesDir, "batch-a", "proposal.json"), "utf8")
    ).resolves.toContain('"bestRunId": "run-a"');
    await expect(
      readFile(join(candidatesDir, "batch-a", "strategy-tree.json"), "utf8")
    ).resolves.toContain('"kind": "global-guidebook"');
  });

  it("keeps promote explicit and blocked from mutating active hierarchy", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallel-promote-"));
    const candidatesDir = join(root, "candidates");
    await improveParallelBatch({
      batchId: "batch-a",
      candidatesDir,
      runsDir: await oneRunBatch(root),
    });

    await expect(
      inspectPromoteCandidate("batch-a", candidatesDir)
    ).resolves.toMatchObject({
      batchId: "batch-a",
      blocked: true,
    });
  });

  it("applies QA-eligible proposals only with explicit --apply semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "parallel-promote-apply-"));
    const candidatesDir = join(root, "candidates");
    const activeHierarchyDir = join(root, "active-hierarchy");
    const strategyBookPath = join(root, "strategy-book.json");
    const runsDir = join(root, "runs");
    await writeRun({
      batchId: "batch-a",
      events: [
        observation(1, 38, 3, 6),
        observation(1, 37, 4, 7),
        verification(true),
      ],
      hypothesis: "pathfinder-first",
      milestoneFurthest: "first-map-transition",
      runId: "run-a",
      runsDir,
    });
    await writeRun({
      batchId: "batch-a",
      events: [
        observation(1, 38, 3, 6),
        observation(1, 37, 4, 7),
        verification(true),
      ],
      hypothesis: "exploration-backtracking",
      milestoneFurthest: "first-map-transition",
      runId: "run-b",
      runsDir,
    });
    await improveParallelBatch({
      batchId: "batch-a",
      candidatesDir,
      now: new Date("2026-06-06T00:00:00.000Z"),
      runsDir,
    });

    await expect(
      promoteParallelProposal("batch-a", {
        activeHierarchyDir,
        candidatesDir,
        strategyBookPath,
      })
    ).resolves.toMatchObject({
      applied: false,
      blocked: true,
      requiredNextStep:
        "Run pnpm improve:promote -- --batch <batch-id> --apply after review.",
    });

    const applied = await promoteParallelProposal("batch-a", {
      activeHierarchyDir,
      apply: true,
      candidatesDir,
      strategyBookPath,
    });

    expect(applied).toMatchObject({
      applied: true,
      blocked: false,
      strategyBookPath,
    });
    await expect(
      readFile(applied.activeHierarchyPath ?? "", "utf8")
    ).resolves.toContain('"strategyTree"');
    await expect(readFile(strategyBookPath, "utf8")).resolves.toContain(
      '"promoted": true'
    );
  });
});

async function oneRunBatch(root: string): Promise<string> {
  const runsDir = join(root, "runs");
  await writeRun({
    batchId: "batch-a",
    events: [observation(1, 38, 3, 6)],
    hypothesis: "pathfinder-first",
    milestoneFurthest: "player-control-reached",
    runId: "run-a",
    runsDir,
  });
  return runsDir;
}

async function writeRun({
  batchId,
  events,
  hypothesis,
  milestoneFurthest,
  runId,
  runsDir,
}: {
  batchId: string;
  events: unknown[];
  hypothesis: string;
  milestoneFurthest: string;
  runId: string;
  runsDir: string;
}): Promise<void> {
  const runDir = join(runsDir, runId);
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(runDir, { recursive: true })
  );
  await writeFile(
    join(runDir, "run.json"),
    `${JSON.stringify({
      iteration: 1,
      metricsDir: runDir,
      mode: "fresh",
      parallelBatchId: batchId,
      parallelHypothesis: hypothesis,
      runId,
      startedAt: "2026-06-06T00:00:00.000Z",
      milestoneFurthest,
    })}\n`
  );
  await writeFile(
    join(runDir, "events.jsonl"),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
  );
}

function observation(turn: number, mapId: number, x: number, y: number) {
  return {
    pokemonState: { mapId, position: { x, y } },
    runId: "run",
    schemaVersion: 1,
    screenshot: { data: "", mediaType: "image/png" },
    status: { activeButtons: [], frame: 1, gameCode: "DMG", gameTitle: "RED" },
    timestamp: "2026-06-06T00:00:00.000Z",
    turn,
    type: "observation",
  };
}

function verification(success: boolean) {
  return {
    runId: "run",
    schemaVersion: 1,
    summary: {
      kind: "assistant_text",
      text: `<verification_result success="${success}">ok</verification_result>`,
    },
    timestamp: "2026-06-06T00:00:00.000Z",
    type: "agent-event",
  };
}
