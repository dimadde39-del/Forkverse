from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Final

import numpy as np


SIMULATION_PATHS: Final[int] = 1_000
SIMULATION_MONTHS: Final[int] = 24
INCOME_NOISE_STD: Final[float] = 0.14
FLEXIBLE_EXPENSES_NOISE_STD: Final[float] = 0.24
DEFAULT_SEED: Final[int] = 20_260_418

LEGACY_DEFAULT_MONTHS: Final[int] = 6
LEGACY_MAX_SIMULATIONS: Final[int] = 4_000
SPAGHETTI_SAMPLE_LIMIT: Final[int] = 50


class ParameterError(TypeError):
    pass


@dataclass(frozen=True, slots=True)
class MonteRunParams:
    cash: float
    monthly_income: float
    fixed_expenses: float
    flexible_expenses: float
    income_delay_months: int = 0
    capital_shock: float = 0.0
    burn_multiplier: float = 1.0


@dataclass(frozen=True, slots=True)
class TimeMasks:
    income_active: np.ndarray


def _as_float(name: str, value: Any, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        raise ParameterError(f"{name} must be numeric")

    coerced = float(value)

    if not np.isfinite(coerced):
        raise ParameterError(f"{name} must be finite")

    if minimum is not None and coerced < minimum:
        raise ParameterError(f"{name} must be >= {minimum}")

    return coerced


def _as_int(
    name: str,
    value: Any,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, np.integer)):
        raise ParameterError(f"{name} must be an integer")

    coerced = int(value)

    if minimum is not None and coerced < minimum:
        raise ParameterError(f"{name} must be >= {minimum}")

    if maximum is not None and coerced > maximum:
        raise ParameterError(f"{name} must be <= {maximum}")

    return coerced


def _validate_params(params: MonteRunParams) -> MonteRunParams:
    if not isinstance(params, MonteRunParams):
        raise ParameterError("params must be a MonteRunParams instance")

    return MonteRunParams(
        cash=_as_float("cash", params.cash, minimum=0.0),
        monthly_income=_as_float("monthly_income", params.monthly_income, minimum=0.0),
        fixed_expenses=_as_float("fixed_expenses", params.fixed_expenses, minimum=0.0),
        flexible_expenses=_as_float("flexible_expenses", params.flexible_expenses, minimum=0.0),
        income_delay_months=_as_int("income_delay_months", params.income_delay_months, minimum=0),
        capital_shock=_as_float("capital_shock", params.capital_shock, minimum=0.0),
        burn_multiplier=_as_float("burn_multiplier", params.burn_multiplier, minimum=0.0),
    )


