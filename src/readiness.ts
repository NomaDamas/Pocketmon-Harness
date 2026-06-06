import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "dotenv";

const DEFAULT_MGBA_BASE_URL = "http://127.0.0.1:5000";
const DEFAULT_TRACE_ROOT = ".pss-mgba/traces";
const DEFAULT_VIEWER_URL = "http://127.0.0.1:9474";

export type ReadinessStatus = "ready" | "partial" | "blocked";

export interface ReadinessItem {
  detail: string;
  label: string;
  status: ReadinessStatus;
}

export interface HarnessReadiness {
  generatedAt: string;
  items: ReadinessItem[];
  summary: {
    blocked: number;
    partial: number;
    ready: number;
  };
}

export interface LoadHarnessReadinessOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
  traceRoot?: string;
}

if (isMainModule()) {
  config({ path: ".env", quiet: true });
  const readiness = await loadHarnessReadiness();
  process.stdout.write(`${formatHarnessReadiness(readiness)}\n`);
}

export async function loadHarnessReadiness({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  traceRoot = DEFAULT_TRACE_ROOT,
}: LoadHarnessReadinessOptions = {}): Promise<HarnessReadiness> {
  const items = await Promise.all([
    Promise.resolve(modelConfigReadiness(env)),
    romReadiness(env),
    mgbaHttpReadiness(env, fetchImpl),
    traceObserverReadiness(traceRoot),
    Promise.resolve(viewerReadiness(env)),
    Promise.resolve(selfImprovementReadiness()),
    Promise.resolve(parallelExecutionReadiness(env)),
    Promise.resolve(ralphReadiness()),
  ]);
  const summary = summarize(items);

  return {
    generatedAt: now.toISOString(),
    items,
    summary,
  };
}

export function formatHarnessReadiness(readiness: HarnessReadiness): string {
  const lines = [
    "Pokemon Harness Readiness",
    `Generated: ${readiness.generatedAt}`,
    `Summary: ready=${readiness.summary.ready} partial=${readiness.summary.partial} blocked=${readiness.summary.blocked}`,
    "",
  ];

  for (const item of readiness.items) {
    lines.push(
      `${statusIcon(item.status)} ${item.label.padEnd(24)} ${item.detail}`
    );
  }

  return lines.join("\n");
}

function modelConfigReadiness(env: NodeJS.ProcessEnv): ReadinessItem {
  const provider = env.AI_PROVIDER || "openai-compatible";
  const hasApiKey = Boolean(env.AI_API_KEY);
  const hasBaseUrl = Boolean(env.AI_BASE_URL);
  const model = env.AI_MODEL || (provider === "grok" ? "grok-4.3" : "gpt-5.5");
  const microModel =
    env.AI_MICRO_MODEL ||
    (provider === "grok" ? "grok-3-mini-fast" : "gpt-5.3-codex-spark");

  if (hasApiKey && hasBaseUrl) {
    return {
      detail: `${provider}/${model}; micro=${microModel}; API key and base URL are set locally`,
      label: "Model config",
      status: "ready",
    };
  }

  return {
    detail: `provider=${provider}; missing ${[
      hasApiKey ? "" : "AI_API_KEY",
      hasBaseUrl ? "" : "AI_BASE_URL",
    ]
      .filter(Boolean)
      .join("+")}`,
    label: "Model config",
    status: "blocked",
  };
}

async function romReadiness(env: NodeJS.ProcessEnv): Promise<ReadinessItem> {
  const romPath = env.POKEMON_ROM_PATH;
  if (!romPath) {
    return {
      detail:
        "POKEMON_ROM_PATH is not set; mGBA must be launched manually with Pokemon Red",
      label: "Pokemon Red ROM",
      status: "partial",
    };
  }

  try {
    await access(romPath);
    return {
      detail: "POKEMON_ROM_PATH exists locally",
      label: "Pokemon Red ROM",
      status: "ready",
    };
  } catch {
    return {
      detail: "POKEMON_ROM_PATH is set but the file is not readable",
      label: "Pokemon Red ROM",
      status: "blocked",
    };
  }
}

