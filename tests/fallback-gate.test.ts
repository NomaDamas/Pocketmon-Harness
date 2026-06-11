import { describe, expect, it, vi } from "vitest";
import {
  type DeterministicPolicyDecision,
  OAK_DIALOGUE_PHASE_CHECKPOINTS,
} from "../src/deterministic-policy";
import { verifyDeterministicOutcome } from "../src/deterministic-verification";
import {
  BoundedLlmFallbackBudget,
  ControllerFirstFallbackGateAttemptTracker,
  createBoundedLlmFallbackInvocationEvent,
  DEFAULT_CONTROLLER_FIRST_FALLBACK_GATE_MAX_ATTEMPTS_PER_EDGE,
  DEFAULT_LLM_FALLBACK_TIMEOUT_MS,
  getControllerFirstLlmFallbackGate,
  getRivalBattleLlmControlGuard,
  getStarterSelectionLlmFallbackBypass,
  LlmFallbackGate,
  RIVAL_BATTLE_LLM_CONTROL_GUARD_STOP_REASON,
  requiresOakAnalystFallbackSettleGate,
  validateBoundedLlmFallbackInvocation,
  validateFallbackAnalystBoundary,
} from "../src/fallback-gate";
import type { MgbaObservation } from "../src/observation";
import type { PokemonStateObservation } from "../src/pokemon-state";
import {
  POST_ACTION_SETTLE_FRAMES,
  SETTLE_POLL_INTERVAL_MS,
} from "../src/supervisor";

const STALLED_OAK_DIALOGUE_PATTERN =
  /^oak-verification-failed:stalled Oak dialogue/;

const baseDecision: DeterministicPolicyDecision = {
  phase: "oak_forced_walk_or_dialogue",
  policy: "llm-fallback",
  reason:
    "Oak dialogue received 6 repeated A taps without transition; fallback analyst must inspect",
  waypoint: "advance-oak-forced-event",
};

const oakDialogueState: PokemonStateObservation = {
  battle: false,
  battleResult: null,
  battleType: null,
  dialogueLike: true,
  direction: "up",
  mapId: 0,
  menuLike: false,
  position: { x: 10, y: 1 },
  readStatus: "available",
};

function observation(
  state: PokemonStateObservation,
  frame: number
): MgbaObservation {
  return {
    screenshot: {
      data: "screen",
      mediaType: "image/png",
      path: "/tmp/screen.png",
    },
    state,
    status: {
      activeButtons: [],
      frame,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    },
  };
}

