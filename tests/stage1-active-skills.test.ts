import { describe, expect, it } from "vitest";
import { STAGE1_VIRIDIAN_ACTIVE_RULES } from "../src/stage1-active-rules";
import {
  STAGE1_ACTIVE_SKILL_SOURCE,
  STAGE1_VIRIDIAN_ACTIVE_SKILL_IDS,
  STAGE1_VIRIDIAN_ACTIVE_SKILLS,
  STAGE1_VIRIDIAN_REQUIRED_SKILL_SCOPES,
} from "../src/stage1-active-skills";
import {
  POKEMON_RED_STAGE1_MAP_IDS,
  STAGE1_VICTORY_CONDITION,
} from "../src/stage1-evaluator";
import {
  STAGE1_GAMEPLAY_GAME,
  STAGE1_GAMEPLAY_STAGE,
  type Stage1GameplaySkill,
  validateStage1GameplaySkill,
} from "../src/stage1-gameplay-schema";

const UNSAFE_TOOL_PATTERN =
  /(?:^|[\s_:-])(?:reset|restart|rom|load|save|delete)(?:$|[\s_:-])/i;
const OPTIONAL_DETOUR_PATTERN = /\bcenter|pokedex|inventory|item\b/i;

function sortStrings(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function mapIdValuesFor(skill: Stage1GameplaySkill) {
  return skill.preconditions
    .filter((condition) => condition.field === "state.mapId")
    .flatMap((condition) =>
      Array.isArray(condition.value) ? condition.value : [condition.value]
    )
    .filter((value): value is number => typeof value === "number");
}

describe("Stage 1 Viridian active skill data", () => {
  it("defines only active base-guide skills needed for the Viridian route", () => {
    expect(STAGE1_ACTIVE_SKILL_SOURCE).toBe("base-guide");
    expect(STAGE1_VIRIDIAN_ACTIVE_SKILLS).toHaveLength(3);
    expect(new Set(STAGE1_VIRIDIAN_ACTIVE_SKILL_IDS).size).toBe(
      STAGE1_VIRIDIAN_ACTIVE_SKILL_IDS.length
    );
    expect(
      sortStrings([
        ...new Set(STAGE1_VIRIDIAN_ACTIVE_SKILLS.map((skill) => skill.scope)),
      ])
    ).toEqual(sortStrings(STAGE1_VIRIDIAN_REQUIRED_SKILL_SCOPES));
    expect(
      STAGE1_VIRIDIAN_ACTIVE_SKILLS.every(
        (skill) =>
          skill.game === STAGE1_GAMEPLAY_GAME &&
          skill.stage === STAGE1_GAMEPLAY_STAGE &&
          skill.status === "active"
      )
    ).toBe(true);
  });

  it("schema-validates every active skill and resolves active rule references", () => {
    const parsedSkills = STAGE1_VIRIDIAN_ACTIVE_SKILLS.map((skill) =>
      validateStage1GameplaySkill(skill)
    );
    const activeSkillIds = new Set(parsedSkills.map((skill) => skill.id));
    const referencedSkillIds = STAGE1_VIRIDIAN_ACTIVE_RULES.flatMap((rule) =>
      rule.effects.flatMap((effect) => (effect.skillId ? [effect.skillId] : []))
    );

    expect(referencedSkillIds).toEqual(["skill:route-1.follow-north-path"]);
    expect(
      referencedSkillIds.every((skillId) => activeSkillIds.has(skillId))
    ).toBe(true);
  });

  it("keeps skill preconditions scoped to Pallet Town, Route 1, and Viridian City", () => {
    const activeMapIds = new Set<number>([
      POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      POKEMON_RED_STAGE1_MAP_IDS.route1,
      POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
    ]);
    const referencedMapIds = STAGE1_VIRIDIAN_ACTIVE_SKILLS.flatMap((skill) =>
      mapIdValuesFor(skill)
    );

    expect(referencedMapIds).toEqual(
      expect.arrayContaining([
        POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        POKEMON_RED_STAGE1_MAP_IDS.route1,
        POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      ])
    );
    expect(referencedMapIds.every((mapId) => activeMapIds.has(mapId))).toBe(
      true
    );
  });

  it("preserves supervised button-control tools and frame-native durations", () => {
    const toolCalls = STAGE1_VIRIDIAN_ACTIVE_SKILLS.flatMap((skill) =>
      skill.output.actionCandidates.map((candidate) => candidate.toolCall)
    );

    expect(toolCalls.map((toolCall) => toolCall.toolName)).toEqual(
      expect.arrayContaining(["mgba_hold", "mgba_tap"])
    );
    expect(
      toolCalls.some((toolCall) => UNSAFE_TOOL_PATTERN.test(toolCall.toolName))
    ).toBe(false);
    expect(
      toolCalls.every(
        (toolCall) =>
          toolCall.durationFrames === undefined ||
          Number.isInteger(toolCall.durationFrames)
      )
    ).toBe(true);
  });

  it("keeps optional detours and learned candidates out of active skill data", () => {
    const serialized = JSON.stringify(STAGE1_VIRIDIAN_ACTIVE_SKILLS);

    expect(
      STAGE1_VIRIDIAN_ACTIVE_SKILL_IDS.every((id) => id.startsWith("skill:"))
    ).toBe(true);
    expect(
      STAGE1_VIRIDIAN_ACTIVE_SKILL_IDS.some((id) => id.includes("candidate:"))
    ).toBe(false);
    expect(
      STAGE1_VIRIDIAN_ACTIVE_SKILLS.some((skill) => skill.status !== "active")
    ).toBe(false);
    expect(serialized).not.toMatch(OPTIONAL_DETOUR_PATTERN);
  });

  it("anchors the route-following skill to the Viridian City victory condition", () => {
    const routeSkill = STAGE1_VIRIDIAN_ACTIVE_SKILLS.find(
      (skill) => skill.id === "skill:route-1.follow-north-path"
    );

    expect(routeSkill?.output.successCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "victory-condition",
        }),
      ])
    );
    expect(JSON.stringify(routeSkill)).toContain(STAGE1_VICTORY_CONDITION);
  });
});
