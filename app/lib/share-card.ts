type SearchValue = string | string[] | undefined;

export type ShareCardPayload = {
  runway: number;
  survival: number;
  verdict: string;
};

const DEFAULT_VERDICT = "Math decides before momentum does.";

function pickFirst(value: SearchValue): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }

  return null;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseMetric(value: SearchValue, fallback: number, minimum: number, maximum: number): number {
  const rawValue = pickFirst(value);
  if (!rawValue) {
    return fallback;
  }

  const normalized = Number.parseFloat(rawValue.replace(/[^0-9.+-]/g, ""));
  if (!Number.isFinite(normalized)) {
    return fallback;
  }

  return roundMetric(clampNumber(normalized, minimum, maximum));
}

export function clampText(value: string, limit: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const glyphs = Array.from(normalized);
  if (glyphs.length <= limit) {
    return normalized;
  }

  return `${glyphs.slice(0, limit).join("").trimEnd()}...`;
}

export function normalizeShareCardPayload(source: {
  runway?: SearchValue;
  survival?: SearchValue;
  verdict?: SearchValue;
}): ShareCardPayload {
  const verdict = clampText(pickFirst(source.verdict) ?? DEFAULT_VERDICT, 140) || DEFAULT_VERDICT;

  return {
    runway: parseMetric(source.runway, 0, 0, 999),
    survival: parseMetric(source.survival, 0, 0, 100),
    verdict,
  };
}

function formatMetricValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function buildShareCardQuery(payload: ShareCardPayload): URLSearchParams {
  const params = new URLSearchParams();
  params.set("runway", formatMetricValue(payload.runway));
  params.set("survival", formatMetricValue(payload.survival));
  params.set("verdict", clampText(payload.verdict, 140) || DEFAULT_VERDICT);
  return params;
}

export function getSharePagePath(payload: ShareCardPayload): string {
  return `/share?${buildShareCardQuery(payload).toString()}`;
}

export function getOgImagePath(payload: ShareCardPayload): string {
  return `/api/og?${buildShareCardQuery(payload).toString()}`;
}

export function formatRunwayLabel(runway: number): string {
  return `${formatMetricValue(runway)}m`;
}

export function formatSurvivalLabel(survival: number): string {
  return `${formatMetricValue(survival)}%`;
}

export function buildShareCardAlt(payload: ShareCardPayload): string {
  return `MonteRun verdict ${payload.verdict}. Runway ${formatRunwayLabel(payload.runway)}. Survival 12m ${formatSurvivalLabel(payload.survival)}.`;
}
