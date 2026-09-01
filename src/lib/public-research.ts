import "server-only";

import rawSnapshot from "@/data/generated/public-research-snapshot.json";
import {
  RESEARCH_PUBLIC_DATASET_ID,
  RESEARCH_PUBLIC_MIN_YEAR,
  researchEntityKindSchema,
  researchScopeSchema,
  compareResearchObservations,
  validateResearchPublicSnapshot,
  type ResearchEntity,
  type ResearchEntityKind,
  type ResearchMetric,
  type ResearchObservation,
  type ResearchCoverageKind,
  type ResearchPublicSnapshot,
  type ResearchScope,
} from "@/lib/data/research-public-contract";

export const PUBLIC_RESEARCH_ALL = "all" as const;
export const PUBLIC_RESEARCH_DEFAULT_YEAR = RESEARCH_PUBLIC_MIN_YEAR;
export const PUBLIC_RESEARCH_CURRENT_STAFF_YEAR = 2025;
export const PUBLIC_RESEARCH_SCOPES = ["cnr", "epr", "university"] as const satisfies readonly ResearchScope[];

export type PublicResearchFilters = Readonly<{
  year?: string | number;
  scope?: string;
  entity?: string;
  entityKind?: string;
  department?: string;
  institute?: string;
  metric?: string;
  compare?: string;
}>;

export type PublicResearchDatasetQuery = Readonly<PublicResearchFilters & {
  dataset?: string;
  limit?: number;
  offset?: number;
}>;

export type PublicResearchEntityOption = Readonly<Pick<ResearchEntity, "id" | "code" | "name" | "kind" | "parentId">>;

export type PublicResearchScopeOption = Readonly<{
  id: ResearchScope;
  label: string;
  description: string;
}>;

export type PublicResearchScopeCoverage = Readonly<{
  scope: ResearchScope;
  coveredEntities: number;
  expectedEntities: number;
  coverage: ResearchPublicSnapshot["coverage"];
  sources: ResearchPublicSnapshot["sources"];
}>;

export type PublicResearchDerivedIndicator = Readonly<{
  id: "fundingPerResearcher" | "nonPermanentShare" | "fundingYearOverYear";
  label: string;
  value: number | null;
  unit: "euro-cents-per-person" | "ratio" | "percent";
  year: number;
  status: "available" | "not-available";
  formula: string;
  note: string;
}>;

export type PublicResearchComparisonRow = Readonly<{
  entity: PublicResearchEntityOption;
  observation: ResearchObservation | null;
  value: number | null;
}>;

export type PublicResearchSummary = Readonly<{
  fundingAllocation: ResearchObservation[];
  assessedResources: ResearchObservation[];
  permanentHeadcount: ResearchObservation[];
  researcherHeadcount: ResearchObservation[];
  nonPermanentHeadcount: ResearchObservation[];
  researchAppointmentCount: ResearchObservation[];
  infrastructureCost: ResearchObservation[];
  projectCount: ResearchObservation[];
}>;

export type PublicResearchView = Readonly<{
  year: number;
  scope: ResearchScope;
  staffYear: number | null;
  selectedEntity: PublicResearchEntityOption;
  summary: PublicResearchSummary;
  derivedIndicators: PublicResearchDerivedIndicator[];
  comparisonMetric: ResearchMetric | null;
  comparisonOptions: PublicResearchEntityOption[];
  comparisonRows: PublicResearchComparisonRow[];
  fundingTrend: ResearchObservation[];
  assessedTrend: ResearchObservation[];
  universityTrend: ResearchObservation[];
  cnrDepartment: PublicResearchEntityOption | null;
  cnrInstitutes: PublicResearchEntityOption[];
  cnrInstituteRows: Array<PublicResearchEntityOption & {
    permanentHeadcount: number | null;
    researchAppointmentCount: number | null;
    fundingAllocation: number | null;
    assessedResources: number | null;
    researcherHeadcount: number | null;
    infrastructureCost: number | null;
    projectCount: number | null;
  }>;
  periods: ResearchPublicSnapshot["periods"];
  scopeOptions: PublicResearchScopeOption[];
  scopeEntityOptions: PublicResearchEntityOption[];
  entityOptions: PublicResearchEntityOption[];
  departmentOptions: PublicResearchEntityOption[];
  instituteOptions: PublicResearchEntityOption[];
  sources: ResearchPublicSnapshot["sources"];
  coverage: ResearchPublicSnapshot["coverage"];
  scopeCoverage: PublicResearchScopeCoverage;
  methodology: ResearchPublicSnapshot["methodology"];
}>;

