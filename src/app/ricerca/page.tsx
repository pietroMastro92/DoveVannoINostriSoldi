import type { Metadata } from "next";
import Link from "next/link";
import {
  compactEuroFromCents,
  integer,
  longDate,
  percent,
} from "@/lib/format";
import {
  PUBLIC_RESEARCH_CURRENT_STAFF_YEAR,
  getPublicResearchView,
  publicResearchMetricLabel,
  publicResearchYearOptions,
  type PublicResearchEntityOption,
} from "@/lib/public-research";
import type { ResearchObservation, ResearchMetric } from "@/lib/data/research-public-contract";
import styles from "./ricerca.module.css";

export const metadata: Metadata = {
  title: "Ricerca pubblica",
  description:
    "Finanziamenti, personale e precariato della ricerca pubblica italiana: FOE, università USTAT e dettaglio degli istituti CNR DSB.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function metricValue(rows: readonly ResearchObservation[], metric: ResearchMetric): number | null {
  const row = rows.find((item) => item.metric === metric);
  return row?.value ?? null;
}

function displayValue(value: number | null, metric: ResearchMetric): string {
  if (value === null) return "n.d.";
  return metric === "fundingAllocation" ? compactEuroFromCents(value) : integer(value);
}

function exactValue(value: number | null, metric: ResearchMetric): string {
  if (value === null) return "dato non disponibile";
  return metric === "fundingAllocation"
    ? `${(value / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : integer(value);
}

function hrefFor(entity?: string, year?: number, department?: string, institute?: string): string {
  const params = new URLSearchParams();
  if (entity) params.set("entity", entity);
  if (year) params.set("year", String(year));
  if (department) params.set("department", department);
  if (institute) params.set("institute", institute);
  const query = params.toString();
  return query ? `/ricerca?${query}` : "/ricerca";
}

function labelForKind(kind: PublicResearchEntityOption["kind"]): string {
  return {
    system: "Sistema",
    university: "Università",
    epr: "Ente di ricerca",
    "cnr-department": "Dipartimento CNR",
    "cnr-institute": "Istituto CNR",
  }[kind];
}

function entityOptionsByKind(options: readonly PublicResearchEntityOption[], kind: PublicResearchEntityOption["kind"]): PublicResearchEntityOption[] {
  return options.filter((option) => option.kind === kind);
}

function staffRowsByYear(rows: readonly ResearchObservation[]) {
  return publicResearchYearOptions().map((period) => ({
    year: period.year,
    permanent: metricValue(rows.filter((row) => row.year === period.year), "permanentHeadcount"),
    nonPermanent: metricValue(rows.filter((row) => row.year === period.year), "nonPermanentHeadcount"),
  })).filter((row) => row.permanent !== null || row.nonPermanent !== null);
}

export default async function PublicResearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const view = getPublicResearchView({
    year: first(params.year),
    entity: first(params.entity),
    entityKind: first(params.entityKind),
    department: first(params.department),
    institute: first(params.institute),
    metric: first(params.metric),
  });
  const selectedFunding = metricValue(view.summary.fundingAllocation, "fundingAllocation");
  const selectedPermanent = metricValue(view.summary.permanentHeadcount, "permanentHeadcount");
  const selectedAppointments = metricValue(view.summary.researchAppointmentCount, "researchAppointmentCount");
  const universityStaff = staffRowsByYear(view.universityTrend);
  const latestSource = view.sources.reduce((latest, source) => source.observedAt > latest ? source.observedAt : latest, "");
  const selectedEntityOptions = entityOptionsByKind(view.entityOptions, "epr");
  const universityOptions = entityOptionsByKind(view.entityOptions, "university");
  const systemOptions = entityOptionsByKind(view.entityOptions, "system");
  const instituteSelection = first(params.institute);
  const selectedInstitute = view.cnrInstituteRows.find((row) => row.code.localeCompare(instituteSelection ?? "", "it", { sensitivity: "base" }) === 0);
  const selectedPermanentForRatio = selectedInstitute?.permanentHeadcount ?? selectedPermanent;
  const selectedAppointmentsForRatio = selectedInstitute?.researchAppointmentCount ?? selectedAppointments;
  const precariatRatio = selectedPermanentForRatio && selectedAppointmentsForRatio !== null
    ? (selectedAppointmentsForRatio / selectedPermanentForRatio) * 100
    : null;

  return (
    <main className={`shell ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>Modulo Ricerca · MUR · CNR</span>
          <h1>Quanto è finanziata la ricerca pubblica?</h1>
          <p>
            Mettiamo nello stesso quadro finanziamenti, ricercatori e personale non strutturato,
            mantenendo separati i perimetri contabili. Per il CNR puoi scendere dal totale FOE al
            Dipartimento di scienze biomediche e ai suoi 14 istituti.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <span className="tag tag-accent">Snapshot verificato</span>
          <span>Osservato al {longDate(latestSource)}</span>
          <Link href="/metodologia">Come leggiamo i numeri →</Link>
        </div>
      </header>

      <form className={`panel ${styles.filters}`} method="get">
        <div className={styles.filterIntro}>
          <strong>Filtra il perimetro</strong>
          <span>Le selezioni non imputano il FOE alle strutture interne.</span>
        </div>
        <label>
          Anno
          <select name="year" defaultValue={String(view.year)}>
            {publicResearchYearOptions().map((period) => <option key={period.year} value={period.year}>{period.label}</option>)}
          </select>
        </label>
        <label>
          Ente
          <select name="entity" defaultValue={view.selectedEntity.code}>
            <option value="CNR">CNR</option>
            {systemOptions.map((option) => <option key={option.id} value={option.code}>{option.name}</option>)}
            {selectedEntityOptions.filter((option) => option.code !== "CNR").map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
            {universityOptions.map((option) => <option key={option.id} value={option.code}>{option.name}</option>)}
            {view.departmentOptions.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
            {view.instituteOptions.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
          </select>
        </label>
        <label>
          Dipartimento CNR
          <select name="department" defaultValue={first(params.department) ?? "all"}>
            <option value="all">Tutti / nessuno</option>
            {view.departmentOptions.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
          </select>
        </label>
        <label>
          Istituto CNR
          <select name="institute" defaultValue={first(params.institute) ?? "all"}>
            <option value="all">Tutti gli istituti</option>
            {view.instituteOptions.map((option) => <option key={option.id} value={option.code}>{option.code} · {option.name}</option>)}
          </select>
        </label>
        <button className="btn" type="submit">Applica</button>
        <Link className="btn btn-quiet" href="/ricerca">Azzera</Link>
      </form>

      <div className={styles.metricGrid}>
        <section className="panel" aria-labelledby="scope-title">
          <div className={styles.panelHead}>
            <h2 id="scope-title" className="panel-title">Perimetro selezionato</h2>
            <span className="status status-attiva">{labelForKind(view.selectedEntity.kind)}</span>
          </div>
          <strong className={styles.headline}>{displayValue(selectedFunding, "fundingAllocation")}</strong>
          <p className={styles.headlineNote}>assegnazione osservata · anno {view.year} · {view.selectedEntity.name}</p>
          <dl className={styles.factRows}>
            <div><dt>Personale strutturato</dt><dd>{displayValue(selectedPermanent, "permanentHeadcount")}</dd></div>
            <div><dt>Assegni/borse osservati</dt><dd>{displayValue(selectedAppointments, "researchAppointmentCount")}</dd></div>
            <div><dt>Anno personale DSB</dt><dd>{PUBLIC_RESEARCH_CURRENT_STAFF_YEAR}</dd></div>
            <div><dt>Copertura fonti</dt><dd>{view.sources.length} ricevute</dd></div>
          </dl>
          <p className={styles.definition}>
            {selectedFunding === null
              ? "Per questo perimetro la fonte di finanziamento non è disponibile nello snapshot."
              : `Valore esatto: ${exactValue(selectedFunding, "fundingAllocation")}. Il dato è di competenza e non è un pagamento di cassa.`}
          </p>
        </section>

        <section className={`panel ${styles.signalPanel}`} aria-labelledby="ratio-title">
          <div className={styles.panelHead}>
            <h2 id="ratio-title" className="panel-title">Struttura del personale</h2>
            <span className={styles.headNote}>schede DSB 2025</span>
          </div>
          <strong className={styles.signal}>{precariatRatio === null ? "n.d." : percent(precariatRatio)}</strong>
          <p className={styles.signalLabel}>assegni/borse osservati rispetto al personale strutturato</p>
          <p className={styles.note}>
            È un rapporto descrittivo tra conteggi amministrativi diversi: non misura il tasso di precarietà complessivo
            e non sostituisce la lettura dei contratti individuali.
          </p>
        </section>
      </div>

      <section className="panel" aria-labelledby="cnr-title">
        <div className={styles.panelHead}>
          <div>
            <span className={styles.kicker}>Drill-down CNR</span>
            <h2 id="cnr-title" className="panel-title">Dal dipartimento al singolo istituto</h2>
          </div>
          <Link href={hrefFor("CNR", view.year, view.cnrDepartment.code)}>Apri DSB →</Link>
        </div>
        <p className={styles.sectionLead}>
          Il FOE CNR resta visibile come assegnazione dell&apos;ente. Le righe sotto provengono dalle schede pubbliche del solo
          Dipartimento di scienze biomediche (DSB) e mostrano risorse assestate 2024 e personale 2025, senza attribuire il FOE.
        </p>
        <div className="table-scroll" role="region" aria-label="Istituti CNR del Dipartimento di scienze biomediche" tabIndex={0}>
          <table className="table">
            <thead><tr><th scope="col">Istituto</th><th scope="col" className="num">Strutturato 2025</th><th scope="col" className="num">Assegni/borse 2025</th><th scope="col" className="num">Risorse assestate 2024</th></tr></thead>
            <tbody>
              {view.cnrInstituteRows.map((row) => (
                <tr key={row.id} className={selectedInstitute?.id === row.id ? styles.selectedRow : undefined}>
                  <th scope="row"><Link href={hrefFor(row.code, view.year, view.cnrDepartment.code, row.code)}>{row.code}</Link><span className={styles.cellSub}>{row.name}</span></th>
                  <td className="num">{displayValue(row.permanentHeadcount, "permanentHeadcount")}</td>
                  <td className="num">{displayValue(row.researchAppointmentCount, "researchAppointmentCount")}</td>
                  <td className="num">{displayValue(row.fundingAllocation, "fundingAllocation")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>I valori DSB sono osservati nelle singole schede PDF; “risorse assestate” non equivale al bilancio completo dell&apos;istituto.</p>
      </section>

      <div className={styles.twoColumns}>
        <section className="panel" aria-labelledby="funding-trend-title">
          <div className={styles.panelHead}>
            <h2 id="funding-trend-title" className="panel-title">CNR · assegnazione FOE nel tempo</h2>
            <span className={styles.headNote}>competenza · MUR</span>
          </div>
          <div className={styles.trendGrid}>
            {view.fundingTrend.map((row) => (
              <div className={styles.trendItem} key={`${row.year}-${row.id}`}>
                <span>{row.year}</span><strong>{displayValue(row.value, "fundingAllocation")}</strong>
                <small>{row.note}</small>
              </div>
            ))}
          </div>
          <p className={styles.note}>La serie FOE è a livello di ente e non può essere sommata alle risorse assestate degli istituti DSB.</p>
        </section>

        <section className="panel" aria-labelledby="university-title">
          <div className={styles.panelHead}>
            <h2 id="university-title" className="panel-title">Università · personale osservato</h2>
            <span className={styles.headNote}>100 atenei · USTAT</span>
          </div>
          <div className="table-scroll" role="region" aria-label="Personale universitario osservato per anno" tabIndex={0}>
            <table className="table">
              <thead><tr><th scope="col">Anno</th><th scope="col" className="num">Strutturato*</th><th scope="col" className="num">Non strutturato</th></tr></thead>
              <tbody>{universityStaff.map((row) => <tr key={row.year}><th scope="row">{row.year}</th><td className="num">{displayValue(row.permanent, "permanentHeadcount")}</td><td className="num">{displayValue(row.nonPermanent, "nonPermanentHeadcount")}</td></tr>)}</tbody>
            </table>
          </div>
          <p className={styles.note}>* USTAT accorpa 3RU e 3RTD; il gruppo strutturato include quindi anche ricercatori a tempo determinato. Non sono finanziamenti.</p>
        </section>
      </div>

      <section className={`panel ${styles.coverage}`} aria-labelledby="coverage-title">
        <div className={styles.panelHead}>
          <h2 id="coverage-title" className="panel-title">Cosa c&apos;è e cosa manca</h2>
          <Link href="/fonti">Registro fonti →</Link>
        </div>
        <div className={styles.coverageGrid}>
          {view.coverage.map((entry) => <div key={entry.metric} className={styles.coverageItem}><strong>{publicResearchMetricLabel(entry.metric)}</strong><span>{entry.kind === "not-available" ? "n.d." : entry.kind} · {entry.coveredEntities}/{entry.expectedEntities ?? "?"} entità</span></div>)}
        </div>
        <p className={styles.note}>{view.methodology.scope} Le metriche di progetti, procurement e pagamenti sono lasciate n.d. invece di essere stimate.</p>
      </section>
    </main>
  );
}
