import type {
  DeterministicExpectedOutcome,
  DeterministicPolicyDecision,
} from "./deterministic-policy";
import type { AutopilotAction } from "./stage1-fast-autopilot";
import type { TokenUsageCallMetadata } from "./token-usage";

export const DEFAULT_LLM_FALLBACK_MAX_ATTEMPTS_PER_EDGE = 2;
export const DEFAULT_LLM_FALLBACK_TIMEOUT_MS = 15_000;
export const DEFAULT_CONTROLLER_FIRST_FALLBACK_GATE_MAX_ATTEMPTS_PER_EDGE = 2;
export const RIVAL_BATTLE_LLM_CONTROL_GUARD_STOP_REASON =
  "rival-battle-controller-guard:unsupported-battle-ui";

const CONTROLLER_FIRST_FALLBACK_GATE_PHASES = new Set([
  "bedroom_2f",
  "house_1f",
  "lab_before_starter",
  "pallet_after_starter",
  "oak_forced_walk_or_dialogue",
  "pallet_before_oak",
  "route1",
  "starter_selection",
  "viridian",
]);

const CONTROLLER_FIRST_FALLBACK_REASON_PATTERN =
  /\b(Oak dialogue|Oak Lab|Oak trigger|forced Oak|dialogue advanced|generic stuck interaction|known Stage 1 route exhausted|scripted)\b/i;

const OAK_ANALYST_FALLBACK_REASON_PATTERN =
  /\b(Oak dialogue|Oak Lab|Oak trigger|forced Oak)\b/i;

export interface ControllerFirstLlmFallbackGate {
  action: AutopilotAction;
  expectedOutcome: DeterministicExpectedOutcome;
  maxVerificationAttempts: number;
  reason: string;
}

export interface ControllerFirstFallbackGateAttempt {
  action: AutopilotAction;
  attempt: number;
  edgeKey: string;
  expectedOutcome: DeterministicExpectedOutcome;
  maxAttempts: number;
  reason: string;
}

export interface ControllerFirstFallbackGateExhaustion {
  attempts: number;
  edgeKey: string;
  fallbackEligible: true;
  lastVerificationReason: string | undefined;
  maxAttempts: number;
  reason: string;
}

export interface ControllerFirstFallbackGateAttemptCompletion {
  edgeKey: string;
  success: boolean;
  verificationReason: string;
}

export interface RivalBattleLlmControlGuard {
  reason: string;
  stopReason: string;
}

export interface LlmFallbackAttemptAdmission {
  attempt: number;
  edgeKey: string;
  maxAttempts: number;
  timeoutMs: number;
}

export interface LlmFallbackGateAdmission extends LlmFallbackAttemptAdmission {
  deterministicExhaustion: DeterministicFallbackExhaustionEvidence;
}

export interface LlmFallbackGateDenial {
  allowed: false;
  edgeKey: string;
  reason: string;
}

export interface LlmFallbackAttemptBlock {
  attempts: number;
  edgeKey: string;
  lastResult: LlmFallbackAttemptCompletion["result"] | undefined;
  maxAttempts: number;
  reason: string;
  recoveryAction: AutopilotAction;
  timedOut: boolean;
  timeoutMs: number;
}

export interface LlmFallbackAttemptCompletion {
  edgeKey: string;
  result: "completed" | "error" | "interrupted" | "timeout";
}

export interface BoundedLlmFallbackInvocationEvent {
  attempt: number;
  callMetadata?: TokenUsageCallMetadata;
  controllerFirstGate?: {
    attempts: number;
    edgeKey: string;
    maxAttempts: number;
  };
  controlOwner: "llm-fallback";
  directControl: false;
  edgeKey: string;
  maxAttempts: number;
  phase: string;
  policy: "llm-fallback";
  reason: string;
  timeoutMs: number;
  type: "llm-fallback-invocation";
  validationReason: string;
  waypoint: string;
}

