import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { readRunSummaries } from "../src/run-summary";
import {
  createOptimizedFreshRunTrace,
  createRunTrace,
  createRuntimeGameStateEvidence,
  EXPERIMENT_MODES,
  SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
  updateRunTraceMetadata,
  validateRunExperimentMetadata,
} from "../src/run-trace";
import { EVENTS_JSONL_FILENAME } from "../src/viewer-events";
import { createViewerEventRecorder } from "../src/viewer-recorder";

const originalCwd = cwd();

afterEach(() => {
  chdir(originalCwd);
});

describe("createRunTrace", () => {
  it("allocates stable run iterations and writes trace metadata", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-"));
    chdir(tempDir);

    const first = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"));
    const second = await createRunTrace(new Date("2026-05-24T00:00:01.000Z"));

    expect(first.iteration).toBe(1);
    expect(first.runId).toBe("00001-2026-05-24T00-00-00-000Z");
    expect(first.metricsDir).toBe(
      ".pss-mgba/traces/runs/00001-2026-05-24T00-00-00-000Z"
    );
    expect(second.iteration).toBe(2);

    const iterationLog = await readFile(
      ".pss-mgba/traces/iterations.jsonl",
      "utf8"
    );
    expect(iterationLog.trim().split("\n")).toHaveLength(2);
    expect(
      JSON.parse(iterationLog.trim().split("\n")[0] ?? "{}")
    ).toMatchObject({
      iteration: 1,
      runId: first.runId,
      type: "run-start",
    });
  });

  it("allocates unique iterations under concurrent parallel starts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-parallel-"));
    chdir(tempDir);

    const traces = await Promise.all(
      Array.from({ length: 5 }, (_value, index) =>
        createRunTrace(new Date(2026, 4, 24, 0, 0, index))
      )
    );

    expect(
      traces.map((trace) => trace.iteration).sort((a, b) => a - b)
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it("serializes each valid experiment mode and all experiment metadata fields", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-modes-"));
    chdir(tempDir);

    for (const [index, mode] of EXPERIMENT_MODES.entries()) {
      const trace = await createRunTrace(new Date(2026, 4, 24, 0, 0, index), {
        blockedRepeatedActionsTotal: index + 2,
        experimentId: `experiment-${mode}`,
        milestone: "route-1",
        milestoneCurrent: "player-control-reached",
        milestoneFurthest: "first-map-transition",
        milestoneProgress: {
          completedRatio: 0.5,
          current: "player-control-reached",
          currentRank: 2,
          furthest: "first-map-transition",
          furthestRank: 3,
          namespace: "milestone-progress",
          sequenceLength: 8,
          source: "milestone-progress-tracker",
        },
        mode,
        objective: "Reach the next navigation proof point.",
        ramReadStatus: "not-attempted",
        runBudget: "300s",
        runtimeGameState: {
          battle: false,
          evaluatorMilestone: "first-map-transition",
          evaluatorMilestoneCurrent: "player-control-reached",
          evaluatorMilestoneFurthest: "first-map-transition",
          mapId: 38,
          phase: "bedroom_2f",
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 3,
          y: 6,
        },
        saveStateStatus: "supported",
        saveStatePath: `.pss-mgba/states/${mode}.ss0`,
        stateSource: mode === "fresh" ? "new-game" : "save-state",
        stuckEvents: index,
        supervisorEnabled: mode !== "fresh",
        supervisorInterventions: index + 1,
        verificationFailuresTotal: index + 3,
        verificationSuccessesTotal: index + 4,
      });

      const saved = JSON.parse(
        await readFile(join(trace.metricsDir, "run.json"), "utf8")
      );
      expect(saved).toMatchObject({
        currentPhase: "bedroom_2f",
        experimentId: `experiment-${mode}`,
        milestone: "route-1",
        milestoneCurrent: "player-control-reached",
        milestoneFurthest: "first-map-transition",
        milestoneProgress: {
          completedRatio: 0.5,
          current: "player-control-reached",
          currentRank: 2,
          furthest: "first-map-transition",
          furthestRank: 3,
          namespace: "milestone-progress",
          sequenceLength: 8,
          source: "milestone-progress-tracker",
        },
        mode,
        objective: "Reach the next navigation proof point.",
        ramReadStatus: "not-attempted",
        runBudget: "300s",
        runtimeGameState: {
          battle: false,
          evaluatorMilestone: "first-map-transition",
          evaluatorMilestoneCurrent: "player-control-reached",
          evaluatorMilestoneFurthest: "first-map-transition",
          mapId: 38,
          phase: "bedroom_2f",
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 3,
          y: 6,
        },
        saveStateStatus: "supported",
        saveStatePath: `.pss-mgba/states/${mode}.ss0`,
        stateSource: mode === "fresh" ? "new-game" : "save-state",
        blockedRepeatedActionsTotal: index + 2,
        stuckEvents: index,
        supervisorEnabled: mode !== "fresh",
        supervisorInterventions: index + 1,
        verificationFailuresTotal: index + 3,
        verificationSuccessesTotal: index + 4,
      });
    }
  });

  it("creates default metadata for the optimized fresh live harness run", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-default-"));
    chdir(tempDir);

    const trace = await createOptimizedFreshRunTrace(
      new Date("2026-05-24T00:00:00.000Z")
    );

    const saved = JSON.parse(
      await readFile(join(trace.metricsDir, "run.json"), "utf8")
    );
    expect(saved).toMatchObject({
      experimentId: "combined-optimized",
      mode: "fresh",
      objective:
        "Continue playing the already-loaded Pokemon game autonomously without reset, reload, or restart.",
      runBudget: "300s",
      stateSource: "already-running-mgba-http",
      stuckEvents: 0,
      supervisorEnabled: true,
      supervisorInterventions: 0,
    });
  });

  it("rejects invalid experiment modes at runtime", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "invalid-mode",
      } as never)
    ).toThrow("Invalid experiment mode: invalid-mode");
  });

  it("updates runtime metadata in the run trace without reallocating a run", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-update-"));
    chdir(tempDir);

    const trace = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"));
    const updated = await updateRunTraceMetadata(trace, {
      milestone: "first-battle-detected",
      milestoneCurrent: "first-battle-detected",
      milestoneFurthest: "first-battle-detected",
      milestoneProgress: {
        completedRatio: 0.625,
        current: "first-battle-detected",
        currentRank: 5,
        furthest: "first-battle-detected",
        furthestRank: 5,
        namespace: "milestone-progress",
        sequenceLength: 8,
        source: "milestone-progress-tracker",
      },
      ramReadStatus: "available",
      runtimeGameState: {
        battle: true,
        evaluatorMilestone: "first-battle-detected",
        evaluatorMilestoneCurrent: "first-battle-detected",
        evaluatorMilestoneFurthest: "first-battle-detected",
        mapId: 40,
        phase: "rival_battle",
        readStatus: "available",
        source: "pokemon-red-ram",
        statusFrame: 3001,
        x: 4,
        y: 4,
      },
      blockedRepeatedActionsTotal: 4,
      stuckEvents: 2,
      supervisorInterventions: 5,
      verificationFailuresTotal: 3,
      verificationSuccessesTotal: 11,
    });

    expect(updated.runId).toBe(trace.runId);
    expect(updated.currentPhase).toBe("rival_battle");
    expect(updated.milestoneFurthest).toBe("first-battle-detected");
    expect(
      JSON.parse(await readFile(join(trace.metricsDir, "run.json"), "utf8"))
    ).toMatchObject({
      currentPhase: "rival_battle",
      milestone: "first-battle-detected",
      milestoneCurrent: "first-battle-detected",
      milestoneFurthest: "first-battle-detected",
      milestoneProgress: {
        completedRatio: 0.625,
        current: "first-battle-detected",
        currentRank: 5,
        furthest: "first-battle-detected",
        furthestRank: 5,
        namespace: "milestone-progress",
        sequenceLength: 8,
        source: "milestone-progress-tracker",
      },
      ramReadStatus: "available",
      runId: trace.runId,
      blockedRepeatedActionsTotal: 4,
      runtimeGameState: {
        battle: true,
        evaluatorMilestone: "first-battle-detected",
        evaluatorMilestoneCurrent: "first-battle-detected",
        evaluatorMilestoneFurthest: "first-battle-detected",
        mapId: 40,
        phase: "rival_battle",
        readStatus: "available",
        source: "pokemon-red-ram",
        statusFrame: 3001,
        x: 4,
        y: 4,
      },
      stuckEvents: 2,
      supervisorInterventions: 5,
      verificationFailuresTotal: 3,
      verificationSuccessesTotal: 11,
    });
  });

  it("persists verification logs to trace storage and reloads them across harness runs", async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), "pss-mgba-trace-verification-")
    );
    chdir(tempDir);

    const first = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"), {
      experimentId: "controller-primary",
      mode: "fresh",
    });
    const second = await createRunTrace(new Date("2026-05-24T00:00:01.000Z"), {
      experimentId: "controller-primary",
      mode: "fresh",
    });
    const firstRecorder = createViewerEventRecorder({
      now: () => new Date("2026-05-24T00:00:02.000Z"),
      trace: first,
    });
    const secondRecorder = createViewerEventRecorder({
      now: () => new Date("2026-05-24T00:00:03.000Z"),
      trace: second,
    });

    await firstRecorder.recordEvent(
      {
        text: '<verification_result success="true" expected="movement-or-map-change">RAM map/position changed after movement</verification_result>',
        type: "assistant-text",
      },
      { turn: 1 }
    );
    await updateRunTraceMetadata(first, {
      verificationFailuresTotal: 0,
      verificationSuccessesTotal: 1,
    });
    await secondRecorder.recordEvent(
      {
        text: '<verification_result success="false" expected="oak-dialogue-progress">no dialogue/script progress after mgba_tap:A</verification_result>',
        type: "assistant-text",
      },
      { turn: 1 }
    );
    await updateRunTraceMetadata(second, {
      verificationFailuresTotal: 1,
      verificationSuccessesTotal: 0,
    });

    expect(first.metricsDir).toBe(
      ".pss-mgba/traces/runs/00001-2026-05-24T00-00-00-000Z"
    );
    expect(second.metricsDir).toBe(
      ".pss-mgba/traces/runs/00002-2026-05-24T00-00-01-000Z"
    );

    const summaries = await readRunSummaries(".pss-mgba/traces/runs");
    expect(summaries).toMatchObject([
      {
        iteration: 1,
        runId: first.runId,
        verificationFailuresTotal: 0,
        verificationSuccessesTotal: 1,
      },
      {
        iteration: 2,
        runId: second.runId,
        verificationFailuresTotal: 1,
        verificationSuccessesTotal: 0,
      },
    ]);

    const firstVerificationLog = JSON.parse(
      (
        await readFile(join(first.metricsDir, EVENTS_JSONL_FILENAME), "utf8")
      ).trim()
    );
    const secondVerificationLog = JSON.parse(
      (
        await readFile(join(second.metricsDir, EVENTS_JSONL_FILENAME), "utf8")
      ).trim()
    );
    expect(firstVerificationLog).toMatchObject({
      runId: first.runId,
      summary: {
        kind: "verification_result",
        output: {
          expected: "movement-or-map-change",
          reason: "RAM map/position changed after movement",
          success: true,
        },
      },
    });
    expect(secondVerificationLog).toMatchObject({
      runId: second.runId,
      summary: {
        kind: "verification_result",
        output: {
          expected: "oak-dialogue-progress",
          reason: "no dialogue/script progress after mgba_tap:A",
          success: false,
        },
      },
    });
  });

  it("rejects RAM evidence records that omit the evaluator milestone", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "fresh",
        runtimeGameState: {
          battle: false,
          evaluatorMilestoneCurrent: "player-control-reached",
          evaluatorMilestoneFurthest: "player-control-reached",
          mapId: 38,
          phase: "bedroom_2f",
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 3,
          y: 6,
        } as never,
      })
    ).toThrow(
      "runtimeGameState.evaluatorMilestone is required for RAM evidence records"
    );
  });

  it("rejects RAM evidence records that omit evaluator milestone state fields", () => {
    for (const field of [
      "evaluatorMilestoneCurrent",
      "evaluatorMilestoneFurthest",
    ] as const) {
      const runtimeGameState: Record<string, unknown> = {
        battle: false,
        evaluatorMilestone: "player-control-reached",
        evaluatorMilestoneCurrent: "player-control-reached",
        evaluatorMilestoneFurthest: "player-control-reached",
        mapId: 38,
        phase: "bedroom_2f",
        readStatus: "available",
        source: "pokemon-red-ram",
        statusFrame: 2817,
        x: 3,
        y: 6,
      };
      delete runtimeGameState[field];

      expect(() =>
        validateRunExperimentMetadata({
          mode: "fresh",
          runtimeGameState: runtimeGameState as never,
        })
      ).toThrow(
        `runtimeGameState.${field} is required for RAM evidence records`
      );
    }
  });

  it("rejects RAM evidence records that omit the current phase", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "fresh",
        runtimeGameState: {
          battle: false,
          evaluatorMilestone: "player-control-reached",
          evaluatorMilestoneCurrent: "player-control-reached",
          evaluatorMilestoneFurthest: "player-control-reached",
          mapId: 38,
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 3,
          y: 6,
        } as never,
      })
    ).toThrow("runtimeGameState.phase is required for RAM evidence records");
  });

  it("rejects RAM evidence records that omit the read status", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "fresh",
        runtimeGameState: {
          battle: false,
          evaluatorMilestone: "player-control-reached",
          evaluatorMilestoneCurrent: "player-control-reached",
          evaluatorMilestoneFurthest: "player-control-reached",
          mapId: 38,
          phase: "bedroom_2f",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 3,
          y: 6,
        } as never,
      })
    ).toThrow(
      "runtimeGameState.readStatus is required for RAM evidence records"
    );
  });

  it("rejects RAM evidence records that omit map and coordinate fields", () => {
    for (const field of ["mapId", "x", "y"] as const) {
      const runtimeGameState: Record<string, unknown> = {
        battle: false,
        evaluatorMilestone: "player-control-reached",
        evaluatorMilestoneCurrent: "player-control-reached",
        evaluatorMilestoneFurthest: "player-control-reached",
        mapId: 38,
        phase: "bedroom_2f",
        readStatus: "available",
        source: "pokemon-red-ram",
        statusFrame: 2817,
        x: 3,
        y: 6,
      };
      delete runtimeGameState[field];

      expect(() =>
        validateRunExperimentMetadata({
          mode: "fresh",
          runtimeGameState: runtimeGameState as never,
        })
      ).toThrow(
        `runtimeGameState.${field} is required for RAM evidence records`
      );
    }
  });

  it("rejects RAM evidence records that omit the battle flag", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "fresh",
        runtimeGameState: {
          evaluatorMilestone: "player-control-reached",
          evaluatorMilestoneCurrent: "player-control-reached",
          evaluatorMilestoneFurthest: "player-control-reached",
          mapId: 38,
          phase: "bedroom_2f",
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 3,
          y: 6,
        } as never,
      })
    ).toThrow("runtimeGameState.battle is required for RAM evidence records");
  });

  it("rejects RAM evidence records that mismatch evaluator milestone metadata", async () => {
    const tempDir = await mkdtemp(
      join(tmpdir(), "pss-mgba-trace-milestone-mismatch-")
    );
    chdir(tempDir);

    const trace = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"));

    await expect(
      updateRunTraceMetadata(trace, {
        milestoneCurrent: "player-control-reached",
        milestoneFurthest: "first-map-transition",
        ramReadStatus: "available",
        runtimeGameState: {
          battle: false,
          evaluatorMilestone: "player-control-reached",
          evaluatorMilestoneCurrent: "player-control-reached",
          evaluatorMilestoneFurthest: "first-map-transition",
          mapId: 12,
          phase: "route1",
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 10,
          y: 30,
        },
      })
    ).rejects.toThrow(
      "runtimeGameState.evaluatorMilestone must match evaluator milestone metadata: expected first-map-transition, got player-control-reached"
    );
  });

  it("derives runtime game-state evidence only from RAM-backed observation state", () => {
    expect(
      createRuntimeGameStateEvidence(
        {
          state: {
            battle: true,
            battleResult: 0,
            battleType: 1,
            dialogueLike: "visual-fallback",
            direction: "left",
            mapId: 40,
            menuLike: "visual-fallback",
            position: { x: 4, y: 5 },
            readStatus: "available",
          },
          status: {
            activeButtons: [],
            frame: 3001,
            gameCode: "DMG-APAE",
            gameTitle: "POKEMON RED",
          },
        },
        {
          current: "player-control-reached",
          furthest: "first-battle-detected",
        }
      )
    ).toEqual({
      battle: true,
      evaluatorMilestone: "first-battle-detected",
      evaluatorMilestoneCurrent: "player-control-reached",
      evaluatorMilestoneFurthest: "first-battle-detected",
      mapId: 40,
      phase: "rival_battle",
      readStatus: "available",
      source: "pokemon-red-ram",
      statusFrame: 3001,
      x: 4,
      y: 5,
    });

    const unavailableEvidence = createRuntimeGameStateEvidence(
      {
        state: {
          battle: false,
          battleResult: null,
          battleType: null,
          dialogueLike: "visual-fallback",
          direction: "unknown",
          mapId: null,
          menuLike: "visual-fallback",
          position: { x: null, y: null },
          readStatus: "unavailable",
        },
        status: {
          activeButtons: [],
          frame: null,
          gameCode: "",
          gameTitle: "",
        },
      },
      null
    );

    expect(unavailableEvidence).toEqual({
      battle: false,
      evaluatorMilestone: null,
      evaluatorMilestoneCurrent: null,
      evaluatorMilestoneFurthest: null,
      mapId: null,
      phase: "unknown",
      readStatus: "unavailable",
      source: "pokemon-red-ram",
      statusFrame: null,
      x: null,
      y: null,
    });
    expect(Object.keys(unavailableEvidence ?? {}).sort()).toEqual([
      "battle",
      "evaluatorMilestone",
      "evaluatorMilestoneCurrent",
      "evaluatorMilestoneFurthest",
      "mapId",
      "phase",
      "readStatus",
      "source",
      "statusFrame",
      "x",
      "y",
    ]);
  });

  it("records unsupported save-state status without inventing a save-state path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "pss-mgba-trace-save-state-"));
    chdir(tempDir);

    const trace = await createRunTrace(new Date("2026-05-24T00:00:00.000Z"), {
      mode: "recovery",
      saveStateStatus: SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
      stateSource: "save-state-unsupported",
    });

    const saved = JSON.parse(
      await readFile(join(trace.metricsDir, "run.json"), "utf8")
    );
    expect(saved).toMatchObject({
      mode: "recovery",
      saveStateStatus: SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
      stateSource: "save-state-unsupported",
    });
    expect(saved).not.toHaveProperty("saveStatePath");
  });

  it("rejects fake save-state paths when current mGBA-http does not support save-states", () => {
    expect(() =>
      validateRunExperimentMetadata({
        mode: "deterministic-replay",
        saveStatePath: ".pss-mgba/states/fake.ss0",
        saveStateStatus: SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP,
      })
    ).toThrow("saveStatePath must be omitted");
  });
});
