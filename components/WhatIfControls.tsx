"use client";

import type { CSSProperties } from "react";

export type WhatIfSimulationParams = {
  initial_capital: number;
  monthly_burn: number;
  monthly_income: number;
  income_delay_months: number;
  months: number;
  n_simulations: number;
};

type EditableParamKey = "initial_capital" | "monthly_burn" | "monthly_income" | "income_delay_months";

type SliderDescriptor = {
  key: EditableParamKey;
  label: string;
  eyebrow: string;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number) => string;
};

export type WhatIfControlsProps = {
  params: WhatIfSimulationParams | null;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  onChange: (params: WhatIfSimulationParams) => void;
};

const emptyParams: WhatIfSimulationParams = {
  initial_capital: 0,
  monthly_burn: 0,
  monthly_income: 0,
  income_delay_months: 0,
  months: 12,
  n_simulations: 100,
};

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0,
});

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(Math.max(value, step) / step) * step;
}

function formatCurrency(value: number): string {
  return `${moneyFormatter.format(Math.round(value))} KZT`;
}

function formatSignedCurrency(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${moneyFormatter.format(Math.abs(rounded))} KZT`;
}

function formatDelayMonths(value: number): string {
  return value > 0 ? `+${value}m` : "Live";
}

function clampSliderValue(key: EditableParamKey, value: number, params: WhatIfSimulationParams): number {
  const rounded = Math.max(0, Math.round(value));
  return key === "income_delay_months" ? Math.min(rounded, params.months) : rounded;
}

function getSliderPercent(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }

  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function buildSliders(params: WhatIfSimulationParams): SliderDescriptor[] {
  const capitalMax = roundUpToStep(Math.max(1_000_000, params.initial_capital * 2), 50_000);
  const burnMax = roundUpToStep(Math.max(100_000, params.monthly_burn * 2, params.monthly_income), 25_000);
  const incomeMax = roundUpToStep(Math.max(100_000, params.monthly_income * 2, params.monthly_burn), 25_000);
  const delayMax = Math.max(0, Math.min(240, params.months));

  return [
    {
      key: "initial_capital",
      label: "Initial capital",
      eyebrow: "cash now",
      min: 0,
      max: capitalMax,
      step: 50_000,
      formatValue: formatCurrency,
    },
    {
      key: "monthly_income",
      label: "Monthly income",
      eyebrow: "after delay",
      min: 0,
      max: incomeMax,
      step: 25_000,
      formatValue: formatCurrency,
    },
    {
      key: "monthly_burn",
      label: "Monthly burn",
      eyebrow: "outflow",
      min: 0,
      max: burnMax,
      step: 25_000,
      formatValue: formatCurrency,
    },
    {
      key: "income_delay_months",
      label: "Income delay",
      eyebrow: "timing",
      min: 0,
      max: delayMax,
      step: 1,
      formatValue: formatDelayMonths,
    },
  ];
}

export default function WhatIfControls({
  params,
  disabled = false,
  loading = false,
  className = "",
  onChange,
}: WhatIfControlsProps) {
  const currentParams = params ?? emptyParams;
  const controlsDisabled = disabled || params === null;
  const sliders = buildSliders(currentParams);
  const netAfterIncome = currentParams.monthly_income - currentParams.monthly_burn;

  function handleSliderChange(key: EditableParamKey, value: number) {
    if (!params || controlsDisabled) {
      return;
    }

    onChange({
      ...params,
      [key]: clampSliderValue(key, value, params),
    });
  }

  return (
    <section
      aria-label="What-if simulation controls"
      className={[
        "relative overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.022))] px-5 py-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-md sm:px-6",
        controlsDisabled ? "opacity-72" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.11),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_62%)]" />

      <div className="relative">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-white/46">What-if controls</div>
            <div className="mt-2 text-lg font-medium text-white">Scenario levers</div>
          </div>

          <div
            aria-live="polite"
            className="inline-flex min-h-8 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-white/58 tabular-nums"
          >
            {loading ? (
              <span className="h-2 w-2 rounded-full border border-emerald-200/80 border-t-transparent animate-spin" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80 shadow-[0_0_18px_rgba(16,185,129,0.55)]" />
            )}
            <span>{loading ? "Repricing" : "Ready"}</span>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/18 px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Net / month</div>
            <div className="mt-2 font-mono text-sm text-white tabular-nums">{formatSignedCurrency(netAfterIncome)}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/18 px-3 py-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Horizon</div>
            <div className="mt-2 font-mono text-sm text-white tabular-nums">{currentParams.months}m</div>
          </div>
        </div>

        <div className="space-y-5">
          {sliders.map((slider) => {
            const value = currentParams[slider.key];
            const percent = getSliderPercent(value, slider.min, slider.max);
            const sliderStyle = { "--slider-pct": `${percent}%` } as CSSProperties;

            return (
              <label key={slider.key} className="block border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{slider.label}</span>
                    <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-white/38">
                      {slider.eyebrow}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-emerald-100 tabular-nums">
                    {slider.formatValue(value)}
                  </span>
                </div>

                <input
                  aria-valuetext={slider.formatValue(value)}
                  className="what-if-range w-full"
                  disabled={controlsDisabled}
                  max={slider.max}
                  min={slider.min}
                  onChange={(event) => handleSliderChange(slider.key, Number(event.currentTarget.value))}
                  step={slider.step}
                  style={sliderStyle}
                  type="range"
                  value={value}
                />
              </label>
            );
          })}
        </div>
      </div>

      <style jsx>{`
        .what-if-range {
          --track-rest: rgba(255, 255, 255, 0.12);
          --track-fill: rgba(52, 211, 153, 0.72);
          appearance: none;
          height: 26px;
          cursor: pointer;
          background: transparent;
        }

        .what-if-range:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .what-if-range::-webkit-slider-runnable-track {
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(
            90deg,
            var(--track-fill) 0%,
            var(--track-fill) var(--slider-pct),
            var(--track-rest) var(--slider-pct),
            var(--track-rest) 100%
          );
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.02);
        }

        .what-if-range::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          margin-top: -7px;
          border: 1px solid rgba(236, 253, 245, 0.86);
          border-radius: 999px;
          background:
            radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.96), transparent 24%),
            #34d399;
          box-shadow:
            0 0 0 5px rgba(16, 185, 129, 0.1),
            0 0 28px rgba(16, 185, 129, 0.4);
        }

        .what-if-range::-moz-range-track {
          height: 2px;
          border-radius: 999px;
          background: var(--track-rest);
        }

        .what-if-range::-moz-range-progress {
          height: 2px;
          border-radius: 999px;
          background: var(--track-fill);
        }

        .what-if-range::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border: 1px solid rgba(236, 253, 245, 0.86);
          border-radius: 999px;
          background: #34d399;
          box-shadow:
            0 0 0 5px rgba(16, 185, 129, 0.1),
            0 0 28px rgba(16, 185, 129, 0.4);
        }
      `}</style>
    </section>
  );
}
