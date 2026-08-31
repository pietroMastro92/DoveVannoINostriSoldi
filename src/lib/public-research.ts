import "server-only";

import rawSnapshot from "@/data/generated/public-research-snapshot.json";
import {
  RESEARCH_PUBLIC_DATASET_ID,
  validateResearchPublicSnapshot,
  type ResearchEntity,
  type ResearchEntityKind,
  type ResearchMetric,
  type ResearchObservation,
  type ResearchPublicSnapshot,
} from "@/lib/data/research-public-contract";

export const PUBLIC_RESEARCH_ALL = "all" as const;
export const PUBLIC_RESEARCH_DEFAULT_YEAR = 2024;
export const PUBLIC_RESEARCH_CURRENT_STAFF_YEAR = 2025;

export type PublicResearchFilters = Readonly<{
  year?: string | number;
  entity?: string;
  entityKind?: string;
  department?: string;
  institute?: string;
  metric?: string;
}>;

export type PublicResearchDatasetQuery = Readonly<PublicResearchFilters & {
  dataset?: string;
  limit?: number;
  offset?: number;
}>;

export type PublicResearchEntityOption = Readonly<Pick<ResearchEntity, "id" | "code" | "name" | "kind" | "parentId">>;

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
  selectedEntity: PublicResearchEntityOption;
  summary: PublicResearchSummary;
  fundingTrend: ResearchObservation[];
  assessedTrend: ResearchObservation[];
  universityTrend: ResearchObservation[];
  cnrDepartment: PublicResearchEntityOption;
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
  entityOptions: PublicResearchEntityOption[];
  departmentOptions: PublicResearchEntityOption[];
  instituteOptions: PublicResearchEntityOption[];
  sources: ResearchPublicSnapshot["sources"];
  coverage: ResearchPublicSnapshot["coverage"];
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

function observationKey(row: ResearchObservation): string {
  return [row.entityId, row.year, row.metric, row.measure, row.accountingBasis, row.unit, row.comparabilityKey, row.scope].join("|");
}

function aggregateRows(rows: readonly ResearchObservation[]): ResearchObservation[] {
  const aggregates = new Map<string, ResearchObservation>();
  for (const row of rows) {
    const key = observationKey(row);
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, { ...row });
      continue;
    }
    aggregates.set(key, { ...existing, value: existing.value + row.value });
  }
  return [...aggregates.values()];
}

function directOrDescendantRows(entity: ResearchEntity, year: number, metric: ResearchMetric): ResearchObservation[] {
  const direct = publicResearchSnapshot.observations.filter((row) => row.entityId === entity.id && row.year === year && row.metric === metric);
  if (direct.length > 0) return direct;
  const descendants = descendantsOf(entity.id);
  return aggregateRows(publicResearchSnapshot.observations.filter((row) => descendants.has(row.entityId) && row.year === year && row.metric === metric));
}

function currentStaffRows(entity: ResearchEntity, metric: ResearchMetric): ResearchObservation[] {
  return directOrDescendantRows(entity, PUBLIC_RESEARCH_CURRENT_STAFF_YEAR, metric);
}

