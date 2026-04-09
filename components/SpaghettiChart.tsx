import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

export type MonteCarloVisualization = {
  percentiles: {
    p10: number[];
    p50: number[];
    p90: number[];
  };
  spaghettiSample: number[][];
  forkSummary: Array<{
    color: "green" | "yellow" | "red";
    pct: number;
    label: string;
  }>;
  horizonMonths: number;
  startDate: string;
  cashoutDateMedian?: string | null;
};

type SpaghettiChartProps = MonteCarloVisualization;

type ChartPoint = {
  month: number;
  p10: number;
  p50: number;
  p90: number;
  confidenceBand: [number, number];
} & Record<string, number | [number, number] | null>;

const SPAGHETTI_LIMIT = 50;

const SUMMARY_COLOR_CLASS: Record<MonteCarloVisualization["forkSummary"][number]["color"], string> = {
  green: "bg-emerald-400",
  yellow: "bg-amber-300",
  red: "bg-rose-400",
};

const SUMMARY_TEXT_CLASS: Record<MonteCarloVisualization["forkSummary"][number]["color"], string> = {
  green: "text-emerald-200",
  yellow: "text-amber-200",
  red: "text-rose-200",
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function formatCurrency(value: number): string {
  const prefix = value < 0 ? "-KZT " : "KZT ";
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`;
}

export default function SpaghettiChart({
  percentiles,
  spaghettiSample,
  forkSummary,
  horizonMonths,
  startDate,
  cashoutDateMedian,
}: SpaghettiChartProps) {
  const cappedSpaghettiSample = useMemo(() => {
    if (spaghettiSample.length > SPAGHETTI_LIMIT) {
      console.warn(`spaghettiSample exceeds ${SPAGHETTI_LIMIT} paths; extra paths were ignored`);
    }

    return spaghettiSample.slice(0, SPAGHETTI_LIMIT);
  }, [spaghettiSample]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (!Number.isInteger(horizonMonths) || horizonMonths < 1) {
      errors.push("horizonMonths must be a positive integer");
    }

    if (percentiles.p10.length !== horizonMonths) {
      errors.push("percentiles.p10 length must equal horizonMonths");
    }

    if (percentiles.p50.length !== horizonMonths) {
      errors.push("percentiles.p50 length must equal horizonMonths");
    }

    if (percentiles.p90.length !== horizonMonths) {
      errors.push("percentiles.p90 length must equal horizonMonths");
    }

    const percentileOrderValid = Array.from({ length: Math.min(percentiles.p10.length, percentiles.p50.length, percentiles.p90.length) }).every(
      (_, index) => {
        const p10 = percentiles.p10[index];
        const p50 = percentiles.p50[index];
        const p90 = percentiles.p90[index];

        return Number.isFinite(p10) && Number.isFinite(p50) && Number.isFinite(p90) && p10 <= p50 && p50 <= p90;
      },
    );

    if (!percentileOrderValid) {
      errors.push("percentiles must satisfy p10 <= p50 <= p90 for every month");
    }

    const spaghettiLengthsValid = cappedSpaghettiSample.every((path) => path.length <= horizonMonths);
    if (!spaghettiLengthsValid) {
      errors.push("every spaghettiSample path length must be <= horizonMonths");
    }

    const forkSummaryTotal = forkSummary.reduce((sum, item) => sum + item.pct, 0);
    if (forkSummary.length > 0 && (forkSummaryTotal < 99.5 || forkSummaryTotal > 100.5)) {
      errors.push("forkSummary total must stay within 99.5% and 100.5%");
    }

    return errors;
  }, [cappedSpaghettiSample, forkSummary, horizonMonths, percentiles.p10, percentiles.p50, percentiles.p90]);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (validationErrors.length > 0) {
      return [];
    }

    return Array.from({ length: horizonMonths }, (_, index) => {
      const point: ChartPoint = {
        month: index + 1,
        p10: percentiles.p10[index],
        p50: percentiles.p50[index],
        p90: percentiles.p90[index],
        confidenceBand: [percentiles.p10[index], percentiles.p90[index]],
      };

      cappedSpaghettiSample.forEach((path, pathIndex) => {
        point[`spaghetti_${pathIndex}`] = index < path.length ? path[index] : null;
      });

      return point;
    });
  }, [cappedSpaghettiSample, horizonMonths, percentiles.p10, percentiles.p50, percentiles.p90, validationErrors.length]);

  const cashoutMonth = useMemo(() => {
    if (!cashoutDateMedian) {
      return null;
    }

    const start = new Date(startDate);
    const cashout = new Date(cashoutDateMedian);

    if (Number.isNaN(start.getTime()) || Number.isNaN(cashout.getTime())) {
      console.warn("cashoutDateMedian or startDate is not a valid ISO date");
      return null;
    }

    if (cashout < start) {
      console.warn("cashoutDateMedian earlier than startDate; clamp to month 1");
      return 1;
    }

    const monthsDiff =
      (cashout.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (cashout.getUTCMonth() - start.getUTCMonth());

    return Math.max(1, monthsDiff + 1);
  }, [cashoutDateMedian, startDate]);

  if (validationErrors.length > 0) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-[#07130c] p-5 text-sm text-rose-200 shadow-[0_0_0_1px_rgba(244,63,94,0.08)]">
        <div className="font-mono text-xs uppercase tracking-[0.24em] text-rose-300">SpaghettiChart</div>
        <div className="mt-3 space-y-1 font-mono text-xs text-rose-100">
          {validationErrors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-[#07130c] p-5 text-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.24em] text-emerald-300/80">Fork Zero</div>
          <h3 className="mt-2 font-mono text-lg font-semibold text-emerald-50">Monte Carlo Cash Runway</h3>
        </div>
        <div className="grid gap-2 text-right font-mono text-xs text-emerald-200/80">
          <span>{horizonMonths}m horizon</span>
          <span>{cappedSpaghettiSample.length} spaghetti paths</span>
          {cashoutMonth ? <span>Median cashout: M{cashoutMonth}</span> : null}
        </div>
      </div>

      <div className="mt-5 h-[360px] rounded-xl border border-emerald-500/10 bg-[#030b07] px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <XAxis
              axisLine={{ stroke: "rgba(52, 211, 153, 0.22)" }}
              dataKey="month"
              tick={{ fill: "rgba(209, 250, 229, 0.72)", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
              tickFormatter={(value: number) => `M${value}`}
              tickLine={false}
            />
            <YAxis
              allowDataOverflow={false}
              axisLine={{ stroke: "rgba(52, 211, 153, 0.22)" }}
              domain={[
                (dataMin: number) => Math.min(dataMin, 0),
                (dataMax: number) => Math.max(dataMax, 0),
              ]}
              tick={{ fill: "rgba(209, 250, 229, 0.72)", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
              tickFormatter={(value: number) => formatCurrency(value)}
              tickLine={false}
              width={88}
            />

            <ReferenceLine stroke="rgba(248, 113, 113, 0.85)" strokeDasharray="4 4" y={0} />
            {cashoutMonth ? (
              <ReferenceLine stroke="rgba(250, 204, 21, 0.9)" strokeDasharray="3 3" x={cashoutMonth} />
            ) : null}

            <Area
              activeDot={false}
              animationDuration={0}
              dataKey="confidenceBand"
              fill="rgba(16, 185, 129, 0.18)"
              isAnimationActive={false}
              stroke="rgba(16, 185, 129, 0.12)"
              strokeWidth={1}
              type="monotone"
            />

            {cappedSpaghettiSample.map((_, index) => (
              <Line
                key={`spaghetti-line-${index}`}
                animationDuration={0}
                dataKey={`spaghetti_${index}`}
                dot={false}
                isAnimationActive={false}
                stroke="rgba(148, 163, 184, 0.18)"
                strokeWidth={1}
                type="monotone"
              />
            ))}

            <Line
              animationDuration={0}
              dataKey="p50"
              dot={false}
              isAnimationActive={false}
              stroke="rgba(52, 211, 153, 0.98)"
              strokeWidth={3.5}
              type="monotone"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-5 space-y-3">
        <div className="h-2 overflow-hidden rounded-full border border-emerald-500/10 bg-[#030b07]">
          <div className="flex h-full w-full">
            {forkSummary.map((item) => (
              <div
                key={`${item.color}-${item.label}`}
                aria-hidden="true"
                className={SUMMARY_COLOR_CLASS[item.color]}
                style={{ width: `${item.pct}%`, opacity: 0.9 }}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {forkSummary.map((item) => (
            <div
              key={`${item.color}-${item.label}-label`}
              className="rounded-full border border-emerald-500/10 bg-[#030b07] px-3 py-1.5 font-mono text-xs"
            >
              <span className={`${SUMMARY_TEXT_CLASS[item.color]} mr-2 inline-block h-2 w-2 rounded-full ${SUMMARY_COLOR_CLASS[item.color]}`} />
              <span className="text-emerald-100">{item.label}</span>
              <span className="ml-2 text-emerald-300/80">{item.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