export interface LlmFallbackInvocationValidation {
  allowed: boolean;
  bounded: boolean;
  conditions: readonly string[];
  directControl: false;
  reason: string;
}

export interface FallbackAnalystBoundaryValidation {
  controlToolCalls: number;
  hasInvocation: boolean;
  issues: readonly string[];
  valid: boolean;
}

export interface DeterministicFallbackExhaustionEvidence {
  attempts: number;
  edgeKey: string;
  kind: "controller-first-gate" | "policy-no-action";
  lastVerificationReason?: string;
  maxAttempts: number;
  reason: string;
}

interface FallbackBoundaryEvent {
  controlOwner?: unknown;
  directControl?: unknown;
  toolName?: unknown;
  type?: unknown;
  [key: string]: unknown;
}

const LLM_FALLBACK_EXPLICIT_CONDITION_PATTERN =
  /\b(RAM state unavailable|no deterministic policy|unknown|unsupported|repeated|without clear state transition|without transition|failed without RAM progress|both failed|exhausted|stuck|scripted|collision|must inspect|may use vision)\b/i;

const FALLBACK_CONTROL_TOOLS = new Set([
  "mgba_tap",
  "mgba_tap_many",
  "mgba_hold",
  "mgba_hold_many",
  "mgba_release",
]);

export class BoundedLlmFallbackBudget {
  readonly #attemptsByEdge = new Map<string, number>();
  readonly #lastResultByEdge = new Map<
    string,
    LlmFallbackAttemptCompletion["result"]
  >();
  readonly #maxAttemptsPerEdge: number;
  readonly #timeoutMs: number;

  constructor({
    maxAttemptsPerEdge = DEFAULT_LLM_FALLBACK_MAX_ATTEMPTS_PER_EDGE,
    timeoutMs = DEFAULT_LLM_FALLBACK_TIMEOUT_MS,
  }: {
    maxAttemptsPerEdge?: number;
    timeoutMs?: number;
  } = {}) {
    this.#maxAttemptsPerEdge = Math.max(1, Math.trunc(maxAttemptsPerEdge));
    this.#timeoutMs = Math.max(1, Math.trunc(timeoutMs));
  }

  beginAttempt(
    decision: DeterministicPolicyDecision
  ): LlmFallbackAttemptAdmission | LlmFallbackAttemptBlock {
    const edgeKey = fallbackEdgeKey(decision);
    const attempts = this.#attemptsByEdge.get(edgeKey) ?? 0;
    if (attempts >= this.#maxAttemptsPerEdge) {
      const lastResult = this.#lastResultByEdge.get(edgeKey);
      return {
        attempts,
        edgeKey,
        lastResult,
        maxAttempts: this.#maxAttemptsPerEdge,
        reason: `bounded LLM fallback blocked after ${attempts}/${this.#maxAttemptsPerEdge} attempts for ${edgeKey}`,
        recoveryAction: {
          button: "B",
          reason:
            "BoundedLlmFallbackBudget: fallback retry budget exhausted; return to deterministic controller with one safe cancel/recovery probe.",
          toolName: "mgba_tap",
        },
        timedOut: lastResult === "timeout",
        timeoutMs: this.#timeoutMs,
      };
    }

    const attempt = attempts + 1;
    this.#attemptsByEdge.set(edgeKey, attempt);
    return {
      attempt,
      edgeKey,
      maxAttempts: this.#maxAttemptsPerEdge,
      timeoutMs: this.#timeoutMs,
    };
  }

  completeAttempt(completion: LlmFallbackAttemptCompletion): void {
    if (completion.result === "completed") {
      this.#attemptsByEdge.delete(completion.edgeKey);
      this.#lastResultByEdge.delete(completion.edgeKey);
      return;
    }
    this.#lastResultByEdge.set(completion.edgeKey, completion.result);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.#attemptsByEdge);
  }
}

export class LlmFallbackGate {
  readonly #budget: BoundedLlmFallbackBudget;

