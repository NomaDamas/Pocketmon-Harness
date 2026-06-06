import { describe, expect, it } from "vitest";
import {
  createStage1GameplayLibrary,
  createStage1Id,
  STAGE1_GAMEPLAY_GAME,
  STAGE1_GAMEPLAY_SCHEMA_VERSION,
  STAGE1_GAMEPLAY_STAGE,
  STAGE1_GAMEPLAY_VICTORY_CONDITION,
  type Stage1GameplayRule,
  type Stage1GameplaySkill,
  type Stage1HumanOverride,
  type Stage1LearnedCandidate,
  type Stage1Quest,
  type Stage1RouteKnowledge,
  stage1ConditionSchema,
  stage1GameplayLibrarySchema,
  stage1HumanOverrideSchema,
  stage1LearnedCandidateSchema,
  stage1QuestSchema,
  stage1RouteKnowledgeSchema,
  stage1SafeToolCallSchema,
  stage1SkillRuntimeInputSchema,
  stage1SkillRuntimeOutputSchema,
  validateStage1GameplayRule,
  validateStage1GameplaySkill,
  validateStage1HumanOverride,
  validateStage1LearnedCandidate,
  validateStage1Quest,
  validateStage1RouteKnowledge,
} from "../src/stage1-gameplay-schema";

function routeRule(
  overrides: Partial<Stage1GameplayRule> = {}
): Stage1GameplayRule {
  return validateStage1GameplayRule({
    description:
      "When early-game observation shows Pallet or Route 1, prefer northbound movement toward Viridian City.",
    effects: [
      {
        action: {
          buttons: ["Up"],
          durationFrames: 12,
          toolName: "mgba_hold",
        },
        confidenceDelta: 0.2,
        description: "Try one supervised tile of northbound movement.",
        kind: "prefer-action",
        priorityDelta: 20,
      },
    ],
    game: STAGE1_GAMEPLAY_GAME,
    id: "rule:route-1.prefer-north",
    preconditions: [
      {
        evidence: ["Pokemon Red RAM read is available"],
        field: "state.readStatus",
        operator: "equals",
        value: "available",
      },
    ],
    priority: 80,
    schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
    scope: "route-guide",
    stage: STAGE1_GAMEPLAY_STAGE,
    trigger: {
      conditions: [
        {
          evidence: ["state map and y coordinate are visible"],
          field: "state.position.y",
          operator: "known",
        },
      ],
      frameWindow: {
        endFrame: 120,
        startFrame: 0,
      },
      kind: "observation",
      label: "early route observation",
    },
    ...overrides,
  });
}

function navigationSkill(
  overrides: Partial<Stage1GameplaySkill> = {}
): Stage1GameplaySkill {
  return validateStage1GameplaySkill({
    description:
      "Convert active route-guide rules into a safe one-tile northbound movement candidate.",
    game: STAGE1_GAMEPLAY_GAME,
    id: "skill:route-1.follow-north-path",
    input: {
      optionalContext: ["recentActions", "stuckMemory.stuckEvents"],
      requiredObservation: ["state.mapId", "state.position.y"],
      requiredRuleScopes: ["route-guide", "navigation"],
    },
    output: {
      actionCandidates: [
        {
          expectedEffects: [
            {
              confidenceDelta: 0.15,
              description:
                "A successful northbound step should reduce distance to Viridian City.",
              kind: "record-fact",
              priorityDelta: 0,
            },
          ],
          priority: 90,
          rationale: "One supervised Up hold preserves the control boundary.",
          toolCall: {
            buttons: ["Up"],
            durationFrames: 12,
            toolName: "mgba_hold",
          },
        },
      ],
      failureModes: [
        {
          description:
            "Repeated northbound holds do not change map or position evidence.",
          evidenceFields: [
            "state.mapId",
            "state.position.x",
            "state.position.y",
            "stuckMemory.stuckEvents",
          ],
          kind: "stuck",
          recoveryHint: "Switch to obstacle recovery before trying Up again.",
        },
      ],
      successCriteria: [
        {
          conditions: [
            {
              evidence: ["Viridian City milestone emitted by evaluator"],
              field: "milestone.id",
              operator: "equals",
              value: STAGE1_GAMEPLAY_VICTORY_CONDITION,
            },
          ],
          description: "Reach Viridian City.",
          kind: "victory-condition",
          withinFrames: 18_000,
        },
      ],
    },
    preconditions: [
      {
        evidence: ["Avoid autonomous battle handling in this navigation skill"],
        field: "state.battle",
        operator: "equals",
        value: false,
      },
    ],
    schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
    scope: "route-guide",
    stage: STAGE1_GAMEPLAY_STAGE,
    status: "active",
    ...overrides,
  });
}