function numericValue(rows: readonly ResearchObservation[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((total, row) => total + row.value, 0);
}

export function publicResearchMetricLabel(metric: ResearchMetric): string {
  return metricLabels[metric];
}

export function publicResearchEntityOptions(): PublicResearchEntityOption[] {
  return publicResearchSnapshot.entities.map(entityOption);
}

export function publicResearchDepartmentOptions(): PublicResearchEntityOption[] {
  return publicResearchSnapshot.entities.filter((entity) => entity.kind === "cnr-department").map(entityOption);
}

export function publicResearchInstituteOptions(): PublicResearchEntityOption[] {
  return publicResearchSnapshot.entities.filter((entity) => entity.kind === "cnr-institute").map(entityOption);
}

export function publicResearchYearOptions() {
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
  const metric = filters.metric && normalized(filters.metric) !== PUBLIC_RESEARCH_ALL
    ? Object.hasOwn(metricLabels, filters.metric as ResearchMetric) ? filters.metric as ResearchMetric : null
    : null;
  if (filters.metric && normalized(filters.metric) !== PUBLIC_RESEARCH_ALL && !metric) {
    throw new Error(`Metrica ricerca non riconosciuta: ${filters.metric}.`);
  }
  const entityKind = filters.entityKind && normalized(filters.entityKind) !== PUBLIC_RESEARCH_ALL
    ? normalized(filters.entityKind)
    : null;
  if (entityKind && !(["system", "university", "epr", "cnr-department", "cnr-institute"] as string[]).includes(entityKind)) {
    throw new Error(`Tipo di ente ricerca non riconosciuto: ${filters.entityKind}.`);
  }
  return { year, selectedEntity, entityKind, department, institute, metric } as const;
}

export function getPublicResearchView(filters: PublicResearchFilters = {}): PublicResearchView {
  const normalizedFilters = normalizePublicResearchFilters(filters);
  const selectedEntity = normalizedFilters.selectedEntity
    ?? normalizedFilters.institute
    ?? normalizedFilters.department
    ?? (normalizedFilters.entityKind === "university" ? entityById.get("research-system") : null)
    ?? entityById.get("epr-cnr")
    ?? publicResearchSnapshot.entities[0]!;
  const selectedDepartment = selectedEntity.kind === "cnr-institute" && selectedEntity.parentId
    ? entityById.get(selectedEntity.parentId)
    : selectedEntity.kind === "cnr-department" ? selectedEntity : null;
  const department = normalizedFilters.department ?? selectedDepartment ?? entityById.get("cnr-dsb")!;
  const instituteRows = publicResearchSnapshot.entities
    .filter((entity) => entity.kind === "cnr-institute" && entity.parentId === department.id)
    .map((institute) => ({
      ...entityOption(institute),
      permanentHeadcount: numericValue(currentStaffRows(institute, "permanentHeadcount")),
      researcherHeadcount: numericValue(currentStaffRows(institute, "researcherHeadcount")),
      researchAppointmentCount: numericValue(currentStaffRows(institute, "researchAppointmentCount")),
      fundingAllocation: numericValue(directOrDescendantRows(institute, normalizedFilters.year, "fundingAllocation")),
      assessedResources: numericValue(directOrDescendantRows(institute, 2024, "assessedResources")),
      infrastructureCost: numericValue(directOrDescendantRows(institute, 2024, "infrastructureCost")),
      projectCount: numericValue(directOrDescendantRows(institute, 2024, "projectCount")),
    }))
    .sort((left, right) => (right.permanentHeadcount ?? -1) - (left.permanentHeadcount ?? -1));

  const summary = {
    fundingAllocation: selectedEntity.kind === "system" && normalizedFilters.entityKind === "university"
      ? []
      : directOrDescendantRows(selectedEntity, normalizedFilters.year, "fundingAllocation"),
    assessedResources: selectedEntity.kind === "system" && normalizedFilters.entityKind === "university"
      ? []
      : directOrDescendantRows(selectedEntity, normalizedFilters.year, "assessedResources"),
    permanentHeadcount: currentStaffRows(selectedEntity, "permanentHeadcount"),
    researcherHeadcount: currentStaffRows(selectedEntity, "researcherHeadcount"),
    nonPermanentHeadcount: currentStaffRows(selectedEntity, "nonPermanentHeadcount"),
    researchAppointmentCount: currentStaffRows(selectedEntity, "researchAppointmentCount"),
    infrastructureCost: directOrDescendantRows(selectedEntity, normalizedFilters.year, "infrastructureCost"),
    projectCount: directOrDescendantRows(selectedEntity, normalizedFilters.year, "projectCount"),
  } satisfies PublicResearchSummary;
  const fundingTrend = publicResearchSnapshot.observations
    .filter((row) => row.entityId === selectedEntity.id && row.metric === "fundingAllocation")
    .sort((left, right) => left.year - right.year);
  const assessedTrend = selectedEntity.kind === "system" && normalizedFilters.entityKind === "university"
    ? []
    : publicResearchYearOptions()
      .flatMap((period) => directOrDescendantRows(selectedEntity, period.year, "assessedResources"))
      .sort((left, right) => left.year - right.year || left.entityId.localeCompare(right.entityId));
  const universityTrend = publicResearchSnapshot.observations
    .filter((row) => row.entityId === "research-system" && row.metric !== "fundingAllocation")
    .sort((left, right) => left.year - right.year);

  return {
    year: normalizedFilters.year,
    selectedEntity: entityOption(selectedEntity),
    summary,
    fundingTrend,
    assessedTrend,
    universityTrend,
    cnrDepartment: entityOption(department),
    cnrInstitutes: publicResearchSnapshot.entities.filter((entity) => entity.parentId === department.id).map(entityOption),
    cnrInstituteRows: instituteRows,
    periods: publicResearchSnapshot.periods,
    entityOptions: publicResearchEntityOptions(),
    departmentOptions: publicResearchDepartmentOptions(),
    instituteOptions: publicResearchInstituteOptions(),
    sources: publicResearchSnapshot.sources,
    coverage: publicResearchSnapshot.coverage,
    methodology: publicResearchSnapshot.methodology,
  };
}

export function queryPublicResearchDataset(query: PublicResearchDatasetQuery = {}) {
  if (query.dataset && query.dataset !== RESEARCH_PUBLIC_DATASET_ID) {
    throw new Error(`Dataset ricerca non riconosciuto: ${query.dataset}.`);
  }
  const normalizedFilters = normalizePublicResearchFilters(query);
  const years = query.year === undefined
    ? publicResearchSnapshot.periods.map((period) => period.year)
    : [normalizedFilters.year];
  let rows = publicResearchSnapshot.observations.filter((row) => years.includes(row.year));
  if (normalizedFilters.metric) rows = rows.filter((row) => row.metric === normalizedFilters.metric);
  if (normalizedFilters.selectedEntity) {
    const entityIds = normalizedFilters.selectedEntity.kind === "system" || normalizedFilters.selectedEntity.kind === "cnr-department"
      ? descendantsOf(normalizedFilters.selectedEntity.id)
      : new Set([normalizedFilters.selectedEntity.id]);
    rows = rows.filter((row) => entityIds.has(row.entityId));
  }
  if (normalizedFilters.department) {
    const ids = descendantsOf(normalizedFilters.department.id);
    rows = rows.filter((row) => ids.has(row.entityId));
  }
  if (normalizedFilters.institute) rows = rows.filter((row) => row.entityId === normalizedFilters.institute!.id);
  if (normalizedFilters.entityKind) {
    if (!(["system", "university", "epr", "cnr-department", "cnr-institute"] as string[]).includes(normalizedFilters.entityKind)) {
      throw new Error(`Tipo di ente ricerca non riconosciuto: ${query.entityKind}.`);
    }
    rows = rows.filter((row) => entityById.get(row.entityId)?.kind === normalizedFilters.entityKind);
  }
  rows = rows.slice().sort((left, right) => left.year - right.year || left.entityId.localeCompare(right.entityId) || left.metric.localeCompare(right.metric));
  const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 50)));
  const offset = Math.min(100_000, Math.max(0, Math.trunc(query.offset ?? 0)));
  const items = rows.slice(offset, offset + limit).map((row) => ({
    ...row,
    entity: entityOption(entityById.get(row.entityId)!),
  }));
  return {
    schemaVersion: 1,
    dataset: RESEARCH_PUBLIC_DATASET_ID,
    query: {
      year: query.year === undefined ? PUBLIC_RESEARCH_ALL : normalizedFilters.year,
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
    coverage: publicResearchSnapshot.coverage,
    sources: publicResearchSnapshot.sources,
    methodology: publicResearchSnapshot.methodology,
    caveat: "Il FOE è pubblicato a livello di ente e non viene ripartito tra dipartimenti o istituti. Le schede DSB sono osservazioni di un solo dipartimento CNR; il personale universitario USTAT non include i finanziamenti.",
  };
}
