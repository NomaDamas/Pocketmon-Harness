import type { MgbaButton } from "./mgba-http";
import type { PokemonStateObservation } from "./pokemon-state";

export const POKEMON_RED_STARTER_PREFERENCES = [
  "bulbasaur",
  "charmander",
  "squirtle",
] as const;

export const POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY =
  "HARNESS_STARTER_PREFERENCE" as const;

export type PokemonRedStarterPreference =
  (typeof POKEMON_RED_STARTER_PREFERENCES)[number];

declare const validatedPokemonRedStarterPreference: unique symbol;

export type ValidatedPokemonRedStarterPreference =
  PokemonRedStarterPreference & {
    readonly [validatedPokemonRedStarterPreference]: true;
  };

export const DEFAULT_POKEMON_RED_STARTER_PREFERENCE =
  "charmander" as ValidatedPokemonRedStarterPreference;

export const POKEMON_RED_STARTER_PREFERENCE_CONFIG = {
  defaultValue: DEFAULT_POKEMON_RED_STARTER_PREFERENCE,
  key: POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY,
  supportedValues: POKEMON_RED_STARTER_PREFERENCES,
} as const;

export const OAK_LAB_STARTER_APPROACH_POSITION = {
  mapId: 40,
  x: 5,
  y: 3,
} as const;

export const OAK_LAB_STARTER_WAYPOINTS: Record<
  PokemonRedStarterPreference,
  { label: string; x: number; y: number }
> = {
  bulbasaur: {
    label: "left Bulbasaur starter",
    x: 2,
    y: 2,
  },
  charmander: {
    label: "center Charmander starter",
    x: 4,
    y: 2,
  },
  squirtle: {
    label: "right Squirtle starter",
    x: 6,
    y: 2,
  },
};

export const POKEMON_RED_STARTER_CONTROLLER_SEQUENCES: Record<
  PokemonRedStarterPreference,
  readonly MgbaButton[]
> = {
  bulbasaur: ["Left", "Left", "Left", "Up", "A", "A"],
  charmander: ["Left", "Up", "A", "A"],
  squirtle: ["Right", "Up", "A", "A"],
} as const;

export interface OakLabStarterPosition {
  readonly x: number;
  readonly y: number;
}

export interface PokemonRedStarterSelectionStep {
  readonly button: MgbaButton;
  readonly duration?: number;
  readonly reason: string;
  readonly toolName: "mgba_hold" | "mgba_tap";
}

export interface PokemonRedStarterTargetSelectionMetadata {
  readonly approachFrom: {
    readonly mapId: typeof OAK_LAB_STARTER_APPROACH_POSITION.mapId;
    readonly x: number;
    readonly y: number;
  };
  readonly configKey: typeof POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY;
  readonly controllerMode: "deterministic";
  readonly phase: "starter_selection";
  readonly preference: ValidatedPokemonRedStarterPreference;
  readonly preferenceSource: "configured" | "default";
  readonly runtimeSource: "RuntimeGameState";
  readonly sequenceButtons: readonly MgbaButton[];
  readonly target: {
    readonly id: `oak-lab-starter-${PokemonRedStarterPreference}`;
    readonly label: string;
    readonly mapId: typeof OAK_LAB_STARTER_APPROACH_POSITION.mapId;
    readonly x: number;
    readonly y: number;
  };
  readonly waypoint: "select-starter";
}

export interface PokemonRedCanonicalStarterTarget {
  readonly id: `oak-lab-starter-${PokemonRedStarterPreference}`;
  readonly label: string;
  readonly mapId: typeof OAK_LAB_STARTER_APPROACH_POSITION.mapId;
  readonly preference: ValidatedPokemonRedStarterPreference;
  readonly x: number;
  readonly y: number;
}