function viridianRouteKnowledge(
  overrides: Partial<Stage1RouteKnowledge> = {}
): Stage1RouteKnowledge {
  return validateStage1RouteKnowledge({
    description:
      "Base Pokemon Red route knowledge for leaving Pallet Town, crossing Route 1, and reaching Viridian City.",
    game: STAGE1_GAMEPLAY_GAME,
    id: "route:pallet-to-viridian",
    maps: [
      {
        bounds: {
          height: 18,
          width: 20,
        },
        exits: [
          {
            description: "North edge of Pallet Town enters Route 1.",
            direction: "up",
            from: {
              mapId: 0,
              x: 10,
              y: 0,
            },
            id: "world:pallet-town.north-exit",
            kind: "map-edge",
            to: {
              mapId: 12,
              x: 10,
              y: 35,
            },
            transitionId: "route:pallet-to-route-1",
          },
        ],
        id: "world:pallet-town",
        kind: "town",
        landmarks: [
          {
            description: "Early-game starting town before Route 1.",
            id: "world:pallet-town.spawn-landmark",
            kind: "orientation",
            name: "Pallet Town start",
            position: {
              mapId: 0,
              x: 10,
              y: 12,
            },
            tags: ["start"],
          },
        ],
        locations: [
          {
            description: "Safe starting overworld area.",
            id: "world:pallet-town.spawn",
            kind: "spawn",
            name: "Pallet Town starting area",
            position: {
              mapId: 0,
              x: 10,
              y: 12,
            },
            tags: ["stage1"],
          },
        ],
        mapId: 0,
        name: "Pallet Town",
      },
      {
        exits: [
          {
            description: "North end of Route 1 enters Viridian City.",
            direction: "up",
            from: {
              mapId: 12,
              x: 10,
              y: 0,
            },
            id: "world:route-1.north-exit",
            kind: "map-edge",
            to: {
              mapId: 1,
              x: 10,
              y: 30,
            },
            transitionId: "route:route-1-to-viridian",
          },
        ],
        id: "world:route-1",
        kind: "route",
        landmarks: [
          {
            description: "Northbound outdoor route with grass and ledges.",
            id: "world:route-1.path",
            kind: "transition",
            name: "Route 1 north path",
            position: {
              mapId: 12,
              x: 10,
              y: 20,
            },
            tags: ["route-guide"],
          },
        ],
        locations: [],
        mapId: 12,
        name: "Route 1",
      },
      {
        exits: [],
        id: "world:viridian-city",
        kind: "city",
        landmarks: [
          {
            description: "Stage 1 victory city.",
            id: "world:viridian-city.arrival",
            kind: "objective",
            name: "Viridian City arrival",
            position: {
              mapId: 1,
              x: 10,
              y: 30,
            },
            tags: ["victory"],
          },
        ],
        locations: [
          {
            id: "world:viridian-city.entry",
            kind: "city",
            name: "Viridian City south entry",
            position: {
              mapId: 1,
              x: 10,
              y: 30,
            },
            tags: ["goal"],
          },
        ],
        mapId: 1,
        name: "Viridian City",
      },
    ],
    planning: {
      activeMapIds: [0, 12, 1],
      estimatedFrameBudget: 18_000,
      objective: STAGE1_GAMEPLAY_VICTORY_CONDITION,
      planningNotes: [
        "Use northbound movement when not blocked, then recover around obstacles.",
      ],
      preferredStrategy: "progress-first",
      requiredRuleScopes: ["navigation", "route-guide"],
      waypointOrder: [
        {
          kind: "start",
          locationId: "world:pallet-town.spawn",
          position: {
            mapId: 0,
            x: 10,
            y: 12,
          },
        },
        {
          kind: "transition",
          landmarkId: "world:route-1.path",
          position: {
            mapId: 12,
            x: 10,
            y: 20,
          },
        },
        {
          kind: "goal",
          landmarkId: "world:viridian-city.arrival",
          position: {
            mapId: 1,
            x: 10,
            y: 30,
          },
        },
      ],
    },
    schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
    stage: STAGE1_GAMEPLAY_STAGE,
    status: "active",
    transitions: [
      {
        actionHint:
          "Hold Up until the map changes from Pallet Town to Route 1.",
        description: "Pallet Town north edge to Route 1 south edge.",
        exitId: "world:pallet-town.north-exit",
        expectedFrameCost: 120,
        from: {
          mapId: 0,
          x: 10,
          y: 0,
        },
        id: "route:pallet-to-route-1",
        kind: "walk",
        to: {
          mapId: 12,
          x: 10,
          y: 35,
        },
      },
      {
        actionHint: "Keep walking north through Route 1 into Viridian City.",
        description: "Route 1 north edge to Viridian City south entry.",
        exitId: "world:route-1.north-exit",
        expectedFrameCost: 600,
        from: {
          mapId: 12,
          x: 10,
          y: 0,
        },
        id: "route:route-1-to-viridian",
        kind: "walk",
        to: {
          mapId: 1,
          x: 10,
          y: 30,
        },
      },
    ],
    ...overrides,
  });
}

