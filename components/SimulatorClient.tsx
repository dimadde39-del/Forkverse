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

import { getOgImagePath, getSharePagePath } from "@/app/lib/share-card";

import WhatIfControls from "./WhatIfControls";
import { useDebouncedSimulation } from "./useDebouncedSimulation";

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
  months: number;
  n_simulations: number;
};

const simulationParamKeys = [
  "initial_capital",
  "monthly_burn",
  "monthly_income",
  "income_delay_months",
  "months",
  "n_simulations",
] as const satisfies readonly (keyof SimulationParams)[];

type ParseReady = {
  status: "ready";
  params: SimulationParams;
  question: null;
};

type ParseNeedsClarification = {
  status: "needs_clarification";
  params: null;
  question: string;
};

type ParseResponseData = ParseReady | ParseNeedsClarification;

type SimulationLever = {
  action: string;
  impact_months: number;
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
};

type ShareCardViewModel = {
  timestampIso: string | null;
  timestampLabel: string | null;
  runwayValue: string;
  survivalValue: string;
  verdict: string;
  comment: string;
  levers: Array<{
    reactKey: string;
    indexLabel: string;
    label: string;
    impact: string;
  }>;
};

type ShareLinkModel = {
  ogImagePath: string;
  sharePagePath: string;
};

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

const panelClass =
  "rounded-[28px] border border-white/10 bg-white/5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-md";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function normalizeOptionalTextField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
    });
  }

  return levers.length > 0 ? levers : null;
}

function cloneSimulationParams(params: SimulationParams): SimulationParams {
  return { ...params };
}

