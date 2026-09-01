import { z } from "zod";

/**
 * Shared contract for the public-research vertical.
 *
 * Money, staff and project observations are deliberately represented as
 * separate rows.  A row's `comparabilityKey` is the boundary that prevents a
 * cash payment or an allocation from being silently compared with a cost or
 * a headcount from another perimeter.
 */
export const RESEARCH_PUBLIC_DATASET_ID = "public_research_investment" as const;
export const RESEARCH_PUBLIC_SCHEMA_VERSION = 1 as const;
export const RESEARCH_PUBLIC_MIN_YEAR = 2024 as const;

export const RESEARCH_PUBLIC_YEARS = [2020, 2021, 2022, 2023, 2024, 2025] as const;

export const researchScopeSchema = z.enum(["cnr", "epr", "university"]);
export type ResearchScope = z.infer<typeof researchScopeSchema>;

export const researchEntityKindSchema = z.enum([
  "system",
  "university",
  "epr",
  "cnr-department",
  "cnr-institute",
]);
export type ResearchEntityKind = z.infer<typeof researchEntityKindSchema>;

export const researchMetricSchema = z.enum([
  "fundingAllocation",
  "assessedResources",
  "cashPayment",
  "economicCost",
  "permanentHeadcount",
  "researcherHeadcount",
  "nonPermanentHeadcount",
  "researchAppointmentCount",
  "researchAppointmentGross",
  "infrastructureCost",
  "projectCount",
  "procurementAwarded",
  "procurementLiquidated",
  "projectCost",
  "projectPayment",
]);
export type ResearchMetric = z.infer<typeof researchMetricSchema>;

export const researchUnitSchema = z.enum(["euro-cents", "count", "fte"]);
export type ResearchUnit = z.infer<typeof researchUnitSchema>;

export const researchMeasureSchema = z.enum([
  "allocation",
  "assessed-budget",
  "payment",
  "cost",
  "headcount",
  "appointment",
  "infrastructure-cost",
  "project-count",
  "procurement-award",
  "procurement-payment",
  "project-cost",
  "project-payment",
]);
export type ResearchMeasure = z.infer<typeof researchMeasureSchema>;

export const researchAccountingBasisSchema = z.enum([
  "competence",
  "cash",
  "economic",
  "headcount",
  "administrative-record",
]);
export type ResearchAccountingBasis = z.infer<typeof researchAccountingBasisSchema>;

export const researchCoverageKindSchema = z.enum([
  "complete",
  "partial",
  "observed",
  "not-available",
]);
export type ResearchCoverageKind = z.infer<typeof researchCoverageKindSchema>;

const isoTimestampSchema = z.string().min(1).refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "data ISO non valida",
});

const sourceFormatSchema = z.enum([
  "api",
  "csv",
  "html",
  "json",
  "ods",
  "xls",
  "xlsx",
  "zip",
  "pdf",
  "sparql",
]);

export const researchSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  landingUrl: z.string().url(),
  format: sourceFormatSchema,
  license: z.string().min(1).nullable(),
  licenseUrl: z.string().url().nullable(),
  publishedAt: isoTimestampSchema.nullable(),
  dataAsOf: isoTimestampSchema.nullable(),
  observedAt: isoTimestampSchema,
  cadence: z.string().min(1),
  coverage: z.string().min(1),
  caveat: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict().superRefine((source, ctx) => {
  if (source.license === null && source.licenseUrl !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["licenseUrl"], message: "URL licenza senza licenza dichiarata" });
  }
  if (source.license !== null && source.licenseUrl === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["licenseUrl"], message: "URL licenza richiesto quando la licenza è dichiarata" });
  }
});
export type ResearchSource = z.infer<typeof researchSourceSchema>;

export const researchPeriodSchema = z.object({
  year: z.number().int().min(1990).max(2200),
  label: z.string().min(1),
}).strict();
export type ResearchPeriod = z.infer<typeof researchPeriodSchema>;

export const researchEntityIdentifierSchema = z.object({
  scheme: z.enum(["cnr-cds", "ipa", "fiscal-code", "istat", "custom"]),
  value: z.string().min(1),
}).strict();