  constructor({
    maxAttemptsPerEdge = DEFAULT_LLM_FALLBACK_MAX_ATTEMPTS_PER_EDGE,
    timeoutMs = DEFAULT_LLM_FALLBACK_TIMEOUT_MS,
  }: {
    maxAttemptsPerEdge?: number;
    timeoutMs?: number;
  } = {}) {
    this.#budget = new BoundedLlmFallbackBudget({
      maxAttemptsPerEdge,
      timeoutMs,
    });
  }

  beginInvocation({
    controllerFirstGateExhaustion,
    decision,
  }: {
    controllerFirstGateExhaustion?: ControllerFirstFallbackGateExhaustion;
    decision: DeterministicPolicyDecision;
  }):
    | LlmFallbackGateAdmission
    | LlmFallbackAttemptBlock
    | LlmFallbackGateDenial {
    const deterministicExhaustion = getDeterministicFallbackExhaustionEvidence({
      controllerFirstGateExhaustion,
      decision,
    });
    if (!deterministicExhaustion) {
      const validation = validateBoundedLlmFallbackInvocation({
        controllerFirstGateExhaustion,
        decision,
      });
      return {
        allowed: false,
        edgeKey: fallbackEdgeKey(decision),
        reason: validation.reason,
      };
    }

    const admission = this.#budget.beginAttempt(decision);
    if ("recoveryAction" in admission) {
      return admission;
    }

    return {
      ...admission,
      deterministicExhaustion,
    };
  }

  completeAttempt(completion: LlmFallbackAttemptCompletion): void {
    this.#budget.completeAttempt(completion);
  }

  snapshot(): Record<string, number> {
    return this.#budget.snapshot();
  }
}

export class ControllerFirstFallbackGateAttemptTracker {
  readonly #attemptsByEdge = new Map<string, number>();
  readonly #lastVerificationReasonByEdge = new Map<string, string>();
  readonly #maxAttemptsPerEdge: number;

  constructor({
    maxAttemptsPerEdge = DEFAULT_CONTROLLER_FIRST_FALLBACK_GATE_MAX_ATTEMPTS_PER_EDGE,
  }: {
    maxAttemptsPerEdge?: number;
  } = {}) {
    this.#maxAttemptsPerEdge = Math.max(1, Math.trunc(maxAttemptsPerEdge));
  }

  beginAttempt(
    decision: DeterministicPolicyDecision
  ):
    | ControllerFirstFallbackGateAttempt
    | ControllerFirstFallbackGateExhaustion
    | undefined {
    const gate = getControllerFirstLlmFallbackGate(decision);
    if (!gate) {
      return;
    }

    const edgeKey = fallbackEdgeKey(decision);
    const attempts = this.#attemptsByEdge.get(edgeKey) ?? 0;
    if (attempts >= this.#maxAttemptsPerEdge) {
      return this.#exhaustion(edgeKey, attempts);
    }

    return {
      action: gate.action,
      attempt: attempts + 1,
      edgeKey,
      expectedOutcome: gate.expectedOutcome,
      maxAttempts: this.#maxAttemptsPerEdge,
      reason: gate.reason,
    };
  }

