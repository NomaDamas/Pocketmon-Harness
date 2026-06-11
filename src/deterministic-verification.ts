import type {
  DeterministicControllerRoutine,
  DeterministicExpectedOutcome,
} from "./deterministic-policy";
import { OAK_DIALOGUE_PHASE_CHECKPOINTS } from "./deterministic-policy";
import type { MgbaButton } from "./mgba-http";
import type { MgbaObservation } from "./observation";
import { detectPokemonPhase, type PokemonPhase } from "./phase-detector";
import type { AutopilotAction } from "./stage1-fast-autopilot";
import {
  OAK_LAB_STARTER_APPROACH_POSITION,
  type PokemonRedStarterPreference,
  resolvePokemonRedStarterFixedControllerSequence,
  resolvePokemonRedStarterPreference,
  resolvePokemonRedStarterSelectionPlan,
} from "./starter-preference";

const OAK_DIALOGUE_PHASES = new Set<PokemonPhase>([
  "lab_before_starter",
  "oak_forced_walk_or_dialogue",
  "starter_selection",
]);
const MAX_VERIFICATION_DIAGNOSTICS = 3;
const MAX_VERIFICATION_EVIDENCE = 8;
const MAX_VERIFICATION_EVIDENCE_CHARS = 180;

export interface DeterministicVerificationDiagnostic {
  readonly evidence: readonly string[];
  readonly kind:
    | "battle-progress-not-observed"
    | "dialogue-progress-not-observed"
    | "movement-progress-not-observed"
    | "oak-dialogue-checkpoint-failed"
    | "runtime-state-unavailable";
  readonly message: string;
  readonly runtimeSource: "RuntimeGameState";
}

export interface DeterministicVerificationResult {
  readonly diagnostics: readonly DeterministicVerificationDiagnostic[];
  readonly reason: string;
  readonly success: boolean;
}

export interface PokemonRedStarterSelectionVerificationRun {
  readonly confirmedStarter?: PokemonRedStarterPreference;
  readonly finalPosition: {
    readonly mapId: typeof OAK_LAB_STARTER_APPROACH_POSITION.mapId;
    readonly x: number;
    readonly y: number;
  };
  readonly selectedStarter?: PokemonRedStarterPreference;
  readonly sequenceButtons: readonly MgbaButton[];
}

export interface PokemonRedStarterSelectionVerification {
  readonly expectedStarter: PokemonRedStarterPreference;
  readonly expectedTarget: {
    readonly id: `oak-lab-starter-${PokemonRedStarterPreference}`;
    readonly label: string;
    readonly mapId: typeof OAK_LAB_STARTER_APPROACH_POSITION.mapId;
    readonly x: number;
    readonly y: number;
  };
  readonly reason: string;
  readonly repetitions: number;
  readonly runs: readonly PokemonRedStarterSelectionVerificationRun[];
  readonly runtimeSource: "RuntimeGameState";
  readonly sequenceButtons: readonly MgbaButton[];
  readonly success: boolean;
}

export function resolveDeterministicVerificationExpectedOutcome({
  controllerRoutine,
  expectedOutcome,
}: {
  controllerRoutine?: DeterministicControllerRoutine;
  expectedOutcome?: DeterministicExpectedOutcome;
}): DeterministicExpectedOutcome | undefined {
  if (controllerRoutine?.name === "oak-dialogue-advance") {
    return controllerRoutine.expectedOutcome;
  }
  return expectedOutcome;
}

