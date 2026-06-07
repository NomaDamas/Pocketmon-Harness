import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { MgbaHttpClient } from "./mgba-http";

export interface ParallelHarnessInstance {
  authToken?: string;
  baseUrl: string;
  command: string;
  env: Record<string, string>;
  hypothesis: string;
  index: number;
  label: string;
  port: string;
}

export interface ParallelHarnessPlan {
  batchId: string;
  instances: ParallelHarnessInstance[];
}

const DEFAULT_COMMAND = "pnpm";
const DEFAULT_ARGS = ["dev"];
const DEFAULT_HYPOTHESES = [
  "pathfinder-first",
  "dialogue-recovery",
  "exploration-backtracking",
  "battle-safe-progress",
];
const DEFAULT_PARALLEL_RAM_UNAVAILABLE_TURNS = "1";
const POKEMON_RED_MAP_ID_ADDRESS = 0xd3_5e;
const TRAILING_SLASH_RE = /\/$/u;

if (isMainModule()) {
  const plan = await createReachableParallelHarnessPlan({
    command: process.env.POKEMON_PARALLEL_COMMAND ?? DEFAULT_COMMAND,
    endpoints: parseParallelEndpoints(process.env.POKEMON_PARALLEL_MGBA_URLS),
    ports: parseParallelPorts(process.env.POKEMON_PARALLEL_MGBA_PORTS),
  });
  runParallelHarnessPlan(plan);
}

export function parseParallelPorts(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((port) => port.trim())
    .filter(Boolean);
}

export function parseParallelEndpoints(value?: string): ParallelEndpoint[] {
  return (value ?? "")
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map(parseParallelEndpoint);
}

export interface ParallelEndpoint {
  authToken?: string;
  baseUrl: string;
  label: string;
  port: string;
}

function parseParallelEndpoint(raw: string): ParallelEndpoint {
  const [baseUrl, authToken] = raw.split("|");
  const url = new URL(baseUrl);
  return {
    authToken: authToken || undefined,
    baseUrl: url.toString().replace(TRAILING_SLASH_RE, ""),
    label: `${url.host}${url.pathname}`,
    port: url.port || (url.protocol === "https:" ? "443" : "80"),
  };
}

export function createParallelHarnessPlan({
  command = DEFAULT_COMMAND,
  batchId = process.env.PARALLEL_BATCH_ID ?? `batch-${randomUUID()}`,
  endpoints,
  hypotheses = DEFAULT_HYPOTHESES,
  ports,
}: {
  command?: string;
  batchId?: string;
  endpoints?: readonly ParallelEndpoint[];
  hypotheses?: readonly string[];
  ports: readonly string[];
}): ParallelHarnessPlan {
  const resolvedEndpoints =
    endpoints && endpoints.length > 0
      ? endpoints
      : ports.map(
          (port): ParallelEndpoint => ({
            authToken: undefined,
            baseUrl: `http://127.0.0.1:${port}`,
            label: port,
            port,
          })
        );

  if (resolvedEndpoints.length < 2) {
    throw new Error(
      "parallel gameplay requires at least two reachable independent mGBA-http ports"
    );
  }

  return {
    batchId,
    instances: resolvedEndpoints.map((endpoint, index) => {
      const hypothesis = hypotheses[index % hypotheses.length] ?? "explore";
      return {
        authToken: endpoint.authToken,
        baseUrl: endpoint.baseUrl,
        command,
        env: {
          EXPERIMENT_HYPOTHESIS: hypothesis,
          EXPERIMENT_ID: `${batchId}:parallel-${index + 1}:${hypothesis}`,
          HARNESS_MAX_RAM_UNAVAILABLE_TURNS:
            process.env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS ??
            DEFAULT_PARALLEL_RAM_UNAVAILABLE_TURNS,
          MGBA_HTTP_BASE_URL: endpoint.baseUrl,
          METRICS_HTTP_PORT: String(9464 + index),
          PARALLEL_BATCH_ID: batchId,
          POKEMON_PARALLEL_ENDPOINT_LABEL: endpoint.label,
          POKEMON_RUN_INSTANCE: String(index + 1),
          ...(endpoint.authToken
            ? { MGBA_HTTP_AUTH_TOKEN: endpoint.authToken }
            : {}),
        },
        hypothesis,
        index,
        label: `pokemon-${index + 1}:${hypothesis}`,
        port: endpoint.port,
      };
    }),
  };
}

