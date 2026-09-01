"use client";

import { usePathname, useRouter } from "next/navigation";
import type { PublicResearchEntityOption } from "@/lib/public-research";
import styles from "@/app/ricerca/ricerca.module.css";

export type PublicResearchScope = "cnr" | "epr" | "university";

type PeriodOption = Readonly<{ year: number; label: string }>;

type PublicResearchFiltersProps = Readonly<{
  scope: PublicResearchScope;
  year: number;
  entity: string;
  department: string;
  institute: string;
  periods: readonly PeriodOption[];
  entities: readonly PublicResearchEntityOption[];
  departments: readonly PublicResearchEntityOption[];
  institutes: readonly PublicResearchEntityOption[];
}>;

const SCOPE_LABELS: Record<PublicResearchScope, string> = {
  cnr: "CNR",
  epr: "Altri enti di ricerca",
  university: "Università",
};

function scopeEntityKind(scope: PublicResearchScope): string {
  return scope === "cnr" ? "" : scope === "university" ? "university" : "epr";
}

function isScopeEntity(option: PublicResearchEntityOption, scope: PublicResearchScope): boolean {
  if (scope === "cnr") return option.code === "CNR" || option.kind === "cnr-department" || option.kind === "cnr-institute";
  if (scope === "university") return option.kind === "university";
  return option.kind === "epr" && option.code !== "CNR";
}

function selectedOrAll(value: string): string {
  return value || "all";
}

export function PublicResearchFilters({
  scope,
  year,
  entity,
  department,
  institute,
  periods,
  entities,
  departments,
  institutes,
}: PublicResearchFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const scopeEntities = entities.filter((option) => isScopeEntity(option, scope));
  const departmentValue = scope === "cnr" ? selectedOrAll(department) : "all";
  const selectedDepartment = departments.find((option) => option.code === department || option.id === department);
  const instituteOptions = selectedDepartment
    ? institutes.filter((option) => option.parentId === selectedDepartment.id)
    : [];

  function updateFilters(next: Readonly<Record<string, string | undefined>>) {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function updateScope(nextScope: PublicResearchScope) {
    const firstScopeEntity = entities.find((option) => isScopeEntity(option, nextScope));
    updateFilters({
      scope: nextScope,
      entityKind: scopeEntityKind(nextScope),
      entity: nextScope === "cnr" ? "CNR" : nextScope === "university" ? undefined : firstScopeEntity?.code,
      department: undefined,
      institute: undefined,
    });
  }

  function updateEntity(nextEntity: string) {
    updateFilters({ entity: nextEntity, entityKind: scopeEntityKind(scope) });
  }

  function updateDepartment(nextDepartment: string) {
    updateFilters({ department: nextDepartment, institute: undefined, scope: "cnr", entity: nextDepartment === "all" ? "CNR" : nextDepartment, entityKind: undefined });
  }

  function updateInstitute(nextInstitute: string) {
    updateFilters({ institute: nextInstitute, scope: "cnr", entity: nextInstitute === "all" ? (department || "CNR") : nextInstitute, entityKind: undefined });
  }

  return (
    <form className={`panel ${styles.filters}`} action={pathname} method="get" aria-labelledby="research-filters-title">
      <div className={styles.filterIntro}>
        <span className={styles.kicker}>Esplora il perimetro</span>
        <strong id="research-filters-title">Cambia ambito, anno e dettaglio</strong>
        <span>Ogni selezione aggiorna solo dati appartenenti allo stesso perimetro.</span>
      </div>
      <label>
        Ambito
        <select
          name="scope"
          value={scope}
          onChange={(event) => updateScope(event.target.value as PublicResearchScope)}
          data-research-filter="scope"
        >
          {(Object.keys(SCOPE_LABELS) as PublicResearchScope[]).map((option) => (
            <option key={option} value={option}>{SCOPE_LABELS[option]}</option>
          ))}
        </select>
      </label>
      <label>
        Anno
        <select
          name="year"
          value={String(year)}
          onChange={(event) => updateFilters({ year: event.target.value })}
          data-research-filter="year"
        >
          {periods.map((period) => <option key={period.year} value={period.year}>{period.label}</option>)}
        </select>
      </label>
      {scope === "cnr" ? (
        <>
          <label>
            Ente
            <select name="entity" value="CNR" onChange={(event) => updateEntity(event.target.value)} data-research-filter="entity">
              <option value="CNR">CNR</option>
            </select>
          </label>
          <label>
            Dipartimento CNR
            <select name="department" value={departmentValue} onChange={(event) => updateDepartment(event.target.value)} data-research-filter="department">
              <option value="all">Tutti i dipartimenti</option>
              {departments.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
            </select>
          </label>
          <label>
            Istituto CNR
            <select
              name="institute"
              value={selectedOrAll(institute)}
              onChange={(event) => updateInstitute(event.target.value)}
              disabled={instituteOptions.length === 0}
              data-research-filter="institute"
            >
              <option value="all">Tutti gli istituti</option>
              {instituteOptions.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
            </select>
          </label>
        </>
      ) : (
        <label className={styles.entityFilter}>
          {scope === "university" ? "Ateneo" : "Ente di ricerca"}
          <select name="entity" value={entity || scopeEntities[0]?.code || ""} onChange={(event) => updateEntity(event.target.value)} data-research-filter="entity">
            {scope === "university" ? <option value="all">Tutte le università</option> : null}
            {scopeEntities.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
          </select>
        </label>
      )}
      <noscript><button className="btn" type="submit">Applica</button></noscript>
      <a className="btn btn-quiet" href="/ricerca">Azzera</a>
    </form>
  );
}
