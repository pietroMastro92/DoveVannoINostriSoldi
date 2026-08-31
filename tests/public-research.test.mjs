import assert from "node:assert/strict";
import test from "node:test";
import "./helpers/register-ts-alias.mjs";

const {
  getPublicResearchView,
  normalizePublicResearchFilters,
  publicResearchSnapshot,
  queryPublicResearchDataset,
} = await import("../src/lib/public-research.ts");
const { validateResearchPublicSnapshot } = await import("../src/lib/data/research-public-contract.ts");
const { datasetCatalog, researchDatasetCatalog } = await import("../src/lib/mcp/catalog.ts");
const { PRIMARY_NAV, SITE_MAP_GROUPS } = await import("../src/lib/site-navigation.ts");

test("the public research snapshot preserves entity, department and institute grains", () => {
  assert.equal(publicResearchSnapshot.datasetId, "public_research_investment");
  assert.equal(publicResearchSnapshot.entities.filter((entity) => entity.kind === "cnr-institute").length, 14);
  assert.equal(publicResearchSnapshot.entities.filter((entity) => entity.kind === "university").length, 100);
  assert.equal(publicResearchSnapshot.observations.find((row) => row.id === "foe-cnr-2024")?.value, 73_547_509_800);
  assert.doesNotThrow(() => validateResearchPublicSnapshot(publicResearchSnapshot));
});

test("CNR view exposes the DSB drill-down and keeps FOE separate", () => {
  const view = getPublicResearchView();
  assert.equal(view.selectedEntity.code, "CNR");
  assert.equal(view.fundingTrend.length, 4);
  assert.equal(view.cnrInstituteRows.length, 14);
  assert.equal(view.cnrInstituteRows.find((row) => row.code === "IFC")?.permanentHeadcount, 207);
  assert.equal(view.cnrInstituteRows.find((row) => row.code === "IGM")?.researchAppointmentCount, 65);
  assert.equal(view.cnrInstituteRows.find((row) => row.code === "IGM")?.fundingAllocation, 580_000_000);
  const university = getPublicResearchView({ entityKind: "university" });
  assert.equal(university.selectedEntity.kind, "system");
  assert.equal(university.universityTrend.length, 10);
  assert.equal(getPublicResearchView({ department: "DSB" }).selectedEntity.code, "DSB");
  assert.equal(getPublicResearchView({ institute: "IFC" }).selectedEntity.code, "IFC");
});

test("research dataset query has closed filters and bounded pagination", () => {
  const result = queryPublicResearchDataset({ entity: "DSB", department: "DSB", year: 2025, limit: 3 });
  assert.equal(result.dataset, "public_research_investment");
  assert.equal(result.pagination.returned, 3);
  assert.ok(result.data.every((row) => row.entity.kind === "cnr-institute"));
  assert.ok(result.data.every((row) => row.year === 2025));
  assert.throws(() => normalizePublicResearchFilters({ department: "non-esistente" }), /Dipartimento CNR non trovato/);
  assert.throws(() => queryPublicResearchDataset({ metric: "not-a-metric" }), /Metrica ricerca non riconosciuta/);
});

test("research dataset is discoverable in MCP and navigation", () => {
  assert.ok(datasetCatalog.some((dataset) => dataset.id === "public_research_investment"));
  assert.equal(researchDatasetCatalog.length, 1);
  const descriptor = researchDatasetCatalog[0];
  assert.deepEqual(descriptor.filters, ["year", "entity", "entityKind", "department", "institute", "metric", "limit", "offset"]);
  assert.ok(descriptor.sources.every((source) => source.url && source.owner));
  assert.equal(PRIMARY_NAV.find((item) => item.href === "/ricerca")?.label, "Ricerca pubblica");
  assert.ok(SITE_MAP_GROUPS.find((group) => group.title === "Ricerca pubblica")?.links.some((link) => link.href === "/ricerca?department=DSB"));
});