export interface PokemonRedStarterSelectionPlan {
  readonly approachFrom: OakLabStarterPosition;
  readonly preference: ValidatedPokemonRedStarterPreference;
  readonly sequence: readonly PokemonRedStarterSelectionStep[];
  readonly sequenceButtons: readonly MgbaButton[];
  readonly targetSelection: PokemonRedStarterTargetSelectionMetadata;
  readonly waypoint: {
    readonly label: string;
    readonly x: number;
    readonly y: number;
  };
}

export interface PokemonRedStarterSelectionState {
  readonly active: boolean;
  readonly phase: "lab_before_starter" | "starter_selection";
  readonly reason: string;
  readonly target: PokemonRedStarterSelectionPlan["waypoint"];
  readonly waypoint: "advance-oak-lab-script" | "select-starter";
}

export interface PokemonRedStarterControllerSequenceState {
  readonly currentPosition: {
    readonly mapId: typeof OAK_LAB_STARTER_APPROACH_POSITION.mapId;
    readonly x: number;
    readonly y: number;
  };
  readonly currentStep?: PokemonRedStarterSelectionStep;
  readonly kind: "pokemon-red-starter-selected-input-sequence";
  readonly phase: "lab_before_starter" | "starter_selection";
  readonly preference: ValidatedPokemonRedStarterPreference;
  readonly reason: string;
  readonly runtimeSource: "RuntimeGameState";
  readonly selectedInputSequence: readonly MgbaButton[];
  readonly sequenceComplete: boolean;
  readonly sequenceCursor: number;
  readonly target: PokemonRedStarterTargetSelectionMetadata["target"];
  readonly waypoint: "advance-oak-lab-script" | "select-starter";
}

export function resolvePokemonRedStarterPreference(
  value?: string | null
): ValidatedPokemonRedStarterPreference {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_POKEMON_RED_STARTER_PREFERENCE;
  }
  if (isPokemonRedStarterPreference(normalized)) {
    return normalized as ValidatedPokemonRedStarterPreference;
  }
  throw new Error(
    `Unsupported Pokemon Red starter preference "${value}". Expected one of: ${POKEMON_RED_STARTER_PREFERENCES.join(", ")}.`
  );
}

export function isPokemonRedStarterPreference(
  value: string
): value is PokemonRedStarterPreference {
  return POKEMON_RED_STARTER_PREFERENCES.includes(
    value as PokemonRedStarterPreference
  );
}

export function resolvePokemonRedStarterSelectionPlan(
  value?: string | null,
  approachFrom: OakLabStarterPosition = OAK_LAB_STARTER_APPROACH_POSITION
): PokemonRedStarterSelectionPlan {
  const preference = resolvePokemonRedStarterPreference(value);
  const waypoint =
    OAK_LAB_STARTER_WAYPOINTS[preference as PokemonRedStarterPreference];
  const sequence = buildStarterSelectionSequence({
    approachFrom,
    waypoint,
  });
  const sequenceButtons = sequence.map((step) => step.button);

  return {
    approachFrom,
    preference,
    sequence,
    sequenceButtons,
    targetSelection: buildStarterTargetSelectionMetadata({
      approachFrom,
      preference,
      preferenceSource: hasConfiguredStarterPreference(value)
        ? "configured"
        : "default",
      sequenceButtons,
      waypoint,
    }),
    waypoint,
  };
}

export function resolvePokemonRedStarterTargetSelectionMetadata(
  value?: string | null,
  approachFrom: OakLabStarterPosition = OAK_LAB_STARTER_APPROACH_POSITION
): PokemonRedStarterTargetSelectionMetadata {
  return resolvePokemonRedStarterSelectionPlan(value, approachFrom)
    .targetSelection;
}

export function resolvePokemonRedCanonicalStarterTarget(
  value?: string | null
): PokemonRedCanonicalStarterTarget {
  const targetSelection =
    resolvePokemonRedStarterTargetSelectionMetadata(value);
  return {
    ...targetSelection.target,
    preference: targetSelection.preference,
  };
}

