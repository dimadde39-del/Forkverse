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

    def test_primary_share_cta_copies_share_page_url(self) -> None:
        source = read_project_file("components/SimulatorClient.tsx")

        self.assertIn("new URL(shareLinks.sharePagePath, window.location.origin)", source)
        self.assertNotIn("absoluteShareUrl.search = serializedSimulationUrlParams", source)
        self.assertIn("disabled={!shareLinks}", source)

    def test_share_page_and_og_use_same_verdict_and_delta_params(self) -> None:
        share_card = read_project_file("app/lib/share-card.ts")
        share_page = read_project_file("app/share/page.tsx")

        self.assertIn('params.set("verdict"', share_card)
        self.assertIn('setMetric(params, "baselineRunway"', share_card)
        self.assertIn('setMetric(params, "baselineSurvival"', share_card)
        self.assertIn("const ogImagePath = getOgImagePath(shareCard)", share_page)
        self.assertIn("const title = `${shareCard.verdict} | MonteRun`", share_page)

    def test_financial_guardrail_is_visible_on_result_share_and_og_surfaces(self) -> None:
        guardrail = "Simulation estimate, not financial advice."

        self.assertIn(guardrail, read_project_file("components/SimulatorClient.tsx"))
        self.assertIn(guardrail, read_project_file("app/share/page.tsx"))
        self.assertIn(guardrail, read_project_file("app/api/og/route.tsx"))

    def test_listed_share_files_do_not_contain_mojibake_or_arrow_glyphs(self) -> None:
        forbidden = ("в", "†", "→", "↑", "↓")
        for path in (
            "components/SimulatorClient.tsx",
            "app/share/page.tsx",
            "app/api/og/route.tsx",
        ):
            with self.subTest(path=path):
                source = read_project_file(path)
                for glyph in forbidden:
                    self.assertNotIn(glyph, source)


if __name__ == "__main__":
    unittest.main()