describe("requiresOakAnalystFallbackSettleGate", () => {
  it("gates Oak dialogue fallback behind deterministic A, settle, and phase verification", () => {
    expect(getControllerFirstLlmFallbackGate(baseDecision)).toEqual({
      action: {
        button: "A",
        reason:
          "ControllerFirstFallbackGate: probe scripted/dialogue recovery with deterministic A before LLM fallback.",
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      maxVerificationAttempts:
        DEFAULT_CONTROLLER_FIRST_FALLBACK_GATE_MAX_ATTEMPTS_PER_EDGE,
      reason:
        "LLM fallback is gated until deterministic A, post-action settle, and RAM/phase verification fail.",
    });
    expect(requiresOakAnalystFallbackSettleGate(baseDecision)).toBe(true);
  });

  it("bypasses LLM fallback entirely during starter selection execution", () => {
    const starterSelectionDecision = {
      ...baseDecision,
      phase: "starter_selection",
      reason:
        "Oak Lab scripted flow received 10 repeated A taps without transition; fallback analyst must inspect",
      waypoint: "select-starter",
    } as const;

    expect(requiresOakAnalystFallbackSettleGate(starterSelectionDecision)).toBe(
      false
    );
    expect(
      getControllerFirstLlmFallbackGate(starterSelectionDecision)
    ).toBeUndefined();
    expect(
      getStarterSelectionLlmFallbackBypass(starterSelectionDecision)
    ).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
      reason: expect.stringContaining("fallback analyst is bypassed"),
    });
  });

  it("gates generic known-route fallback behind a deterministic A probe", () => {
    expect(
      getControllerFirstLlmFallbackGate({
        ...baseDecision,
        phase: "bedroom_2f",
        reason:
          "generic stuck interaction recovery already tried A without verified progress; fallback analyst must inspect",
        waypoint: "stair-warp",
      })
    ).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      expectedOutcome: "dialogue-progress",
    });
  });

  it("does not delay unrelated unknown-map fallback", () => {
    expect(
      requiresOakAnalystFallbackSettleGate({
        ...baseDecision,
        phase: "unknown",
        reason: "no deterministic policy for mapId=99",
        waypoint: "fallback-analysis",
      })
    ).toBe(false);
  });

  it("does not delay non-fallback deterministic decisions", () => {
    expect(
      requiresOakAnalystFallbackSettleGate({
        ...baseDecision,
        action: {
          button: "A",
          reason: "advance Oak dialogue",
          toolName: "mgba_tap",
        },
        expectedOutcome: "dialogue-progress",
        policy: "scripted-event",
      })
    ).toBe(false);
  });

  it("admits Oak fallback only after the deterministic routine and verification fail", () => {
    const before = observation(oakDialogueState, 100);
    const stalledAfter = observation({ ...oakDialogueState }, 180);
    const controllerRoutineDecision: DeterministicPolicyDecision = {
      action: {
        button: "A",
        reason:
          "OakDialogueAdvanceRoutine: repeated Oak dialogue verification reached the configured cap; invoke the bounded RuntimeGameState routine before any fallback analyst path is considered.",
        toolName: "mgba_tap",
      },
      controllerRoutine: {
        button: "A",
        checkpoints: [
          OAK_DIALOGUE_PHASE_CHECKPOINTS.oak_forced_walk_or_dialogue,
        ],
        configuredMaxRepeatedInputs: 6,
        expectedOutcome: "oak-dialogue-progress",
        name: "oak-dialogue-advance",
        repeatedInputsObserved: 6,
        runtimeSource: "RuntimeGameState",
        settle: {
          pollIntervalMs: SETTLE_POLL_INTERVAL_MS,
          strategy: "post-action-frame-settle",
          targetFrames: POST_ACTION_SETTLE_FRAMES,
        },
      },
      expectedOutcome: "oak-dialogue-progress",
      phase: "oak_forced_walk_or_dialogue",
      policy: "scripted-event",
      reason:
        "Oak dialogue received 6 repeated A taps without transition; deterministic Oak-dialogue advancement routine must run before fallback analyst consideration",
      waypoint: "advance-oak-forced-event",
    };

    expect(
      validateBoundedLlmFallbackInvocation({
        admission: {
          attempt: 1,
          edgeKey:
            "oak_forced_walk_or_dialogue|advance-oak-forced-event|premature",
          maxAttempts: 2,
          timeoutMs: DEFAULT_LLM_FALLBACK_TIMEOUT_MS,
        },
        decision: controllerRoutineDecision,
      })
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("controller-owned"),
    });

    const gate = getControllerFirstLlmFallbackGate(baseDecision);
    expect(gate).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      expectedOutcome: "oak-dialogue-progress",
    });
    expect(gate?.reason).toContain("post-action settle");
    if (!gate) {
      throw new Error("Oak fallback gate should exist before fallback");
    }

    const verification = verifyDeterministicOutcome({
      action: gate.action,
      after: stalledAfter,
      before,
      expectedOutcome: gate.expectedOutcome,
    });
    expect(verification).toMatchObject({
      success: false,
      reason: expect.stringContaining("stalled Oak dialogue state"),
    });

    const gateTracker = new ControllerFirstFallbackGateAttemptTracker();
    const firstGateAttempt = gateTracker.beginAttempt(baseDecision);
    expect(firstGateAttempt).toMatchObject({
      attempt: 1,
      expectedOutcome: "oak-dialogue-progress",
    });
    if (!firstGateAttempt || "fallbackEligible" in firstGateAttempt) {
      throw new Error("expected first gate attempt");
    }
    expect(
      validateBoundedLlmFallbackInvocation({
        admission: {
          attempt: 1,
          edgeKey:
            "oak_forced_walk_or_dialogue|advance-oak-forced-event|premature",
          maxAttempts: 2,
          timeoutMs: DEFAULT_LLM_FALLBACK_TIMEOUT_MS,
        },
        decision: baseDecision,
      })
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("A/settle/phase verification"),
    });
    gateTracker.completeAttempt({
      edgeKey: firstGateAttempt.edgeKey,
      success: false,
      verificationReason: verification.reason,
    });
    const secondGateAttempt = gateTracker.beginAttempt(baseDecision);
    if (!secondGateAttempt || "fallbackEligible" in secondGateAttempt) {
      throw new Error("expected second gate attempt");
    }
    const gateExhaustion = gateTracker.completeAttempt({
      edgeKey: secondGateAttempt.edgeKey,
      success: false,
      verificationReason: verification.reason,
    });
    expect(gateExhaustion).toMatchObject({
      attempts: 2,
      fallbackEligible: true,
      lastVerificationReason: verification.reason,
      maxAttempts: 2,
    });

    const budget = new BoundedLlmFallbackBudget();
    const admission = budget.beginAttempt(baseDecision);
    if ("recoveryAction" in admission) {
      throw new Error("Oak fallback should be admitted after gate completion");
    }
    expect(
      createBoundedLlmFallbackInvocationEvent({
        admission,
        controllerFirstGateExhaustion: gateExhaustion,
        decision: baseDecision,
      })
    ).toMatchObject({
      controllerFirstGate: {
        attempts: 2,
        maxAttempts: 2,
      },
      controlOwner: "llm-fallback",
      directControl: false,
      phase: "oak_forced_walk_or_dialogue",
      type: "llm-fallback-invocation",
    });
  });
});

