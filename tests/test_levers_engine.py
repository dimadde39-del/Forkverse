from __future__ import annotations

import unittest

import numpy as np

from engine.monte_carlo import MonteRunParams, run_simulation, simulate


def median_runway_month(paths: np.ndarray) -> int:
    median_capital = np.median(paths[:, 1:], axis=0)
    depleted_months = np.flatnonzero(median_capital <= 0)
    return int(depleted_months[0] + 1) if depleted_months.size else paths.shape[1] - 1


class LeversEngineTests(unittest.TestCase):
    def test_stress_inputs_recalculate_runway_and_chart_paths(self) -> None:
        base_params = {
            "initial_capital": 50_000,
            "monthly_income": 6_000,
            "monthly_burn": 9_000,
            "months": 24,
            "n_simulations": 500,
            "seed": 1234,
        }

        base_paths = simulate(**base_params)
        stressed_paths = simulate(
            **base_params,
            income_delay_months=3,
            capital_shock=5_000,
            burn_multiplier=1.25,
        )

        self.assertEqual(base_paths.shape, stressed_paths.shape)
        self.assertEqual(base_paths.shape[1], base_params["months"] + 1)
        self.assertLess(median_runway_month(stressed_paths), median_runway_month(base_paths))

    def test_lever_impacts_are_recomputed_from_deterministic_core(self) -> None:
        result = run_simulation(
            MonteRunParams(
                cash=30_000,
                monthly_income=2_000,
                fixed_expenses=6_000,
                flexible_expenses=2_000,
            )
        )

        levers = result["levers"]
        impacts = [lever["impact_months"] for lever in levers]

        self.assertEqual(len(levers), 3)
        self.assertEqual(impacts, sorted(impacts, reverse=True))
        self.assertGreater(max(impacts), 0)


if __name__ == "__main__":
    unittest.main()
