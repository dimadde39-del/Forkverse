"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getShareLabels, type ShareLanguage } from "@/app/lib/share-card";

import DeltaShareCard from "./DeltaShareCard";
import WhatIfControls from "./WhatIfControls";
import { type DebouncedSimulationError, useDebouncedSimulation } from "./useDebouncedSimulation";

type FlowStatus = "idle" | "parsing" | "clarifying" | "simulating" | "simulated";

type ChatMessage = {
  id: string;
  role: "user" | "ai";
  content: string;
};

type ApiMeta = {
  schema_version: "2026-04";
  simulation_time_ms: number;
  request_id: string;
  generated_at: string;
};

type ApiError = {
  code: string | null;
  message: string;
  details: Record<string, unknown> | null;
  retryable: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
};

type SimulationParams = {
  initial_capital: number;
  monthly_burn: number;
  monthly_income: number;
  income_delay_months: number;
  capital_shock: number;
  burn_multiplier: number;
  months: number;
  n_simulations: number;
};

type AssumptionStress = {
  target: string;
  value: number;
  label: string | null;
};

type ParserAssumption = {
  id: string;
  statement: string;
  risk: string | null;
  suggested_stress: AssumptionStress | null;
};

const MAX_INCOME_DELAY_MONTHS = 12;

type SmartLeverPatchKey =
  | "cash"
  | "income"
  | "burn"
  | "initial_capital"
  | "monthly_income"
  | "monthly_burn"
  | "fixed_expenses"
  | "flexible_expenses"
  | "income_delay_months"
  | "capital_shock"
  | "burn_multiplier";

type SmartLeverMathPatch = Partial<Record<SmartLeverPatchKey, number>>;

type SmartLever = {
  id: string;
  title: string;
  effort: string;
  impact_months: number | null;
  math_patch: SmartLeverMathPatch;
};

const simulationParamKeys = [
  "initial_capital",
  "monthly_burn",
  "monthly_income",
  "income_delay_months",
  "capital_shock",
  "burn_multiplier",
  "months",
  "n_simulations",
] as const satisfies readonly (keyof SimulationParams)[];

type ParseReady = {
  status: "ready";
  params: SimulationParams;
  currency_symbol: string;
  language: ShareLanguage;
  assumptions?: ParserAssumption[] | null;
  smart_levers?: SmartLever[] | null;
  question: null;
};

type ParseNeedsClarification = {
  status: "needs_clarification";
  params: null;
  language: ShareLanguage;
  assumptions?: ParserAssumption[] | null;
  smart_levers?: SmartLever[] | null;
  question: string;
};

type ParseResponseData = ParseReady | ParseNeedsClarification;

type SimulationLever = {
  action: string;
  impact_months: number;
  title?: string | null;
  effort?: string | null;
  math_patch?: SmartLeverMathPatch | null;
};

type SimulationResponseData = {
  months: number[];
  n_simulations: number;
  survival_probability: number;
  p10: number[];
  p50: number[];
  p90: number[];
  spaghetti_sample: number[][];
  base_runway_months: number | null;
  survival_probability_12m: number | null;
  verdict: string | null;
  comment: string | null;
  language: ShareLanguage;
  levers: SimulationLever[] | null;
};

type ClarificationContext = {
  plan: string;
  question: string;
};

type SimulatorViewState = {
  status: FlowStatus;
  chatHistory: ChatMessage[];
  clarificationContext: ClarificationContext | null;
  parseData: ParseResponseData | null;
  simulationData: SimulationResponseData | null;
  simulationParams: SimulationParams | null;
  simulationMeta: ApiMeta | null;
  errorMessage: string | null;
};

type SimKey = `sim${number}`;

type MonteCarloChartPoint = {
  month: number;
  p10: number;
  p50: number;
  p90: number;
  band: [number, number];
  bankruptcyRisk: number;
} & Partial<Record<SimKey, number | null>>;

type CustomTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: MonteCarloChartPoint }>;
  currencySymbol: string;
};

type ShareCardViewModel = {
  timestampIso: string | null;
  timestampLabel: string | null;
  runwayValue: string;
  survivalValue: string;
  verdict: string;
  comment: string;
  language: ShareLanguage;
  labels: ReturnType<typeof getShareLabels>;
  baselineRunwayValue: string | null;
  baselineSurvivalValue: string | null;
  deltaRunwayMonths: number | null;
  deltaSurvivalPercent: number | null;
  isImprovement: boolean | null;
  hasDelta: boolean;
};

type TelegramLinkModel = {
  href: string;
  startToken: string;
};

type ResultMetricsViewModel = {
  runwayMonths: number;
  survivalPercent: number;
};

type ResultFlow = "parse" | "what-if";

type BaselineResult = {
  runwayMonths: number;
  survivalPercent: number;
  timestamp: string;
  scenarioHash?: string;
  horizonMonths?: number;
};

type DisplaySmartLever = SmartLever & {
  impactLabel: string;
};

type StressUrlState = {
  mode: string;
  factors: string[];
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const prefixMoneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const PREFIX_CURRENCY_SYMBOLS = new Set(["$"]);
const BASELINE_MONTHS_STORAGE_KEY = "monterun_baseline_months";
const BASELINE_RESULT_STORAGE_KEY = "monterun_baseline_result";
const LATEST_RESULT_STORAGE_KEY = "monterun_latest_result";
const FINANCIAL_GUARDRAIL = "Simulation estimate, not financial advice.";
const PARSE_CLIENT_TIMEOUT_MS = 12_000;
const telegramBotUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

const panelClass =
  "rounded-[28px] border border-white/10 bg-white/5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-md";
const overloadedScenarioMessage = "The system is overloaded analyzing your scenario. Try describing the plan a bit shorter.";

class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Request failed with HTTP ${status}`);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOverloadedStatus(status: number | null | undefined): status is 502 | 504 {
  return status === 502 || status === 504;
}

function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError;
}

function getFriendlyErrorMessage(error: unknown): string {
  if (isApiRequestError(error) && isOverloadedStatus(error.status)) {
    return overloadedScenarioMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Could not process the scenario. Try again.";
}

function getFriendlySimulationErrorMessage(error: Pick<DebouncedSimulationError, "message" | "status">): string {
  return isOverloadedStatus(error.status) ? overloadedScenarioMessage : error.message;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntegerNumber(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function normalizeIntField(value: unknown, field: string, minimum: number, maximum?: number): number {
  if (!isIntegerNumber(value)) {
    throw new Error(`Invalid ${field} returned by API`);
  }

  if (value < minimum) {
    throw new Error(`Invalid ${field} returned by API`);
  }

  if (typeof maximum === "number" && value > maximum) {
    throw new Error(`Invalid ${field} returned by API`);
  }

  return value;
}

function normalizeOptionalIntField(value: unknown, field: string, minimum: number, maximum?: number): number {
  if (value === undefined || value === null) {
    return minimum;
  }

  return normalizeIntField(value, field, minimum, maximum);
}

function normalizeNumberArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || !value.every(isFiniteNumber)) {
    throw new Error(`Invalid ${field} returned by API`);
  }

  return value;
}

function normalizeMatrix(value: unknown, field: string): number[][] {
  if (!Array.isArray(value) || !value.every((row) => Array.isArray(row) && row.every(isFiniteNumber))) {
    throw new Error(`Invalid ${field} returned by API`);
  }

  return value as number[][];
}

function normalizeOptionalNumberField(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function normalizeOptionalFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.trim());
  return isFiniteNumber(parsed) ? parsed : null;
}

function normalizeOptionalPositiveInt(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) {
    return undefined;
  }

  const normalized = Math.round(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeOptionalTextField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeResultLanguage(value: unknown): ShareLanguage {
  return value === "ru" ? "ru" : "en";
}

function normalizeOptionalLevers(value: unknown): SimulationLever[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const levers: SimulationLever[] = [];

  for (const lever of value) {
    if (!isRecord(lever)) {
      continue;
    }

    const action = normalizeOptionalTextField(lever.action);
    const impactMonths = normalizeOptionalNumberField(lever.impact_months);
    if (!action || impactMonths === null) {
      continue;
    }

    levers.push({
      action,
      impact_months: impactMonths,
      title: normalizeOptionalTextField(lever.title),
      effort: normalizeOptionalTextField(lever.effort),
      math_patch: normalizeSmartLeverMathPatch(lever.math_patch ?? lever.patch),
    });
  }

  return levers.length > 0 ? levers : null;
}

function normalizeStoredResult(value: unknown): BaselineResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const runwayMonths = normalizeOptionalFiniteNumber(value.runwayMonths);
  const survivalPercent = normalizeOptionalFiniteNumber(value.survivalPercent);
  const timestamp = normalizeOptionalTextField(value.timestamp);

  if (runwayMonths === null || survivalPercent === null || !timestamp) {
    return null;
  }

  return {
    runwayMonths,
    survivalPercent: clampPct(normalizeProbabilityPercent(survivalPercent)),
    timestamp,
    scenarioHash: normalizeOptionalTextField(value.scenarioHash) ?? undefined,
    horizonMonths: normalizeOptionalPositiveInt(value.horizonMonths),
  };
}

function readStoredResult(storageKey: string): BaselineResult | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);
    return rawValue ? normalizeStoredResult(JSON.parse(rawValue)) : null;
  } catch (error) {
    console.warn(`[SimClient] Unable to read ${storageKey}:`, error);
    return null;
  }
}

function writeStoredResult(storageKey: string, result: BaselineResult): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(result));
  } catch (error) {
    console.warn(`[SimClient] Unable to write ${storageKey}:`, error);
  }
}

function normalizeBaselineMonths(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const parsedValue = Number(trimmedValue);
  return isFiniteNumber(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

function readStoredBaselineMonths(): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return normalizeBaselineMonths(window.localStorage.getItem(BASELINE_MONTHS_STORAGE_KEY));
  } catch (error) {
    console.warn(`[SimClient] Unable to read ${BASELINE_MONTHS_STORAGE_KEY}:`, error);
    return null;
  }
}

function writeStoredBaselineMonthsOnce(months: number): number | null {
  if (typeof window === "undefined" || !isFiniteNumber(months) || months < 0) {
    return null;
  }

  try {
    const storedMonths = normalizeBaselineMonths(window.localStorage.getItem(BASELINE_MONTHS_STORAGE_KEY));
    if (storedMonths !== null) {
      return storedMonths;
    }

    window.localStorage.setItem(BASELINE_MONTHS_STORAGE_KEY, String(months));
    return months;
  } catch (error) {
    console.warn(`[SimClient] Unable to write ${BASELINE_MONTHS_STORAGE_KEY}:`, error);
    return null;
  }
}

function normalizeOptionalAssumptions(value: unknown): ParserAssumption[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const assumptions: ParserAssumption[] = [];

  for (const [index, assumption] of value.entries()) {
    if (typeof assumption === "string") {
      const statement = normalizeOptionalTextField(assumption);
      if (statement) {
        assumptions.push({
          id: `assumption-${index}-${statement}`,
          statement,
          risk: null,
          suggested_stress: null,
        });
      }

      continue;
    }

    if (!isRecord(assumption)) {
      continue;
    }

    const statement =
      normalizeOptionalTextField(assumption.statement) ??
      normalizeOptionalTextField(assumption.assumption) ??
      normalizeOptionalTextField(assumption.text) ??
      normalizeOptionalTextField(assumption.label) ??
      normalizeOptionalTextField(assumption.title);

    if (!statement) {
      continue;
    }

    const risk =
      normalizeOptionalTextField(assumption.risk) ??
      normalizeOptionalTextField(assumption.risk_level) ??
      normalizeOptionalTextField(assumption.why_it_matters) ??
      normalizeOptionalTextField(assumption.note);

    let suggestedStress: AssumptionStress | null = null;
    const suggestedStressValue = assumption.suggested_stress;
    if (isRecord(suggestedStressValue)) {
      const target = normalizeOptionalTextField(suggestedStressValue.target);
      const stressValue = normalizeOptionalFiniteNumber(
        suggestedStressValue.value ?? suggestedStressValue.suggested_value,
      );

      if (target && stressValue !== null) {
        suggestedStress = {
          target,
          value: stressValue,
          label: normalizeOptionalTextField(suggestedStressValue.label),
        };
      }
    }

    const explicitId =
      normalizeOptionalTextField(assumption.id) ??
      normalizeOptionalTextField(assumption.key) ??
      `assumption-${index}-${statement}`;

    assumptions.push({
      id: explicitId,
      statement,
      risk,
      suggested_stress: suggestedStress,
    });
  }

  return assumptions.length > 0 ? assumptions : null;
}

function normalizeSmartLeverMathPatch(value: unknown): SmartLeverMathPatch | null {
  if (!isRecord(value)) {
    return null;
  }

  const patchKeys = [
    "cash",
    "income",
    "burn",
    "initial_capital",
    "monthly_income",
    "monthly_burn",
    "fixed_expenses",
    "flexible_expenses",
    "income_delay_months",
    "capital_shock",
    "burn_multiplier",
  ] as const satisfies readonly SmartLeverPatchKey[];

  const patch = patchKeys.reduce<SmartLeverMathPatch>((nextPatch, key) => {
    const rawValue = value[key];
    if (rawValue === undefined || rawValue === null) {
      return nextPatch;
    }

    const normalizedValue = normalizeOptionalFiniteNumber(rawValue);

    if (normalizedValue !== null) {
      nextPatch[key] = normalizedValue;
    }

    return nextPatch;
  }, {});

  return Object.values(patch).some((patchValue) => patchValue !== 0) ? patch : null;
}

function normalizeOptionalSmartLevers(value: unknown): SmartLever[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const levers: SmartLever[] = [];

  for (const [index, lever] of value.entries()) {
    if (!isRecord(lever)) {
      continue;
    }

    const title =
      normalizeOptionalTextField(lever.title) ??
      normalizeOptionalTextField(lever.action) ??
      normalizeOptionalTextField(lever.label);
    const mathPatch = normalizeSmartLeverMathPatch(lever.math_patch ?? lever.patch);
    if (!title || !mathPatch) {
      continue;
    }

    const effort =
      normalizeOptionalTextField(lever.effort) ??
      normalizeOptionalTextField(lever.difficulty) ??
      normalizeOptionalTextField(lever.time_to_effect) ??
      "Medium";

    levers.push({
      id:
        normalizeOptionalTextField(lever.id) ??
        normalizeOptionalTextField(lever.key) ??
        `smart-lever-${index}-${title}`,
      title,
      effort,
      impact_months: normalizeOptionalNumberField(lever.impact_months ?? lever.impact),
      math_patch: mathPatch,
    });
  }

  return levers.length > 0 ? levers : null;
}

function cloneSimulationParams(params: SimulationParams): SimulationParams {
  return { ...params };
}

function sanitizeSimulationParams(params: SimulationParams): SimulationParams {
  const months = Math.max(1, Math.round(params.months));
  const incomeDelayMonths = isFiniteNumber(params.income_delay_months) ? params.income_delay_months : 0;
  const capitalShock = isFiniteNumber(params.capital_shock) ? params.capital_shock : 0;
  const burnMultiplier = isFiniteNumber(params.burn_multiplier) ? params.burn_multiplier : 1;

  return {
    initial_capital: Math.max(0, Math.round(params.initial_capital)),
    monthly_burn: Math.max(0, Math.round(params.monthly_burn)),
    monthly_income: Math.max(0, Math.round(params.monthly_income)),
    income_delay_months: Math.min(MAX_INCOME_DELAY_MONTHS, months, Math.max(0, Math.round(incomeDelayMonths))),
    capital_shock: Math.max(0, Math.round(capitalShock)),
    burn_multiplier: Math.max(0.5, Math.round(burnMultiplier * 100) / 100),
    months,
    n_simulations: Math.max(1, Math.min(4000, Math.round(params.n_simulations))),
  };
}

function areSimulationParamsEqual(left: SimulationParams | null, right: SimulationParams | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return simulationParamKeys.every((key) => left[key] === right[key]);
}

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: globalThis.crypto.randomUUID(),
    role,
    content,
  };
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizeCurrencySymbol(value: unknown): string {
  return "$";
}

function isPrefixCurrencySymbol(currencySymbol: string): boolean {
  return PREFIX_CURRENCY_SYMBOLS.has(currencySymbol);
}

function formatUnsignedCurrency(value: number, currencySymbol: string): string {
  const rounded = Math.round(value);
  const formatter = isPrefixCurrencySymbol(currencySymbol) ? prefixMoneyFormatter : moneyFormatter;
  const amount = formatter.format(rounded);

  return isPrefixCurrencySymbol(currencySymbol) ? `${currencySymbol} ${amount}` : `${amount} ${currencySymbol}`;
}

function formatCurrencySigned(value: number, currencySymbol: string): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${formatUnsignedCurrency(Math.abs(rounded), currencySymbol)}`;
}