export const publicResearchSnapshot: ResearchPublicSnapshot = validateResearchPublicSnapshot(rawSnapshot);

const entityById = new Map(publicResearchSnapshot.entities.map((entity) => [entity.id, entity]));
const periodByYear = new Map(publicResearchSnapshot.periods.map((period) => [period.year, period]));
const metricLabels: Record<ResearchMetric, string> = {
  fundingAllocation: "Finanziamento assegnato",
  assessedResources: "Risorse assestate",
  cashPayment: "Pagamenti di cassa",
  economicCost: "Costo economico",
  permanentHeadcount: "Personale strutturato",
  researcherHeadcount: "Ricercatori",
  nonPermanentHeadcount: "Personale non strutturato",
  researchAppointmentCount: "Assegni e borse osservati",
  researchAppointmentGross: "Compensi assegni e borse",
  infrastructureCost: "Risorse infrastrutture di ricerca",
  projectCount: "Progetti osservati",
  procurementAwarded: "Appalti aggiudicati",
  procurementLiquidated: "Appalti liquidati",
  projectCost: "Costo progetti",
  projectPayment: "Pagamenti progetti",
};

const scopeLabels: Record<ResearchScope, PublicResearchScopeOption> = {
  cnr: {
    id: "cnr",
    label: "CNR",
    description: "Consiglio Nazionale delle Ricerche, dipartimenti e istituti.",
  },
  epr: {
    id: "epr",
    label: "Altri enti di ricerca",
    description: "Enti pubblici di ricerca diversi dal CNR.",
  },
  university: {
    id: "university",
    label: "Università",
    description: "Atenei presenti nelle serie USTAT.",
  },
};

function normalized(value: string | number | undefined): string {
  return String(value ?? "").trim().toLocaleLowerCase("it-IT");
}

function entityOption(entity: ResearchEntity): PublicResearchEntityOption {
  return {
    id: entity.id,
    code: entity.code,
    name: entity.name,
    kind: entity.kind,
    parentId: entity.parentId,
  };
}

export function publicResearchScopeOptions(): PublicResearchScopeOption[] {
  return PUBLIC_RESEARCH_SCOPES.map((scope) => scopeLabels[scope]);
}

export function publicResearchScopeForEntity(entity: Pick<ResearchEntity, "id" | "kind">): ResearchScope | null {
  if (entity.kind === "university") return "university";
  if (entity.kind === "cnr-department" || entity.kind === "cnr-institute") return "cnr";
  if (entity.kind === "epr") return entity.id === "epr-cnr" ? "cnr" : "epr";
  return null;
}

function entitiesForScope(scope: ResearchScope): ResearchEntity[] {
  return publicResearchSnapshot.entities.filter((entity) => publicResearchScopeForEntity(entity) === scope);
}

function descendantsOf(entityId: string): Set<string> {
  const ids = new Set<string>([entityId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entity of publicResearchSnapshot.entities) {
      if (entity.parentId && ids.has(entity.parentId) && !ids.has(entity.id)) {
        ids.add(entity.id);
        changed = true;
      }
    }
  }
  return ids;
}

function scopeEntityIds(scope: ResearchScope): Set<string> {
  const ids = new Set<string>();
  for (const entity of entitiesForScope(scope)) {
    for (const descendant of descendantsOf(entity.id)) ids.add(descendant);
  }
  return ids;
}

const scopeEntityKinds: Record<ResearchScope, readonly ResearchEntityKind[]> = {
  cnr: ["epr", "cnr-department", "cnr-institute"],
  epr: ["epr"],
  university: ["system", "university"],
};

function isEntityInScope(entity: ResearchEntity, scope: ResearchScope): boolean {
  return publicResearchScopeForEntity(entity) === scope || (scope === "university" && entity.id === "research-system");
}

function resolveEntity(value: string | undefined, allowedKinds?: readonly ResearchEntityKind[]): ResearchEntity | null {
  const query = normalized(value);
  if (!query || query === PUBLIC_RESEARCH_ALL) return null;
  const candidates = publicResearchSnapshot.entities.filter((entity) => !allowedKinds || allowedKinds.includes(entity.kind));
  const found = candidates.find((entity) => {
    const aliases = [entity.id, entity.code, entity.name];
    if (entity.kind === "cnr-department") aliases.push(entity.id.replace("cnr-department-", ""));
    return aliases.some((candidate) => normalized(candidate) === query);
  });
  return found ?? null;
}

