"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SimulationApiMeta = {
  schema_version: "2026-04";
  simulation_time_ms: number;
  request_id: string;
  generated_at: string;
};

export type SimulationApiError = {
  code: string | null;
  message: string;
  details: Record<string, unknown> | null;
  retryable: boolean;
};

export type SimulationApiEnvelope<TResult> = {
  data: TResult | null;
  error: SimulationApiError | null;
  meta: SimulationApiMeta;
};

export type DebouncedSimulationError = {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
  retryable: boolean;
  status: number | null;
  meta: SimulationApiMeta | null;
};

export type SimulationRequestParams = Record<string, unknown>;

export type UseDebouncedSimulationOptions<TParams extends SimulationRequestParams, TResult> = {
  params: TParams | null;
  delayMs?: number;
  enabled?: boolean;
  endpoint?: string;
  initialResult?: TResult | null;
  initialMeta?: SimulationApiMeta | null;
  paramsKey?: string;
  normalizeResult?: (data: unknown) => TResult;
  onSuccess?: (result: TResult, meta: SimulationApiMeta, params: TParams) => void;
  onError?: (error: DebouncedSimulationError, params: TParams) => void;
};

export type SimulationRunResult<TResult> = {
  result: TResult;
  meta: SimulationApiMeta;
};

export type UseDebouncedSimulationReturn<TParams extends SimulationRequestParams, TResult> = {
  result: TResult | null;
  meta: SimulationApiMeta | null;
  error: DebouncedSimulationError | null;
  isDebouncing: boolean;
  isLoading: boolean;
  isPending: boolean;
  lastScheduledParams: TParams | null;
  lastSubmittedParams: TParams | null;
  runNow: (overrideParams?: TParams) => Promise<SimulationRunResult<TResult> | null>;
  schedule: (nextParams: TParams) => void;
  cancel: () => void;
  reset: () => void;
};

type DebouncedSimulationState<TParams extends SimulationRequestParams, TResult> = {
  result: TResult | null;
  meta: SimulationApiMeta | null;
  error: DebouncedSimulationError | null;
  isDebouncing: boolean;
  isLoading: boolean;
  lastScheduledParams: TParams | null;
  lastSubmittedParams: TParams | null;
};

const DEFAULT_ENDPOINT = "/api/simulate";
const DEFAULT_DELAY_MS = 300;
const overloadedScenarioMessage = "The system is overloaded analyzing your scenario. Try describing the plan a bit shorter.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isApiMeta(value: unknown): value is SimulationApiMeta {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.schema_version === "2026-04" &&
    typeof value.simulation_time_ms === "number" &&
    Number.isFinite(value.simulation_time_ms) &&
    typeof value.request_id === "string" &&
    typeof value.generated_at === "string"
  );
}

function normalizeDetails(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function normalizeApiError(value: unknown): SimulationApiError | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = typeof value.code === "string" || value.code === null ? value.code : "INTERNAL_ERROR";
  const message = typeof value.message === "string" && value.message.trim().length > 0 ? value.message : "Simulation failed";
  const retryable = typeof value.retryable === "boolean" ? value.retryable : false;

  return {
    code,
    message,
    details: normalizeDetails(value.details),
    retryable,
  };
}

function isOverloadedStatus(status: number | null | undefined): status is 502 | 504 {
  return status === 502 || status === 504;
}

function getHttpFailureMessage(status: number): string {
  return isOverloadedStatus(status) ? overloadedScenarioMessage : `Simulation request failed with HTTP ${status}`;
}

function toDebouncedError(
  error: SimulationApiError,
  meta: SimulationApiMeta | null,
  status: number | null = null,
): DebouncedSimulationError {
  return {
    code: error.code ?? "INTERNAL_ERROR",
    message: error.message,
    details: error.details,
    retryable: error.retryable,
    status,
    meta,
  };
}

