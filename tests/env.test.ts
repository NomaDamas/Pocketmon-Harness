import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_PRESETS,
  createHarnessEnv,
  createHarnessStartupConfig,
  resolveAiRuntimeConfig,
  resolveOptionalAiRuntimeConfig,
} from "../src/env";
import {
  DEFAULT_POKEMON_RED_STARTER_PREFERENCE,
  POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY,
  POKEMON_RED_STARTER_PREFERENCES,
} from "../src/starter-preference";

describe("resolveAiRuntimeConfig", () => {
  it("uses the openai-compatible preset by default", () => {
    expect(
      resolveAiRuntimeConfig({
        baseURL: "https://example.test/v1",
        provider: "openai-compatible",
      })
    ).toMatchObject({
      baseURL: "https://example.test/v1",
      microModel: AI_PROVIDER_PRESETS["openai-compatible"].microModel,
      model: AI_PROVIDER_PRESETS["openai-compatible"].model,
      provider: "openai-compatible",
    });
  });

  it("uses the Grok preset for quick provider switching", () => {
    expect(
      resolveAiRuntimeConfig({
        baseURL: "https://example.test/v1",
        provider: "grok",
      })
    ).toMatchObject({
      baseURL: "https://example.test/v1",
      microModel: AI_PROVIDER_PRESETS.grok.microModel,
      model: AI_PROVIDER_PRESETS.grok.model,
      provider: "grok",
    });
  });

  it("requires base URL from local environment instead of committing provider URLs", () => {
    expect(() => resolveAiRuntimeConfig({ provider: "grok" })).toThrow(
      "AI_BASE_URL is required"
    );
  });

  it("lets explicit base URL and model values override a preset", () => {
    expect(
      resolveAiRuntimeConfig({
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
        microModel: "fast-model",
        model: "custom-model",
        provider: "grok",
      })
    ).toEqual({
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
      microModel: "fast-model",
      model: "custom-model",
      provider: "grok",
    });
  });
});

describe("resolveOptionalAiRuntimeConfig", () => {
  it("returns undefined when fallback config is not provided", () => {
    expect(resolveOptionalAiRuntimeConfig({})).toBeUndefined();
  });

  it("resolves fallback config without exposing local secrets", () => {
    expect(
      resolveOptionalAiRuntimeConfig({
        apiKey: "fallback-key",
        baseURL: "https://fallback.example.test/v1",
        microModel: "fallback-fast",
        model: "fallback-strong",
      })
    ).toEqual({
      apiKey: "fallback-key",
      baseURL: "https://fallback.example.test/v1",
      microModel: "fallback-fast",
      model: "fallback-strong",
      provider: "openai-compatible",
    });
  });
});

describe("HARNESS_STARTER_PREFERENCE", () => {
  it("defaults to the deterministic Pokemon Red starter preference", () => {
    expect(createHarnessEnv({}).HARNESS_STARTER_PREFERENCE).toBe(
      DEFAULT_POKEMON_RED_STARTER_PREFERENCE
    );
  });

  it("normalizes every configured supported starter option", () => {
    for (const starterPreference of POKEMON_RED_STARTER_PREFERENCES) {
      expect(
        createHarnessEnv({
          [POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY]: ` ${starterPreference.toUpperCase()} `,
        }).HARNESS_STARTER_PREFERENCE
      ).toBe(starterPreference);
    }
  });

  it("rejects configured starter options outside Pokemon Red support", () => {
    expect(() =>
      createHarnessEnv({
        HARNESS_STARTER_PREFERENCE: "pikachu",
      })
    ).toThrow();
  });

  it("loads the resolved starter preference into startup config", () => {
    const harnessEnv = createHarnessEnv({
      [POKEMON_RED_STARTER_PREFERENCE_CONFIG_KEY]: "SQUIRTLE",
    });

    expect(createHarnessStartupConfig(harnessEnv)).toEqual({
      starterPreference: "squirtle",
      starterTarget: {
        id: "oak-lab-starter-squirtle",
        label: "right Squirtle starter",
        mapId: 40,
        preference: "squirtle",
        x: 6,
        y: 2,
      },
    });
  });
});
