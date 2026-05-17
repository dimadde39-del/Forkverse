"use client";

import { useEffect, useState, type CSSProperties } from "react";

export type WhatIfSimulationParams = {
  initial_capital: number;
  monthly_burn: number;
  monthly_income: number;
  income_delay_months: number;
  capital_shock: number;
  burn_multiplier: number;
  months: number;
  n_simulations: number;
};

type EditableParamKey =
  | "initial_capital"
  | "monthly_burn"
  | "monthly_income"
  | "income_delay_months"
  | "capital_shock"
  | "burn_multiplier";

type SliderDescriptor = {
  key: EditableParamKey;
  label: string;
  eyebrow: string;
  min: number;
  max: number;
  step: number;
  formatValue: (value: number, currencySymbol: string) => string;
};

export type WhatIfControlsProps = {
  params: WhatIfSimulationParams | null;
  currencySymbol?: string;
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
  capital_shock: 0,
  burn_multiplier: 1,
  months: 12,
  n_simulations: 100,
};

const moneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const prefixMoneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const PREFIX_CURRENCY_SYMBOLS = new Set(["$"]);
const MAX_MONEY_PARAM = 1_000_000_000;
const MAX_INCOME_DELAY_MONTHS = 12;

function roundUpToStep(value: number, step: number): number {
  return Math.ceil(Math.max(value, step) / step) * step;
}

function getMoneySliderStep(value: number): number {
  return value >= 100_000 ? 1_000 : 100;
}

function getMoneySliderConfig(minimumMax: number, ...values: number[]) {
  const baseMax = Math.max(minimumMax, ...values);
  const step = getMoneySliderStep(baseMax);

  return {
    max: roundUpToStep(baseMax, step),
    step,
  };
}

function isPrefixCurrencySymbol(currencySymbol: string): boolean {
  return PREFIX_CURRENCY_SYMBOLS.has(currencySymbol);
}

function formatCurrency(value: number, currencySymbol: string): string {
  const formatter = isPrefixCurrencySymbol(currencySymbol) ? prefixMoneyFormatter : moneyFormatter;
  const amount = formatter.format(Math.round(value));

  return isPrefixCurrencySymbol(currencySymbol) ? `${currencySymbol} ${amount}` : `${amount} ${currencySymbol}`;
}

function formatSignedCurrency(value: number, currencySymbol: string): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(rounded), currencySymbol)}`;
}

function formatDelayMonths(value: number): string {
  return value > 0 ? `+${value}m` : "Live";
}

function formatMultiplier(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}x`;
}

function clampSliderValue(key: EditableParamKey, value: number, params: WhatIfSimulationParams): number {
  if (key === "burn_multiplier") {
    return Math.max(0.5, Math.min(4, Math.round(value * 100) / 100));
  }

  const rounded = Math.max(0, Math.round(value));
  if (key === "income_delay_months") {
    return Math.min(rounded, params.months, MAX_INCOME_DELAY_MONTHS);
  }

  return rounded;
}

function getManualInputMax(key: EditableParamKey, params: WhatIfSimulationParams): number {
  if (key === "income_delay_months") {
    return Math.max(0, Math.min(MAX_INCOME_DELAY_MONTHS, params.months));
  }

  return key === "burn_multiplier" ? 4 : MAX_MONEY_PARAM;
}

function sanitizeManualInputValue(
  key: EditableParamKey,
  rawValue: string,
  params: WhatIfSimulationParams,
): number | null {
  const normalizedValue = rawValue.replace(/[^\d.-]/g, "");

  if (normalizedValue === "" || normalizedValue === "-" || normalizedValue === "." || normalizedValue === "-.") {
    return null;
  }

  const parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  if (key === "burn_multiplier") {
    return Math.min(Math.max(0.5, Math.round(parsedValue * 100) / 100), getManualInputMax(key, params));
  }

  const roundedValue = Math.round(parsedValue);
  return Math.min(Math.max(0, roundedValue), getManualInputMax(key, params));
}

function buildManualInputValues(params: WhatIfSimulationParams): Record<EditableParamKey, string> {
  return {
    initial_capital: String(params.initial_capital),
    monthly_burn: String(params.monthly_burn),
    monthly_income: String(params.monthly_income),
    income_delay_months: String(params.income_delay_months),
    capital_shock: String(params.capital_shock),
    burn_multiplier: String(params.burn_multiplier),
  };
}

