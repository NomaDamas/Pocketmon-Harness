import { createEnv } from "@t3-oss/env-core";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env", quiet: true, override: false });

export const AI_PROVIDER_PRESETS = {
  grok: {
    model: "grok-4.3",
    microModel: "grok-3-mini-fast",
  },
  "openai-compatible": {
    model: "gpt-5.5",
    microModel: "gpt-5.3-codex-spark",
  },
} as const;

export type AiProviderPreset = keyof typeof AI_PROVIDER_PRESETS;

export function resolveAiRuntimeConfig({
  apiKey,
  baseURL,
  microModel,
  model,
  provider,
}: {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  microModel?: string;
  provider: AiProviderPreset;
}): {
  apiKey?: string;
  baseURL: string;
  model: string;
  microModel: string;
  provider: AiProviderPreset;
} {
  const preset = AI_PROVIDER_PRESETS[provider];
  if (!baseURL) {
    throw new Error(
      "AI_BASE_URL is required and must be provided via local environment"
    );
  }
  return {
    apiKey,
    baseURL,
    model: model ?? preset.model,
    microModel: microModel ?? preset.microModel,
    provider,
  };
}

export function resolveOptionalAiRuntimeConfig({
  apiKey,
  baseURL,
  microModel,
  model,
  provider,
}: {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  microModel?: string;
  provider?: AiProviderPreset;
}): ReturnType<typeof resolveAiRuntimeConfig> | undefined {
  if (!(baseURL || apiKey || model || microModel || provider)) {
    return;
  }
  return resolveAiRuntimeConfig({
    apiKey,
    baseURL,
    microModel,
    model,
    provider: provider ?? "openai-compatible",
  });
}

export const env = createEnv({
  server: {
    MGBA_HTTP_BASE_URL: z.url().default("http://127.0.0.1:5000"),
    MGBA_HTTP_AUTH_TOKEN: z.string().optional(),
    AI_PROVIDER: z
      .enum(["openai-compatible", "grok"])
      .default("openai-compatible"),
    AI_BASE_URL: z.url().optional(),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(1).optional(),
    AI_MICRO_MODEL: z.string().min(1).optional(),
    AI_FALLBACK_PROVIDER: z.enum(["openai-compatible", "grok"]).optional(),
    AI_FALLBACK_BASE_URL: z.url().optional(),
    AI_FALLBACK_API_KEY: z.string().optional(),
    AI_FALLBACK_MODEL: z.string().min(1).optional(),
    AI_FALLBACK_MICRO_MODEL: z.string().min(1).optional(),
    HARNESS_MAX_STEPS: z.coerce.number().int().positive().optional(),
    HARNESS_MAX_TOKENS: z.coerce.number().int().positive().optional(),
    HARNESS_MAX_TURNS: z.coerce.number().int().positive().optional(),
    HARNESS_MAX_MINUTES: z.coerce.number().positive().optional(),
    HARNESS_MAX_RAM_UNAVAILABLE_TURNS: z.coerce
      .number()
      .int()
      .positive()
      .optional(),
    METRICS_HTTP_HOST: z.string().min(1).default("0.0.0.0"),
    METRICS_HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export function getAiRuntimeConfig() {
  return resolveAiRuntimeConfig({
    apiKey: env.AI_API_KEY,
    baseURL: env.AI_BASE_URL,
    microModel: env.AI_MICRO_MODEL,
    model: env.AI_MODEL,
    provider: env.AI_PROVIDER,
  });
}

export function getMicroAiRuntimeConfig() {
  const config = getAiRuntimeConfig();
  return {
    ...config,
    model: config.microModel,
  };
}

export function getFallbackMicroAiRuntimeConfig() {
  const config = resolveOptionalAiRuntimeConfig({
    apiKey: env.AI_FALLBACK_API_KEY,
    baseURL: env.AI_FALLBACK_BASE_URL,
    microModel: env.AI_FALLBACK_MICRO_MODEL,
    model: env.AI_FALLBACK_MODEL,
    provider: env.AI_FALLBACK_PROVIDER,
  });
  return config ? { ...config, model: config.microModel } : undefined;
}