function normalizeThrownError(error: unknown): DebouncedSimulationError {
  if (isDebouncedSimulationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
      details: null,
      retryable: true,
      status: null,
      meta: null,
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "Simulation request failed",
    details: null,
    retryable: true,
    status: null,
    meta: null,
  };
}

function isDebouncedSimulationError(value: unknown): value is DebouncedSimulationError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    (isRecord(value.details) || value.details === null) &&
    typeof value.retryable === "boolean" &&
    (typeof value.status === "number" || value.status === null) &&
    (isApiMeta(value.meta) || value.meta === null)
  );
}

function normalizeEnvelope<TResult>(value: unknown, status: number | null): SimulationApiEnvelope<TResult> {
  if (!isRecord(value)) {
    throw toDebouncedError(
      {
        code: "INTERNAL_ERROR",
        message: "Invalid API envelope",
        details: null,
        retryable: true,
      },
      null,
      status,
    );
  }

  const meta = isApiMeta(value.meta) ? value.meta : null;
  const apiError = normalizeApiError(value.error);

  if (apiError) {
    throw toDebouncedError(apiError, meta, status);
  }

  if (!meta || !("data" in value)) {
    throw toDebouncedError(
      {
        code: "INTERNAL_ERROR",
        message: "Invalid API envelope",
        details: null,
        retryable: true,
      },
      meta,
      status,
    );
  }

  if (value.data === null) {
    throw toDebouncedError(
      {
        code: "INTERNAL_ERROR",
        message: "Simulation response did not include data",
        details: null,
        retryable: true,
      },
      meta,
      status,
    );
  }

  return {
    data: value.data as TResult,
    error: null,
    meta,
  };
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(value, (_key, nextValue) => {
    if (!isRecord(nextValue) && !Array.isArray(nextValue)) {
      return nextValue;
    }

    if (typeof nextValue === "object" && nextValue !== null) {
      if (seen.has(nextValue)) {
        return "[Circular]";
      }

      seen.add(nextValue);
    }

    if (Array.isArray(nextValue)) {
      return nextValue;
    }

    return Object.keys(nextValue)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = nextValue[key];
        return sorted;
      }, {});
  });
}

async function postSimulation<TResult, TParams extends SimulationRequestParams>(
  endpoint: string,
  params: TParams,
  signal: AbortSignal,
  normalizeResult?: (data: unknown) => TResult,
): Promise<SimulationRunResult<TResult>> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({ params }),
    signal,
  });

  const status = response.status;
  const json = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw toDebouncedError(
      {
        code: "INTERNAL_ERROR",
        message: getHttpFailureMessage(status),
        details: null,
        retryable: status >= 500,
      },
      isRecord(json) && isApiMeta(json.meta) ? json.meta : null,
      status,
    );
  }

  const envelope = normalizeEnvelope<unknown>(json, status);
  const result = normalizeResult ? normalizeResult(envelope.data) : (envelope.data as TResult);

  return {
    result,
    meta: envelope.meta,
  };
}

function createInitialState<TParams extends SimulationRequestParams, TResult>(
  initialResult: TResult | null,
  initialMeta: SimulationApiMeta | null,
): DebouncedSimulationState<TParams, TResult> {
  return {
    result: initialResult,
    meta: initialMeta,
    error: null,
    isDebouncing: false,
    isLoading: false,
    lastScheduledParams: null,
    lastSubmittedParams: null,
  };
}

