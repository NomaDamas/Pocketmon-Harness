import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_IMPROVEMENT_ROOT = ".pss-mgba/improvements";
const MAX_HINTS = 4;

export async function readLatestImprovementHints({
  improvementRoot = DEFAULT_IMPROVEMENT_ROOT,
}: {
  improvementRoot?: string;
} = {}): Promise<string[]> {
  try {
    const entries = (await readdir(improvementRoot))
      .filter((entry) => entry.endsWith(".candidate.json"))
      .sort();
    const latest = entries.at(-1);
    if (!latest) {
      return [];
    }
    const candidate = JSON.parse(
      await readFile(join(improvementRoot, latest), "utf8")
    ) as {
      evidence?: unknown;
      patch?: { recommendation?: unknown };
    };
    return [
      typeof candidate.patch?.recommendation === "string"
        ? candidate.patch.recommendation
        : undefined,
      ...evidenceHints(candidate.evidence),
    ]
      .filter((hint): hint is string => typeof hint === "string")
      .slice(0, MAX_HINTS);
  } catch {
    return [];
  }
}

function evidenceHints(evidence: unknown): string[] {
  if (!Array.isArray(evidence)) {
    return [];
  }
  return evidence
    .filter((item): item is string => typeof item === "string")
    .filter(
      (item) =>
        item.startsWith("sameState=") ||
        item.startsWith("observationCount=") ||
        item.startsWith("uniqueActionCount=")
    );
}