async function mgbaHttpReadiness(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch
): Promise<ReadinessItem> {
  const baseUrl = env.MGBA_HTTP_BASE_URL || DEFAULT_MGBA_BASE_URL;
  try {
    const response = await fetchImpl(new URL("/core/currentframe", baseUrl), {
      headers: env.MGBA_HTTP_AUTH_TOKEN
        ? {
            Authorization: `Bearer ${env.MGBA_HTTP_AUTH_TOKEN}`,
            "X-Principal-Token": env.MGBA_HTTP_AUTH_TOKEN,
          }
        : undefined,
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return {
        detail: `${baseUrl} responded with HTTP ${response.status}`,
        label: "mGBA HTTP",
        status: "blocked",
      };
    }
    const frame = (await response.text()).trim();
    return {
      detail: `${baseUrl} reachable; frame=${frame || "unknown"}`,
      label: "mGBA HTTP",
      status: "ready",
    };
  } catch {
    return {
      detail: `${baseUrl} is not reachable; start mGBA + mGBA-http first`,
      label: "mGBA HTTP",
      status: "blocked",
    };
  }
}

async function traceObserverReadiness(
  traceRoot: string
): Promise<ReadinessItem> {
  try {
    const runsDir = join(traceRoot, "runs");
    const entries = await readdir(runsDir);
    const runStats = await Promise.all(
      entries.map(async (entry) => {
        const entryStat = await stat(join(runsDir, entry));
        return entryStat.isDirectory() ? entry : undefined;
      })
    );
    const runCount = runStats.filter(Boolean).length;
    return {
      detail: `${runCount} trace run(s) available; TUI can poll latest run`,
      label: "Trace observer",
      status: runCount > 0 ? "ready" : "partial",
    };
  } catch {
    return {
      detail: "No trace directory yet; first harness run will create it",
      label: "Trace observer",
      status: "partial",
    };
  }
}

function viewerReadiness(env: NodeJS.ProcessEnv): ReadinessItem {
  return {
    detail: `Trace viewer is available with pnpm viewer; default ${env.VIEWER_URL || DEFAULT_VIEWER_URL}`,
    label: "Dashboard viewer",
    status: "ready",
  };
}

function selfImprovementReadiness(): ReadinessItem {
  return {
    detail:
      "Candidate generation, evaluator gates, human override, and replay scoring are implemented; automatic live promotion remains QA-gated",
    label: "Self-improvement",
    status: "partial",
  };
}

function parallelExecutionReadiness(env: NodeJS.ProcessEnv): ReadinessItem {
  const urls = (env.POKEMON_PARALLEL_MGBA_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const ports = (env.POKEMON_PARALLEL_MGBA_PORTS ?? "")
    .split(",")
    .map((port) => port.trim())
    .filter(Boolean);

  if (urls.length >= 2) {
    return {
      detail: `${urls.length} independent session URL(s) configured for parallel runs`,
      label: "Parallel execution",
      status: "ready",
    };
  }

  if (ports.length >= 2) {
    return {
      detail: `${ports.length} mGBA ports configured for parallel experiment orchestration`,
      label: "Parallel runs",
      status: "partial",
    };
  }

  return {
    detail:
      "Single live mGBA is supported now; set POKEMON_PARALLEL_MGBA_PORTS for Stage 2 multi-instance orchestration",
    label: "Parallel runs",
    status: "partial",
  };
}

function ralphReadiness(): ReadinessItem {
  return {
    detail:
      "RalphLoopRunner QA stop condition is verified; live MCP Ralph job requires exposed ouroboros_ralph tools",
    label: "Ralph loop",
    status: "partial",
  };
}

function summarize(
  items: readonly ReadinessItem[]
): HarnessReadiness["summary"] {
  return {
    blocked: items.filter((item) => item.status === "blocked").length,
    partial: items.filter((item) => item.status === "partial").length,
    ready: items.filter((item) => item.status === "ready").length,
  };
}

function statusIcon(status: ReadinessStatus): string {
  if (status === "ready") {
    return "[ready]  ";
  }
  if (status === "partial") {
    return "[partial]";
  }
  return "[blocked]";
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/readiness.ts") ?? false;
}
