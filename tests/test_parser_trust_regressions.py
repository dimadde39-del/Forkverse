from __future__ import annotations

import unittest
from pathlib import Path

from api import parse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RUSSIAN_ALPHA_SCENARIO = (
    "У меня есть 10🍋 хочу открыть бизнес, хочу открыть фаст фуд пельмени, "
    "манты, котлеты еда быстрого приготовления. Уволилась с работы в данный "
    "момент нет поступления денежных средств"
)
MISSING_EXPENSES_RU = "Не хватает данных для расчёта: укажите примерные ежемесячные расходы."


def read_project_file(path: str) -> str:
    return (PROJECT_ROOT / path).read_text(encoding="utf-8")


class ParserTrustRegressionTests(unittest.TestCase):
    def test_money_slang_lemon_emoji_means_million(self) -> None:
        self.assertEqual(parse._parse_numeric_string("10🍋"), 10_000_000)

    def test_english_money_suffixes_do_not_shrink_values(self) -> None:
        self.assertEqual(parse._parse_numeric_string("$10k"), 10_000)
        self.assertEqual(parse._parse_numeric_string("2.5m"), 2_500_000)
        self.assertEqual(parse._parse_numeric_string("3 million"), 3_000_000)
        self.assertEqual(parse._parse_numeric_string("1e6"), 1_000_000)

    def test_money_slang_lyam_means_million(self) -> None:
        self.assertEqual(parse._parse_numeric_string("10 лямов"), 10_000_000)

    def test_money_slang_mln_decimal_means_million(self) -> None:
        self.assertEqual(parse._parse_numeric_string("2.5 млн"), 2_500_000)

    def test_no_income_missing_expenses_does_not_simulate_fake_survival(self) -> None:
        normalized = parse._normalize_extraction_payload(
            {
                "status": "ready",
                "params": {
                    "cash": 10,
                    "monthly_income": 50_000,
                    "fixed_expenses": 0,
                    "flexible_expenses": 0,
                    "income_delay_months": 0,
                    "currency_symbol": "$",
                },
                "question": None,
                "comment": "Cold math.",
            },
            parser_input=RUSSIAN_ALPHA_SCENARIO,
        )

        self.assertEqual(normalized["status"], "needs_clarification")
        self.assertIsNone(normalized["params"])
        self.assertEqual(normalized["language"], "ru")
        self.assertNotIn("survival_probability", normalized)

    def test_russian_scenario_returns_russian_missing_data_message(self) -> None:
        normalized = parse._normalize_extraction_payload(
            {
                "status": "ready",
                "params": {
                    "cash": 10,
                    "monthly_income": 0,
                    "fixed_expenses": 0,
                    "flexible_expenses": 0,
                    "income_delay_months": 0,
                    "currency_symbol": "$",
                },
                "question": None,
                "comment": "Cold math.",
            },
            parser_input=RUSSIAN_ALPHA_SCENARIO,
        )

        self.assertEqual(normalized["question"], MISSING_EXPENSES_RU)
        self.assertEqual(normalized["comment"], MISSING_EXPENSES_RU)
        self.assertEqual(normalized["missing_fields"], ["monthly_expenses"])
        self.assertEqual(normalized["optional_missing_fields"], ["expected_business_income"])

    def test_kazakh_tenge_aliases_clarify_before_simulation(self) -> None:
        for scenario in (
            "cash 10000 tenge, income 2000 tenge, expenses 1500 tenge",
            "cash 10000 \u0442\u0433, income 2000 \u0442\u0433, expenses 1500 \u0442\u0433",
            "cash 10000 \u0442\u0435\u04a3\u0433\u0435, income 2000 \u0442\u0435\u04a3\u0433\u0435, expenses 1500 \u0442\u0435\u04a3\u0433\u0435",
        ):
            with self.subTest(scenario=scenario):
                normalized = parse._normalize_extraction_payload(
                    {
                        "status": "ready",
                        "params": {
                            "cash": 10_000,
                            "monthly_income": 2_000,
                            "fixed_expenses": 1_000,
                            "flexible_expenses": 500,
                            "income_delay_months": 0,
                            "currency_symbol": "$",
                        },
                        "question": None,
                        "comment": "Cold math.",
                    },
                    parser_input=scenario,
                )

                self.assertEqual(normalized["status"], "needs_clarification")
                self.assertEqual(normalized["missing_fields"], ["usd_converted_amounts"])

    def test_numeric_russian_followup_keeps_russian_language(self) -> None:
        parser_input = parse._build_parser_input(
            "200000",
            {"last_bot_question": "\u041a\u0430\u043a\u0438\u0435 \u0435\u0436\u0435\u043c\u0435\u0441\u044f\u0447\u043d\u044b\u0435 \u0440\u0430\u0441\u0445\u043e\u0434\u044b?"},
        )

        self.assertEqual(parse._detect_result_language(parser_input), "ru")

    def test_business_launch_with_zero_expenses_still_clarifies_costs(self) -> None:
        for scenario in (
            "I have $100k, no income, no expenses, and want to open a business.",
            "I have $100k, no income, no expenses, and want to launch a startup.",
        ):
            with self.subTest(scenario=scenario):
                normalized = parse._normalize_extraction_payload(
                    {
                        "status": "ready",
                        "params": {
                            "cash": 100_000,
                            "monthly_income": 0,
                            "fixed_expenses": 0,
                            "flexible_expenses": 0,
                            "income_delay_months": 0,
                            "currency_symbol": "$",
                        },
                        "question": None,
                        "comment": "Cold math.",
                    },
                    parser_input=scenario,
                )

                self.assertEqual(normalized["status"], "needs_clarification")
                self.assertEqual(normalized["missing_fields"], ["monthly_expenses"])
                self.assertEqual(normalized["optional_missing_fields"], ["expected_business_income"])

    def test_one_missing_expense_component_does_not_default_to_zero(self) -> None:
        normalized = parse._normalize_extraction_payload(
            {
                "status": "ready",
                "params": {
                    "cash": 10_000,
                    "monthly_income": 2_000,
                    "fixed_expenses": 1_000,
                    "flexible_expenses": None,
                    "income_delay_months": 0,
                    "currency_symbol": "$",
                },
                "question": None,
                "comment": "Cold math.",
            },
            parser_input="cash 10000, income 2000, rent 1000",
        )

        self.assertEqual(normalized["status"], "needs_clarification")
        self.assertEqual(normalized["missing_fields"], ["flexible_expenses"])

    def test_extraction_params_cannot_apply_baseline_stress(self) -> None:
        normalized = parse._normalize_extraction_payload(
            {
                "status": "ready",
                "params": {
                    "cash": 10_000,
                    "monthly_income": 2_000,
                    "fixed_expenses": 1_000,
                    "flexible_expenses": 500,
                    "income_delay_months": 0,
                    "capital_shock": 5_000,
                    "burn_multiplier": 2,
                    "currency_symbol": "$",
                },
                "question": None,
                "comment": "Cold math.",
                "smart_levers": [
                    {"title": "Cut subscriptions", "effort": "Low", "math_patch": {"burn": -100}},
                    {"title": "Add one client", "effort": "Medium", "math_patch": {"income": 500}},
                    {"title": "Delay spend", "effort": "High", "math_patch": {"capital_shock": -500}},
                ],
            },
            parser_input="cash 10000, income 2000, fixed expenses 1000, flexible expenses 500",
        )

        self.assertEqual(normalized["status"], "ready")
        self.assertEqual(normalized["params"]["capital_shock"], 0.0)
        self.assertEqual(normalized["params"]["burn_multiplier"], 1.0)

    def test_fallback_params_cannot_apply_baseline_stress(self) -> None:
        normalized = parse._normalize_extraction_payload(
            {
                "status": "ready",
                "params": {
                    "cash": 10_000,
                    "monthly_income": 2_000,
                    "fixed_expenses": 1_000,
                    "flexible_expenses": 500,
                    "income_delay_months": 0,
                    "currency_symbol": "$",
                },
                "question": None,
                "comment": "Cold math.",
                "smart_levers": [
                    {"title": "Cut subscriptions", "effort": "Low", "math_patch": {"burn": -100}},
                    {"title": "Add one client", "effort": "Medium", "math_patch": {"income": 500}},
                    {"title": "Delay spend", "effort": "High", "math_patch": {"capital_shock": -500}},
                ],
            },
            fallback_params={
                "capital_shock": 5_000,
                "burn_multiplier": 2,
            },
            parser_input="cash 10000, income 2000, fixed expenses 1000, flexible expenses 500",
        )

        self.assertEqual(normalized["status"], "ready")
        self.assertEqual(normalized["params"]["capital_shock"], 0.0)
        self.assertEqual(normalized["params"]["burn_multiplier"], 1.0)

    def test_russian_share_card_uses_localized_labels(self) -> None:
        share_card = read_project_file("app/lib/share-card.ts")
        simulator = read_project_file("components/SimulatorClient.tsx")

        self.assertIn("Результат симуляции", share_card)
        self.assertIn("Вероятность выживания 12м", share_card)
        self.assertIn("shareCard.labels.simulationResult", simulator)
        self.assertIn("shareCard.labels.survivalMetric", simulator)
        self.assertNotIn('<div className="share-card__eyebrow">Simulation Result</div>', simulator)
        self.assertNotIn('<div className="share-card__metric-label">Survival Probability 12m</div>', simulator)


if __name__ == "__main__":
    unittest.main()
