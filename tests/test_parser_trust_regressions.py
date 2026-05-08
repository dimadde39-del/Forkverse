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
