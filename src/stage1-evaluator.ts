import { z } from "zod";
import type { PokemonStateObservation } from "./pokemon-state";

export const STAGE1_EVALUATOR_SCHEMA_VERSION = 1;
export const STAGE1_VICTORY_CONDITION = "reach-viridian-city";

export const STAGE1_PROGRESS_STATUSES = [
  "unknown",
  "no-progress",
  "progress",
  "stuck",
  "regressed",
  "victory",
] as const;

export const STAGE1_DIAGNOSTIC_CATEGORIES = [
  "progress",
  "loop",
  "stuck",
  "tool-error",
  "repeated-action",
  "observation",
  "safety",
  "candidate",
] as const;

export const STAGE1_DIAGNOSTIC_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

const scoreSchema = z.number().min(0).max(1);

export const stage1EvaluatorDiagnosticSchema = z
  .object({
    category: z.enum(STAGE1_DIAGNOSTIC_CATEGORIES),
    evidence: z.array(z.string().min(1)).optional(),
    message: z.string().min(1),
    severity: z.enum(STAGE1_DIAGNOSTIC_SEVERITIES),
  })
  .strict();

export const stage1TokenUsageDiagnosticSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .strict();

export const stage1EvaluatorMetadataSchema = z
  .object({
    candidateId: z.string().min(1).optional(),
    evaluatorId: z.string().min(1).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
    fps: z.number().positive().optional(),
    frameEnd: z.number().int().nonnegative().optional(),
    frameStart: z.number().int().nonnegative().optional(),
    iteration: z.number().int().nonnegative().optional(),
    methodologyNodeId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    tokenUsage: stage1TokenUsageDiagnosticSchema.optional(),
    turn: z.number().int().nonnegative().optional(),
  })
  .strict();

export const stage1EvaluatorOutputSchema = z
  .object({
    confidence: scoreSchema,
    diagnostics: z.array(stage1EvaluatorDiagnosticSchema),
    metadata: stage1EvaluatorMetadataSchema.optional(),
    progressScore: scoreSchema,
    progressStatus: z.enum(STAGE1_PROGRESS_STATUSES),
    schemaVersion: z.literal(STAGE1_EVALUATOR_SCHEMA_VERSION),
    victoryCondition: z.literal(STAGE1_VICTORY_CONDITION),
  })
  .strict();

export type Stage1ProgressStatus = (typeof STAGE1_PROGRESS_STATUSES)[number];
export type Stage1DiagnosticCategory =
  (typeof STAGE1_DIAGNOSTIC_CATEGORIES)[number];
export type Stage1DiagnosticSeverity =
  (typeof STAGE1_DIAGNOSTIC_SEVERITIES)[number];
export type Stage1EvaluatorDiagnostic = z.infer<
  typeof stage1EvaluatorDiagnosticSchema
>;
export type Stage1TokenUsageDiagnostic = z.infer<
  typeof stage1TokenUsageDiagnosticSchema
>;
export type Stage1EvaluatorMetadata = z.infer<
  typeof stage1EvaluatorMetadataSchema
>;
export type Stage1EvaluatorOutput = z.infer<typeof stage1EvaluatorOutputSchema>;

export interface Stage1EvaluatorCombinationInput {
  evaluatorId?: string;
  output: unknown;
  weight?: number;
}

export interface Stage1EvaluatorCombinationOptions {
  evaluatorId?: string;
  metadata?: Stage1EvaluatorMetadata;
}

export interface Stage1NormalizedEvaluatorComponent {
  evaluatorId: string;
  output: Stage1EvaluatorOutput;
  weight: number;
}

export const POKEMON_RED_STAGE1_MAP_IDS = {
  palletTown: 0,
  route1: 12,
  viridianCity: 1,
} as const;

export interface Stage1MapTransitionEvaluatorInput {
  currentState?: PokemonStateObservation;
  evaluatorId?: string;
  metadata?: Stage1EvaluatorMetadata;
  previousState?: PokemonStateObservation;
}

export interface Stage1ViridianCitySuccessEvaluatorInput {
  currentState?: PokemonStateObservation;
  evaluatorId?: string;
  metadata?: Stage1EvaluatorMetadata;
}

export interface Stage1LoopHistoryEntry {
  action?: string;
  frame?: number;
  state?: PokemonStateObservation;
  turn?: number;
}

export interface Stage1LoopScoreEvaluatorInput {
  evaluatorId?: string;
  history: readonly Stage1LoopHistoryEntry[];
  maxCycleLength?: number;
  metadata?: Stage1EvaluatorMetadata;
}

export interface Stage1StuckHistoryEntry {
  frame?: number;
  state?: PokemonStateObservation;
  turn?: number;
}

export interface Stage1StuckScoreEvaluatorInput {
  evaluatorId?: string;
  history: readonly Stage1StuckHistoryEntry[];
  metadata?: Stage1EvaluatorMetadata;
  minimumMeaningfulProgressDelta?: number;
  stuckScoreThreshold?: number;
  windowSize?: number;
}

export interface Stage1RepeatedActionHistoryEntry {
  action?: string;
  frame?: number;
  input?: unknown;
  state?: PokemonStateObservation;
  toolName?: string;
  turn?: number;
}

export interface Stage1RepeatedActionScoreEvaluatorInput {
  evaluatorId?: string;
  history: readonly Stage1RepeatedActionHistoryEntry[];
  metadata?: Stage1EvaluatorMetadata;
  repetitionThreshold?: number;
  windowSize?: number;
}

interface Stage1KnownMapProgress {
  baseScore: number;
  exitY?: number;
  mapId: number;
  name: string;
  nextMapId?: number;
  segmentEndScore: number;
  segmentStartScore: number;
  startY?: number;
}

interface Stage1KnownMapTransition {
  fromMapId: number;
  fromName: string;
  id: string;
  score: number;
  toMapId: number;
  toName: string;
}

interface Stage1MapPosition {
  mapId: number;
  x: number;
  y: number;
}

interface Stage1LoopSignature {
  actionKey: string;
  label: string;
  stateKey: string;
}

interface Stage1LoopPattern {
  cycleLength: number;
  loopScore: number;
  pattern: readonly Stage1LoopSignature[];
  repeats: number;
}