export function verifyDeterministicOutcome({
  action,
  after,
  before,
  expectedOutcome,
}: {
  action: AutopilotAction;
  after: MgbaObservation;
  before: MgbaObservation;
  expectedOutcome?: DeterministicExpectedOutcome;
}): DeterministicVerificationResult {
  if (!expectedOutcome) {
    return verificationResult({
      reason: "no explicit expected outcome",
      success: true,
    });
  }
  const beforeState = before.state;
  const afterState = after.state;
  if (!(beforeState && afterState)) {
    return verificationResult({
      diagnostics: [
        createVerificationDiagnostic({
          after,
          before,
          kind: "runtime-state-unavailable",
          message:
            "RuntimeGameState was unavailable before or after deterministic action.",
        }),
      ],
      reason: "state unavailable for verification",
      success: false,
    });
  }
  if (expectedOutcome === "movement-or-map-change") {
    const moved =
      beforeState.mapId !== afterState.mapId ||
      beforeState.position.x !== afterState.position.x ||
      beforeState.position.y !== afterState.position.y;
    return verificationResult({
      diagnostics: moved
        ? []
        : [
            createVerificationDiagnostic({
              action,
              after,
              before,
              kind: "movement-progress-not-observed",
              message:
                "Expected map or tile coordinate movement was not observed in RuntimeGameState.",
            }),
          ],
      reason: moved
        ? "RAM map/position changed after movement"
        : `no RAM movement after ${action.toolName}:${action.button}`,
      success: moved,
    });
  }
  if (expectedOutcome === "battle-progress") {
    const frameAdvanced = before.status.frame !== after.status.frame;
    return verificationResult({
      diagnostics: frameAdvanced
        ? []
        : [
            createVerificationDiagnostic({
              action,
              after,
              before,
              kind: "battle-progress-not-observed",
              message:
                "Expected battle action progress was not observed after deterministic input.",
            }),
          ],
      reason:
        before.status.frame === after.status.frame
          ? "frame did not advance during battle action"
          : "frame advanced during battle action",
      success: frameAdvanced,
    });
  }
  if (expectedOutcome === "oak-dialogue-progress") {
    return verifyOakDialogueProgress({ action, after, before });
  }
  return verifyDialogueProgress({ action, after, before });
}

function verifyDialogueProgress({
  action,
  after,
  before,
}: {
  action: AutopilotAction;
  after: MgbaObservation;
  before: MgbaObservation;
}): DeterministicVerificationResult {
  const beforeState = before.state;
  const afterState = after.state;
  if (!(beforeState && afterState)) {
    return verificationResult({
      diagnostics: [
        createVerificationDiagnostic({
          after,
          before,
          kind: "runtime-state-unavailable",
          message:
            "RuntimeGameState was unavailable before or after deterministic action.",
        }),
      ],
      reason: "state unavailable for verification",
      success: false,
    });
  }
  const progressed =
    beforeState.dialogueLike !== afterState.dialogueLike ||
    beforeState.menuLike !== afterState.menuLike ||
    beforeState.battle !== afterState.battle ||
    beforeState.mapId !== afterState.mapId ||
    beforeState.position.x !== afterState.position.x ||
    beforeState.position.y !== afterState.position.y;
  const confirmedUiAdvanced =
    (beforeState.dialogueLike === true || beforeState.menuLike === true) &&
    before.status.frame !== after.status.frame;
  const success = progressed || confirmedUiAdvanced;
  return verificationResult({
    diagnostics: success
      ? []
      : [
          createVerificationDiagnostic({
            action,
            after,
            before,
            kind: "dialogue-progress-not-observed",
            message:
              "Expected dialogue, menu, script, map, position, or battle transition was not observed.",
          }),
        ],
    reason: success
      ? "dialogue/menu/script RAM state changed or confirmed UI advanced"
      : `no dialogue/script progress after ${action.toolName}:${action.button}`,
    success,
  });
}

export function verifyPokemonRedStarterSelectionSequence({
  repetitions = 3,
  starterPreference,
}: {
  repetitions?: number;
  starterPreference?: string | null;
}): PokemonRedStarterSelectionVerification {
  const expectedStarter = resolvePokemonRedStarterPreference(
    starterPreference
  ) as PokemonRedStarterPreference;
  const plan = resolvePokemonRedStarterSelectionPlan(expectedStarter);
  const configuredSequence =
    resolvePokemonRedStarterFixedControllerSequence(expectedStarter);
  const sequenceButtons = plan.sequenceButtons;
  const expectedTarget = plan.targetSelection.target;

  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("Starter selection verification repetitions must be >= 1.");
  }

  if (!sameButtonSequence(sequenceButtons, configuredSequence)) {
    return {
      expectedStarter,
      expectedTarget,
      reason: `configured starter sequence mismatch for ${expectedTarget.label}: plan=${sequenceButtons.join(" -> ")} configured=${configuredSequence.join(" -> ")}`,
      repetitions,
      runtimeSource: "RuntimeGameState",
      runs: [],
      sequenceButtons,
      success: false,
    };
  }

  const runs = Array.from({ length: repetitions }, () =>
    runStarterSelectionSequence({
      expectedStarter,
      sequenceButtons,
    })
  );
  const failedRun = runs.find(
    (run) =>
      run.selectedStarter !== expectedStarter ||
      run.confirmedStarter !== expectedStarter ||
      run.finalPosition.x !== expectedTarget.x ||
      run.finalPosition.y !== expectedTarget.y ||
      !sameButtonSequence(run.sequenceButtons, sequenceButtons)
  );

  if (failedRun) {
    return {
      expectedStarter,
      expectedTarget,
      reason: `starter selection verification failed for ${expectedTarget.label}: selected=${failedRun.selectedStarter ?? "none"} confirmed=${failedRun.confirmedStarter ?? "none"} final=mapId=${failedRun.finalPosition.mapId} x=${failedRun.finalPosition.x} y=${failedRun.finalPosition.y}`,
      repetitions,
      runtimeSource: "RuntimeGameState",
      runs,
      sequenceButtons,
      success: false,
    };
  }

  return {
    expectedStarter,
    expectedTarget,
    reason: `configured ${expectedTarget.label} starter sequence verified consistently across ${repetitions} RuntimeGameState runs`,
    repetitions,
    runtimeSource: "RuntimeGameState",
    runs,
    sequenceButtons,
    success: true,
  };
}

