import { z } from "zod";
import { MGBA_BUTTONS } from "./mgba-http";

export const STAGE1_GAMEPLAY_SCHEMA_VERSION =
  "pokemon-red-stage1-gameplay/v1" as const;
export const STAGE1_GAMEPLAY_GAME = "pokemon-red" as const;
export const STAGE1_GAMEPLAY_STAGE = "stage1" as const;
export const STAGE1_GAMEPLAY_VICTORY_CONDITION = "reach-viridian-city" as const;
export const STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID =
  "stage1-viridian-city-reached" as const;

export const STAGE1_VIRIDIAN_CITY_MILESTONE_IDS = [
  "stage1-viridian-player-control",
  "stage1-viridian-pallet-town-exit",
  "stage1-viridian-route-1-entered",
  "stage1-viridian-route-1-north-progress",
  STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID,
] as const;

export const STAGE1_RULE_SCOPES = [
  "control",
  "mode",
  "navigation",
  "story",
  "battle",
  "resource",
  "route-guide",
] as const;

export const STAGE1_RULE_TRIGGER_KINDS = [
  "observation",
  "stuck-event",
  "milestone",
  "evaluator-diagnostic",
  "human-override",
] as const;

export const STAGE1_CONDITION_FIELDS = [
  "status.frame",
  "state.readStatus",
  "state.mapId",
  "state.position.x",
  "state.position.y",
  "state.direction",
  "state.battle",
  "state.dialogueLike",
  "state.menuLike",
  "recentActions",
  "stuckMemory.failedMovementEdges",
  "stuckMemory.stuckEvents",
  "milestone.id",
  "evaluator.progressStatus",
] as const;

export const STAGE1_CONDITION_OPERATORS = [
  "equals",
  "not-equals",
  "in",
  "not-in",
  "gt",
  "gte",
  "lt",
  "lte",
  "known",
  "unknown",
  "changed",
  "unchanged",
] as const;

export const STAGE1_RULE_EFFECT_KINDS = [
  "prefer-action",
  "avoid-action",
  "set-priority",
  "mark-mode",
  "record-fact",
  "activate-skill",
  "defer-to-human-override",
] as const;

export const STAGE1_SKILL_SCOPES = [
  "control",
  "navigation",
  "interaction",
  "battle",
  "recovery",
  "route-guide",
] as const;

export const STAGE1_SKILL_STATUSES = [
  "active",
  "candidate",
  "disabled",
] as const;

export const STAGE1_SAFE_TOOL_NAMES = [
  "mgba_tap",
  "mgba_tap_many",
  "mgba_hold",
  "mgba_hold_many",
  "mgba_release",
] as const;

export const STAGE1_SUCCESS_CRITERION_KINDS = [
  "reach-map",
  "reach-position",
  "position-changed",
  "mode-cleared",
  "battle-ended",
  "dialogue-progressed",
  "evaluator-status",
  "victory-condition",
] as const;

export const STAGE1_FAILURE_MODE_KINDS = [
  "stuck",
  "loop",
  "tool-error",
  "unsafe-action",
  "timeout",
  "regression",
  "ambiguous-observation",
] as const;

export const STAGE1_WORLD_MAP_KINDS = [
  "town",
  "city",
  "route",
  "interior",
  "gate",
  "special",
] as const;

export const STAGE1_LOCATION_KINDS = [
  "spawn",
  "town",
  "city",
  "route",
  "building",
  "path",
  "grass",
  "ledge",
  "sign",
  "npc",
  "gate",
  "unknown",
] as const;

export const STAGE1_LANDMARK_KINDS = [
  "objective",
  "transition",
  "obstacle",
  "orientation",
  "resource",
  "hazard",
] as const;

export const STAGE1_EXIT_KINDS = [
  "map-edge",
  "door",
  "warp",
  "gate",
  "stair",
  "ledge",
  "script",
] as const;

export const STAGE1_ROUTE_TRANSITION_KINDS = [
  "walk",
  "door",
  "warp",
  "ledge",
  "script",
  "unknown",
] as const;

export const STAGE1_ROUTE_WAYPOINT_KINDS = [
  "start",
  "checkpoint",
  "transition",
  "landmark",
  "goal",
  "avoid",
] as const;

export const STAGE1_ROUTE_PLANNING_STRATEGIES = [
  "progress-first",
  "best-known-path",
  "obstacle-recovery",
  "candidate-exploration",
] as const;

export const STAGE1_QUEST_OBJECTIVE_KINDS = [
  "reach-location",
  "reach-map",
  "follow-route",
  "clear-mode",
  "avoid-failure",
  "victory-condition",
] as const;

export const STAGE1_QUEST_DEPENDENCY_KINDS = [
  "quest",
  "rule",
  "skill",
  "route",
  "world",
  "candidate",
  "evaluator",
] as const;

export const STAGE1_QUEST_PROGRESS_STATUSES = [
  "not-started",
  "active",
  "blocked",
  "complete",
  "failed",
] as const;

export const STAGE1_PROGRESS_EVENT_KINDS = [
  "observation",
  "action",
  "stuck-event",
  "milestone",
  "evaluator-feedback",
  "candidate-observation",
  "human-override",
] as const;

export const STAGE1_LEARNED_CANDIDATE_KINDS = [
  "rule-patch",
  "skill-patch",
  "route-guide-patch",
  "methodology-patch",
  "evaluator-patch",
] as const;

export const STAGE1_LEARNED_CANDIDATE_PROMOTION_STATUSES = [
  "proposed",
  "under-review",
  "promoted",
  "rejected",
  "disabled",
  "superseded",
] as const;

export const STAGE1_CANDIDATE_EVIDENCE_KINDS = [
  "trace",
  "observation",
  "stuck-event",
  "evaluator",
  "qa-verdict",
  "human-override",
  "test",
] as const;

export const STAGE1_EVALUATOR_FEEDBACK_VERDICTS = [
  "positive",
  "neutral",
  "negative",
  "blocker",
] as const;

export const STAGE1_HUMAN_OVERRIDE_SCOPES = [
  "rule",
  "skill",
  "route-guide",
  "quest",
  "candidate",
  "evaluator",
  "methodology",
  "library",
] as const;

