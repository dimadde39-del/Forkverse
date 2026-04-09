from __future__ import annotations

from typing import Any, Final

import numpy as np


MAX_SIMULATIONS: Final[int] = 4000
DEFAULT_MONTHS: Final[int] = 6
SPAGHETTI_SAMPLE_LIMIT: Final[int] = 50
SIGMA_INCOME_RATIO: Final[float] = 0.10
SIGMA_BURN_RATIO: Final[float] = 0.05
MIN_SIGMA: Final[float] = 1.0


class ParameterError(TypeError):
    pass


def _as_int(name: str, value: Any, minimum: int | None = None, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, np.integer)):
        raise ParameterError(f"{name} must be an integer")

    coerced = int(value)

    if minimum is not None and coerced < minimum:
        raise ParameterError(f"{name} must be >= {minimum}")

    if maximum is not None and coerced > maximum:
        raise ParameterError(f"{name} must be <= {maximum}")

    return coerced


def _as_number(name: str, value: Any, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        raise ParameterError(f"{name} must be numeric")

    coerced = float(value)

    if not np.isfinite(coerced):
        raise ParameterError(f"{name} must be finite")

    if minimum is not None and coerced < minimum:
        raise ParameterError(f"{name} must be >= {minimum}")

    return coerced


def _as_seed(value: Any) -> int | None:
    if value is None:
        return None

    return _as_int("seed", value, minimum=0)


def simulate(
    *,
    initial_capital: Any,
    monthly_burn: Any,
    monthly_income: Any,
    months: Any = DEFAULT_MONTHS,
    n_simulations: Any = MAX_SIMULATIONS,
    seed: Any = None,
) -> np.ndarray:
    initial_capital_value = _as_number("initial_capital", initial_capital, minimum=0.0)
    monthly_burn_value = _as_number("monthly_burn", monthly_burn, minimum=0.0)
    monthly_income_value = _as_number("monthly_income", monthly_income, minimum=0.0)
    months_value = _as_int("months", months, minimum=1)
    n_simulations_value = _as_int("n_simulations", n_simulations, minimum=1, maximum=MAX_SIMULATIONS)
    seed_value = _as_seed(seed)

    rng = np.random.default_rng(seed=seed_value)

    baseline_monthly_delta = monthly_income_value - monthly_burn_value
    monthly_sigma = max(
        MIN_SIGMA,
        (monthly_income_value * SIGMA_INCOME_RATIO) + (monthly_burn_value * SIGMA_BURN_RATIO),
    )

    monthly_deltas = rng.normal(
        loc=baseline_monthly_delta,
        scale=monthly_sigma,
        size=(n_simulations_value, months_value),
    )

    cumulative_deltas = np.cumsum(monthly_deltas, axis=1, dtype=np.float64)
    initial_column = np.full((n_simulations_value, 1), initial_capital_value, dtype=np.float64)

    return np.concatenate((initial_column, initial_column + cumulative_deltas), axis=1)


def compute_metrics(paths: np.ndarray) -> dict[str, Any]:
    array = np.asarray(paths, dtype=np.float64)

    if array.ndim != 2:
        raise ParameterError("paths must be a 2D numpy array")

    if array.shape[0] < 1:
        raise ParameterError("paths must contain at least one simulation")

    if array.shape[1] < 2:
        raise ParameterError("paths must contain at least one month plus the initial state")

    percentiles = np.percentile(array, q=np.array([10.0, 50.0, 90.0]), axis=0, method="linear")
    survival_probability = float(np.mean(np.all(array >= 0.0, axis=1), dtype=np.float64))

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
