import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../src/app/ricerca/page.tsx", import.meta.url), "utf8");
const filters = readFileSync(new URL("../src/components/public-research-filters.tsx", import.meta.url), "utf8");

test("research UI keeps the three scopes mutually exclusive", () => {
  assert.match(page, /scope === "cnr"/);
  assert.match(page, /scope === "epr"/);
  assert.match(page, /scope === "university"/);
  assert.match(filters, /data-research-filter="scope"/);
  assert.match(filters, /disabled=\{instituteOptions\.length === 0\}/);
});

test("research UI exposes bounded comparisons and exact table equivalents", () => {
  assert.match(page, /comparisonRows\.length >= 2/);
  assert.match(page, /name=\{`compare\$\{index \+ 1\}`\}/);
  assert.match(page, /Valori esatti/);
  assert.match(page, /table-scroll/);
  assert.match(page, /scope=\{scope\}/);
});

test("research UI declares missing-year states instead of falling back silently", () => {
  assert.match(page, /non pubblica ancora un dato: viene mostrato n\.d\., senza riportare il 2024/);
  assert.match(page, /non è presente un’assegnazione FOE osservata/);
});
