import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_CANDIDATES_DIR = ".pss-mgba/candidates";

if (isMainModule()) {
  const batchId = readArg("--batch");
  if (!batchId) {
    throw new Error("Usage: pnpm improve:promote -- --batch <batch-id>");
  }
  const result = await inspectPromoteCandidate(batchId);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function inspectPromoteCandidate(
  batchId: string,
  candidatesDir = DEFAULT_CANDIDATES_DIR
): Promise<{
  batchId: string;
  blocked: boolean;
  message: string;
  proposalPath: string;
  requiredNextStep: string;
}> {
  const proposalPath = join(candidatesDir, batchId, "proposal.json");
  const proposal = JSON.parse(await readFile(proposalPath, "utf8")) as {
    qaGate?: { blocked?: boolean; reasons?: string[] };
  };
  return {
    batchId,
    blocked: true,
    message: proposal.qaGate?.blocked
      ? `Promotion blocked by QA gate: ${(proposal.qaGate.reasons ?? []).join("; ")}`
      : "Promotion intentionally requires explicit code review/replay before active hierarchy files are modified.",
    proposalPath,
    requiredNextStep:
      "Run replay/tests, review proposal files, then implement a concrete patch to active rule/skill/pathfinder files in a normal code review.",
  };
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/parallel-promote.ts") ?? false;
}