export async function createReachableParallelHarnessPlan({
  command = DEFAULT_COMMAND,
  endpoints,
  fetchImpl = fetch,
  hypotheses = DEFAULT_HYPOTHESES,
  ports,
  requireRam = process.env.POKEMON_PARALLEL_REQUIRE_RAM !== "0",
}: {
  command?: string;
  endpoints?: readonly ParallelEndpoint[];
  fetchImpl?: typeof fetch;
  hypotheses?: readonly string[];
  ports: readonly string[];
  requireRam?: boolean;
}): Promise<ParallelHarnessPlan> {
  const candidates =
    endpoints && endpoints.length > 0
      ? endpoints
      : ports.map(
          (port): ParallelEndpoint => ({
            authToken: undefined,
            baseUrl: `http://127.0.0.1:${port}`,
            label: port,
            port,
          })
        );
  const reachableEndpoints: ParallelEndpoint[] = [];
  const skippedReasons: string[] = [];
  for (const endpoint of candidates) {
    const readiness = await probeParallelEndpoint(endpoint, fetchImpl, {
      requireRam,
    });
    if (readiness.ok) {
      reachableEndpoints.push(endpoint);
    } else {
      skippedReasons.push(`${endpoint.label}:${readiness.reason}`);
      process.stderr.write(
        `[parallel-runner] skipping mGBA endpoint ${endpoint.label}: ${readiness.reason}\n`
      );
    }
  }
  if (reachableEndpoints.length < 2) {
    throw new Error(
      `parallel gameplay requires at least two reachable independent RAM-capable mGBA endpoints for controller-primary runs; reachable=${reachableEndpoints.map((endpoint) => endpoint.label).join(",") || "none"} skipped=${skippedReasons.join(",") || "none"}`
    );
  }
  return createParallelHarnessPlan({
    command,
    endpoints: reachableEndpoints,
    hypotheses,
    ports: [],
  });
}

export function runParallelHarnessPlan(plan: ParallelHarnessPlan): void {
  const children = plan.instances.map(startInstance);

  const stop = () => {
    for (const child of children) {
      child.kill("SIGINT");
    }
  };

  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(143);
  });
}

function startInstance(instance: ParallelHarnessInstance): ChildProcess {
  const child = spawn(instance.command, DEFAULT_ARGS, {
    env: {
      ...process.env,
      ...instance.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(prefixLines(instance.label, chunk));
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(prefixLines(instance.label, chunk));
  });
  child.on("exit", (code, signal) => {
    process.stderr.write(
      `[${instance.label}] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`
    );
  });

  process.stdout.write(
    `[${instance.label}] started ${instance.command} ${DEFAULT_ARGS.join(" ")} on ${instance.env.MGBA_HTTP_BASE_URL} hypothesis=${instance.hypothesis}\n`
  );
  return child;
}

interface ParallelEndpointProbeOptions {
  requireRam: boolean;
}

interface ParallelEndpointProbeResult {
  ok: boolean;
  reason: string;
}

export async function probeParallelEndpoint(
  endpoint: ParallelEndpoint,
  fetchImpl: typeof fetch,
  { requireRam }: ParallelEndpointProbeOptions
): Promise<ParallelEndpointProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);
  try {
    const response = await fetchImpl(`${endpoint.baseUrl}/core/currentframe`, {
      headers: endpoint.authToken
        ? {
            Authorization: `Bearer ${endpoint.authToken}`,
            "X-Principal-Token": endpoint.authToken,
          }
        : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `frame-http-${response.status}` };
    }

    if (!requireRam) {
      return { ok: true, reason: "frame-ready" };
    }

    try {
      const client = new MgbaHttpClient({
        authToken: endpoint.authToken,
        baseUrl: endpoint.baseUrl,
        fetch: fetchImpl,
      });
      await client.read8(POKEMON_RED_MAP_ID_ADDRESS, controller.signal);
      return { ok: true, reason: "frame-and-ram-ready" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return {
        ok: false,
        reason: `ram-unavailable:${message.replace(/\s+/gu, " ").slice(0, 120)}`,
      };
    }
  } catch {
    return { ok: false, reason: "frame-unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

function prefixLines(label: string, chunk: unknown): string {
  return String(chunk)
    .split("\n")
    .map((line, index, lines) =>
      index === lines.length - 1 && line === "" ? "" : `[${label}] ${line}`
    )
    .join("\n");
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/parallel-runner.ts") ?? false;
}