export const researchEntitySchema = z.object({
  id: z.string().min(1),
  kind: researchEntityKindSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  identifiers: z.array(researchEntityIdentifierSchema).min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
}).strict();
export type ResearchEntity = z.infer<typeof researchEntitySchema>;

export const researchObservationSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  year: z.number().int().min(1990).max(2200),
  metric: researchMetricSchema,
  measure: researchMeasureSchema,
  accountingBasis: researchAccountingBasisSchema,
  unit: researchUnitSchema,
  value: z.number().nonnegative().finite(),
  comparabilityKey: z.string().min(1),
  scope: z.string().min(1),
  coverage: researchCoverageKindSchema,
  sourceIds: z.array(z.string().min(1)).min(1),
  note: z.string().min(1),
}).strict().superRefine((observation, ctx) => {
  if (observation.unit !== "fte" && !Number.isSafeInteger(observation.value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "count e importi devono essere interi sicuri" });
  }

  const expected: Record<ResearchMetric, { measure: ResearchMeasure; unit: ResearchUnit }> = {
    fundingAllocation: { measure: "allocation", unit: "euro-cents" },
    assessedResources: { measure: "assessed-budget", unit: "euro-cents" },
    cashPayment: { measure: "payment", unit: "euro-cents" },
    economicCost: { measure: "cost", unit: "euro-cents" },
    permanentHeadcount: { measure: "headcount", unit: "count" },
    researcherHeadcount: { measure: "headcount", unit: "count" },
    nonPermanentHeadcount: { measure: "headcount", unit: "count" },
    researchAppointmentCount: { measure: "appointment", unit: "count" },
    researchAppointmentGross: { measure: "appointment", unit: "euro-cents" },
    infrastructureCost: { measure: "infrastructure-cost", unit: "euro-cents" },
    projectCount: { measure: "project-count", unit: "count" },
    procurementAwarded: { measure: "procurement-award", unit: "euro-cents" },
    procurementLiquidated: { measure: "procurement-payment", unit: "euro-cents" },
    projectCost: { measure: "project-cost", unit: "euro-cents" },
    projectPayment: { measure: "project-payment", unit: "euro-cents" },
  };
  const rule = expected[observation.metric];
  if (observation.measure !== rule.measure) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["measure"], message: `Misura incoerente con ${observation.metric}` });
  }
  if (observation.unit !== rule.unit) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unit"], message: `Unità incoerente con ${observation.metric}` });
  }
  if (observation.metric === "permanentHeadcount" || observation.metric === "researcherHeadcount" || observation.metric === "nonPermanentHeadcount") {
    if (observation.accountingBasis !== "headcount") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountingBasis"], message: "Il personale deve usare la base headcount" });
    }
  }
});
export type ResearchObservation = z.infer<typeof researchObservationSchema>;

export const researchCoverageEntrySchema = z.object({
  metric: researchMetricSchema,
  kind: researchCoverageKindSchema,
  coveredEntities: z.number().int().nonnegative(),
  expectedEntities: z.number().int().positive().nullable(),
  note: z.string().min(1),
}).strict().superRefine((entry, ctx) => {
  if (entry.kind === "complete" && (entry.expectedEntities === null || entry.coveredEntities !== entry.expectedEntities)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coveredEntities"], message: "Copertura completa non riconciliata" });
  }
  if (entry.kind === "partial" && entry.expectedEntities !== null && entry.coveredEntities >= entry.expectedEntities) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coveredEntities"], message: "Copertura parziale non coerente" });
  }
});
export type ResearchCoverageEntry = z.infer<typeof researchCoverageEntrySchema>;