function verifyOakDialogueProgress({
  action,
  after,
  before,
}: {
  action: AutopilotAction;
  after: MgbaObservation;
  before: MgbaObservation;
}): DeterministicVerificationResult {
  const beforePhase = detectPokemonPhase({ observation: before }).phase;
  const afterPhase = detectPokemonPhase({ observation: after }).phase;
  if (!OAK_DIALOGUE_PHASES.has(beforePhase)) {
    return verificationResult({
      diagnostics: [
        createOakDialogueDiagnostic({
          action,
          after,
          afterPhase,
          before,
          beforePhase,
          message:
            "Oak dialogue verification was requested outside an Oak scripted dialogue phase.",
        }),
      ],
      reason: `Oak dialogue verification requested from non-Oak phase ${beforePhase}`,
      success: false,
    });
  }

  const beforeState = before.state;
  const afterState = after.state;
  if (!(beforeState && afterState)) {
    return verificationResult({
      diagnostics: [
        createOakDialogueDiagnostic({
          action,
          after,
          afterPhase,
          before,
          beforePhase,
          message:
            "RuntimeGameState was unavailable during Oak dialogue verification.",
        }),
      ],
      reason: "state unavailable for Oak dialogue verification",
      success: false,
    });
  }
  if (afterState.readStatus !== "available" || afterPhase === "unknown") {
    return verificationResult({
      diagnostics: [
        createOakDialogueDiagnostic({
          action,
          after,
          afterPhase,
          before,
          beforePhase,
          message:
            "Oak dialogue verification lost RAM or phase evidence after deterministic input.",
        }),
      ],
      reason: `Oak dialogue lost RAM/phase evidence after ${action.toolName}:${action.button}; phase=${afterPhase} readStatus=${afterState.readStatus}`,
      success: false,
    });
  }

  const ramProgressed =
    beforeState.dialogueLike !== afterState.dialogueLike ||
    beforeState.menuLike !== afterState.menuLike ||
    beforeState.battle !== afterState.battle ||
    beforeState.mapId !== afterState.mapId ||
    beforeState.position.x !== afterState.position.x ||
    beforeState.position.y !== afterState.position.y;
  const phaseProgressed = beforePhase !== afterPhase;
  const checkpointProgressed = isOakDialogueCheckpointTransition({
    afterPhase,
    afterState,
    beforePhase,
    beforeState,
  });

  if ((ramProgressed || phaseProgressed) && checkpointProgressed) {
    return verificationResult({
      reason: `Oak dialogue RAM/phase progressed (${beforePhase} -> ${afterPhase})`,
      success: true,
    });
  }

  if (OAK_DIALOGUE_PHASES.has(afterPhase) && afterState.dialogueLike === true) {
    return verificationResult({
      diagnostics: [
        createOakDialogueDiagnostic({
          action,
          after,
          afterPhase,
          before,
          beforePhase,
          message:
            "Oak dialogue remained in the same checkpoint with unchanged RuntimeGameState evidence.",
        }),
      ],
      reason: `stalled Oak dialogue state after ${action.toolName}:${action.button}; phase remained ${afterPhase} with unchanged RAM evidence`,
      success: false,
    });
  }

  return verificationResult({
    diagnostics: [
      createOakDialogueDiagnostic({
        action,
        after,
        afterPhase,
        before,
        beforePhase,
        message:
          "Oak dialogue post-action state did not match an expected checkpoint transition.",
      }),
    ],
    reason: `Oak dialogue did not produce expected RAM/phase progression (${beforePhase} -> ${afterPhase})`,
    success: false,
  });
}

