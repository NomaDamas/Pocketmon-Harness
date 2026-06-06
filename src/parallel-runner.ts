import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

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
    baseUrl: url.toString().replace(/\/$/u, ""),
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
      : ports.map((port): ParallelEndpoint => ({
          authToken: undefined,
          baseUrl: `http://127.0.0.1:${port}`,
          label: port,
          port,
        }));

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
}: {
  command?: string;
  endpoints?: readonly ParallelEndpoint[];
  fetchImpl?: typeof fetch;
  hypotheses?: readonly string[];
  ports: readonly string[];
}): Promise<ParallelHarnessPlan> {
  const candidates =
    endpoints && endpoints.length > 0
      ? endpoints
      : ports.map((port): ParallelEndpoint => ({
          authToken: undefined,
          baseUrl: `http://127.0.0.1:${port}`,
          label: port,
          port,
        }));
  const reachableEndpoints: ParallelEndpoint[] = [];
  const skippedLabels: string[] = [];
  for (const endpoint of candidates) {
    if (await isMgbaEndpointReachable(endpoint, fetchImpl)) {
      reachableEndpoints.push(endpoint);
    } else {
      skippedLabels.push(endpoint.label);
      process.stderr.write(
        `[parallel-runner] skipping offline mGBA endpoint ${endpoint.label}\n`
      );
    }
  }
  if (reachableEndpoints.length < 2) {
    throw new Error(
      `parallel gameplay requires at least two reachable independent mGBA-http ports; reachable=${reachableEndpoints.map((endpoint) => endpoint.label).join(",") || "none"} skipped=${skippedLabels.join(",") || "none"}`
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

async function isMgbaHttpReachable(
  port: string,
  fetchImpl: typeof fetch
): Promise<boolean> {
  return isMgbaEndpointReachable(
    {
      authToken: undefined,
      baseUrl: `http://127.0.0.1:${port}`,
      label: port,
      port,
    },
    fetchImpl
  );
}

async function isMgbaEndpointReachable(
  endpoint: ParallelEndpoint,
  fetchImpl: typeof fetch
): Promise<boolean> {
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
    return response.ok;
  } catch {
    return false;
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
