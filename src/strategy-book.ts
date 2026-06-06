import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_IMPROVEMENT_ROOT = ".pss-mgba/improvements";
const DEFAULT_STRATEGY_BOOK_PATH = ".pss-mgba/strategy-book.json";
const PROMOTION_THRESHOLD = 5;

interface CandidateFile {
  audit?: {
    createdAt?: string;
    runId?: string;
    source?: string;
  };
  candidateId?: string;
  evidence?: string[];
  patch?: {
    action?: string;
    evaluatorGate?: string;
    minimumFailures?: number;
    recommendation?: string;
  };
  status?: string;
}

export interface StrategyBookEntry {
  action: string;
  candidateIds: string[];
  evidenceCount: number;
  lastSeenAt: string;
  promoted: boolean;
  recommendation: string;
  sourceRuns: string[];
}

export interface StrategyBook {
  generatedAt: string;
  promotionThreshold: number;
  strategies: StrategyBookEntry[];
}

if (isMainModule()) {
  const book = await updateStrategyBook();
  process.stdout.write(`${JSON.stringify(book, null, 2)}\n`);
}

export async function updateStrategyBook({
  improvementRoot = DEFAULT_IMPROVEMENT_ROOT,
  outputPath = DEFAULT_STRATEGY_BOOK_PATH,
  now = new Date(),
}: {
  improvementRoot?: string;
  now?: Date;
  outputPath?: string;
} = {}): Promise<StrategyBook> {
  const candidates = await readCandidates(improvementRoot);
  const grouped = new Map<string, StrategyBookEntry>();

  for (const candidate of candidates) {
    const action = candidate.patch?.action ?? "unknown";
    const runId = candidate.audit?.runId ?? "unknown-run";
    const recommendation =
      candidate.patch?.recommendation ?? "No recommendation recorded.";
    const previous = grouped.get(action);
    if (!previous) {
      grouped.set(action, {
        action,
        candidateIds: candidate.candidateId ? [candidate.candidateId] : [],
        evidenceCount: candidate.evidence?.length ?? 0,
        lastSeenAt: candidate.audit?.createdAt ?? now.toISOString(),
        promoted: false,
        recommendation,
        sourceRuns: [runId],
      });
      continue;
    }
    if (candidate.candidateId) {
      previous.candidateIds.push(candidate.candidateId);
    }
    previous.evidenceCount += candidate.evidence?.length ?? 0;
    previous.lastSeenAt = candidate.audit?.createdAt ?? previous.lastSeenAt;
    previous.recommendation = recommendation;
    if (!previous.sourceRuns.includes(runId)) {
      previous.sourceRuns.push(runId);
    }
  }

  const strategies = [...grouped.values()]
    .map((entry) => ({
      ...entry,
      promoted:
        entry.sourceRuns.length >= PROMOTION_THRESHOLD ||
        entry.evidenceCount >= PROMOTION_THRESHOLD,
    }))
    .sort((left, right) => right.evidenceCount - left.evidenceCount);

  const book = {
    generatedAt: now.toISOString(),
    promotionThreshold: PROMOTION_THRESHOLD,
    strategies,
  } satisfies StrategyBook;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(book, null, 2)}\n`);
  return book;
}

async function readCandidates(root: string): Promise<CandidateFile[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".candidate.json"))
      .map(async (entry) => {
        const content = await readFile(join(root, entry), "utf8");
        return JSON.parse(content) as CandidateFile;
      })
  );
  return candidates.filter((candidate) => candidate.status === "candidate");
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/strategy-book.ts") ?? false;
}