export const STAGE1_HUMAN_OVERRIDE_ACTIONS = [
  "promote-candidate",
  "reject-candidate",
  "disable-entry",
  "annotate-entry",
  "set-priority",
  "pin-entry",
  "require-manual-review",
] as const;

export const STAGE1_HUMAN_OVERRIDE_EXPIRATION_KINDS = [
  "permanent",
  "expires-at",
  "frame-window",
  "manual-revocation",
] as const;

export const STAGE1_HUMAN_OVERRIDE_CONFLICT_KINDS = [
  "same-target",
  "overlapping-scope",
  "priority-conflict",
  "status-conflict",
  "content-conflict",
  "expiration-conflict",
] as const;

export const STAGE1_HUMAN_OVERRIDE_CONFLICT_SOURCES = [
  "base-guide",
  "learned-candidate",
  "generated-memory",
  "human-override",
] as const;

export const STAGE1_HUMAN_OVERRIDE_CONFLICT_RESOLUTIONS = [
  "human-override-wins",
  "base-guide-wins",
  "learned-entry-wins",
  "generated-entry-wins",
  "manual-review-required",
  "annotate-only",
] as const;

const idSlugPattern = /^[a-z0-9][a-z0-9._/-]*$/;
const ruleIdPattern = /^rule:[a-z0-9][a-z0-9._/-]*$/;
const skillIdPattern = /^skill:[a-z0-9][a-z0-9._/-]*$/;
const routeIdPattern = /^route:[a-z0-9][a-z0-9._/-]*$/;
const worldIdPattern = /^world:[a-z0-9][a-z0-9._/-]*$/;
const questIdPattern = /^quest:[a-z0-9][a-z0-9._/-]*$/;
const candidateIdPattern = /^candidate:[a-z0-9][a-z0-9._/-]*$/;
const evaluatorIdPattern = /^evaluator:[a-z0-9][a-z0-9._/-]*$/;
const overrideIdPattern = /^override:[a-z0-9][a-z0-9._/-]*$/;
const stage1EntityIdPattern =
  /^(candidate|evaluator|methodology|override|quest|route|rule|skill|world):[a-z0-9][a-z0-9._/-]*$/;
const stage1ViridianCityMilestoneRanks = new Map<
  Stage1ViridianCityMilestoneId,
  number
>(
  STAGE1_VIRIDIAN_CITY_MILESTONE_IDS.map((milestoneId, index) => [
    milestoneId,
    index,
  ])
);

const conditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