describe("getRivalBattleLlmControlGuard", () => {
  it("blocks tool-enabled LLM control during unsupported rival battle UI", () => {
    expect(
      getRivalBattleLlmControlGuard({
        ...baseDecision,
        phase: "rival_battle",
        policy: "battle",
        reason:
          "BattlePolicy found no valid executable action for the current RAM battle UI; deterministic rival battle event is controller-owned and blocked for guarded recovery.",
        waypoint: "win-current-battle",
      })
    ).toEqual({
      reason: expect.stringContaining("must not open tool-enabled LLM"),
      stopReason: RIVAL_BATTLE_LLM_CONTROL_GUARD_STOP_REASON,
    });
  });

  it("does not block supported deterministic BattlePolicy actions", () => {
    expect(
      getRivalBattleLlmControlGuard({
        ...baseDecision,
        action: {
          button: "A",
          reason: "BattlePolicy: move slot 1 has PP and is selectable.",
          toolName: "mgba_tap",
        },
        expectedOutcome: "battle-progress",
        phase: "rival_battle",
        policy: "battle",
        reason: "rival battle phase is controller-owned by BattlePolicy",
        waypoint: "win-current-battle",
      })
    ).toBeUndefined();
  });
});

describe("ControllerFirstFallbackGateAttemptTracker", () => {
  it("tracks bounded deterministic A/settle/phase verification before fallback eligibility", () => {
    const tracker = new ControllerFirstFallbackGateAttemptTracker({
      maxAttemptsPerEdge: 2,
    });

    const first = tracker.beginAttempt(baseDecision);
    expect(first).toMatchObject({
      action: {
        button: "A",
        toolName: "mgba_tap",
      },
      attempt: 1,
      expectedOutcome: "oak-dialogue-progress",
      maxAttempts: 2,
    });
    if (!first || "fallbackEligible" in first) {
      throw new Error("expected first deterministic gate attempt");
    }
    expect(
      tracker.completeAttempt({
        edgeKey: first.edgeKey,
        success: false,
        verificationReason: "phase remained oak_forced_walk_or_dialogue",
      })
    ).toBeUndefined();

    const second = tracker.beginAttempt(baseDecision);
    expect(second).toMatchObject({
      attempt: 2,
      maxAttempts: 2,
    });
    if (!second || "fallbackEligible" in second) {
      throw new Error("expected second deterministic gate attempt");
    }
    const exhausted = tracker.completeAttempt({
      edgeKey: second.edgeKey,
      success: false,
      verificationReason: "phase remained oak_forced_walk_or_dialogue",
    });

    expect(exhausted).toMatchObject({
      attempts: 2,
      fallbackEligible: true,
      lastVerificationReason: "phase remained oak_forced_walk_or_dialogue",
      maxAttempts: 2,
      reason: expect.stringContaining("A/settle/phase verification exhausted"),
    });
    expect(tracker.beginAttempt(baseDecision)).toEqual(exhausted);
    expect(tracker.exhaustionFor(baseDecision)).toEqual(exhausted);
  });

  it("clears the bounded gate when deterministic verification succeeds", () => {
    const tracker = new ControllerFirstFallbackGateAttemptTracker();
    const first = tracker.beginAttempt(baseDecision);
    if (!first || "fallbackEligible" in first) {
      throw new Error("expected first deterministic gate attempt");
    }

    expect(
      tracker.completeAttempt({
        edgeKey: first.edgeKey,
        success: true,
        verificationReason: "phase advanced",
      })
    ).toBeUndefined();
    expect(tracker.snapshot()).toEqual({});
    expect(tracker.beginAttempt(baseDecision)).toMatchObject({ attempt: 1 });
  });
});

