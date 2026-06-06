import { startViewerServer } from "./viewer-server";

const DEFAULT_VIEWER_HOST = "127.0.0.1";
const DEFAULT_VIEWER_PORT = 9474;
const DEFAULT_VIEWER_RUNS_DIR = ".pss-mgba/traces/runs";
const DEFAULT_VIEWER_STATIC_DIR = "web/dist";

startViewerServer({
  emulatorAuthTokens: parseList(process.env.VIEWER_EMULATOR_AUTH_TOKENS),
  emulatorPorts: parsePorts(process.env.VIEWER_EMULATOR_PORTS),
  emulatorUrls: parseList(process.env.VIEWER_EMULATOR_URLS),
  host: process.env.VIEWER_HTTP_HOST ?? DEFAULT_VIEWER_HOST,
  port: Number.parseInt(
    process.env.VIEWER_HTTP_PORT ?? String(DEFAULT_VIEWER_PORT),
    10
  ),
  runsDir: process.env.VIEWER_RUNS_DIR ?? DEFAULT_VIEWER_RUNS_DIR,
  staticDir: process.env.VIEWER_STATIC_DIR ?? DEFAULT_VIEWER_STATIC_DIR,
});

function parsePorts(value: string | undefined): number[] {
  return (value ?? "5000,5001,5002")
    .split(",")
    .map((port) => Number.parseInt(port.trim(), 10))
    .filter((port) => Number.isInteger(port) && port > 0);
}

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
