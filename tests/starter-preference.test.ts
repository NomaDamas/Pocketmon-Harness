import { describe, expect, it, vi } from "vitest";
import type { PokemonStateObservation } from "../src/pokemon-state";
import {
  DEFAULT_POKEMON_RED_STARTER_PREFERENCE,
  isOakLabStarterSelectionPosition,
  OAK_LAB_STARTER_APPROACH_POSITION,
  POKEMON_RED_STARTER_CONTROLLER_SEQUENCES,
  POKEMON_RED_STARTER_PREFERENCE_CONFIG,
  POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY,
  POKEMON_RED_STARTER_PREFERENCES,
  resolvePokemonRedCanonicalStarterTarget,
  resolvePokemonRedStarterControllerSequenceState,
  resolvePokemonRedStarterFixedControllerSequence,
  resolvePokemonRedStarterPreference,
  resolvePokemonRedStarterSelectionPlan,
  resolvePokemonRedStarterSelectionState,
  resolvePokemonRedStarterTargetSelectionMetadata,
} from "../src/starter-preference";

const oakLabState: PokemonStateObservation = {
  battle: false,
  battleResult: null,
  battleType: null,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: 40,
  menuLike: "visual-fallback",
  position: { x: 5, y: 3 },
  readStatus: "available",
};

describe("POKEMON_RED_STARTER_PREFERENCE_CONFIG", () => {
  it("defines the deterministic starter preference key with an explicit default", () => {
    expect(POKEMON_RED_STARTER_PREFERENCE_CONFIG).toEqual({
      defaultValue: "charmander",
      key: "HARNESS_STARTER_PREFERENCE",
      supportedValues: POKEMON_RED_STARTER_PREFERENCES,
    });
    expect(POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY).toBe(
      "HARNESS_STARTER_PREFERENCE"
    );
    expect(POKEMON_RED_STARTER_PREFERENCE_CONFIG.defaultValue).toBe(
      DEFAULT_POKEMON_RED_STARTER_PREFERENCE
    );
  });
});

describe("resolvePokemonRedStarterPreference", () => {
  it("uses a deterministic default when no preference is provided", () => {
    expect(resolvePokemonRedStarterPreference()).toBe(
      DEFAULT_POKEMON_RED_STARTER_PREFERENCE
    );
    expect(resolvePokemonRedStarterPreference("")).toBe(
      DEFAULT_POKEMON_RED_STARTER_PREFERENCE
    );
  });

  it("normalizes configured starter preferences", () => {
    expect(resolvePokemonRedStarterPreference(" Squirtle ")).toBe("squirtle");
  });

  it("rejects unsupported starter preferences", () => {
    expect(() => resolvePokemonRedStarterPreference("pikachu")).toThrow(
      "Unsupported Pokemon Red starter preference"
    );
  });
});

describe("resolvePokemonRedStarterSelectionState", () => {
  it("detects the configured starter state from RAM position and controller target", () => {
    expect(
      resolvePokemonRedStarterSelectionState({
        starterPreference: "charmander",
        state: {
          ...oakLabState,
          position: { x: 4, y: 2 },
        },
      })
    ).toMatchObject({
      active: true,
      phase: "starter_selection",
      reason: expect.stringContaining("RAM mapId=40 x=4 y=2"),
      waypoint: "select-starter",
    });
  });

  it("does not infer starter selection from visual fallback fields alone", () => {
    expect(
      resolvePokemonRedStarterSelectionState({
        starterPreference: "charmander",
        state: oakLabState,
      })
    ).toMatchObject({
      active: false,
      phase: "lab_before_starter",
      waypoint: "advance-oak-lab-script",
    });
  });

  it("resolves the selected starter input sequence cursor from RuntimeGameState", () => {
    expect(
      resolvePokemonRedStarterControllerSequenceState({
        starterPreference: "squirtle",
        state: {
          ...oakLabState,
          position: { x: 6, y: 3 },
        },
      })
    ).toMatchObject({
      currentPosition: {
        mapId: 40,
        x: 6,
        y: 3,
      },
      currentStep: {
        button: "Up",
        toolName: "mgba_hold",
      },
      kind: "pokemon-red-starter-selected-input-sequence",
      phase: "lab_before_starter",
      runtimeSource: "RuntimeGameState",
      selectedInputSequence: ["Right", "Up", "A", "A"],
      sequenceCursor: 1,
      target: {
        id: "oak-lab-starter-squirtle",
      },
      waypoint: "advance-oak-lab-script",
    });
  });

  it("moves the selected input sequence to the confirmation step when the RuntimeGameState prompt is open", () => {
    expect(
      resolvePokemonRedStarterControllerSequenceState({
        starterPreference: "charmander",
        state: {
          ...oakLabState,
          dialogueLike: true,
          position: { x: 4, y: 2 },
        },
      })
    ).toMatchObject({
      currentStep: {
        button: "A",
        toolName: "mgba_tap",
      },
      phase: "starter_selection",
      selectedInputSequence: ["Left", "Up", "A", "A"],
      sequenceCursor: 3,
      waypoint: "select-starter",
    });
  });

  it("recognizes any canonical Pokeball position as an Oak Lab starter selection position", () => {
    expect(
      isOakLabStarterSelectionPosition({
        ...oakLabState,
        position: { x: 6, y: 2 },
      })
    ).toBe(true);
    expect(isOakLabStarterSelectionPosition(oakLabState)).toBe(false);
  });
});