function observationKey(row: ResearchObservation): string {
  return [row.entityId, row.year, row.metric, row.measure, row.accountingBasis, row.unit, row.comparabilityKey, row.scope].join("|");
}

function aggregateRows(rows: readonly ResearchObservation[], targetEntityId?: string): ResearchObservation[] {
  const aggregates = new Map<string, ResearchObservation>();
  for (const row of rows) {
    const key = targetEntityId ? [targetEntityId, row.year, row.metric, row.measure, row.accountingBasis, row.unit, row.comparabilityKey, row.scope].join("|") : observationKey(row);
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, targetEntityId ? { ...row, entityId: targetEntityId, id: `${targetEntityId}-${row.year}-${row.metric}-${row.comparabilityKey}` } : { ...row });
      continue;
    }
    aggregates.set(key, { ...existing, value: existing.value + row.value });
  }
  return [...aggregates.values()];
}

function directOrDescendantRows(
  entity: ResearchEntity,
  year: number,
  metric: ResearchMetric,
  scope: ResearchScope,
): ResearchObservation[] {
  const direct = publicResearchSnapshot.observations.filter((row) => row.entityId === entity.id && row.year === year && row.metric === metric);
  if (direct.length > 0) return direct;
  // A CNR department's sheets can be summed into a department observation.
  // The CNR root is intentionally excluded: DSB is not the CNR total.
  const canAggregateDescendants = (scope === "cnr" && entity.kind === "cnr-department")
    || (scope === "university" && entity.id === "research-system");
  if (!canAggregateDescendants) return [];
  const descendants = descendantsOf(entity.id);
  const scopedIds = scopeEntityIds(scope);
  return aggregateRows(publicResearchSnapshot.observations.filter((row) => descendants.has(row.entityId) && scopedIds.has(row.entityId) && row.year === year && row.metric === metric), entity.id);
}

function comparisonMetricFor(scope: ResearchScope, entity: ResearchEntity): ResearchMetric | null {
  if (scope === "epr") return "fundingAllocation";
  if (scope === "university") return "permanentHeadcount";
  if (entity.kind === "cnr-department" || entity.kind === "cnr-institute") return "assessedResources";
  return "fundingAllocation";
}

function comparisonCandidates(scope: ResearchScope, entity: ResearchEntity, year: number, metric: ResearchMetric): ResearchEntity[] {
  const candidates = scope === "epr"
    ? entitiesForScope("epr")
    : scope === "university"
      ? entitiesForScope("university")
      : entity.kind === "cnr-department"
        ? publicResearchSnapshot.entities.filter((candidate) => candidate.kind === "cnr-institute" && candidate.parentId === entity.id)
        : entity.kind === "cnr-institute" && entity.parentId
          ? publicResearchSnapshot.entities.filter((candidate) => candidate.kind === "cnr-institute" && candidate.parentId === entity.parentId)
          : [entity];
  return candidates.filter((candidate) => {
    const rows = directOrDescendantRows(candidate, year, metric, scope);
    return rows.length === 1 && numericValue(rows) !== null;
  });
}

function buildComparisonRows(
  candidates: readonly ResearchEntity[],
  requested: string | undefined,
  selectedEntity: ResearchEntity,
  year: number,
  metric: ResearchMetric,
  scope: ResearchScope,
): PublicResearchComparisonRow[] {
  const byAlias = new Map(candidates.flatMap((candidate) => [
    [candidate.id.toLocaleLowerCase("it-IT"), candidate],
    [candidate.code.toLocaleLowerCase("it-IT"), candidate],
  ]));
  const requestedEntities = (requested ?? "").split(",")
    .map((value) => byAlias.get(value.trim().toLocaleLowerCase("it-IT")))
    .filter((candidate): candidate is ResearchEntity => Boolean(candidate));
  const selected = candidates.find((candidate) => candidate.id === selectedEntity.id);
  const seed = requestedEntities.length >= 2 ? [] : [selected];
  const chosen = [...new Set([...seed, ...requestedEntities, ...candidates])].filter((candidate): candidate is ResearchEntity => Boolean(candidate)).slice(0, 3);
  const rows = chosen.map((candidate) => {
    const observations = directOrDescendantRows(candidate, year, metric, scope);
    return {
      entity: entityOption(candidate),
      observation: observations.length === 1 ? observations[0]! : null,
      value: observations.length === 1 ? numericValue(observations) : null,
    };
  });
  const comparable = rows.every((row) => row.observation !== null)
    && rows.slice(1).every((row) => compareResearchObservations(rows[0]!.observation!, row.observation!).ok);
  return comparable ? rows : [];
}