  completeAttempt({
    edgeKey,
    success,
    verificationReason,
  }: ControllerFirstFallbackGateAttemptCompletion):
    | ControllerFirstFallbackGateExhaustion
    | undefined {
    if (success) {
      this.#attemptsByEdge.delete(edgeKey);
      this.#lastVerificationReasonByEdge.delete(edgeKey);
      return;
    }

    const attempts = (this.#attemptsByEdge.get(edgeKey) ?? 0) + 1;
    this.#attemptsByEdge.set(edgeKey, attempts);
    this.#lastVerificationReasonByEdge.set(edgeKey, verificationReason);
    if (attempts >= this.#maxAttemptsPerEdge) {
      return this.#exhaustion(edgeKey, attempts);
    }
  }

  exhaustionFor(
    decision: DeterministicPolicyDecision
  ): ControllerFirstFallbackGateExhaustion | undefined {
    if (!getControllerFirstLlmFallbackGate(decision)) {
      return;
    }
    const edgeKey = fallbackEdgeKey(decision);
    const attempts = this.#attemptsByEdge.get(edgeKey) ?? 0;
    return attempts >= this.#maxAttemptsPerEdge
      ? this.#exhaustion(edgeKey, attempts)
      : undefined;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.#attemptsByEdge);
  }

  #exhaustion(
    edgeKey: string,
    attempts: number
  ): ControllerFirstFallbackGateExhaustion {
    return {
      attempts,
      edgeKey,
      fallbackEligible: true,
      lastVerificationReason: this.#lastVerificationReasonByEdge.get(edgeKey),
      maxAttempts: this.#maxAttemptsPerEdge,
      reason: `controller-first deterministic A/settle/phase verification exhausted after ${attempts}/${this.#maxAttemptsPerEdge} attempts for ${edgeKey}`,
    };
  }
}

export function getControllerFirstLlmFallbackGate(
  decision: DeterministicPolicyDecision
): ControllerFirstLlmFallbackGate | undefined {
  if (
    decision.policy !== "llm-fallback" ||
    decision.phase === "starter_selection" ||
    !CONTROLLER_FIRST_FALLBACK_GATE_PHASES.has(decision.phase) ||
    !CONTROLLER_FIRST_FALLBACK_REASON_PATTERN.test(decision.reason)
  ) {
    return;
  }

  return {
    action: {
      button: "A",
      reason:
        "ControllerFirstFallbackGate: probe scripted/dialogue recovery with deterministic A before LLM fallback.",
      toolName: "mgba_tap",
    },
    expectedOutcome: OAK_ANALYST_FALLBACK_REASON_PATTERN.test(decision.reason)
      ? "oak-dialogue-progress"
      : "dialogue-progress",
    maxVerificationAttempts:
      DEFAULT_CONTROLLER_FIRST_FALLBACK_GATE_MAX_ATTEMPTS_PER_EDGE,
    reason:
      "LLM fallback is gated until deterministic A, post-action settle, and RAM/phase verification fail.",
  };
}

export function getStarterSelectionLlmFallbackBypass(
  decision: DeterministicPolicyDecision
): ControllerFirstLlmFallbackGate | undefined {
  if (
    decision.policy !== "llm-fallback" ||
    decision.phase !== "starter_selection"
  ) {
    return;
  }

  return {
    action: {
      button: "A",
      reason:
        "StarterSelectionFallbackBypass: starter selection remains controller-owned; confirm deterministic starter prompt and keep fallback analyst bypassed.",
      toolName: "mgba_tap",
    },
    expectedOutcome: "oak-dialogue-progress",
    maxVerificationAttempts:
      DEFAULT_CONTROLLER_FIRST_FALLBACK_GATE_MAX_ATTEMPTS_PER_EDGE,
    reason:
      "starter_selection fallback analyst is bypassed until RAM/phase leaves deterministic starter execution.",
  };
}

export function getRivalBattleLlmControlGuard(
  decision: DeterministicPolicyDecision
): RivalBattleLlmControlGuard | undefined {
  if (
    decision.phase !== "rival_battle" ||
    decision.policy !== "battle" ||
    decision.action
  ) {
    return;
  }

  return {
    reason:
      "rival_battle is controller-owned by BattlePolicy; unsupported battle UI is a guarded controller gap and must not open tool-enabled LLM or ad hoc fallback control.",
    stopReason: RIVAL_BATTLE_LLM_CONTROL_GUARD_STOP_REASON,
  };
}

export function requiresOakAnalystFallbackSettleGate(
  decision: DeterministicPolicyDecision
): boolean {
  return getControllerFirstLlmFallbackGate(decision) !== undefined;
}