function viridianQuest(overrides: Partial<Stage1Quest> = {}): Stage1Quest {
  return validateStage1Quest({
    dependencies: [
      {
        description: "Use the base route knowledge for Pallet to Viridian.",
        id: "route:pallet-to-viridian",
        kind: "route",
        requiredStatus: "active",
      },
      {
        description: "Use the safe northbound movement skill.",
        id: "skill:route-1.follow-north-path",
        kind: "skill",
        requiredStatus: "active",
      },
    ],
    description:
      "Autonomously reach Viridian City from the early-game Pallet Town state.",
    game: STAGE1_GAMEPLAY_GAME,
    id: "quest:reach-viridian-city",
    objectives: [
      {
        conditions: [
          {
            evidence: ["Viridian City map id is visible in Pokemon Red RAM"],
            field: "state.mapId",
            operator: "equals",
            value: 1,
          },
        ],
        description: "Reach the Viridian City map.",
        kind: "victory-condition",
        priority: 100,
        targetId: "world:viridian-city.entry",
        withinFrames: 18_000,
      },
    ],
    progress: {
      activeObjectiveIds: ["reach-viridian-map"],
      completedObjectiveIds: [],
      events: [
        {
          evidence: ["Map transition score increased from Pallet Town."],
          frame: 720,
          kind: "evaluator-feedback",
          label: "northbound movement improved route progress",
          observedAt: "2026-06-06T00:00:00.000Z",
          scoreDelta: 0.2,
        },
      ],
      lastEvaluatedFrame: 720,
      progressScore: 0.35,
      status: "active",
    },
    schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
    stage: STAGE1_GAMEPLAY_STAGE,
    ...overrides,
  });
}