function currentStaffRows(entity: ResearchEntity, metric: ResearchMetric, scope: ResearchScope, year: number): ResearchObservation[] {
  if (scope === "university") return directOrDescendantRows(entity, year, metric, scope);
  if (scope !== "cnr") return [];
  return directOrDescendantRows(entity, PUBLIC_RESEARCH_CURRENT_STAFF_YEAR, metric, scope);
}

function numericValue(rows: readonly ResearchObservation[]): number | null {
  if (rows.length === 0) return null;
  const comparability = new Set(rows.map((row) => [row.measure, row.accountingBasis, row.unit, row.comparabilityKey, row.scope].join("|")));
  if (comparability.size !== 1) return null;
  return rows.reduce((total, row) => total + row.value, 0);
}

function observationsForScope(scope: ResearchScope): ResearchObservation[] {
  const ids = scopeEntityIds(scope);
  return publicResearchSnapshot.observations.filter((row) => ids.has(row.entityId));
}

const scopeMetrics: Record<ResearchScope, readonly ResearchMetric[]> = {
  cnr: ["fundingAllocation", "assessedResources", "permanentHeadcount", "researcherHeadcount", "researchAppointmentCount", "infrastructureCost", "projectCount"],
  epr: ["fundingAllocation"],
  university: ["permanentHeadcount", "researcherHeadcount", "nonPermanentHeadcount"],
};

function scopedCoverage(scope: ResearchScope): PublicResearchScopeCoverage {
  const entities = entitiesForScope(scope);
  const observations = observationsForScope(scope);
  const relevantMetrics = new Set(scopeMetrics[scope]);
  const coverage = publicResearchSnapshot.coverage
    .filter((entry) => relevantMetrics.has(entry.metric))
    .map((entry) => {
      const coveredEntities = new Set(observations.filter((row) => row.metric === entry.metric).map((row) => row.entityId)).size;
      const expectedEntities = entry.metric === "fundingAllocation" && scope === "cnr"
        ? 1
        : scope === "cnr" && entry.metric !== "projectCount"
          ? 83
          : entities.length;
      const kind: ResearchCoverageKind = coveredEntities === 0
        ? "not-available"
        : coveredEntities === expectedEntities
          ? "complete"
          : entry.metric === "fundingAllocation" || entry.metric === "assessedResources"
            ? "observed"
            : "partial";
      return { ...entry, kind, coveredEntities, expectedEntities };
    });
  const sourcesById = new Map(publicResearchSnapshot.sources.map((source) => [source.id, source]));
  const sourceIds = new Set([
    ...entities.flatMap((entity) => entity.sourceIds),
    ...observations.flatMap((row) => row.sourceIds),
  ]);
  const sources = [...sourceIds].map((sourceId) => sourcesById.get(sourceId)).filter((source): source is ResearchPublicSnapshot["sources"][number] => Boolean(source));
  return {
    scope,
    coveredEntities: new Set(observations.map((row) => row.entityId)).size,
    expectedEntities: entities.length,
    coverage,
    sources,
  };
}

function valueFor(rows: readonly ResearchObservation[], metric: ResearchMetric): number | null {
  return numericValue(rows.filter((row) => row.metric === metric));
}