export function validateBoundedLlmFallbackInvocation({
  admission,
  controllerFirstGateExhaustion,
  deterministicExhaustion,
  decision,
}: {
  admission?: LlmFallbackAttemptAdmission;
  controllerFirstGateExhaustion?: ControllerFirstFallbackGateExhaustion;
  deterministicExhaustion?: DeterministicFallbackExhaustionEvidence;
  decision: DeterministicPolicyDecision;
}): LlmFallbackInvocationValidation {
  if (decision.policy !== "llm-fallback") {
    return blockedFallbackValidation(
      `policy ${decision.policy} is controller-owned and cannot invoke the LLM fallback analyst`
    );
  }
  if (decision.action) {
    return blockedFallbackValidation(
      "deterministic controller action is available; LLM fallback analyst is not admissible"
    );
  }
  if (getStarterSelectionLlmFallbackBypass(decision)) {
    return blockedFallbackValidation(
      "starter_selection is controller-owned; fallback analyst is bypassed"
    );
  }
  if (!LLM_FALLBACK_EXPLICIT_CONDITION_PATTERN.test(decision.reason)) {
    return blockedFallbackValidation(
      `fallback reason is not an explicit failure or uncertainty condition: ${decision.reason}`
    );
  }
  if (
    getControllerFirstLlmFallbackGate(decision) &&
    !controllerFirstGateExhaustion
  ) {
    return blockedFallbackValidation(
      "controller-first deterministic A/settle/phase verification must be exhausted before invoking the LLM fallback analyst"
    );
  }
  if (
    deterministicExhaustion &&
    deterministicExhaustion.edgeKey !== fallbackEdgeKey(decision)
  ) {
    return blockedFallbackValidation(
      `deterministic exhaustion evidence is for ${deterministicExhaustion.edgeKey}, not ${fallbackEdgeKey(decision)}`
    );
  }
  if (!admission) {
    return blockedFallbackValidation(
      "bounded fallback budget admission is required before invoking the LLM fallback analyst"
    );
  }

  return {
    allowed: true,
    bounded: true,
    conditions: [
      "no deterministic action",
      "policy=llm-fallback",
      "explicit failure or uncertainty reason",
      `attempt ${admission.attempt}/${admission.maxAttempts}`,
      `timeoutMs=${admission.timeoutMs}`,
      ...(controllerFirstGateExhaustion
        ? [
            `controller-first gate exhausted ${controllerFirstGateExhaustion.attempts}/${controllerFirstGateExhaustion.maxAttempts}`,
          ]
        : []),
      ...(deterministicExhaustion
        ? [
            `deterministic attempts exhausted via ${deterministicExhaustion.kind}`,
          ]
        : []),
    ],
    directControl: false,
    reason:
      "bounded fallback analyst invocation admitted after deterministic controller gap evidence",
  };
}

export function createBoundedLlmFallbackInvocationEvent({
  admission,
  callMetadata,
  controllerFirstGateExhaustion,
  deterministicExhaustion,
  decision,
}: {
  admission: LlmFallbackAttemptAdmission | LlmFallbackGateAdmission;
  callMetadata?: TokenUsageCallMetadata;
  controllerFirstGateExhaustion?: ControllerFirstFallbackGateExhaustion;
  deterministicExhaustion?: DeterministicFallbackExhaustionEvidence;
  decision: DeterministicPolicyDecision;
}): BoundedLlmFallbackInvocationEvent {
  const resolvedDeterministicExhaustion =
    deterministicExhaustion ??
    ("deterministicExhaustion" in admission
      ? admission.deterministicExhaustion
      : undefined);
  const validation = validateBoundedLlmFallbackInvocation({
    admission,
    controllerFirstGateExhaustion,
    deterministicExhaustion: resolvedDeterministicExhaustion,
    decision,
  });
  if (!validation.allowed) {
    throw new Error(validation.reason);
  }

  return {
    attempt: admission.attempt,
    ...(callMetadata ? { callMetadata: { ...callMetadata } } : {}),
    ...(controllerFirstGateExhaustion
      ? {
          controllerFirstGate: {
            attempts: controllerFirstGateExhaustion.attempts,
            edgeKey: controllerFirstGateExhaustion.edgeKey,
            maxAttempts: controllerFirstGateExhaustion.maxAttempts,
          },
        }
      : {}),
    controlOwner: "llm-fallback",
    directControl: false,
    edgeKey: admission.edgeKey,
    maxAttempts: admission.maxAttempts,
    phase: decision.phase,
    policy: "llm-fallback",
    reason: decision.reason,
    timeoutMs: admission.timeoutMs,
    type: "llm-fallback-invocation",
    validationReason: validation.reason,
    waypoint: decision.waypoint,
  };
}

