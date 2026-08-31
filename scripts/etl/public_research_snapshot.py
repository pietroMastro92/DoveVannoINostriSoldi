#!/usr/bin/env python3
"""Build the public-research snapshot from official, aggregate sources.

The snapshot joins several grains without pretending they are one accounting
system: MUR FOE is entity-level funding, USTAT is university personnel, the
CNR directory supplies the seven-department/83-institute hierarchy, and CNR
DSB sheets supply observed department/institute facts.  No individual names
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
CNR_STRUCTURE_URL = "https://www.cnr.it/it/istituti"
CNR_STRUCTURE_LANDING_URL = "https://www.cnr.it/it/dipartimenti"
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
    2025: {
        "CNR": 735_609_098,
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
    2025: {
        "url": "https://www.mur.gov.it/it/atti-e-normativa/decreto-ministeriale-n-437-del-27-06-2025",
        "sha256": "9f39e1b03a4949304741c186ce70353e2406303b7efcab26b48ff26647e6895b",
        "title": "MUR · Decreto FOE 2025",
    },
}

# Current values and historical series printed in the fourteen official CNR
# DSB institute sheets.  The financial series are millions of euros in the
# source chart, converted here to integer euros before the snapshot stores
# euro-cents.
DSB_INSTITUTES: dict[str, dict[str, Any]] = {
    "IBB": {"name": "Istituto di biostrutture e bioimmagini", "permanent": 96, "researchers": 62, "appointments": 26, "assessed": {2021: 3_200_000, 2022: 1_800_000, 2023: 6_300_000, 2024: 1_400_000}, "infrastructure": 6_600_000, "projects": 6, "sha256": "306020d500f8bfddcefad0bbd751cb164f6dccdcf4e81f140e0c5c3254638eb0"},
    "IBBC": {"name": "Istituto di Biochimica e Biologia Cellulare", "permanent": 102, "researchers": 69, "appointments": 18, "assessed": {2021: 2_300_000, 2022: 2_000_000, 2023: 3_500_000, 2024: 1_000_000}, "infrastructure": 375_000, "projects": 3, "sha256": "67245416b0eb5f8b711bf36681b3b88e7ab1ed59191f0e77a2c1509c335b3da3"},
    "IBIOM": {"name": "Istituto di Biomembrane, Bioenergetica e Biotecnologie Molecolari", "permanent": 39, "researchers": 22, "appointments": 3, "assessed": {2021: 1_400_000, 2022: 1_600_000, 2023: 4_100_000, 2024: 1_000_000}, "infrastructure": 3_100_000, "projects": 1, "sha256": "263ec36ca83128b0ff19f6acc1fb5dab0a83af9b0f4af823ba022742a5bfb8ee"},
    "IBPM": {"name": "Istituto di biologia e patologia molecolari", "permanent": 71, "researchers": 61, "appointments": 23, "assessed": {2021: 1_600_000, 2022: 1_200_000, 2023: 4_000_000, 2024: 1_100_000}, "infrastructure": 2_200_000, "projects": 7, "sha256": "d6157605bfbcdbc47dcd857c3a9d85c16e6ca33fbcd7b2b648554c8d9b651872"},
    "IBSBC": {"name": "Istituto di Bioimmagini e Sistemi Biologici Complessi", "permanent": 38, "researchers": 26, "appointments": 17, "assessed": {2021: 500_000, 2022: 900_000, 2023: 9_300_000, 2024: 400_000}, "infrastructure": 9_800_000, "projects": 3, "sha256": "5e486f2e988b865595790f1f1eb8f4c40acbf42f6e2ca74346686374d3b7f361"},
    "IEOMI": {"name": "Istituto degli Endotipi in Oncologia, Metabolismo e Immunologia \"G. Salvatore\"", "permanent": 103, "researchers": 53, "appointments": 29, "assessed": {2021: 2_100_000, 2022: 4_700_000, 2023: 13_400_000, 2024: 1_700_000}, "infrastructure": 13_500_000, "projects": 9, "sha256": "27c726eadb718d54b076bf18bf60ced4031787a3ed6c0eef0807eb0f2401d3bf"},
    "IFC": {"name": "Istituto di fisiologia clinica", "permanent": 207, "researchers": 113, "appointments": 63, "assessed": {2021: 4_600_000, 2022: 2_100_000, 2023: 8_500_000, 2024: 3_400_000}, "infrastructure": 4_000_000, "projects": 11, "sha256": "9631eedd7aa85889df5b3cf539b9440c0d1a90b1db3d7610642d7d5663741078"},
    "IFT": {"name": "Istituto di Farmacologia Traslazionale", "permanent": 102, "researchers": 75, "appointments": 15, "assessed": {2021: 800_000, 2022: 400_000, 2023: 2_600_000, 2024: 700_000}, "infrastructure": 1_100_000, "projects": 11, "sha256": "f831e22db3301210be30344391a03b8da3d6fab5b633051c451efa5bc9633dc4"},
    "IGB": {"name": "Istituto di genetica e biofisica \"Adriano Buzzati Traverso\"", "permanent": 82, "researchers": 44, "appointments": 20, "assessed": {2021: 1_000_000, 2022: 1_400_000, 2023: 3_200_000, 2024: 1_700_000}, "infrastructure": 3_000_000, "projects": 11, "sha256": "421ebfaf28d04a14c428f128122fce1d91ee194b17884e3aec4a9e9365a19d39"},
    "IGM": {"name": "Istituto di genetica molecolare \"Luigi Luca Cavalli Sforza\"", "permanent": 67, "researchers": 45, "appointments": 65, "assessed": {2021: 1_400_000, 2022: 1_000_000, 2023: 9_900_000, 2024: 5_800_000}, "infrastructure": 12_300_000, "projects": 4, "sha256": "fe178e542ad065bd2b8fd00912950b13d12c7ab6a6ac78dfc745a81e2931bcde"},
    "IN": {"name": "Istituto di neuroscienze", "permanent": 120, "researchers": 90, "appointments": 53, "assessed": {2021: 2_800_000, 2022: 3_300_000, 2023: 7_100_000, 2024: 3_500_000}, "infrastructure": 5_500_000, "projects": 11, "sha256": "ee17b6c621cb2ba4380864bd1352d5e07a18d0cbf965808a21e340976e5d1f90"},
    "IRGB": {"name": "Istituto di Ricerca Genetica e Biomedica", "permanent": 97, "researchers": 57, "appointments": 25, "assessed": {2021: 3_500_000, 2022: 1_600_000, 2023: 4_900_000, 2024: 2_600_000}, "infrastructure": 1_300_000, "projects": 9, "sha256": "8931af816295f391b282ca2cb7675cf20fe356793638f4936f5d91664400e9c8"},
    "IRIB": {"name": "Istituto per la Ricerca e l'Innovazione Biomedica", "permanent": 107, "researchers": 57, "appointments": 49, "assessed": {2021: 3_200_000, 2022: 1_600_000, 2023: 4_600_000, 2024: 3_600_000}, "infrastructure": 1_900_000, "projects": 12, "sha256": "17497339ea1614b6abec1841933285d49e05ad71075f813ce7c626a3eddbbf98"},
    "ITB": {"name": "Istituto di tecnologie biomediche", "permanent": 74, "researchers": 49, "appointments": 12, "assessed": {2021: 1_400_000, 2022: 1_600_000, 2023: 5_700_000, 2024: 900_000}, "infrastructure": 4_800_000, "projects": 5, "sha256": "df46e85ba1164aec9d885f14a53d200c16471f1cba1cf7e9bc76a3df165f6432"},
}

# CNR's current public directory (observed 2026-08-31) exposes seven
# departments and 83 institute affiliations.  The CNR overview also reports
# an 88-institute network; the snapshot preserves the directory as published
# and leaves structures without a financial/personnel series as n.d.
CNR_DEPARTMENTS: dict[str, dict[str, Any]] = {
    "501": {"code": "DSSTTA", "name": "Scienze del sistema terra e tecnologie per l'ambiente", "slug": "scienze-del-sistema-terra-e-tecnologie-per-l-ambiente", "institutes": [("GEO", "Istituto di Geoscienze"), ("IMIOT", "Istituto di Metodologie Integrate per l'Osservazione della Terra"), ("IRET", "Istituto di Ricerca sugli Ecosistemi Terrestri"), ("IRSA", "Istituto di ricerca sulle acque"), ("ISAC", "Istituto di scienze dell'atmosfera e del clima"), ("ISMAR", "Istituto di scienze marine"), ("ISP", "Istituto di Scienze Polari"), ("ITIAm", "Istituto di Tecnologie e Intelligenza Ambientale"), ("IRBIM", "Istituto per le Risorse Biologiche e le Biotecnologie Marine")]},
    "503": {"code": "DSBA", "name": "Scienze bio-agroalimentari", "slug": "scienze-bio-agroalimentari", "institutes": [("IBBA", "Istituto di biologia e biotecnologia agraria"), ("IBBR", "Istituto di Bioscienze e Biorisorse"), ("ISA", "Istituto di Scienze dell'Alimentazione"), ("ISPA", "Istituto di scienze delle produzioni alimentari"), ("IBE", "Istituto per la BioEconomia"), ("ISAFoM", "Istituto per i sistemi agricoli e forestali del mediterraneo"), ("ISB", "Istituto per i Sistemi Biologici"), ("ISPAAM", "Istituto per il sistema produzione animale in ambiente Mediterraneo"), ("IPSP", "Istituto per la Protezione Sostenibile delle Piante")]},
    "506": {"code": "DSCTM", "name": "Scienze chimiche e tecnologie dei materiali", "slug": "scienze-chimiche-e-tecnologie-dei-materiali", "institutes": [("ICB", "Istituto di chimica biomolecolare"), ("ICCOM", "Istituto di chimica dei composti organo metallici"), ("ICMATE", "Istituto di Chimica della Materia Condensata e di Tecnologie per l'Energia"), ("IC", "Istituto di cristallografia"), ("ISSMC", "Istituto di Scienza, Tecnologia e Sostenibilità per lo Sviluppo dei Materiali Ceramici"), ("SCITEC", "Istituto di Scienze e Tecnologie Chimiche \"Giulio Natta\""), ("IPCB", "Istituto per i Polimeri, Compositi e Biomateriali"), ("IPCF", "Istituto per i processi chimico-fisici"), ("ISOF", "Istituto per la sintesi organica e la fotoreattività"), ("ITM", "Istituto per la tecnologia delle membrane"), ("ISMN", "Istituto per lo studio dei materiali nanostrutturati")]},
    "507": {"code": "DSFTM", "name": "Scienze fisiche e tecnologie della materia", "slug": "scienze-fisiche-e-tecnologie-della-materia", "institutes": [("ISC", "Istituto dei sistemi complessi"), ("IBF", "Istituto di biofisica"), ("IFN", "Istituto di fotonica e nanotecnologie"), ("IMM", "Istituto di Microelettronica e Microsistemi"), ("NANOTEC", "Istituto di Nanotecnologia"), ("ISASI", "Istituto di Scienze Applicate e Sistemi Intelligenti \"Eduardo Caianiello\""), ("ISM", "Istituto di struttura della materia"), ("NANO", "Istituto Nanoscienze"), ("INO", "Istituto nazionale di ottica"), ("IOM", "Istituto officina dei materiali"), ("ISTP", "Istituto per la Scienza e Tecnologia dei Plasmi"), ("SPIN", "Istituto superconduttori, materiali innovativi e dispositivi")]},
    "512": {"code": "DSB", "name": "Scienze biomediche", "slug": "scienze-biomediche", "institutes": [("IEOMI", "Istituto degli Endotipi in Oncologia, Metabolismo e Immunologia \"G. Salvatore\""), ("IBBC", "Istituto di Biochimica e Biologia Cellulare"), ("IBSBC", "Istituto di Bioimmagini e Sistemi Biologici Complessi"), ("IBPM", "Istituto di biologia e patologia molecolari"), ("IBIOM", "Istituto di Biomembrane, Bioenergetica e Biotecnologie Molecolari"), ("IBB", "Istituto di biostrutture e bioimmagini"), ("IFT", "Istituto di Farmacologia Traslazionale"), ("IFC", "Istituto di fisiologia clinica"), ("IGB", "Istituto di genetica e biofisica \"Adriano Buzzati Traverso\""), ("IGM", "Istituto di genetica molecolare \"Luigi Luca Cavalli Sforza\""), ("IN", "Istituto di neuroscienze"), ("IRGB", "Istituto di Ricerca Genetica e Biomedica"), ("ITB", "Istituto di tecnologie biomediche"), ("IRIB", "Istituto per la Ricerca e l'Innovazione Biomedica")]},
    "513": {"code": "DIITET", "name": "Ingegneria, ICT e tecnologie per l'energia e i trasporti", "slug": "ingegneria-ict-e-tecnologie-per-l-energia-e-i-trasporti", "institutes": [("IMEM", "Istituto dei materiali per l'elettronica ed il magnetismo"), ("IASI", "Istituto di analisi dei sistemi ed informatica \"Antonio Ruberti\""), ("ICAR", "Istituto di calcolo e reti ad alte prestazioni"), ("IEIIT", "Istituto di elettronica e di ingegneria dell'informazione e delle telecomunicazioni"), ("IFAC", "Istituto di fisica applicata \"Nello Carrara\""), ("IIT", "Istituto di informatica e telematica"), ("INM", "Istituto di iNgegneria del Mare"), ("IMATI", "Istituto di matematica applicata e tecnologie informatiche \"Enrico Magenes\""), ("ISTI", "Istituto di scienza e tecnologie dell'informazione \"Alessandro Faedo\""), ("STEMS", "Istituto di Scienze e Tecnologie per l'Energia e la Mobilità Sostenibili"), ("STIIMA", "Istituto di Sistemi e Tecnologie Industriali Intelligenti per il Manifatturiero Avanzato"), ("ITAE", "Istituto di tecnologie avanzate per l'energia \"Nicola Giordano\""), ("IREA", "Istituto per il rilevamento elettromagnetico dell'ambiente"), ("IAC", "Istituto per le applicazioni del calcolo \"Mauro Picone\""), ("ITC", "Istituto per le tecnologie della costruzione")]},
    "514": {"code": "DSU", "name": "Scienze umane e sociali, patrimonio culturale", "slug": "scienze-umane-e-sociali-patrimonio-culturale", "institutes": [("IGSG", "Istituto di Informatica Giuridica e Sistemi Giudiziari"), ("ILC", "Istituto di linguistica computazionale \"Antonio Zampolli\""), ("IRIDIS", "Istituto di Ricerca su Innovazione, Diritto Internazionale e Sostenibilità"), ("IRCRES", "Istituto di Ricerca sulla Crescita Economica Sostenibile"), ("IRPPS", "Istituto di ricerche sulla popolazione e le politiche sociali"), ("ISPC", "Istituto di Scienze del Patrimonio Culturale"), ("ISTC", "Istituto di scienze e tecnologie della cognizione"), ("ISEM", "Istituto di storia dell'Europa mediterranea"), ("ISMed", "Istituto di studi sul Mediterraneo"), ("OVI", "Istituto opera del vocabolario italiano"), ("IRFiS", "Istituto per la Ricerca Filosofica e Storica"), ("ITD", "Istituto per le tecnologie didattiche"), ("ISTeG", "Istituto sui Sistemi Territoriali e di Governo \"Massimo Severo Giannini\"")]},
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


def verify_pinned_sources() -> None:
    """Fetch and verify every non-USTAT receipt pinned in this ETL.

    This is intentionally opt-in: offline CI validates the committed
    snapshot, while a refresh operator can fail closed before transcribing a
    changed official document.
    """
    pinned = [(spec["title"], spec["url"], spec["sha256"]) for spec in FOE_SOURCES.values()]
    pinned.append(("CNR · directory dipartimenti e istituti", CNR_STRUCTURE_URL, "0ccae65d6a8712a7215d12d2801493a1e5965ec9ea7a0cf6dd46da63a2461da2"))
    pinned.extend((f"CNR DSB · scheda {code}", f"https://dsb.cnr.it/schede2025/pdf/{code}.pdf", info["sha256"]) for code, info in DSB_INSTITUTES.items())
    for label, url, expected in pinned:
        actual = sha256(source_bytes(url))
        if actual != expected:
            raise ValueError(f"Hash inatteso per {label}: atteso {expected}, ricevuto {actual}")
        print(f"OK pin: {label}")


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
    money = metric in {"fundingAllocation", "assessedResources", "cashPayment", "economicCost", "researchAppointmentGross", "infrastructureCost", "procurementAwarded", "procurementLiquidated", "projectCost", "projectPayment"}
    measures = {
        "fundingAllocation": "allocation", "assessedResources": "assessed-budget", "cashPayment": "payment", "economicCost": "cost",
        "permanentHeadcount": "headcount", "researcherHeadcount": "headcount", "nonPermanentHeadcount": "headcount", "researchAppointmentCount": "appointment",
        "researchAppointmentGross": "appointment", "procurementAwarded": "procurement-award", "procurementLiquidated": "procurement-payment",
        "infrastructureCost": "infrastructure-cost", "projectCount": "project-count",
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
        base_source(
            "cnr-structure",
            "CNR · directory dipartimenti e istituti",
            "Consiglio Nazionale delle Ricerche",
            CNR_STRUCTURE_URL,
            CNR_STRUCTURE_LANDING_URL,
            "html",
            observed_at,
            "annuale",
            "Sette dipartimenti e 83 afferenze di istituto pubblicate nella directory CNR osservata",
            "La directory è una fotografia organizzativa: l'overview CNR dichiara una rete di 88 istituti, mentre la directory osservata ne elenca 83. Le differenze e i riordini restano espliciti e non producono stime finanziarie.",
            "0ccae65d6a8712a7215d12d2801493a1e5965ec9ea7a0cf6dd46da63a2461da2",
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
    for department_id, department_info in CNR_DEPARTMENTS.items():
        department_code = department_info["code"]
        department_entity_id = "cnr-dsb" if department_code == "DSB" else f"cnr-department-{department_id}"
        department_sources = ["cnr-structure"] + (["cnr-dsb-index"] if department_code == "DSB" else [])
        entities.append(entity(department_entity_id, "cnr-department", department_code, department_info["name"], "epr-cnr", department_sources))
        for code, name in department_info["institutes"]:
            sheet_source = f"cnr-dsb-{code.lower()}-2025" if code in DSB_INSTITUTES else None
            sources_for_institute = ["cnr-structure"] + ([sheet_source] if sheet_source else [])
            entities.append(entity(f"cnr-{code.lower()}", "cnr-institute", code, name, department_entity_id, sources_for_institute, "cnr-cds"))

    university_keys = sorted({(row["COD_ATENEO"], row["NOME_ATENEO"]) for row in ustat_rows})
    for code, name in university_keys:
        entities.append(entity(f"university-{code}", "university", code, name, "research-system", ["ustat-personale"], "custom"))

    observations: list[dict[str, Any]] = []
    # USTAT: aggregate all public university staff rows by university/year.
    totals: dict[tuple[str, int], dict[str, int]] = defaultdict(lambda: {"permanent": 0, "researchers": 0, "nonPermanent": 0})
    for row in ustat_rows:
        code, year = row["COD_ATENEO"], int(row["ANNO"])
        value = int(row["N_PERS"])
        if row["COD_QUALIFICA"] in PERMANENT_CODES:
            totals[(code, year)]["permanent"] += value
            if row["COD_QUALIFICA"] == "3RU e 3RTD":
                totals[(code, year)]["researchers"] += value
        elif row["COD_QUALIFICA"] in NON_PERMANENT_CODES:
            totals[(code, year)]["nonPermanent"] += value
    for (code, year), values in sorted(totals.items()):
        for metric, key in (("permanentHeadcount", "permanent"), ("researcherHeadcount", "researchers"), ("nonPermanentHeadcount", "nonPermanent")):
            observations.append(observation(
                f"ustat-{code}-{year}-{key}", f"university-{code}", year, metric, values[key],
                "ustat-personale-qualifica", "Ateneo · personale per qualifica USTAT", "partial", ["ustat-personale"],
                "Dato aggregato per Ateneo. La qualifica 3RU e 3RTD non separa ricercatori a tempo indeterminato e determinato.",
                "headcount",
            ))
    for year in range(2020, 2025):
        values = {key: sum(row[key] for (code, item_year), row in totals.items() if item_year == year) for key in ("permanent", "researchers", "nonPermanent")}
        for metric, key in (("permanentHeadcount", "permanent"), ("researcherHeadcount", "researchers"), ("nonPermanentHeadcount", "nonPermanent")):
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

    # CNR DSB: institute-level observations from the public sheets.  Staff is
    # current (2025), while the same sheet contains a four-year financial
    # series and a triennial infrastructure amount.
    for code, info in DSB_INSTITUTES.items():
        entity_id = f"cnr-{code.lower()}"
        source_id = f"cnr-dsb-{code.lower()}-2025"
        observations.extend((
            observation(f"dsb-{code.lower()}-2025-permanent", entity_id, 2025, "permanentHeadcount", info["permanent"], "cnr-dsb-personale-2025", "CNR DSB · unità di personale riportate nella scheda 2025", "observed", [source_id], "Unità di personale strutturato/di ruolo riportate dalla scheda CNR DSB 2025.", "headcount"),
            observation(f"dsb-{code.lower()}-2025-researchers", entity_id, 2025, "researcherHeadcount", info["researchers"], "cnr-dsb-personale-2025", "CNR DSB · profilo Ricercatore nella scheda 2025", "observed", [source_id], "Numero di ricercatori (profilo Ric) riportato dalla scheda CNR DSB 2025; è un sottoinsieme del personale di ruolo pubblicato nella stessa scheda.", "headcount"),
            observation(f"dsb-{code.lower()}-2025-appointments", entity_id, 2025, "researchAppointmentCount", info["appointments"], "cnr-dsb-personale-non-strutturato-2025", "CNR DSB · assegni, borse di studio e simili riportati nella scheda 2025", "observed", [source_id], "Conteggio della voce aggregata 'Assegni, borse di studio, etc...'; non identifica persone e non equivale a tutti i contratti precari.", "administrative-record"),
            *(
                observation(f"dsb-{code.lower()}-{year}-assessed", entity_id, year, "assessedResources", euros, "cnr-dsb-risorse-assestate-2021-2024", "CNR DSB · risorse finanziarie assestate pubblicate nella scheda istituto 2025", "observed", [source_id], "Risorse finanziarie assestate dell'istituto nel grafico storico della scheda CNR DSB 2025; non sono il bilancio completo dell'istituto.", "competence")
                for year, euros in info["assessed"].items()
            ),
            observation(f"dsb-{code.lower()}-2024-infrastructure", entity_id, 2024, "infrastructureCost", info["infrastructure"], "cnr-dsb-infrastrutture-triennio-2022-2024", "CNR DSB · infrastrutture di ricerca, risorse assestate triennio 2022-2024", "observed", [source_id], "Risorse assestate nel triennio 2022-2024 per le infrastrutture di ricerca elencate nella scheda; non è un costo annuale.", "competence"),
            observation(f"dsb-{code.lower()}-2024-projects", entity_id, 2024, "projectCount", info["projects"], "cnr-dsb-progetti-pnrr-2024", "CNR DSB · numero di progetti PNRR riportato nella scheda 2025", "observed", [source_id], "Conteggio dei progetti PNRR riportato dalla scheda; non è un importo finanziario e non rappresenta tutti i progetti dell'istituto.", "administrative-record"),
        ))

    # The CNR department pages expose current project cards but not a
    # comparable budget.  Keep the count at the department grain and do not
    # infer an amount from it.
    department_project_counts = {"501": 47, "503": 24, "506": 27, "507": 51, "512": 48, "513": 42, "514": 49}
    for department_id, count in department_project_counts.items():
        department_info = CNR_DEPARTMENTS[department_id]
        department_entity_id = "cnr-dsb" if department_info["code"] == "DSB" else f"cnr-department-{department_id}"
        observations.append(observation(
            f"cnr-department-{department_id}-2026-projects", department_entity_id, 2025, "projectCount", count,
            "cnr-project-directory-current", "CNR · progetti diretti e collaborativi elencati nella pagina di dipartimento osservata", "observed", ["cnr-structure"],
            "Conteggio delle schede progetto pubblicate nella pagina del dipartimento (diretti + collaborativi) osservata il 31/08/2026; non è un budget e può includere progetti storici.", "administrative-record",
        ))

    observed_metrics = {row["metric"] for row in observations}
    all_entity_count = len(entities)
    covered_by_metric = {metric: len({row["entityId"] for row in observations if row["metric"] == metric}) for metric in observed_metrics}
    coverage = []
    for metric in ("fundingAllocation", "assessedResources", "cashPayment", "economicCost", "permanentHeadcount", "researcherHeadcount", "nonPermanentHeadcount", "researchAppointmentCount", "researchAppointmentGross", "infrastructureCost", "projectCount", "procurementAwarded", "procurementLiquidated", "projectCost", "projectPayment"):
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
            "assessedResources": "Serie 2021-2024 delle risorse assestate per i 14 istituti DSB; non è il FOE e non è il bilancio completo.",
            "permanentHeadcount": "Personale USTAT 2020-2024 per 100 atenei e personale 2025 osservato per 14 istituti DSB.",
            "researcherHeadcount": "Ricercatori USTAT (3RU e 3RTD accorpati) 2020-2024 e profilo Ric delle schede DSB 2025.",
            "nonPermanentHeadcount": "Precariato universitario aggregato per qualifica USTAT; la scheda DSB usa una voce diversa e resta separata.",
            "researchAppointmentCount": "Solo conteggio 'assegni, borse di studio, etc.' delle 14 schede DSB 2025.",
            "infrastructureCost": "Risorse assestate nel triennio 2022-2024 per infrastrutture di ricerca dei 14 istituti DSB; non è un costo annuale.",
            "projectCount": "Conteggi amministrativi di progetti PNRR nelle schede DSB e progetti diretti/collaborativi nelle pagine di dipartimento; senza importi.",
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
            "scope": "Il perimetro unisce 100 atenei USTAT, FOE di enti pubblici di ricerca, la gerarchia CNR di 7 dipartimenti e 83 istituti e le metriche finanziarie/personale pubblicate per i 14 istituti DSB; procurement, pagamenti e costi di progetto restano n.d.",
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
    entities_by_id = {item["id"]: item for item in snapshot["entities"]}
    for item in snapshot["entities"]:
        if any(source_id not in source_ids for source_id in item["sourceIds"]):
            raise ValueError(f"Fonte entità non risolta: {item['id']}")
        chain: set[str] = set()
        current_id: str | None = item["id"]
        while current_id is not None:
            if current_id in chain:
                raise ValueError(f"Parent ricerca pubblica circolare: {item['id']}")
            chain.add(current_id)
            current_id = entities_by_id[current_id].get("parentId")
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
    parser.add_argument("--verify-pins", action="store_true", help="Scarica e verifica gli hash delle fonti FOE, directory CNR e schede DSB")
    args = parser.parse_args(argv)
    try:
        if args.verify_pins:
            verify_pinned_sources()
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
