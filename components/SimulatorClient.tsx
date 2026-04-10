"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
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
  months: number;
  n_simulations: number;
};

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

type SimulationResponseData = {
  months: number[];
  n_simulations: number;
  survival_probability: number;
  p10: number[];
  p50: number[];
  p90: number[];
  spaghetti_sample: number[][];
};

type ClarificationContext = {
  plan: string;
  question: string;
};

type MonteCarloChartPoint = {
  month: number;
  p10: number;
  p50: number;
  p90: number;
  band: [number, number];
  bankruptcyRisk: number;
};

type CustomTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: MonteCarloChartPoint }>;
};

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

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

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="min-w-[220px] rounded-2xl border border-white/10 bg-slate-950/95 px-4 py-3 font-mono shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl ring-1 ring-white/5 sm:min-w-[260px]">
      <div className="text-sm font-semibold text-slate-100">Месяц {point.month}</div>
      <div className="mt-3 space-y-1.5 text-[12px] tabular-nums">
        <div className="text-sky-300">▲ P90: {formatCurrencySigned(point.p90)} (топ 10%)</div>
        <div className="text-emerald-300">◆ P50: {formatCurrencySigned(point.p50)} (медиана)</div>
        <div className="text-amber-300">▼ P10: {formatCurrencySigned(point.p10)} (худшие 10%)</div>
      </div>
      <div className="mt-3 border-t border-white/10 pt-3 text-[12px] text-slate-300 tabular-nums">
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
  const n_simulations = value.n_simulations;
  const survival_probability = value.survival_probability;
  const p10 = value.p10;
  const p50 = value.p50;
  const p90 = value.p90;
  const spaghetti_sample = value.spaghetti_sample;

  return {
    months: normalizeNumberArray(months, "months"),
    n_simulations: normalizeIntField(n_simulations, "n_simulations", 1, 4000),
    survival_probability: (() => {
      if (!isFiniteNumber(survival_probability)) {
        throw new Error("Invalid survival_probability returned by API");
      }

      return survival_probability;
    })(),
    p10: normalizeNumberArray(p10, "p10"),
    p50: normalizeNumberArray(p50, "p50"),
    p90: normalizeNumberArray(p90, "p90"),
    spaghetti_sample: normalizeMatrix(spaghetti_sample, "spaghetti_sample"),
  };
}