function isOakDialogueCheckpointTransition({
  afterPhase,
  afterState,
  beforePhase,
  beforeState,
}: {
  afterPhase: PokemonPhase;
  afterState: NonNullable<MgbaObservation["state"]>;
  beforePhase: PokemonPhase;
  beforeState: NonNullable<MgbaObservation["state"]>;
}): boolean {
  const dialogueOrMenuChanged =
    beforeState.dialogueLike !== afterState.dialogueLike ||
    beforeState.menuLike !== afterState.menuLike;
  const battleChanged = beforeState.battle !== afterState.battle;
  const positionChanged =
    beforeState.position.x !== afterState.position.x ||
    beforeState.position.y !== afterState.position.y;

  if (beforePhase === "oak_forced_walk_or_dialogue") {
    return isOakForcedWalkCheckpointTransition({
      afterPhase,
      afterState,
      battleChanged,
      beforeState,
      dialogueOrMenuChanged,
      positionChanged,
    });
  }

  if (beforePhase === "lab_before_starter") {
    const allowedAfterPhase =
      afterPhase === "lab_before_starter" ||
      afterPhase === "starter_selection" ||
      afterPhase === "rival_battle";
    return (
      ((dialogueOrMenuChanged || battleChanged) && allowedAfterPhase) ||
      afterPhase === "starter_selection" ||
      afterPhase === "rival_battle"
    );
  }

  if (beforePhase === "starter_selection") {
    const allowedAfterPhase =
      afterPhase === "starter_selection" ||
      afterPhase === "lab_before_starter" ||
      afterPhase === "rival_battle";
    return (
      ((dialogueOrMenuChanged || battleChanged) && allowedAfterPhase) ||
      afterPhase === "lab_before_starter" ||
      afterPhase === "rival_battle"
    );
  }

  return false;
}

function isOakForcedWalkCheckpointTransition({
  afterPhase,
  afterState,
  battleChanged,
  beforeState,
  dialogueOrMenuChanged,
  positionChanged,
}: {
  afterPhase: PokemonPhase;
  afterState: NonNullable<MgbaObservation["state"]>;
  battleChanged: boolean;
  beforeState: NonNullable<MgbaObservation["state"]>;
  dialogueOrMenuChanged: boolean;
  positionChanged: boolean;
}): boolean {
  const allowedAfterPhase =
    afterPhase === "oak_forced_walk_or_dialogue" ||
    afterPhase === "pallet_before_oak" ||
    afterPhase === "lab_before_starter" ||
    afterPhase === "starter_selection" ||
    afterPhase === "rival_battle";
  const sameMapMovement =
    beforeState.mapId === 0 &&
    afterState.mapId === 0 &&
    positionChanged &&
    (afterPhase === "oak_forced_walk_or_dialogue" ||
      afterPhase === "pallet_before_oak");
  const enteredLabScript =
    afterState.mapId === 40 &&
    (afterPhase === "lab_before_starter" ||
      afterPhase === "starter_selection" ||
      afterPhase === "rival_battle");

  return (
    ((dialogueOrMenuChanged || battleChanged) && allowedAfterPhase) ||
    sameMapMovement ||
    enteredLabScript
  );
}

function verificationResult({
  diagnostics = [],
  reason,
  success,
}: {
  diagnostics?: readonly DeterministicVerificationDiagnostic[];
  reason: string;
  success: boolean;
}): DeterministicVerificationResult {
  return {
    diagnostics: boundedDiagnostics(diagnostics),
    reason,
    success,
  };
}

function createVerificationDiagnostic({
  action,
  after,
  before,
  kind,
  message,
}: {
  action?: AutopilotAction;
  after: MgbaObservation;
  before: MgbaObservation;
  kind: DeterministicVerificationDiagnostic["kind"];
  message: string;
}): DeterministicVerificationDiagnostic {
  const beforePhase = detectPokemonPhase({ observation: before }).phase;
  const afterPhase = detectPokemonPhase({ observation: after }).phase;
  return {
    evidence: boundedEvidence([
      `expectedAction=${formatActionEvidence(action)}`,
      ...formatObservationEvidence("before", before, beforePhase),
      ...formatObservationEvidence("after", after, afterPhase),
    ]),
    kind,
    message,
    runtimeSource: "RuntimeGameState",
  };
}