export function resolvePokemonRedStarterFixedControllerSequence(
  value?: string | null
): readonly MgbaButton[] {
  const preference = resolvePokemonRedStarterPreference(value);
  return POKEMON_RED_STARTER_CONTROLLER_SEQUENCES[
    preference as PokemonRedStarterPreference
  ];
}

export function resolvePokemonRedStarterSelectionState({
  state,
  starterPreference,
}: {
  state: PokemonStateObservation;
  starterPreference?: string | null;
}): PokemonRedStarterSelectionState {
  const plan = resolvePokemonRedStarterSelectionPlan(starterPreference);
  if (
    state.readStatus === "available" &&
    state.mapId === OAK_LAB_STARTER_APPROACH_POSITION.mapId &&
    state.battle !== true &&
    state.position.x === plan.waypoint.x &&
    state.position.y === plan.waypoint.y
  ) {
    return {
      active: true,
      phase: "starter_selection",
      reason: `RAM mapId=${state.mapId} x=${state.position.x} y=${state.position.y} matches configured ${plan.waypoint.label} controller waypoint`,
      target: plan.waypoint,
      waypoint: "select-starter",
    };
  }

  return {
    active: false,
    phase: "lab_before_starter",
    reason:
      "Oak Lab RAM position has not reached the configured starter controller waypoint",
    target: plan.waypoint,
    waypoint: "advance-oak-lab-script",
  };
}

export function resolvePokemonRedStarterControllerSequenceState({
  state,
  starterPreference,
}: {
  state: PokemonStateObservation;
  starterPreference?: string | null;
}): PokemonRedStarterControllerSequenceState | undefined {
  const plan = resolvePokemonRedStarterSelectionPlan(starterPreference);
  if (
    state.readStatus !== "available" ||
    state.mapId !== OAK_LAB_STARTER_APPROACH_POSITION.mapId ||
    state.battle === true ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return;
  }

  const sequenceCursor = starterSequenceCursorFromRuntimeGameState({
    plan,
    state,
  });
  if (sequenceCursor === undefined) {
    return;
  }

  const currentStep = plan.sequence[sequenceCursor];
  const sequenceComplete = sequenceCursor >= plan.sequence.length;
  const phase =
    state.position.x === plan.waypoint.x && state.position.y === plan.waypoint.y
      ? "starter_selection"
      : "lab_before_starter";

  return {
    currentPosition: {
      mapId: OAK_LAB_STARTER_APPROACH_POSITION.mapId,
      x: state.position.x,
      y: state.position.y,
    },
    currentStep,
    kind: "pokemon-red-starter-selected-input-sequence",
    phase,
    preference: plan.preference,
    reason: sequenceComplete
      ? `RuntimeGameState reached the configured ${plan.waypoint.label} starter sequence completion point.`
      : `RuntimeGameState RAM mapId=${state.mapId} x=${state.position.x} y=${state.position.y} selects sequence cursor ${sequenceCursor} for ${plan.waypoint.label}.`,
    runtimeSource: "RuntimeGameState",
    selectedInputSequence: plan.sequenceButtons,
    sequenceComplete,
    sequenceCursor,
    target: plan.targetSelection.target,
    waypoint:
      phase === "starter_selection"
        ? "select-starter"
        : "advance-oak-lab-script",
  };
}

export function isOakLabStarterSelectionPosition(
  state: PokemonStateObservation
): boolean {
  if (
    state.readStatus !== "available" ||
    state.mapId !== OAK_LAB_STARTER_APPROACH_POSITION.mapId ||
    state.battle === true ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return false;
  }

  return Object.values(OAK_LAB_STARTER_WAYPOINTS).some(
    (waypoint) =>
      waypoint.x === state.position.x && waypoint.y === state.position.y
  );
}

