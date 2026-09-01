import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server.js";
import "./helpers/register-ts-alias.mjs";

const { GET } = await import("../src/app/api/ricerca/route.ts");

async function responseFor(search = "") {
  const response = GET(new NextRequest(`https://example.test/api/ricerca${search}`));
  return { response, body: await response.json() };
}

test("the research API exposes a scoped, paginated result", async () => {
  const { response, body } = await responseFor("?scope=epr&year=2024&metric=fundingAllocation&limit=2");
  assert.equal(response.status, 200);
  assert.equal(body.query.scope, "epr");
  assert.equal(body.query.year, 2024);
  assert.equal(body.pagination.returned, 2);
  assert.ok(body.data.every((row) => row.entity.kind === "epr" && row.year === 2024));
  assert.match(response.headers.get("cache-control") ?? "", /s-maxage=3600/);
});

test("the research API rejects ambiguous and incompatible filters", async () => {
  const duplicate = await responseFor("?scope=cnr&scope=epr");
  assert.equal(duplicate.response.status, 400);
  assert.equal(duplicate.body.code, "invalid_parameter");

  const unknown = await responseFor("?scope=cnr&unsupported=yes");
  assert.equal(unknown.response.status, 400);
  assert.match(unknown.body.error, /non supportato/);

  const incompatible = await responseFor("?scope=epr&entity=CNR");
  assert.equal(incompatible.response.status, 400);
  assert.match(incompatible.body.error, /non appartiene all'ambito/);
});

test("the research API keeps historical baseline queryable while UI years start at 2024", async () => {
  const { response, body } = await responseFor("?scope=cnr&year=2023&metric=fundingAllocation&limit=1");
  assert.equal(response.status, 200);
  assert.equal(body.data[0].year, 2023);
  const current = await responseFor("?scope=cnr&year=2024&metric=fundingAllocation&limit=1");
  assert.equal(current.response.status, 200);
  assert.equal(current.body.data[0].year, 2024);
});
