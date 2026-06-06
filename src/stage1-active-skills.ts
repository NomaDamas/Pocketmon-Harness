import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import {
  STAGE1_GAMEPLAY_GAME,
  STAGE1_GAMEPLAY_SCHEMA_VERSION,
  STAGE1_GAMEPLAY_STAGE,
  STAGE1_GAMEPLAY_VICTORY_CONDITION,
  type Stage1GameplaySkill,
  validateStage1GameplaySkill,
} from "./stage1-gameplay-schema";

export const STAGE1_ACTIVE_SKILL_SOURCE = "base-guide" as const;

export const STAGE1_VIRIDIAN_REQUIRED_SKILL_SCOPES = [
  "navigation",
  "interaction",
  "route-guide",
] as const;

const baseSkillFields = {
  game: STAGE1_GAMEPLAY_GAME,
  schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
  stage: STAGE1_GAMEPLAY_STAGE,
  status: "active",
} as const;

function activeSkill(
  skill: Omit<Stage1GameplaySkill, keyof typeof baseSkillFields>
) {
  return validateStage1GameplaySkill({
    ...baseSkillFields,
    ...skill,
  });
}

export const STAGE1_VIRIDIAN_ACTIVE_SKILLS = [
  activeSkill({
    description:
      "Convert Pallet Town and Route 1 route-guide rules into one safe northbound movement candidate toward Viridian City.",
    id: "skill:route-1.follow-north-path",
    input: {
      optionalContext: [
        "state.position.x",
        "state.direction",
        "recentActions",
        "stuckMemory.failedMovementEdges",
        "stuckMemory.stuckEvents",
        "evaluator.progressStatus",
      ],
      requiredObservation: [
        "state.readStatus",
        "state.mapId",
        "state.position.y",
        "state.battle",
      ],
      requiredRuleScopes: ["control", "mode", "navigation", "route-guide"],
    },
    output: {
      actionCandidates: [
        {
          expectedEffects: [
            {
              confidenceDelta: 0.2,
              description:
                "Northbound movement should reduce distance to the Route 1 or Viridian City map transition.",
              kind: "record-fact",
              priorityDelta: 0,
            },
          ],
          priority: 95,
          rationale:
            "The active base guide route to Viridian City is north from Pallet Town, then north through Route 1.",
          toolCall: {
            buttons: ["Up"],
            durationFrames: 16,
            toolName: "mgba_hold",
          },
        },
      ],
      failureModes: [
        {
          description:
            "The same northbound movement repeats without map or y-coordinate progress.",
          evidenceFields: [
            "state.mapId",
            "state.position.y",
            "recentActions",
            "stuckMemory.failedMovementEdges",
          ],
          kind: "loop",
          recoveryHint:
            "Switch to the lateral obstacle recovery skill before trying Up again.",
        },
        {
          description:
            "Pokemon Red RAM is unavailable or does not identify the current route map.",
          evidenceFields: ["state.readStatus", "state.mapId"],
          kind: "ambiguous-observation",
          recoveryHint:
            "Fall back to direct model action only when route skill inputs are missing.",
        },
      ],
      successCriteria: [
        {
          conditions: [
            {
              evidence: ["The evaluator emits the Stage 1 Viridian milestone"],
              field: "milestone.id",
              operator: "equals",
              value: STAGE1_GAMEPLAY_VICTORY_CONDITION,
            },
            {
              evidence: ["Viridian City is the Stage 1 victory map"],
              field: "state.mapId",
              operator: "equals",
              value: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
            },
          ],
          description: "Reach the Viridian City map.",
          kind: "victory-condition",
          withinFrames: 18_000,
        },
        {
          conditions: [
            {
              evidence: [
                "A northbound step should change position before the map transition.",
              ],
              field: "state.position.y",
              operator: "changed",
            },
          ],
          description:
            "Make measurable northbound position progress while still on Pallet Town or Route 1.",
          kind: "position-changed",
          withinFrames: 640,
        },
      ],
    },
    preconditions: [
      {
        evidence: ["Pokemon Red RAM read is available"],
        field: "state.readStatus",
        operator: "equals",
        value: "available",
      },
      {
        evidence: [
          "The active route guide is scoped to Pallet Town and Route 1",
        ],
        field: "state.mapId",
        operator: "in",
        value: [
          POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          POKEMON_RED_STAGE1_MAP_IDS.route1,
        ],
      },
      {
        evidence: ["Do not run route movement while battle UI is active"],
        field: "state.battle",
        operator: "equals",
        value: false,
      },
      {
        evidence: [
          "Blocking dialogue should be handled by the interaction skill",
        ],
        field: "state.dialogueLike",
        operator: "not-equals",
        value: true,
      },
      {
        evidence: ["Menus are outside the Viridian route-following path"],
        field: "state.menuLike",
        operator: "not-equals",
        value: true,
      },
    ],
    scope: "route-guide",
  }),
  activeSkill({
    description:
      "Use short lateral walking candidates to recover from trees, ledges, or NPC blockers on the Pallet Town to Viridian route.",
    id: "skill:route-1.lateral-obstacle-recovery",
    input: {
      optionalContext: [
        "state.direction",
        "recentActions",
        "evaluator.progressStatus",
      ],
      requiredObservation: [
        "state.readStatus",
        "state.mapId",
        "state.position.x",
        "state.position.y",
        "stuckMemory.failedMovementEdges",
      ],
      requiredRuleScopes: ["control", "navigation", "route-guide"],
    },
    output: {
      actionCandidates: [
        {
          expectedEffects: [
            {
              confidenceDelta: 0.1,
              description:
                "A lateral step should change x-coordinate and create a new northbound approach.",
              kind: "record-fact",
              priorityDelta: 0,
            },
          ],
          priority: 80,
          rationale:
            "Try one supervised left step when repeated northbound movement is blocked.",
          toolCall: {
            buttons: ["Left"],
            durationFrames: 12,
            toolName: "mgba_hold",
          },
        },
        {
          expectedEffects: [
            {
              confidenceDelta: 0.1,
              description:
                "A mirrored lateral step should change x-coordinate when the left side is blocked.",
              kind: "record-fact",
              priorityDelta: 0,
            },
          ],
          priority: 76,
          rationale:
            "Try one supervised right step as the mirrored recovery candidate.",
          toolCall: {
            buttons: ["Right"],
            durationFrames: 12,
            toolName: "mgba_hold",
          },
        },
      ],
      failureModes: [
        {
          description:
            "Left/right recovery alternates without position progress or map transition progress.",
          evidenceFields: [
            "state.position.x",
            "state.position.y",
            "recentActions",
          ],
          kind: "loop",
          recoveryHint:
            "Return to evaluator evidence and avoid repeating the same lateral pair.",
        },
        {
          description:
            "Both lateral candidates fail to change position from the current map coordinate.",
          evidenceFields: [
            "state.mapId",
            "state.position.x",
            "state.position.y",
            "stuckMemory.stuckEvents",
          ],
          kind: "stuck",
          recoveryHint:
            "Escalate to candidate-only improvement evidence instead of adding optional route detours.",
        },
      ],
      successCriteria: [
        {
          conditions: [
            {
              evidence: [
                "A successful lateral detour changes x-coordinate before resuming north.",
              ],
              field: "state.position.x",
              operator: "changed",
            },
          ],
          description:
            "Create a new traversable position while staying on the Viridian route.",
          kind: "position-changed",
          withinFrames: 640,
        },
      ],
    },
    preconditions: [
      {
        evidence: ["Pokemon Red RAM read is available"],
        field: "state.readStatus",
        operator: "equals",
        value: "available",
      },
      {
        evidence: ["Obstacle recovery is only active before Viridian City"],
        field: "state.mapId",
        operator: "in",
        value: [
          POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          POKEMON_RED_STAGE1_MAP_IDS.route1,
        ],
      },
      {
        evidence: ["Existing stuck memory supplies blocked movement evidence"],
        field: "stuckMemory.failedMovementEdges",
        operator: "known",
      },
      {
        evidence: ["Do not run navigation recovery while battle UI is active"],
        field: "state.battle",
        operator: "equals",
        value: false,
      },
    ],
    scope: "navigation",
  }),
  activeSkill({
    description:
      "Advance mandatory blocking text on the Viridian route with one supervised A tap, then return to route navigation.",
    id: "skill:stage1.advance-blocking-text",
    input: {
      optionalContext: ["recentActions", "evaluator.progressStatus"],
      requiredObservation: [
        "state.readStatus",
        "state.mapId",
        "state.dialogueLike",
      ],
      requiredRuleScopes: ["control", "story", "route-guide"],
    },
    output: {
      actionCandidates: [
        {
          expectedEffects: [
            {
              confidenceDelta: 0.1,
              description:
                "A single A tap should progress mandatory text without changing the route objective.",
              kind: "record-fact",
              priorityDelta: 0,
            },
          ],
          priority: 85,
          rationale:
            "Mandatory text can block movement; A is the supervised Pokemon Red confirm button.",
          toolCall: {
            buttons: ["A"],
            durationFrames: 8,
            toolName: "mgba_tap",
          },
        },
      ],
      failureModes: [
        {
          description:
            "Repeated A taps do not clear or progress the blocking text evidence.",
          evidenceFields: ["state.dialogueLike", "recentActions"],
          kind: "loop",
          recoveryHint:
            "Let the evaluator create candidate evidence instead of adding optional interactions.",
        },
        {
          description:
            "The A tap fails at the tool boundary and no text progress can be observed.",
          evidenceFields: ["status.frame", "state.dialogueLike"],
          kind: "tool-error",
          recoveryHint:
            "Record the tool error as evidence while preserving the safe button boundary.",
        },
      ],
      successCriteria: [
        {
          conditions: [
            {
              evidence: ["Dialogue-like state should clear or advance"],
              field: "state.dialogueLike",
              operator: "changed",
            },
          ],
          description: "Progress mandatory text that blocks route movement.",
          kind: "dialogue-progressed",
          withinFrames: 640,
        },
        {
          conditions: [
            {
              evidence: ["Route movement can resume after text is cleared"],
              field: "state.dialogueLike",
              operator: "equals",
              value: false,
            },
          ],
          description: "Return to normal route navigation mode.",
          kind: "mode-cleared",
          withinFrames: 640,
        },
      ],
    },
    preconditions: [
      {
        evidence: ["Pokemon Red RAM read is available"],
        field: "state.readStatus",
        operator: "equals",
        value: "available",
      },
      {
        evidence: [
          "Blocking text handling is scoped to the active Viridian route maps",
        ],
        field: "state.mapId",
        operator: "in",
        value: [
          POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          POKEMON_RED_STAGE1_MAP_IDS.route1,
          POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
        ],
      },
      {
        evidence: ["Dialogue-like state is visible in Pokemon Red RAM"],
        field: "state.dialogueLike",
        operator: "equals",
        value: true,
      },
    ],
    scope: "interaction",
  }),
] as const satisfies readonly Stage1GameplaySkill[];

export const STAGE1_VIRIDIAN_ACTIVE_SKILL_IDS =
  STAGE1_VIRIDIAN_ACTIVE_SKILLS.map((skill) => skill.id);