def _generate_noise(seed: int, n_paths: int, months: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    # Clamp multiplicative shocks at zero so noisy months do not flip cashflow signs.
    income_noise = np.maximum(
        rng.normal(loc=1.0, scale=INCOME_NOISE_STD, size=(n_paths, months)),
        0.0,
    ).astype(np.float64)
    flexible_noise = np.maximum(
        rng.normal(loc=1.0, scale=FLEXIBLE_EXPENSES_NOISE_STD, size=(n_paths, months)),
        0.0,
    ).astype(np.float64)

    return income_noise, flexible_noise


def _clamp_month_count(value: int, months: int) -> int:
    return int(np.clip(value, 0, months))


def _build_time_masks(*, months: int, income_delay_months: int = 0) -> TimeMasks:
    if months < 1:
        raise ParameterError("months must be >= 1")

    delayed_months = _clamp_month_count(income_delay_months, months)
    month_indices = np.arange(months, dtype=np.int64)

    return TimeMasks(
        income_active=month_indices >= delayed_months,
    )


def _simulate_capital_paths(
    params: MonteRunParams,
    *,
    income_noise: np.ndarray,
    flexible_noise: np.ndarray,
    income_delay_months: int = 0,
) -> np.ndarray:
    if income_noise.shape != flexible_noise.shape:
        raise ParameterError("income_noise and flexible_noise must have the same shape")

    time_masks = _build_time_masks(
        months=income_noise.shape[1],
        income_delay_months=income_delay_months,
    )
    realized_income = np.multiply(params.monthly_income, income_noise, dtype=np.float64)
    realized_income = np.multiply(realized_income, time_masks.income_active, dtype=np.float64)
    realized_fixed_expenses = params.fixed_expenses * params.burn_multiplier
    realized_flexible_expenses = np.multiply(
        params.flexible_expenses * params.burn_multiplier,
        flexible_noise,
        dtype=np.float64,
    )

    monthly_net = realized_income - realized_fixed_expenses - realized_flexible_expenses
    starting_cash = params.cash - params.capital_shock
    raw_capital = starting_cash + np.cumsum(monthly_net, axis=1, dtype=np.float64)

    depleted = np.maximum.accumulate(raw_capital <= 0.0, axis=1)
    if starting_cash <= 0.0:
        depleted = np.full_like(depleted, True, dtype=np.bool_)
    capital_paths = np.where(depleted, 0.0, raw_capital)

    return capital_paths


def _prepend_initial_cash(capital_paths: np.ndarray, cash: float) -> np.ndarray:
    initial_column = np.full((capital_paths.shape[0], 1), max(float(cash), 0.0), dtype=np.float64)
    return np.concatenate((initial_column, capital_paths), axis=1)


def _first_month_median_depletes(capital_paths: np.ndarray) -> float:
    median_capital = np.median(capital_paths, axis=0)
    depleted_months = np.flatnonzero(median_capital <= 0.0)

    if depleted_months.size == 0:
        return float(capital_paths.shape[1])

    return float(depleted_months[0] + 1)


def _survival_probability_at_month(capital_paths: np.ndarray, month_number: int) -> float:
    if month_number < 1:
        raise ParameterError("month_number must be >= 1")

    month_index = min(month_number, capital_paths.shape[1]) - 1
    survivors = capital_paths[:, month_index] > 0.0
    return float(np.mean(survivors, dtype=np.float64) * 100.0)


def _build_lever_scenarios(params: MonteRunParams) -> tuple[tuple[str, MonteRunParams], ...]:
    return (
        (
            "Cut flexible expenses by 50%",
            replace(params, flexible_expenses=float(params.flexible_expenses * 0.50)),
        ),
        (
            "Increase monthly income by 20%",
            replace(params, monthly_income=float(params.monthly_income * 1.20)),
        ),
        (
            "Reduce fixed expenses by 10%",
            replace(params, fixed_expenses=float(params.fixed_expenses * 0.90)),
        ),
    )


def _compute_levers(
    params: MonteRunParams,
    *,
    income_noise: np.ndarray,
    flexible_noise: np.ndarray,
    base_runway_months: float,
    income_delay_months: int = 0,
) -> list[dict[str, float | str]]:
    levers = [
        {
            "action": action,
            "impact_months": float(
                _first_month_median_depletes(
                    _simulate_capital_paths(
                        lever_params,
                        income_noise=income_noise,
                        flexible_noise=flexible_noise,
                        income_delay_months=income_delay_months,
                    )
                )
                - base_runway_months
            ),
        }
        for action, lever_params in _build_lever_scenarios(params)
    ]

    levers.sort(key=lambda item: (-float(item["impact_months"]), str(item["action"])))
    return levers


def run_simulation(params: MonteRunParams) -> dict[str, Any]:
    validated_params = _validate_params(params)
    income_noise, flexible_noise = _generate_noise(
        seed=DEFAULT_SEED,
        n_paths=SIMULATION_PATHS,
        months=SIMULATION_MONTHS,
    )

    base_paths = _simulate_capital_paths(
        validated_params,
        income_noise=income_noise,
        flexible_noise=flexible_noise,
        income_delay_months=validated_params.income_delay_months,
    )
    base_runway_months = _first_month_median_depletes(base_paths)
    survival_probability_12m = _survival_probability_at_month(base_paths, 12)
    levers = _compute_levers(
        validated_params,
        income_noise=income_noise,
        flexible_noise=flexible_noise,
        base_runway_months=base_runway_months,
        income_delay_months=validated_params.income_delay_months,
    )

    return {
        "base_runway_months": float(base_runway_months),
        "survival_probability_12m": float(survival_probability_12m),
        "levers": levers,
    }


def simulate(
    *,
    initial_capital: Any,
    monthly_burn: Any,
    monthly_income: Any,
    months: Any = LEGACY_DEFAULT_MONTHS,
    n_simulations: Any = LEGACY_MAX_SIMULATIONS,
    seed: Any = None,
    income_delay_months: Any = 0,
    capital_shock: Any = 0.0,
    burn_multiplier: Any = 1.0,
) -> np.ndarray:
    initial_capital_value = _as_float("initial_capital", initial_capital, minimum=0.0)
    monthly_burn_value = _as_float("monthly_burn", monthly_burn, minimum=0.0)
    monthly_income_value = _as_float("monthly_income", monthly_income, minimum=0.0)
    capital_shock_value = _as_float("capital_shock", capital_shock, minimum=0.0)
    burn_multiplier_value = _as_float("burn_multiplier", burn_multiplier, minimum=0.0)
    months_value = _as_int("months", months, minimum=1)
    n_simulations_value = _as_int(
        "n_simulations",
        n_simulations,
        minimum=1,
        maximum=LEGACY_MAX_SIMULATIONS,
    )
    income_delay_months_value = _as_int(
        "income_delay_months",
        income_delay_months,
        minimum=0,
    )
    seed_value = DEFAULT_SEED if seed is None else _as_int("seed", seed, minimum=0)

    params = MonteRunParams(
        cash=initial_capital_value,
        monthly_income=monthly_income_value,
        fixed_expenses=monthly_burn_value,
        flexible_expenses=0.0,
        income_delay_months=income_delay_months_value,
        capital_shock=capital_shock_value,
        burn_multiplier=burn_multiplier_value,
    )
    validated_params = _validate_params(params)
    income_noise, flexible_noise = _generate_noise(
        seed=seed_value,
        n_paths=n_simulations_value,
        months=months_value,
    )
    capital_paths = _simulate_capital_paths(
        validated_params,
        income_noise=income_noise,
        flexible_noise=flexible_noise,
        income_delay_months=validated_params.income_delay_months,
    )

    return _prepend_initial_cash(capital_paths, validated_params.cash - validated_params.capital_shock)


def compute_metrics(paths: np.ndarray) -> dict[str, Any]:
    array = np.asarray(paths, dtype=np.float64)

    if array.ndim != 2:
        raise ParameterError("paths must be a 2D numpy array")

    if array.shape[0] < 1:
        raise ParameterError("paths must contain at least one simulation")

    if array.shape[1] < 2:
        raise ParameterError("paths must contain at least one month plus the initial state")

    percentiles = np.percentile(array, q=np.array([10.0, 50.0, 90.0]), axis=0, method="linear")
    survival_probability = float(np.mean(np.all(array[:, 1:] > 0.0, axis=1), dtype=np.float64))

    sample_size = min(int(array.shape[0]), SPAGHETTI_SAMPLE_LIMIT)
    sample_indices = np.linspace(0, array.shape[0] - 1, num=sample_size, dtype=np.int64)
    spaghetti_sample = np.round(array[sample_indices], 2)
    months_axis = np.arange(array.shape[1], dtype=np.int64)

    return {
        "months": months_axis.tolist(),
        "n_simulations": int(array.shape[0]),
        "survival_probability": survival_probability,
        "p10": np.round(percentiles[0], 2).tolist(),
        "p50": np.round(percentiles[1], 2).tolist(),
        "p90": np.round(percentiles[2], 2).tolist(),
        "spaghetti_sample": spaghetti_sample.tolist(),
    }


__all__ = [
    "MonteRunParams",
    "ParameterError",
    "compute_metrics",
    "run_simulation",
    "simulate",
]