export const researchPublicSnapshotSchema = z.object({
  schemaVersion: z.literal(RESEARCH_PUBLIC_SCHEMA_VERSION),
  datasetId: z.literal(RESEARCH_PUBLIC_DATASET_ID),
  generatedAt: isoTimestampSchema,
  verifiedAt: isoTimestampSchema,
  periods: z.array(researchPeriodSchema).min(1),
  entities: z.array(researchEntitySchema).min(1),
  sources: z.array(researchSourceSchema).min(1),
  observations: z.array(researchObservationSchema),
  coverage: z.array(researchCoverageEntrySchema).min(1),
  methodology: z.object({
    accounting: z.string().min(1),
    comparability: z.string().min(1),
    privacy: z.string().min(1),
    scope: z.string().min(1),
  }).strict(),
}).strict();
export type ResearchPublicSnapshot = z.infer<typeof researchPublicSnapshotSchema>;

export function validateResearchPublicSnapshot(input: unknown): ResearchPublicSnapshot {
  const snapshot = researchPublicSnapshotSchema.parse(input);
  const entityIds = new Set(snapshot.entities.map((entity) => entity.id));
  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  const periodYears = new Set(snapshot.periods.map((period) => period.year));
  const metricIds = new Set(snapshot.coverage.map((entry) => entry.metric));

  if (entityIds.size !== snapshot.entities.length) throw new Error("Entità ricerca duplicate");
  if (sourceIds.size !== snapshot.sources.length) throw new Error("Fonti ricerca duplicate");
  if (periodYears.size !== snapshot.periods.length) throw new Error("Periodi ricerca duplicate");
  if (metricIds.size !== snapshot.coverage.length) throw new Error("Metriche di copertura duplicate");

  const observationKeys = new Set<string>();
  for (const observation of snapshot.observations) {
    if (!entityIds.has(observation.entityId)) throw new Error(`Entità osservazione non risolta: ${observation.entityId}`);
    if (!periodYears.has(observation.year)) throw new Error(`Anno osservazione non dichiarato: ${observation.year}`);
    if (observation.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error(`Fonte osservazione non risolta: ${observation.id}`);
    }
    const key = [observation.entityId, observation.year, observation.metric, observation.comparabilityKey].join("|");
    if (observationKeys.has(key)) throw new Error(`Osservazione ricerca duplicate: ${key}`);
    observationKeys.add(key);
  }

  for (const entity of snapshot.entities) {
    if (entity.parentId !== null && !entityIds.has(entity.parentId)) {
      throw new Error(`Parent entità non risolto: ${entity.id}`);
    }
    if (entity.parentId === entity.id) throw new Error(`Parent entità circolare: ${entity.id}`);
    if (entity.sourceIds.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error(`Fonte entità non risolta: ${entity.id}`);
    }
  }

  for (const entity of snapshot.entities) {
    const seen = new Set<string>();
    let currentId: string | null = entity.id;
    while (currentId !== null) {
      if (seen.has(currentId)) throw new Error(`Parent entità circolare: ${entity.id}`);
      seen.add(currentId);
      currentId = snapshot.entities.find((candidate) => candidate.id === currentId)?.parentId ?? null;
    }
  }

  const byMetric = new Set<ResearchMetric>();
  for (const observation of snapshot.observations) byMetric.add(observation.metric);
  for (const entry of snapshot.coverage) {
    if (entry.kind !== "not-available" && !byMetric.has(entry.metric)) {
      throw new Error(`Copertura dichiarata senza osservazioni: ${entry.metric}`);
    }
  }
  return snapshot;
}

export type ResearchComparison = { ok: true } | { ok: false; reason: string };

export function compareResearchObservations(
  left: ResearchObservation,
  right: ResearchObservation,
): ResearchComparison {
  if (left.metric !== right.metric) return { ok: false, reason: "Le metriche sono diverse." };
  if (left.year !== right.year) return { ok: false, reason: "Gli anni di riferimento sono diversi." };
  if (left.measure !== right.measure || left.unit !== right.unit) {
    return { ok: false, reason: "La misura o l’unità sono diverse." };
  }
  if (left.accountingBasis !== right.accountingBasis) {
    return { ok: false, reason: "La base contabile è diversa." };
  }
  if (left.comparabilityKey !== right.comparabilityKey || left.scope !== right.scope) {
    return { ok: false, reason: "Il perimetro di copertura è diverso." };
  }
  return { ok: true };
}