describe("resolvePokemonRedStarterSelectionPlan", () => {
  it("resolves configured starter preference into a canonical starter target", () => {
    expect(resolvePokemonRedCanonicalStarterTarget(" Squirtle ")).toEqual({
      id: "oak-lab-starter-squirtle",
      label: "right Squirtle starter",
      mapId: 40,
      preference: "squirtle",
      x: 6,
      y: 2,
    });
  });

  it("rejects unsupported starter preferences before target resolution", () => {
    expect(() => resolvePokemonRedCanonicalStarterTarget("eevee")).toThrow(
      "Unsupported Pokemon Red starter preference"
    );
  });

  it("resolves configured starter preference into deterministic target metadata", () => {
    expect(
      resolvePokemonRedStarterTargetSelectionMetadata(
        " Squirtle ",
        OAK_LAB_STARTER_APPROACH_POSITION
      )
    ).toEqual({
      approachFrom: {
        mapId: 40,
        x: 5,
        y: 3,
      },
      configKey: "HARNESS_STARTER_PREFERENCE",
      controllerMode: "deterministic",
      phase: "starter_selection",
      preference: "squirtle",
      preferenceSource: "configured",
      runtimeSource: "RuntimeGameState",
      sequenceButtons: ["Right", "Up", "A", "A"],
      target: {
        id: "oak-lab-starter-squirtle",
        label: "right Squirtle starter",
        mapId: 40,
        x: 6,
        y: 2,
      },
      waypoint: "select-starter",
    });
  });

  it("marks default starter target metadata when no preference is configured", () => {
    expect(
      resolvePokemonRedStarterSelectionPlan().targetSelection
    ).toMatchObject({
      configKey: "HARNESS_STARTER_PREFERENCE",
      controllerMode: "deterministic",
      preference: DEFAULT_POKEMON_RED_STARTER_PREFERENCE,
      preferenceSource: "default",
      runtimeSource: "RuntimeGameState",
      target: {
        id: "oak-lab-starter-charmander",
        label: "center Charmander starter",
        mapId: 40,
        x: 4,
        y: 2,
      },
    });
  });

  it("exposes fixed controller sequences for every supported configured starter", () => {
    expect(POKEMON_RED_STARTER_CONTROLLER_SEQUENCES).toEqual({
      bulbasaur: ["Left", "Left", "Left", "Up", "A", "A"],
      charmander: ["Left", "Up", "A", "A"],
      squirtle: ["Right", "Up", "A", "A"],
    });
    expect(
      resolvePokemonRedStarterFixedControllerSequence(" Squirtle ")
    ).toEqual(["Right", "Up", "A", "A"]);
  });

  it("does not use randomness when resolving starter controller inputs", () => {
    const random = vi.spyOn(Math, "random");

    expect(
      resolvePokemonRedStarterSelectionPlan(
        "bulbasaur",
        OAK_LAB_STARTER_APPROACH_POSITION
      ).sequenceButtons
    ).toEqual(["Left", "Left", "Left", "Up", "A", "A"]);
    expect(random).not.toHaveBeenCalled();

    random.mockRestore();
  });

  it("maps every configured starter preference to an explicit controller sequence", () => {
    expect(
      resolvePokemonRedStarterSelectionPlan(
        "bulbasaur",
        OAK_LAB_STARTER_APPROACH_POSITION
      )
    ).toMatchObject({
      preference: "bulbasaur",
      sequenceButtons: ["Left", "Left", "Left", "Up", "A", "A"],
      waypoint: {
        label: "left Bulbasaur starter",
        x: 2,
        y: 2,
      },
    });

    expect(
      resolvePokemonRedStarterSelectionPlan(
        "charmander",
        OAK_LAB_STARTER_APPROACH_POSITION
      )
    ).toMatchObject({
      preference: "charmander",
      sequenceButtons: ["Left", "Up", "A", "A"],
      waypoint: {
        label: "center Charmander starter",
        x: 4,
        y: 2,
      },
    });

    expect(
      resolvePokemonRedStarterSelectionPlan(
        "squirtle",
        OAK_LAB_STARTER_APPROACH_POSITION
      )
    ).toMatchObject({
      preference: "squirtle",
      sequenceButtons: ["Right", "Up", "A", "A"],
      waypoint: {
        label: "right Squirtle starter",
        x: 6,
        y: 2,
      },
    });
  });

  it("keeps the choose step explicit when already at the configured Pokeball", () => {
    expect(
      resolvePokemonRedStarterSelectionPlan("charmander", { x: 4, y: 2 })
        .sequence
    ).toEqual([
      {
        button: "A",
        reason:
          "OakLabStarterSelectionPlan: choose the center Charmander starter Pokeball.",
        toolName: "mgba_tap",
      },
      {
        button: "A",
        reason:
          "OakLabStarterSelectionPlan: confirm the center Charmander starter prompt.",
        toolName: "mgba_tap",
      },
    ]);
  });
});
