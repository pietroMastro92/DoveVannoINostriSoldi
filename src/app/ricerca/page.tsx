import type { Metadata } from "next";
import Link from "next/link";
import {
  compactEuroFromCents,
  integer,
  longDate,
  percent,
} from "@/lib/format";
import {
  getPublicResearchView,
  publicResearchEntityOptions,
  publicResearchMetricLabel,
  publicResearchScopeForEntity,
  publicResearchYearOptions,
  queryPublicResearchDataset,
  type PublicResearchEntityOption,
} from "@/lib/public-research";
import type { ResearchMetric, ResearchObservation } from "@/lib/data/research-public-contract";
import { PublicResearchFilters, type PublicResearchScope } from "@/components/public-research-filters";
import styles from "./ricerca.module.css";

export const metadata: Metadata = {
  title: "Ricerca pubblica",
  description:
    "Finanziamenti, personale e precariato della ricerca pubblica italiana: CNR, enti pubblici di ricerca e università dal 2024.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const UI_START_YEAR = 2024;
const SCOPES: readonly PublicResearchScope[] = ["cnr", "epr", "university"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validScope(value: string | undefined): PublicResearchScope | null {
  return value && SCOPES.includes(value as PublicResearchScope) ? value as PublicResearchScope : null;
}

function findEntity(options: readonly PublicResearchEntityOption[], value: string | undefined): PublicResearchEntityOption | undefined {
  const query = value?.trim().toLocaleLowerCase("it-IT");
  if (!query || query === "all") return undefined;
  return options.find((option) => [option.id, option.code, option.name].some((candidate) => candidate.toLocaleLowerCase("it-IT") === query));
}

function inferScope(params: SearchParams, entities: readonly PublicResearchEntityOption[]): PublicResearchScope {
  const explicit = validScope(first(params.scope));
  if (explicit) return explicit;
  const kind = first(params.entityKind)?.toLocaleLowerCase("it-IT");
  if (kind === "university") return "university";
  if (kind === "epr") return "epr";
  if (first(params.department) || first(params.institute)) return "cnr";
  const entity = findEntity(entities, first(params.entity));
  const inferred = entity && publicResearchScopeForEntity(entity);
  return inferred ?? "cnr";
}

function safeEntityForScope(entity: PublicResearchEntityOption | undefined, scope: PublicResearchScope): string | undefined {
  if (!entity) return undefined;
  return publicResearchScopeForEntity(entity) === scope ? entity.code : undefined;
}

function metricValue(rows: readonly ResearchObservation[], metric: ResearchMetric): number | null {
  const matching = rows.filter((item) => item.metric === metric);
  return matching.length > 0 ? matching.reduce((total, item) => total + item.value, 0) : null;
}

function isMoneyMetric(metric: ResearchMetric): boolean {
  return ["fundingAllocation", "assessedResources", "infrastructureCost", "cashPayment", "economicCost", "researchAppointmentGross", "procurementAwarded", "procurementLiquidated", "projectCost", "projectPayment"].includes(metric);
}

function displayValue(value: number | null, metric: ResearchMetric): string {
  if (value === null) return "n.d.";
  return isMoneyMetric(metric) ? compactEuroFromCents(value) : integer(value);
}

function exactValue(value: number | null, metric: ResearchMetric): string {
  if (value === null) return "dato non disponibile";
  return isMoneyMetric(metric)
    ? `${(value / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : integer(value);
}

function hrefFor(scope: PublicResearchScope, entity?: string, year?: number, department?: string, institute?: string): string {
  const params = new URLSearchParams({ scope });
  if (entity) params.set("entity", entity);
  if (year && year >= UI_START_YEAR) params.set("year", String(year));
  if (department) params.set("department", department);
  if (institute) params.set("institute", institute);
  return `/ricerca?${params.toString()}`;
}

function staffRowsByYear(rows: readonly ResearchObservation[]) {
  return publicResearchYearOptions().map((period) => ({
    year: period.year,
    permanent: metricValue(rows.filter((row) => row.year === period.year), "permanentHeadcount"),
    researchers: metricValue(rows.filter((row) => row.year === period.year), "researcherHeadcount"),
    nonPermanent: metricValue(rows.filter((row) => row.year === period.year), "nonPermanentHeadcount"),
  }));
}

function sourceDate(source: { dataAsOf: string | null; publishedAt: string | null }): string {
  const value = source.dataAsOf ?? source.publishedAt;
  return value ? longDate(value) : "data non indicata";
}

export default async function PublicResearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const entities = publicResearchEntityOptions();
  const scope = inferScope(params, entities);
  const requestedEntity = findEntity(entities, first(params.entity));
  const requestedDepartment = findEntity(entities.filter((entity) => entity.kind === "cnr-department"), first(params.department));
  const requestedInstitute = findEntity(entities.filter((entity) => entity.kind === "cnr-institute"), first(params.institute));
  const selectedDepartment = requestedDepartment?.code;
  const selectedInstitute = requestedInstitute?.code;
  const compareRequest = first(params.compare) ?? [first(params.compare1), first(params.compare2), first(params.compare3)].filter(Boolean).join(",");
  const view = getPublicResearchView({
    scope,
    year: first(params.year),
    entity: safeEntityForScope(requestedEntity, scope),
    entityKind: scope === "university" ? "university" : scope === "epr" ? "epr" : undefined,
    department: scope === "cnr" ? selectedDepartment : undefined,
    institute: scope === "cnr" ? selectedInstitute : undefined,
    metric: first(params.metric),
    compare: compareRequest || undefined,
  });
  const selectedFunding = metricValue(view.summary.fundingAllocation, "fundingAllocation");
  const selectedAssessed = metricValue(view.summary.assessedResources, "assessedResources");
  const selectedPermanent = metricValue(view.summary.permanentHeadcount, "permanentHeadcount");
  const selectedResearchers = metricValue(view.summary.researcherHeadcount, "researcherHeadcount");
  const selectedAppointments = metricValue(view.summary.researchAppointmentCount, "researchAppointmentCount");
  const selectedNonPermanent = metricValue(view.summary.nonPermanentHeadcount, "nonPermanentHeadcount");
  const selectedInfrastructure = metricValue(view.summary.infrastructureCost, "infrastructureCost");
  const selectedProjects = metricValue(view.summary.projectCount, "projectCount");
  const isCnrRoot = scope === "cnr" && view.selectedEntity.code === "CNR";
  const headlineMetric: ResearchMetric = selectedFunding !== null ? "fundingAllocation" : "assessedResources";
  const headlineValue = selectedFunding ?? selectedAssessed;
  const latestSource = view.scopeCoverage.sources.reduce((latest, source) => source.observedAt > latest ? source.observedAt : latest, "");
  const eprRows = scope === "epr"
    ? queryPublicResearchDataset({ scope, year: view.year, metric: "fundingAllocation", limit: 100 }).data
    : [];
  const universityRows = scope === "university" && view.selectedEntity.code === "IT-RICERCA"
    ? queryPublicResearchDataset({ scope, year: view.year, entityKind: "university", metric: "permanentHeadcount", limit: 100 }).data
    : [];
  const staffRows = scope === "university" ? staffRowsByYear(view.universityTrend) : [];
  const selectedNonPermanentForRatio = selectedNonPermanent ?? selectedAppointments;
  const ratio = selectedPermanent !== null && selectedPermanent > 0 && selectedNonPermanentForRatio !== null
    ? (selectedNonPermanentForRatio / selectedPermanent) * 100
    : null;
  const departmentLabel = view.cnrDepartment?.name ?? "tutti i dipartimenti";
  const filterDepartment = scope === "cnr"
    ? selectedDepartment ?? (view.cnrDepartment?.kind === "cnr-department" ? view.cnrDepartment.code : "all")
    : "all";
  const filterInstitute = scope === "cnr"
    ? selectedInstitute ?? (view.selectedEntity.kind === "cnr-institute" ? view.selectedEntity.code : "all")
    : "all";

  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>Modulo Ricerca · MUR · CNR</span>
          <h1>Quanto è finanziata la ricerca pubblica?</h1>
          <p>
            Dal 2024 teniamo separati CNR, altri enti pubblici di ricerca e università: finanziamenti,
            personale, infrastrutture e progetti restano leggibili solo quando hanno lo stesso perimetro.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <span className="tag tag-accent">Snapshot verificato</span>
          <span>Osservato al {latestSource ? longDate(latestSource) : "n.d."}</span>
          <Link href="/metodologia">Come leggiamo i numeri →</Link>
        </div>
      </header>

      <PublicResearchFilters
        scope={scope}
        year={view.year >= UI_START_YEAR ? view.year : UI_START_YEAR}
        entity={scope === "cnr" ? "CNR" : scope === "university" && view.selectedEntity.kind === "system" ? "all" : view.selectedEntity.code}
        department={filterDepartment}
        institute={filterInstitute}
        periods={publicResearchYearOptions()}
        entities={view.scopeEntityOptions}
        departments={view.departmentOptions}
        institutes={view.instituteOptions}
      />

      <section className="panel" aria-labelledby="scope-intro-title">
        <div className={styles.panelHead}>
          <div>
            <span className={styles.kicker}>Ambito selezionato</span>
            <h2 id="scope-intro-title" className="panel-title">{view.scopeOptions.find((option) => option.id === scope)?.label}</h2>
          </div>
          <span className="status status-attiva">Dati dal 2024</span>
        </div>
        <p className={styles.sectionLead}>{view.scopeOptions.find((option) => option.id === scope)?.description} Il periodo precedente resta disponibile nell&apos;API/MCP come baseline storica, ma non viene mescolato nella vista corrente.</p>
      </section>

      <div className={styles.metricGrid}>
        <section className="panel" aria-labelledby="summary-title">
          <div className={styles.panelHead}>
            <h2 id="summary-title" className="panel-title">Perimetro selezionato</h2>
            <span className="status status-attiva">{view.selectedEntity.name}</span>
          </div>
          <strong className={styles.headline}>{displayValue(headlineValue, headlineMetric)}</strong>
          <p className={styles.headlineNote}>
            {headlineValue === null ? "finanziamento osservato non disponibile" : headlineMetric === "fundingAllocation" ? "assegnazione FOE osservata" : "risorse assestate osservate"}
            {" · anno "}{view.year}
          </p>
          <dl className={styles.factRows}>
            <div><dt>Personale strutturato{view.staffYear ? ` (${view.staffYear})` : ""}</dt><dd>{displayValue(selectedPermanent, "permanentHeadcount")}</dd></div>
            <div><dt>Ricercatori{view.staffYear ? ` (${view.staffYear})` : ""}</dt><dd>{displayValue(selectedResearchers, "researcherHeadcount")}</dd></div>
            <div><dt>Personale non permanente</dt><dd>{displayValue(selectedNonPermanent, "nonPermanentHeadcount")}</dd></div>
            <div><dt>Assegni/borse osservati</dt><dd>{displayValue(selectedAppointments, "researchAppointmentCount")}</dd></div>
            <div><dt>Infrastrutture (triennio)</dt><dd>{displayValue(selectedInfrastructure, "infrastructureCost")}</dd></div>
            <div><dt>Progetti osservati</dt><dd>{displayValue(selectedProjects, "projectCount")}</dd></div>
          </dl>
          <p className={styles.definition}>
            {headlineValue === null
              ? "La fonte non pubblica un valore omogeneo per questo perimetro e anno: mostriamo n.d. senza stimare."
              : `Valore esatto: ${exactValue(headlineValue, headlineMetric)}. ${headlineMetric === "fundingAllocation" ? "È un'assegnazione di competenza, non un pagamento di cassa." : "È una risorsa assestata osservata, non il bilancio completo dell'ente."}`}
          </p>
        </section>

        <section className={`panel ${styles.signalPanel}`} aria-labelledby="ratio-title">
          <div className={styles.panelHead}>
            <h2 id="ratio-title" className="panel-title">Struttura del personale</h2>
            <span className={styles.headNote}>{view.staffYear ? `osservato ${view.staffYear}` : "anno selezionato"}</span>
          </div>
          <strong className={styles.signal}>{ratio === null ? "n.d." : percent(ratio)}</strong>
          <p className={styles.signalLabel}>quota non permanente rispetto al personale strutturato</p>
          <p className={styles.note}>
            {scope === "cnr" ? "Per gli istituti DSB il numeratore usa assegni/borse osservati come proxy amministrativa; non è il tasso di precarietà complessivo." : "Il rapporto usa solo categorie pubblicate dalla stessa fonte e non misura qualità o produttività."}
          </p>
        </section>
      </div>

      <section className="panel" aria-labelledby="derived-title">
        <div className={styles.panelHead}>
          <h2 id="derived-title" className="panel-title">Indicatori ricavati</h2>
          <span className={styles.headNote}>stesso ente · stessa annualità · formule esplicite</span>
        </div>
        <div className={styles.derivedGrid}>
          {view.derivedIndicators.map((indicator) => (
            <article className={styles.derivedItem} key={indicator.id}>
              <strong>{indicator.label}</strong>
              <span className={styles.derivedValue}>{indicator.status === "available" ? indicator.unit === "percent" ? percent(indicator.value!) : compactEuroFromCents(indicator.value!) : "n.d."}</span>
              <small>{indicator.formula}</small>
              <span className={styles.note}>{indicator.note}</span>
            </article>
          ))}
        </div>
      </section>

      {view.comparisonMetric && view.comparisonRows.length >= 2 && (
        <section className="panel" aria-labelledby="comparison-title">
          <div className={styles.panelHead}>
            <div>
              <span className={styles.kicker}>Confronto omogeneo</span>
              <h2 id="comparison-title" className="panel-title">Fino a tre entità nello stesso perimetro</h2>
            </div>
            <span className={styles.headNote}>{publicResearchMetricLabel(view.comparisonMetric)} · {view.year}</span>
          </div>
          <form className={styles.comparisonForm} action="/ricerca" method="get">
            <input type="hidden" name="scope" value={scope} />
            <input type="hidden" name="year" value={view.year} />
            {view.selectedEntity.code ? <input type="hidden" name="entity" value={view.selectedEntity.code} /> : null}
            {selectedDepartment ? <input type="hidden" name="department" value={selectedDepartment} /> : null}
            {selectedInstitute ? <input type="hidden" name="institute" value={selectedInstitute} /> : null}
            {view.comparisonRows.map((row, index) => (
              <label key={`compare-${index}`}>
                Entità {index + 1}
                <select name={`compare${index + 1}`} defaultValue={row.entity.code}>
                  {view.comparisonOptions.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
                </select>
              </label>
            ))}
            <button className="btn btn-primary" type="submit">Confronta</button>
          </form>
          <div className="table-scroll" role="region" aria-label="Confronto tra entità della ricerca" tabIndex={0}>
            <table className="table">
              <caption className={styles.tableCaption}>Valori esatti, senza graduatoria di efficienza.</caption>
              <thead><tr><th scope="col">Entità</th><th scope="col" className="num">{publicResearchMetricLabel(view.comparisonMetric)}</th><th scope="col">Base di confronto</th></tr></thead>
              <tbody>{view.comparisonRows.map((row) => <tr key={row.entity.id}><th scope="row">{row.entity.name}<span className={styles.cellSub}>{row.entity.code}</span></th><td className="num"><strong>{displayValue(row.value, view.comparisonMetric!)}</strong><span className={styles.cellSub}>{exactValue(row.value, view.comparisonMetric!)}</span></td><td>{row.observation?.accountingBasis} · {row.observation?.comparabilityKey}</td></tr>)}</tbody>
            </table>
          </div>
          <p className={styles.note}>Le entità condividono anno, metrica, unità, base contabile e chiave di comparabilità. Il confronto descrive valori osservati e non stabilisce quale ente sia “migliore”.</p>
        </section>
      )}

      {scope === "cnr" && (
        <section className="panel" aria-labelledby="cnr-title">
          <div className={styles.panelHead}>
            <div>
              <span className={styles.kicker}>Drill-down CNR</span>
              <h2 id="cnr-title" className="panel-title">Dal dipartimento al singolo istituto</h2>
            </div>
            {view.cnrDepartment ? <Link href={hrefFor("cnr", view.cnrDepartment.code, view.year, view.cnrDepartment.code)}>Torna al dipartimento →</Link> : null}
          </div>
          <p className={styles.sectionLead}>
            Il FOE resta assegnato al CNR e non viene imputato alle strutture interne. La directory osservata contiene 7 dipartimenti e 83 istituti; le risorse granulari disponibili provengono dalle schede DSB e restano n.d. per gli altri istituti.
          </p>
          {isCnrRoot && (
            <div className="table-scroll" role="region" aria-label="Dipartimenti CNR" tabIndex={0}>
              <table className="table">
                <thead><tr><th scope="col">Dipartimento</th><th scope="col">Istituti nella directory</th><th scope="col">Dati granulari</th></tr></thead>
                <tbody>{view.departmentOptions.map((department) => {
                  const count = view.instituteOptions.filter((institute) => institute.parentId === department.id).length;
                  const hasRows = view.instituteOptions.some((institute) => institute.parentId === department.id && view.cnrInstituteRows.some((row) => row.id === institute.id && row.assessedResources !== null));
                  return <tr key={department.id}><th scope="row"><Link href={hrefFor("cnr", department.code, view.year, department.code)}>{department.code}</Link><span className={styles.cellSub}>{department.name}</span></th><td>{integer(count)}</td><td>{hasRows ? "osservati" : "n.d."}</td></tr>;
                })}</tbody>
              </table>
            </div>
          )}
          {!isCnrRoot && (
            <>
          <p className={styles.sectionLead}>Perimetro: {departmentLabel}. Seleziona un istituto per leggere le sole osservazioni pubblicate a quella grana.</p>
              <div className="table-scroll" role="region" aria-label={`Istituti CNR del ${departmentLabel}`} tabIndex={0}>
                <table className="table">
                  <thead><tr><th scope="col">Istituto</th><th scope="col" className="num">Strutturato 2025</th><th scope="col" className="num">Ricercatori 2025</th><th scope="col" className="num">Assegni/borse 2025</th><th scope="col" className="num">Risorse {view.year}</th><th scope="col" className="num">Infrastrutture {view.year}</th><th scope="col" className="num">Progetti {view.year}</th></tr></thead>
                  <tbody>{view.cnrInstituteRows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row"><Link href={hrefFor("cnr", row.code, view.year, view.cnrDepartment?.code, row.code)}>{row.code}</Link><span className={styles.cellSub}>{row.name}</span></th>
                      <td className="num">{displayValue(row.permanentHeadcount, "permanentHeadcount")}</td>
                      <td className="num">{displayValue(row.researcherHeadcount, "researcherHeadcount")}</td>
                      <td className="num">{displayValue(row.researchAppointmentCount, "researchAppointmentCount")}</td>
                      <td className="num">{displayValue(row.assessedResources, "assessedResources")}</td>
                      <td className="num">{displayValue(row.infrastructureCost, "infrastructureCost")}</td>
                      <td className="num">{displayValue(row.projectCount, "projectCount")}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
          {view.assessedTrend.length > 0 && (
            <>
              <h3 className={styles.subheading}>Risorse assestate del dipartimento</h3>
              <div className={styles.trendGrid}>
                {view.assessedTrend.map((row) => <div className={styles.trendItem} key={`${row.year}-${row.id}`}><span>{row.year}</span><strong>{displayValue(row.value, "assessedResources")}</strong><small>{row.note}</small></div>)}
              </div>
              <div className="table-scroll" role="region" aria-label="Serie storica delle risorse assestate CNR" tabIndex={0}>
                <table className="table"><caption className={styles.tableCaption}>Valori esatti della serie storica</caption><thead><tr><th scope="col">Anno</th><th scope="col" className="num">Risorse assestate</th><th scope="col">Base</th></tr></thead><tbody>{view.assessedTrend.map((row) => <tr key={`assessed-${row.id}`}><th scope="row">{row.year}</th><td className="num">{exactValue(row.value, "assessedResources")}</td><td>{row.accountingBasis} · {row.comparabilityKey}</td></tr>)}</tbody></table>
              </div>
            </>
          )}
          {view.fundingTrend.length > 0 && (
            <>
              <h3 className={styles.subheading}>FOE CNR · assegnazione annuale</h3>
              <div className={styles.trendGrid}>
                {view.fundingTrend.filter((row) => row.year >= UI_START_YEAR).map((row) => <div className={styles.trendItem} key={`${row.year}-${row.id}`}><span>{row.year}</span><strong>{displayValue(row.value, "fundingAllocation")}</strong><small>competenza · MUR</small></div>)}
              </div>
              <div className="table-scroll" role="region" aria-label="Serie storica FOE CNR" tabIndex={0}>
                <table className="table"><caption className={styles.tableCaption}>Valori esatti dell&apos;assegnazione FOE</caption><thead><tr><th scope="col">Anno</th><th scope="col" className="num">FOE assegnato</th><th scope="col">Base</th></tr></thead><tbody>{view.fundingTrend.filter((row) => row.year >= UI_START_YEAR).map((row) => <tr key={`funding-${row.id}`}><th scope="row">{row.year}</th><td className="num">{exactValue(row.value, "fundingAllocation")}</td><td>{row.accountingBasis} · MUR</td></tr>)}</tbody></table>
              </div>
            </>
          )}
        </section>
      )}

      {scope === "epr" && (
        <section className="panel" aria-labelledby="epr-title">
          <div className={styles.panelHead}><div><span className={styles.kicker}>Enti pubblici di ricerca</span><h2 id="epr-title" className="panel-title">FOE per ente · {view.year}</h2></div><span className={styles.headNote}>MUR · competenza</span></div>
          {eprRows.length > 0 ? <div className="table-scroll" role="region" aria-label="Assegnazioni FOE degli enti pubblici di ricerca" tabIndex={0}>
            <table className="table"><thead><tr><th scope="col">Ente</th><th scope="col" className="num">FOE assegnato</th><th scope="col">Lettura</th></tr></thead><tbody>
              {eprRows.map((row) => <tr key={row.id}><th scope="row">{row.entity.name}<span className={styles.cellSub}>{row.entity.code}</span></th><td className="num">{displayValue(row.value, "fundingAllocation")}</td><td>assegnazione MUR, non spesa di cassa</td></tr>)}
            </tbody></table>
          </div> : <p className={styles.emptyState}>Per il {view.year} non è presente un’assegnazione FOE osservata per gli altri enti di ricerca: mostriamo n.d. senza sostituire l’anno con il 2024.</p>}
          <p className={styles.note}>Il FOE è pubblicato a livello di ente. Personale, costi economici e pagamenti non sono ancora collegati con lo stesso universo contabile.</p>
        </section>
      )}

      {scope === "university" && (
        <section className="panel" aria-labelledby="university-title">
          <div className={styles.panelHead}><div><span className={styles.kicker}>Università</span><h2 id="university-title" className="panel-title">Personale osservato · USTAT</h2></div><span className={styles.headNote}>anno selezionato {view.year}</span></div>
          {universityRows.length > 0 && <div className="table-scroll" role="region" aria-label="Personale strutturato negli atenei" tabIndex={0}><table className="table"><thead><tr><th scope="col">Ateneo</th><th scope="col" className="num">Personale strutturato</th><th scope="col">Fonte</th></tr></thead><tbody>{universityRows.map((row) => <tr key={row.id}><th scope="row">{row.entity.name}<span className={styles.cellSub}>{row.entity.code}</span></th><td className="num">{displayValue(row.value, "permanentHeadcount")}</td><td>USTAT {view.year}</td></tr>)}</tbody></table></div>}
          {universityRows.length === 0 && <p className={styles.emptyState}>Seleziona “tutte le università” per il prospetto degli atenei. Per il 2025 USTAT non pubblica ancora un dato: viene mostrato n.d., senza riportare il 2024 al suo posto.</p>}
          <div className={styles.trendGrid}>{staffRows.map((row) => <div className={styles.trendItem} key={row.year}><span>{row.year}</span><strong>{displayValue(row.permanent, "permanentHeadcount")}</strong><small>strutturato · {view.selectedEntity.name}</small></div>)}</div>
          <div className="table-scroll" role="region" aria-label="Serie storica del personale universitario" tabIndex={0}>
            <table className="table"><caption className={styles.tableCaption}>Valori esatti USTAT per anno</caption><thead><tr><th scope="col">Anno</th><th scope="col" className="num">Strutturato</th><th scope="col" className="num">Ricercatori</th><th scope="col" className="num">Non permanente</th></tr></thead><tbody>{staffRows.map((row) => <tr key={`staff-${row.year}`}><th scope="row">{row.year}</th><td className="num">{displayValue(row.permanent, "permanentHeadcount")}</td><td className="num">{displayValue(row.researchers, "researcherHeadcount")}</td><td className="num">{displayValue(row.nonPermanent, "nonPermanentHeadcount")}</td></tr>)}</tbody></table>
          </div>
          <p className={styles.note}>USTAT pubblica personale e qualifiche, non il finanziamento della ricerca degli atenei. La voce 3RU e 3RTD è accorpata dalla fonte.</p>
        </section>
      )}

      <section className={`panel ${styles.coverage}`} aria-labelledby="coverage-title">
        <div className={styles.panelHead}><h2 id="coverage-title" className="panel-title">Copertura e fonti dell&apos;ambito</h2><Link href="/fonti">Registro fonti →</Link></div>
        <div className={styles.coverageGrid}>{view.scopeCoverage.coverage.map((entry) => <div key={entry.metric} className={styles.coverageItem}><strong>{entry.metric}</strong><span>{entry.kind === "not-available" ? "n.d." : entry.kind} · {entry.coveredEntities}/{entry.expectedEntities ?? "?"} entità</span><small>{entry.note}</small></div>)}</div>
        <div className={styles.sourceGrid}>{view.scopeCoverage.sources.map((source) => <article className={styles.sourceItem} key={source.id}><strong>{source.title}</strong><span>{source.publisher} · dati {sourceDate(source)}</span><a href={source.url} target="_blank" rel="noreferrer">Fonte ufficiale ↗</a>{source.license ? <small>Licenza: {source.license}</small> : null}</article>)}</div>
        <p className={styles.note}>{view.methodology.scope} Le metriche senza fonte omogenea restano n.d.; non sono stime.</p>
      </section>
    </main>
  );
}
