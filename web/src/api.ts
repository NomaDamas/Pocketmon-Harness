import type {
  StrategyBook,
  TokenUsageMetric,
  ViewerEmulatorSlot,
  ViewerEvent,
  ViewerRun,
} from "./types";

export function fetchEmulators(
  signal?: AbortSignal
): Promise<ViewerEmulatorSlot[]> {
  return fetchJson<ViewerEmulatorSlot[]>("/api/emulators", signal);
}

export function fetchRuns(signal?: AbortSignal): Promise<ViewerRun[]> {
  return fetchJson<ViewerRun[]>("/api/runs", signal);
}

export function fetchStrategyBook(signal?: AbortSignal): Promise<StrategyBook> {
  return fetchJson<StrategyBook>("/api/strategy-book", signal);
}

export function fetchRunEvents(
  runId: string,
  signal?: AbortSignal
): Promise<ViewerEvent[]> {
  return fetchJson<ViewerEvent[]>(apiRunPath(runId, "events"), signal);
}

export function fetchRunTokens(
  runId: string,
  signal?: AbortSignal
): Promise<TokenUsageMetric[]> {
  return fetchJson<TokenUsageMetric[]>(apiRunPath(runId, "tokens"), signal);
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      message || `Request failed: ${response.status} ${response.statusText}`
    );
  }
  return (await response.json()) as T;
}

function apiRunPath(runId: string, resource: "events" | "tokens"): string {
  return `/api/runs/${encodeURIComponent(runId)}/${resource}`;
}