export function useDebouncedSimulation<TParams extends SimulationRequestParams, TResult = unknown>({
  params,
  delayMs = DEFAULT_DELAY_MS,
  enabled = true,
  endpoint = DEFAULT_ENDPOINT,
  initialResult = null,
  initialMeta = null,
  paramsKey,
  normalizeResult,
  onSuccess,
  onError,
}: UseDebouncedSimulationOptions<TParams, TResult>): UseDebouncedSimulationReturn<TParams, TResult> {
  const timerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const mountedRef = useRef(false);
  const latestParamsRef = useRef<TParams | null>(params);
  const [state, setState] = useState<DebouncedSimulationState<TParams, TResult>>(() =>
    createInitialState(initialResult, initialMeta),
  );

  const resolvedParamsKey = useMemo(() => paramsKey ?? stableStringify(params), [params, paramsKey]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const abortActiveRequest = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const markCurrentWorkStale = useCallback(() => {
    requestVersionRef.current += 1;
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    abortActiveRequest();
    markCurrentWorkStale();
    setState((current) => ({
      ...current,
      isDebouncing: false,
      isLoading: false,
    }));
  }, [abortActiveRequest, clearTimer, markCurrentWorkStale]);

  const submit = useCallback(
    async (nextParams: TParams): Promise<SimulationRunResult<TResult> | null> => {
      clearTimer();
      abortActiveRequest();

      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setState((current) => ({
        ...current,
        error: null,
        isDebouncing: false,
        isLoading: true,
        lastSubmittedParams: nextParams,
      }));

      try {
        const nextResult = await postSimulation<TResult, TParams>(endpoint, nextParams, controller.signal, normalizeResult);
        const isCurrentRequest = requestVersionRef.current === requestVersion && !controller.signal.aborted;

        if (!mountedRef.current || !isCurrentRequest) {
          return null;
        }

        abortControllerRef.current = null;
        setState((current) => ({
          ...current,
          result: nextResult.result,
          meta: nextResult.meta,
          error: null,
          isDebouncing: false,
          isLoading: false,
        }));
        onSuccess?.(nextResult.result, nextResult.meta, nextParams);

        return nextResult;
      } catch (error) {
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        const isCurrentRequest = requestVersionRef.current === requestVersion;

        if (!mountedRef.current || !isCurrentRequest || isAbort) {
          return null;
        }

        const normalizedError = normalizeThrownError(error);
        abortControllerRef.current = null;
        setState((current) => ({
          ...current,
          error: normalizedError,
          isDebouncing: false,
          isLoading: false,
        }));
        onError?.(normalizedError, nextParams);

        return null;
      }
    },
    [abortActiveRequest, clearTimer, endpoint, normalizeResult, onError, onSuccess],
  );

  const schedule = useCallback(
    (nextParams: TParams) => {
      latestParamsRef.current = nextParams;
      clearTimer();
      abortActiveRequest();
      markCurrentWorkStale();

      setState((current) => ({
        ...current,
        error: null,
        isDebouncing: true,
        isLoading: false,
        lastScheduledParams: nextParams,
      }));

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void submit(nextParams);
      }, delayMs);
    },
    [abortActiveRequest, clearTimer, delayMs, markCurrentWorkStale, submit],
  );

  const runNow = useCallback(
    (overrideParams?: TParams) => {
      const nextParams = overrideParams ?? latestParamsRef.current;

      if (!nextParams) {
        return Promise.resolve(null);
      }

      latestParamsRef.current = nextParams;
      return submit(nextParams);
    },
    [submit],
  );

  const reset = useCallback(() => {
    cancel();
    setState(createInitialState(initialResult, initialMeta));
  }, [cancel, initialMeta, initialResult]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearTimer();
      abortActiveRequest();
      markCurrentWorkStale();
    };
  }, [abortActiveRequest, clearTimer, markCurrentWorkStale]);

  useEffect(() => {
    latestParamsRef.current = params;

    if (!enabled || !params) {
      cancel();
      return;
    }

    schedule(params);
    // resolvedParamsKey is the stable value trigger; params identity can change without content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancel, enabled, resolvedParamsKey, schedule]);

  return {
    result: state.result,
    meta: state.meta,
    error: state.error,
    isDebouncing: state.isDebouncing,
    isLoading: state.isLoading,
    isPending: state.isDebouncing || state.isLoading,
    lastScheduledParams: state.lastScheduledParams,
    lastSubmittedParams: state.lastSubmittedParams,
    runNow,
    schedule,
    cancel,
    reset,
  };
}
