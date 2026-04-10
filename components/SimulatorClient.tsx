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
  income_delay_months: number;
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

  const readyParams = parseData?.status === "ready" ? parseData.params : null;
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
          `PARSER READY | CAPITAL ${normalizedParseData.params.initial_capital} | BURN ${normalizedParseData.params.monthly_burn} | INCOME ${normalizedParseData.params.monthly_income} | DELAY ${normalizedParseData.params.income_delay_months}M`,
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
    <div className="relative isolate min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_78%_18%,rgba(255,255,255,0.06),transparent_22%),radial-gradient(circle_at_70%_78%,rgba(16,185,129,0.1),transparent_24%)]" />

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className={`${panelClass} relative overflow-hidden px-5 py-5 sm:px-6 sm:py-6`}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))]" />

          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-300/90">
                ForkVerse Monte Carlo
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
                <div className="mt-2 font-mono text-sm text-white tabular-nums">{status.toUpperCase()}</div>
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

                    <div className="h-[320px] rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-2 sm:h-[360px] lg:h-[420px]">
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
      </div>
    </div>
  );
}
