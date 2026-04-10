"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

import SpaghettiChart, { type MonteCarloVisualization } from "./SpaghettiChart";


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
  if (
    !Array.isArray(value) ||
    !value.every((row) => Array.isArray(row) && row.every(isFiniteNumber))
  ) {
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

function computeCashoutDateMedian(startDate: string, medianPath: number[]): string | null {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const firstNonPositiveIndex = medianPath.findIndex((value) => value <= 0);
  if (firstNonPositiveIndex === -1) {
    return null;
  }

  const cashoutDate = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + firstNonPositiveIndex,
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );

  return cashoutDate.toISOString();
}

function adaptSimulationToVisualization(
  simulation: SimulationResponseData,
  startDate: string,
): MonteCarloVisualization {
  const horizonMonths = Math.min(
    simulation.months.length,
    simulation.p10.length,
    simulation.p50.length,
    simulation.p90.length,
  );

  if (horizonMonths < 1) {
    throw new Error("Simulation response did not contain chartable data");
  }

  const p10 = simulation.p10.slice(0, horizonMonths);
  const p50 = simulation.p50.slice(0, horizonMonths);
  const p90 = simulation.p90.slice(0, horizonMonths);
  const spaghettiSample = simulation.spaghetti_sample
    .slice(0, 50)
    .map((path) => path.slice(0, horizonMonths));

  const successPct = clampPct(simulation.survival_probability * 100);
  const bankruptcyPct = clampPct(100 - successPct);

  return {
    percentiles: {
      p10,
      p50,
      p90,
    },
    spaghettiSample,
    forkSummary: [
      {
        color: "green",
        pct: successPct,
        label: "Успех",
      },
      {
        color: "red",
        pct: bankruptcyPct,
        label: "Банкротство",
      },
    ],
    horizonMonths,
    startDate,
    cashoutDateMedian: computeCashoutDateMedian(startDate, p50),
  };
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
  const [simulationStartDate, setSimulationStartDate] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const visualization = useMemo(() => {
    if (!simulationData || !simulationStartDate) {
      return null;
    }

    return adaptSimulationToVisualization(simulationData, simulationStartDate);
  }, [simulationData, simulationStartDate]);

  const isBusy = status === "parsing" || status === "simulating";
  const composerLabel = status === "clarifying" ? "УТОЧНЕНИЕ" : "ПЛАН";
  const submitLabel =
    status === "clarifying"
      ? "SUBMIT ANSWER"
      : status === "parsing"
        ? "PARSING"
        : status === "simulating"
          ? "SIMULATING"
          : "RUN";

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
      setSimulationStartDate(null);
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

      const nextStartDate = new Date().toISOString();
      const normalizedSimulationData = normalizeSimulationResponseData(parseEnvelope.data);
      setSimulationStartDate(nextStartDate);
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
    <div className="min-h-screen bg-[#030b07] font-mono text-emerald-50">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-6 py-8">
        <header className="border border-emerald-400/40 px-4 py-4">
          <div className="text-xs uppercase tracking-[0.28em] text-emerald-400">Fork Zero Terminal</div>
          <h1 className="mt-3 text-xl text-emerald-50">Monte Carlo Simulator</h1>
          <div className="mt-4 grid gap-2 text-xs text-emerald-300 md:grid-cols-4">
            <div className="border border-emerald-400/20 px-3 py-2">STATE | {status.toUpperCase()}</div>
            <div className="border border-emerald-400/20 px-3 py-2">MESSAGES | {chatHistory.length}</div>
            <div className="border border-emerald-400/20 px-3 py-2">
              PARSER | {parseData ? parseData.status.toUpperCase() : "--"}
            </div>
            <div className="border border-emerald-400/20 px-3 py-2">
              {visualization ? `HORIZON | ${visualization.horizonMonths}` : "HORIZON | --"}
            </div>
          </div>
        </header>

        <div className="grid gap-8 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="border border-emerald-400/40">
            <div className="border-b border-emerald-400/20 px-4 py-3 text-xs uppercase tracking-[0.28em] text-emerald-400">
              Input Console
            </div>
            <form className="space-y-4 px-4 py-4" onSubmit={handleSubmit}>
              <div className="text-xs uppercase tracking-[0.22em] text-emerald-300">{composerLabel}</div>
              {clarificationContext ? (
                <div className="border border-rose-400/30 px-3 py-3 text-sm text-rose-200">
                  <div className="text-xs uppercase tracking-[0.22em] text-rose-300">Clarification</div>
                  <div className="mt-2 whitespace-pre-wrap">{clarificationContext.question}</div>
                </div>
              ) : null}
              <textarea
                className="h-44 w-full border border-emerald-400 bg-[#030b07] px-3 py-3 text-sm text-emerald-50 outline-none placeholder:text-emerald-700"
                disabled={isBusy}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  status === "clarifying"
                    ? "Введите ответ на уточняющий вопрос..."
                    : "Опишите стартовый капитал, burn rate и income..."
                }
                spellCheck={false}
                value={draft}
              />
              <button
                className="border border-emerald-400 px-4 py-2 text-sm text-emerald-400 disabled:border-emerald-900 disabled:text-emerald-900"
                disabled={isBusy}
                type="submit"
              >
                {submitLabel}
              </button>
            </form>
            {errorMessage ? (
              <div className="border-t border-rose-400/20 px-4 py-3 text-sm text-rose-300">
                ERROR | {errorMessage}
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-8">
            <div className="border border-emerald-400/40">
              <div className="border-b border-emerald-400/20 px-4 py-3 text-xs uppercase tracking-[0.28em] text-emerald-400">
                Chat History
              </div>
              <div className="max-h-[420px] space-y-3 overflow-y-auto px-4 py-4">
                {chatHistory.length === 0 ? (
                  <div className="text-sm text-emerald-700">NO MESSAGES</div>
                ) : (
                  chatHistory.map((message) => (
                    <div
                      key={message.id}
                      className={
                        message.role === "user"
                          ? "border border-emerald-400/20 px-3 py-3 text-sm text-emerald-100"
                          : "border border-rose-400/20 px-3 py-3 text-sm text-rose-200"
                      }
                    >
                      <div
                        className={
                          message.role === "user"
                            ? "mb-2 text-xs uppercase tracking-[0.22em] text-emerald-400"
                            : "mb-2 text-xs uppercase tracking-[0.22em] text-rose-300"
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

            <div className="border border-emerald-400/40">
              <div className="border-b border-emerald-400/20 px-4 py-3 text-xs uppercase tracking-[0.28em] text-emerald-400">
                Simulation Output
              </div>
              <div className="px-4 py-4">
                {visualization ? (
                  <SpaghettiChart {...visualization} />
                ) : (
                  <div className="border border-emerald-400/20 px-4 py-8 text-sm text-emerald-700">
                    WAITING FOR SIMULATION DATA
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