function derivedIndicators(
  scope: ResearchScope,
  year: number,
  selectedEntity: ResearchEntity,
  summary: PublicResearchSummary,
): PublicResearchDerivedIndicator[] {
  const funding = valueFor(summary.fundingAllocation.filter((row) => row.year === year), "fundingAllocation");
  const researchers = valueFor(summary.researcherHeadcount.filter((row) => row.year === year), "researcherHeadcount");
  const permanent = valueFor(summary.permanentHeadcount, "permanentHeadcount");
  const nonPermanent = valueFor(summary.nonPermanentHeadcount, "nonPermanentHeadcount")
    ?? valueFor(summary.researchAppointmentCount, "researchAppointmentCount");
  const staffYears = new Set([
    ...summary.permanentHeadcount.map((row) => row.year),
    ...summary.nonPermanentHeadcount.map((row) => row.year),
    ...summary.researchAppointmentCount.map((row) => row.year),
  ]);
  const ratioYear = staffYears.size === 1 ? [...staffYears][0]! : year;
  const previous = publicResearchSnapshot.observations.find((row) => row.entityId === selectedEntity.id && row.year === year - 1 && row.metric === "fundingAllocation");
  const current = publicResearchSnapshot.observations.find((row) => row.entityId === selectedEntity.id && row.year === year && row.metric === "fundingAllocation");
  const ratioValue = nonPermanent !== null && permanent && permanent > 0 ? (nonPermanent / permanent) * 100 : null;
  const fundingChange = current && previous && previous.value > 0 ? ((current.value - previous.value) / previous.value) * 100 : null;
  return [
    {
      id: "fundingPerResearcher",
      label: "Finanziamento per ricercatore",
      value: funding !== null && researchers !== null && researchers > 0 ? funding / researchers : null,
      unit: "euro-cents-per-person",
      year,
      status: funding !== null && researchers !== null && researchers > 0 ? "available" : "not-available",
      formula: "finanziamento assegnato / ricercatori",
      note: scope === "cnr" && selectedEntity.code === "CNR" ? "n.d.: il CNR non ha un totale ricercatori osservato nello snapshot." : "Solo quando numeratore e denominatore hanno lo stesso ente e anno.",
    },
    {
      id: "nonPermanentShare",
      label: "Quota non permanente",
      value: ratioValue,
      unit: "percent",
      year: ratioYear,
      status: ratioValue === null ? "not-available" : "available",
      formula: "personale non permanente / personale permanente × 100",
      note: scope === "cnr" ? "Per gli istituti DSB usa assegni/borse osservati come proxy descrittiva, non come totale del precariato." : "Le categorie restano quelle pubblicate dalla fonte.",
    },
    {
      id: "fundingYearOverYear",
      label: "Variazione FOE sull'anno precedente",
      value: fundingChange,
      unit: "percent",
      year,
      status: fundingChange === null ? "not-available" : "available",
      formula: "(FOE anno corrente − FOE anno precedente) / FOE anno precedente × 100",
      note: "Confronto di competenza tra due assegnazioni FOE dello stesso ente.",
    },
  ];
}

export function publicResearchMetricLabel(metric: ResearchMetric): string {
  return metricLabels[metric];
}

export function publicResearchEntityOptions(): PublicResearchEntityOption[] {
  return publicResearchSnapshot.entities.map(entityOption);
}

export function publicResearchScopeEntityOptions(scope: ResearchScope): PublicResearchEntityOption[] {
  return entitiesForScope(scope).map(entityOption);
}

export function publicResearchDepartmentOptions(): PublicResearchEntityOption[] {
  return publicResearchSnapshot.entities.filter((entity) => entity.kind === "cnr-department").map(entityOption);
}

export function publicResearchInstituteOptions(): PublicResearchEntityOption[] {
  return publicResearchSnapshot.entities.filter((entity) => entity.kind === "cnr-institute").map(entityOption);
}

export function publicResearchYearOptions() {
  return publicResearchSnapshot.periods.filter((period) => period.year >= RESEARCH_PUBLIC_MIN_YEAR);
}

export function publicResearchHistoricalYearOptions() {
  return publicResearchSnapshot.periods;
}