function starterSequenceCursorFromRuntimeGameState({
  plan,
  state,
}: {
  plan: PokemonRedStarterSelectionPlan;
  state: PokemonStateObservation;
}): number | undefined {
  const position = state.position;
  if (position.x === null || position.y === null) {
    return;
  }

  let cursorX = plan.approachFrom.x;
  let cursorY = plan.approachFrom.y;
  for (let index = 0; index < plan.sequence.length; index += 1) {
    const step = plan.sequence[index];
    if (!step) {
      return;
    }
    if (cursorX === position.x && cursorY === position.y) {
      if (step.toolName !== "mgba_tap") {
        return index;
      }
      return state.dialogueLike === true
        ? Math.min(index + 1, plan.sequence.length - 1)
        : index;
    }
    if (step.toolName !== "mgba_hold") {
      continue;
    }
    switch (step.button) {
      case "Down":
        cursorY += 1;
        break;
      case "Left":
        cursorX -= 1;
        break;
      case "Right":
        cursorX += 1;
        break;
      case "Up":
        cursorY -= 1;
        break;
      default:
        return;
    }
  }

  return;
}

function buildStarterSelectionSequence({
  approachFrom,
  waypoint,
}: {
  approachFrom: OakLabStarterPosition;
  waypoint: { label: string; x: number; y: number };
}): PokemonRedStarterSelectionStep[] {
  const sequence: PokemonRedStarterSelectionStep[] = [];
  const horizontalButton = approachFrom.x < waypoint.x ? "Right" : "Left";
  for (let x = approachFrom.x; x !== waypoint.x; ) {
    sequence.push({
      button: horizontalButton,
      duration: 10,
      reason: `OakLabStarterSelectionPlan: align toward the ${waypoint.label} waypoint.`,
      toolName: "mgba_hold",
    });
    x += horizontalButton === "Right" ? 1 : -1;
  }

  const verticalButton = approachFrom.y < waypoint.y ? "Down" : "Up";
  for (let y = approachFrom.y; y !== waypoint.y; ) {
    sequence.push({
      button: verticalButton,
      duration: 10,
      reason: `OakLabStarterSelectionPlan: move to the ${waypoint.label} interaction waypoint.`,
      toolName: "mgba_hold",
    });
    y += verticalButton === "Down" ? 1 : -1;
  }

  sequence.push({
    button: "A",
    reason: `OakLabStarterSelectionPlan: choose the ${waypoint.label} Pokeball.`,
    toolName: "mgba_tap",
  });
  sequence.push({
    button: "A",
    reason: `OakLabStarterSelectionPlan: confirm the ${waypoint.label} prompt.`,
    toolName: "mgba_tap",
  });

  return sequence;
}

function buildStarterTargetSelectionMetadata({
  approachFrom,
  preference,
  preferenceSource,
  sequenceButtons,
  waypoint,
}: {
  approachFrom: OakLabStarterPosition;
  preference: ValidatedPokemonRedStarterPreference;
  preferenceSource: PokemonRedStarterTargetSelectionMetadata["preferenceSource"];
  sequenceButtons: readonly MgbaButton[];
  waypoint: { label: string; x: number; y: number };
}): PokemonRedStarterTargetSelectionMetadata {
  const targetPreference = preference as PokemonRedStarterPreference;
  return {
    approachFrom: {
      mapId: OAK_LAB_STARTER_APPROACH_POSITION.mapId,
      x: approachFrom.x,
      y: approachFrom.y,
    },
    configKey: POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY,
    controllerMode: "deterministic",
    phase: "starter_selection",
    preference,
    preferenceSource,
    runtimeSource: "RuntimeGameState",
    sequenceButtons,
    target: {
      id: `oak-lab-starter-${targetPreference}`,
      label: waypoint.label,
      mapId: OAK_LAB_STARTER_APPROACH_POSITION.mapId,
      x: waypoint.x,
      y: waypoint.y,
    },
    waypoint: "select-starter",
  };
}

function hasConfiguredStarterPreference(value?: string | null): boolean {
  return (value?.trim() ?? "") !== "";
}
