"""Offline checks for the public-research source contract and ETL."""

from __future__ import annotations

import csv
import io
import json
import unittest
from pathlib import Path

from scripts.etl import public_research_snapshot as etl


ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "src/data/generated/public-research-snapshot.json"


def ustat_csv(rows: list[dict[str, str]]) -> bytes:
    fields = ("ANNO", "COD_ATENEO", "NOME_ATENEO", "Reg_ATENEO", "AREA_GEO", "GENERE", "COD_QUALIFICA", "DESC_QUALIFICA", "N_PERS")
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, delimiter=";", lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("cp1252")


def row(**overrides: str) -> dict[str, str]:
    value = {
        "ANNO": "2024",
        "COD_ATENEO": "00101",
        "NOME_ATENEO": "Università di prova",
        "Reg_ATENEO": "Lazio",
        "AREA_GEO": "CENTRO",
        "GENERE": "F",
        "COD_QUALIFICA": "1PO e 2PA",
        "DESC_QUALIFICA": "Professore",
        "N_PERS": "3",
    }
    value.update(overrides)
    return value


class PublicResearchSnapshotTests(unittest.TestCase):
    def test_committed_snapshot_reconciles_and_is_granular(self) -> None:
        snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
        etl.assert_snapshot(snapshot)
        self.assertEqual(len(snapshot["entities"]), 127)
        self.assertEqual(len(snapshot["observations"]), 1062)
        institutes = [entity for entity in snapshot["entities"] if entity["kind"] == "cnr-institute"]
        self.assertEqual(len(institutes), 14)
        self.assertEqual({entity["parentId"] for entity in institutes}, {"cnr-dsb"})
        foe_2024 = next(row for row in snapshot["observations"] if row["id"] == "foe-cnr-2024")
        self.assertEqual(foe_2024["value"], 73_547_509_800)
        ifc = next(row for row in snapshot["observations"] if row["id"] == "dsb-ifc-2025-permanent")
        self.assertEqual(ifc["value"], 207)
        self.assertNotIn("@", json.dumps(snapshot, ensure_ascii=False))
        self.assertTrue(all("email" not in row and "nomePersona" not in row for row in snapshot["observations"]))

    def test_ustat_parser_rejects_duplicate_rows(self) -> None:
        payload = ustat_csv([row(), row()])
        with self.assertRaisesRegex(ValueError, "duplicata"):
            etl.read_ustat(payload)

    def test_ustat_parser_rejects_unknown_qualification(self) -> None:
        with self.assertRaisesRegex(ValueError, "Qualifica USTAT inattesa"):
            etl.read_ustat(ustat_csv([row(COD_QUALIFICA="sconosciuta")]))

    def test_fixture_build_keeps_metrics_separate(self) -> None:
        payload = ustat_csv([
            row(GENERE="F", COD_QUALIFICA="1PO e 2PA", N_PERS="3"),
            row(GENERE="M", COD_QUALIFICA="3RU e 3RTD", N_PERS="2"),
            row(GENERE="F", COD_QUALIFICA="4AR", N_PERS="4"),
        ])
        snapshot = etl.build_snapshot(payload, "2026-08-30T00:00:00+02:00")
        etl.assert_snapshot(snapshot)
        university = [row for row in snapshot["observations"] if row["entityId"] == "university-00101" and row["year"] == 2024]
        values = {row["metric"]: row["value"] for row in university}
        self.assertEqual(values["permanentHeadcount"], 5)
        self.assertEqual(values["nonPermanentHeadcount"], 4)
        self.assertTrue(any(row["metric"] == "fundingAllocation" and row["entityId"] == "epr-cnr" for row in snapshot["observations"]))


if __name__ == "__main__":
    unittest.main()