export default function SimulatorClient() {
  const [status, setStatus] = useState<FlowStatus>("idle");
  const [draft, setDraft] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [clarificationContext, setClarificationContext] = useState<ClarificationContext | null>(null);
  const [parseData, setParseData] = useState<ParseResponseData | null>(null);
  const [simulationData, setSimulationData] = useState<SimulationResponseData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const chartData = useMemo<MonteCarloChartPoint[]>(() => {
    function processTrajectories(trajectories: number[][]): MonteCarloChartPoint[] {
      const sanitizedTrajectories = trajectories.filter((path) => path.length > 1 && path.every(isFiniteNumber));
      if (sanitizedTrajectories.length === 0) {
        return [];
      }

      const horizon = Math.min(...sanitizedTrajectories.map((path) => path.length - 1));
      if (horizon <= 0) {
        return [];
      }

      const percentile = (sortedValues: number[], percent: number): number => {
        if (sortedValues.length === 0) {
          return 0;
        }

        const rank = ((sortedValues.length - 1) * percent) / 100;
        const lower = Math.floor(rank);
        const upper = Math.ceil(rank);

        if (lower === upper) {
          return sortedValues[lower];
        }

        const weight = rank - lower;
        return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
      };

      return Array.from({ length: horizon }, (_, monthIndex) => {
        const trajectoryMonthIndex = monthIndex + 1;
        const monthValues = sanitizedTrajectories
          .map((path) => path[trajectoryMonthIndex])
          .filter((value): value is number => Number.isFinite(value))
          .sort((left, right) => left - right);

        const p10 = percentile(monthValues, 10);
        const p50 = percentile(monthValues, 50);
        const p90 = percentile(monthValues, 90);
        const bankruptCount = sanitizedTrajectories.reduce((count, path) => {
          const bankruptByThisMonth = path.slice(1, trajectoryMonthIndex + 1).some((capital) => capital <= 0);
          return count + (bankruptByThisMonth ? 1 : 0);
        }, 0);

        return {
          month: monthIndex + 1,
          p10,
          p50,
          p90,
          band: [p10, p90] as [number, number],
          bankruptcyRisk: (bankruptCount / sanitizedTrajectories.length) * 100,
        };
      });
    }

    return processTrajectories(simulationData?.spaghetti_sample ?? []);
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

  const isBusy = status === "parsing" || status === "simulating";
  const composerLabel = status === "clarifying" ? "Уточнение" : "План";
  const submitLabel =
    status === "clarifying"
      ? "Submit answer"
      : status === "parsing"
        ? "Parsing"
        : status === "simulating"
          ? "Simulating"
          : "Run";

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

    setDraft("");
    setErrorMessage(null);
    setParseData(null);
    if (!isClarificationReply) {
      setSimulationData(null);
    }
    setChatHistory((current) => [...current, createMessage("user", parseInput)]);
    setStatus("parsing");

    try {
      const parseEnvelope = await postEnvelope<unknown>("/api/parse", { text: parseInput });
      if (parseEnvelope.error) {
        throw new Error(parseEnvelope.error.message);
      }

      const normalizedParseData = normalizeParseResponseData(parseEnvelope.data);
      setParseData(normalizedParseData);

      if (normalizedParseData.status === "needs_clarification") {
        setClarificationContext({
          plan: planText,
          question: normalizedParseData.question,
        });
        setChatHistory((current) => [...current, createMessage("ai", normalizedParseData.question)]);
        setStatus("clarifying");
        return;
      }

      setChatHistory((current) => [
        ...current,
        createMessage(
          "ai",
          `PARSER READY | CAPITAL ${normalizedParseData.params.initial_capital} | BURN ${normalizedParseData.params.monthly_burn} | INCOME ${normalizedParseData.params.monthly_income}`,
        ),
      ]);
      setClarificationContext(null);
      setStatus("simulating");

      const normalizedSimulationData = normalizeSimulationResponseData(parseEnvelope.data);
      setSimulationData(normalizedSimulationData);
      setChatHistory((current) => [
        ...current,
        createMessage(
          "ai",
          `SIMULATION COMPLETE | SURVIVAL ${(normalizedSimulationData.survival_probability * 100).toFixed(1)}%`,
        ),
      ]);
      setStatus("simulated");
    } catch (err) {
      console.error("[SimClient] LLM parse error:", err);
      const errorMsg = err instanceof Error ? err.message : JSON.stringify(err, null, 2) ?? String(err);
      setErrorMessage(errorMsg);
      setChatHistory((current) => [...current, createMessage("ai", `ERROR | ${errorMsg}`)]);
      setStatus(fallbackStatus);
    }
  }

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-white/10 bg-[#070B14]/90 px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.32em] text-slate-400">ForkVerse Monte Carlo</div>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-white">Premium scenario terminal</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Parse free-form runway assumptions and inspect a premium percentile chart with confidence band and
                mobile-native crosshair tooltip.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 backdrop-blur-md">
                <div className="uppercase tracking-[0.18em] text-slate-500">State</div>
                <div className="mt-1 font-mono text-slate-100">{status.toUpperCase()}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 backdrop-blur-md">
                <div className="uppercase tracking-[0.18em] text-slate-500">Messages</div>
                <div className="mt-1 font-mono text-slate-100">{chatHistory.length}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 backdrop-blur-md">
                <div className="uppercase tracking-[0.18em] text-slate-500">Parser</div>
                <div className="mt-1 font-mono text-slate-100">{parseData ? parseData.status.toUpperCase() : "--"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 backdrop-blur-md">
                <div className="uppercase tracking-[0.18em] text-slate-500">Horizon</div>
                <div className="mt-1 font-mono text-slate-100">{chartSummary ? `${chartSummary.horizon}m` : "--"}</div>
              </div>
            </div>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-[#070B14]/90 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
              <div className="border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.28em] text-slate-400">
                Input Console
              </div>
              <form className="space-y-4 px-5 py-5" onSubmit={handleSubmit}>
                <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{composerLabel}</div>
                {clarificationContext ? (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 px-4 py-4 text-sm text-amber-100">
                    <div className="text-xs uppercase tracking-[0.18em] text-amber-300">Clarification</div>
                    <div className="mt-2 whitespace-pre-wrap text-slate-200">{clarificationContext.question}</div>
                  </div>
                ) : null}
                <textarea
                  className="h-44 w-full rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] px-4 py-4 text-sm text-slate-100 outline-none placeholder:text-slate-500"
                  disabled={isBusy}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    status === "clarifying"
                      ? "Введите ответ на уточняющий вопрос..."
                      : "Опишите капитал, burn, income, горизонт и любые нюансы сценария..."
                  }
                  spellCheck={false}
                  value={draft}
                />
                <button
                  className="inline-flex rounded-2xl border border-sky-400/30 bg-sky-400/10 px-4 py-2.5 text-sm font-medium text-sky-200 transition hover:border-sky-300/50 hover:bg-sky-400/15 disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
                  disabled={isBusy}
                  type="submit"
                >
                  {submitLabel}
                </button>
              </form>
              {errorMessage ? (
                <div className="border-t border-rose-400/15 px-5 py-4 text-sm text-rose-300">ERROR | {errorMessage}</div>
              ) : null}
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#070B14]/90 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
              <div className="border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.28em] text-slate-400">
                Chat History
              </div>
              <div className="max-h-[420px] space-y-3 overflow-y-auto px-5 py-5">
                {chatHistory.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-500">
                    No messages yet.
                  </div>
                ) : (
                  chatHistory.map((message) => (
                    <div
                      key={message.id}
                      className={
                        message.role === "user"
                          ? "rounded-2xl border border-sky-400/10 bg-sky-400/5 px-4 py-4 text-sm text-slate-100"
                          : "rounded-2xl border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-200"
                      }
                    >
                      <div
                        className={
                          message.role === "user"
                            ? "mb-2 text-xs uppercase tracking-[0.2em] text-sky-300"
                            : "mb-2 text-xs uppercase tracking-[0.2em] text-slate-400"
                        }
                      >
                        {message.role}
                      </div>
                      <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-[#070B14]/90 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
              <div className="border-b border-white/8 px-5 py-4 text-xs uppercase tracking-[0.28em] text-slate-400">
                Monte Carlo Output
              </div>

              {chartSummary && chartData.length > 0 ? (
                <div className="space-y-5 px-3 py-3 sm:px-5 sm:py-5">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Survival</div>
                      <div className="mt-2 font-mono text-xl text-white tabular-nums">
                        {chartSummary.survivalPct.toFixed(1)}%
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Bankruptcy Risk</div>
                      <div className="mt-2 font-mono text-xl text-white tabular-nums">
                        {chartSummary.bankruptcyPct.toFixed(1)}%
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Median End</div>
                      <div className="mt-2 font-mono text-xl text-white tabular-nums">
                        {formatCurrency(chartSummary.medianEndingBalance)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Sample / Sims</div>
                      <div className="mt-2 font-mono text-xl text-white tabular-nums">
                        {chartSummary.sampleSize}/{simulationData?.n_simulations ?? 0}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] md:p-5">
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Confidence Envelope</div>
                        <h2 className="mt-2 text-lg font-semibold tracking-[-0.02em] text-white">
                          Premium Monte Carlo runway
                        </h2>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-md">
                          <span className="font-mono tabular-nums text-white">{chartSummary.horizon}</span> months
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-md">
                          <span className="font-mono tabular-nums text-white">
                            {formatCurrency(chartSummary.optimisticEndingBalance)}
                          </span>{" "}
                          P90
                        </div>
                        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-md">
                          <span className="font-mono tabular-nums text-white">
                            {formatCurrency(chartSummary.pessimisticEndingBalance)}
                          </span>{" "}
                          P10
                        </div>
                      </div>
                    </div>

                    <div className="h-[300px] rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.10),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.08),transparent_30%)] p-2 sm:h-[340px] md:h-[380px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 12, right: 16, bottom: 8, left: 4 }}>
                          <defs>
                            <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="rgba(56,189,248,0.28)" />
                              <stop offset="100%" stopColor="rgba(16,185,129,0.10)" />
                            </linearGradient>
                          </defs>

                          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            axisLine={false}
                            dataKey="month"
                            interval="preserveStartEnd"
                            tick={{ fill: "rgba(148, 163, 184, 0.9)", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                            tickFormatter={(value: number) => `M${value}`}
                            tickLine={false}
                          />
                          <YAxis
                            axisLine={false}
                            domain={[
                              (dataMin: number) => Math.min(dataMin, 0),
                              (dataMax: number) => Math.max(dataMax, 0),
                            ]}
                            tick={{ fill: "rgba(148, 163, 184, 0.9)", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
                            tickFormatter={(value: number) => formatAxisCurrency(value)}
                            tickLine={false}
                            width={72}
                          />
                          <ReferenceLine stroke="rgba(251,113,133,0.65)" strokeDasharray="4 4" y={0} />
                          <Tooltip
                            cursor={{ stroke: "gray", strokeWidth: 1, strokeDasharray: "3 3" }}
                            content={<CustomTooltip />}
                          />
                          <Area dataKey="band" fill="url(#gradient)" stroke="none" opacity={0.2} type="monotone" />
                          <Line
                            dataKey="p90"
                            dot={false}
                            isAnimationActive={false}
                            stroke="rgba(125,211,252,0.75)"
                            strokeDasharray="6 4"
                            strokeWidth={1.5}
                            type="monotone"
                          />
                          <Line
                            dataKey="p50"
                            dot={false}
                            isAnimationActive={false}
                            stroke="#7DD3FC"
                            strokeWidth={2.5}
                            type="monotone"
                          />
                          <Line
                            dataKey="p10"
                            dot={false}
                            isAnimationActive={false}
                            stroke="rgba(251,191,36,0.85)"
                            strokeDasharray="6 4"
                            strokeWidth={1.5}
                            type="monotone"
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="px-5 py-10">
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-5 py-10 text-center text-sm text-slate-500">
                    Run a scenario to render the Monte Carlo confidence band and mobile crosshair tooltip.
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