function formatCurrency(value: number, currencySymbol: string): string {
  return formatUnsignedCurrency(value, currencySymbol);
}

function formatAxisCurrency(value: number, currencySymbol: string): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  let compactValue: string;

  if (absolute >= 1_000_000) {
    compactValue =
      absolute >= 10_000_000 ? `${(absolute / 1_000_000).toFixed(0)}M` : `${(absolute / 1_000_000).toFixed(1)}M`;
  } else if (absolute >= 1_000) {
    compactValue = absolute >= 100_000 ? `${(absolute / 1_000).toFixed(0)}k` : `${(absolute / 1_000).toFixed(1)}k`;
  } else {
    return `${sign}${formatUnsignedCurrency(absolute, currencySymbol)}`;
  }

  return isPrefixCurrencySymbol(currencySymbol)
    ? `${sign}${currencySymbol} ${compactValue}`
    : `${sign}${compactValue} ${currencySymbol}`;
}

function formatMobileAxisCurrency(value: number, currencySymbol: string): string {
  return formatAxisCurrency(value, currencySymbol).replace(/\s+/g, "");
}

function formatDelayMonths(value: number): string {
  return value > 0 ? `+${value}m` : "Live";
}

function formatBurnMultiplier(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
}

function getStressParamPatch(stress: AssumptionStress): Partial<SimulationParams> | null {
  switch (stress.target) {
    case "income_delay":
      return { income_delay_months: stress.value };
    case "capital_shock":
      return { capital_shock: stress.value };
    case "burn_multiplier":
      return { burn_multiplier: stress.value };
    default:
      return null;
  }
}

function formatStressLabel(stress: AssumptionStress | null, currencySymbol: string): string | null {
  if (!stress) {
    return null;
  }

  if (stress.label) {
    return stress.label;
  }

  switch (stress.target) {
    case "income_delay":
      return `Income delay -> ${formatDelayMonths(stress.value)}`;
    case "capital_shock":
      return `Capital shock -> ${formatCurrency(stress.value, currencySymbol)}`;
    case "burn_multiplier":
      return `Burn multiplier -> ${formatBurnMultiplier(stress.value)}`;
    default:
      return null;
  }
}

function formatSmartLeverPatchEffect(
  mathPatch: SmartLeverMathPatch,
  currentParams: SimulationParams | null,
  currencySymbol: string,
): string {
  const effects: string[] = [];
  const nextParams = currentParams ? applySmartLeverMathPatch(currentParams, mathPatch) : null;
  const capitalDelta = (mathPatch.cash ?? 0) + (mathPatch.initial_capital ?? 0);
  const incomeDelta = (mathPatch.income ?? 0) + (mathPatch.monthly_income ?? 0);
  const burnDelta =
    (mathPatch.burn ?? 0) +
    (mathPatch.monthly_burn ?? 0) +
    (mathPatch.fixed_expenses ?? 0) +
    (mathPatch.flexible_expenses ?? 0);
  const delayDelta = mathPatch.income_delay_months ?? 0;
  const shockDelta = mathPatch.capital_shock ?? 0;
  const multiplierDelta = mathPatch.burn_multiplier ?? 0;

  if (capitalDelta !== 0) {
    effects.push(formatDeltaEffect("Cash", capitalDelta, nextParams?.initial_capital, currencySymbol));
  }

  if (incomeDelta !== 0) {
    effects.push(formatDeltaEffect("Income", incomeDelta, nextParams?.monthly_income, currencySymbol));
  }

  if (burnDelta !== 0) {
    effects.push(formatDeltaEffect("Burn", burnDelta, nextParams?.monthly_burn, currencySymbol));
  }

  if (delayDelta !== 0) {
    effects.push(formatNumberDeltaEffect("Delay", delayDelta, nextParams?.income_delay_months, formatDelayMonths));
  }

  if (shockDelta !== 0) {
    effects.push(formatDeltaEffect("Shock", shockDelta, nextParams?.capital_shock, currencySymbol));
  }

  if (multiplierDelta !== 0) {
    effects.push(formatNumberDeltaEffect("Burn x", multiplierDelta, nextParams?.burn_multiplier, formatBurnMultiplier));
  }

  return effects.length > 0 ? effects.join(" | ") : "No valid math patch";
}

function formatDeltaEffect(
  label: string,
  delta: number,
  nextValue: number | undefined,
  currencySymbol: string,
): string {
  const signedDelta = formatCurrencySigned(delta, currencySymbol);
  return nextValue === undefined ? `${label} ${signedDelta}` : `${label} ${signedDelta} -> ${formatCurrency(nextValue, currencySymbol)}`;
}

function formatNumberDeltaEffect(
  label: string,
  delta: number,
  nextValue: number | undefined,
  formatter: (value: number) => string,
): string {
  const sign = delta > 0 ? "+" : "";
  const formattedDelta = `${sign}${Number.isInteger(delta) ? delta.toFixed(0) : delta.toFixed(2).replace(/\.?0+$/, "")}`;
  return nextValue === undefined ? `${label} ${formattedDelta}` : `${label} ${formattedDelta} -> ${formatter(nextValue)}`;
}

function applySmartLeverMathPatch(params: SimulationParams, mathPatch: SmartLeverMathPatch): SimulationParams {
  const capitalDelta = (mathPatch.cash ?? 0) + (mathPatch.initial_capital ?? 0);
  const incomeDelta = (mathPatch.income ?? 0) + (mathPatch.monthly_income ?? 0);
  const burnDelta =
    (mathPatch.burn ?? 0) +
    (mathPatch.monthly_burn ?? 0) +
    (mathPatch.fixed_expenses ?? 0) +
    (mathPatch.flexible_expenses ?? 0);

  return sanitizeSimulationParams({
    ...params,
    initial_capital: params.initial_capital + capitalDelta,
    monthly_income: params.monthly_income + incomeDelta,
    monthly_burn: params.monthly_burn + burnDelta,
    income_delay_months: params.income_delay_months + (mathPatch.income_delay_months ?? 0),
    capital_shock: params.capital_shock + (mathPatch.capital_shock ?? 0),
    burn_multiplier: params.burn_multiplier + (mathPatch.burn_multiplier ?? 0),
  });
}

