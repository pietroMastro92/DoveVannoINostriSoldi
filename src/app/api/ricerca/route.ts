import { NextResponse, type NextRequest } from "next/server.js";
import { queryPublicResearchDataset, type PublicResearchDatasetQuery } from "@/lib/public-research";

// Query parameters define the dataset response; do not prerender one default query.
export const dynamic = "force-dynamic";
const MAX_PUBLIC_RESEARCH_RESPONSE_BYTES = 750_000;

const ALLOWED_PARAMS = new Set([
  "scope",
  "year",
  "entity",
  "entityKind",
  "department",
  "institute",
  "metric",
  "limit",
  "offset",
]);

class PublicResearchApiError extends Error {
  readonly code: "invalid_parameter" | "response_too_large";

  constructor(message: string, code: PublicResearchApiError["code"] = "invalid_parameter") {
    super(message);
    this.name = "PublicResearchApiError";
    this.code = code;
  }
}

function singleValue(params: URLSearchParams, key: string): string | undefined {
  const values = params.getAll(key);
  if (values.length > 1) throw new PublicResearchApiError(`Il parametro ${key} può comparire una sola volta.`);
  const value = values[0]?.trim();
  return value || undefined;
}

function integerValue(params: URLSearchParams, key: string, max: number): number | undefined {
  const value = singleValue(params, key);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new PublicResearchApiError(`${key} deve essere un intero non negativo.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new PublicResearchApiError(`${key} supera il limite consentito (${max}).`);
  return parsed;
}

function parseQuery(params: URLSearchParams): PublicResearchDatasetQuery {
  for (const key of params.keys()) {
    if (!ALLOWED_PARAMS.has(key)) throw new PublicResearchApiError(`Parametro non supportato: ${key}.`);
  }
  const year = singleValue(params, "year");
  if (year !== undefined && !/^\d{4}$/.test(year)) throw new PublicResearchApiError("year deve essere un anno a quattro cifre.");
  return {
    scope: singleValue(params, "scope"),
    year,
    entity: singleValue(params, "entity"),
    entityKind: singleValue(params, "entityKind"),
    department: singleValue(params, "department"),
    institute: singleValue(params, "institute"),
    metric: singleValue(params, "metric"),
    limit: integerValue(params, "limit", 100),
    offset: integerValue(params, "offset", 100_000),
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): NextResponse {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > MAX_PUBLIC_RESEARCH_RESPONSE_BYTES) {
    return NextResponse.json(
      { error: "La risposta richiesta supera il limite di dimensione.", code: "response_too_large" },
      { status: 413 },
    );
  }
  return new NextResponse(body, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Data-Source": "MUR · CNR · USTAT",
      ...init.headers,
    },
  });
}

export function GET(request: NextRequest) {
  try {
    return jsonResponse(queryPublicResearchDataset(parseQuery(request.nextUrl.searchParams)));
  } catch (error) {
    if (error instanceof PublicResearchApiError) return jsonResponse({ error: error.message, code: error.code }, { status: error.code === "response_too_large" ? 413 : 400 });
    if (error instanceof Error) return jsonResponse({ error: error.message, code: "invalid_parameter" }, { status: 400 });
    return jsonResponse({ error: "Snapshot ricerca temporaneamente non disponibile." }, { status: 500 });
  }
}