export function normalizePublicResearchFilters(filters: PublicResearchFilters = {}) {
  const requestedYear = Number(filters.year);
  const year = Number.isInteger(requestedYear) && periodByYear.has(requestedYear)
    ? requestedYear
    : PUBLIC_RESEARCH_DEFAULT_YEAR;
  const selectedEntity = resolveEntity(filters.entity);
  if (filters.entity && normalized(filters.entity) !== PUBLIC_RESEARCH_ALL && !selectedEntity) {
    throw new Error(`Ente ricerca non trovato: ${filters.entity}.`);
  }
  const department = resolveEntity(filters.department, ["cnr-department"]);
  if (filters.department && normalized(filters.department) !== PUBLIC_RESEARCH_ALL && !department) {
    throw new Error(`Dipartimento CNR non trovato: ${filters.department}.`);
  }
  const institute = resolveEntity(filters.institute, ["cnr-institute"]);
  if (filters.institute && normalized(filters.institute) !== PUBLIC_RESEARCH_ALL && !institute) {
    throw new Error(`Istituto CNR non trovato: ${filters.institute}.`);
  }
  if (department && institute && institute.parentId !== department.id) {
    throw new Error(`Istituto ${institute.code} non appartiene al dipartimento ${department.code}.`);
  }
  const entityKind = filters.entityKind && normalized(filters.entityKind) !== PUBLIC_RESEARCH_ALL
    ? normalized(filters.entityKind)
    : null;
  if (entityKind && !researchEntityKindSchema.safeParse(entityKind).success) {
    throw new Error(`Tipo di ente ricerca non riconosciuto: ${filters.entityKind}.`);
  }
  const requestedScope = filters.scope && normalized(filters.scope) !== PUBLIC_RESEARCH_ALL
    ? researchScopeSchema.safeParse(normalized(filters.scope)).success ? normalized(filters.scope) as ResearchScope : null
    : null;
  if (filters.scope && normalized(filters.scope) !== PUBLIC_RESEARCH_ALL && !requestedScope) {
    throw new Error(`Ambito ricerca non riconosciuto: ${filters.scope}.`);
  }
  const inferredScope = requestedScope
    ?? (institute || department ? "cnr" : selectedEntity ? publicResearchScopeForEntity(selectedEntity) : null)
    ?? (normalized(filters.entityKind) === "university" ? "university" : normalized(filters.entityKind) === "epr" ? "epr" : "cnr");
  if (selectedEntity && !isEntityInScope(selectedEntity, inferredScope)) {
    throw new Error(`Ente ${selectedEntity.code} non appartiene all'ambito ${inferredScope}.`);
  }
  if (entityKind && !scopeEntityKinds[inferredScope].includes(entityKind as ResearchEntityKind)) {
    throw new Error(`Tipo di ente ${entityKind} non appartiene all'ambito ${inferredScope}.`);
  }
  const comparisonCount = (filters.compare ?? "").split(",").map((value) => value.trim()).filter(Boolean).length;
  if (comparisonCount > 3) throw new Error("Il confronto ricerca può includere al massimo tre entità.");
  if (institute && inferredScope !== "cnr") throw new Error("Gli istituti CNR richiedono l'ambito cnr.");
  if (department && inferredScope !== "cnr") throw new Error("I dipartimenti CNR richiedono l'ambito cnr.");
  const metric = filters.metric && normalized(filters.metric) !== PUBLIC_RESEARCH_ALL
    ? Object.hasOwn(metricLabels, filters.metric as ResearchMetric) ? filters.metric as ResearchMetric : null
    : null;
  if (filters.metric && normalized(filters.metric) !== PUBLIC_RESEARCH_ALL && !metric) {
    throw new Error(`Metrica ricerca non riconosciuta: ${filters.metric}.`);
  }
  return { year, scope: inferredScope, selectedEntity, entityKind, department, institute, metric, compare: filters.compare } as const;
}