function clampText(value: string | null | undefined, limit: number): string {
  const normalized = String(value ?? "")
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

function formatRunwayMonths(value: number): string {
  const precision = Number.isInteger(value) ? 0 : 1;
  return value.toFixed(precision);
}

function formatImpactMonths(value: number): string {
  const precision = Number.isInteger(value) ? 0 : 1;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(precision)} MONTHS`;
}

function formatSmartLeverImpactLabel(lever: SmartLever, currentParams: SimulationParams | null): string {
  if (lever.impact_months !== null) {
    return lever.impact_months > 0 ? formatImpactMonths(lever.impact_months) : "No runway gain";
  }

  if (!currentParams) {
    return "Impact pending";
  }

  const baseRunwayMonths = estimateRunwayMonths(currentParams);
  const patchedRunwayMonths = estimateRunwayMonths(applySmartLeverMathPatch(currentParams, lever.math_patch));
  const impactMonths = patchedRunwayMonths - baseRunwayMonths;

  if (impactMonths > 0) {
    return formatImpactMonths(impactMonths);
  }

  return impactMonths < 0 ? formatImpactMonths(impactMonths) : "No runway gain";
}

function formatShareProbability(value: number): string {
  const clamped = clampPct(value);
  const precision = Number.isInteger(clamped) ? 0 : 1;
  return `${clamped.toFixed(precision)}%`;
}

function normalizeProbabilityPercent(value: number): number {
  return clampPct(value > 0 && value <= 1 ? value * 100 : value);
}

function estimateRunwayMonths(params: SimulationParams): number {
  let capital = Math.max(0, params.initial_capital - params.capital_shock);
  const monthlyBurn = params.monthly_burn * params.burn_multiplier;

  for (let month = 1; month <= params.months; month += 1) {
    const income = month > params.income_delay_months ? params.monthly_income : 0;
    capital += income - monthlyBurn;

    if (capital <= 0) {
      return month;
    }
  }

  return params.months;
}

function formatShareTimestamp(iso: string): string {
  const normalized = iso.trim();
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return clampText(normalized || "UNKNOWN", 26);
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const hours = String(parsed.getUTCHours()).padStart(2, "0");
  const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

function formatUrlNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatUrlPercent(value: number): string {
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return formatUrlNumber(Math.round(clampPct(normalized) * 10) / 10);
}

function getScenarioHash(params: SimulationParams | null): string | undefined {
  return params
    ? simulationParamKeys.map((key) => `${key}:${formatUrlNumber(params[key])}`).join("|")
    : undefined;
}

function buildStoredResult(
  resultMetrics: ResultMetricsViewModel,
  simulationParams: SimulationParams | null,
  generatedAt: string | null | undefined,
): BaselineResult {
  return {
    runwayMonths: resultMetrics.runwayMonths,
    survivalPercent: resultMetrics.survivalPercent,
    timestamp: generatedAt ?? new Date().toISOString(),
    scenarioHash: getScenarioHash(simulationParams),
    horizonMonths: simulationParams?.months,
  };
}

function getStressUrlState(params: SimulationParams, baselineParams: SimulationParams | null): StressUrlState {
  if (!baselineParams || areSimulationParamsEqual(params, baselineParams)) {
    return {
      mode: "base",
      factors: [],
    };
  }

  const factors: string[] = [];
  if (params.burn_multiplier > baselineParams.burn_multiplier) {
    factors.push("bad_month");
  }

  if (params.income_delay_months > baselineParams.income_delay_months) {
    factors.push("late_payments");
  }

  if (params.monthly_income < baselineParams.monthly_income) {
    factors.push("client_loss");
  }

  if (params.capital_shock > baselineParams.capital_shock) {
    factors.push("emergency_expense");
  }

  const uniqueFactors = Array.from(new Set(factors));
  return {
    mode: uniqueFactors.length === 0 ? "stress" : uniqueFactors.length === 1 ? uniqueFactors[0] : "combined_stress",
    factors: uniqueFactors,
  };
}

function setSimulationParamSearchParams(searchParams: URLSearchParams, params: SimulationParams, prefix = "") {
  for (const key of simulationParamKeys) {
    searchParams.set(`${prefix}${key}`, formatUrlNumber(params[key]));
  }
}

function buildSimulationUrlSearchParams({
  simulationData,
  resultMetrics,
  shareCard,
}: {
  simulationData: SimulationResponseData;
  resultMetrics: ResultMetricsViewModel;
  shareCard: ShareCardViewModel | null;
}): URLSearchParams {
  const searchParams = new URLSearchParams();

  searchParams.set("runway", formatUrlNumber(Math.round(resultMetrics.runwayMonths * 10) / 10));
  searchParams.set("survival", formatUrlPercent(resultMetrics.survivalPercent));

  if (shareCard?.verdict) {
    searchParams.set("verdict", shareCard.verdict);
  } else if (simulationData.verdict) {
    searchParams.set("verdict", clampText(simulationData.verdict, 140));
  }

  if (shareCard?.hasDelta && shareCard.baselineRunwayValue && shareCard.baselineSurvivalValue) {
    searchParams.set("baselineRunway", shareCard.baselineRunwayValue);
    searchParams.set("baselineSurvival", shareCard.baselineSurvivalValue);
  }

  const language = shareCard?.language ?? simulationData.language;
  if (language === "ru") {
    searchParams.set("language", "ru");
  }

  return searchParams;
}

function normalizeTelegramBotUsername(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^@/, "");
  return normalized && /^[a-zA-Z0-9_]{5,32}$/.test(normalized) ? normalized : null;
}

function buildTelegramStartToken(resultMetrics: ResultMetricsViewModel): string {
  const runwayTenths = Math.max(0, Math.round(resultMetrics.runwayMonths * 10));
  return `mr1_${runwayTenths.toString(36)}`;
}

function CustomTooltip({ active, payload, currencySymbol }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="min-w-[232px] rounded-3xl border border-white/12 bg-[rgba(8,8,8,0.88)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:min-w-[268px]">
      <div className="text-sm font-medium text-white">Month {point.month}</div>
      <div className="mt-3 space-y-1.5 text-[12px] text-white/78">
        <div className="font-mono tabular-nums text-emerald-200">
          \u25b2 P90: {formatCurrencySigned(point.p90, currencySymbol)} (top 10%)
        </div>
        <div className="font-mono tabular-nums text-emerald-300">
          \u25c6 P50: {formatCurrencySigned(point.p50, currencySymbol)} (median)
        </div>
        <div className="font-mono tabular-nums text-white/72">
          \u25bc P10: {formatCurrencySigned(point.p10, currencySymbol)} (worst 10%)
        </div>
      </div>
      <div className="mt-3 border-t border-white/10 pt-3 font-mono text-[12px] text-white/64 tabular-nums">
        Bankruptcy this month: {point.bankruptcyRisk.toFixed(0)}%
      </div>
    </div>
  );
}

async function postEnvelope<TResponse>(url: string, payload: Record<string, unknown>): Promise<ApiEnvelope<TResponse>> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PARSE_CLIENT_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError(504);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const apiMessage =
      isRecord(json) && isRecord(json.error) && typeof json.error.message === "string"
        ? json.error.message
        : undefined;
    throw new ApiRequestError(response.status, apiMessage);
  }

  if (!isRecord(json) || !("meta" in json) || !("error" in json) || !("data" in json)) {
    throw new Error("Invalid API envelope");
  }

  return json as ApiEnvelope<TResponse>;
}

function normalizeParseResponseData(value: unknown): ParseResponseData {
  if (!isRecord(value)) {
    throw new Error("Invalid parse response");
  }

  const status = value.status;
  if (typeof status !== "string") {
    throw new Error("Invalid parse response");
  }

  const question = value.question;
  if (status === "needs_clarification") {
    if (typeof question !== "string") {
      throw new Error("Invalid parse clarification response");
    }

    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length === 0) {
      throw new Error("Invalid parse clarification response");
    }

    return {
      status: "needs_clarification",
      params: null,
      language: normalizeResultLanguage(value.language),
      assumptions: normalizeOptionalAssumptions(value.assumptions),
      smart_levers: normalizeOptionalSmartLevers(value.smart_levers),
      question: trimmedQuestion,
    };
  }

  if (status !== "ready") {
    throw new Error("Invalid parse response");
  }

  const params = value.params;
  if (!isRecord(params)) {
    throw new Error("Invalid parse response");
  }

  return {
    status: "ready",
    params: {
      initial_capital: normalizeIntField(params.initial_capital, "initial_capital", 0),
      monthly_burn: normalizeIntField(params.monthly_burn, "monthly_burn", 0),
      monthly_income: normalizeIntField(params.monthly_income, "monthly_income", 0),
      income_delay_months: normalizeOptionalIntField(params.income_delay_months, "income_delay_months", 0, 240),
      capital_shock: normalizeOptionalFiniteNumber(params.capital_shock) ?? 0,
      burn_multiplier: isFiniteNumber(params.burn_multiplier) ? params.burn_multiplier : 1,
      months: normalizeIntField(params.months, "months", 1),
      n_simulations: normalizeIntField(params.n_simulations, "n_simulations", 1, 4000),
    },
    currency_symbol: normalizeCurrencySymbol(value.currency_symbol ?? params.currency_symbol),
    language: normalizeResultLanguage(value.language),
    assumptions: normalizeOptionalAssumptions(value.assumptions),
    smart_levers: normalizeOptionalSmartLevers(value.smart_levers),
    question: null,
  };
}

function normalizeSimulationResponseData(value: unknown): SimulationResponseData {
  if (!isRecord(value)) {
    throw new Error("Invalid simulation response");
  }

  const months = value.months;
  const nSimulations = value.n_simulations;
  const survivalProbability = value.survival_probability;
  const p10 = value.p10;
  const p50 = value.p50;
  const p90 = value.p90;
  const spaghettiSample = value.spaghetti_sample;

  return {
    months: normalizeNumberArray(months, "months"),
    n_simulations: normalizeIntField(nSimulations, "n_simulations", 1, 4000),
    survival_probability: (() => {
      if (!isFiniteNumber(survivalProbability)) {
        throw new Error("Invalid survival_probability returned by API");
      }

      return survivalProbability;
    })(),
    p10: normalizeNumberArray(p10, "p10"),
    p50: normalizeNumberArray(p50, "p50"),
    p90: normalizeNumberArray(p90, "p90"),
    spaghetti_sample: normalizeMatrix(spaghettiSample, "spaghetti_sample"),
    base_runway_months: normalizeOptionalNumberField(value.base_runway_months),
    survival_probability_12m: normalizeOptionalNumberField(value.survival_probability_12m),
    verdict: normalizeOptionalTextField(value.verdict),
    comment: normalizeOptionalTextField(value.comment),
    language: normalizeResultLanguage(value.language),
    levers: normalizeOptionalLevers(value.levers),
  };
}

const initialViewState: SimulatorViewState = {
  status: "idle",
  chatHistory: [],
  clarificationContext: null,
  parseData: null,
  simulationData: null,
  simulationParams: null,
  simulationMeta: null,
  errorMessage: null,
};

export default function SimulatorClient() {
  const [draft, setDraft] = useState("");
  const [viewState, setViewState] = useState<SimulatorViewState>(initialViewState);
  // What-If controls mutate this state; parseData stays as the parser snapshot.
  const [whatIfParams, setWhatIfParams] = useState<SimulationParams | null>(null);
  const [whatIfBaselineParams, setWhatIfBaselineParams] = useState<SimulationParams | null>(null);
  const [hasTouchedWhatIf, setHasTouchedWhatIf] = useState(false);
  const [baselineResult, setBaselineResult] = useState<BaselineResult | null>(null);
  const [baselineMonths, setBaselineMonths] = useState<number | null>(null);
  const [, setLatestResult] = useState<BaselineResult | null>(null);
  const [resultFlow, setResultFlow] = useState<ResultFlow | null>(null);
  const [isDesktopChart, setIsDesktopChart] = useState<boolean | null>(null);
  const [appliedAssumptionIds, setAppliedAssumptionIds] = useState<Set<string>>(() => new Set());
  const [keptAssumptionIds, setKeptAssumptionIds] = useState<Set<string>>(() => new Set());
  const [appliedSmartLeverId, setAppliedSmartLeverId] = useState<string | null>(null);
  const {
    status,
    chatHistory,
    clarificationContext,
    parseData,
    simulationData,
    simulationParams,
    simulationMeta,
    errorMessage,
  } = viewState;
  const currencySymbol = parseData?.status === "ready" ? parseData.currency_symbol : "$";
  const assumptionsUnderPressure =
    parseData?.assumptions && parseData.assumptions.length > 0 ? parseData.assumptions : null;

  useEffect(() => {
    setBaselineResult(readStoredResult(BASELINE_RESULT_STORAGE_KEY));
    setBaselineMonths(readStoredBaselineMonths());
    setLatestResult(readStoredResult(LATEST_RESULT_STORAGE_KEY));
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const syncChartMode = () => setIsDesktopChart(mediaQuery.matches);

    syncChartMode();
    mediaQuery.addEventListener("change", syncChartMode);

    return () => mediaQuery.removeEventListener("change", syncChartMode);
  }, []);

  const smartLevers = useMemo<SmartLever[] | null>(() => {
    const simulationLevers = simulationData?.levers
      ?.map((lever, index): SmartLever | null => {
        if (!lever.math_patch) {
          return null;
        }

        const title = lever.title ?? lever.action;
        return {
          id: `smart-lever-${index}-${title}`,
          title,
          effort: lever.effort ?? "Medium",
          impact_months: lever.impact_months,
          math_patch: lever.math_patch,
        };
      })
      .filter((lever): lever is SmartLever => lever !== null);

    if (simulationLevers && simulationLevers.length > 0) {
      return simulationLevers;
    }

    return parseData?.smart_levers && parseData.smart_levers.length > 0 ? parseData.smart_levers : null;
  }, [parseData?.smart_levers, simulationData?.levers]);

  const chartData = useMemo<MonteCarloChartPoint[]>(() => {
    if (!simulationData) {
      return [];
    }

    const pointCount = Math.min(
      simulationData.months.length,
      simulationData.p10.length,
      simulationData.p50.length,
      simulationData.p90.length,
    );
    const startIndex = pointCount > 1 && simulationData.months[0] === 0 ? 1 : 0;
    const horizon = pointCount - startIndex;
    if (horizon <= 0) {
      return [];
    }

    const sanitizedPaths = simulationData.spaghetti_sample.filter(
      (path) => Array.isArray(path) && path.length > startIndex && path.every((value) => Number.isFinite(value)),
    );

    return Array.from({ length: horizon }, (_, offset) => {
      const sourceIndex = startIndex + offset;
      const rawMonth = simulationData.months[sourceIndex];
      const month = Number.isFinite(rawMonth) && rawMonth > 0 ? Math.round(rawMonth) : offset + 1;
      const p10 = simulationData.p10[sourceIndex];
      const p50 = simulationData.p50[sourceIndex];
      const p90 = simulationData.p90[sourceIndex];

      if (!Number.isFinite(p10) || !Number.isFinite(p50) || !Number.isFinite(p90) || p10 > p50 || p50 > p90) {
        return null;
      }

      const bankruptCount = sanitizedPaths.reduce((count, path) => {
        const cappedIndex = Math.min(sourceIndex, path.length - 1);
        const bankruptByNow = path.slice(startIndex, cappedIndex + 1).some((capital) => capital <= 0);
        return count + (bankruptByNow ? 1 : 0);
      }, 0);

      const point: MonteCarloChartPoint = {
        month,
        p10,
        p50,
        p90,
        band: [p10, p90],
        bankruptcyRisk: sanitizedPaths.length > 0 ? (bankruptCount / sanitizedPaths.length) * 100 : 0,
      };

      sanitizedPaths.forEach((path, simIndex) => {
        point[`sim${simIndex}` as SimKey] = sourceIndex < path.length ? path[sourceIndex] : null;
      });

      return point;
    }).filter((point): point is MonteCarloChartPoint => point !== null);
  }, [simulationData]);

  const resultMetrics = useMemo<ResultMetricsViewModel | null>(() => {
    if (!simulationData || simulationData.base_runway_months === null) {
      return null;
    }

    return {
      runwayMonths: simulationData.base_runway_months,
      survivalPercent: normalizeProbabilityPercent(
        simulationData.survival_probability_12m ?? simulationData.survival_probability,
      ),
    };
  }, [simulationData]);

  const currentStoredResult = useMemo<BaselineResult | null>(() => {
    if (!resultMetrics) {
      return null;
    }

    return buildStoredResult(resultMetrics, simulationParams, normalizeOptionalTextField(simulationMeta?.generated_at));
  }, [resultMetrics, simulationMeta?.generated_at, simulationParams]);

  const chartSummary = useMemo(() => {
    if (!simulationData || !resultMetrics || chartData.length === 0) {
      return null;
    }

    const lastPoint = chartData[chartData.length - 1];

    return {
      survivalPct: resultMetrics.survivalPercent,
      bankruptcyPct: clampPct(lastPoint.bankruptcyRisk),
      medianEndingBalance: lastPoint.p50,
      optimisticEndingBalance: lastPoint.p90,
      pessimisticEndingBalance: lastPoint.p10,
      sampleSize: Object.keys(lastPoint).filter((key) => key.startsWith("sim")).length,
      horizon: chartData.length,
    };
  }, [chartData, resultMetrics, simulationData]);

  const deltaMonths = useMemo(() => {
    if (!resultMetrics || baselineMonths === null) {
      return null;
    }

    const delta = resultMetrics.runwayMonths - baselineMonths;
    return delta > 0 ? delta : null;
  }, [baselineMonths, resultMetrics]);

  const rawSeriesKeys = useMemo(
    () => Array.from({ length: chartSummary?.sampleSize ?? 0 }, (_, index) => `sim${index}` as SimKey),
    [chartSummary?.sampleSize],
  );

  const mobileChartData = useMemo<MonteCarloChartPoint[]>(() => {
    return chartData;
  }, [chartData]);

  const mobileRawSeriesKeys = useMemo(
    () => rawSeriesKeys.filter((_, index) => index % 4 === 0).slice(0, 14),
    [rawSeriesKeys],
  );

  const mobileXAxisTicks = useMemo(() => {
    if (mobileChartData.length === 0) {
      return [];
    }

    const lastMonth = mobileChartData[mobileChartData.length - 1].month;
    const middleMonth = Math.max(1, Math.round(lastMonth / 2));
    const candidates = [1, middleMonth, lastMonth];

    return candidates.filter(
      (month, index) => candidates.indexOf(month) === index && mobileChartData.some((point) => point.month === month),
    );
  }, [mobileChartData]);

  const mobileFocusLabel = useMemo(() => {
    if (mobileChartData.length === 0 || !chartSummary) {
      return null;
    }

    const lastMonth = mobileChartData[mobileChartData.length - 1].month;
    return lastMonth >= chartSummary.horizon ? `${chartSummary.horizon} months` : `M1-M${lastMonth} focus`;
  }, [chartSummary, mobileChartData]);

  const shareCard = useMemo<ShareCardViewModel | null>(() => {
    const verdict = simulationData?.verdict;
    const comment = simulationData?.comment;

    if (
      !resultMetrics ||
      typeof verdict !== "string" ||
      verdict.trim().length === 0 ||
      typeof comment !== "string" ||
      comment.trim().length === 0
    ) {
      return null;
    }

    const timestampIso = normalizeOptionalTextField(simulationMeta?.generated_at);
    const language = simulationData?.language ?? "en";
    const normalizedVerdict = clampText(verdict, 92);
    const normalizedComment = clampText(comment, 112);
    if (!normalizedVerdict || !normalizedComment) {
      return null;
    }

    const baselineHorizon = baselineResult?.horizonMonths;
    const currentHorizon = simulationParams?.months;
    const hasComparableHorizon =
      baselineHorizon === undefined || currentHorizon === undefined || baselineHorizon === currentHorizon;
    const rawDeltaRunwayMonths = baselineResult ? resultMetrics.runwayMonths - baselineResult.runwayMonths : null;
    const rawDeltaSurvivalPercent = baselineResult
      ? resultMetrics.survivalPercent - baselineResult.survivalPercent
      : null;
    const hasChanged =
      rawDeltaRunwayMonths !== null &&
      rawDeltaSurvivalPercent !== null &&
      (Math.abs(rawDeltaRunwayMonths) >= 0.05 || Math.abs(rawDeltaSurvivalPercent) >= 0.05);
    const hasDelta = resultFlow === "what-if" && Boolean(baselineResult) && hasComparableHorizon && hasChanged;

    return {
      timestampIso,
      timestampLabel: timestampIso ? formatShareTimestamp(timestampIso) : null,
      runwayValue: formatRunwayMonths(resultMetrics.runwayMonths),
      survivalValue: formatShareProbability(resultMetrics.survivalPercent),
      verdict: normalizedVerdict,
      comment: normalizedComment,
      language,
      labels: getShareLabels(language),
      baselineRunwayValue: hasDelta && baselineResult ? formatRunwayMonths(baselineResult.runwayMonths) : null,
      baselineSurvivalValue: hasDelta && baselineResult ? formatShareProbability(baselineResult.survivalPercent) : null,
      deltaRunwayMonths: hasDelta ? rawDeltaRunwayMonths : null,
      deltaSurvivalPercent: hasDelta ? rawDeltaSurvivalPercent : null,
      isImprovement:
        hasDelta && rawDeltaRunwayMonths !== null && rawDeltaSurvivalPercent !== null
          ? rawDeltaRunwayMonths > 0 || (rawDeltaRunwayMonths === 0 && rawDeltaSurvivalPercent > 0)
          : null,
      hasDelta,
    };
  }, [
    baselineResult,
    resultFlow,
    resultMetrics,
    simulationData?.comment,
    simulationData?.language,
    simulationData?.verdict,
    simulationMeta?.generated_at,
    simulationParams?.months,
  ]);

  const parsedParams = parseData?.status === "ready" ? parseData.params : null;
  const readyParams = whatIfParams ?? parsedParams;
  const escapeRoutes = useMemo<DisplaySmartLever[] | null>(() => {
    if (!smartLevers) {
      return null;
    }

    return smartLevers.map((lever) => ({
      ...lever,
      impactLabel: formatSmartLeverImpactLabel(lever, simulationParams ?? readyParams),
    }));
  }, [readyParams, simulationParams, smartLevers]);

  const serializedSimulationUrlParams = useMemo(() => {
    if (!simulationParams || !simulationData || !resultMetrics) {
      return null;
    }

    return buildSimulationUrlSearchParams({
      simulationData,
      resultMetrics,
      shareCard,
    }).toString();
  }, [resultMetrics, shareCard, simulationData, simulationParams]);

  const telegramLink = useMemo<TelegramLinkModel | null>(() => {
    const username = normalizeTelegramBotUsername(telegramBotUsername);
    if (!username || !resultMetrics) {
      return null;
    }

    const startToken = buildTelegramStartToken(resultMetrics);
    return {
      href: `https://t.me/${username}?start=${encodeURIComponent(startToken)}`,
      startToken,
    };
  }, [resultMetrics]);

  const currentCash = simulationParams?.initial_capital ?? null;
  const monthlyBurn = simulationParams?.monthly_burn ?? null;
  const targetFYouFund = monthlyBurn !== null ? monthlyBurn * 3 : null;
  const fYouFundGap = targetFYouFund !== null && currentCash !== null ? targetFYouFund - currentCash : null;

  useEffect(() => {
    if (!currentStoredResult || !resultFlow) {
      return;
    }

    const storedBaselineMonths = writeStoredBaselineMonthsOnce(currentStoredResult.runwayMonths);
    if (storedBaselineMonths !== null) {
      setBaselineMonths(storedBaselineMonths);
    }

    if (resultFlow === "parse") {
      setBaselineResult(currentStoredResult);
      setLatestResult(currentStoredResult);
      writeStoredResult(BASELINE_RESULT_STORAGE_KEY, currentStoredResult);
      writeStoredResult(LATEST_RESULT_STORAGE_KEY, currentStoredResult);
      return;
    }

    setLatestResult(currentStoredResult);
    writeStoredResult(LATEST_RESULT_STORAGE_KEY, currentStoredResult);
  }, [currentStoredResult, resultFlow]);

  useEffect(() => {
    if (!serializedSimulationUrlParams || typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    url.search = serializedSimulationUrlParams;
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [serializedSimulationUrlParams]);

  useEffect(() => {
    if (parseData?.status !== "ready") {
      setWhatIfParams(null);
      setWhatIfBaselineParams(null);
      setHasTouchedWhatIf(false);
      setResultFlow(null);
      setAppliedAssumptionIds(new Set());
      setKeptAssumptionIds(new Set());
      setAppliedSmartLeverId(null);
      return;
    }

    const sanitizedParams = sanitizeSimulationParams(parseData.params);
    setWhatIfParams(cloneSimulationParams(sanitizedParams));
    setWhatIfBaselineParams(cloneSimulationParams(sanitizedParams));
    setHasTouchedWhatIf(false);
    setAppliedAssumptionIds(new Set());
    setKeptAssumptionIds(new Set());
    setAppliedSmartLeverId(null);
  }, [parseData]);

  const isWhatIfDirty =
    Boolean(whatIfBaselineParams && readyParams) && !areSimulationParamsEqual(whatIfBaselineParams, readyParams);
  const isBusy = status === "parsing" || status === "simulating";
  const hasDraftText = draft.trim().length > 0;
  const composerLabel = status === "clarifying" ? "Clarification" : "Scenario";
  const submitLabel =
    status === "clarifying"
      ? "Submit answer"
      : status === "parsing"
        ? "Reading plan"
        : status === "simulating"
          ? "Simulating"
          : "Run simulation";
  const isSubmitDisabled = isBusy || !hasDraftText;
  const statusLabel =
    status === "parsing"
      ? "READING"
      : status === "clarifying"
        ? "CLARIFYING"
        : status === "simulating"
          ? "SIMULATING"
          : status === "simulated"
            ? "SIMULATED"
            : "READY";

  const handleWhatIfSuccess = useCallback((result: SimulationResponseData, meta: ApiMeta, params: SimulationParams) => {
    setResultFlow("what-if");
    setViewState((current) => {
      const previousSimulation = current.simulationData;
      const nextLevers =
        result.levers?.some((lever) => lever.math_patch)
          ? result.levers
          : previousSimulation?.levers ?? result.levers ?? null;

      return {
        ...current,
        simulationData: {
          ...result,
          verdict: result.verdict ?? previousSimulation?.verdict ?? null,
          comment: result.comment ?? previousSimulation?.comment ?? null,
          levers: nextLevers,
        },
        simulationParams: cloneSimulationParams(params),
        simulationMeta: meta,
        errorMessage: null,
      };
    });
  }, []);

  const handleWhatIfError = useCallback((error: DebouncedSimulationError) => {
    setViewState((current) => ({
      ...current,
      errorMessage: getFriendlySimulationErrorMessage(error),
    }));
  }, []);

  const whatIfSimulation = useDebouncedSimulation<SimulationParams, SimulationResponseData>({
    params: hasTouchedWhatIf && whatIfParams ? whatIfParams : null,
    enabled: status === "simulated" && hasTouchedWhatIf && whatIfParams !== null,
    delayMs: 300,
    normalizeResult: normalizeSimulationResponseData,
    onSuccess: handleWhatIfSuccess,
    onError: handleWhatIfError,
  });

  const handleWhatIfParamsChange = useCallback((nextParams: SimulationParams) => {
    setHasTouchedWhatIf(true);
    setWhatIfParams(sanitizeSimulationParams(nextParams));
    setAppliedSmartLeverId(null);
  }, []);

  const handleApplySmartLever = useCallback(
    (lever: SmartLever) => {
      if (appliedSmartLeverId === lever.id) {
        return;
      }

      setHasTouchedWhatIf(true);
      setWhatIfParams((currentParams) => {
        const baseParams =
          currentParams ?? (parseData?.status === "ready" ? sanitizeSimulationParams(parseData.params) : null);

        if (!baseParams) {
          return currentParams;
        }

        return applySmartLeverMathPatch(baseParams, lever.math_patch);
      });
      setAppliedSmartLeverId(lever.id);
    },
    [appliedSmartLeverId, parseData],
  );

  const handleApplyAssumptionStress = useCallback(
    (assumption: ParserAssumption) => {
      const stress = assumption.suggested_stress;
      const stressPatch = stress ? getStressParamPatch(stress) : null;
      if (!stressPatch) {
        return;
      }

      setHasTouchedWhatIf(true);
      setWhatIfParams((currentParams) => {
        const baseParams =
          currentParams ?? (parseData?.status === "ready" ? sanitizeSimulationParams(parseData.params) : null);

        if (!baseParams) {
          return currentParams;
        }

        return sanitizeSimulationParams({
          ...baseParams,
          ...stressPatch,
        });
      });
      setAppliedAssumptionIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.add(assumption.id);
        return nextIds;
      });
      setKeptAssumptionIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(assumption.id);
        return nextIds;
      });
      setAppliedSmartLeverId(null);
    },
    [parseData],
  );

  const handleKeepAssumption = useCallback((assumption: ParserAssumption) => {
    const stress = assumption.suggested_stress;
    const stressPatch = stress ? getStressParamPatch(stress) : null;
    if (stressPatch) {
      setHasTouchedWhatIf(true);
      setWhatIfParams((currentParams) => {
        const baselineParams =
          whatIfBaselineParams ?? (parseData?.status === "ready" ? sanitizeSimulationParams(parseData.params) : null);
        if (!currentParams || !baselineParams) {
          return currentParams;
        }

        const stressedParams = sanitizeSimulationParams({
          ...baselineParams,
          ...stressPatch,
        });

        const isCurrentStressApplied = Object.keys(stressPatch).every((key) => {
          const paramKey = key as keyof SimulationParams;
          return currentParams[paramKey] === stressedParams[paramKey];
        });

        if (!isCurrentStressApplied) {
          return currentParams;
        }

        return sanitizeSimulationParams({
          ...currentParams,
          ...Object.keys(stressPatch).reduce<Partial<SimulationParams>>((nextParams, key) => {
            const paramKey = key as keyof SimulationParams;
            nextParams[paramKey] = baselineParams[paramKey];
            return nextParams;
          }, {}),
        });
      });
    }

    setKeptAssumptionIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(assumption.id);
      return nextIds;
    });
    setAppliedAssumptionIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(assumption.id);
      return nextIds;
    });
  }, [parseData, whatIfBaselineParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isBusy) {
      return;
    }

    const trimmedDraft = draft.trim();
    if (!trimmedDraft) {
      return;
    }

    const isClarificationReply = status === "clarifying" && clarificationContext !== null;
    const planText = isClarificationReply ? clarificationContext.plan : trimmedDraft;
    const parseInput = isClarificationReply
      ? `Plan: ${clarificationContext.plan}. Question: ${clarificationContext.question}. Answer: ${trimmedDraft}`
      : trimmedDraft;
    const fallbackStatus: FlowStatus = isClarificationReply ? "clarifying" : simulationData ? "simulated" : "idle";
    const userMessage = createMessage("user", parseInput);

    setDraft("");
    if (!isClarificationReply) {
      setWhatIfParams(null);
      setWhatIfBaselineParams(null);
      setHasTouchedWhatIf(false);
      setResultFlow(null);
    }

    setViewState((current) => ({
      ...current,
      status: "parsing",
      errorMessage: null,
      parseData: null,
      simulationData: isClarificationReply ? current.simulationData : null,
      simulationParams: isClarificationReply ? current.simulationParams : null,
      simulationMeta: isClarificationReply ? current.simulationMeta : null,
      chatHistory: [...current.chatHistory, userMessage],
    }));

    try {
      const parseEnvelope = await postEnvelope<unknown>("/api/parse", { text: parseInput });
      if (parseEnvelope.error) {
        throw new Error(parseEnvelope.error.message);
      }

      const normalizedParseData = normalizeParseResponseData(parseEnvelope.data);

      if (normalizedParseData.status === "needs_clarification") {
        const clarificationMessage = createMessage("ai", normalizedParseData.question);

        setViewState((current) => ({
          ...current,
          status: "clarifying",
          clarificationContext: {
            plan: planText,
            question: normalizedParseData.question,
          },
          parseData: normalizedParseData,
          chatHistory: [...current.chatHistory, clarificationMessage],
        }));
        return;
      }

      const normalizedSimulationData = normalizeSimulationResponseData(parseEnvelope.data);
      setResultFlow("parse");
      const resultLanguage = normalizedParseData.language;
      const parserReadyMessage = createMessage(
        "ai",
        resultLanguage === "ru"
          ? `\u041f\u041b\u0410\u041d \u041f\u0420\u0418\u041d\u042f\u0422 | \u041a\u0410\u041f\u0418\u0422\u0410\u041b ${normalizedParseData.params.initial_capital} | \u0420\u0410\u0421\u0425\u041e\u0414 ${normalizedParseData.params.monthly_burn} | \u0414\u041e\u0425\u041e\u0414 ${normalizedParseData.params.monthly_income} | \u0417\u0410\u0414\u0415\u0420\u0416\u041a\u0410 ${normalizedParseData.params.income_delay_months}\u041c`
          : `PLAN CAPTURED | CAPITAL ${normalizedParseData.params.initial_capital} | BURN ${normalizedParseData.params.monthly_burn} | INCOME ${normalizedParseData.params.monthly_income} | DELAY ${normalizedParseData.params.income_delay_months}M`,
      );
      const simulationCompleteMessage = createMessage(
        "ai",
        resultLanguage === "ru"
          ? `\u0421\u0418\u041c\u0423\u041b\u042f\u0426\u0418\u042f \u0413\u041e\u0422\u041e\u0412\u0410 | \u0412\u042b\u0416\u0418\u0412\u0410\u0415\u041c\u041e\u0421\u0422\u042c ${normalizeProbabilityPercent(
              normalizedSimulationData.survival_probability_12m ?? normalizedSimulationData.survival_probability,
            ).toFixed(1)}%`
          : `SIMULATION COMPLETE | SURVIVAL ${normalizeProbabilityPercent(
              normalizedSimulationData.survival_probability_12m ?? normalizedSimulationData.survival_probability,
            ).toFixed(1)}%`,
      );

      setViewState((current) => ({
        ...current,
        status: "simulated",
        clarificationContext: null,
        parseData: normalizedParseData,
        simulationData: normalizedSimulationData,
        simulationParams: cloneSimulationParams(sanitizeSimulationParams(normalizedParseData.params)),
        simulationMeta: parseEnvelope.meta,
        errorMessage: null,
        chatHistory: [...current.chatHistory, parserReadyMessage, simulationCompleteMessage],
      }));
    } catch (err) {
      console.error("[SimClient] LLM parse error:", err);
      const errorMsg = getFriendlyErrorMessage(err);

      setViewState((current) => ({
        ...current,
        status: fallbackStatus,
        errorMessage: errorMsg,
      }));
    }
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.06),transparent_22%),radial-gradient(circle_at_70%_78%,rgba(16,185,129,0.1),transparent_24%)]" />

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:px-8">
        <header className={`${panelClass} order-2 relative overflow-hidden px-5 py-5 sm:px-6 sm:py-6 xl:order-1`}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]" />

          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-300/90">
                MonteRun Analytics
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-[2.6rem]">
                Cash runway intelligence with delayed-income modeling
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62 sm:text-[15px]">
                Stop guessing your runway. Get hard numbers, stress-test your reality, and find your escape route in 10 seconds.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">State</div>
                <div className="mt-2 font-mono text-sm text-white tabular-nums">
                  {isWhatIfDirty ? "WHAT-IF" : statusLabel}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Messages</div>
                <div className="mt-2 font-mono text-sm text-white tabular-nums">{chatHistory.length}</div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Income Delay</div>
                <div className="mt-2 font-mono text-sm text-white tabular-nums">
                  {readyParams ? formatDelayMonths(readyParams.income_delay_months) : "--"}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Horizon</div>
                <div className="mt-2 font-mono text-sm text-white tabular-nums">
                  {chartSummary ? `${chartSummary.horizon}m` : readyParams ? `${readyParams.months}m` : "--"}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="order-1 grid gap-6 xl:order-2 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="order-1 space-y-6 xl:order-none xl:col-start-1">
            <div className={`${panelClass} px-5 py-5 sm:px-6`}>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">{composerLabel}</div>
                  <label className="mt-2 block text-lg font-medium text-white" htmlFor="scenario-input">
                    Describe your financial scenario
                  </label>
                </div>
                {readyParams ? (
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/60 tabular-nums">
                    {readyParams.n_simulations} sims
                  </div>
                ) : null}
              </div>
              <form className="space-y-4" onSubmit={handleSubmit}>
                {clarificationContext ? (
                  <div className="rounded-3xl border border-white/10 bg-white/6 px-4 py-4 text-sm text-white/82">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/90">Clarification</div>
                    <div className="mt-2 whitespace-pre-wrap">{clarificationContext.question}</div>
                  </div>
                ) : null}
                <textarea
                  aria-describedby="scenario-input-help"
                  className="h-36 min-h-36 w-full rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] px-4 py-4 text-[15px] text-white outline-none placeholder:text-white/34 disabled:opacity-60 sm:h-48"
                  disabled={isBusy}
                  id="scenario-input"
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    status === "clarifying"
                      ? "Enter the answer to the clarification question..."
                      : "I have $5,000, no job, $2,000/mo expenses, starting freelance work..."
                  }
                  required
                  spellCheck={false}
                  value={draft}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="inline-flex items-center rounded-full border border-white/10 bg-emerald-400/12 px-4 py-2.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/38"
                    disabled={isSubmitDisabled}
                    type="submit"
                  >
                    {submitLabel}
                  </button>
                  <div className="text-[13px] text-white/48" id="scenario-input-help">
                    Describe the plan. MonteRun turns it into survival math.
                  </div>
                </div>
              </form>
              {errorMessage ? (
                <div
                  className="mt-4 rounded-3xl border border-red-300/20 bg-[linear-gradient(180deg,rgba(248,113,113,0.16),rgba(127,29,29,0.16))] px-4 py-3 shadow-[0_18px_50px_rgba(127,29,29,0.22)]"
                  role="alert"
                >
                  <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-red-200/82">
                    Scenario blocked
                  </div>
                <div className="mt-2 text-sm leading-6 text-red-50/90">{errorMessage}</div>
              </div>
            ) : null}
            </div>
          </section>

          <section className="order-3 space-y-6 xl:order-none xl:col-start-1 xl:row-start-2">
            <WhatIfControls
              currencySymbol={currencySymbol}
              disabled={status !== "simulated"}
              loading={whatIfSimulation.isPending}
              onChange={handleWhatIfParamsChange}
              params={readyParams}
            />

            <div className={`${panelClass} px-5 py-5 sm:px-6`}>
              <div className="mb-5">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">Conversation</div>
                <div className="mt-2 text-lg font-medium text-white">Prompt and response history</div>
              </div>
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {chatHistory.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/4 px-4 py-8 text-sm text-white/42">
                    No messages yet.
                  </div>
                ) : (
                  chatHistory.map((message) => (
                    <div
                      key={message.id}
                      className={
                        message.role === "user"
                          ? "rounded-3xl border border-white/10 bg-white/6 px-4 py-4 text-sm text-white/88"
                          : "rounded-3xl border border-white/10 bg-[rgba(16,185,129,0.06)] px-4 py-4 text-sm text-white/82"
                      }
                    >
                      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/42">{message.role}</div>
                      <div className="whitespace-pre-wrap break-words leading-6">{message.content}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="order-2 space-y-6 xl:order-none xl:col-start-2 xl:row-span-2 xl:row-start-1">
            <div className={`${panelClass} overflow-hidden`}>
              <div className="border-b border-white/10 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">Monte Carlo output</div>
                    <div className="mt-2 text-xl font-medium text-white">Confidence band with raw trajectory texture</div>
                  </div>

                  {chartSummary ? (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Survival</div>
                        <div className="mt-2 font-mono text-base text-white tabular-nums">
                          {chartSummary.survivalPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="hidden rounded-3xl border border-white/10 bg-white/5 px-4 py-3 md:block">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Bankruptcy</div>
                        <div className="mt-2 font-mono text-base text-white tabular-nums">
                          {chartSummary.bankruptcyPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="hidden rounded-3xl border border-white/10 bg-white/5 px-4 py-3 md:block">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Median End</div>
                        <div className="mt-2 font-mono text-base text-white tabular-nums">
                          {formatCurrency(chartSummary.medianEndingBalance, currencySymbol)}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {chartSummary && chartData.length > 0 ? (
                <div className="px-3 py-3 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
                  <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:rounded-[30px] sm:p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3 md:mb-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">Scenario readout</div>
                        <h2 className="mt-2 text-lg font-medium text-white">Runway distribution</h2>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/62 tabular-nums md:block">
                          {chartSummary.horizon} months
                        </div>
                        {mobileFocusLabel ? (
                          <div className="rounded-full border border-emerald-200/16 bg-emerald-300/8 px-3 py-1.5 font-mono text-[11px] text-emerald-100/76 tabular-nums md:hidden">
                            {mobileFocusLabel}
                          </div>
                        ) : null}
                        <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/62 tabular-nums md:block">
                          P90 {formatCurrency(chartSummary.optimisticEndingBalance, currencySymbol)}
                        </div>
                        <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/62 tabular-nums md:block">
                          P10 {formatCurrency(chartSummary.pessimisticEndingBalance, currencySymbol)}
                        </div>
                      </div>
                    </div>

                    {isDesktopChart === false ? (
                    <div className="md:hidden">
                      <div className="relative h-[315px] min-h-[315px] min-w-0 overflow-hidden rounded-[22px] border border-white/10 bg-[radial-gradient(circle_at_24%_12%,rgba(16,185,129,0.13),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.012))] px-1.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_38px_rgba(16,185,129,0.05)]">
                        {whatIfSimulation.isPending ? (
                          <div
                            aria-live="polite"
                            className="absolute inset-0 z-10 grid place-items-center bg-black/36 backdrop-blur-[2px]"
                          >
                            <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200/20 bg-black/52 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-100 shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
                              <span className="h-3 w-3 animate-spin rounded-full border border-emerald-100/80 border-t-transparent" />
                              Recalculating
                            </div>
                          </div>
                        ) : null}
                        <ResponsiveContainer
                          width="100%"
                          height="100%"
                          minHeight={292}
                          initialDimension={{ width: 360, height: 292 }}
                        >
                          <ComposedChart data={mobileChartData} margin={{ top: 12, right: 12, bottom: 6, left: -8 }}>
                            <defs>
                              <linearGradient id="chartBand" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="rgba(16,185,129,0.24)" />
                                <stop offset="58%" stopColor="rgba(16,185,129,0.10)" />
                                <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                              </linearGradient>
                              <filter id="quantileGlow" height="160%" width="160%" x="-30%" y="-30%">
                                <feGaussianBlur result="blur" stdDeviation="3" />
                                <feMerge>
                                  <feMergeNode in="blur" />
                                  <feMergeNode in="SourceGraphic" />
                                </feMerge>
                              </filter>
                            </defs>

                            <CartesianGrid stroke="rgba(255,255,255,0.045)" strokeDasharray="3 7" vertical={false} />
                            <XAxis
                              axisLine={false}
                              dataKey="month"
                              ticks={mobileXAxisTicks}
                              tick={{
                                fill: "rgba(255,255,255,0.44)",
                                fontSize: 10,
                                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              }}
                              tickFormatter={(value: number) => `M${value}`}
                              tickLine={false}
                            />
                            <YAxis
                              axisLine={false}
                              domain={[
                                (dataMin: number) => Math.min(dataMin, 0),
                                (dataMax: number) => Math.max(dataMax, 0),
                              ]}
                              tick={{
                                fill: "rgba(255,255,255,0.42)",
                                fontSize: 10,
                                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              }}
                              tickCount={4}
                              tickFormatter={(value: number) => formatMobileAxisCurrency(value, currencySymbol)}
                              tickLine={false}
                              width={48}
                            />
                            <ReferenceLine stroke="rgba(255,255,255,0.16)" strokeDasharray="4 6" y={0} />
                            <Tooltip
                              cursor={{ stroke: "rgba(255,255,255,0.24)", strokeWidth: 1, strokeDasharray: "3 3" }}
                              content={<CustomTooltip currencySymbol={currencySymbol} />}
                            />

                            {mobileRawSeriesKeys.map((key) => (
                              <Line
                                key={key}
                                dataKey={key}
                                dot={false}
                                activeDot={false}
                                isAnimationActive={false}
                                stroke="rgba(255,255,255,0.08)"
                                strokeWidth={1}
                                strokeLinecap="round"
                                type="linear"
                              />
                            ))}

                            <Area dataKey="band" fill="url(#chartBand)" stroke="none" opacity={0.3} type="linear" />

                            <Line
                              dataKey="p90"
                              dot={false}
                              filter="url(#quantileGlow)"
                              isAnimationActive={false}
                              stroke="rgba(236,253,245,0.76)"
                              strokeDasharray="5 6"
                              strokeWidth={2}
                              type="linear"
                            />
                            <Line
                              dataKey="p50"
                              dot={false}
                              filter="url(#quantileGlow)"
                              isAnimationActive={false}
                              stroke="#10b981"
                              strokeWidth={3.5}
                              type="linear"
                            />
                            <Line
                              dataKey="p10"
                              dot={false}
                              filter="url(#quantileGlow)"
                              isAnimationActive={false}
                              stroke="rgba(167,243,208,0.62)"
                              strokeDasharray="5 6"
                              strokeWidth={2}
                              type="linear"
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    ) : null}

                    {isDesktopChart === true ? (
                    <div className="hidden md:block">
                      <div className="relative h-[380px] min-h-[380px] min-w-0 overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-2 lg:h-[430px] lg:min-h-[430px]">
                        {whatIfSimulation.isPending ? (
                          <div
                            aria-live="polite"
                            className="absolute inset-0 z-10 grid place-items-center bg-black/36 backdrop-blur-[2px]"
                          >
                            <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200/20 bg-black/52 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-emerald-100 shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
                              <span className="h-3 w-3 animate-spin rounded-full border border-emerald-100/80 border-t-transparent" />
                              Recalculating
                            </div>
                          </div>
                        ) : null}
                        <ResponsiveContainer
                          width="100%"
                          height="100%"
                          minHeight={360}
                          initialDimension={{ width: 720, height: 360 }}
                        >
                          <ComposedChart data={chartData} margin={{ top: 14, right: 24, bottom: 12, left: 8 }}>
                            <defs>
                              <linearGradient id="chartBandDesktop" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="rgba(16,185,129,0.22)" />
                                <stop offset="55%" stopColor="rgba(16,185,129,0.12)" />
                                <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                              </linearGradient>
                              <filter id="quantileGlowDesktop" height="160%" width="160%" x="-30%" y="-30%">
                                <feGaussianBlur result="blur" stdDeviation="3" />
                                <feMerge>
                                  <feMergeNode in="blur" />
                                  <feMergeNode in="SourceGraphic" />
                                </feMerge>
                              </filter>
                            </defs>

                            <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                            <XAxis
                              axisLine={false}
                              dataKey="month"
                              interval="preserveStartEnd"
                              tick={{
                                fill: "rgba(255,255,255,0.46)",
                                fontSize: 12,
                                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              }}
                              tickFormatter={(value: number) => `M${value}`}
                              tickLine={false}
                            />
                            <YAxis
                              axisLine={false}
                              domain={[
                                (dataMin: number) => Math.min(dataMin, 0),
                                (dataMax: number) => Math.max(dataMax, 0),
                              ]}
                              tick={{
                                fill: "rgba(255,255,255,0.46)",
                                fontSize: 12,
                                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                              }}
                              tickFormatter={(value: number) => formatAxisCurrency(value, currencySymbol)}
                              tickLine={false}
                              width={72}
                            />
                            <ReferenceLine stroke="rgba(255,255,255,0.14)" strokeDasharray="4 4" y={0} />
                            <Tooltip
                              cursor={{ stroke: "rgba(255,255,255,0.24)", strokeWidth: 1, strokeDasharray: "3 3" }}
                              content={<CustomTooltip currencySymbol={currencySymbol} />}
                            />

                            {rawSeriesKeys.map((key) => (
                              <Line
                                key={key}
                                dataKey={key}
                                dot={false}
                                activeDot={false}
                                isAnimationActive={false}
                                stroke="rgba(255,255,255,0.09)"
                                strokeWidth={1}
                                strokeLinecap="round"
                                type="monotone"
                              />
                            ))}

                            <Area dataKey="band" fill="url(#chartBandDesktop)" stroke="none" opacity={0.26} type="monotone" />

                            <Line
                              dataKey="p90"
                              dot={false}
                              filter="url(#quantileGlowDesktop)"
                              isAnimationActive={false}
                              stroke="rgba(236,253,245,0.82)"
                              strokeDasharray="6 5"
                              strokeWidth={2}
                              type="monotone"
                            />
                            <Line
                              dataKey="p50"
                              dot={false}
                              filter="url(#quantileGlowDesktop)"
                              isAnimationActive={false}
                              stroke="#10b981"
                              strokeWidth={3}
                              type="monotone"
                            />
                            <Line
                              dataKey="p10"
                              dot={false}
                              filter="url(#quantileGlowDesktop)"
                              isAnimationActive={false}
                              stroke="rgba(167,243,208,0.74)"
                              strokeDasharray="6 5"
                              strokeWidth={2}
                              type="monotone"
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    ) : null}

                    {shareCard ? (
                      <article className="share-card" aria-label={shareCard.labels.cardAria}>
                        <header className="share-card__header">
                          <div className="share-card__brand">
                            <span aria-hidden="true" className="share-card__brand-mark" />
                            <span>MonteRun</span>
                          </div>

                          {shareCard.timestampIso && shareCard.timestampLabel ? (
                            <time className="share-card__timestamp" dateTime={shareCard.timestampIso}>
                              <span className="share-card__timestamp-badge">SIM</span>
                              <span>{shareCard.timestampLabel}</span>
                            </time>
                          ) : null}
                        </header>

                        <section className="share-card__hero" aria-label={shareCard.labels.heroAria}>
                          <div className="share-card__runway-block">
                            <div className="share-card__eyebrow">{shareCard.labels.simulationResult}</div>
                            <div className="share-card__runway">
                              <div className="share-card__runway-value">{shareCard.runwayValue}</div>
                              <div className="share-card__runway-unit">{shareCard.labels.monthsUnit}</div>
                              {shareCard.hasDelta && shareCard.deltaRunwayMonths !== null ? (
                                <div
                                  className={`share-card__delta-pill ${
                                    shareCard.isImprovement ? "share-card__delta-pill--up" : "share-card__delta-pill--down"
                                  }`}
                                >
                                  <span aria-hidden="true">
                                    {shareCard.isImprovement ? shareCard.labels.up : shareCard.labels.down}
                                  </span>
                                  <span>
                                    {shareCard.deltaRunwayMonths > 0 ? "+" : ""}
                                    {formatRunwayMonths(shareCard.deltaRunwayMonths)}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                            {shareCard.hasDelta && shareCard.baselineRunwayValue ? (
                              <p className="share-card__baseline-note">
                                {shareCard.labels.baselinePrefix} {shareCard.baselineRunwayValue}{" "}
                                {shareCard.labels.monthsUnit.toLowerCase()}
                              </p>
                            ) : null}
                            <p className="share-card__hero-note">{shareCard.comment}</p>
                          </div>

                          <div className="share-card__metric">
                            <div className="share-card__metric-row">
                              <div
                                className={
                                  shareCard.hasDelta
                                    ? "share-card__metric-value share-card__metric-value--delta"
                                    : "share-card__metric-value"
                                }
                              >
                                {shareCard.hasDelta && shareCard.baselineSurvivalValue ? (
                                  <>
                                    <span className="share-card__metric-baseline">
                                      {shareCard.baselineSurvivalValue}
                                    </span>
                                    <span className="share-card__metric-arrow" aria-hidden="true">
                                      {"->"}
                                    </span>
                                  </>
                                ) : null}
                                <span>{shareCard.survivalValue}</span>
                              </div>
                              <div className="share-card__metric-label">{shareCard.labels.survivalMetric}</div>
                            </div>
                          </div>
                        </section>

                        <section className="share-card__verdict" aria-label={shareCard.labels.verdictAria}>
                          <div className="share-card__section-kicker">{shareCard.labels.verdict}</div>
                          <p className="share-card__verdict-text">{shareCard.verdict}</p>
                          {fYouFundGap !== null ? (
                            <p
                              className={
                                fYouFundGap > 0
                                  ? "m-0 max-w-2xl text-sm leading-6 text-amber-400/90"
                                  : "m-0 max-w-2xl text-sm leading-6 text-emerald-400"
                              }
                            >
                              {fYouFundGap > 0
                                ? `\u0422\u0432\u043e\u0439 F-You Fund \u043f\u0443\u0441\u0442. \u0422\u0435\u0431\u0435 \u043d\u0443\u0436\u043d\u043e \u043d\u0430\u043a\u043e\u043f\u0438\u0442\u044c \u0435\u0449\u0435 ${fYouFundGap.toLocaleString()}, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0437\u0432\u043e\u043b\u0438\u0442\u044c \u0441\u0435\u0431\u0435 \u0440\u043e\u0441\u043a\u043e\u0448\u044c \u043f\u043e\u0441\u043b\u0430\u0442\u044c \u0442\u043e\u043a\u0441\u0438\u0447\u043d\u043e\u0433\u043e \u043a\u043b\u0438\u0435\u043d\u0442\u0430 \u0438 \u0441\u043f\u043e\u043a\u043e\u0439\u043d\u043e \u0438\u0441\u043a\u0430\u0442\u044c \u043d\u043e\u0432\u043e\u0433\u043e 3 \u043c\u0435\u0441\u044f\u0446\u0430.`
                                : "\u0422\u0432\u043e\u0439 F-You Fund \u0437\u0430\u0440\u044f\u0436\u0435\u043d. \u0422\u044b \u043c\u043e\u0436\u0435\u0448\u044c \u0445\u043b\u043e\u043f\u043d\u0443\u0442\u044c \u0434\u0432\u0435\u0440\u044c\u044e \u043f\u0440\u044f\u043c\u043e \u0441\u0435\u0433\u043e\u0434\u043d\u044f \u0438 \u043f\u0440\u043e\u0436\u0438\u0442\u044c 3 \u043c\u0435\u0441\u044f\u0446\u0430 \u0431\u0435\u0437 \u043d\u043e\u0432\u044b\u0445 \u0437\u0430\u043a\u0430\u0437\u043e\u0432."}
                            </p>
                          ) : null}
                        </section>

                        {deltaMonths !== null ? <DeltaShareCard deltaMonths={deltaMonths} /> : null}

                        {telegramLink ? (
                          <div className="share-card__reality-check">
                            <a
                              aria-label={`${shareCard.labels.telegramCta} ${telegramLink.startToken}`}
                              className="share-card__reality-button share-card__reality-button--telegram"
                              href={telegramLink.href}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {shareCard.labels.telegramCta}
                            </a>
                          </div>
                        ) : null}

                        {assumptionsUnderPressure ? (
                          <section
                            aria-label="Assumptions under pressure"
                            className="rounded-[18px] border border-red-400/22 bg-[linear-gradient(135deg,rgba(127,29,29,0.36),rgba(5,5,5,0.92)_46%,rgba(6,78,59,0.18))] p-4 shadow-[inset_0_1px_0_rgba(239,68,68,0.10),0_18px_70px_rgba(127,29,29,0.16)] sm:p-5"
                          >
                            <div className="flex flex-col gap-2 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <div className="share-card__section-kicker">Assumptions under pressure</div>
                              </div>
                              <div className="rounded-full border border-red-300/20 bg-red-400/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-red-200">
                                {assumptionsUnderPressure.length} at risk
                              </div>
                            </div>

                            <div className="mt-4 grid gap-3">
                              {assumptionsUnderPressure.map((assumption, index) => {
                                const stress = assumption.suggested_stress;
                                const canApplyStress = stress ? getStressParamPatch(stress) !== null : false;
                                const isApplied = appliedAssumptionIds.has(assumption.id);
                                const isKept = keptAssumptionIds.has(assumption.id);
                                const stressLabel = formatStressLabel(stress, currencySymbol);

                                return (
                                  <article
                                    key={assumption.id}
                                    className="grid gap-4 rounded-[14px] border border-white/10 bg-black/40 p-4 shadow-[inset_3px_0_0_rgba(239,68,68,0.64)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="rounded-full border border-red-300/20 bg-red-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-red-200">
                                          Risk {String(index + 1).padStart(2, "0")}
                                        </span>
                                        {stressLabel ? (
                                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/52">
                                            {stressLabel}
                                          </span>
                                        ) : null}
                                      </div>
                                      <p className="mt-3 text-sm leading-6 text-white/86">{assumption.statement}</p>
                                      {assumption.risk ? (
                                        <p className="mt-2 text-[13px] leading-5 text-red-100/68">{assumption.risk}</p>
                                      ) : null}
                                    </div>

                                    <div className="flex flex-wrap gap-2 sm:justify-end">
                                      <button
                                        className={
                                          isApplied
                                            ? "rounded-full border border-emerald-300/24 bg-emerald-400/14 px-3 py-2 text-xs font-medium text-emerald-200"
                                            : "rounded-full border border-red-300/24 bg-red-400/12 px-3 py-2 text-xs font-medium text-red-100 transition hover:border-red-200/42 hover:bg-red-400/18 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/34"
                                        }
                                        disabled={!canApplyStress || isApplied}
                                        onClick={() => handleApplyAssumptionStress(assumption)}
                                        type="button"
                                      >
                                        {isApplied ? "Applied" : "Apply stress"}
                                      </button>
                                      <button
                                        className={
                                          isKept
                                            ? "rounded-full border border-emerald-300/24 bg-emerald-400/14 px-3 py-2 text-xs font-medium text-emerald-200"
                                            : "rounded-full border border-emerald-300/20 bg-emerald-400/8 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:border-emerald-200/38 hover:bg-emerald-400/14"
                                        }
                                        onClick={() => handleKeepAssumption(assumption)}
                                        type="button"
                                      >
                                        {isKept ? "Kept" : "Keep assumption"}
                                      </button>
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          </section>
                        ) : null}

                        <section
                          aria-label="Escape Routes"
                          className="rounded-[18px] border border-emerald-300/18 bg-[linear-gradient(135deg,rgba(6,78,59,0.28),rgba(5,5,5,0.92)_48%,rgba(148,163,184,0.08))] p-4 shadow-[inset_0_1px_0_rgba(16,185,129,0.12),0_18px_70px_rgba(6,78,59,0.14)] sm:p-5"
                        >
                          <div className="flex flex-col gap-2 border-b border-white/10 pb-4 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <div className="share-card__section-kicker">Escape Routes</div>
                            </div>
                            {whatIfSimulation.isPending ? (
                              <div className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-emerald-100">
                                Recalculating
                              </div>
                            ) : null}
                          </div>

                          {escapeRoutes ? (
                            <div className="mt-4 grid gap-3 lg:grid-cols-3">
                              {escapeRoutes.map((lever, index) => {
                                const isApplied = appliedSmartLeverId === lever.id;
                                const patchEffect = formatSmartLeverPatchEffect(
                                  lever.math_patch,
                                  readyParams,
                                  currencySymbol,
                                );

                                return (
                                  <button
                                    key={lever.id}
                                    className={
                                      isApplied
                                        ? "group grid h-full min-h-[178px] gap-4 rounded-[14px] border border-emerald-200/34 bg-emerald-400/14 p-4 text-left shadow-[inset_3px_0_0_rgba(52,211,153,0.86)]"
                                        : "group grid h-full min-h-[178px] gap-4 rounded-[14px] border border-white/10 bg-black/38 p-4 text-left shadow-[inset_3px_0_0_rgba(16,185,129,0.52)] transition hover:border-emerald-200/34 hover:bg-emerald-400/10 focus:outline-none focus:ring-2 focus:ring-emerald-200/50"
                                    }
                                    disabled={isApplied || status !== "simulated" || whatIfSimulation.isPending}
                                    onClick={() => handleApplySmartLever(lever)}
                                    type="button"
                                  >
                                    <span className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-200">
                                        Route {String(index + 1).padStart(2, "0")}
                                      </span>
                                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/56">
                                        {lever.effort}
                                      </span>
                                    </span>
                                    <span className="grid gap-2">
                                      <span className="font-mono text-[12px] leading-5 text-emerald-100/90">
                                        {patchEffect}
                                      </span>
                                    </span>
                                    <span className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/46">
                                        {lever.impactLabel}
                                      </span>
                                      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-emerald-200">
                                        {isApplied ? "Applied" : "Apply"}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="mt-4 rounded-[14px] border border-dashed border-white/10 bg-black/28 px-4 py-5 text-sm leading-6 text-white/48">
                              No escape routes for this scenario.
                            </div>
                          )}
                        </section>

                        <footer className="share-card__footer">
                          <span>monterun.io</span>
                          <span>{FINANCIAL_GUARDRAIL}</span>
                          <strong>Math decides.</strong>
                        </footer>
                      </article>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="px-5 py-10">
                  <div className="rounded-[28px] border border-dashed border-white/10 bg-white/4 px-5 py-12 text-center text-sm text-white/42">
                    Run a scenario to render the mesh-backed Monte Carlo chart with delayed-income logic.
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <style jsx>{`
          .share-card {
            --bg: #0a0a0a;
            --surface-1: #101010;
            --surface-2: #141414;
            --surface-3: #171717;
            --line: #222222;
            --line-soft: rgba(255, 255, 255, 0.05);
            --text-primary: #ffffff;
            --text-secondary: #aaaaaa;
            --text-muted: #666666;
            --accent: #00ffaa;
            --accent-soft: rgba(0, 255, 170, 0.12);
            --accent-glow: rgba(0, 255, 170, 0.18);
            position: relative;
            isolation: isolate;
            display: grid;
            gap: 28px;
            margin-top: 20px;
            padding: 28px;
            background:
              linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.01)),
              linear-gradient(160deg, rgba(255, 255, 255, 0.015), transparent 44%),
              var(--surface-1);
            border: 1px solid var(--line);
            border-radius: 28px;
            box-shadow: 0 24px 90px rgba(0, 0, 0, 0.65);
            overflow: hidden;
          }

          .share-card::before {
            content: "";
            position: absolute;
            inset: 0;
            background:
              linear-gradient(120deg, rgba(0, 255, 170, 0.06), transparent 26%),
              radial-gradient(circle at top right, rgba(0, 255, 170, 0.1), transparent 30%),
              linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.02));
            pointer-events: none;
            z-index: -2;
          }

          .share-card::after {
            content: "";
            position: absolute;
            inset: 0;
            background-image:
              linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
            background-size: 96px 96px;
            mask-image: radial-gradient(circle at center, black 34%, transparent 100%);
            opacity: 0.28;
            pointer-events: none;
            z-index: -1;
          }

          .share-card__header,
          .share-card__footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
          }

          .share-card__header {
            padding-bottom: 16px;
            border-bottom: 1px solid var(--line-soft);
          }

          .share-card__brand {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            font-size: 0.78rem;
            font-weight: 650;
            letter-spacing: 0.24em;
            text-transform: uppercase;
            color: var(--text-primary);
          }

          .share-card__brand-mark {
            width: 11px;
            height: 11px;
            border-radius: 999px;
            background:
              radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.85), transparent 30%),
              var(--accent);
            box-shadow:
              0 0 0 1px rgba(0, 255, 170, 0.16),
              0 0 24px var(--accent-glow);
            flex: 0 0 auto;
          }

          .share-card__timestamp {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 0.76rem;
            font-variant-numeric: tabular-nums;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: var(--text-secondary);
            white-space: nowrap;
          }

          .share-card__timestamp-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 999px;
            border: 1px solid rgba(0, 255, 170, 0.16);
            background: rgba(0, 255, 170, 0.05);
            color: var(--accent);
            letter-spacing: 0.16em;
          }

          .share-card__hero {
            display: grid;
            grid-template-columns: minmax(0, 1.45fr) minmax(240px, 0.95fr);
            gap: 24px;
            align-items: end;
            padding: 6px 0 8px;
          }

          .share-card__runway-block {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 0;
          }

          .share-card__eyebrow,
          .share-card__section-kicker,
          .share-card__metric-label {
            font-size: 0.72rem;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            color: var(--text-secondary);
          }

          .share-card__runway {
            display: flex;
            align-items: flex-end;
            gap: 14px;
            min-width: 0;
            line-height: 0.88;
          }

          .share-card__runway-value,
          .share-card__metric-value {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-variant-numeric: tabular-nums;
          }

          .share-card__runway-value {
            min-width: 0;
            font-size: clamp(4.6rem, 10.2vw, 8.4rem);
            font-weight: 700;
            letter-spacing: -0.08em;
            color: var(--text-primary);
            text-shadow: 0 0 42px rgba(255, 255, 255, 0.03);
            white-space: nowrap;
          }

          .share-card__runway-unit {
            transform: translateY(-0.46rem);
            font-size: clamp(0.95rem, 1.8vw, 1.2rem);
            letter-spacing: 0.26em;
            text-transform: uppercase;
            color: var(--accent);
            white-space: nowrap;
          }

          .share-card__delta-pill {
            transform: translateY(-0.5rem);
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border-radius: 999px;
            border: 1px solid currentColor;
            padding: 8px 10px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: clamp(0.92rem, 1.8vw, 1.18rem);
            font-weight: 800;
            line-height: 1;
            white-space: nowrap;
          }

          .share-card__delta-pill--up {
            color: #00ffaa;
            background: rgba(0, 255, 170, 0.08);
            box-shadow: 0 0 24px rgba(0, 255, 170, 0.08);
          }

          .share-card__delta-pill--down {
            color: #ff8b5f;
            background: rgba(255, 139, 95, 0.08);
            box-shadow: 0 0 24px rgba(255, 139, 95, 0.08);
          }

          .share-card__baseline-note {
            margin: -4px 0 0;
            color: rgba(226, 232, 240, 0.48);
            font-size: 0.86rem;
            line-height: 1.2;
          }

          .share-card__hero-note {
            max-width: 28rem;
            margin: 0;
            font-size: 0.94rem;
            line-height: 1.5;
            color: var(--text-secondary);
          }

          .share-card__metric {
            position: relative;
            min-height: 100%;
            padding: 22px;
            border: 1px solid var(--line);
            border-radius: 20px;
            background:
              linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent),
              var(--surface-2);
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            gap: 14px;
            overflow: hidden;
          }

          .share-card__metric::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            background: linear-gradient(180deg, rgba(0, 255, 170, 0.08), transparent 50%);
            opacity: 0.5;
            pointer-events: none;
          }

          .share-card__metric-row {
            position: relative;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            width: 100%;
            min-width: 0;
          }

          .share-card__metric-value {
            flex-shrink: 0;
            font-size: clamp(2.5rem, 5vw, 3.75rem);
            font-weight: 700;
            line-height: 0.95;
            letter-spacing: -0.05em;
            color: var(--accent);
            text-shadow: 0 0 24px rgba(0, 255, 170, 0.1);
          }

          .share-card__metric-value--delta {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            gap: 8px;
            font-size: clamp(1.8rem, 3.8vw, 2.9rem);
            letter-spacing: -0.04em;
          }

          .share-card__metric-baseline,
          .share-card__metric-arrow {
            color: rgba(226, 232, 240, 0.5);
          }

          .share-card__metric-arrow {
            font-size: 0.78em;
          }

          .share-card__metric-label {
            flex: 1 1 0;
            min-width: 0;
            text-align: right;
            white-space: normal;
            overflow-wrap: anywhere;
            word-break: normal;
            text-wrap: balance;
            line-height: 1.15;
          }

          .share-card__verdict {
            display: grid;
            gap: 14px;
            max-width: 58rem;
            padding: 24px 24px 20px;
            border: 1px solid var(--line);
            border-radius: 18px;
            background:
              linear-gradient(180deg, rgba(255, 255, 255, 0.015), transparent 65%),
              var(--surface-2);
          }

          .share-card__verdict-text {
            margin: 0;
            font-size: clamp(1.15rem, 2.1vw, 1.7rem);
            line-height: 1.25;
            font-weight: 540;
            color: var(--text-primary);
            max-width: 24ch;
          }

          .share-card__reality-check {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: -10px;
          }

          .share-card__reality-button {
            display: inline-flex;
            min-height: 46px;
            align-items: center;
            justify-content: center;
            border: 1px solid rgba(0, 255, 170, 0.28);
            border-radius: 999px;
            background:
              linear-gradient(180deg, rgba(0, 255, 170, 0.14), rgba(0, 255, 170, 0.05)),
              rgba(255, 255, 255, 0.02);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.06),
              0 18px 50px rgba(0, 255, 170, 0.08);
            color: var(--accent);
            cursor: pointer;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.16em;
            padding: 0 18px;
            text-transform: uppercase;
            text-decoration: none;
            transition:
              border-color 140ms ease,
              background-color 140ms ease,
              color 140ms ease,
              transform 140ms ease;
          }

          .share-card__reality-button:hover {
            border-color: rgba(0, 255, 170, 0.48);
            background:
              linear-gradient(180deg, rgba(0, 255, 170, 0.2), rgba(0, 255, 170, 0.08)),
              rgba(255, 255, 255, 0.03);
            color: #d8fff2;
            transform: translateY(-1px);
          }

          .share-card__reality-button:disabled {
            cursor: not-allowed;
            opacity: 0.52;
            transform: none;
          }

          .share-card__reality-button--telegram {
            border-color: rgba(112, 246, 255, 0.28);
            background:
              linear-gradient(180deg, rgba(112, 246, 255, 0.14), rgba(112, 246, 255, 0.05)),
              rgba(255, 255, 255, 0.02);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.06),
              0 18px 50px rgba(112, 246, 255, 0.08);
            color: #70f6ff;
          }

          .share-card__reality-button--telegram:hover {
            border-color: rgba(112, 246, 255, 0.48);
            background:
              linear-gradient(180deg, rgba(112, 246, 255, 0.2), rgba(112, 246, 255, 0.08)),
              rgba(255, 255, 255, 0.03);
            color: #e2fcff;
          }

          .share-card__footer {
            margin-top: auto;
            padding-top: 18px;
            border-top: 1px solid var(--line-soft);
            color: var(--text-muted);
            font-size: 0.78rem;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .share-card__footer strong {
            color: var(--text-secondary);
            font-weight: 600;
          }

          @media (max-width: 920px) {
            .share-card {
              gap: 24px;
              padding: 24px;
            }

            .share-card__hero {
              grid-template-columns: 1fr;
            }

            .share-card__metric {
              min-height: 180px;
            }

            .share-card__verdict-text {
              max-width: none;
            }
          }

          @media (max-width: 640px) {
            .share-card {
              gap: 20px;
              padding: 18px;
              border-radius: 22px;
            }

            .share-card__header,
            .share-card__footer {
              align-items: flex-start;
              flex-direction: column;
            }

            .share-card__header {
              padding-bottom: 12px;
            }

            .share-card__runway {
              gap: 10px;
              align-items: baseline;
            }

            .share-card__runway-value {
              font-size: clamp(3.5rem, 16vw, 5.4rem);
            }

            .share-card__runway-unit {
              transform: none;
              font-size: 0.84rem;
              letter-spacing: 0.18em;
            }

            .share-card__metric {
              padding: 18px;
              min-height: 150px;
            }

            .share-card__metric-value {
              font-size: clamp(2rem, 11vw, 3rem);
            }

            .share-card__metric-label {
              font-size: 0.68rem;
              letter-spacing: 0.18em;
            }

            .share-card__verdict {
              padding: 18px;
            }

            .share-card__verdict-text {
              font-size: 1.08rem;
              line-height: 1.3;
            }

            .share-card__reality-button {
              width: 100%;
              min-height: 44px;
              padding: 0 14px;
              font-size: 0.72rem;
              letter-spacing: 0.12em;
            }

          }
        `}</style>
      </div>
    </div>
  );
}

