type SearchValue = string | string[] | undefined;

export type ShareCardPayload = {
  runway: number;
  survival: number;
  verdict: string;
  baselineRunway: number | null;
  baselineSurvival: number | null;
  capital: number;
  income: number;
  burn: number;
  incomeDelayMonths: number;
  capitalShock: number;
  burnMultiplier: number;
  months: number;
  nSimulations: number;
};

export type ShareCardQueryPayload = {
  runway: number;
  survival: number;
  verdict: string;
  baselineRunway?: number | null;
  baselineSurvival?: number | null;
  capital?: number;
  income?: number;
  burn?: number;
  incomeDelayMonths?: number;
  capitalShock?: number;
  burnMultiplier?: number;
  months?: number;
  nSimulations?: number;
};

const DEFAULT_VERDICT = "My startup dies in 9 months. Beat that.";
const DEFAULT_CAPITAL = 5_000_000;
const DEFAULT_INCOME = 450_000;
const DEFAULT_BURN = 950_000;
const DEFAULT_SURVIVAL = 37;
const DEFAULT_MONTHS = 18;
const DEFAULT_N_SIMULATIONS = 100;

const URL_PARAM_ALIASES = {
  capital: ["capital", "initial_capital"],
  income: ["income", "monthly_income"],
  burn: ["burn", "monthly_burn"],
  incomeDelayMonths: ["income_delay_months", "delay"],
  capitalShock: ["capital_shock", "shock"],
  burnMultiplier: ["burn_multiplier", "burnMultiplier"],
  nSimulations: ["n_simulations", "sims"],
} as const;

function pickFirst(value: SearchValue): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }

  return null;
}

function pickFirstFromAliases(source: Record<string, SearchValue>, aliases: readonly string[]): SearchValue {
  for (const alias of aliases) {
    const value = source[alias];
    if (pickFirst(value) !== null) {
      return value;
    }
  }

  return undefined;
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseOptionalMetric(value: SearchValue, minimum: number, maximum: number): number | null {
  const rawValue = pickFirst(value);
  if (!rawValue) {
    return null;
  }

  const normalized = Number.parseFloat(rawValue.replace(/[^0-9.+-]/g, ""));
  if (!Number.isFinite(normalized)) {
    return null;
  }

  return roundMetric(clampNumber(normalized, minimum, maximum));
}

function parseMetric(value: SearchValue, fallback: number, minimum: number, maximum: number): number {
  return parseOptionalMetric(value, minimum, maximum) ?? fallback;
}

function deriveRunwayMonths(capital: number, income: number, burn: number): number {
  const monthlyLoss = Math.max(0, burn - income);
  if (monthlyLoss <= 0) {
    return 120;
  }

  return roundMetric(clampNumber(capital / monthlyLoss, 0, 999));
}

function setMetric(params: URLSearchParams, key: string, value: number | undefined, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }

  params.set(key, formatMetricValue(clampNumber(value, minimum, maximum)));
}

export function clampText(value: string, limit: number): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const glyphs = Array.from(normalized);
  if (glyphs.length <= limit) {
    return normalized;
  }

  return `${glyphs.slice(0, limit).join("").trimEnd()}...`;
}

export function normalizeShareCardPayload(source: Record<string, SearchValue>): ShareCardPayload {
  const capital = parseMetric(
    pickFirstFromAliases(source, URL_PARAM_ALIASES.capital),
    DEFAULT_CAPITAL,
    0,
    1_000_000_000,
  );
  const income = parseMetric(
    pickFirstFromAliases(source, URL_PARAM_ALIASES.income),
    DEFAULT_INCOME,
    0,
    1_000_000_000,
  );
  const burn = parseMetric(pickFirstFromAliases(source, URL_PARAM_ALIASES.burn), DEFAULT_BURN, 0, 1_000_000_000);
  const runway = parseOptionalMetric(source.runway, 0, 999) ?? deriveRunwayMonths(capital, income, burn);
  const verdict = clampText(pickFirst(source.verdict) ?? DEFAULT_VERDICT, 140) || DEFAULT_VERDICT;

  return {
    runway,
    survival: parseMetric(source.survival, DEFAULT_SURVIVAL, 0, 100),
    verdict,
    baselineRunway: parseOptionalMetric(source.baselineRunway, 0, 999),
    baselineSurvival: parseOptionalMetric(source.baselineSurvival, 0, 100),
    capital,
    income,
    burn,
    incomeDelayMonths: parseMetric(
      pickFirstFromAliases(source, URL_PARAM_ALIASES.incomeDelayMonths),
      0,
      0,
      240,
    ),
    capitalShock: parseMetric(pickFirstFromAliases(source, URL_PARAM_ALIASES.capitalShock), 0, 0, 1_000_000_000),
    burnMultiplier: parseMetric(pickFirstFromAliases(source, URL_PARAM_ALIASES.burnMultiplier), 1, 0, 10),
    months: parseMetric(source.months, DEFAULT_MONTHS, 1, 240),
    nSimulations: parseMetric(
      pickFirstFromAliases(source, URL_PARAM_ALIASES.nSimulations),
      DEFAULT_N_SIMULATIONS,
      1,
      100_000,
    ),
  };
}

function formatMetricValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function buildShareCardQuery(payload: ShareCardQueryPayload): URLSearchParams {
  const params = new URLSearchParams();

  setMetric(params, "capital", payload.capital, 0, 1_000_000_000);
  setMetric(params, "income", payload.income, 0, 1_000_000_000);
  setMetric(params, "burn", payload.burn, 0, 1_000_000_000);
  setMetric(params, "survival", payload.survival, 0, 100);
  setMetric(params, "runway", payload.runway, 0, 999);
  setMetric(params, "baselineRunway", payload.baselineRunway ?? undefined, 0, 999);
  setMetric(params, "baselineSurvival", payload.baselineSurvival ?? undefined, 0, 100);
  params.set("verdict", clampText(payload.verdict, 140) || DEFAULT_VERDICT);
  setMetric(params, "income_delay_months", payload.incomeDelayMonths, 0, 240);
  setMetric(params, "capital_shock", payload.capitalShock, 0, 1_000_000_000);
  setMetric(params, "burn_multiplier", payload.burnMultiplier, 0, 10);
  setMetric(params, "months", payload.months, 1, 240);
  setMetric(params, "n_simulations", payload.nSimulations, 1, 100_000);

  return params;
}

export function getSharePagePath(payload: ShareCardQueryPayload): string {
  return `/share?${buildShareCardQuery(payload).toString()}`;
}

export function getOgImagePath(payload: ShareCardQueryPayload): string {
  return `/api/og?${buildShareCardQuery(payload).toString()}`;
}

export function formatRunwayLabel(runway: number): string {
  if (runway >= 120) {
    return "120m+";
  }

  return `${formatMetricValue(runway)}m`;
}

export function formatSurvivalLabel(survival: number): string {
  return `${formatMetricValue(survival)}%`;
}

export function buildShareCardAlt(payload: ShareCardPayload): string {
  if (payload.baselineRunway !== null && payload.baselineSurvival !== null) {
    return `MonteRun verdict ${payload.verdict}. Runway ${formatRunwayLabel(
      payload.baselineRunway,
    )} to ${formatRunwayLabel(payload.runway)}. Survival 12m ${formatSurvivalLabel(
      payload.baselineSurvival,
    )} to ${formatSurvivalLabel(payload.survival)}.`;
  }

  return `MonteRun verdict ${payload.verdict}. Runway ${formatRunwayLabel(payload.runway)}. Survival 12m ${formatSurvivalLabel(payload.survival)}.`;
}
