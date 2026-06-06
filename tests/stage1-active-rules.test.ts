import { describe, expect, it } from "vitest";
import {
  STAGE1_ACTIVE_RULE_SOURCE,
  STAGE1_VIRIDIAN_ACTIVE_MAP_IDS,
  STAGE1_VIRIDIAN_ACTIVE_RULE_IDS,
  STAGE1_VIRIDIAN_ACTIVE_RULES,
  STAGE1_VIRIDIAN_OBJECTIVE,
  STAGE1_VIRIDIAN_REQUIRED_RULE_SCOPES,
} from "../src/stage1-active-rules";
import {
  POKEMON_RED_STAGE1_MAP_IDS,
  STAGE1_VICTORY_CONDITION,
} from "../src/stage1-evaluator";
import {
  STAGE1_GAMEPLAY_GAME,
  STAGE1_GAMEPLAY_STAGE,
  type Stage1GameplayRule,
  validateStage1GameplayRule,
} from "../src/stage1-gameplay-schema";

const UNSAFE_TOOL_PATTERN =
  /(?:^|[\s_:-])(?:reset|restart|rom|load|save|delete)(?:$|[\s_:-])/i;

function sortStrings(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function mapIdValuesFor(rule: Stage1GameplayRule) {
  return [...rule.preconditions, ...rule.trigger.conditions]
    .filter((condition) => condition.field === "state.mapId")
    .flatMap((condition) =>
      Array.isArray(condition.value) ? condition.value : [condition.value]
    )
    .filter((value): value is number => typeof value === "number");
}

describe("Stage 1 Viridian active rule data", () => {
  it("defines only the Pokemon Red Viridian City objective and active maps", () => {
    expect(STAGE1_ACTIVE_RULE_SOURCE).toBe("base-guide");
    expect(STAGE1_VIRIDIAN_OBJECTIVE).toEqual({
      description:
        "Reach Viridian City from an early-game Pokemon Red overworld state.",
      mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      victoryCondition: STAGE1_VICTORY_CONDITION,
    });
    expect(STAGE1_VIRIDIAN_ACTIVE_MAP_IDS).toEqual([
      POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      POKEMON_RED_STAGE1_MAP_IDS.route1,
      POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
    ]);
  });

  it("schema-validates every active base-guide rule", () => {
    const parsedRules = STAGE1_VIRIDIAN_ACTIVE_RULES.map((rule) =>
      validateStage1GameplayRule(rule)
    );

    expect(parsedRules).toHaveLength(9);
    expect(new Set(STAGE1_VIRIDIAN_ACTIVE_RULE_IDS).size).toBe(
      STAGE1_VIRIDIAN_ACTIVE_RULE_IDS.length
    );
    expect(
      parsedRules.every((rule) => rule.game === STAGE1_GAMEPLAY_GAME)
    ).toBe(true);
    expect(
      parsedRules.every((rule) => rule.stage === STAGE1_GAMEPLAY_STAGE)
    ).toBe(true);
    expect(
      sortStrings([...new Set(parsedRules.map((rule) => rule.scope))])
    ).toEqual(sortStrings(STAGE1_VIRIDIAN_REQUIRED_RULE_SCOPES));
  });

  it("keeps rule conditions scoped to the Pallet Town to Viridian City route", () => {
    const activeMapIds = new Set<number>(STAGE1_VIRIDIAN_ACTIVE_MAP_IDS);
    const referencedMapIds = STAGE1_VIRIDIAN_ACTIVE_RULES.flatMap((rule) =>
      mapIdValuesFor(rule)
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

  it("preserves the supervised button-control boundary", () => {
    const toolNames = STAGE1_VIRIDIAN_ACTIVE_RULES.flatMap((rule) =>
      rule.effects.flatMap((effect) =>
        effect.action ? [effect.action.toolName] : []
      )
    );

    expect(toolNames).toEqual(
      expect.arrayContaining(["mgba_hold", "mgba_tap"])
    );
    expect(
      toolNames.some((toolName) => UNSAFE_TOOL_PATTERN.test(toolName))
    ).toBe(false);
    expect(
      STAGE1_VIRIDIAN_ACTIVE_RULES.some((rule) =>
        UNSAFE_TOOL_PATTERN.test(`${rule.id} ${rule.description}`)
      )
    ).toBe(false);
  });

  it("keeps learned or candidate guide patches out of the active rule set", () => {
    expect(
      STAGE1_VIRIDIAN_ACTIVE_RULE_IDS.every((id) => id.startsWith("rule:"))
    ).toBe(true);
    expect(
      STAGE1_VIRIDIAN_ACTIVE_RULES.some((rule) =>
        rule.effects.some((effect) => effect.kind === "defer-to-human-override")
      )
    ).toBe(false);
    expect(
      STAGE1_VIRIDIAN_ACTIVE_RULES.some((rule) => rule.id.includes("candidate"))
    ).toBe(false);
  });
});
