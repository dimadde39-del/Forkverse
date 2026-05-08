from __future__ import annotations

import unittest

from api import parse


def _payload() -> dict:
    return {
        "status": "ready",
        "params": {
            "cash": 5000,
            "monthly_income": 2000,
            "fixed_expenses": 2500,
            "flexible_expenses": 1000,
            "income_delay_months": 0,
            "currency_symbol": "$",
        },
        "question": None,
        "comment": "Cold math, warm problem.",
        "smart_levers": [
            {
                "title": "Cut the optional software stack",
                "effort": "Low",
                "math_patch": {"burn": -500, "income": 0},
            },
            {
                "title": "Add one retained freelance client",
                "effort": "Medium",
                "math_patch": {"income": 1000, "burn": 0},
            },
            {
                "title": "Delay the launch spend",
                "effort": "High",
                "math_patch": {"capital_shock": -1000, "income_delay_months": 0},
            },
        ],
    }


class SmartLeverParserTests(unittest.TestCase):
    def test_normalizes_required_smart_lever_schema(self) -> None:
        normalized = parse._normalize_extraction_payload(_payload())

        self.assertEqual(len(normalized["smart_levers"]), 3)
        self.assertEqual(
            set(normalized["smart_levers"][0]),
            {"title", "effort", "math_patch"},
        )
        self.assertEqual(normalized["smart_levers"][0]["effort"], "Low")
        self.assertEqual(
            normalized["smart_levers"][0]["math_patch"],
            {"burn": -500.0, "income": 0.0},
        )

    def test_smart_levers_replace_hardcoded_actions_with_deterministic_impact(self) -> None:
        normalized = parse._normalize_extraction_payload(_payload())
        params = parse._build_monte_run_params(normalized["params"])
        base_result = parse._run_math_core(params)

        result = parse._apply_smart_levers_to_simulation(
            params=params,
            simulation_result=base_result,
            smart_levers=normalized["smart_levers"],
        )

        self.assertEqual(len(result["levers"]), 3)
        self.assertEqual(len(result["smart_levers"]), 3)
        self.assertNotIn("Cut flexible expenses by 50%", {lever["action"] for lever in result["levers"]})
        for lever in result["levers"]:
            self.assertIn(lever["effort"], {"Low", "Medium", "High"})
            self.assertIsInstance(lever["math_patch"], dict)
            self.assertGreaterEqual(lever["impact_months"], 0.0)

    def test_alpha_voice_uses_deterministic_result_and_existing_levers(self) -> None:
        normalized = parse._normalize_extraction_payload(_payload())
        params = parse._build_monte_run_params(normalized["params"])
        simulation_result = parse._apply_smart_levers_to_simulation(
            params=params,
            simulation_result=parse._run_math_core(params),
            smart_levers=normalized["smart_levers"],
        )

        voice = parse._build_deterministic_roast_payload(simulation_result, "en")

        self.assertIn("survival", voice["verdict"])
        self.assertEqual(
            voice["lever_actions"],
            [lever["action"] for lever in simulation_result["levers"]],
        )


if __name__ == "__main__":
    unittest.main()