interface Stage1StuckWindowEntry {
  frame?: number;
  position: Stage1MapPosition;
  progressScore: number;
  turn?: number;
}

interface Stage1RepeatedActionSignature {
  actionKey: string;
  frame?: number;
  label: string;
  position?: Stage1MapPosition;
  progressScore?: number;
  turn?: number;
}

const DEFAULT_AGGREGATE_EVALUATOR_ID = "stage1.aggregate";
const DEFAULT_LOOP_SCORE_EVALUATOR_ID = "stage1.loop-score";
const DEFAULT_MAP_TRANSITION_EVALUATOR_ID = "stage1.map-transition-progress";
const DEFAULT_REPEATED_ACTION_SCORE_EVALUATOR_ID =
  "stage1.repeated-action-score";
const DEFAULT_STUCK_SCORE_EVALUATOR_ID = "stage1.stuck-score";
const DEFAULT_VIRIDIAN_CITY_SUCCESS_EVALUATOR_ID =
  "stage1.viridian-city-success";
const DEFAULT_COMPONENT_WEIGHT = 1;
const DEFAULT_LOOP_MAX_CYCLE_LENGTH = 4;
const DEFAULT_REPEATED_ACTION_THRESHOLD = 3;
const DEFAULT_REPEATED_ACTION_WINDOW_SIZE = 10;
const DEFAULT_STUCK_MINIMUM_MEANINGFUL_PROGRESS_DELTA = 0.05;
const DEFAULT_STUCK_SCORE_THRESHOLD = 0.8;
const DEFAULT_STUCK_WINDOW_SIZE = 6;
const LOOP_STUCK_SCORE = 0.67;
const LOOP_WARNING_SCORE = 0.4;
const TOKEN_USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
] as const satisfies readonly (keyof Stage1TokenUsageDiagnostic)[];
const ACTION_PAYLOAD_QUOTE_PATTERN = /^["']|["']$/g;
const LOOSE_ACTION_WHITESPACE_PATTERN = /\s+/g;
const MGBA_TOOL_PREFIX_PATTERN = /^mgba_/;

const POKEMON_RED_STAGE1_MAP_PROGRESS: readonly Stage1KnownMapProgress[] = [
  {
    baseScore: 0.15,
    exitY: 0,
    mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
    name: "Pallet Town",
    nextMapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
    segmentEndScore: 0.45,
    segmentStartScore: 0.15,
    startY: 12,
  },
  {
    baseScore: 0.55,
    exitY: 0,
    mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
    name: "Route 1",
    nextMapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
    segmentEndScore: 0.9,
    segmentStartScore: 0.55,
    startY: 35,
  },
  {
    baseScore: 1,
    mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
    name: "Viridian City",
    segmentEndScore: 1,
    segmentStartScore: 1,
  },
] as const;

const POKEMON_RED_STAGE1_KNOWN_TRANSITIONS: readonly Stage1KnownMapTransition[] =
  [
    {
      fromMapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      fromName: "Pallet Town",
      id: "route:pallet-to-route-1",
      score: 0.55,
      toMapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
      toName: "Route 1",
    },
    {
      fromMapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
      fromName: "Route 1",
      id: "route:route-1-to-viridian",
      score: 1,
      toMapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      toName: "Viridian City",
    },
  ] as const;

const KNOWN_MAPS_BY_ID = new Map(
  POKEMON_RED_STAGE1_MAP_PROGRESS.map((map) => [map.mapId, map])
);

export function combineStage1EvaluatorOutputs(
  inputs: readonly Stage1EvaluatorCombinationInput[],
  options: Stage1EvaluatorCombinationOptions = {}
): Stage1EvaluatorOutput {
  const components = inputs
    .map(normalizeStage1EvaluatorComponent)
    .slice()
    .sort(compareStage1EvaluatorComponents);

  if (components.length === 0) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0,
      diagnostics: [
        {
          category: "observation",
          message: "No Stage 1 evaluator outputs were available to aggregate.",
          severity: "warning",
        },
      ],
      metadata: createAggregateMetadata(components, options),
      progressScore: 0,
      progressStatus: "unknown",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const hasVictory = components.some(
    (component) => component.output.progressStatus === "victory"
  );
  const progressScore = hasVictory
    ? 1
    : weightedAverage(
        components.map((component) => ({
          value: component.output.progressScore,
          weight: component.weight,
        }))
      );

  const confidence = weightedAverage(
    components.map((component) => ({
      value: component.output.confidence,
      weight: component.weight,
    }))
  );

  return stage1EvaluatorOutputSchema.parse({
    confidence,
    diagnostics: [
      ...components.flatMap((component) => component.output.diagnostics),
      {
        category: "progress",
        evidence: components.map(
          (component) =>
            `${component.evaluatorId}: score=${component.output.progressScore} status=${component.output.progressStatus} weight=${component.weight}`
        ),
        message: "Aggregated normalized Stage 1 evaluator outputs.",
        severity: "info",
      },
    ],
    metadata: createAggregateMetadata(components, options),
    progressScore,
    progressStatus: chooseAggregateProgressStatus(components),
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
  });
}

export function evaluateStage1MapTransitionProgress({
  currentState,
  evaluatorId = DEFAULT_MAP_TRANSITION_EVALUATOR_ID,
  metadata,
  previousState,
}: Stage1MapTransitionEvaluatorInput): Stage1EvaluatorOutput {
  const current = readUsableMapPosition(currentState);
  const previous = readUsableMapPosition(previousState);

  if (!current) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.2,
      diagnostics: [
        {
          category: "observation",
          message:
            "Cannot evaluate Pokemon Red map transition progress without available RAM map and position.",
          severity: "warning",
        },
      ],
      metadata: createEvaluatorMetadata(metadata, evaluatorId),
      progressScore: 0,
      progressStatus: "unknown",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const currentMap = KNOWN_MAPS_BY_ID.get(current.mapId);
  if (!currentMap) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.35,
      diagnostics: [
        {
          category: "observation",
          evidence: [formatMapPosition(current)],
          message:
            "Current map is outside the known Pokemon Red Stage 1 Pallet Town to Viridian City route.",
          severity: "warning",
        },
      ],
      metadata: createEvaluatorMetadata(metadata, evaluatorId),
      progressScore: 0,
      progressStatus: "unknown",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const mapChangeOutput = evaluateKnownMapChange({
    current,
    currentMap,
    evaluatorId,
    metadata,
    previous,
  });
  if (mapChangeOutput) {
    return mapChangeOutput;
  }

  if (current.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.9,
      diagnostics: [
        {
          category: "progress",
          evidence: [formatMapPosition(current)],
          message: "Current map is Viridian City; Stage 1 victory reached.",
          severity: "info",
        },
      ],
      metadata: createEvaluatorMetadata(metadata, evaluatorId),
      progressScore: 1,
      progressStatus: "victory",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const currentScore = scoreKnownMapPosition(currentMap, current.y);
  const northboundProgress =
    previous?.mapId === current.mapId && current.y < previous.y;

  return stage1EvaluatorOutputSchema.parse({
    confidence: previous ? 0.75 : 0.6,
    diagnostics: [
      {
        category: "progress",
        evidence: [
          ...(previous ? [`previous=${formatMapPosition(previous)}`] : []),
          `current=${formatMapPosition(current)}`,
          `nextMapId=${currentMap.nextMapId ?? "none"}`,
        ],
        message: northboundProgress
          ? `Northbound movement on ${currentMap.name} reduced distance to the next known map boundary.`
          : `Current position remains on ${currentMap.name}; no known map boundary crossed this observation.`,
        severity: "info",
      },
    ],
    metadata: createEvaluatorMetadata(metadata, evaluatorId),
    progressScore: currentScore,
    progressStatus: northboundProgress ? "progress" : "no-progress",
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
  });
}

export function evaluateStage1ViridianCitySuccess({
  currentState,
  evaluatorId = DEFAULT_VIRIDIAN_CITY_SUCCESS_EVALUATOR_ID,
  metadata,
}: Stage1ViridianCitySuccessEvaluatorInput): Stage1EvaluatorOutput {
  const current = readUsableMapPosition(currentState);

  if (!current) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.2,
      diagnostics: [
        {
          category: "observation",
          message:
            "Cannot evaluate Viridian City success without available Pokemon Red RAM map and position.",
          severity: "warning",
        },
      ],
      metadata: createEvaluatorMetadata(metadata, evaluatorId),
      progressScore: 0,
      progressStatus: "unknown",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  if (current.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.95,
      diagnostics: [
        {
          category: "progress",
          evidence: [
            formatMapPosition(current),
            `victoryMapId=${POKEMON_RED_STAGE1_MAP_IDS.viridianCity}`,
          ],
          message:
            "Pokemon Red RAM reports the player is in Viridian City; Stage 1 victory condition reached.",
          severity: "info",
        },
      ],
      metadata: createEvaluatorMetadata(metadata, evaluatorId),
      progressScore: 1,
      progressStatus: "victory",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  return stage1EvaluatorOutputSchema.parse({
    confidence: 0.8,
    diagnostics: [
      {
        category: "progress",
        evidence: [
          formatMapPosition(current),
          `victoryMapId=${POKEMON_RED_STAGE1_MAP_IDS.viridianCity}`,
        ],
        message:
          "Viridian City success condition is not yet met by current Pokemon Red RAM state.",
        severity: "info",
      },
    ],
    metadata: createEvaluatorMetadata(metadata, evaluatorId),
    progressScore: 0,
    progressStatus: "no-progress",
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
  });
}

export function evaluateStage1LoopScore({
  evaluatorId = DEFAULT_LOOP_SCORE_EVALUATOR_ID,
  history,
  maxCycleLength = DEFAULT_LOOP_MAX_CYCLE_LENGTH,
  metadata,
}: Stage1LoopScoreEvaluatorInput): Stage1EvaluatorOutput {
  const signatures = history
    .map(createLoopSignature)
    .filter((signature): signature is Stage1LoopSignature =>
      Boolean(signature)
    );

  if (signatures.length < 2) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.2,
      diagnostics: [
        {
          category: "observation",
          message:
            "Cannot evaluate cyclical behavior without at least two usable recent state/action observations.",
          severity: "warning",
        },
      ],
      metadata: createLoopEvaluatorMetadata(metadata, evaluatorId, {
        loopScore: 0,
        usableHistoryLength: signatures.length,
      }),
      progressScore: 0,
      progressStatus: "unknown",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const loopPattern = findStrongestLoopPattern(signatures, maxCycleLength);
  if (!loopPattern) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: loopConfidence(signatures.length),
      diagnostics: [
        {
          category: "loop",
          evidence: [
            `usableHistoryLength=${signatures.length}`,
            `maxCycleLength=${normalizeMaxCycleLength(maxCycleLength)}`,
          ],
          message:
            "No repeated recent state/action cycle detected in Pokemon Red Stage 1 history.",
          severity: "info",
        },
      ],
      metadata: createLoopEvaluatorMetadata(metadata, evaluatorId, {
        loopScore: 0,
        usableHistoryLength: signatures.length,
      }),
      progressScore: 0.5,
      progressStatus: "no-progress",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const progressScore = clamp01(0.5 - loopPattern.loopScore * 0.5);
  const isStuck = loopPattern.loopScore >= LOOP_STUCK_SCORE;
  return stage1EvaluatorOutputSchema.parse({
    confidence: loopConfidence(signatures.length),
    diagnostics: [
      {
        category: "loop",
        evidence: [
          `cycleLength=${loopPattern.cycleLength}`,
          `repeats=${loopPattern.repeats}`,
          `loopScore=${roundScore(loopPattern.loopScore)}`,
          ...loopPattern.pattern.map((signature) => signature.label),
        ],
        message: isStuck
          ? "Recent Pokemon Red state/action history is cycling; autonomous policy should change tactics before continuing."
          : "Recent Pokemon Red state/action history shows an emerging cycle.",
        severity: isStuck ? "warning" : "info",
      },
      ...(loopPattern.cycleLength === 1
        ? [
            {
              category: "repeated-action" as const,
              evidence: [`action=${loopPattern.pattern[0]?.actionKey}`],
              message:
                "The same supervised button action is being retried from the same state.",
              severity: "warning" as const,
            },
          ]
        : []),
    ],
    metadata: createLoopEvaluatorMetadata(metadata, evaluatorId, {
      cycleLength: loopPattern.cycleLength,
      loopScore: loopPattern.loopScore,
      repeats: loopPattern.repeats,
      usableHistoryLength: signatures.length,
    }),
    progressScore,
    progressStatus: isStuck ? "stuck" : "no-progress",
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
  });
}

export function evaluateStage1RepeatedActionScore({
  evaluatorId = DEFAULT_REPEATED_ACTION_SCORE_EVALUATOR_ID,
  history,
  metadata,
  repetitionThreshold = DEFAULT_REPEATED_ACTION_THRESHOLD,
  windowSize = DEFAULT_REPEATED_ACTION_WINDOW_SIZE,
}: Stage1RepeatedActionScoreEvaluatorInput): Stage1EvaluatorOutput {
  const normalizedThreshold =
    normalizeRepeatedActionThreshold(repetitionThreshold);
  const normalizedWindowSize = normalizeWindowSize(windowSize);
  const signatures = history
    .map(createRepeatedActionSignature)
    .filter((signature): signature is Stage1RepeatedActionSignature =>
      Boolean(signature)
    )
    .slice(-normalizedWindowSize);

  if (signatures.length < 2) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.2,
      diagnostics: [
        {
          category: "observation",
          evidence: [
            `usableActionCount=${signatures.length}`,
            `windowSize=${normalizedWindowSize}`,
          ],
          message:
            "Cannot evaluate repeated action score without at least two usable supervised action observations.",
          severity: "warning",
        },
      ],
      metadata: createRepeatedActionEvaluatorMetadata(metadata, evaluatorId, {
        repetitionScore: 0,
        repetitionThreshold: normalizedThreshold,
        usableActionCount: signatures.length,
        windowSize: normalizedWindowSize,
      }),
      progressScore: 0,
      progressStatus: "unknown",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const currentRun = getRepeatedActionSuffix(signatures);
  const maxRunLength = maxEquivalentActionRunLength(signatures);
  const repetitionScore =
    currentRun.length >= normalizedThreshold
      ? clamp01(currentRun.length / normalizedThreshold)
      : 0;

  if (currentRun.length < normalizedThreshold) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: repeatedActionConfidence(signatures.length),
      diagnostics: [
        {
          category: "repeated-action",
          evidence: [
            `currentRunLength=${currentRun.length}`,
            `maxRunLength=${maxRunLength}`,
            `repetitionThreshold=${normalizedThreshold}`,
          ],
          message:
            "No excessive repeated supervised button action detected in the recent Stage 1 window.",
          severity: "info",
        },
      ],
      metadata: createRepeatedActionEvaluatorMetadata(metadata, evaluatorId, {
        currentRunLength: currentRun.length,
        maxRunLength,
        repetitionScore,
        repetitionThreshold: normalizedThreshold,
        usableActionCount: signatures.length,
        windowSize: normalizedWindowSize,
      }),
      progressScore: 0.5,
      progressStatus: "no-progress",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const repeatedActionEvidence = summarizeRepeatedActionRun(currentRun);
  const madeRamProgress =
    repeatedActionEvidence.positionChanged &&
    repeatedActionEvidence.progressDelta > 0;
  const isStationaryRepeat = !repeatedActionEvidence.positionChanged;
  let progressScore = 0.5;
  if (madeRamProgress) {
    progressScore = repeatedActionEvidence.currentProgressScore ?? 0.5;
  } else if (isStationaryRepeat) {
    progressScore = clamp01(0.5 - repetitionScore * 0.5);
  }

  let progressStatus: Stage1ProgressStatus = "no-progress";
  if (madeRamProgress) {
    progressStatus = "progress";
  } else if (isStationaryRepeat) {
    progressStatus = "stuck";
  }

  return stage1EvaluatorOutputSchema.parse({
    confidence: repeatedActionConfidence(signatures.length),
    diagnostics: [
      {
        category: "repeated-action",
        evidence: [
          `action=${repeatedActionEvidence.actionKey}`,
          `currentRunLength=${currentRun.length}`,
          `maxRunLength=${maxRunLength}`,
          `repetitionThreshold=${normalizedThreshold}`,
          `positionChanged=${repeatedActionEvidence.positionChanged}`,
          ...(repeatedActionEvidence.firstPosition
            ? [
                `first=${formatMapPosition(
                  repeatedActionEvidence.firstPosition
                )}`,
              ]
            : []),
          ...(repeatedActionEvidence.currentPosition
            ? [
                `current=${formatMapPosition(
                  repeatedActionEvidence.currentPosition
                )}`,
              ]
            : []),
          `progressDelta=${roundScore(repeatedActionEvidence.progressDelta)}`,
          ...currentRun.map((signature) => signature.label),
        ],
        message: isStationaryRepeat
          ? "The same or equivalent supervised button action is being repeated without RAM position progress."
          : "The same or equivalent supervised button action repeated, but RAM position changed during the run.",
        severity: isStationaryRepeat ? "warning" : "info",
      },
    ],
    metadata: createRepeatedActionEvaluatorMetadata(metadata, evaluatorId, {
      actionKey: repeatedActionEvidence.actionKey,
      currentRunLength: currentRun.length,
      maxRunLength,
      positionChanged: repeatedActionEvidence.positionChanged,
      progressDelta: repeatedActionEvidence.progressDelta,
      repetitionScore,
      repetitionThreshold: normalizedThreshold,
      usableActionCount: signatures.length,
      windowSize: normalizedWindowSize,
    }),
    progressScore,
    progressStatus,
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
  });
}

export function evaluateStage1StuckScore({
  evaluatorId = DEFAULT_STUCK_SCORE_EVALUATOR_ID,
  history,
  minimumMeaningfulProgressDelta = DEFAULT_STUCK_MINIMUM_MEANINGFUL_PROGRESS_DELTA,
  metadata,
  stuckScoreThreshold = DEFAULT_STUCK_SCORE_THRESHOLD,
  windowSize = DEFAULT_STUCK_WINDOW_SIZE,
}: Stage1StuckScoreEvaluatorInput): Stage1EvaluatorOutput {
  const normalizedWindowSize = normalizeWindowSize(windowSize);
  const normalizedMinimumDelta = normalizeMinimumMeaningfulProgressDelta(
    minimumMeaningfulProgressDelta
  );
  const normalizedStuckThreshold =
    normalizeStuckScoreThreshold(stuckScoreThreshold);
  const window = history
    .map(createStuckWindowEntry)
    .filter((entry): entry is Stage1StuckWindowEntry => Boolean(entry))
    .slice(-normalizedWindowSize);

  if (window.length < normalizedWindowSize) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.2,
      diagnostics: [
        {
          category: "observation",
          evidence: [
            `usableWindowLength=${window.length}`,
            `windowSize=${normalizedWindowSize}`,
          ],
          message:
            "Cannot evaluate Stage 1 stuck score until the configured observation window has enough usable Pokemon Red RAM positions.",
          severity: "warning",
        },
      ],
      metadata: createStuckEvaluatorMetadata(metadata, evaluatorId, {
        minimumMeaningfulProgressDelta: normalizedMinimumDelta,
        stuckScore: 0,
        stuckScoreThreshold: normalizedStuckThreshold,
        usableWindowLength: window.length,
        windowSize: normalizedWindowSize,
      }),
      progressScore: 0,
      progressStatus: "unknown",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const current = window.at(-1);
  if (!current) {
    throw new Error("Stage 1 stuck window unexpectedly empty");
  }
  if (current.position.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity) {
    return stage1EvaluatorOutputSchema.parse({
      confidence: stuckConfidence(window.length),
      diagnostics: [
        {
          category: "progress",
          evidence: [
            `current=${formatMapPosition(current.position)}`,
            `progressScore=${roundScore(current.progressScore)}`,
          ],
          message:
            "Current stuck-score window ends in Viridian City; Stage 1 victory condition reached.",
          severity: "info",
        },
      ],
      metadata: createStuckEvaluatorMetadata(metadata, evaluatorId, {
        minimumMeaningfulProgressDelta: normalizedMinimumDelta,
        stuckScore: 0,
        stuckScoreThreshold: normalizedStuckThreshold,
        usableWindowLength: window.length,
        windowSize: normalizedWindowSize,
      }),
      progressScore: 1,
      progressStatus: "victory",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const first = window[0];
  const progressDelta = Math.max(
    0,
    current.progressScore - first.progressScore
  );
  const bestProgressDelta = Math.max(
    0,
    Math.max(...window.map((entry) => entry.progressScore)) -
      first.progressScore
  );
  const stuckScore = clamp01(1 - bestProgressDelta / normalizedMinimumDelta);
  const hasMeaningfulProgress =
    bestProgressDelta >= normalizedMinimumDelta && progressDelta > 0;
  const isStuck = stuckScore >= normalizedStuckThreshold;
  let status: Stage1ProgressStatus = "no-progress";
  if (hasMeaningfulProgress) {
    status = "progress";
  } else if (isStuck) {
    status = "stuck";
  }

  return stage1EvaluatorOutputSchema.parse({
    confidence: stuckConfidence(window.length),
    diagnostics: [
      {
        category: isStuck ? "stuck" : "progress",
        evidence: [
          `windowSize=${normalizedWindowSize}`,
          `first=${formatMapPosition(first.position)} score=${roundScore(first.progressScore)}`,
          `current=${formatMapPosition(current.position)} score=${roundScore(current.progressScore)}`,
          `bestProgressDelta=${roundScore(bestProgressDelta)}`,
          `minimumMeaningfulProgressDelta=${roundScore(normalizedMinimumDelta)}`,
          `stuckScore=${roundScore(stuckScore)}`,
        ],
        message: hasMeaningfulProgress
          ? "Configured Stage 1 observation window contains meaningful progress toward Viridian City."
          : "Configured Stage 1 observation window lacks meaningful progress toward Viridian City.",
        severity: isStuck ? "warning" : "info",
      },
    ],
    metadata: createStuckEvaluatorMetadata(metadata, evaluatorId, {
      bestProgressDelta,
      currentProgressScore: current.progressScore,
      minimumMeaningfulProgressDelta: normalizedMinimumDelta,
      progressDelta,
      stuckScore,
      stuckScoreThreshold: normalizedStuckThreshold,
      usableWindowLength: window.length,
      windowSize: normalizedWindowSize,
    }),
    progressScore: hasMeaningfulProgress
      ? current.progressScore
      : clamp01(current.progressScore * (1 - stuckScore)),
    progressStatus: status,
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
  });
}

function compareStage1EvaluatorComponents(
  first: Stage1NormalizedEvaluatorComponent,
  second: Stage1NormalizedEvaluatorComponent
): number {
  return (
    first.evaluatorId.localeCompare(second.evaluatorId) ||
    first.output.progressStatus.localeCompare(second.output.progressStatus) ||
    first.output.progressScore - second.output.progressScore ||
    first.output.confidence - second.output.confidence ||
    first.weight - second.weight
  );
}

export function normalizeStage1EvaluatorComponent(
  input: Stage1EvaluatorCombinationInput,
  index: number
): Stage1NormalizedEvaluatorComponent {
  const output = stage1EvaluatorOutputSchema.parse(input.output);
  const weight = input.weight ?? DEFAULT_COMPONENT_WEIGHT;

  if (!(Number.isFinite(weight) && weight > 0)) {
    throw new Error(
      "Stage 1 evaluator weights must be positive finite numbers"
    );
  }

  return {
    evaluatorId:
      input.evaluatorId ??
      output.metadata?.evaluatorId ??
      `stage1.evaluator.${index + 1}`,
    output,
    weight,
  };
}

function chooseAggregateProgressStatus(
  components: readonly Stage1NormalizedEvaluatorComponent[]
): Stage1ProgressStatus {
  const statuses = new Set(
    components.map((component) => component.output.progressStatus)
  );

  if (statuses.has("victory")) {
    return "victory";
  }
  if (statuses.has("regressed")) {
    return "regressed";
  }
  if (statuses.has("stuck")) {
    return "stuck";
  }
  if (statuses.has("progress")) {
    return "progress";
  }
  if (statuses.has("no-progress")) {
    return "no-progress";
  }
  return "unknown";
}

function createAggregateMetadata(
  components: readonly Stage1NormalizedEvaluatorComponent[],
  options: Stage1EvaluatorCombinationOptions
): Stage1EvaluatorMetadata {
  const frameStart = minDefined(
    components.map((component) => component.output.metadata?.frameStart)
  );
  const frameEnd = maxDefined(
    components.map((component) => component.output.metadata?.frameEnd)
  );
  const tokenUsage = sumTokenUsage(
    components.map((component) => component.output.metadata?.tokenUsage)
  );

  return stage1EvaluatorMetadataSchema.parse({
    ...options.metadata,
    evaluatorId: options.evaluatorId ?? DEFAULT_AGGREGATE_EVALUATOR_ID,
    extra: {
      ...options.metadata?.extra,
      aggregate: {
        componentCount: components.length,
        components: components.map((component) => ({
          confidence: component.output.confidence,
          evaluatorId: component.evaluatorId,
          progressScore: component.output.progressScore,
          progressStatus: component.output.progressStatus,
          weight: component.weight,
        })),
      },
    },
    frameEnd: options.metadata?.frameEnd ?? frameEnd,
    frameStart: options.metadata?.frameStart ?? frameStart,
    tokenUsage: options.metadata?.tokenUsage ?? tokenUsage,
  });
}

function weightedAverage(
  values: readonly { value: number; weight: number }[]
): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) {
    return 0;
  }

  return values.reduce(
    (sum, item) => sum + item.value * (item.weight / totalWeight),
    0
  );
}

function minDefined(
  values: readonly (number | undefined)[]
): number | undefined {
  const defined = values.filter(
    (value): value is number => value !== undefined
  );
  if (defined.length === 0) {
    return;
  }
  return Math.min(...defined);
}

function maxDefined(
  values: readonly (number | undefined)[]
): number | undefined {
  const defined = values.filter(
    (value): value is number => value !== undefined
  );
  if (defined.length === 0) {
    return;
  }
  return Math.max(...defined);
}

function sumTokenUsage(
  values: readonly (Stage1TokenUsageDiagnostic | undefined)[]
): Stage1TokenUsageDiagnostic | undefined {
  const defined = values.filter(
    (value): value is Stage1TokenUsageDiagnostic => value !== undefined
  );
  if (defined.length === 0) {
    return;
  }

  return TOKEN_USAGE_FIELDS.reduce<Stage1TokenUsageDiagnostic>(
    (accumulator, field) => {
      const sum = defined.reduce(
        (total, value) => total + (value[field] ?? 0),
        0
      );
      if (sum > 0) {
        accumulator[field] = sum;
      }
      return accumulator;
    },
    {}
  );
}

function createEvaluatorMetadata(
  metadata: Stage1EvaluatorMetadata | undefined,
  evaluatorId: string
): Stage1EvaluatorMetadata {
  return stage1EvaluatorMetadataSchema.parse({
    ...metadata,
    evaluatorId,
  });
}

function createLoopEvaluatorMetadata(
  metadata: Stage1EvaluatorMetadata | undefined,
  evaluatorId: string,
  loop: Record<string, unknown>
): Stage1EvaluatorMetadata {
  return stage1EvaluatorMetadataSchema.parse({
    ...metadata,
    evaluatorId,
    extra: {
      ...metadata?.extra,
      loop,
    },
  });
}

function createStuckEvaluatorMetadata(
  metadata: Stage1EvaluatorMetadata | undefined,
  evaluatorId: string,
  stuck: Record<string, unknown>
): Stage1EvaluatorMetadata {
  return stage1EvaluatorMetadataSchema.parse({
    ...metadata,
    evaluatorId,
    extra: {
      ...metadata?.extra,
      stuck,
    },
  });
}

function createRepeatedActionEvaluatorMetadata(
  metadata: Stage1EvaluatorMetadata | undefined,
  evaluatorId: string,
  repeatedAction: Record<string, unknown>
): Stage1EvaluatorMetadata {
  return stage1EvaluatorMetadataSchema.parse({
    ...metadata,
    evaluatorId,
    extra: {
      ...metadata?.extra,
      repeatedAction,
    },
  });
}

function findKnownTransition(
  fromMapId: number,
  toMapId: number
): Stage1KnownMapTransition | undefined {
  return POKEMON_RED_STAGE1_KNOWN_TRANSITIONS.find(
    (transition) =>
      transition.fromMapId === fromMapId && transition.toMapId === toMapId
  );
}

function evaluateKnownMapChange({
  current,
  currentMap,
  evaluatorId,
  metadata,
  previous,
}: {
  current: Stage1MapPosition;
  currentMap: Stage1KnownMapProgress;
  evaluatorId: string;
  metadata: Stage1EvaluatorMetadata | undefined;
  previous: Stage1MapPosition | undefined;
}): Stage1EvaluatorOutput | undefined {
  if (!previous || previous.mapId === current.mapId) {
    return;
  }

  const forwardTransition = findKnownTransition(previous.mapId, current.mapId);
  if (forwardTransition) {
    const isVictory = current.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity;
    return stage1EvaluatorOutputSchema.parse({
      confidence: 0.92,
      diagnostics: [
        {
          category: "progress",
          evidence: [
            `${formatMapPosition(previous)} -> ${formatMapPosition(current)}`,
            `transition=${forwardTransition.id}`,
          ],
          message: isVictory
            ? "Known Route 1 to Viridian City boundary crossed; Stage 1 victory reached."
            : `Known ${forwardTransition.fromName} to ${forwardTransition.toName} boundary crossed.`,
          severity: "info",
        },
      ],
      metadata: createEvaluatorMetadata(metadata, evaluatorId),
      progressScore: forwardTransition.score,
      progressStatus: isVictory ? "victory" : "progress",
      schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
  }

  const reverseTransition = findKnownTransition(current.mapId, previous.mapId);
  if (!reverseTransition) {
    return;
  }

  return stage1EvaluatorOutputSchema.parse({
    confidence: 0.85,
    diagnostics: [
      {
        category: "progress",
        evidence: [
          `${formatMapPosition(previous)} -> ${formatMapPosition(current)}`,
          `reverseTransition=${reverseTransition.id}`,
        ],
        message: `Regression across known boundary: returned from ${reverseTransition.toName} to ${reverseTransition.fromName}.`,
        severity: "warning",
      },
    ],
    metadata: createEvaluatorMetadata(metadata, evaluatorId),
    progressScore: currentMap.baseScore,
    progressStatus: "regressed",
    schemaVersion: STAGE1_EVALUATOR_SCHEMA_VERSION,
    victoryCondition: STAGE1_VICTORY_CONDITION,
  });
}

function formatMapPosition({ mapId, x, y }: Stage1MapPosition): string {
  return `map=${mapId} x=${x} y=${y}`;
}

function readUsableMapPosition(
  state: PokemonStateObservation | undefined
): Stage1MapPosition | undefined {
  if (
    !state ||
    state.readStatus !== "available" ||
    state.mapId === null ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return;
  }

  return {
    mapId: state.mapId,
    x: state.position.x,
    y: state.position.y,
  };
}

function createStuckWindowEntry(
  entry: Stage1StuckHistoryEntry
): Stage1StuckWindowEntry | undefined {
  const position = readUsableMapPosition(entry.state);
  if (!position) {
    return;
  }

  const map = KNOWN_MAPS_BY_ID.get(position.mapId);
  if (!map) {
    return;
  }

  return {
    frame: entry.frame,
    position,
    progressScore: scoreKnownMapPosition(map, position.y),
    turn: entry.turn,
  };
}

function createLoopSignature(
  entry: Stage1LoopHistoryEntry
): Stage1LoopSignature | undefined {
  if (!entry.action || entry.action.trim().length === 0) {
    return;
  }

  const state = entry.state;
  if (
    !state ||
    state.readStatus !== "available" ||
    state.mapId === null ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return;
  }

  const actionKey = entry.action.trim();
  const mode = [
    state.battle ? "battle" : "overworld",
    state.dialogueLike === true ? "dialogue" : "no-dialogue",
    state.menuLike === true ? "menu" : "no-menu",
  ].join(":");
  const stateKey = [
    `map:${state.mapId}`,
    `x:${state.position.x}`,
    `y:${state.position.y}`,
    `dir:${state.direction}`,
    mode,
  ].join("|");

  return {
    actionKey,
    label: `${stateKey}|action:${actionKey}`,
    stateKey,
  };
}

function createRepeatedActionSignature(
  entry: Stage1RepeatedActionHistoryEntry
): Stage1RepeatedActionSignature | undefined {
  const actionKey = normalizeRepeatedActionKey(entry);
  if (!actionKey) {
    return;
  }

  const position = readUsableMapPosition(entry.state);
  const map = position ? KNOWN_MAPS_BY_ID.get(position.mapId) : undefined;
  const progressScore =
    position && map ? scoreKnownMapPosition(map, position.y) : undefined;

  return {
    actionKey,
    frame: entry.frame,
    label: position
      ? `${formatMapPosition(position)}|action:${actionKey}`
      : `action:${actionKey}`,
    position,
    progressScore,
    turn: entry.turn,
  };
}

function normalizeRepeatedActionKey(
  entry: Stage1RepeatedActionHistoryEntry
): string | undefined {
  if (entry.toolName) {
    return normalizeToolAction(entry.toolName, entry.input);
  }
  if (!entry.action || entry.action.trim().length === 0) {
    return;
  }

  const text = entry.action.trim();
  const [toolText, payloadText] = splitActionText(text);
  if (!payloadText) {
    return normalizeLooseActionText(text);
  }

  return normalizeToolAction(toolText, parseActionPayload(payloadText));
}

function splitActionText(text: string): [string, string | undefined] {
  const separatorIndex = text.indexOf(":");
  if (separatorIndex < 0) {
    return [text, undefined];
  }
  return [
    text.slice(0, separatorIndex).trim(),
    text.slice(separatorIndex + 1).trim(),
  ];
}

function normalizeToolAction(toolName: string, input: unknown): string {
  const tool = normalizeToolName(toolName);
  const buttons = extractActionButtons(input);
  if (buttons.length > 0) {
    return `${tool}:${buttons.map(canonicalButtonName).sort().join("+")}`;
  }

  const fallback = normalizeLooseActionText(String(input ?? ""));
  return fallback ? `${tool}:${fallback}` : tool;
}

function normalizeToolName(toolName: string): string {
  const normalized = toolName
    .trim()
    .toLowerCase()
    .replace(MGBA_TOOL_PREFIX_PATTERN, "");
  if (normalized.endsWith("_many")) {
    return normalized.slice(0, -"_many".length);
  }
  return normalized;
}

function extractActionButtons(input: unknown): string[] {
  if (typeof input === "string") {
    return input.trim().length > 0 ? [input] : [];
  }
  if (!input || typeof input !== "object") {
    return [];
  }

  const record = input as { button?: unknown; buttons?: unknown };
  if (typeof record.button === "string") {
    return [record.button];
  }
  if (Array.isArray(record.buttons)) {
    return record.buttons.filter(
      (button): button is string => typeof button === "string"
    );
  }
  return [];
}

function parseActionPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload.replaceAll(ACTION_PAYLOAD_QUOTE_PATTERN, "");
  }
}

function normalizeLooseActionText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replaceAll(LOOSE_ACTION_WHITESPACE_PATTERN, " ");
}

function canonicalButtonName(button: string): string {
  return button.trim().toLowerCase();
}

function getRepeatedActionSuffix(
  signatures: readonly Stage1RepeatedActionSignature[]
): readonly Stage1RepeatedActionSignature[] {
  const latest = signatures.at(-1);
  if (!latest) {
    return [];
  }

  let start = signatures.length - 1;
  while (start > 0 && signatures[start - 1]?.actionKey === latest.actionKey) {
    start -= 1;
  }
  return signatures.slice(start);
}

function maxEquivalentActionRunLength(
  signatures: readonly Stage1RepeatedActionSignature[]
): number {
  let maxRun = 0;
  let currentRun = 0;
  let currentActionKey: string | undefined;

  for (const signature of signatures) {
    if (signature.actionKey === currentActionKey) {
      currentRun += 1;
    } else {
      currentActionKey = signature.actionKey;
      currentRun = 1;
    }
    maxRun = Math.max(maxRun, currentRun);
  }

  return maxRun;
}

function summarizeRepeatedActionRun(
  run: readonly Stage1RepeatedActionSignature[]
): {
  actionKey: string;
  currentPosition?: Stage1MapPosition;
  currentProgressScore?: number;
  firstPosition?: Stage1MapPosition;
  positionChanged: boolean;
  progressDelta: number;
} {
  const actionKey = run.at(-1)?.actionKey ?? "unknown";
  const positions = run
    .map((signature) => signature.position)
    .filter((position): position is Stage1MapPosition => Boolean(position));
  const progressScores = run
    .map((signature) => signature.progressScore)
    .filter((score): score is number => score !== undefined);
  const firstPosition = positions[0];
  const currentPosition = positions.at(-1);
  const positionChanged =
    firstPosition !== undefined &&
    currentPosition !== undefined &&
    !sameMapPosition(firstPosition, currentPosition);
  const progressDelta =
    progressScores.length >= 2
      ? Math.max(0, (progressScores.at(-1) ?? 0) - progressScores[0])
      : 0;

  return {
    actionKey,
    currentPosition,
    currentProgressScore: progressScores.at(-1),
    firstPosition,
    positionChanged,
    progressDelta,
  };
}

function sameMapPosition(
  first: Stage1MapPosition,
  second: Stage1MapPosition
): boolean {
  return (
    first.mapId === second.mapId && first.x === second.x && first.y === second.y
  );
}

function findStrongestLoopPattern(
  signatures: readonly Stage1LoopSignature[],
  maxCycleLength: number
): Stage1LoopPattern | undefined {
  const normalizedMaxCycleLength = normalizeMaxCycleLength(maxCycleLength);
  let strongest: Stage1LoopPattern | undefined;

  for (
    let cycleLength = 1;
    cycleLength <= Math.min(normalizedMaxCycleLength, signatures.length / 2);
    cycleLength += 1
  ) {
    const repeats = countSuffixCycleRepeats(signatures, cycleLength);
    if (repeats < 2) {
      continue;
    }

    const pattern = signatures.slice(-cycleLength);
    const loopScore = clamp01((repeats - 1) / 3);
    const candidate = {
      cycleLength,
      loopScore,
      pattern,
      repeats,
    } satisfies Stage1LoopPattern;

    if (
      !strongest ||
      candidate.loopScore > strongest.loopScore ||
      (candidate.loopScore === strongest.loopScore &&
        candidate.cycleLength < strongest.cycleLength)
    ) {
      strongest = candidate;
    }
  }

  if (!strongest || strongest.loopScore < LOOP_WARNING_SCORE) {
    return;
  }
  return strongest;
}

function countSuffixCycleRepeats(
  signatures: readonly Stage1LoopSignature[],
  cycleLength: number
): number {
  const patternStart = signatures.length - cycleLength;
  const pattern = signatures.slice(patternStart);
  let repeats = 1;

  for (
    let cursor = patternStart - cycleLength;
    cursor >= 0;
    cursor -= cycleLength
  ) {
    const candidate = signatures.slice(cursor, cursor + cycleLength);
    if (!sameLoopPattern(candidate, pattern)) {
      break;
    }
    repeats += 1;
  }

  return repeats;
}

function sameLoopPattern(
  left: readonly Stage1LoopSignature[],
  right: readonly Stage1LoopSignature[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (signature, index) =>
        signature.stateKey === right[index]?.stateKey &&
        signature.actionKey === right[index]?.actionKey
    )
  );
}

function loopConfidence(usableHistoryLength: number): number {
  return clamp01(0.45 + Math.min(usableHistoryLength, 10) * 0.05);
}

function stuckConfidence(usableWindowLength: number): number {
  return clamp01(0.5 + Math.min(usableWindowLength, 10) * 0.05);
}

function repeatedActionConfidence(usableActionCount: number): number {
  return roundScore(clamp01(0.45 + Math.min(usableActionCount, 10) * 0.05));
}

function normalizeMaxCycleLength(maxCycleLength: number): number {
  if (!(Number.isFinite(maxCycleLength) && maxCycleLength > 0)) {
    return DEFAULT_LOOP_MAX_CYCLE_LENGTH;
  }
  return Math.max(1, Math.floor(maxCycleLength));
}

function normalizeRepeatedActionThreshold(threshold: number): number {
  if (!(Number.isFinite(threshold) && threshold > 1)) {
    return DEFAULT_REPEATED_ACTION_THRESHOLD;
  }
  return Math.max(2, Math.floor(threshold));
}

function normalizeMinimumMeaningfulProgressDelta(delta: number): number {
  if (!(Number.isFinite(delta) && delta > 0)) {
    return DEFAULT_STUCK_MINIMUM_MEANINGFUL_PROGRESS_DELTA;
  }
  return clamp01(delta);
}

function normalizeStuckScoreThreshold(threshold: number): number {
  if (!(Number.isFinite(threshold) && threshold > 0)) {
    return DEFAULT_STUCK_SCORE_THRESHOLD;
  }
  return clamp01(threshold);
}

function normalizeWindowSize(windowSize: number): number {
  if (!(Number.isFinite(windowSize) && windowSize > 1)) {
    return DEFAULT_STUCK_WINDOW_SIZE;
  }
  return Math.max(2, Math.floor(windowSize));
}

function scoreKnownMapPosition(map: Stage1KnownMapProgress, y: number): number {
  if (map.startY === undefined || map.exitY === undefined) {
    return map.baseScore;
  }

  const denominator = map.startY - map.exitY;
  if (denominator <= 0) {
    return map.baseScore;
  }

  const progress = clamp01((map.startY - y) / denominator);
  return (
    map.segmentStartScore +
    progress * (map.segmentEndScore - map.segmentStartScore)
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}