function createOakDialogueDiagnostic({
  action,
  after,
  afterPhase,
  before,
  beforePhase,
  message,
}: {
  action: AutopilotAction;
  after: MgbaObservation;
  afterPhase: PokemonPhase;
  before: MgbaObservation;
  beforePhase: PokemonPhase;
  message: string;
}): DeterministicVerificationDiagnostic {
  const checkpoint = OAK_DIALOGUE_PHASES.has(beforePhase)
    ? OAK_DIALOGUE_PHASE_CHECKPOINTS[
        beforePhase as keyof typeof OAK_DIALOGUE_PHASE_CHECKPOINTS
      ]
    : undefined;
  return {
    evidence: boundedEvidence([
      `expectedAction=${formatActionEvidence(action)}`,
      ...formatObservationEvidence("before", before, beforePhase),
      ...formatObservationEvidence("after", after, afterPhase),
      ...(checkpoint
        ? [
            `checkpoint=${checkpoint.id}`,
            `expectedDialogue=${checkpoint.expectedDialogueMarkers.join(" | ")}`,
            `expectedGameplay=${checkpoint.expectedGameplayStateIdentifiers.join(" | ")}`,
            `expectedPostAdvance=${checkpoint.expectedPostAdvanceMarkers.join(" | ")}`,
          ]
        : ["checkpoint=none"]),
    ]),
    kind: "oak-dialogue-checkpoint-failed",
    message,
    runtimeSource: "RuntimeGameState",
  };
}

function formatObservationEvidence(
  label: "after" | "before",
  observation: MgbaObservation,
  phase: PokemonPhase
): readonly string[] {
  const state = observation.state;
  if (!state) {
    return [`${label}.runtime=state=missing;phase=${phase}`];
  }
  return [
    `${label}.runtime=phase=${phase};readStatus=${state.readStatus};mapId=${state.mapId ?? "null"};x=${state.position.x ?? "null"};y=${state.position.y ?? "null"};battle=${state.battle};dialogueLike=${state.dialogueLike};menuLike=${state.menuLike};frame=${observation.status.frame ?? "unknown"}`,
  ];
}

function formatActionEvidence(action?: AutopilotAction): string {
  if (!action) {
    return "none";
  }
  const buttons = action.buttons?.length
    ? action.buttons.join(",")
    : action.button;
  return `${action.toolName}:${buttons}`;
}

function boundedDiagnostics(
  diagnostics: readonly DeterministicVerificationDiagnostic[]
): readonly DeterministicVerificationDiagnostic[] {
  return diagnostics
    .slice(0, MAX_VERIFICATION_DIAGNOSTICS)
    .map((diagnostic) => ({
      ...diagnostic,
      evidence: boundedEvidence(diagnostic.evidence),
    }));
}

function boundedEvidence(evidence: readonly string[]): readonly string[] {
  return evidence
    .filter((item) => item.length > 0)
    .slice(0, MAX_VERIFICATION_EVIDENCE)
    .map((item) =>
      item.length > MAX_VERIFICATION_EVIDENCE_CHARS
        ? `${item.slice(0, MAX_VERIFICATION_EVIDENCE_CHARS - 3)}...`
        : item
    );
}

function runStarterSelectionSequence({
  expectedStarter,
  sequenceButtons,
}: {
  expectedStarter: PokemonRedStarterPreference;
  sequenceButtons: readonly MgbaButton[];
}): PokemonRedStarterSelectionVerificationRun {
  const currentPosition = {
    mapId: OAK_LAB_STARTER_APPROACH_POSITION.mapId,
    x: OAK_LAB_STARTER_APPROACH_POSITION.x,
    y: OAK_LAB_STARTER_APPROACH_POSITION.y,
  };
  const selectedStarter: { value?: PokemonRedStarterPreference } = {};
  const confirmedStarter: { value?: PokemonRedStarterPreference } = {};

  for (const button of sequenceButtons) {
    switch (button) {
      case "Down":
        currentPosition.y += 1;
        break;
      case "Left":
        currentPosition.x -= 1;
        break;
      case "Right":
        currentPosition.x += 1;
        break;
      case "Up":
        currentPosition.y -= 1;
        break;
      case "A":
        if (selectedStarter.value) {
          confirmedStarter.value = selectedStarter.value;
        } else {
          selectedStarter.value = expectedStarter;
        }
        break;
      default:
        break;
    }
  }

  return {
    confirmedStarter: confirmedStarter.value,
    finalPosition: currentPosition,
    selectedStarter: selectedStarter.value,
    sequenceButtons,
  };
}

function sameButtonSequence(
  left: readonly MgbaButton[],
  right: readonly MgbaButton[]
): boolean {
  return (
    left.length === right.length &&
    left.every((button, index) => button === right[index])
  );
}
