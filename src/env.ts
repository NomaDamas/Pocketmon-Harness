import { createEnv } from "@t3-oss/env-core";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv({ path: ".env", quiet: true, override: true });

export const AI_PROVIDER_PRESETS = {
  grok: {
    model: "grok-4.3",
  },
  "openai-compatible": {
    model: "gpt-5.5",
  },
} as const;

export type AiProviderPreset = keyof typeof AI_PROVIDER_PRESETS;

export function resolveAiRuntimeConfig({
  apiKey,
  baseURL,
  model,
  provider,
}: {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  provider: AiProviderPreset;
}): {
  apiKey?: string;
  baseURL: string;
  model: string;
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
    provider,
  };
}

export const env = createEnv({
  server: {
    MGBA_HTTP_BASE_URL: z.url().default("http://127.0.0.1:5000"),
    AI_PROVIDER: z
      .enum(["openai-compatible", "grok"])
      .default("openai-compatible"),
    AI_BASE_URL: z.url().optional(),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().min(1).optional(),
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
    model: env.AI_MODEL,
    provider: env.AI_PROVIDER,
  });
}