describe("BoundedLlmFallbackBudget", () => {
  it("admits only a bounded number of attempts for the same fallback edge", () => {
    const budget = new BoundedLlmFallbackBudget({
      maxAttemptsPerEdge: 2,
      timeoutMs: 123,
    });

    expect(budget.beginAttempt(baseDecision)).toMatchObject({
      attempt: 1,
      maxAttempts: 2,
      timeoutMs: 123,
    });
    expect(budget.beginAttempt(baseDecision)).toMatchObject({
      attempt: 2,
      maxAttempts: 2,
      timeoutMs: 123,
    });
    expect(budget.beginAttempt(baseDecision)).toMatchObject({
      attempts: 2,
      maxAttempts: 2,
      recoveryAction: {
        button: "B",
        toolName: "mgba_tap",
      },
      reason: expect.stringContaining("bounded LLM fallback blocked"),
    });
  });

  it("keeps timed-out attempts counted and clears naturally completed edges", () => {
    const budget = new BoundedLlmFallbackBudget({ maxAttemptsPerEdge: 1 });
    const first = budget.beginAttempt(baseDecision);
    expect(first).toMatchObject({ attempt: 1 });
    if ("recoveryAction" in first) {
      throw new Error("first attempt should be admitted");
    }

    budget.completeAttempt({
      edgeKey: first.edgeKey,
      result: "timeout",
    });
    expect(budget.beginAttempt(baseDecision)).toMatchObject({
      attempts: 1,
      lastResult: "timeout",
      recoveryAction: expect.any(Object),
      timedOut: true,
      timeoutMs: DEFAULT_LLM_FALLBACK_TIMEOUT_MS,
    });

    const otherDecision = {
      ...baseDecision,
      waypoint: "fallback-analysis",
    };
    const other = budget.beginAttempt(otherDecision);
    expect(other).toMatchObject({ attempt: 1 });
    if ("recoveryAction" in other) {
      throw new Error("other edge should be admitted");
    }
    budget.completeAttempt({
      edgeKey: other.edgeKey,
      result: "completed",
    });
    expect(budget.beginAttempt(otherDecision)).toMatchObject({ attempt: 1 });
  });
});