function learnedCandidate(
  overrides: Partial<Stage1LearnedCandidate> = {}
): Stage1LearnedCandidate {
  return validateStage1LearnedCandidate({
    candidateKind: "route-guide-patch",
    candidateObservations: [
      {
        conditions: [
          {
            evidence: ["Repeated Up holds stayed stationary near a ledge."],
            field: "stuckMemory.stuckEvents",
            operator: "known",
          },
        ],
        description:
          "Route 1 northbound movement can stall and should try a lateral detour before retrying Up.",
        frameWindow: {
          endFrame: 1320,
          startFrame: 960,
        },
        observationId: "route-1.ledge-detour",
        sourceQuestId: "quest:reach-viridian-city",
      },
    ],
    createdFrom: [
      {
        artifactPath: "runs/stage1/trace.jsonl",
        description:
          "Trace evidence shows repeated stationary movement before a progress recovery.",
        frameWindow: {
          endFrame: 1320,
          startFrame: 960,
        },
        kind: "trace",
        weight: 0.7,
      },
      {
        description:
          "Evaluator diagnosed stuck behavior without rejecting higher token usage.",
        kind: "evaluator",
        weight: 0.8,
      },
    ],
    dependencies: [
      {
        id: "quest:reach-viridian-city",
        kind: "quest",
        requiredStatus: "active",
      },
    ],
    description:
      "Candidate route-guide patch for recovering around Route 1 ledges while preserving supervised controls.",
    evaluatorFeedback: [
      {
        diagnostics: [
          "Progress-first score improved after lateral detour candidate.",
        ],
        evaluatorId: "evaluator:stage1.map-transition-progress",
        feedbackAtFrame: 1440,
        progressScore: 0.62,
        rationale:
          "The candidate reduced stuck evidence and kept actions inside safe button tools.",
        tokenUsage: {
          totalTokens: 2048,
        },
        verdict: "positive",
      },
    ],
    game: STAGE1_GAMEPLAY_GAME,
    id: "candidate:route-1.ledge-detour",
    patch: {
      routeGuidePatch: {
        recoveryHint: "Try Left or Right for one tile, then resume Up.",
      },
    },
    promotionStatus: "under-review",
    schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
    stage: STAGE1_GAMEPLAY_STAGE,
    targetId: "route:pallet-to-viridian",
    ...overrides,
  });
}

function humanOverride(
  overrides: Partial<Stage1HumanOverride> = {}
): Stage1HumanOverride {
  return validateStage1HumanOverride({
    action: "reject-candidate",
    audit: {
      approvedBy: "stage1-operator",
      createdAt: "2026-06-06T00:02:00.000Z",
      createdBy: "stage1-operator",
      reason:
        "Trace review showed the proposed ledge detour loops near Pallet Town instead of improving Viridian progress.",
      reviewNotes: ["Reject until stronger evaluator evidence is available."],
      sourceArtifactPath: "runs/stage1/human-overrides.json",
      traceId: "stage1-run-001",
    },
    conflictPolicy: {
      conflicts: [
        {
          conflictingEntryId: "candidate:route-1.ledge-detour",
          conflictKind: "status-conflict",
          detectedAt: "2026-06-06T00:02:30.000Z",
          rationale:
            "Human review rejects a learned candidate that was still under review.",
          resolution: "human-override-wins",
          sourceKind: "learned-candidate",
        },
      ],
      defaultResolution: "human-override-wins",
      requiresManualReview: false,
    },
    description:
      "Reject the Route 1 ledge detour candidate while preserving the base guide route to Viridian City.",
    expiration: {
      expiresAt: "2026-06-07T00:02:00.000Z",
      kind: "expires-at",
    },
    game: STAGE1_GAMEPLAY_GAME,
    id: "override:route-1.reject-ledge-detour",
    metadata: {
      promotedByAutonomousLoop: false,
    },
    priority: 95,
    schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
    scope: "candidate",
    stage: STAGE1_GAMEPLAY_STAGE,
    targetId: "candidate:route-1.ledge-detour",
    ...overrides,
  });
}

