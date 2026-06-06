import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLatestRunId, loadTuiDashboardState } from "../src/tui-summary";

describe("tui summary", () => {
  it("loads the latest run and summarizes trace files", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "pss-mgba-tui-"));
    const runId = "00002-2026-06-06T04-46-33-155Z";
    const runDir = join(traceRoot, "runs", runId);
    await mkdir(runDir, { recursive: true });
    await mkdir(join(traceRoot, "runs", "00001-old"), { recursive: true });
    await writeFile(
      join(runDir, "run.json"),
      JSON.stringify({
        experimentId: "combined-optimized",
        milestone: "first-battle-detected",
        mode: "fresh",
        runId,
        startedAt: "2026-06-06T04:46:33.155Z",
      })
    );
    await writeFile(
      join(runDir, "events.jsonl"),
      [
        JSON.stringify({
          pokemonState: {
            mapId: 40,
            position: { x: 4, y: 6 },
          },
          status: { frame: 1234 },
          timestamp: "2026-06-06T04:46:34.000Z",
          type: "observation",
        }),
        JSON.stringify({
          summary: {
            input: { button: "A" },
            kind: "action_tool_call",
            toolName: "mgba_tap",
          },
          timestamp: "2026-06-06T04:46:35.000Z",
          type: "agent-event",
        }),
        JSON.stringify({
          summary: {
            kind: "supervisor_intervention",
          },
          timestamp: "2026-06-06T04:46:36.000Z",
          type: "agent-event",
        }),
        JSON.stringify({
          summary: {
            kind: "assistant_reasoning",
            text: "Moved   through dialogue.\nNext step.",
          },
          timestamp: "2026-06-06T04:46:37.000Z",
          type: "agent-event",
        }),
      ].join("\n")
    );
    await writeFile(
      join(runDir, "token-usage.jsonl"),
      `${JSON.stringify({
        modelId: "pokemon.chat:grok-4.3",
        step: 7,
        turn: 1,
        usage: {
          inputTokens: 100,
          outputTokens: 12,
          reasoningTokens: 8,
          totalTokens: 112,
        },
      })}\n`
    );

    await expect(findLatestRunId(traceRoot)).resolves.toBe(runId);

    const state = await loadTuiDashboardState({ traceRoot });

    expect(state).toMatchObject({
      actions: {
        count: 1,
        lastInput: { button: "A" },
        lastToolName: "mgba_tap",
      },
      assistantReasoning: "Moved through dialogue. Next step.",
      events: {
        agent: 3,
        observations: 1,
        total: 4,
      },
      lastFrame: 1234,
      lastMap: 40,
      lastPosition: {
        x: 4,
        y: 6,
      },
      macroProgress: {
        confidence: 1,
        health: "watch",
        phaseId: "first-battle-detected",
        phaseIndex: 4,
        phaseLabel: "First battle detected",
        totalPhases: 7,
      },
      modelId: "pokemon.chat:grok-4.3",
      run: {
        milestone: "first-battle-detected",
        mode: "fresh",
        runId,
      },
      supervisorInterventions: 1,
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 12,
        reasoningTokens: 8,
        step: 7,
        totalTokens: 112,
        turn: 1,
      },
    });
  });
});