function getSliderPercent(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }

  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function buildSliders(params: WhatIfSimulationParams): SliderDescriptor[] {
  const capitalSlider = getMoneySliderConfig(1_000_000, params.initial_capital * 2);
  const incomeSlider = getMoneySliderConfig(100_000, params.monthly_income * 2, params.monthly_burn);
  const burnSlider = getMoneySliderConfig(100_000, params.monthly_burn * 2, params.monthly_income);
  const shockSlider = getMoneySliderConfig(100_000, params.capital_shock * 2, params.initial_capital);
  const delayMax = Math.max(0, Math.min(MAX_INCOME_DELAY_MONTHS, params.months));

  return [
    {
      key: "initial_capital",
      label: "Initial capital",
      eyebrow: "cash now",
      min: 0,
      max: capitalSlider.max,
      step: capitalSlider.step,
      formatValue: formatCurrency,
    },
    {
      key: "monthly_income",
      label: "Monthly income",
      eyebrow: "after delay",
      min: 0,
      max: incomeSlider.max,
      step: incomeSlider.step,
      formatValue: formatCurrency,
    },
    {
      key: "monthly_burn",
      label: "Monthly Burn",
      eyebrow: "outflow",
      min: 0,
      max: burnSlider.max,
      step: burnSlider.step,
      formatValue: formatCurrency,
    },
    {
      key: "income_delay_months",
      label: "Income delay (months)",
      eyebrow: "timing",
      min: 0,
      max: delayMax,
      step: 1,
      formatValue: formatDelayMonths,
    },
    {
      key: "capital_shock",
      label: "Capital shock",
      eyebrow: "capital shock",
      min: 0,
      max: shockSlider.max,
      step: shockSlider.step,
      formatValue: formatCurrency,
    },
    {
      key: "burn_multiplier",
      label: "Burn multiplier",
      eyebrow: "burn multiplier",
      min: 0.5,
      max: 3,
      step: 0.05,
      formatValue: (value) => formatMultiplier(value),
    },
  ];
}

export default function WhatIfControls({
  params,
  currencySymbol = "$",
  disabled = false,
  loading = false,
  className = "",
  onChange,
}: WhatIfControlsProps) {
  const currentParams = params ?? emptyParams;
  const controlsDisabled = disabled || params === null;
  const sliders = buildSliders(currentParams);
  const netAfterIncome = currentParams.monthly_income - currentParams.monthly_burn;
  const [activeInputKey, setActiveInputKey] = useState<EditableParamKey | null>(null);
  const [manualInputValues, setManualInputValues] = useState<Record<EditableParamKey, string>>(() =>
    buildManualInputValues(currentParams),
  );

  useEffect(() => {
    setManualInputValues((previousValues) => {
      const nextValues = buildManualInputValues(currentParams);

      if (!activeInputKey) {
        return nextValues;
      }

      return {
        ...nextValues,
        [activeInputKey]: previousValues[activeInputKey],
      };
    });
  }, [
    activeInputKey,
    currentParams.initial_capital,
    currentParams.monthly_burn,
    currentParams.monthly_income,
    currentParams.income_delay_months,
    currentParams.capital_shock,
    currentParams.burn_multiplier,
    currentParams.months,
  ]);

  function handleSliderChange(key: EditableParamKey, value: number) {
    if (!params || controlsDisabled) {
      return;
    }

    onChange({
      ...params,
      [key]: clampSliderValue(key, value, params),
    });
  }

  function handleManualInputChange(key: EditableParamKey, rawValue: string) {
    if (!params || controlsDisabled) {
      return;
    }

    setManualInputValues((previousValues) => ({
      ...previousValues,
      [key]: rawValue,
    }));

    const sanitizedValue = sanitizeManualInputValue(key, rawValue, params);

    if (sanitizedValue === null) {
      return;
    }

    onChange({
      ...params,
      [key]: sanitizedValue,
    });
  }

  function handleManualInputBlur(key: EditableParamKey) {
    setActiveInputKey(null);

    if (!params) {
      return;
    }

    const sanitizedValue = sanitizeManualInputValue(key, manualInputValues[key], params) ?? (key === "burn_multiplier" ? 0.5 : 0);

    setManualInputValues((previousValues) => ({
      ...previousValues,
      [key]: String(sanitizedValue),
    }));

    if (!controlsDisabled && sanitizedValue !== params[key]) {
      onChange({
        ...params,
        [key]: sanitizedValue,
      });
    }
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
            <div className="mt-2 font-mono text-sm text-white tabular-nums">
              {formatSignedCurrency(netAfterIncome, currencySymbol)}
            </div>
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
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{slider.label}</span>
                    <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-white/38">
                      {slider.eyebrow}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[12px] text-emerald-100 tabular-nums">
                      {slider.formatValue(value, currencySymbol)}
                    </span>
                    <input
                      aria-label={
                        slider.key === "income_delay_months"
                          ? "Income delay (months) precise value"
                          : `${slider.label} precise value`
                      }
                      className="what-if-number h-8 w-[7.5rem] rounded-full border border-white/12 bg-black/24 px-3 text-right font-mono text-[12px] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition placeholder:text-white/24 focus:border-emerald-200/70 focus:bg-black/36 focus:text-emerald-50 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.11)] disabled:cursor-not-allowed disabled:opacity-50 sm:w-[8.5rem]"
                      disabled={controlsDisabled}
                      inputMode="numeric"
                      max={getManualInputMax(slider.key, currentParams)}
                      min={0}
                      onBlur={() => handleManualInputBlur(slider.key)}
                      onChange={(event) => handleManualInputChange(slider.key, event.currentTarget.value)}
                      onFocus={() => setActiveInputKey(slider.key)}
                      type="text"
                      value={manualInputValues[slider.key]}
                    />
                  </span>
                </div>

                <input
                  aria-valuetext={slider.formatValue(value, currencySymbol)}
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

        .what-if-number {
          appearance: textfield;
        }

        .what-if-number::-webkit-outer-spin-button,
        .what-if-number::-webkit-inner-spin-button {
          appearance: none;
          margin: 0;
        }
      `}</style>
    </section>
  );
}
