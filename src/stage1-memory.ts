import { z } from "zod";

export const STAGE1_MEMORY_SCHEMA_VERSION =
  "pokemon-red-stage1-memory/v1" as const;
export const STAGE1_MEMORY_EXPORT_TYPE = "stage1-memory-export" as const;
export const STAGE1_MEMORY_GAME = "pokemon-red" as const;
export const STAGE1_MEMORY_STAGE = "stage1" as const;

export const MEMORY_ENTITY_KINDS = [
  "rule",
  "skill",
  "world",
  "route",
  "quest",
  "candidate",
  "override",
  "evaluator",
  "methodology",
] as const;

export const MEMORY_SCOPES = [
  "control",
  "mode",
  "navigation",
  "story",
  "battle",
  "resource",
  "route-guide",
  "world",
  "quest",
  "skill",
  "evaluator",
  "methodology",
] as const;

export const MEMORY_SOURCE_KINDS = [
  "base-guide",
  "trace-evidence",
  "evaluator",
  "qa-verdict",
  "human-override",
  "candidate-patch",
] as const;

export const MEMORY_RECORD_STATUSES = [
  "active",
  "candidate",
  "disabled",
  "rejected",
  "superseded",
] as const;

export type MemoryEntityKind = (typeof MEMORY_ENTITY_KINDS)[number];
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];
export type MemoryRecordStatus = (typeof MEMORY_RECORD_STATUSES)[number];

const memoryIdPattern =
  /^(candidate|evaluator|methodology|override|quest|route|rule|skill|world):[a-z0-9][a-z0-9._/-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/;

const isoTimestampSchema = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}, "Expected an ISO-8601 UTC timestamp");

export const memoryIdSchema = z.string().regex(memoryIdPattern, {
  message:
    "Memory IDs must be '<kind>:<slug>' using lowercase letters, numbers, '.', '_', '/', or '-'",
});

export const memoryVersionSchema = z.string().regex(versionPattern, {
  message: "Memory versions must use semantic version format",
});

export const memorySourceSchema = z
  .object({
    artifactPath: z.string().min(1).optional(),
    frame: z.number().int().nonnegative().optional(),
    kind: z.enum(MEMORY_SOURCE_KINDS),
    label: z.string().min(1),
    observedAt: isoTimestampSchema.optional(),
    traceId: z.string().min(1).optional(),
  })
  .strict();

export const frameWindowMetadataSchema = z
  .object({
    endFrame: z.number().int().nonnegative(),
    fps: z.number().positive().optional(),
    startFrame: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.endFrame >= value.startFrame, {
    message: "endFrame must be greater than or equal to startFrame",
    path: ["endFrame"],
  });

export const memoryMetadataSchema = z
  .object({
    confidence: z.number().min(0).max(1),
    createdAt: isoTimestampSchema,
    frameWindow: frameWindowMetadataSchema.optional(),
    notes: z.string().min(1).optional(),
    source: memorySourceSchema,
    tags: z.array(z.string().min(1)).default([]),
    updatedAt: isoTimestampSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.updatedAt ||
      Date.parse(value.updatedAt) >= Date.parse(value.createdAt),
    {
      message: "updatedAt must not be earlier than createdAt",
      path: ["updatedAt"],
    }
  );

export const stage1MemoryRecordSchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
    game: z.literal(STAGE1_MEMORY_GAME),
    id: memoryIdSchema,
    kind: z.enum(MEMORY_ENTITY_KINDS),
    metadata: memoryMetadataSchema,
    schemaVersion: z.literal(STAGE1_MEMORY_SCHEMA_VERSION),
    scope: z.enum(MEMORY_SCOPES),
    stage: z.literal(STAGE1_MEMORY_STAGE),
    status: z.enum(MEMORY_RECORD_STATUSES),
    version: memoryVersionSchema,
  })
  .strict()
  .refine((value) => value.id.startsWith(`${value.kind}:`), {
    message: "id prefix must match kind",
    path: ["id"],
  });

export const stage1MemoryExportSchema = z
  .object({
    exportedAt: isoTimestampSchema,
    records: z.array(stage1MemoryRecordSchema),
    schemaVersion: z.literal(STAGE1_MEMORY_SCHEMA_VERSION),
    type: z.literal(STAGE1_MEMORY_EXPORT_TYPE),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.records.map((record) => record.id)).size ===
      value.records.length,
    {
      message: "record IDs must be unique",
      path: ["records"],
    }
  );

export type MemoryId = z.infer<typeof memoryIdSchema>;
export type MemoryVersion = z.infer<typeof memoryVersionSchema>;
export type MemorySource = z.infer<typeof memorySourceSchema>;
export type FrameWindowMetadata = z.infer<typeof frameWindowMetadataSchema>;
export type MemoryMetadata = z.infer<typeof memoryMetadataSchema>;
export type Stage1MemoryRecord = z.infer<typeof stage1MemoryRecordSchema>;
export type Stage1MemoryExport = z.infer<typeof stage1MemoryExportSchema>;

export function validateStage1MemoryRecord(input: unknown): Stage1MemoryRecord {
  return stage1MemoryRecordSchema.parse(input);
}

export function validateStage1MemoryExport(input: unknown): Stage1MemoryExport {
  return stage1MemoryExportSchema.parse(input);
}

export function createStage1MemoryExport(
  records: readonly Stage1MemoryRecord[],
  exportedAt = new Date()
): Stage1MemoryExport {
  return validateStage1MemoryExport({
    exportedAt: exportedAt.toISOString(),
    records: [...records].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    schemaVersion: STAGE1_MEMORY_SCHEMA_VERSION,
    type: STAGE1_MEMORY_EXPORT_TYPE,
  });
}

export function serializeStage1MemoryExport(
  memoryExport: Stage1MemoryExport
): string {
  return `${JSON.stringify(validateStage1MemoryExport(memoryExport), null, 2)}
`;
}

export function createMemoryMetadata({
  confidence,
  createdAt = new Date(),
  frameWindow,
  notes,
  source,
  tags = [],
  updatedAt,
}: {
  confidence: number;
  createdAt?: Date;
  frameWindow?: FrameWindowMetadata;
  notes?: string;
  source: MemorySource;
  tags?: readonly string[];
  updatedAt?: Date;
}): MemoryMetadata {
  return memoryMetadataSchema.parse({
    confidence,
    createdAt: createdAt.toISOString(),
    frameWindow,
    notes,
    source,
    tags: [...tags],
    updatedAt: updatedAt?.toISOString(),
  });
}