function sanitizeSimulationParams(params: SimulationParams): SimulationParams {
  const months = Math.max(1, Math.round(params.months));

  return {
    initial_capital: Math.max(0, Math.round(params.initial_capital)),
    monthly_burn: Math.max(0, Math.round(params.monthly_burn)),
    monthly_income: Math.max(0, Math.round(params.monthly_income)),
    income_delay_months: Math.min(months, Math.max(0, Math.round(params.income_delay_months))),
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

function formatCurrencySigned(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${moneyFormatter.format(Math.abs(rounded))} ₸`;
}

function formatCurrency(value: number): string {
  return `${moneyFormatter.format(Math.round(value))} ₸`;
}

function formatAxisCurrency(value: number): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (absolute >= 1_000_000) {
    const compact = absolute >= 10_000_000 ? (absolute / 1_000_000).toFixed(0) : (absolute / 1_000_000).toFixed(1);
    return `${sign}${compact}M`;
  }

  if (absolute >= 1_000) {
    const compact = absolute >= 100_000 ? (absolute / 1_000).toFixed(0) : (absolute / 1_000).toFixed(1);
    return `${sign}${compact}k`;
  }

  return `${sign}${moneyFormatter.format(absolute)}`;
}

function formatDelayMonths(value: number): string {
  return value > 0 ? `+${value}m` : "Live";
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

function formatShareProbability(value: number): string {
  const clamped = clampPct(value);
  const precision = Number.isInteger(clamped) ? 0 : 1;
  return `${clamped.toFixed(precision)}%`;
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

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="min-w-[232px] rounded-3xl border border-white/12 bg-[rgba(8,8,8,0.88)] px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:min-w-[268px]">
      <div className="text-sm font-medium text-white">Месяц {point.month}</div>
      <div className="mt-3 space-y-1.5 text-[12px] text-white/78">
        <div className="font-mono tabular-nums text-emerald-200">▲ P90: {formatCurrencySigned(point.p90)} (топ 10%)</div>
        <div className="font-mono tabular-nums text-emerald-300">◆ P50: {formatCurrencySigned(point.p50)} (медиана)</div>
        <div className="font-mono tabular-nums text-white/72">▼ P10: {formatCurrencySigned(point.p10)} (худшие 10%)</div>
      </div>
      <div className="mt-3 border-t border-white/10 pt-3 font-mono text-[12px] text-white/64 tabular-nums">
        Банкротство в этом месяце: {point.bankruptcyRisk.toFixed(0)}%
      </div>
    </div>
  );
}

async function postEnvelope<TResponse>(url: string, payload: Record<string, unknown>): Promise<ApiEnvelope<TResponse>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as unknown;
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
      months: normalizeIntField(params.months, "months", 1),
      n_simulations: normalizeIntField(params.n_simulations, "n_simulations", 1, 4000),
    },
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
    levers: normalizeOptionalLevers(value.levers),
  };
}

const initialViewState: SimulatorViewState = {
  status: "idle",
  chatHistory: [],
  clarificationContext: null,
  parseData: null,
  simulationData: null,
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
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const { status, chatHistory, clarificationContext, parseData, simulationData, simulationMeta, errorMessage } =
    viewState;

  const rawSeriesKeys = useMemo(() => Array.from({ length: 50 }, (_, index) => `sim${index}` as SimKey), []);

  const chartData = useMemo<MonteCarloChartPoint[]>(() => {
    const trajectories = simulationData?.spaghetti_sample ?? [];

    function processTrajectories(input: number[][]): MonteCarloChartPoint[] {
      const sanitized = input.filter(
        (path) => Array.isArray(path) && path.length > 1 && path.every((value) => Number.isFinite(value)),
      );

      if (sanitized.length === 0) {
        return [];
      }

      const horizon = Math.min(...sanitized.map((path) => path.length - 1));
      if (horizon <= 0) {
        return [];
      }

      const percentile = (sorted: number[], percent: number): number => {
        if (sorted.length === 0) {
          return 0;
        }

        if (sorted.length === 1) {
          return sorted[0];
        }

        const rank = ((sorted.length - 1) * percent) / 100;
        const lower = Math.floor(rank);
        const upper = Math.ceil(rank);

        if (lower === upper) {
          return sorted[lower];
        }

        const weight = rank - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
      };

      return Array.from({ length: horizon }, (_, monthIndex) => {
        const month = monthIndex + 1;
        const monthValues = sanitized
          .map((path) => path[month])
          .filter((value): value is number => Number.isFinite(value))
          .sort((left, right) => left - right);

        const p10 = percentile(monthValues, 10);
        const p50 = percentile(monthValues, 50);
        const p90 = percentile(monthValues, 90);
        const bankruptCount = sanitized.reduce((count, path) => {
          const bankruptByNow = path.slice(1, month + 1).some((capital) => capital <= 0);
          return count + (bankruptByNow ? 1 : 0);
        }, 0);

        const point: MonteCarloChartPoint = {
          month,
          p10,
          p50,
          p90,
          band: [p10, p90],
          bankruptcyRisk: (bankruptCount / sanitized.length) * 100,
        };

        for (let simIndex = 0; simIndex < 50; simIndex += 1) {
          point[`sim${simIndex}` as SimKey] = sanitized[simIndex]?.[month] ?? null;
        }

        return point;
      });
    }

    return processTrajectories(trajectories);
  }, [simulationData?.spaghetti_sample]);

  const chartSummary = useMemo(() => {
    if (!simulationData || chartData.length === 0) {
      return null;
    }

    const lastPoint = chartData[chartData.length - 1];

    return {
      survivalPct: clampPct(simulationData.survival_probability * 100),
      bankruptcyPct: clampPct(lastPoint.bankruptcyRisk),
      medianEndingBalance: lastPoint.p50,
      optimisticEndingBalance: lastPoint.p90,
      pessimisticEndingBalance: lastPoint.p10,
      sampleSize: simulationData.spaghetti_sample.length,
      horizon: chartData.length,
    };
  }, [chartData, simulationData]);

  const shareCard = useMemo<ShareCardViewModel | null>(() => {
    const baseRunwayMonths = simulationData?.base_runway_months;
    const survivalProbability12m = simulationData?.survival_probability_12m;
    const verdict = simulationData?.verdict;
    const comment = simulationData?.comment;
    const levers = simulationData?.levers;

    if (
      baseRunwayMonths === null ||
      baseRunwayMonths === undefined ||
      survivalProbability12m === null ||
      survivalProbability12m === undefined ||
      typeof verdict !== "string" ||
      verdict.trim().length === 0 ||
      typeof comment !== "string" ||
      comment.trim().length === 0 ||
      !Array.isArray(levers) ||
      levers.length === 0
    ) {
      return null;
    }

    const timestampIso = normalizeOptionalTextField(simulationMeta?.generated_at);
    const normalizedVerdict = clampText(verdict, 92);
    const normalizedComment = clampText(comment, 112);
    if (!normalizedVerdict || !normalizedComment) {
      return null;
    }

    return {
      timestampIso,
      timestampLabel: timestampIso ? formatShareTimestamp(timestampIso) : null,
      runwayValue: formatRunwayMonths(baseRunwayMonths),
      survivalValue: formatShareProbability(survivalProbability12m),
      verdict: normalizedVerdict,
      comment: normalizedComment,
      levers: levers.map((lever, index) => ({
        reactKey: `${lever.action}:${lever.impact_months}`,
        indexLabel: String(index + 1).padStart(2, "0"),
        label: clampText(lever.action, 54),
        impact: formatImpactMonths(lever.impact_months),
      })),
    };
  }, [simulationData, simulationMeta?.generated_at]);

  const shareLinks = useMemo<ShareLinkModel | null>(() => {
    const baseRunwayMonths = simulationData?.base_runway_months;
    const survivalProbability12m = simulationData?.survival_probability_12m;
    const verdict = shareCard?.verdict;

    if (
      baseRunwayMonths === null ||
      baseRunwayMonths === undefined ||
      survivalProbability12m === null ||
      survivalProbability12m === undefined ||
      !verdict
    ) {
      return null;
    }

    return {
      ogImagePath: getOgImagePath({
        runway: baseRunwayMonths,
        survival: survivalProbability12m,
        verdict,
      }),
      sharePagePath: getSharePagePath({
        runway: baseRunwayMonths,
        survival: survivalProbability12m,
        verdict,
      }),
    };
  }, [shareCard?.verdict, simulationData?.base_runway_months, simulationData?.survival_probability_12m]);

  useEffect(() => {
    setCopyFeedback("idle");
  }, [shareLinks?.sharePagePath]);

  useEffect(() => {
    if (copyFeedback === "idle" || typeof window === "undefined") {
      return;
    }

    const timeoutId = window.setTimeout(() => setCopyFeedback("idle"), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [copyFeedback]);

  useEffect(() => {
    if (parseData?.status !== "ready") {
      setWhatIfParams(null);
      setWhatIfBaselineParams(null);
      setHasTouchedWhatIf(false);
      return;
    }

    const sanitizedParams = sanitizeSimulationParams(parseData.params);
    setWhatIfParams(cloneSimulationParams(sanitizedParams));
    setWhatIfBaselineParams(cloneSimulationParams(sanitizedParams));
    setHasTouchedWhatIf(false);
  }, [parseData]);

  const parsedParams = parseData?.status === "ready" ? parseData.params : null;
  const readyParams = whatIfParams ?? parsedParams;
  const isWhatIfDirty =
    Boolean(whatIfBaselineParams && readyParams) && !areSimulationParamsEqual(whatIfBaselineParams, readyParams);
  const isBusy = status === "parsing" || status === "simulating";
  const composerLabel = status === "clarifying" ? "Clarification" : "Scenario";
  const submitLabel =
    status === "clarifying"
      ? "Submit answer"
      : status === "parsing"
        ? "Parsing"
        : status === "simulating"
          ? "Simulating"
          : "Run simulation";

  const handleWhatIfSuccess = useCallback((result: SimulationResponseData, meta: ApiMeta) => {
    setViewState((current) => {
      const previousSimulation = current.simulationData;

      return {
        ...current,
        simulationData: {
          ...result,
          verdict: result.verdict ?? previousSimulation?.verdict ?? null,
          comment: result.comment ?? previousSimulation?.comment ?? null,
          levers: result.levers ?? previousSimulation?.levers ?? null,
        },
        simulationMeta: meta,
        errorMessage: null,
      };
    });
  }, []);

  const handleWhatIfError = useCallback((error: { message: string }) => {
    setViewState((current) => ({
      ...current,
      errorMessage: `WHAT-IF | ${error.message}`,
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
  }, []);

  async function handleCopyShareLink() {
    if (!shareLinks || typeof window === "undefined" || !navigator.clipboard) {
      setCopyFeedback("error");
      return;
    }

    try {
      const absoluteShareUrl = new URL(shareLinks.sharePagePath, window.location.origin).toString();
      await navigator.clipboard.writeText(absoluteShareUrl);
      setCopyFeedback("copied");
    } catch (error) {
      console.error("[SimClient] Unable to copy share URL:", error);
      setCopyFeedback("error");
    }
  }

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
      ? `План: ${clarificationContext.plan}. Вопрос: ${clarificationContext.question}. Ответ: ${trimmedDraft}`
      : trimmedDraft;
    const fallbackStatus: FlowStatus = isClarificationReply ? "clarifying" : simulationData ? "simulated" : "idle";
    const userMessage = createMessage("user", parseInput);

    setDraft("");
    if (!isClarificationReply) {
      setWhatIfParams(null);
      setWhatIfBaselineParams(null);
      setHasTouchedWhatIf(false);
    }

    setViewState((current) => ({
      ...current,
      status: "parsing",
      errorMessage: null,
      parseData: null,
      simulationData: isClarificationReply ? current.simulationData : null,
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
      const parserReadyMessage = createMessage(
        "ai",
        `PARSER READY | CAPITAL ${normalizedParseData.params.initial_capital} | BURN ${normalizedParseData.params.monthly_burn} | INCOME ${normalizedParseData.params.monthly_income} | DELAY ${normalizedParseData.params.income_delay_months}M`,
      );
      const simulationCompleteMessage = createMessage(
        "ai",
        `SIMULATION COMPLETE | SURVIVAL ${(normalizedSimulationData.survival_probability * 100).toFixed(1)}%`,
      );

      setViewState((current) => ({
        ...current,
        status: "simulated",
        clarificationContext: null,
        parseData: normalizedParseData,
        simulationData: normalizedSimulationData,
        simulationMeta: parseEnvelope.meta,
        errorMessage: null,
        chatHistory: [...current.chatHistory, parserReadyMessage, simulationCompleteMessage],
      }));
    } catch (err) {
      console.error("[SimClient] LLM parse error:", err);
      const errorMsg = err instanceof Error ? err.message : JSON.stringify(err, null, 2) ?? String(err);
      const errorChatMessage = createMessage("ai", `ERROR | ${errorMsg}`);

      setViewState((current) => ({
        ...current,
        status: fallbackStatus,
        errorMessage: errorMsg,
        chatHistory: [...current.chatHistory, errorChatMessage],
      }));
    }
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.06),transparent_22%),radial-gradient(circle_at_70%_78%,rgba(16,185,129,0.1),transparent_24%)]" />

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className={`${panelClass} relative overflow-hidden px-5 py-5 sm:px-6 sm:py-6`}>
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
                Free-form scenario input, strict JSON parsing, Monte Carlo with 50 background trajectories, and a softer
                Linear/Stripe analytics surface shaped by the real emil-design-eng skill.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">State</div>
                <div className="mt-2 font-mono text-sm text-white tabular-nums">
                  {isWhatIfDirty ? "WHAT-IF" : status.toUpperCase()}
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

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="space-y-6">
            <div className={`${panelClass} px-5 py-5 sm:px-6`}>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">{composerLabel}</div>
                  <div className="mt-2 text-lg font-medium text-white">Scenario composer</div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/60 tabular-nums">
                  {readyParams ? `${readyParams.n_simulations} sims` : "100 sims"}
                </div>
              </div>
              <form className="space-y-4" onSubmit={handleSubmit}>
                {clarificationContext ? (
                  <div className="rounded-3xl border border-white/10 bg-white/6 px-4 py-4 text-sm text-white/82">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/90">Clarification</div>
                    <div className="mt-2 whitespace-pre-wrap">{clarificationContext.question}</div>
                  </div>
                ) : null}
                <textarea
                  className="h-48 w-full rounded-3xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] px-4 py-4 text-[15px] text-white outline-none placeholder:text-white/34 disabled:opacity-60"
                  disabled={isBusy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    status === "clarifying"
                      ? "Введите ответ на уточняющий вопрос..."
                      : "Например: капитал 8 млн, burn 950к, доход 700к, доход стартует через 3 месяца, горизонт 18 месяцев."
                  }
                  spellCheck={false}
                  value={draft}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="inline-flex items-center rounded-full border border-white/10 bg-emerald-400/12 px-4 py-2.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-white/38"
                    disabled={isBusy}
                    type="submit"
                  >
                    {submitLabel}
                  </button>
                  <div className="text-[13px] text-white/48">
                    Parser enforces strict JSON, then simulation starts immediately.
                  </div>
                </div>
              </form>
              {errorMessage ? (
                <div className="mt-4 rounded-3xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white/78">
                  ERROR | {errorMessage}
                </div>
              ) : null}
            </div>

            <WhatIfControls
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

          <section className="space-y-6">
            <div className={`${panelClass} overflow-hidden`}>
              <div className="border-b border-white/10 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">Monte Carlo output</div>
                    <div className="mt-2 text-xl font-medium text-white">Confidence band with raw trajectory texture</div>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-white/56">
                      Fifty background paths stay visible, while the confidence envelope and quantiles sit above them as
                      the primary read.
                    </p>
                  </div>

                  {chartSummary ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Survival</div>
                        <div className="mt-2 font-mono text-base text-white tabular-nums">
                          {chartSummary.survivalPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Bankruptcy</div>
                        <div className="mt-2 font-mono text-base text-white tabular-nums">
                          {chartSummary.bankruptcyPct.toFixed(1)}%
                        </div>
                      </div>
                      <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Median End</div>
                        <div className="mt-2 font-mono text-base text-white tabular-nums">
                          {formatCurrency(chartSummary.medianEndingBalance)}
                        </div>
                      </div>
                      <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-white/46">Sample / Sims</div>
                        <div className="mt-2 font-mono text-base text-white tabular-nums">
                          {chartSummary.sampleSize}/{simulationData?.n_simulations ?? 0}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {chartSummary && chartData.length > 0 ? (
                <div className="px-3 py-3 sm:px-6 sm:py-6">
                  <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:p-4">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">Scenario readout</div>
                        <h2 className="mt-2 text-lg font-medium text-white">Runway distribution</h2>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/62 tabular-nums">
                          {chartSummary.horizon} months
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/62 tabular-nums">
                          P90 {formatCurrency(chartSummary.optimisticEndingBalance)}
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-[11px] text-white/62 tabular-nums">
                          P10 {formatCurrency(chartSummary.pessimisticEndingBalance)}
                        </div>
                      </div>
                    </div>

                    <div className="relative h-[320px] overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-2 sm:h-[360px] lg:h-[420px]">
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
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 12, right: 18, bottom: 8, left: 4 }}>
                          <defs>
                            <linearGradient id="chartBand" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="rgba(16,185,129,0.22)" />
                              <stop offset="55%" stopColor="rgba(16,185,129,0.12)" />
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
                            tickFormatter={(value: number) => formatAxisCurrency(value)}
                            tickLine={false}
                            width={72}
                          />
                          <ReferenceLine stroke="rgba(255,255,255,0.14)" strokeDasharray="4 4" y={0} />
                          <Tooltip
                            cursor={{ stroke: "rgba(255,255,255,0.24)", strokeWidth: 1, strokeDasharray: "3 3" }}
                            content={<CustomTooltip />}
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

                          <Area dataKey="band" fill="url(#chartBand)" stroke="none" opacity={0.26} type="monotone" />

                          <Line
                            dataKey="p90"
                            dot={false}
                            filter="url(#quantileGlow)"
                            isAnimationActive={false}
                            stroke="rgba(236,253,245,0.82)"
                            strokeDasharray="6 5"
                            strokeWidth={2}
                            type="monotone"
                          />
                          <Line
                            dataKey="p50"
                            dot={false}
                            filter="url(#quantileGlow)"
                            isAnimationActive={false}
                            stroke="#10b981"
                            strokeWidth={3}
                            type="monotone"
                          />
                          <Line
                            dataKey="p10"
                            dot={false}
                            filter="url(#quantileGlow)"
                            isAnimationActive={false}
                            stroke="rgba(167,243,208,0.74)"
                            strokeDasharray="6 5"
                            strokeWidth={2}
                            type="monotone"
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>

                    {shareCard ? (
                      <article className="share-card" aria-label="MonteRun premium share card">
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

                        <section className="share-card__hero" aria-label="Runway and survival">
                          <div className="share-card__runway-block">
                            <div className="share-card__eyebrow">Simulation Result</div>
                            <div className="share-card__runway">
                              <div className="share-card__runway-value">{shareCard.runwayValue}</div>
                              <div className="share-card__runway-unit">MONTHS</div>
                            </div>
                            <p className="share-card__hero-note">{shareCard.comment}</p>
                          </div>

                          <div className="share-card__metric">
                            <div className="share-card__metric-row">
                              <div className="share-card__metric-value">{shareCard.survivalValue}</div>
                              <div className="share-card__metric-label">Survival Probability 12m</div>
                            </div>
                          </div>
                        </section>

                        <section className="share-card__verdict" aria-label="Verdict block">
                          <div className="share-card__section-kicker">Verdict</div>
                          <p className="share-card__verdict-text">{shareCard.verdict}</p>
                        </section>

                        <section className="share-card__levers" aria-label="Fastest ways to extend survival">
                          <div className="share-card__section-kicker">Fastest ways to extend survival</div>
                          <div className="share-card__lever-grid">
                            {shareCard.levers.map((lever) => (
                              <article key={lever.reactKey} className="lever-card">
                                <div className="lever-card__meta">
                                  <span className="lever-card__index">{lever.indexLabel}</span>
                                  <span>Impact</span>
                                </div>
                                <div className="lever-card__body">
                                  <div className="lever-card__title">{lever.label}</div>
                                  <div className="lever-card__impact">{lever.impact}</div>
                                </div>
                              </article>
                            ))}
                          </div>
                        </section>

                        {shareLinks ? (
                          <section className="share-card__actions" aria-label="Share result">
                            <button className="share-card__action-button" onClick={handleCopyShareLink} type="button">
                              {copyFeedback === "copied"
                                ? "Share link copied"
                                : copyFeedback === "error"
                                  ? "Copy unavailable"
                                  : "Copy share link"}
                            </button>
                            <a
                              className="share-card__action-link"
                              href={shareLinks.sharePagePath}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open share page
                            </a>
                            <a
                              className="share-card__action-link"
                              href={shareLinks.ogImagePath}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open OG image
                            </a>
                            <div className="share-card__actions-note">
                              Verdict, runway, and survival now resolve through a dedicated share page with live
                              server-side OG metadata.
                            </div>
                          </section>
                        ) : null}

                        <footer className="share-card__footer">
                          <span>monterun.io</span>
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
          .share-card__metric-value,
          .lever-card__meta,
          .lever-card__impact {
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

          .share-card__levers {
            display: grid;
            gap: 18px;
            align-content: start;
          }

          .share-card__lever-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 16px;
          }

          .lever-card {
            position: relative;
            display: grid;
            gap: 20px;
            align-content: space-between;
            min-height: 180px;
            padding: 20px;
            border: 1px solid var(--line);
            border-radius: 18px;
            background:
              linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 60%),
              var(--surface-3);
            overflow: hidden;
          }

          .lever-card::before {
            content: "";
            position: absolute;
            inset: 0 auto auto 0;
            width: 100%;
            height: 1px;
            background: linear-gradient(90deg, rgba(0, 255, 170, 0.45), transparent 55%);
            opacity: 0.8;
          }

          .lever-card__meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            font-size: 0.72rem;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: var(--text-muted);
          }

          .lever-card__index {
            color: var(--accent);
          }

          .lever-card__body {
            display: grid;
            gap: 12px;
            min-width: 0;
          }

          .lever-card__title {
            min-width: 0;
            font-size: 1.03rem;
            line-height: 1.35;
            color: var(--text-primary);
          }

          .lever-card__impact {
            display: inline-flex;
            width: fit-content;
            max-width: 100%;
            padding: 8px 10px;
            border-radius: 999px;
            border: 1px solid rgba(0, 255, 170, 0.14);
            background: var(--accent-soft);
            font-size: 0.83rem;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--accent);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
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

          .share-card__actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 12px;
            padding-top: 6px;
          }

          .share-card__action-button,
          .share-card__action-link {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 42px;
            padding: 0 18px;
            border-radius: 999px;
            border: 1px solid var(--line);
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.015));
            color: var(--text-primary);
            font-size: 0.8rem;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            text-decoration: none;
            transition:
              border-color 140ms ease,
              background-color 140ms ease,
              color 140ms ease;
          }

          .share-card__action-button {
            cursor: pointer;
          }

          .share-card__action-button:hover,
          .share-card__action-link:hover {
            border-color: rgba(0, 255, 170, 0.28);
            background: linear-gradient(180deg, rgba(0, 255, 170, 0.09), rgba(255, 255, 255, 0.02));
            color: var(--accent);
          }

          .share-card__actions-note {
            flex: 1 1 240px;
            min-width: 0;
            color: var(--text-secondary);
            font-size: 0.84rem;
            line-height: 1.5;
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

            .share-card__lever-grid {
              grid-template-columns: 1fr;
            }

            .lever-card {
              min-height: 148px;
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

            .share-card__actions {
              align-items: stretch;
            }

            .share-card__action-button,
            .share-card__action-link {
              width: 100%;
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

            .lever-card {
              padding: 18px;
              min-height: 138px;
            }
          }
        `}</style>
      </div>
    </div>
  );
}

