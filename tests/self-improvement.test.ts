import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { improveLatestTrace } from "../src/self-improvement";

describe("trace self-improvement", () => {
  it("writes a candidate when the latest trace repeats an action three times", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-improve-"));
    const traceRoot = join(root, "traces");
    const outputRoot = join(root, "improvements");
    const runId = "run-repeat";
    const runDir = join(traceRoot, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "events.jsonl"),
      Array.from({ length: 4 }, () =>
        JSON.stringify({
          summary: {
            input: { button: "A" },
            kind: "action_tool_call",
            toolName: "mgba_tap",
          },
          type: "agent-event",
        })
      ).join("\n")
    );

    const result = await improveLatestTrace({
      now: new Date("2026-06-06T00:00:00.000Z"),
      outputRoot,
      traceRoot,
    });

    expect(result.status).toBe("candidate-written");
    expect(result.outputPath).toBeDefined();
    const candidate = JSON.parse(
      await readFile(result.outputPath ?? "", "utf8")
    );
    expect(candidate).toMatchObject({
      audit: {
        runId,
        source: "trace-self-improvement",
      },
      patch: {
        action: "avoid-repeated-action",
        minimumFailures: 3,
      },
      status: "candidate",
    });
  });

  it("does not write a candidate when actions are diverse", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-improve-"));
    const traceRoot = join(root, "traces");
    const runId = "run-diverse";
    const runDir = join(traceRoot, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "events.jsonl"),
      ["A", "B", "Up", "Left"]
        .map((button) =>
          JSON.stringify({
            summary: {
              input: { button },
              kind: "action_tool_call",
              toolName: "mgba_tap",
            },
            type: "agent-event",
          })
        )
        .join("\n")
    );

    await expect(
      improveLatestTrace({
        traceRoot,
      })
    ).resolves.toMatchObject({
      runId,
      status: "no-candidate",
    });
  });

  it("writes a candidate when diverse actions stay on the same RAM state", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-improve-"));
    const traceRoot = join(root, "traces");
    const outputRoot = join(root, "improvements");
    const runId = "run-no-progress";
    const runDir = join(traceRoot, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "events.jsonl"),
      ["A", "B", "Down", "Right"]
        .flatMap((button) => [
          JSON.stringify({
            summary: {
              input: { button },
              kind: "action_tool_call",
              toolName: button.length === 1 ? "mgba_tap" : "mgba_hold",
            },
            type: "agent-event",
          }),
          JSON.stringify({
            pokemonState: {
              mapId: 38,
              position: { x: 3, y: 6 },
            },
            type: "observation",
          }),
        ])
        .join("\n")
    );

    const result = await improveLatestTrace({
      outputRoot,
      traceRoot,
    });

    expect(result.status).toBe("candidate-written");
    expect(result.candidate).toMatchObject({
      patch: {
        action: "avoid-no-progress-state",
        minimumFailures: 3,
      },
      status: "candidate",
    });
  });

  it("suppresses repeated A candidates when dialogue is progressing", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-improve-"));
    const traceRoot = join(root, "traces");
    const runId = "run-dialogue";
    const runDir = join(traceRoot, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(
      join(runDir, "events.jsonl"),
      Array.from({ length: 4 }, () => [
        JSON.stringify({
          summary: {
            kind: "assistant_reasoning",
            text: "The intro dialogue text is advancing with each A press.",
          },
          type: "agent-event",
        }),
        JSON.stringify({
          summary: {
            input: { button: "A" },
            kind: "action_tool_call",
            toolName: "mgba_tap",
          },
          type: "agent-event",
        }),
      ])
        .flat()
        .join("\n")
    );

    await expect(
      improveLatestTrace({
        traceRoot,
      })
    ).resolves.toMatchObject({
      runId,
      status: "suppressed-progressing-dialogue",
    });
  });
});