describe("LlmFallbackGate", () => {
  it("does not invoke the fallback analyst when Oak dialogue verification succeeds", () => {
    const before = observation(oakDialogueState, 100);
    const progressedAfter = observation(
      {
        ...oakDialogueState,
        mapId: 40,
        position: { x: 5, y: 3 },
      },
      220
    );
    const fallbackAnalyst = vi.fn(
      (_event: ReturnType<typeof createBoundedLlmFallbackInvocationEvent>) =>
        undefined
    );
    const gate = new LlmFallbackGate({ maxAttemptsPerEdge: 1 });
    const tracker = new ControllerFirstFallbackGateAttemptTracker({
      maxAttemptsPerEdge: 2,
    });

    const controllerAttempt = tracker.beginAttempt(baseDecision);
    if (!controllerAttempt || "fallbackEligible" in controllerAttempt) {
      throw new Error("expected deterministic controller-first gate attempt");
    }
    const verification = verifyDeterministicOutcome({
      action: controllerAttempt.action,
      after: progressedAfter,
      before,
      expectedOutcome: controllerAttempt.expectedOutcome,
    });

    expect(verification).toEqual({
      diagnostics: [],
      reason:
        "Oak dialogue RAM/phase progressed (oak_forced_walk_or_dialogue -> lab_before_starter)",
      success: true,
    });
    expect(
      tracker.completeAttempt({
        edgeKey: controllerAttempt.edgeKey,
        success: verification.success,
        verificationReason: verification.reason,
      })
    ).toBeUndefined();
    expect(tracker.snapshot()).toEqual({});
    expect(tracker.exhaustionFor(baseDecision)).toBeUndefined();

    const postSuccessInvocation = gate.beginInvocation({
      controllerFirstGateExhaustion: tracker.exhaustionFor(baseDecision),
      decision: baseDecision,
    });
    if (
      !(
        "allowed" in postSuccessInvocation ||
        "recoveryAction" in postSuccessInvocation
      )
    ) {
      fallbackAnalyst(
        createBoundedLlmFallbackInvocationEvent({
          admission: postSuccessInvocation,
          decision: baseDecision,
        })
      );
    }

    expect(postSuccessInvocation).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("must be exhausted"),
    });
    expect(gate.snapshot()).toEqual({});
    expect(fallbackAnalyst).not.toHaveBeenCalled();
  });

  it("does not invoke the fallback analyst until bounded deterministic verification is exhausted", () => {
    const before = observation(oakDialogueState, 100);
    const stalledAfter = observation({ ...oakDialogueState }, 180);
    const trace: string[] = [];
    const fallbackAnalyst = vi.fn(
      (_event: ReturnType<typeof createBoundedLlmFallbackInvocationEvent>) => {
        trace.push("llm-fallback-invoked");
      }
    );
    const gate = new LlmFallbackGate({ maxAttemptsPerEdge: 1 });
    const tracker = new ControllerFirstFallbackGateAttemptTracker({
      maxAttemptsPerEdge: 2,
    });
    const controllerProbe = getControllerFirstLlmFallbackGate(baseDecision);
    if (!controllerProbe) {
      throw new Error("expected controller-first deterministic gate");
    }

    const premature = gate.beginInvocation({ decision: baseDecision });
    expect(premature).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("must be exhausted"),
    });
    trace.push("premature-fallback-denied");
    expect(fallbackAnalyst).not.toHaveBeenCalled();

    const firstAttempt = tracker.beginAttempt(baseDecision);
    if (!firstAttempt || "fallbackEligible" in firstAttempt) {
      throw new Error("expected first deterministic verification attempt");
    }
    const firstVerification = verifyDeterministicOutcome({
      action: firstAttempt.action,
      after: stalledAfter,
      before,
      expectedOutcome: firstAttempt.expectedOutcome,
    });
    expect(firstVerification).toMatchObject({ success: false });
    trace.push(`oak-verification-failed:${firstVerification.reason}`);
    expect(
      tracker.completeAttempt({
        edgeKey: firstAttempt.edgeKey,
        success: firstVerification.success,
        verificationReason: firstVerification.reason,
      })
    ).toBeUndefined();
    const afterFirstFailure = gate.beginInvocation({ decision: baseDecision });
    expect(afterFirstFailure).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("must be exhausted"),
    });
    trace.push("fallback-denied-after-one-failure");
    expect(fallbackAnalyst).not.toHaveBeenCalled();
    expect(gate.snapshot()).toEqual({});

    const secondAttempt = tracker.beginAttempt(baseDecision);
    if (!secondAttempt || "fallbackEligible" in secondAttempt) {
      throw new Error("expected second deterministic verification attempt");
    }
    const secondVerification = verifyDeterministicOutcome({
      action: secondAttempt.action,
      after: stalledAfter,
      before,
      expectedOutcome: secondAttempt.expectedOutcome,
    });
    expect(secondVerification).toMatchObject({ success: false });
    trace.push(`oak-verification-failed:${secondVerification.reason}`);
    const exhaustion = tracker.completeAttempt({
      edgeKey: secondAttempt.edgeKey,
      success: secondVerification.success,
      verificationReason: secondVerification.reason,
    });
    if (!exhaustion) {
      throw new Error("expected bounded deterministic gate exhaustion");
    }

    const admitted = gate.beginInvocation({
      controllerFirstGateExhaustion: exhaustion,
      decision: baseDecision,
    });
    if ("allowed" in admitted || "recoveryAction" in admitted) {
      throw new Error("expected bounded fallback admission after exhaustion");
    }
    const event = createBoundedLlmFallbackInvocationEvent({
      admission: admitted,
      controllerFirstGateExhaustion: exhaustion,
      decision: baseDecision,
    });
    fallbackAnalyst(event);

    expect(trace).toEqual([
      "premature-fallback-denied",
      expect.stringMatching(STALLED_OAK_DIALOGUE_PATTERN),
      "fallback-denied-after-one-failure",
      expect.stringMatching(STALLED_OAK_DIALOGUE_PATTERN),
      "llm-fallback-invoked",
    ]);
    expect(fallbackAnalyst).toHaveBeenCalledTimes(1);
    expect(fallbackAnalyst).toHaveBeenCalledWith(
      expect.objectContaining({
        controllerFirstGate: {
          attempts: 2,
          edgeKey: exhaustion.edgeKey,
          maxAttempts: 2,
        },
        controlOwner: "llm-fallback",
        directControl: false,
        phase: "oak_forced_walk_or_dialogue",
        policy: "llm-fallback",
        type: "llm-fallback-invocation",
      })
    );
    expect(admitted).toMatchObject({
      deterministicExhaustion: {
        attempts: 2,
        edgeKey: exhaustion.edgeKey,
        kind: "controller-first-gate",
        lastVerificationReason: secondVerification.reason,
        maxAttempts: 2,
      },
    });
    expect(controllerProbe.expectedOutcome).toBe("oak-dialogue-progress");
  });

  it("denies controller-first fallback before deterministic attempts are exhausted without consuming budget", () => {
    const gate = new LlmFallbackGate({ maxAttemptsPerEdge: 1 });
    const premature = gate.beginInvocation({ decision: baseDecision });

    expect(premature).toMatchObject({
      allowed: false,
      edgeKey: expect.stringContaining(
        "oak_forced_walk_or_dialogue|advance-oak-forced-event"
      ),
      reason: expect.stringContaining("must be exhausted"),
    });
    expect(gate.snapshot()).toEqual({});

    const tracker = new ControllerFirstFallbackGateAttemptTracker({
      maxAttemptsPerEdge: 1,
    });
    const controllerAttempt = tracker.beginAttempt(baseDecision);
    if (!controllerAttempt || "fallbackEligible" in controllerAttempt) {
      throw new Error("expected deterministic controller-first gate attempt");
    }
    const controllerFirstGateExhaustion = tracker.completeAttempt({
      edgeKey: controllerAttempt.edgeKey,
      success: false,
      verificationReason: "phase remained oak_forced_walk_or_dialogue",
    });
    if (!controllerFirstGateExhaustion) {
      throw new Error("expected deterministic gate exhaustion");
    }

    const admitted = gate.beginInvocation({
      controllerFirstGateExhaustion,
      decision: baseDecision,
    });
    expect(admitted).toMatchObject({
      attempt: 1,
      deterministicExhaustion: {
        attempts: 1,
        edgeKey: expect.stringContaining(
          "oak_forced_walk_or_dialogue|advance-oak-forced-event"
        ),
        kind: "controller-first-gate",
        maxAttempts: 1,
      },
      edgeKey: expect.stringContaining(
        "oak_forced_walk_or_dialogue|advance-oak-forced-event"
      ),
      maxAttempts: 1,
    });
    expect(Object.values(gate.snapshot())).toEqual([1]);
  });

  it("admits unknown-state fallback through one policy-no-action gate", () => {
    const decision = {
      ...baseDecision,
      phase: "unknown",
      reason: "no deterministic policy for unknown RAM map",
      waypoint: "fallback-analysis",
    } as const;
    const gate = new LlmFallbackGate({ timeoutMs: 321 });
    const admitted = gate.beginInvocation({ decision });

    expect(admitted).toMatchObject({
      attempt: 1,
      deterministicExhaustion: {
        attempts: 0,
        edgeKey: expect.stringContaining("unknown|fallback-analysis"),
        kind: "policy-no-action",
        maxAttempts: 0,
      },
      edgeKey: expect.stringContaining("unknown|fallback-analysis"),
      timeoutMs: 321,
    });
    if ("allowed" in admitted || "recoveryAction" in admitted) {
      throw new Error("expected admitted fallback");
    }
    expect(
      createBoundedLlmFallbackInvocationEvent({
        admission: admitted,
        callMetadata: {
          attempt: admitted.attempt,
          callPath: "bounded-llm-fallback",
          controlOwner: "llm-fallback",
          edgeKey: admitted.edgeKey,
          modelName: "openai-compatible:gpt-test",
          timeoutMs: admitted.timeoutMs,
        },
        decision,
      })
    ).toMatchObject({
      callMetadata: {
        callPath: "bounded-llm-fallback",
        controlOwner: "llm-fallback",
        modelName: "openai-compatible:gpt-test",
      },
      controlOwner: "llm-fallback",
      directControl: false,
      validationReason: expect.stringContaining("deterministic controller gap"),
    });
  });
});