describe("Stage 1 gameplay rule and skill schemas", () => {
  it("validates a Pokemon Red route-guide rule with trigger, preconditions, and effects", () => {
    const parsed = routeRule();

    expect(parsed).toMatchObject({
      game: "pokemon-red",
      id: "rule:route-1.prefer-north",
      schemaVersion: "pokemon-red-stage1-gameplay/v1",
      scope: "route-guide",
      stage: "stage1",
      trigger: {
        kind: "observation",
      },
    });
    expect(parsed.effects[0]?.action?.toolName).toBe("mgba_hold");
  });

  it("validates a skill with explicit input and output contracts", () => {
    const parsed = navigationSkill();

    expect(parsed.input.requiredObservation).toEqual([
      "state.mapId",
      "state.position.y",
    ]);
    expect(parsed.output.successCriteria[0]?.kind).toBe("victory-condition");
    expect(parsed.output.failureModes[0]?.kind).toBe("stuck");
    expect(parsed.output.actionCandidates[0]?.toolCall).toMatchObject({
      buttons: ["Up"],
      durationFrames: 12,
      toolName: "mgba_hold",
    });
  });

  it("accepts runtime skill input and output evidence without live mGBA orchestration", () => {
    const runtimeInput = stage1SkillRuntimeInputSchema.parse({
      activeRuleIds: ["rule:route-1.prefer-north"],
      frame: 2400,
      recentActions: ["mgba_hold Up 12"],
      state: {
        battle: false,
        direction: "up",
        mapId: 0,
        position: {
          x: 5,
          y: 3,
        },
        readStatus: "available",
      },
      stuckEventCount: 0,
    });

    const runtimeOutput = stage1SkillRuntimeOutputSchema.parse({
      candidates: navigationSkill().output.actionCandidates,
      confidence: 0.78,
      failureModes: navigationSkill().output.failureModes,
      skillId: "skill:route-1.follow-north-path",
      successCriteria: navigationSkill().output.successCriteria,
    });

    expect(runtimeInput.frame).toBe(2400);
    expect(runtimeOutput.candidates[0]?.toolCall.toolName).toBe("mgba_hold");
  });

  it("validates world and route knowledge for the Viridian City route objective", () => {
    const parsed = viridianRouteKnowledge();

    expect(stage1RouteKnowledgeSchema.parse(parsed)).toMatchObject({
      game: STAGE1_GAMEPLAY_GAME,
      id: "route:pallet-to-viridian",
      planning: {
        objective: STAGE1_GAMEPLAY_VICTORY_CONDITION,
        preferredStrategy: "progress-first",
      },
      stage: STAGE1_GAMEPLAY_STAGE,
    });
    expect(parsed.maps.map((map) => map.name)).toEqual([
      "Pallet Town",
      "Route 1",
      "Viridian City",
    ]);
    expect(parsed.planning.waypointOrder.at(-1)?.landmarkId).toBe(
      "world:viridian-city.arrival"
    );
    expect(parsed.transitions[0]).toMatchObject({
      exitId: "world:pallet-town.north-exit",
      kind: "walk",
    });
  });

  it("validates quest objectives, dependencies, and progress state for reaching Viridian City", () => {
    const parsed = stage1QuestSchema.parse(viridianQuest());

    expect(parsed).toMatchObject({
      game: STAGE1_GAMEPLAY_GAME,
      id: "quest:reach-viridian-city",
      progress: {
        progressScore: 0.35,
        status: "active",
      },
      stage: STAGE1_GAMEPLAY_STAGE,
    });
    expect(parsed.dependencies.map((dependency) => dependency.id)).toEqual([
      "route:pallet-to-viridian",
      "skill:route-1.follow-north-path",
    ]);
    expect(parsed.objectives[0]).toMatchObject({
      kind: "victory-condition",
      targetId: "world:viridian-city.entry",
    });
  });

  it("rejects invalid quest dependency prefixes and incomplete quest completion state", () => {
    expect(() =>
      viridianQuest({
        dependencies: [
          {
            id: "skill:route-1.follow-north-path",
            kind: "quest",
          },
        ],
      })
    ).toThrow("dependency id prefix must match dependency kind");

    expect(() =>
      viridianQuest({
        progress: {
          ...viridianQuest().progress,
          progressScore: 0.9,
          status: "complete",
        },
      })
    ).toThrow("complete quests require a progressScore of 1");
  });

  it("validates learned candidates with observations, evidence, promotion status, and evaluator feedback", () => {
    const parsed = stage1LearnedCandidateSchema.parse(learnedCandidate());

    expect(parsed).toMatchObject({
      candidateKind: "route-guide-patch",
      game: STAGE1_GAMEPLAY_GAME,
      id: "candidate:route-1.ledge-detour",
      promotionStatus: "under-review",
      targetId: "route:pallet-to-viridian",
    });
    expect(parsed.candidateObservations[0]?.sourceQuestId).toBe(
      "quest:reach-viridian-city"
    );
    expect(parsed.createdFrom.map((evidence) => evidence.kind)).toEqual([
      "trace",
      "evaluator",
    ]);
    expect(parsed.evaluatorFeedback[0]?.tokenUsage?.totalTokens).toBe(2048);
  });

  it("gates learned candidate promotion and methodology patch targets", () => {
    expect(() =>
      learnedCandidate({
        evaluatorFeedback: [],
        promotionStatus: "promoted",
      })
    ).toThrow("terminal promotion statuses require evaluator feedback");

    expect(() =>
      learnedCandidate({
        candidateKind: "methodology-patch",
      })
    ).toThrow("methodology patches must target methodology IDs");
  });

  it("validates human overrides with scope, priority, expiration, audit metadata, and conflict handling", () => {
    const parsed = stage1HumanOverrideSchema.parse(humanOverride());

    expect(parsed).toMatchObject({
      action: "reject-candidate",
      game: STAGE1_GAMEPLAY_GAME,
      id: "override:route-1.reject-ledge-detour",
      priority: 95,
      scope: "candidate",
      targetId: "candidate:route-1.ledge-detour",
    });
    expect(parsed.audit).toMatchObject({
      createdBy: "stage1-operator",
      traceId: "stage1-run-001",
    });
    expect(parsed.expiration).toMatchObject({
      expiresAt: "2026-06-07T00:02:00.000Z",
      kind: "expires-at",
    });
    expect(parsed.conflictPolicy.conflicts[0]).toMatchObject({
      conflictingEntryId: "candidate:route-1.ledge-detour",
      resolution: "human-override-wins",
      sourceKind: "learned-candidate",
    });
  });

  it("rejects invalid human override expiration, audit ordering, and candidate targets", () => {
    expect(() =>
      humanOverride({
        expiration: {
          kind: "expires-at",
        },
      })
    ).toThrow("expires-at overrides require expiresAt");

    expect(() =>
      humanOverride({
        audit: {
          ...humanOverride().audit,
          updatedAt: "2026-06-05T23:59:00.000Z",
        },
      })
    ).toThrow("updatedAt must not be earlier than createdAt");

    expect(() =>
      humanOverride({
        targetId: "rule:route-1.prefer-north",
      })
    ).toThrow("candidate override actions require candidate targetId");
  });

  it("requires explicit conflict policy for manual review and learned candidate conflicts", () => {
    expect(() =>
      humanOverride({
        conflictPolicy: {
          conflicts: [],
          defaultResolution: "manual-review-required",
          requiresManualReview: false,
        },
      })
    ).toThrow("manual-review-required conflicts must set requiresManualReview");

    expect(() =>
      humanOverride({
        conflictPolicy: {
          conflicts: [
            {
              conflictingEntryId: "rule:route-1.prefer-north",
              conflictKind: "content-conflict",
              rationale:
                "This incorrectly marks a generated rule as learned-candidate evidence.",
              resolution: "human-override-wins",
              sourceKind: "learned-candidate",
            },
          ],
          defaultResolution: "human-override-wins",
          requiresManualReview: false,
        },
      })
    ).toThrow("learned-candidate conflicts must reference candidate IDs");
  });

  it("rejects route knowledge with duplicate maps or undefined planning references", () => {
    const route = viridianRouteKnowledge();

    expect(() =>
      validateStage1RouteKnowledge({
        ...route,
        maps: [route.maps[0], route.maps[0]],
      })
    ).toThrow("world map IDs must be unique");

    expect(() =>
      validateStage1RouteKnowledge({
        ...route,
        planning: {
          ...route.planning,
          activeMapIds: [0, 99],
        },
      })
    ).toThrow("active planning maps must be defined");

    expect(() =>
      validateStage1RouteKnowledge({
        ...route,
        transitions: [
          {
            ...route.transitions[0],
            to: {
              mapId: 99,
              x: 1,
              y: 1,
            },
          },
        ],
      })
    ).toThrow("route transitions must reference defined maps");
  });

  it("keeps model-facing actions inside the supervised button-control boundary", () => {
    expect(() =>
      stage1SafeToolCallSchema.parse({
        buttons: ["A"],
        toolName: "mgba_reset",
      })
    ).toThrow();
    expect(() =>
      stage1SafeToolCallSchema.parse({
        buttons: ["Up", "Left"],
        toolName: "mgba_hold",
      })
    ).toThrow("single-button tools require exactly one button");

    expect(
      stage1SafeToolCallSchema.parse({
        toolName: "mgba_release",
      })
    ).toEqual({
      toolName: "mgba_release",
    });
  });

  it("rejects incomplete conditions and invalid frame windows", () => {
    expect(() =>
      stage1ConditionSchema.parse({
        field: "state.mapId",
        operator: "equals",
      })
    ).toThrow("value is required");

    expect(() =>
      routeRule({
        trigger: {
          conditions: [],
          frameWindow: {
            endFrame: 10,
            startFrame: 11,
          },
          kind: "observation",
          label: "invalid frame window",
        },
      })
    ).toThrow("endFrame must be greater than or equal to startFrame");
  });

  it("creates a Pokemon Red Stage 1 library and rejects duplicate IDs", () => {
    const library = createStage1GameplayLibrary({
      humanOverrides: [humanOverride()],
      learnedCandidates: [learnedCandidate()],
      quests: [viridianQuest()],
      routeKnowledge: [viridianRouteKnowledge()],
      rules: [routeRule()],
      skills: [navigationSkill()],
    });

    expect(stage1GameplayLibrarySchema.parse(library)).toMatchObject({
      game: STAGE1_GAMEPLAY_GAME,
      stage: STAGE1_GAMEPLAY_STAGE,
      victoryCondition: STAGE1_GAMEPLAY_VICTORY_CONDITION,
    });
    expect(library.routeKnowledge[0]?.planning.objective).toBe(
      STAGE1_GAMEPLAY_VICTORY_CONDITION
    );
    expect(library.quests[0]?.id).toBe("quest:reach-viridian-city");
    expect(library.learnedCandidates[0]?.id).toBe(
      "candidate:route-1.ledge-detour"
    );
    expect(library.humanOverrides[0]?.id).toBe(
      "override:route-1.reject-ledge-detour"
    );
    expect(() =>
      stage1GameplayLibrarySchema.parse({
        ...library,
        humanOverrides: [humanOverride(), humanOverride()],
      })
    ).toThrow("human override IDs must be unique");
    expect(() =>
      stage1GameplayLibrarySchema.parse({
        ...library,
        learnedCandidates: [learnedCandidate(), learnedCandidate()],
      })
    ).toThrow("learned candidate IDs must be unique");
    expect(() =>
      stage1GameplayLibrarySchema.parse({
        ...library,
        quests: [viridianQuest(), viridianQuest()],
      })
    ).toThrow("quest IDs must be unique");
    expect(() =>
      stage1GameplayLibrarySchema.parse({
        ...library,
        rules: [routeRule(), routeRule()],
      })
    ).toThrow("rule IDs must be unique");
    expect(() =>
      stage1GameplayLibrarySchema.parse({
        ...library,
        routeKnowledge: [viridianRouteKnowledge(), viridianRouteKnowledge()],
      })
    ).toThrow("route knowledge IDs must be unique");
  });

  it("creates typed rule and skill IDs from lowercase slugs", () => {
    expect(createStage1Id("rule", "route-1.prefer-north")).toBe(
      "rule:route-1.prefer-north"
    );
    expect(createStage1Id("skill", "route-1.follow-north-path")).toBe(
      "skill:route-1.follow-north-path"
    );
    expect(createStage1Id("quest", "reach-viridian-city")).toBe(
      "quest:reach-viridian-city"
    );
    expect(createStage1Id("candidate", "route-1.ledge-detour")).toBe(
      "candidate:route-1.ledge-detour"
    );
    expect(createStage1Id("override", "route-1.reject-ledge-detour")).toBe(
      "override:route-1.reject-ledge-detour"
    );
    expect(() => createStage1Id("rule", "Route 1")).toThrow(
      "Stage 1 gameplay IDs require lowercase slug characters"
    );
  });
});
