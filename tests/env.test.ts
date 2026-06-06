import { describe, expect, it } from "vitest";
import { AI_PROVIDER_PRESETS, resolveAiRuntimeConfig } from "../src/env";

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
