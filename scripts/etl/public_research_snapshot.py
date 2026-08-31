#!/usr/bin/env python3
"""Build the public-research snapshot from official, aggregate sources.

The snapshot joins three grains without pretending they are one accounting
system: MUR FOE is entity-level funding, USTAT is university personnel, and
CNR DSB sheets are observed department/institute facts.  No individual names
or identifiers are retained.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "src/data/generated/public-research-snapshot.json"
USTAT_URL = (
    "https://dati-ustat.mur.gov.it/dataset/263a4704-a5cb-46c3-9062-4f977c9fd3e7/"
    "resource/46015a92-abe3-411c-af07-2532164cab59/download/personale_xgenere.csv"
)
USTAT_LANDING_URL = "https://dati-ustat.mur.gov.it/dataset/263a4704-a5cb-46c3-9062-4f977c9fd3e7"
FOE_LANDING_URL = "https://www.mur.gov.it/it/aree-tematiche/ricerca/il-sistema-della-ricerca/enti-di-ricerca-pubblici/finanziamenti"
DSB_LANDING_URL = "https://dsb.cnr.it/istituti"
OBSERVED_AT_DEFAULT = "2026-08-30T00:00:00+02:00"

PERMANENT_CODES = frozenset({"1PO e 2PA", "3RU e 3RTD"})
NON_PERMANENT_CODES = frozenset({"4AR", "5PC", "6CR", "7CL"})

# Values transcribed from the official MUR FOE summary tables (euro).
FOE_VALUES: dict[int, dict[str, int]] = {
    2021: {"CNR": 665_327_765},
    2022: {"CNR": 685_307_765},
    2023: {
        "CNR": 709_195_432,
        "INAF": 149_077_469,
        "INFN": 345_940_943,
        "INGV": 81_505_670,
        "INRIM": 30_216_873,
        "OGS": 23_763_157,
        "SZD": 16_751_516,
        "AREA": 32_756_058,
        "INDAM": 3_554_164,
        "GERMANICI": 2_078_808,
        "FERMI": 3_624_862,
    },
    2024: {
        "CNR": 735_475_098,
        "INAF": 150_429_426,
        "INFN": 350_321_830,
        "INGV": 83_743_626,
        "INRIM": 30_056_209,
        "OGS": 24_941_997,
        "SZD": 17_260_263,
        "AREA": 34_433_040,
        "INDAM": 3_573_670,
        "GERMANICI": 2_127_260,
        "FERMI": 3_678_503,
    },
}

FOE_SOURCES = {
    2021: {
        "url": "https://www.mur.gov.it/sites/default/files/2021-08/D.M.%20n.%20844%20Tabelle%20FOE%202021.pdf",
        "sha256": "b2a276822c4f3f012e2ca6099555850d808b45496fd4ca852ea23399625360a1",
        "title": "MUR · Tabelle FOE 2021",
    },
    2022: {
        "url": "https://www.mur.gov.it/sites/default/files/2024-04/DM%20n.%20571%20Tabella%201.pdf",
        "sha256": "113f2f4836b731d36c72c28d06ad85b03c54ed3c71997f97c9df0ab0091407ae",
        "title": "MUR · Tabella FOE 2022",
    },
    2023: {
        "url": "https://www.mur.gov.it/sites/default/files/2023-08/Decreto%20Ministeriale%20n.%20789%20TAB%201%20RIEPILOGO.pdf",
        "sha256": "57d12291db6e76db077ded03fc62b9183734821668192d6eb77cdf2857743930",
        "title": "MUR · Riepilogo FOE 2023",
    },
    2024: {
        "url": "https://www.mur.gov.it/sites/default/files/2024-09/DM%20n.%201096%20-%20FOE%202024%20ALLEGATI.zip",
        "sha256": "50cdb507582b640e479a4046a088b66914b31d7dd0786456c97cc54299f991b0",
        "title": "MUR · Allegati FOE 2024",
    },
}

# Current values printed in the fourteen official CNR DSB institute sheets.
DSB_INSTITUTES: dict[str, dict[str, Any]] = {
    "IBB": {"name": "Istituto di Biostrutture e Bioimmagini", "permanent": 96, "appointments": 26, "funding": 1_400_000, "sha256": "306020d500f8bfddcefad0bbd751cb164f6dccdcf4e81f140e0c5c3254638eb0"},
    "IBBC": {"name": "Istituto di Biochimica e Biologia Cellulare", "permanent": 102, "appointments": 18, "funding": 1_000_000, "sha256": "67245416b0eb5f8b711bf36681b3b88e7ab1ed59191f0e77a2c1509c335b3da3"},
    "IBIOM": {"name": "Istituto di Biomembrane, Bioenergetica e Biotecnologie Molecolari", "permanent": 39, "appointments": 3, "funding": 1_000_000, "sha256": "263ec36ca83128b0ff19f6acc1fb5dab0a83af9b0f4af823ba022742a5bfb8ee"},
    "IBPM": {"name": "Istituto di Biologia e Patologia Molecolari", "permanent": 71, "appointments": 23, "funding": 1_100_000, "sha256": "d6157605bfbcdbc47dcd857c3a9d85c16e6ca33fbcd7b2b648554c8d9b651872"},
    "IBSBC": {"name": "Istituto di Bioimmagini e Sistemi Biologici Complessi", "permanent": 38, "appointments": 17, "funding": 400_000, "sha256": "5e486f2e988b865595790f1f1eb8f4c40acbf42f6e2ca74346686374d3b7f361"},
    "IEOMI": {"name": "Istituto degli Endotipi in Oncologia, Metabolismo e Immunologia", "permanent": 103, "appointments": 29, "funding": 1_700_000, "sha256": "27c726eadb718d54b076bf18bf60ced4031787a3ed6c0eef0807eb0f2401d3bf"},
    "IFC": {"name": "Istituto di Fisiologia Clinica", "permanent": 207, "appointments": 63, "funding": 3_400_000, "sha256": "9631eedd7aa85889df5b3cf539b9440c0d1a90b1db3d7610642d7d5663741078"},
    "IFT": {"name": "Istituto di Farmacologia Traslazionale", "permanent": 102, "appointments": 15, "funding": 700_000, "sha256": "f831e22db3301210be30344391a03b8da3d6fab5b633051c451efa5bc9633dc4"},
    "IGB": {"name": "Istituto di Genetica e Biofisica", "permanent": 82, "appointments": 20, "funding": 1_700_000, "sha256": "421ebfaf28d04a14c428f128122fce1d91ee194b17884e3aec4a9e9365a19d39"},
    "IGM": {"name": "Istituto di Genetica Molecolare", "permanent": 67, "appointments": 65, "funding": 5_800_000, "sha256": "fe178e542ad065bd2b8fd00912950b13d12c7ab6a6ac78dfc745a81e2931bcde"},
    "IN": {"name": "Istituto di Neuroscienze", "permanent": 120, "appointments": 53, "funding": 3_500_000, "sha256": "ee17b6c621cb2ba4380864bd1352d5e07a18d0cbf965808a21e340976e5d1f90"},
    "IRGB": {"name": "Istituto di Ricerca Genetica e Biomedica", "permanent": 97, "appointments": 25, "funding": 2_600_000, "sha256": "8931af816295f391b282ca2cb7675cf20fe356793638f4936f5d91664400e9c8"},
    "IRIB": {"name": "Istituto per la Ricerca e l'Innovazione Biomedica", "permanent": 107, "appointments": 49, "funding": 3_600_000, "sha256": "17497339ea1614b6abec1841933285d49e05ad71075f813ce7c626a3eddbbf98"},
    "ITB": {"name": "Istituto di Tecnologie Biomediche", "permanent": 74, "appointments": 12, "funding": 900_000, "sha256": "df46e85ba1164aec9d885f14a53d200c16471f1cba1cf7e9bc76a3df165f6432"},
}

EPR_NAMES = {
    "CNR": "Consiglio Nazionale delle Ricerche",
    "INAF": "Istituto Nazionale di Astrofisica",
    "INFN": "Istituto Nazionale di Fisica Nucleare",
    "INGV": "Istituto Nazionale di Geofisica e Vulcanologia",
    "INRIM": "Istituto Nazionale di Ricerca Metrologica",
    "OGS": "Istituto Nazionale di Oceanografia e di Geofisica Sperimentale",
    "SZD": "Stazione Zoologica Anton Dohrn",
    "AREA": "AREA Science Park",
    "INDAM": "Istituto Nazionale di Alta Matematica",
    "GERMANICI": "Istituto Italiano di Studi Germanici",
    "FERMI": "Museo Storico della Fisica e Centro Studi e Ricerche Enrico Fermi",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def source_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "DoveVannoINostriSoldi public research ETL"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def parse_int(value: str, field: str, line: int) -> int:
    text = (value or "").strip()
    if not re.fullmatch(r"\d+", text):
        raise ValueError(f"Valore {field} non valido alla riga CSV {line}: {value!r}")
    return int(text)


def read_ustat(payload: bytes) -> list[dict[str, str]]:
    try:
        text = payload.decode("cp1252")
    except UnicodeDecodeError as error:
        raise ValueError("CSV USTAT non decodificabile come cp1252") from error
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=";")
    expected = ("ANNO", "COD_ATENEO", "NOME_ATENEO", "Reg_ATENEO", "AREA_GEO", "GENERE", "COD_QUALIFICA", "DESC_QUALIFICA", "N_PERS")
    if tuple(reader.fieldnames or ()) != expected:
        raise ValueError(f"Intestazione USTAT inattesa: {reader.fieldnames!r}")
    rows: list[dict[str, str]] = []
    seen: set[tuple[str, ...]] = set()
    for line, row in enumerate(reader, start=2):
        if not any((value or "").strip() for value in row.values()):
            continue
        key = tuple((row.get(field) or "").strip() for field in ("ANNO", "COD_ATENEO", "GENERE", "COD_QUALIFICA"))
        if key in seen:
            raise ValueError(f"Riga USTAT duplicata alla riga {line}: {key}")
        seen.add(key)
        year = parse_int(row.get("ANNO", ""), "ANNO", line)
        if not 2020 <= year <= 2024:
            raise ValueError(f"Anno USTAT inatteso alla riga {line}: {year}")
        if row.get("GENERE") not in {"F", "M"}:
            raise ValueError(f"Genere USTAT inatteso alla riga {line}")
        if row.get("COD_QUALIFICA") not in PERMANENT_CODES | NON_PERMANENT_CODES | {"7TA"}:
            raise ValueError(f"Qualifica USTAT inattesa alla riga {line}: {row.get('COD_QUALIFICA')!r}")
        row["N_PERS"] = str(parse_int(row.get("N_PERS", ""), "N_PERS", line))
        rows.append({key: (value or "").strip() for key, value in row.items()})
    if not rows:
        raise ValueError("CSV USTAT vuoto")
    return rows


def base_source(
    source_id: str,
    title: str,
    publisher: str,
    url: str,
    landing_url: str,
    fmt: str,
    observed_at: str,
    cadence: str,
    coverage: str,
    caveat: str,
    digest: str | None = None,
    license_name: str | None = None,
    license_url: str | None = None,
) -> dict[str, Any]:
    return {
        "id": source_id,
        "title": title,
        "publisher": publisher,
        "url": url,
        "landingUrl": landing_url,
        "format": fmt,
        "license": license_name,
        "licenseUrl": license_url,
        "publishedAt": None,
        "dataAsOf": None,
        "observedAt": observed_at,
        "cadence": cadence,
        "coverage": coverage,
        "caveat": caveat,
        "sha256": digest,
    }


def entity(entity_id: str, kind: str, code: str, name: str, parent_id: str | None, source_ids: list[str], scheme: str = "custom") -> dict[str, Any]:
    return {
        "id": entity_id,
        "kind": kind,
        "code": code,
        "name": name,
        "parentId": parent_id,
        "identifiers": [{"scheme": scheme, "value": code}],
        "sourceIds": source_ids,
    }


def observation(
    obs_id: str,
    entity_id: str,
    year: int,
    metric: str,
    value: int,
    comparability_key: str,
    scope: str,
    coverage: str,
    source_ids: list[str],
    note: str,
    accounting_basis: str = "administrative-record",
) -> dict[str, Any]:
    money = metric in {"fundingAllocation", "cashPayment", "economicCost", "researchAppointmentGross", "procurementAwarded", "procurementLiquidated", "projectCost", "projectPayment"}
    measures = {
        "fundingAllocation": "allocation", "cashPayment": "payment", "economicCost": "cost",
        "permanentHeadcount": "headcount", "nonPermanentHeadcount": "headcount", "researchAppointmentCount": "appointment",
        "researchAppointmentGross": "appointment", "procurementAwarded": "procurement-award", "procurementLiquidated": "procurement-payment",
        "projectCost": "project-cost", "projectPayment": "project-payment",
    }
    return {
        "id": obs_id,
        "entityId": entity_id,
        "year": year,
        "metric": metric,
        "measure": measures[metric],
        "accountingBasis": accounting_basis,
        "unit": "euro-cents" if money else "count",
        "value": value * 100 if money else value,
        "comparabilityKey": comparability_key,
        "scope": scope,
        "coverage": coverage,
        "sourceIds": source_ids,
        "note": note,
    }


def build_snapshot(ustat_payload: bytes, observed_at: str) -> dict[str, Any]:
    ustat_rows = read_ustat(ustat_payload)
    ustat_digest = sha256(ustat_payload)
    sources: list[dict[str, Any]] = [
        base_source(
            "ustat-personale",
            "USTAT · Personale universitario 2020-2024",
            "Ministero dell'Università e della Ricerca",
            USTAT_URL,
            USTAT_LANDING_URL,
            "csv",
            observed_at,
            "annuale",
            "100 atenei; personale per genere e qualifica, 2020-2024",
            "Le qualifiche 3RU e 3RTD sono pubblicate in un'unica categoria: il gruppo strutturato include quindi anche ricercatori a tempo determinato. I dati non sono una misura dei finanziamenti universitari.",
            ustat_digest,
            "IODL 2.0",
            "http://www.dati.gov.it/content/italian-open-data-license-v20",
        ),
        base_source(
            "cnr-dsb-index",
            "CNR · Dipartimento di scienze biomediche · elenco istituti",
            "Consiglio Nazionale delle Ricerche",
            DSB_LANDING_URL,
            DSB_LANDING_URL,
            "html",
            observed_at,
            "annuale",
            "Istituti afferenti al Dipartimento di scienze biomediche",
            "Il dipartimento DSB è una parte del CNR; le sue schede non costituiscono il bilancio completo dell'ente.",
        ),
    ]
    for year, spec in FOE_SOURCES.items():
        sources.append(base_source(
            f"mur-foe-{year}", spec["title"], "Ministero dell'Università e della Ricerca",
            spec["url"], FOE_LANDING_URL, "zip" if year == 2024 else "pdf", observed_at, "annuale",
            f"Assegnazioni FOE agli enti di ricerca pubblici, tabella di riepilogo {year}",
            "Importi di competenza assegnati a livello di ente. Il FOE non viene ripartito artificialmente tra dipartimenti o istituti CNR.", spec["sha256"],
        ))
    for code, info in DSB_INSTITUTES.items():
        sources.append(base_source(
            f"cnr-dsb-{code.lower()}-2025", f"CNR DSB · scheda istituto {code} 2025", "Consiglio Nazionale delle Ricerche",
            f"https://dsb.cnr.it/schede2025/pdf/{code}.pdf", DSB_LANDING_URL, "pdf", observed_at, "annuale",
            "Risorse umane e risorse finanziarie assestate pubblicate nella scheda 2025",
            "La scheda riporta personale 2025 e risorse finanziarie assestate 2024 osservate; non è un conto economico completo dell'istituto.", info["sha256"],
        ))

    entities: list[dict[str, Any]] = [entity("research-system", "system", "IT-RICERCA", "Sistema pubblico della ricerca osservato", None, ["ustat-personale"])]
    entities.extend(entity(f"epr-{code.lower()}", "epr", code, name, "research-system", [f"mur-foe-{year}" for year in FOE_VALUES if code in FOE_VALUES[year]]) for code, name in EPR_NAMES.items())
    entities.append(entity("cnr-dsb", "cnr-department", "DSB", "Dipartimento di scienze biomediche", "epr-cnr", ["cnr-dsb-index"]))
    for code, info in DSB_INSTITUTES.items():
        entities.append(entity(f"cnr-{code.lower()}", "cnr-institute", code, info["name"], "cnr-dsb", [f"cnr-dsb-{code.lower()}-2025"], "cnr-cds"))

    university_keys = sorted({(row["COD_ATENEO"], row["NOME_ATENEO"]) for row in ustat_rows})
    for code, name in university_keys:
        entities.append(entity(f"university-{code}", "university", code, name, "research-system", ["ustat-personale"], "custom"))

    observations: list[dict[str, Any]] = []
    # USTAT: aggregate all public university staff rows by university/year.
    totals: dict[tuple[str, int], dict[str, int]] = defaultdict(lambda: {"permanent": 0, "nonPermanent": 0})
    for row in ustat_rows:
        code, year = row["COD_ATENEO"], int(row["ANNO"])
        value = int(row["N_PERS"])
        if row["COD_QUALIFICA"] in PERMANENT_CODES:
            totals[(code, year)]["permanent"] += value
        elif row["COD_QUALIFICA"] in NON_PERMANENT_CODES:
            totals[(code, year)]["nonPermanent"] += value
    for (code, year), values in sorted(totals.items()):
        for metric, key in (("permanentHeadcount", "permanent"), ("nonPermanentHeadcount", "nonPermanent")):
            observations.append(observation(
                f"ustat-{code}-{year}-{key}", f"university-{code}", year, metric, values[key],
                "ustat-personale-qualifica", "Ateneo · personale per qualifica USTAT", "partial", ["ustat-personale"],
                "Dato aggregato per Ateneo. La qualifica 3RU e 3RTD non separa ricercatori a tempo indeterminato e determinato.",
                "headcount",
            ))
    for year in range(2020, 2025):
        values = {key: sum(row[key] for (code, item_year), row in totals.items() if item_year == year) for key in ("permanent", "nonPermanent")}
        for metric, key in (("permanentHeadcount", "permanent"), ("nonPermanentHeadcount", "nonPermanent")):
            observations.append(observation(
                f"ustat-system-{year}-{key}", "research-system", year, metric, values[key],
                "ustat-personale-qualifica", "100 atenei USTAT · personale per qualifica", "complete", ["ustat-personale"],
                "Totale dei 100 atenei presenti nel file USTAT; non include il personale degli enti pubblici di ricerca.",
                "headcount",
            ))

    # FOE: entity-level funding only.  2024 is distributed from the official zip summary.
    for year, values in FOE_VALUES.items():
        source_id = f"mur-foe-{year}"
        for code, euros in values.items():
            observations.append(observation(
                f"foe-{code.lower()}-{year}", f"epr-{code.lower()}", year, "fundingAllocation", euros,
                "mur-foe-assigned-competence", "FOE · assegnazione di competenza a livello di ente", "observed", [source_id],
                "Importo totale assegnato nella tabella FOE MUR; non è un pagamento di cassa e non è ripartito per struttura interna.",
                "competence",
            ))

    # CNR DSB: current institute-level observations from the public sheets.
    for code, info in DSB_INSTITUTES.items():
        entity_id = f"cnr-{code.lower()}"
        source_id = f"cnr-dsb-{code.lower()}-2025"
        observations.extend((
            observation(f"dsb-{code.lower()}-2025-permanent", entity_id, 2025, "permanentHeadcount", info["permanent"], "cnr-dsb-personale-2025", "CNR DSB · unità di personale riportate nella scheda 2025", "observed", [source_id], "Unità di personale strutturato/di ruolo riportate dalla scheda CNR DSB 2025.", "headcount"),
            observation(f"dsb-{code.lower()}-2025-appointments", entity_id, 2025, "researchAppointmentCount", info["appointments"], "cnr-dsb-personale-non-strutturato-2025", "CNR DSB · assegni, borse di studio e simili riportati nella scheda 2025", "observed", [source_id], "Conteggio della voce aggregata 'Assegni, borse di studio, etc...'; non identifica persone e non equivale a tutti i contratti precari.", "administrative-record"),
            observation(f"dsb-{code.lower()}-2024-funding", entity_id, 2024, "fundingAllocation", info["funding"], "cnr-dsb-risorse-assestate-2024", "CNR DSB · risorse finanziarie assestate 2024 nella scheda istituto 2025", "observed", [source_id], "Valore osservato nella scheda DSB; non è il bilancio completo dell'istituto e non è confrontabile con il FOE CNR senza un perimetro contabile comune.", "competence"),
        ))

    observed_metrics = {row["metric"] for row in observations}
    all_entity_count = len(entities)
    covered_by_metric = {metric: len({row["entityId"] for row in observations if row["metric"] == metric}) for metric in observed_metrics}
    coverage = []
    for metric in ("fundingAllocation", "cashPayment", "economicCost", "permanentHeadcount", "nonPermanentHeadcount", "researchAppointmentCount", "researchAppointmentGross", "procurementAwarded", "procurementLiquidated", "projectCost", "projectPayment"):
        covered = covered_by_metric.get(metric, 0)
        if covered == 0:
            kind = "not-available"
        elif covered == all_entity_count:
            kind = "complete"
        elif metric in {"permanentHeadcount", "nonPermanentHeadcount"}:
            kind = "partial"
        else:
            kind = "observed"
        note = {
            "fundingAllocation": "FOE a livello di ente e risorse assestate solo per i 14 istituti DSB; nessuna ripartizione FOE interna al CNR.",
            "permanentHeadcount": "Personale USTAT 2020-2024 per 100 atenei e personale 2025 osservato per 14 istituti DSB.",
            "nonPermanentHeadcount": "Precariato universitario aggregato per qualifica USTAT; la scheda DSB usa una voce diversa e resta separata.",
            "researchAppointmentCount": "Solo conteggio 'assegni, borse di studio, etc.' delle 14 schede DSB 2025.",
        }.get(metric, "La fonte ufficiale non è ancora disponibile in questo snapshot.")
        coverage.append({"metric": metric, "kind": kind, "coveredEntities": covered, "expectedEntities": all_entity_count, "note": note})

    return {
        "schemaVersion": 1,
        "datasetId": "public_research_investment",
        "generatedAt": observed_at,
        "verifiedAt": observed_at,
        "periods": [{"year": year, "label": str(year)} for year in range(2020, 2026)],
        "entities": entities,
        "sources": sources,
        "observations": observations,
        "coverage": coverage,
        "methodology": {
            "accounting": "FOE è assegnazione di competenza a livello di ente; USTAT e CNR DSB sono conteggi amministrativi di personale; le metriche non vengono sommate tra basi diverse.",
            "comparability": "Si confrontano solo righe con stessa metrica, misura, unità, base, comparabilityKey e scope. Il FOE CNR non viene allocato a dipartimenti o istituti.",
            "privacy": "Sono pubblicati solo aggregati per ente/struttura e anno. Nomi di persone, email, codici fiscali e record individuali sono esclusi.",
            "scope": "Il perimetro unisce 100 atenei USTAT, FOE di enti pubblici di ricerca e i 14 istituti del solo Dipartimento CNR DSB; progetti, procurement e pagamenti non sono ancora disponibili.",
        },
    }


def assert_snapshot(snapshot: dict[str, Any]) -> None:
    required = {"schemaVersion", "datasetId", "generatedAt", "verifiedAt", "periods", "entities", "sources", "observations", "coverage", "methodology"}
    if set(snapshot) != required or snapshot["schemaVersion"] != 1 or snapshot["datasetId"] != "public_research_investment":
        raise ValueError("Schema snapshot ricerca pubblica inatteso")
    years = {item["year"] for item in snapshot["periods"]}
    if years != set(range(2020, 2026)):
        raise ValueError("Periodi ricerca pubblica inattesi")
    entity_ids = {item["id"] for item in snapshot["entities"]}
    source_ids = {item["id"] for item in snapshot["sources"]}
    if len(entity_ids) != len(snapshot["entities"]) or len(source_ids) != len(snapshot["sources"]):
        raise ValueError("ID ricerca pubblica duplicati")
    if any(item.get("parentId") is not None and item["parentId"] not in entity_ids for item in snapshot["entities"]):
        raise ValueError("Parent ricerca pubblica non risolto")
    keys: set[tuple[Any, ...]] = set()
    for row in snapshot["observations"]:
        if row["entityId"] not in entity_ids or row["year"] not in years or any(item not in source_ids for item in row["sourceIds"]):
            raise ValueError(f"Riferimento osservazione non risolto: {row.get('id')}")
        if row["value"] < 0 or (row["unit"] != "fte" and not isinstance(row["value"], int)):
            raise ValueError(f"Valore osservazione non valido: {row.get('id')}")
        key = (row["entityId"], row["year"], row["metric"], row["comparabilityKey"])
        if key in keys:
            raise ValueError(f"Osservazione ricerca duplicata: {key}")
        keys.add(key)
        if re.search(r"@|\b(?:nome|cognome|email|telefono)\b", json.dumps(row, ensure_ascii=False), re.IGNORECASE):
            raise ValueError(f"Possibile PII nell'osservazione: {row.get('id')}")
    if len({entry["metric"] for entry in snapshot["coverage"]}) != len(snapshot["coverage"]):
        raise ValueError("Metriche di copertura duplicate")
    if not snapshot["observations"]:
        raise ValueError("Snapshot senza osservazioni")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--ustat-csv", type=Path, help="CSV USTAT già scaricato; senza questo argomento viene usata la fonte online")
    parser.add_argument("--observed-at", default=OBSERVED_AT_DEFAULT)
    parser.add_argument("--check", action="store_true", help="Valida lo snapshot già committato senza rete")
    args = parser.parse_args(argv)
    try:
        if args.check:
            snapshot = json.loads(args.output.read_text(encoding="utf-8"))
            assert_snapshot(snapshot)
            print(f"OK: {args.output}")
            return 0
        payload = args.ustat_csv.read_bytes() if args.ustat_csv else source_bytes(USTAT_URL)
        snapshot = build_snapshot(payload, args.observed_at)
        assert_snapshot(snapshot)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Generato {args.output} ({len(snapshot['observations'])} osservazioni, {len(snapshot['entities'])} entità)")
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Errore ETL ricerca pubblica: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