const frameWindowSchema = z
  .object({
    endFrame: z.number().int().nonnegative(),
    startFrame: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.endFrame >= value.startFrame, {
    message: "endFrame must be greater than or equal to startFrame",
    path: ["endFrame"],
  });

export const stage1ConditionSchema = z
  .object({
    evidence: z.array(z.string().min(1)).default([]),
    field: z.enum(STAGE1_CONDITION_FIELDS),
    operator: z.enum(STAGE1_CONDITION_OPERATORS),
    value: conditionValueSchema.optional(),
  })
  .strict()
  .refine(
    (condition) =>
      ["known", "unknown", "changed", "unchanged"].includes(
        condition.operator
      ) || condition.value !== undefined,
    {
      message: "value is required for comparison and membership operators",
      path: ["value"],
    }
  );

export const stage1SafeToolCallSchema = z
  .object({
    buttons: z.array(z.enum(MGBA_BUTTONS)).min(1).max(4).optional(),
    durationFrames: z.number().int().positive().max(600).optional(),
    toolName: z.enum(STAGE1_SAFE_TOOL_NAMES),
  })
  .strict()
  .refine(
    (toolCall) => toolCall.toolName === "mgba_release" || toolCall.buttons,
    {
      message: "button-control tools require at least one button",
      path: ["buttons"],
    }
  )
  .refine(
    (toolCall) =>
      !["mgba_tap", "mgba_hold"].includes(toolCall.toolName) ||
      toolCall.buttons?.length === 1,
    {
      message: "single-button tools require exactly one button",
      path: ["buttons"],
    }
  )
  .refine(
    (toolCall) =>
      toolCall.toolName !== "mgba_release" ||
      toolCall.buttons === undefined ||
      toolCall.buttons.length === 1,
    {
      message: "release accepts either no button or exactly one button",
      path: ["buttons"],
    }
  )
  .refine(
    (toolCall) =>
      toolCall.toolName !== "mgba_release" ||
      toolCall.durationFrames === undefined,
    {
      message: "release does not accept frame duration",
      path: ["durationFrames"],
    }
  );

export const stage1RuleTriggerSchema = z
  .object({
    conditions: z.array(stage1ConditionSchema).default([]),
    frameWindow: frameWindowSchema.optional(),
    kind: z.enum(STAGE1_RULE_TRIGGER_KINDS),
    label: z.string().min(1),
  })
  .strict();

export const stage1RuleEffectSchema = z
  .object({
    action: stage1SafeToolCallSchema.optional(),
    confidenceDelta: z.number().min(-1).max(1).default(0),
    description: z.string().min(1),
    kind: z.enum(STAGE1_RULE_EFFECT_KINDS),
    priorityDelta: z.number().int().min(-100).max(100).default(0),
    skillId: z.string().regex(skillIdPattern).optional(),
  })
  .strict()
  .refine(
    (effect) =>
      !["prefer-action", "avoid-action"].includes(effect.kind) ||
      effect.action !== undefined,
    {
      message: "action effects require a supervised mGBA button tool call",
      path: ["action"],
    }
  )
  .refine(
    (effect) =>
      effect.kind !== "activate-skill" || effect.skillId !== undefined,
    {
      message: "activate-skill effects require skillId",
      path: ["skillId"],
    }
  );

export const stage1GameplayRuleSchema = z
  .object({
    description: z.string().min(1),
    effects: z.array(stage1RuleEffectSchema).min(1),
    game: z.literal(STAGE1_GAMEPLAY_GAME),
    id: z.string().regex(ruleIdPattern),
    preconditions: z.array(stage1ConditionSchema).default([]),
    priority: z.number().int().min(0).max(100).default(50),
    schemaVersion: z.literal(STAGE1_GAMEPLAY_SCHEMA_VERSION),
    scope: z.enum(STAGE1_RULE_SCOPES),
    stage: z.literal(STAGE1_GAMEPLAY_STAGE),
    trigger: stage1RuleTriggerSchema,
  })
  .strict();

export const stage1SkillInputContractSchema = z
  .object({
    optionalContext: z.array(z.enum(STAGE1_CONDITION_FIELDS)).default([]),
    requiredObservation: z.array(z.enum(STAGE1_CONDITION_FIELDS)).min(1),
    requiredRuleScopes: z.array(z.enum(STAGE1_RULE_SCOPES)).default([]),
  })
  .strict();

export const stage1SuccessCriterionSchema = z
  .object({
    conditions: z.array(stage1ConditionSchema).min(1),
    description: z.string().min(1),
    kind: z.enum(STAGE1_SUCCESS_CRITERION_KINDS),
    withinFrames: z.number().int().positive().optional(),
  })
  .strict();

export const stage1FailureModeSchema = z
  .object({
    description: z.string().min(1),
    evidenceFields: z.array(z.enum(STAGE1_CONDITION_FIELDS)).min(1),
    kind: z.enum(STAGE1_FAILURE_MODE_KINDS),
    recoveryHint: z.string().min(1).optional(),
  })
  .strict();

export const stage1SkillActionCandidateSchema = z
  .object({
    expectedEffects: z.array(stage1RuleEffectSchema).default([]),
    priority: z.number().int().min(0).max(100),
    rationale: z.string().min(1),
    toolCall: stage1SafeToolCallSchema,
  })
  .strict();

export const stage1SkillOutputContractSchema = z
  .object({
    actionCandidates: z.array(stage1SkillActionCandidateSchema).min(1),
    failureModes: z.array(stage1FailureModeSchema).min(1),
    successCriteria: z.array(stage1SuccessCriterionSchema).min(1),
  })
  .strict();

export const stage1GameplaySkillSchema = z
  .object({
    description: z.string().min(1),
    game: z.literal(STAGE1_GAMEPLAY_GAME),
    id: z.string().regex(skillIdPattern),
    input: stage1SkillInputContractSchema,
    output: stage1SkillOutputContractSchema,
    preconditions: z.array(stage1ConditionSchema).default([]),
    schemaVersion: z.literal(STAGE1_GAMEPLAY_SCHEMA_VERSION),
    scope: z.enum(STAGE1_SKILL_SCOPES),
    stage: z.literal(STAGE1_GAMEPLAY_STAGE),
    status: z.enum(STAGE1_SKILL_STATUSES),
  })
  .strict();

export const stage1SkillRuntimeInputSchema = z
  .object({
    activeRuleIds: z.array(z.string().regex(ruleIdPattern)).default([]),
    frame: z.number().int().nonnegative().optional(),
    recentActions: z.array(z.string().min(1)).default([]),
    state: z
      .object({
        battle: z.boolean().optional(),
        direction: z
          .enum(["down", "up", "left", "right", "unknown"])
          .optional(),
        mapId: z.number().int().nonnegative().nullable().optional(),
        position: z
          .object({
            x: z.number().int().nonnegative().nullable(),
            y: z.number().int().nonnegative().nullable(),
          })
          .strict()
          .optional(),
        readStatus: z.enum(["available", "unavailable"]).optional(),
      })
      .strict()
      .optional(),
    stuckEventCount: z.number().int().nonnegative().default(0),
  })
  .strict();

export const stage1SkillRuntimeOutputSchema = z
  .object({
    candidates: z.array(stage1SkillActionCandidateSchema),
    confidence: z.number().min(0).max(1),
    failureModes: z.array(stage1FailureModeSchema).default([]),
    skillId: z.string().regex(skillIdPattern),
    successCriteria: z.array(stage1SuccessCriterionSchema).default([]),
  })
  .strict();

export const stage1ViridianCityRuntimeGameStateSchema = z
  .object({
    battle: z.boolean(),
    mapId: z.number().int().nonnegative().nullable(),
    phase: z.string().min(1),
    readStatus: z.enum(["available", "unavailable"]),
    x: z.number().int().nonnegative().nullable(),
    y: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const stage1ViridianCityProgressStateSchema = z
  .object({
    completedMilestoneIds: z
      .array(z.enum(STAGE1_VIRIDIAN_CITY_MILESTONE_IDS))
      .default([]),
    currentMilestoneId: z.enum(STAGE1_VIRIDIAN_CITY_MILESTONE_IDS).nullable(),
    evidence: z.array(z.string().min(1)).default([]),
    furthestMilestoneId: z.enum(STAGE1_VIRIDIAN_CITY_MILESTONE_IDS).nullable(),
    objective: z.literal(STAGE1_GAMEPLAY_VICTORY_CONDITION),
    progressScore: z.number().min(0).max(1),
    runtimeGameState: stage1ViridianCityRuntimeGameStateSchema,
    status: z.enum(STAGE1_QUEST_PROGRESS_STATUSES),
    updatedFrame: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (state) =>
      state.currentMilestoneId === null ||
      state.runtimeGameState.readStatus === "available",
    {
      message:
        "known Viridian milestone progress requires available runtimeGameState RAM evidence",
      path: ["runtimeGameState", "readStatus"],
    }
  )
  .refine(
    (state) =>
      state.currentMilestoneId === null ||
      (state.runtimeGameState.mapId !== null &&
        state.runtimeGameState.x !== null &&
        state.runtimeGameState.y !== null),
    {
      message:
        "known Viridian milestone progress requires runtimeGameState mapId and x/y evidence",
      path: ["runtimeGameState"],
    }
  )
  .refine(
    (state) =>
      state.currentMilestoneId === null ||
      state.furthestMilestoneId === null ||
      stage1ViridianCityMilestoneRank(state.furthestMilestoneId) >=
        stage1ViridianCityMilestoneRank(state.currentMilestoneId),
    {
      message: "furthestMilestoneId must not rank before currentMilestoneId",
      path: ["furthestMilestoneId"],
    }
  )
  .refine(
    (state) =>
      !state.completedMilestoneIds.includes(
        STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID
      ) ||
      state.currentMilestoneId === STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID ||
      state.furthestMilestoneId === STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID,
    {
      message:
        "terminal Viridian milestone completion requires current or furthest terminal milestone",
      path: ["completedMilestoneIds"],
    }
  )
  .refine((state) => state.status !== "complete" || state.progressScore === 1, {
    message: "complete Viridian progress requires a progressScore of 1",
    path: ["progressScore"],
  })
  .refine(
    (state) =>
      state.status !== "complete" ||
      (state.furthestMilestoneId ===
        STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID &&
        state.runtimeGameState.readStatus === "available" &&
        state.runtimeGameState.mapId === 1 &&
        state.runtimeGameState.phase === "viridian" &&
        state.runtimeGameState.battle === false),
    {
      message:
        "complete Viridian progress requires runtimeGameState to report Viridian City outside battle",
      path: ["runtimeGameState"],
    }
  );

export const stage1MapCoordinateSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

export const stage1WorldCoordinateSchema = stage1MapCoordinateSchema
  .extend({
    mapId: z.number().int().nonnegative(),
  })
  .strict();

export const stage1WorldMapBoundsSchema = z
  .object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

export const stage1WorldLocationSchema = z
  .object({
    description: z.string().min(1).optional(),
    id: z.string().regex(worldIdPattern),
    kind: z.enum(STAGE1_LOCATION_KINDS),
    name: z.string().min(1),
    position: stage1WorldCoordinateSchema,
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const stage1WorldLandmarkSchema = z
  .object({
    description: z.string().min(1),
    id: z.string().regex(worldIdPattern),
    kind: z.enum(STAGE1_LANDMARK_KINDS),
    name: z.string().min(1),
    position: stage1WorldCoordinateSchema,
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const stage1WorldExitSchema = z
  .object({
    description: z.string().min(1),
    direction: z.enum(["down", "up", "left", "right", "unknown"]),
    from: stage1WorldCoordinateSchema,
    id: z.string().regex(worldIdPattern),
    kind: z.enum(STAGE1_EXIT_KINDS),
    to: stage1WorldCoordinateSchema.optional(),
    toLocationId: z.string().regex(worldIdPattern).optional(),
    transitionId: z.string().regex(routeIdPattern).optional(),
  })
  .strict();

export const stage1WorldMapSchema = z
  .object({
    bounds: stage1WorldMapBoundsSchema.optional(),
    exits: z.array(stage1WorldExitSchema).default([]),
    id: z.string().regex(worldIdPattern),
    kind: z.enum(STAGE1_WORLD_MAP_KINDS),
    landmarks: z.array(stage1WorldLandmarkSchema).default([]),
    locations: z.array(stage1WorldLocationSchema).default([]),
    mapId: z.number().int().nonnegative(),
    name: z.string().min(1),
  })
  .strict()
  .refine(
    (map) =>
      map.locations.every((location) => location.position.mapId === map.mapId),
    {
      message: "location coordinates must belong to the enclosing map",
      path: ["locations"],
    }
  )
  .refine(
    (map) =>
      map.landmarks.every((landmark) => landmark.position.mapId === map.mapId),
    {
      message: "landmark coordinates must belong to the enclosing map",
      path: ["landmarks"],
    }
  )
  .refine((map) => map.exits.every((exit) => exit.from.mapId === map.mapId), {
    message: "exit coordinates must originate in the enclosing map",
    path: ["exits"],
  });

export const stage1RouteWaypointSchema = z
  .object({
    description: z.string().min(1).optional(),
    kind: z.enum(STAGE1_ROUTE_WAYPOINT_KINDS),
    landmarkId: z.string().regex(worldIdPattern).optional(),
    locationId: z.string().regex(worldIdPattern).optional(),
    position: stage1WorldCoordinateSchema,
  })
  .strict();

export const stage1RouteTransitionSchema = z
  .object({
    actionHint: z.string().min(1).optional(),
    description: z.string().min(1),
    exitId: z.string().regex(worldIdPattern).optional(),
    expectedFrameCost: z.number().int().positive().optional(),
    from: stage1WorldCoordinateSchema,
    id: z.string().regex(routeIdPattern),
    kind: z.enum(STAGE1_ROUTE_TRANSITION_KINDS),
    to: stage1WorldCoordinateSchema,
  })
  .strict();

export const stage1RoutePlanningMetadataSchema = z
  .object({
    activeMapIds: z.array(z.number().int().nonnegative()).min(1),
    estimatedFrameBudget: z.number().int().positive().optional(),
    objective: z.literal(STAGE1_GAMEPLAY_VICTORY_CONDITION),
    planningNotes: z.array(z.string().min(1)).default([]),
    preferredStrategy: z.enum(STAGE1_ROUTE_PLANNING_STRATEGIES),
    requiredRuleScopes: z.array(z.enum(STAGE1_RULE_SCOPES)).default([]),
    waypointOrder: z.array(stage1RouteWaypointSchema).min(1),
  })
  .strict();

export const stage1RouteKnowledgeSchema = z
  .object({
    description: z.string().min(1),
    game: z.literal(STAGE1_GAMEPLAY_GAME),
    id: z.string().regex(routeIdPattern),
    maps: z.array(stage1WorldMapSchema).min(1),
    planning: stage1RoutePlanningMetadataSchema,
    schemaVersion: z.literal(STAGE1_GAMEPLAY_SCHEMA_VERSION),
    stage: z.literal(STAGE1_GAMEPLAY_STAGE),
    status: z.enum(STAGE1_SKILL_STATUSES),
    transitions: z.array(stage1RouteTransitionSchema).default([]),
  })
  .strict()
  .refine(
    (route) =>
      new Set(route.maps.map((map) => map.mapId)).size === route.maps.length,
    {
      message: "world map IDs must be unique within route knowledge",
      path: ["maps"],
    }
  )
  .refine(
    (route) =>
      route.planning.activeMapIds.every((mapId) =>
        route.maps.some((map) => map.mapId === mapId)
      ),
    {
      message: "active planning maps must be defined in route knowledge",
      path: ["planning", "activeMapIds"],
    }
  )
  .refine(
    (route) => {
      const mapIds = new Set(route.maps.map((map) => map.mapId));
      return route.planning.waypointOrder.every((waypoint) =>
        mapIds.has(waypoint.position.mapId)
      );
    },
    {
      message: "route waypoints must reference defined maps",
      path: ["planning", "waypointOrder"],
    }
  )
  .refine(
    (route) => {
      const mapIds = new Set(route.maps.map((map) => map.mapId));
      return route.transitions.every(
        (transition) =>
          mapIds.has(transition.from.mapId) && mapIds.has(transition.to.mapId)
      );
    },
    {
      message: "route transitions must reference defined maps",
      path: ["transitions"],
    }
  );

export const stage1QuestObjectiveSchema = z
  .object({
    conditions: z.array(stage1ConditionSchema).min(1),
    description: z.string().min(1),
    kind: z.enum(STAGE1_QUEST_OBJECTIVE_KINDS),
    priority: z.number().int().min(0).max(100).default(50),
    targetId: z.string().regex(stage1EntityIdPattern).optional(),
    withinFrames: z.number().int().positive().optional(),
  })
  .strict();

export const stage1QuestDependencySchema = z
  .object({
    description: z.string().min(1).optional(),
    id: z.string().regex(stage1EntityIdPattern),
    kind: z.enum(STAGE1_QUEST_DEPENDENCY_KINDS),
    requiredStatus: z.string().min(1).optional(),
  })
  .strict()
  .refine((dependency) => dependency.id.startsWith(`${dependency.kind}:`), {
    message: "dependency id prefix must match dependency kind",
    path: ["id"],
  });

export const stage1QuestProgressEventSchema = z
  .object({
    evidence: z.array(z.string().min(1)).default([]),
    frame: z.number().int().nonnegative().optional(),
    kind: z.enum(STAGE1_PROGRESS_EVENT_KINDS),
    label: z.string().min(1),
    observedAt: z.string().datetime({ offset: true }).optional(),
    scoreDelta: z.number().min(-1).max(1).default(0),
  })
  .strict();

export const stage1QuestProgressStateSchema = z
  .object({
    activeObjectiveIds: z.array(z.string().regex(idSlugPattern)).default([]),
    blockedBy: z.array(stage1QuestDependencySchema).default([]),
    completedObjectiveIds: z.array(z.string().regex(idSlugPattern)).default([]),
    events: z.array(stage1QuestProgressEventSchema).default([]),
    lastEvaluatedFrame: z.number().int().nonnegative().optional(),
    progressScore: z.number().min(0).max(1),
    status: z.enum(STAGE1_QUEST_PROGRESS_STATUSES),
  })
  .strict();

export const stage1QuestSchema = z
  .object({
    dependencies: z.array(stage1QuestDependencySchema).default([]),
    description: z.string().min(1),
    game: z.literal(STAGE1_GAMEPLAY_GAME),
    id: z.string().regex(questIdPattern),
    objectives: z.array(stage1QuestObjectiveSchema).min(1),
    progress: stage1QuestProgressStateSchema,
    schemaVersion: z.literal(STAGE1_GAMEPLAY_SCHEMA_VERSION),
    stage: z.literal(STAGE1_GAMEPLAY_STAGE),
  })
  .strict()
  .refine(
    (quest) =>
      quest.progress.progressScore === 1 ||
      quest.progress.status !== "complete",
    {
      message: "complete quests require a progressScore of 1",
      path: ["progress", "progressScore"],
    }
  );

export const stage1CandidateObservationSchema = z
  .object({
    conditions: z.array(stage1ConditionSchema).default([]),
    description: z.string().min(1),
    frameWindow: frameWindowSchema.optional(),
    observationId: z.string().regex(idSlugPattern),
    sourceQuestId: z.string().regex(questIdPattern).optional(),
  })
  .strict();

export const stage1CandidateEvidenceSchema = z
  .object({
    artifactPath: z.string().min(1).optional(),
    description: z.string().min(1),
    frameWindow: frameWindowSchema.optional(),
    kind: z.enum(STAGE1_CANDIDATE_EVIDENCE_KINDS),
    weight: z.number().min(0).max(1).default(0.5),
  })
  .strict();

export const stage1CandidateEvaluatorFeedbackSchema = z
  .object({
    diagnostics: z.array(z.string().min(1)).default([]),
    evaluatorId: z.string().regex(evaluatorIdPattern),
    feedbackAtFrame: z.number().int().nonnegative().optional(),
    progressScore: z.number().min(0).max(1),
    rationale: z.string().min(1),
    tokenUsage: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        reasoningTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    verdict: z.enum(STAGE1_EVALUATOR_FEEDBACK_VERDICTS),
  })
  .strict();

export const stage1LearnedCandidateSchema = z
  .object({
    candidateKind: z.enum(STAGE1_LEARNED_CANDIDATE_KINDS),
    candidateObservations: z.array(stage1CandidateObservationSchema).min(1),
    createdFrom: z.array(stage1CandidateEvidenceSchema).min(1),
    dependencies: z.array(stage1QuestDependencySchema).default([]),
    description: z.string().min(1),
    evaluatorFeedback: z
      .array(stage1CandidateEvaluatorFeedbackSchema)
      .default([]),
    game: z.literal(STAGE1_GAMEPLAY_GAME),
    id: z.string().regex(candidateIdPattern),
    patch: z.record(z.string(), z.unknown()),
    promotionStatus: z.enum(STAGE1_LEARNED_CANDIDATE_PROMOTION_STATUSES),
    schemaVersion: z.literal(STAGE1_GAMEPLAY_SCHEMA_VERSION),
    stage: z.literal(STAGE1_GAMEPLAY_STAGE),
    targetId: z.string().regex(stage1EntityIdPattern),
  })
  .strict()
  .refine(
    (candidate) =>
      candidate.candidateKind !== "methodology-patch" ||
      candidate.targetId.startsWith("methodology:"),
    {
      message: "methodology patches must target methodology IDs",
      path: ["targetId"],
    }
  )
  .refine(
    (candidate) =>
      !["promoted", "rejected", "disabled"].includes(
        candidate.promotionStatus
      ) || candidate.evaluatorFeedback.length > 0,
    {
      message: "terminal promotion statuses require evaluator feedback",
      path: ["evaluatorFeedback"],
    }
  );

export const stage1HumanOverrideExpirationSchema = z
  .object({
    expiresAt: z.string().datetime({ offset: true }).optional(),
    frameWindow: frameWindowSchema.optional(),
    kind: z.enum(STAGE1_HUMAN_OVERRIDE_EXPIRATION_KINDS),
  })
  .strict()
  .refine(
    (expiration) =>
      expiration.kind !== "expires-at" || expiration.expiresAt !== undefined,
    {
      message: "expires-at overrides require expiresAt",
      path: ["expiresAt"],
    }
  )
  .refine(
    (expiration) =>
      expiration.kind !== "frame-window" ||
      expiration.frameWindow !== undefined,
    {
      message: "frame-window overrides require frameWindow",
      path: ["frameWindow"],
    }
  )
  .refine(
    (expiration) =>
      expiration.kind === "expires-at" || expiration.expiresAt === undefined,
    {
      message: "expiresAt is only valid for expires-at overrides",
      path: ["expiresAt"],
    }
  )
  .refine(
    (expiration) =>
      expiration.kind === "frame-window" ||
      expiration.frameWindow === undefined,
    {
      message: "frameWindow is only valid for frame-window overrides",
      path: ["frameWindow"],
    }
  );

export const stage1HumanOverrideAuditSchema = z
  .object({
    approvedBy: z.string().min(1).optional(),
    createdAt: z.string().datetime({ offset: true }),
    createdBy: z.string().min(1),
    reason: z.string().min(1),
    reviewNotes: z.array(z.string().min(1)).default([]),
    sourceArtifactPath: z.string().min(1).optional(),
    traceId: z.string().min(1).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (audit) =>
      !audit.updatedAt ||
      Date.parse(audit.updatedAt) >= Date.parse(audit.createdAt),
    {
      message: "updatedAt must not be earlier than createdAt",
      path: ["updatedAt"],
    }
  );

export const stage1HumanOverrideConflictSchema = z
  .object({
    conflictingEntryId: z.string().regex(stage1EntityIdPattern),
    conflictKind: z.enum(STAGE1_HUMAN_OVERRIDE_CONFLICT_KINDS),
    detectedAt: z.string().datetime({ offset: true }).optional(),
    rationale: z.string().min(1),
    resolution: z.enum(STAGE1_HUMAN_OVERRIDE_CONFLICT_RESOLUTIONS),
    sourceKind: z.enum(STAGE1_HUMAN_OVERRIDE_CONFLICT_SOURCES),
  })
  .strict()
  .refine(
    (conflict) =>
      conflict.sourceKind !== "learned-candidate" ||
      conflict.conflictingEntryId.startsWith("candidate:"),
    {
      message: "learned-candidate conflicts must reference candidate IDs",
      path: ["conflictingEntryId"],
    }
  );

export const stage1HumanOverrideConflictPolicySchema = z
  .object({
    conflicts: z.array(stage1HumanOverrideConflictSchema).default([]),
    defaultResolution: z.enum(STAGE1_HUMAN_OVERRIDE_CONFLICT_RESOLUTIONS),
    requiresManualReview: z.boolean().default(false),
  })
  .strict()
  .refine(
    (policy) =>
      policy.defaultResolution !== "manual-review-required" ||
      policy.requiresManualReview,
    {
      message: "manual-review-required conflicts must set requiresManualReview",
      path: ["requiresManualReview"],
    }
  );

export const stage1HumanOverrideSchema = z
  .object({
    action: z.enum(STAGE1_HUMAN_OVERRIDE_ACTIONS),
    audit: stage1HumanOverrideAuditSchema,
    conflictPolicy: stage1HumanOverrideConflictPolicySchema,
    description: z.string().min(1),
    expiration: stage1HumanOverrideExpirationSchema,
    game: z.literal(STAGE1_GAMEPLAY_GAME),
    id: z.string().regex(overrideIdPattern),
    metadata: z.record(z.string(), z.unknown()).default({}),
    priority: z.number().int().min(0).max(100),
    schemaVersion: z.literal(STAGE1_GAMEPLAY_SCHEMA_VERSION),
    scope: z.enum(STAGE1_HUMAN_OVERRIDE_SCOPES),
    stage: z.literal(STAGE1_GAMEPLAY_STAGE),
    targetId: z.string().regex(stage1EntityIdPattern).optional(),
  })
  .strict()
  .refine(
    (override) =>
      override.expiration.kind !== "expires-at" ||
      !override.expiration.expiresAt ||
      Date.parse(override.expiration.expiresAt) >
        Date.parse(override.audit.createdAt),
    {
      message: "expiresAt must be later than audit.createdAt",
      path: ["expiration", "expiresAt"],
    }
  )
  .refine(
    (override) =>
      !["promote-candidate", "reject-candidate"].includes(override.action) ||
      override.targetId?.startsWith("candidate:"),
    {
      message: "candidate override actions require candidate targetId",
      path: ["targetId"],
    }
  );

export const stage1GameplayLibrarySchema = z
  .object({
    game: z.literal(STAGE1_GAMEPLAY_GAME),
    humanOverrides: z.array(stage1HumanOverrideSchema).default([]),
    learnedCandidates: z.array(stage1LearnedCandidateSchema).default([]),
    quests: z.array(stage1QuestSchema).default([]),
    rules: z.array(stage1GameplayRuleSchema),
    routeKnowledge: z.array(stage1RouteKnowledgeSchema).default([]),
    schemaVersion: z.literal(STAGE1_GAMEPLAY_SCHEMA_VERSION),
    skills: z.array(stage1GameplaySkillSchema),
    stage: z.literal(STAGE1_GAMEPLAY_STAGE),
    victoryCondition: z.literal(STAGE1_GAMEPLAY_VICTORY_CONDITION),
  })
  .strict()
  .refine(
    (library) =>
      new Set(library.humanOverrides.map((override) => override.id)).size ===
      library.humanOverrides.length,
    {
      message: "human override IDs must be unique",
      path: ["humanOverrides"],
    }
  )
  .refine(
    (library) =>
      new Set(library.learnedCandidates.map((candidate) => candidate.id))
        .size === library.learnedCandidates.length,
    {
      message: "learned candidate IDs must be unique",
      path: ["learnedCandidates"],
    }
  )
  .refine(
    (library) =>
      new Set(library.quests.map((quest) => quest.id)).size ===
      library.quests.length,
    {
      message: "quest IDs must be unique",
      path: ["quests"],
    }
  )
  .refine(
    (library) =>
      new Set(library.rules.map((rule) => rule.id)).size ===
      library.rules.length,
    {
      message: "rule IDs must be unique",
      path: ["rules"],
    }
  )
  .refine(
    (library) =>
      new Set(library.routeKnowledge.map((route) => route.id)).size ===
      library.routeKnowledge.length,
    {
      message: "route knowledge IDs must be unique",
      path: ["routeKnowledge"],
    }
  )
  .refine(
    (library) =>
      new Set(library.skills.map((skill) => skill.id)).size ===
      library.skills.length,
    {
      message: "skill IDs must be unique",
      path: ["skills"],
    }
  );

export type Stage1RuleScope = (typeof STAGE1_RULE_SCOPES)[number];
export type Stage1RuleTriggerKind = (typeof STAGE1_RULE_TRIGGER_KINDS)[number];
export type Stage1ConditionField = (typeof STAGE1_CONDITION_FIELDS)[number];
export type Stage1ConditionOperator =
  (typeof STAGE1_CONDITION_OPERATORS)[number];
export type Stage1RuleEffectKind = (typeof STAGE1_RULE_EFFECT_KINDS)[number];
export type Stage1SkillScope = (typeof STAGE1_SKILL_SCOPES)[number];
export type Stage1SkillStatus = (typeof STAGE1_SKILL_STATUSES)[number];
export type Stage1SafeToolName = (typeof STAGE1_SAFE_TOOL_NAMES)[number];
export type Stage1SuccessCriterionKind =
  (typeof STAGE1_SUCCESS_CRITERION_KINDS)[number];
export type Stage1FailureModeKind = (typeof STAGE1_FAILURE_MODE_KINDS)[number];
export type Stage1WorldMapKind = (typeof STAGE1_WORLD_MAP_KINDS)[number];
export type Stage1LocationKind = (typeof STAGE1_LOCATION_KINDS)[number];
export type Stage1LandmarkKind = (typeof STAGE1_LANDMARK_KINDS)[number];
export type Stage1ExitKind = (typeof STAGE1_EXIT_KINDS)[number];
export type Stage1RouteTransitionKind =
  (typeof STAGE1_ROUTE_TRANSITION_KINDS)[number];
export type Stage1RouteWaypointKind =
  (typeof STAGE1_ROUTE_WAYPOINT_KINDS)[number];
export type Stage1RoutePlanningStrategy =
  (typeof STAGE1_ROUTE_PLANNING_STRATEGIES)[number];
export type Stage1QuestObjectiveKind =
  (typeof STAGE1_QUEST_OBJECTIVE_KINDS)[number];
export type Stage1QuestDependencyKind =
  (typeof STAGE1_QUEST_DEPENDENCY_KINDS)[number];
export type Stage1QuestProgressStatus =
  (typeof STAGE1_QUEST_PROGRESS_STATUSES)[number];
export type Stage1ProgressEventKind =
  (typeof STAGE1_PROGRESS_EVENT_KINDS)[number];
export type Stage1LearnedCandidateKind =
  (typeof STAGE1_LEARNED_CANDIDATE_KINDS)[number];
export type Stage1LearnedCandidatePromotionStatus =
  (typeof STAGE1_LEARNED_CANDIDATE_PROMOTION_STATUSES)[number];
export type Stage1CandidateEvidenceKind =
  (typeof STAGE1_CANDIDATE_EVIDENCE_KINDS)[number];
export type Stage1EvaluatorFeedbackVerdict =
  (typeof STAGE1_EVALUATOR_FEEDBACK_VERDICTS)[number];
export type Stage1HumanOverrideScope =
  (typeof STAGE1_HUMAN_OVERRIDE_SCOPES)[number];
export type Stage1HumanOverrideAction =
  (typeof STAGE1_HUMAN_OVERRIDE_ACTIONS)[number];
export type Stage1HumanOverrideExpirationKind =
  (typeof STAGE1_HUMAN_OVERRIDE_EXPIRATION_KINDS)[number];
export type Stage1HumanOverrideConflictKind =
  (typeof STAGE1_HUMAN_OVERRIDE_CONFLICT_KINDS)[number];
export type Stage1HumanOverrideConflictSource =
  (typeof STAGE1_HUMAN_OVERRIDE_CONFLICT_SOURCES)[number];
export type Stage1HumanOverrideConflictResolution =
  (typeof STAGE1_HUMAN_OVERRIDE_CONFLICT_RESOLUTIONS)[number];
export type Stage1Condition = z.infer<typeof stage1ConditionSchema>;
export type Stage1SafeToolCall = z.infer<typeof stage1SafeToolCallSchema>;
export type Stage1RuleTrigger = z.infer<typeof stage1RuleTriggerSchema>;
export type Stage1RuleEffect = z.infer<typeof stage1RuleEffectSchema>;
export type Stage1GameplayRule = z.infer<typeof stage1GameplayRuleSchema>;
export type Stage1SkillInputContract = z.infer<
  typeof stage1SkillInputContractSchema
>;
export type Stage1SuccessCriterion = z.infer<
  typeof stage1SuccessCriterionSchema
>;
export type Stage1FailureMode = z.infer<typeof stage1FailureModeSchema>;
export type Stage1SkillActionCandidate = z.infer<
  typeof stage1SkillActionCandidateSchema
>;
export type Stage1SkillOutputContract = z.infer<
  typeof stage1SkillOutputContractSchema
>;
export type Stage1GameplaySkill = z.infer<typeof stage1GameplaySkillSchema>;
export type Stage1SkillRuntimeInput = z.infer<
  typeof stage1SkillRuntimeInputSchema
>;
export type Stage1SkillRuntimeOutput = z.infer<
  typeof stage1SkillRuntimeOutputSchema
>;
export type Stage1ViridianCityMilestoneId =
  (typeof STAGE1_VIRIDIAN_CITY_MILESTONE_IDS)[number];
export type Stage1ViridianCityRuntimeGameState = z.infer<
  typeof stage1ViridianCityRuntimeGameStateSchema
>;
export type Stage1ViridianCityProgressState = z.infer<
  typeof stage1ViridianCityProgressStateSchema
>;
export type Stage1MapCoordinate = z.infer<typeof stage1MapCoordinateSchema>;
export type Stage1WorldCoordinate = z.infer<typeof stage1WorldCoordinateSchema>;
export type Stage1WorldMapBounds = z.infer<typeof stage1WorldMapBoundsSchema>;
export type Stage1WorldLocation = z.infer<typeof stage1WorldLocationSchema>;
export type Stage1WorldLandmark = z.infer<typeof stage1WorldLandmarkSchema>;
export type Stage1WorldExit = z.infer<typeof stage1WorldExitSchema>;
export type Stage1WorldMap = z.infer<typeof stage1WorldMapSchema>;
export type Stage1RouteWaypoint = z.infer<typeof stage1RouteWaypointSchema>;
export type Stage1RouteTransition = z.infer<typeof stage1RouteTransitionSchema>;
export type Stage1RoutePlanningMetadata = z.infer<
  typeof stage1RoutePlanningMetadataSchema
>;
export type Stage1RouteKnowledge = z.infer<typeof stage1RouteKnowledgeSchema>;
export type Stage1QuestObjective = z.infer<typeof stage1QuestObjectiveSchema>;
export type Stage1QuestDependency = z.infer<typeof stage1QuestDependencySchema>;
export type Stage1QuestProgressEvent = z.infer<
  typeof stage1QuestProgressEventSchema
>;
export type Stage1QuestProgressState = z.infer<
  typeof stage1QuestProgressStateSchema
>;
export type Stage1Quest = z.infer<typeof stage1QuestSchema>;
export type Stage1CandidateObservation = z.infer<
  typeof stage1CandidateObservationSchema
>;
export type Stage1CandidateEvidence = z.infer<
  typeof stage1CandidateEvidenceSchema
>;
export type Stage1CandidateEvaluatorFeedback = z.infer<
  typeof stage1CandidateEvaluatorFeedbackSchema
>;
export type Stage1LearnedCandidate = z.infer<
  typeof stage1LearnedCandidateSchema
>;
export type Stage1HumanOverrideExpiration = z.infer<
  typeof stage1HumanOverrideExpirationSchema
>;
export type Stage1HumanOverrideAudit = z.infer<
  typeof stage1HumanOverrideAuditSchema
>;
export type Stage1HumanOverrideConflict = z.infer<
  typeof stage1HumanOverrideConflictSchema
>;
export type Stage1HumanOverrideConflictPolicy = z.infer<
  typeof stage1HumanOverrideConflictPolicySchema
>;
export type Stage1HumanOverride = z.infer<typeof stage1HumanOverrideSchema>;
export type Stage1GameplayLibrary = z.infer<typeof stage1GameplayLibrarySchema>;

export function validateStage1GameplayRule(input: unknown): Stage1GameplayRule {
  return stage1GameplayRuleSchema.parse(input);
}

export function validateStage1GameplaySkill(
  input: unknown
): Stage1GameplaySkill {
  return stage1GameplaySkillSchema.parse(input);
}

export function validateStage1GameplayLibrary(
  input: unknown
): Stage1GameplayLibrary {
  return stage1GameplayLibrarySchema.parse(input);
}

export function validateStage1ViridianCityProgressState(
  input: unknown
): Stage1ViridianCityProgressState {
  return stage1ViridianCityProgressStateSchema.parse(input);
}

export function validateStage1RouteKnowledge(
  input: unknown
): Stage1RouteKnowledge {
  return stage1RouteKnowledgeSchema.parse(input);
}

export function validateStage1Quest(input: unknown): Stage1Quest {
  return stage1QuestSchema.parse(input);
}

export function validateStage1LearnedCandidate(
  input: unknown
): Stage1LearnedCandidate {
  return stage1LearnedCandidateSchema.parse(input);
}

export function validateStage1HumanOverride(
  input: unknown
): Stage1HumanOverride {
  return stage1HumanOverrideSchema.parse(input);
}

export function createStage1GameplayLibrary({
  humanOverrides = [],
  learnedCandidates = [],
  quests = [],
  routeKnowledge = [],
  rules,
  skills,
}: {
  humanOverrides?: readonly Stage1HumanOverride[];
  learnedCandidates?: readonly Stage1LearnedCandidate[];
  quests?: readonly Stage1Quest[];
  routeKnowledge?: readonly Stage1RouteKnowledge[];
  rules: readonly Stage1GameplayRule[];
  skills: readonly Stage1GameplaySkill[];
}): Stage1GameplayLibrary {
  return validateStage1GameplayLibrary({
    game: STAGE1_GAMEPLAY_GAME,
    humanOverrides: [...humanOverrides].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    learnedCandidates: [...learnedCandidates].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    quests: [...quests].sort((left, right) => left.id.localeCompare(right.id)),
    rules: [...rules].sort((left, right) => left.id.localeCompare(right.id)),
    routeKnowledge: [...routeKnowledge].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
    skills: [...skills].sort((left, right) => left.id.localeCompare(right.id)),
    stage: STAGE1_GAMEPLAY_STAGE,
    victoryCondition: STAGE1_GAMEPLAY_VICTORY_CONDITION,
  });
}

export function createStage1Id(
  kind: "candidate" | "override" | "quest" | "rule" | "skill",
  slug: string
): string {
  if (!idSlugPattern.test(slug)) {
    throw new Error(
      "Stage 1 gameplay IDs require lowercase slug characters: letters, numbers, '.', '_', '/', or '-'"
    );
  }
  return `${kind}:${slug}`;
}

function stage1ViridianCityMilestoneRank(
  milestoneId: Stage1ViridianCityMilestoneId
): number {
  return stage1ViridianCityMilestoneRanks.get(milestoneId) ?? -1;
}