describe("bounded fallback analyst validation", () => {
  it("admits fallback only for no-action explicit failure or uncertainty decisions", () => {
    const unknownFallbackDecision = {
      ...baseDecision,
      phase: "unknown",
      reason: "no deterministic policy for unknown RAM map",
      waypoint: "fallback-analysis",
    } as const;
    const budget = new BoundedLlmFallbackBudget();
    const admission = budget.beginAttempt(unknownFallbackDecision);
    if ("recoveryAction" in admission) {
      throw new Error("base fallback should be admitted");
    }

    expect(
      validateBoundedLlmFallbackInvocation({
        admission,
        decision: unknownFallbackDecision,
      })
    ).toMatchObject({
      allowed: true,
      bounded: true,
      directControl: false,
      reason: expect.stringContaining("deterministic controller gap"),
    });
    expect(
      createBoundedLlmFallbackInvocationEvent({
        admission,
        decision: unknownFallbackDecision,
      })
    ).toMatchObject({
      attempt: 1,
      controlOwner: "llm-fallback",
      directControl: false,
      maxAttempts: 2,
      policy: "llm-fallback",
      type: "llm-fallback-invocation",
    });
  });

  it("rejects fallback when deterministic controller action exists", () => {
    expect(
      validateBoundedLlmFallbackInvocation({
        admission: {
          attempt: 1,
          edgeKey: "dialogue|advance|controller-owned",
          maxAttempts: 2,
          timeoutMs: 15_000,
        },
        decision: {
          ...baseDecision,
          action: {
            button: "A",
            reason: "DialoguePolicy: advance forced dialogue.",
            toolName: "mgba_tap",
          },
          expectedOutcome: "dialogue-progress",
          policy: "dialogue",
          reason: "dialogue-like state is active",
        },
      })
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("controller-owned"),
    });
  });

  it("rejects fallback during controller-owned starter selection", () => {
    expect(
      validateBoundedLlmFallbackInvocation({
        admission: {
          attempt: 1,
          edgeKey: "starter_selection|select-starter|repeated",
          maxAttempts: 2,
          timeoutMs: 15_000,
        },
        decision: {
          ...baseDecision,
          phase: "starter_selection",
          reason:
            "Oak Lab scripted flow received 10 repeated A taps without transition; fallback analyst must inspect",
          waypoint: "select-starter",
        },
      })
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("starter_selection"),
    });
  });

  it("validates fallback stream controls as bounded analyst-owned events", () => {
    expect(
      validateFallbackAnalystBoundary([
        {
          controlOwner: "llm-fallback",
          directControl: false,
          type: "llm-fallback-invocation",
        },
        {
          controlOwner: "llm-fallback",
          input: { button: "B" },
          toolCallId: "fallback-stream-1",
          toolName: "mgba_tap",
          type: "tool-call",
        },
      ])
    ).toMatchObject({
      controlToolCalls: 1,
      hasInvocation: true,
      issues: [],
      valid: true,
    });

    expect(
      validateFallbackAnalystBoundary([
        {
          controlOwner: "deterministic-controller",
          input: { button: "A" },
          toolCallId: "bad-fallback-stream-1",
          toolName: "mgba_tap",
          type: "tool-call",
        },
      ])
    ).toMatchObject({
      hasInvocation: false,
      valid: false,
      issues: expect.arrayContaining([
        expect.stringContaining("before bounded admission"),
        expect.stringContaining("deterministic controller input ownership"),
      ]),
    });
  });
});