export function getPublicResearchView(filters: PublicResearchFilters = {}): PublicResearchView {
  const normalizedFilters = normalizePublicResearchFilters(filters);
  const defaultEntity = normalizedFilters.scope === "cnr"
    ? entityById.get("epr-cnr")
    : normalizedFilters.scope === "epr"
      ? entitiesForScope("epr").find((entity) => entity.kind === "epr")
      : entityById.get("research-system");
  const selectedEntity = normalizedFilters.institute
    ?? normalizedFilters.department
    ?? normalizedFilters.selectedEntity
    ?? defaultEntity
    ?? publicResearchSnapshot.entities[0]!;
  const selectedDepartment = selectedEntity.kind === "cnr-institute" && selectedEntity.parentId
    ? entityById.get(selectedEntity.parentId) ?? null
    : selectedEntity.kind === "cnr-department" ? selectedEntity : null;
  const department = normalizedFilters.department ?? selectedDepartment;
  const departmentInstitutes = department
    ? publicResearchSnapshot.entities.filter((entity) => entity.kind === "cnr-institute" && entity.parentId === department.id)
    : publicResearchSnapshot.entities.filter((entity) => entity.kind === "cnr-institute");
  const instituteRows = normalizedFilters.scope === "cnr"
    ? departmentInstitutes
      .filter((institute) => !normalizedFilters.institute || institute.id === normalizedFilters.institute.id)
      .map((institute) => ({
        ...entityOption(institute),
        permanentHeadcount: numericValue(currentStaffRows(institute, "permanentHeadcount", "cnr", normalizedFilters.year)),
        researcherHeadcount: numericValue(currentStaffRows(institute, "researcherHeadcount", "cnr", normalizedFilters.year)),
        researchAppointmentCount: numericValue(currentStaffRows(institute, "researchAppointmentCount", "cnr", normalizedFilters.year)),
        fundingAllocation: numericValue(directOrDescendantRows(institute, normalizedFilters.year, "fundingAllocation", "cnr")),
        assessedResources: numericValue(directOrDescendantRows(institute, normalizedFilters.year, "assessedResources", "cnr")),
        infrastructureCost: numericValue(directOrDescendantRows(institute, normalizedFilters.year, "infrastructureCost", "cnr")),
        projectCount: numericValue(directOrDescendantRows(institute, normalizedFilters.year, "projectCount", "cnr")),
      }))
      .sort((left, right) => (right.permanentHeadcount ?? -1) - (left.permanentHeadcount ?? -1))
    : [];
  const staffRows = currentStaffRows(selectedEntity, "permanentHeadcount", normalizedFilters.scope, normalizedFilters.year);
  const staffYear = normalizedFilters.scope === "cnr" && staffRows.length > 0
    ? PUBLIC_RESEARCH_CURRENT_STAFF_YEAR
    : normalizedFilters.scope === "university" && staffRows.length > 0
      ? normalizedFilters.year
      : null;
  const summary = {
    fundingAllocation: directOrDescendantRows(selectedEntity, normalizedFilters.year, "fundingAllocation", normalizedFilters.scope),
    assessedResources: directOrDescendantRows(selectedEntity, normalizedFilters.year, "assessedResources", normalizedFilters.scope),
    permanentHeadcount: staffRows,
    researcherHeadcount: currentStaffRows(selectedEntity, "researcherHeadcount", normalizedFilters.scope, normalizedFilters.year),
    nonPermanentHeadcount: currentStaffRows(selectedEntity, "nonPermanentHeadcount", normalizedFilters.scope, normalizedFilters.year),
    researchAppointmentCount: currentStaffRows(selectedEntity, "researchAppointmentCount", normalizedFilters.scope, normalizedFilters.year),
    infrastructureCost: directOrDescendantRows(selectedEntity, normalizedFilters.year, "infrastructureCost", normalizedFilters.scope),
    projectCount: directOrDescendantRows(selectedEntity, normalizedFilters.year, "projectCount", normalizedFilters.scope),
  } satisfies PublicResearchSummary;
  const fundingTrend = publicResearchSnapshot.observations
    .filter((row) => row.entityId === selectedEntity.id && row.metric === "fundingAllocation")
    .sort((left, right) => left.year - right.year);
  const assessedTrend = normalizedFilters.scope === "cnr" && selectedEntity.kind === "cnr-department"
    ? publicResearchYearOptions().flatMap((period) => directOrDescendantRows(selectedEntity, period.year, "assessedResources", "cnr"))
      .sort((left, right) => left.year - right.year)
    : [];
  const universityTrend = normalizedFilters.scope === "university"
    ? publicResearchSnapshot.observations.filter((row) => row.entityId === selectedEntity.id && ["permanentHeadcount", "researcherHeadcount", "nonPermanentHeadcount"].includes(row.metric))
    : publicResearchSnapshot.observations.filter((row) => row.entityId === "research-system" && row.metric !== "fundingAllocation");
  const scopeCoverage = scopedCoverage(normalizedFilters.scope);
  const comparisonMetric = comparisonMetricFor(normalizedFilters.scope, selectedEntity);
  const comparisonEntities = comparisonMetric
    ? comparisonCandidates(normalizedFilters.scope, selectedEntity, normalizedFilters.year, comparisonMetric)
    : [];
  const comparisonOptions = comparisonEntities.map(entityOption);
  const selectedComparisonRows = comparisonMetric
    ? buildComparisonRows(comparisonEntities, normalizedFilters.compare, selectedEntity, normalizedFilters.year, comparisonMetric, normalizedFilters.scope)
    : [];
  return {
    year: normalizedFilters.year,
    scope: normalizedFilters.scope,
    staffYear,
    selectedEntity: entityOption(selectedEntity),
    summary,
    derivedIndicators: derivedIndicators(normalizedFilters.scope, normalizedFilters.year, selectedEntity, summary),
    comparisonMetric,
    comparisonOptions,
    comparisonRows: selectedComparisonRows,
    fundingTrend,
    assessedTrend,
    universityTrend: universityTrend.sort((left, right) => left.year - right.year),
    cnrDepartment: department ? entityOption(department) : null,
    cnrInstitutes: departmentInstitutes.map(entityOption),
    cnrInstituteRows: instituteRows,
    periods: publicResearchSnapshot.periods,
    scopeOptions: publicResearchScopeOptions(),
    scopeEntityOptions: publicResearchScopeEntityOptions(normalizedFilters.scope),
    entityOptions: publicResearchEntityOptions(),
    departmentOptions: publicResearchDepartmentOptions(),
    instituteOptions: publicResearchInstituteOptions(),
    sources: publicResearchSnapshot.sources,
    coverage: publicResearchSnapshot.coverage,
    scopeCoverage,
    methodology: publicResearchSnapshot.methodology,
  };
}