export function getDeterministicFallbackExhaustionEvidence({
  controllerFirstGateExhaustion,
  decision,
}: {
  controllerFirstGateExhaustion?: ControllerFirstFallbackGateExhaustion;
  decision: DeterministicPolicyDecision;
}): DeterministicFallbackExhaustionEvidence | undefined {
  const edgeKey = fallbackEdgeKey(decision);
  if (getControllerFirstLlmFallbackGate(decision)) {
    if (!controllerFirstGateExhaustion) {
      return;
    }
    return {
      attempts: controllerFirstGateExhaustion.attempts,
      edgeKey,
      kind: "controller-first-gate",
      lastVerificationReason:
        controllerFirstGateExhaustion.lastVerificationReason,
      maxAttempts: controllerFirstGateExhaustion.maxAttempts,
      reason: controllerFirstGateExhaustion.reason,
    };
  }
  if (
    decision.policy === "llm-fallback" &&
    !decision.action &&
    !getStarterSelectionLlmFallbackBypass(decision) &&
    LLM_FALLBACK_EXPLICIT_CONDITION_PATTERN.test(decision.reason)
  ) {
    return {
      attempts: 0,
      edgeKey,
      kind: "policy-no-action",
      maxAttempts: 0,
      reason:
        "deterministic policy returned no controller action for a permitted fallback condition",
    };
  }
}

export function validateFallbackAnalystBoundary(
  events: readonly FallbackBoundaryEvent[],
  { maxControlToolCalls = 1 }: { maxControlToolCalls?: number } = {}
): FallbackAnalystBoundaryValidation {
  const issues: string[] = [];
  const hasInvocation = events.some(
    (event) =>
      event.type === "llm-fallback-invocation" &&
      event.controlOwner === "llm-fallback" &&
      event.directControl === false
  );
  const controlToolCalls = events.filter(isControlToolCall).length;

  if (!hasInvocation && controlToolCalls > 0) {
    issues.push("fallback control event observed before bounded admission");
  }
  if (controlToolCalls > maxControlToolCalls) {
    issues.push(
      `fallback analyst emitted ${controlToolCalls} control calls; max is ${maxControlToolCalls}`
    );
  }

  for (const event of events) {
    if (!isControlToolCall(event)) {
      continue;
    }
    if (event.controlOwner === "deterministic-controller") {
      issues.push(
        "fallback analyst stream attempted to claim deterministic controller input ownership"
      );
      continue;
    }
    if (event.controlOwner !== "llm-fallback") {
      issues.push(
        "fallback analyst control event lacks llm-fallback ownership"
      );
    }
  }

  return {
    controlToolCalls,
    hasInvocation,
    issues,
    valid: issues.length === 0,
  };
}

function blockedFallbackValidation(
  reason: string
): LlmFallbackInvocationValidation {
  return {
    allowed: false,
    bounded: false,
    conditions: [],
    directControl: false,
    reason,
  };
}

function isControlToolCall(event: FallbackBoundaryEvent): boolean {
  return (
    event.type === "tool-call" &&
    typeof event.toolName === "string" &&
    FALLBACK_CONTROL_TOOLS.has(event.toolName)
  );
}

function fallbackEdgeKey(decision: DeterministicPolicyDecision): string {
  return [
    decision.phase,
    decision.waypoint,
    decision.reason.replace(/\s+/gu, " ").trim(),
  ].join("|");
}
