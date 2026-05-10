from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from api import parse
from api import simulate as simulate_api
from engine import monte_carlo
from engine.monte_carlo import simulate


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def read_project_file(path: str) -> str:
    return (PROJECT_ROOT / path).read_text(encoding="utf-8")


class WebhookOwnershipTests(unittest.TestCase):
    def test_next_route_is_single_production_telegram_webhook_owner(self) -> None:
        self.assertTrue((PROJECT_ROOT / "app/api/tg_webhook/route.ts").is_file())
        self.assertFalse((PROJECT_ROOT / "api/tg_webhook.py").exists())
        self.assertIn(
            "Single production Telegram webhook owner",
            read_project_file("app/api/tg_webhook/route.ts"),
        )


class ParseGuardrailTests(unittest.TestCase):
    def test_too_long_parse_input_is_rejected_before_llm(self) -> None:
        with self.assertRaises(parse.ApiProblem) as caught:
            parse._validate_parse_text("x" * (parse.MAX_PARSE_TEXT_CHARS + 1))

        self.assertEqual(caught.exception.code, "INVALID_PARAMS")
        self.assertEqual(caught.exception.http_status, 413)
        self.assertEqual(caught.exception.details, {"field": "text", "max_chars": parse.MAX_PARSE_TEXT_CHARS})

    def test_soft_launch_gate_rejects_missing_or_invalid_token_when_enabled(self) -> None:
        with patch.dict(os.environ, {parse.PARSE_GATE_TOKEN_ENV: "launch-secret"}):
            for headers in ({}, {parse.PARSE_GATE_HEADER: "wrong"}):
                with self.subTest(headers=headers):
                    with self.assertRaises(parse.ApiProblem) as caught:
                        parse._enforce_soft_launch_gate(headers)

                    self.assertEqual(caught.exception.code, "RATE_LIMITED")
                    self.assertEqual(caught.exception.http_status, 403)

            parse._enforce_soft_launch_gate({parse.PARSE_GATE_HEADER: "launch-secret"})
            parse._enforce_soft_launch_gate({"authorization": "Bearer launch-secret"})

    def test_parse_handler_does_not_call_second_llm_roast_stage(self) -> None:
        source = read_project_file("api/parse.py")
        do_post_source = source[source.index("    def do_POST(self) -> None:") : source.index("    def do_GET(self) -> None:")]

        self.assertIn("_build_deterministic_roast_payload", do_post_source)
        self.assertNotIn("_call_roast_stage", do_post_source)

    def test_explicit_unsupported_currency_clarifies_before_simulation(self) -> None:
        normalized = parse._normalize_extraction_payload(
            {
                "status": "ready",
                "params": {
                    "cash": 5000,
                    "monthly_income": 2000,
                    "fixed_expenses": 1000,
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
            parser_input="cash 5000 руб, income 2000 руб, expenses 1500 руб",
        )

        self.assertEqual(normalized["status"], "needs_clarification")
        self.assertEqual(normalized["missing_fields"], ["usd_converted_amounts"])

    def test_unsupported_currency_detection_does_not_match_entrepreneur(self) -> None:
        self.assertFalse(parse._has_unsupported_currency("I am an entrepreneur with $50k cash and $3k burn."))
        self.assertTrue(parse._has_unsupported_currency("cash 5000 eur, income 2000 eur, burn 1500 eur"))


class SimulationGuardrailTests(unittest.TestCase):
    def test_math_core_rejects_months_above_server_cap(self) -> None:
        with self.assertRaises(monte_carlo.ParameterError):
            simulate(
                initial_capital=50_000,
                monthly_income=5_000,
                monthly_burn=8_000,
                months=monte_carlo.LEGACY_MAX_MONTHS + 1,
                n_simulations=10,
            )

    def test_simulate_api_rejects_months_above_server_cap(self) -> None:
        with self.assertRaises(simulate_api.ApiProblem) as caught:
            simulate_api._coerce_positive_int(
                "months",
                simulate_api.MAX_SIMULATION_MONTHS + 1,
                maximum=simulate_api.MAX_SIMULATION_MONTHS,
            )

        self.assertEqual(caught.exception.code, "INVALID_PARAMS")
        self.assertEqual(caught.exception.details["reason"], "above_maximum")


class ShareOgGuardrailTests(unittest.TestCase):
    def test_og_route_sanitizes_and_renders_supplied_verdict(self) -> None:
        source = read_project_file("app/api/og/route.tsx")

        self.assertIn('sanitizeText(\n    searchParams.get("verdict")', source)
        self.assertIn(".replace(/[\\u0000-\\u001f\\u007f<>]/g", source)
        self.assertIn("{verdict}", source)

    def test_delta_share_card_uses_baseline_months_and_x_intent(self) -> None:
        simulator = read_project_file("components/SimulatorClient.tsx")
        delta_card = read_project_file("components/DeltaShareCard.tsx")

        self.assertIn('const BASELINE_MONTHS_STORAGE_KEY = "monterun_baseline_months";', simulator)
        self.assertIn("readStoredBaselineMonths", simulator)
        self.assertIn("writeStoredBaselineMonthsOnce", simulator)
        self.assertIn("window.localStorage.getItem(BASELINE_MONTHS_STORAGE_KEY)", simulator)
        self.assertIn("return storedMonths;", simulator)
        self.assertIn("<DeltaShareCard deltaMonths={deltaMonths} />", simulator)
        self.assertNotIn("getSharePagePath", simulator)
        self.assertNotIn("getOgImagePath", simulator)
        self.assertNotIn("Open share page", simulator)
        self.assertNotIn("Open OG image", simulator)

        self.assertIn("You bought yourself +{formattedDelta} months of survival time.", delta_card)
        self.assertIn("https://twitter.com/intent/tweet?text=", delta_card)
        self.assertIn("encodeURIComponent(tweetText)", delta_card)
        self.assertIn("I just crash-tested my freelance budget. By cutting the fat", delta_card)
        self.assertIn("Crash-test your own money here: https://monterun.vercel.app", delta_card)

    def test_share_page_and_og_use_same_verdict_and_delta_params(self) -> None:
        share_card = read_project_file("app/lib/share-card.ts")
        share_page = read_project_file("app/share/page.tsx")

        self.assertIn('params.set("verdict"', share_card)
        self.assertIn('setMetric(params, "baselineRunway"', share_card)
        self.assertIn('setMetric(params, "baselineSurvival"', share_card)
        self.assertIn("const ogImagePath = getOgImagePath(shareCard)", share_page)
        self.assertIn("const title = `${shareCard.verdict} | MonteRun`", share_page)

    def test_share_urls_do_not_serialize_raw_financial_inputs(self) -> None:
        share_card = read_project_file("app/lib/share-card.ts")
        simulator = read_project_file("components/SimulatorClient.tsx")

        self.assertIn("hasShareResultParams", share_card)
        self.assertNotIn('setMetric(params, "capital"', share_card)
        self.assertNotIn('setMetric(params, "income"', share_card)
        self.assertNotIn('setMetric(params, "burn"', share_card)
        self.assertNotIn("capital: simulationParams.initial_capital", simulator)
        self.assertNotIn("income: simulationParams.monthly_income", simulator)
        self.assertNotIn("burn: simulationParams.monthly_burn", simulator)

    def test_missing_share_url_renders_generic_state_instead_of_fake_metrics(self) -> None:
        share_page = read_project_file("app/share/page.tsx")
        og_route = read_project_file("app/api/og/route.tsx")
        has_result_params_source = og_route[
            og_route.index("function hasResultParams") : og_route.index("export async function GET")
        ]

        self.assertIn("No shared result loaded", share_page)
        self.assertIn("No shared result loaded", og_route)
        self.assertIn("readOptionalRunway", has_result_params_source)
        self.assertIn("readOptionalSurvival", has_result_params_source)
        self.assertNotIn('searchParams.get("runway") &&', has_result_params_source)

    def test_financial_guardrail_is_visible_on_result_share_and_og_surfaces(self) -> None:
        guardrail = "Simulation estimate, not financial advice."

        self.assertIn(guardrail, read_project_file("components/SimulatorClient.tsx"))
        self.assertIn(guardrail, read_project_file("app/share/page.tsx"))
        self.assertIn(guardrail, read_project_file("app/api/og/route.tsx"))

    def test_listed_share_files_do_not_contain_mojibake_or_arrow_glyphs(self) -> None:
        forbidden = ("в", "†", "→", "↑", "↓")
        for path in (
            "components/SimulatorClient.tsx",
            "components/DeltaShareCard.tsx",
            "app/share/page.tsx",
            "app/api/og/route.tsx",
        ):
            with self.subTest(path=path):
                source = read_project_file(path)
                for glyph in forbidden:
                    self.assertNotIn(glyph, source)


if __name__ == "__main__":
    unittest.main()