export function queryPublicResearchDataset(query: PublicResearchDatasetQuery = {}) {
  if (query.dataset && query.dataset !== RESEARCH_PUBLIC_DATASET_ID) {
    throw new Error(`Dataset ricerca non riconosciuto: ${query.dataset}.`);
  }
  const normalizedFilters = normalizePublicResearchFilters(query);
  const scopeIds = scopeEntityIds(normalizedFilters.scope);
  if (normalizedFilters.scope === "university" && (normalizedFilters.entityKind === "system" || normalizedFilters.selectedEntity?.kind === "system")) {
    scopeIds.add("research-system");
  }
  const years = query.year === undefined
    ? publicResearchSnapshot.periods.map((period) => period.year)
    : [normalizedFilters.year];
  let rows = publicResearchSnapshot.observations.filter((row) => years.includes(row.year) && scopeIds.has(row.entityId));
  if (normalizedFilters.metric) rows = rows.filter((row) => row.metric === normalizedFilters.metric);
  if (normalizedFilters.selectedEntity) {
    const entityIds = normalizedFilters.selectedEntity.kind === "system" || normalizedFilters.selectedEntity.kind === "epr" || normalizedFilters.selectedEntity.kind === "cnr-department"
      ? descendantsOf(normalizedFilters.selectedEntity.id)
      : new Set([normalizedFilters.selectedEntity.id]);
    rows = rows.filter((row) => entityIds.has(row.entityId));
  }
  if (normalizedFilters.department) {
    const ids = descendantsOf(normalizedFilters.department.id);
    rows = rows.filter((row) => ids.has(row.entityId));
  }
  if (normalizedFilters.institute) rows = rows.filter((row) => row.entityId === normalizedFilters.institute!.id);
  if (normalizedFilters.entityKind) rows = rows.filter((row) => entityById.get(row.entityId)?.kind === normalizedFilters.entityKind);
  rows = rows.slice().sort((left, right) => left.year - right.year || left.entityId.localeCompare(right.entityId) || left.metric.localeCompare(right.metric));
  const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50)));
  const offset = Math.min(100_000, Math.max(0, Math.trunc(query.offset ?? 0)));
  const items = rows.slice(offset, offset + limit).map((row) => ({
    ...row,
    entity: entityOption(entityById.get(row.entityId)!),
  }));
  const scopeCoverage = scopedCoverage(normalizedFilters.scope);
  return {
    schemaVersion: 1,
    dataset: RESEARCH_PUBLIC_DATASET_ID,
    query: {
      year: query.year === undefined ? PUBLIC_RESEARCH_ALL : normalizedFilters.year,
      scope: normalizedFilters.scope,
      entity: normalizedFilters.selectedEntity?.code ?? PUBLIC_RESEARCH_ALL,
      entityKind: normalizedFilters.entityKind ?? PUBLIC_RESEARCH_ALL,
      department: normalizedFilters.department?.code ?? PUBLIC_RESEARCH_ALL,
      institute: normalizedFilters.institute?.code ?? PUBLIC_RESEARCH_ALL,
      metric: normalizedFilters.metric ?? PUBLIC_RESEARCH_ALL,
    },
    pagination: {
      total: rows.length,
      offset,
      limit,
      returned: items.length,
      hasMore: offset + items.length < rows.length,
      nextOffset: offset + items.length < rows.length ? offset + items.length : null,
    },
    data: items,
    coverage: scopeCoverage.coverage,
    sources: scopeCoverage.sources,
    methodology: publicResearchSnapshot.methodology,
    caveat: "FOE e FFO restano assegnazioni/trasferimenti a livello di ente; non vengono ripartiti tra dipartimenti o istituti. Le schede DSB sono osservazioni parziali e il personale universitario USTAT non contiene i finanziamenti degli atenei.",
  };
}
