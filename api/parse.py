from __future__ import annotations

import importlib
import json
import logging
import os
import re
import sys
import time
import traceback
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone
from functools import lru_cache
from http.server import BaseHTTPRequestHandler
from importlib.machinery import PathFinder
from importlib.util import module_from_spec
from pathlib import Path
from typing import Any, Final

import numpy as np


SCHEMA_VERSION: Final[str] = "2026-04"
MAX_PAYLOAD_BYTES: Final[int] = 1_000_000
REQUEST_TIMEOUT_SECONDS: Final[float] = 20.0
PROJECT_ROOT: Final[Path] = Path(__file__).parent.parent.resolve()
ENV_PATH: Final[Path] = PROJECT_ROOT / ".env"

DEEPSEEK_BASE_URL: Final[str] = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL: Final[str] = "deepseek-v4-flash"
DEEPSEEK_API_KEY_ENV: Final[str] = "DEEPSEEK_API_KEY"

SUPABASE_URL_ENV: Final[str] = "SUPABASE_URL"
SUPABASE_SERVICE_ROLE_KEY_ENV: Final[str] = "SUPABASE_SERVICE_ROLE_KEY"
TELEGRAM_CONTEXT_TABLE: Final[str] = "telegram_context"
SCENARIO_STATE_TABLE: Final[str] = "scenario_state"
PARSER_INPUT_PREFIX: Final[str] = "BASE_CONTEXT_JSON:"
LAST_BOT_QUESTION_PREFIX: Final[str] = "LAST_BOT_QUESTION:"
PARSER_INPUT_USER_MESSAGE_PREFIX: Final[str] = "USER_MESSAGE:"
LAST_BOT_QUESTION_KEY: Final[str] = "last_bot_question"
LAST_BOT_QUESTION_METADATA_KEY: Final[str] = LAST_BOT_QUESTION_KEY
PARSER_CONTEXT_LAST_BOT_QUESTION_FIELDS: Final[tuple[str, ...]] = (
    LAST_BOT_QUESTION_KEY,
    "latest_bot_question",
    "bot_question",
    "question_text",
    "question",
    "last_question",
    "clarification_question",
)

MONTE_RUN_PARAM_FIELDS: Final[tuple[str, ...]] = (
    "cash",
    "monthly_income",
    "fixed_expenses",
    "flexible_expenses",
)
INCOME_DELAY_MONTHS_FIELD: Final[str] = "income_delay_months"
CAPITAL_SHOCK_FIELD: Final[str] = "capital_shock"
BURN_MULTIPLIER_FIELD: Final[str] = "burn_multiplier"
MONTE_RUN_OPTIONAL_PARAM_FIELDS: Final[tuple[str, ...]] = (
    CAPITAL_SHOCK_FIELD,
    BURN_MULTIPLIER_FIELD,
)
CURRENCY_SYMBOL_FIELD: Final[str] = "currency_symbol"
DEFAULT_CURRENCY_SYMBOL: Final[str] = "$"
LEGACY_SIMULATION_MONTHS: Final[int] = 24
LEGACY_SIMULATION_PATHS: Final[int] = 1_000
SUGGESTED_STRESS_TARGETS: Final[frozenset[str]] = frozenset(
    {"income_delay", "capital_shock", "burn_multiplier"}
)
SMART_LEVER_EFFORTS: Final[frozenset[str]] = frozenset({"Low", "Medium", "High"})
SMART_LEVER_PATCH_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "cash",
        "income",
        "burn",
        "monthly_income",
        "fixed_expenses",
        "flexible_expenses",
        "income_delay_months",
        "capital_shock",
        "burn_multiplier",
    }
)

EXTRACTION_SYSTEM_PROMPT: Final[str] = """
Ты — MonteRun Extraction Layer.
Твоя задача: вытащить из текста пользователя 5 полей для MonteRunParams:
- cash
- monthly_income
- fixed_expenses
- flexible_expenses
- income_delay_months

CRITICAL RULE:
NEVER ask follow-up questions. NEVER enter a conversational loop. If exact numbers are missing, CALCULATE them from context (e.g., '3 clients for $2000' = $6000 monthly income) or make pessimistic assumptions. You MUST ALWAYS output the final JSON and nothing else.

Верни строго JSON-объект и ничего кроме JSON.

Формат READY:
{
  "status": "ready",
  "params": {
    "cash": number,
    "monthly_income": number,
    "fixed_expenses": number,
    "flexible_expenses": number,
    "income_delay_months": integer,
    "currency_symbol": string
  },
  "question": null,
  "comment": "короткая сухая строка",
  "assumptions": [
    {
      "text": "самое слабое/оптимистичное утверждение пользователя",
      "risk": "High risk: B2B sales usually take 90+ days",
      "suggested_stress": { "target": "income_delay", "value": 3 }
    }
  ],
  "smart_levers": [
    {
      "title": "Cut the tool stack you admitted is optional",
      "effort": "Low",
      "math_patch": { "burn": -500, "income": 0 }
    },
    {
      "title": "Pre-sell one retained client before hiring",
      "effort": "Medium",
      "math_patch": { "income": 1000, "burn": 0 }
    },
    {
      "title": "Delay launch spend until revenue starts",
      "effort": "High",
      "math_patch": { "capital_shock": -1500, "income_delay_months": -1 }
    }
  ]
}

Правила:
- Always return status = "ready" with final params. Do not return needs_clarification; that status exists only for legacy compatibility outside this prompt.
- Используй BASE_CONTEXT_JSON как доверенную память, если он передан.
- Если в USER_MESSAGE есть явное новое число, оно важнее контекста.
- Calculate derived metrics instead of asking: multiply count * price, sum recurring cost categories, infer monthly amounts when text clearly says per month/monthly, use lower income ranges and upper expense ranges, and choose pessimistic defaults when unavoidable.
- Keep stress values only inside assumptions[*].suggested_stress. Do not put stress values into params.
- Extract how many months the user will wait before their first revenue. Default is 0.
- Do not ask clarification only because income_delay_months is absent; use 0.
- Optionally return assumptions as a top-level array. If no weak optimistic assumptions are visible, return [] or omit the field.
- Critically analyze the user's plan. Find 1-2 weakest assumptions (e.g., fast sales, no unexpected costs) and suggest mathematical stress tests for the simulator levers.
- assumptions must contain 1-2 of the user's weakest optimistic assumptions, especially fast revenue and missing unexpected costs.
- Each assumption must be { "text": string, "risk": string, "suggested_stress": { "target": string, "value": number } }.
- suggested_stress.target must be exactly one of: "income_delay", "capital_shock", "burn_multiplier".
- For optimistic income timing, use suggested_stress.target = "income_delay" and a value like 3 for a 3-month delay.
- For a one-time cash threat, upfront surprise bill, equipment purchase, deposit, fine, medical/legal cost, refund, chargeback, or emergency cost, use suggested_stress.target = "capital_shock" with the one-time amount.
- For recurring burn getting worse, underestimated monthly costs, ads CAC, rent, payroll, subscriptions, or "expenses may be higher", use suggested_stress.target = "burn_multiplier" with a multiplier like 1.2 or 1.5.
- assumptions are parser notes only. Never change params to include the stress; MonteRun math will remain deterministic.
- smart_levers is REQUIRED and must contain exactly 3 concrete rescue actions.
- smart_levers[*] must be { "title": string, "effort": "Low" | "Medium" | "High", "math_patch": object }.
- smart_levers[*].title must be specific to facts in USER_MESSAGE and BASE_CONTEXT_JSON, not generic motivational advice.
- smart_levers[*].math_patch contains numeric deltas only. Allowed keys: cash, income, burn, monthly_income, fixed_expenses, flexible_expenses, income_delay_months, capital_shock, burn_multiplier.
- Prefer the simple patch keys income and burn for monthly income and total monthly burn changes, e.g. { "burn": -500, "income": 0 }. Use fixed_expenses or flexible_expenses only when the user fact clearly points to that category.
- Every math_patch must change at least one math-core input. Do not include impact_months, runway, probability, survival rate, verdict, or any calculated result inside smart_levers. MonteRun code will calculate impact deterministically.
- Bind every lever to parsed facts: if the user is a freelancer, solo founder, student, or employee with no staff/payroll, do not suggest firing staff, cutting payroll, renegotiating team salaries, or other advice that assumes employees. If staff/payroll is not explicitly present, staff-related levers are forbidden.
- Do not invent assets, employees, inventory, loans, clients, or dependents that are not stated or strongly implied by the user context.
- Detect the currency used in the text and return its symbol (e.g., '$', '€', '£', '₸'). If no currency is mentioned, default to '$'.
- LANGUAGE RULE: Определи язык USER_MESSAGE. Ты ОБЯЗАН писать поля comment и question в ТОЧНО ТОМ ЖЕ ЯЗЫКЕ, что и USER_MESSAGE. Если пользователь пишет по-английски, отвечай по-английски. Если по-испански, отвечай по-испански. Всегда сохраняй холодный, циничный, финансово-терминальный тон независимо от языка.
- If a field is not explicit even after BASE_CONTEXT_JSON, prefer a pessimistic, clearly finance-grounded default over clarification.
- Все числа должны быть неотрицательными.
- Если пользователь дал диапазон дохода, бери нижнюю границу.
- Если пользователь дал диапазон расходов, бери верхнюю границу.
- fixed_expenses = обязательные повторяющиеся траты.
- flexible_expenses = discretionary, variable, optional spend.
- Не упоминай старый бренд. Только MonteRun.
- Не добавляй markdown, объяснения, code fences, лишние ключи или текст вне JSON.
""".strip()

ROAST_SYSTEM_PROMPT: Final[str] = """
Ты — MonteRun Roast Layer.
На входе у тебя Original user request, extracted_params и simulation.
Ты не считаешь математику и не меняешь числа. Ты только формулируешь вердикт.

Верни строго JSON-объект:
{
  "verdict": "[INSERT VERDICT IN USER LANGUAGE]",
  "comment": "[INSERT 2-4 SHORT SENTENCES IN USER LANGUAGE]",
  "levers": [
    { "action": "[INSERT LEVER LABEL IN USER LANGUAGE]" },
    { "action": "[INSERT LEVER LABEL IN USER LANGUAGE]" },
    { "action": "[INSERT LEVER LABEL IN USER LANGUAGE]" }
  ]
}

Правила:
- CRITICAL: The output MUST be in the exact same language as the Original user request. Do not default to Russian unless the user wrote in Russian.
- CRITICAL: ALL text properties must be in the user's detected language, including verdict, comment, and the action text inside each lever entry in the levers array. If the user writes in English, reply in English. If Spanish, reply in Spanish. Always maintain the cold, cynical, financial-terminal tone regardless of the language.
- LANGUAGE RULE: Detect the language of the Original user request and apply it to every user-facing text field in the roast output.
- Тон: циничный, высокомерный, techno-trash из Алматы.
- Уместно использовать слова hustle, cooked, runway, ngmi, survival rate.
- Опирайся только на присланные числа и levers.
- Если сценарий плохой, говори жёстко и прямо.
- Если levers слабые, высмеивай это.
- levers[*].action должны сохранять тот же экономический смысл и тот же порядок, что и входные simulation.levers. Разрешено только локализовать формулировку, не менять сам совет.
- Не используй markdown, списки, code fences и лишние поля.
- Не упоминай старый бренд. Только MonteRun.
""".strip()

FIELD_QUESTIONS: Final[dict[str, str]] = {
    "cash": "Сколько у тебя сейчас денег на руках?",
    "monthly_income": "Какой у тебя средний доход в месяц?",
    "fixed_expenses": "Сколько у тебя обязательных фиксированных расходов в месяц?",
    "flexible_expenses": "Сколько у тебя в месяц уходит на гибкие и discretionary траты?",
}

LOGGER = logging.getLogger(__name__)


class ApiProblem(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        retryable: bool = False,
        http_status: int = 400,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details
        self.retryable = retryable
        self.http_status = http_status


def _load_local_env_file() -> None:
    if not ENV_PATH.exists():
        LOGGER.info("Local .env not found at %s; continuing with process environment only", ENV_PATH)
        return

    try:
        env_content = ENV_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        LOGGER.warning("Failed to read local .env at %s: %s", ENV_PATH, exc)
        return

    for line in env_content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        os.environ[key] = value.strip()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _build_meta(request_id: str, started_at: float) -> dict[str, Any]:
    elapsed_ms = round((time.perf_counter() - started_at) * 1000)
    return {
        "schema_version": SCHEMA_VERSION,
        "simulation_time_ms": elapsed_ms,
        "request_id": request_id,
        "generated_at": _utc_now_iso(),
    }


def _build_error(
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details,
        "retryable": retryable,
    }


def _clean_text(value: str) -> str:
    return " ".join(value.split())


def _parse_numeric_string(value: str) -> float:
    normalized = value.strip()
    if not normalized:
        raise ValueError("empty string")

    normalized = re.sub(r"[^\d,.\-]", "", normalized)
    if not normalized:
        raise ValueError("no numeric content")

    if "," in normalized and "." in normalized:
        normalized = normalized.replace(",", "")
    elif "," in normalized:
        integer_part, fractional_part = normalized.rsplit(",", 1)
        if 1 <= len(fractional_part) <= 2:
            normalized = f"{integer_part.replace(',', '')}.{fractional_part}"
        else:
            normalized = normalized.replace(",", "")

    return float(normalized)


def _coerce_non_negative_float(
    name: str,
    value: Any,
    *,
    stage: str,
    maximum: float | None = None,
) -> float:
    if isinstance(value, bool):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid MonteRun inputs",
            {"stage": stage, "field": name, "reason": "boolean_not_allowed"},
            False,
            400,
        )

    try:
        numeric_value = (
            _parse_numeric_string(value)
            if isinstance(value, str)
            else float(value)
        )
    except (TypeError, ValueError) as exc:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid MonteRun inputs",
            {"stage": stage, "field": name, "reason": "non_numeric_value"},
            False,
            400,
        ) from exc

    if not np.isfinite(numeric_value):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid MonteRun inputs",
            {"stage": stage, "field": name, "reason": "non_finite_value"},
            False,
            400,
        )

    if numeric_value < 0.0:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid MonteRun inputs",
            {"stage": stage, "field": name, "reason": "negative_value"},
            False,
            400,
        )

    if maximum is not None and numeric_value > maximum:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid MonteRun inputs",
            {"stage": stage, "field": name, "reason": "above_maximum", "maximum": maximum},
            False,
            400,
        )

    return float(numeric_value)


def _coerce_non_negative_int(
    name: str,
    value: Any,
    *,
    stage: str,
    default: int = 0,
) -> int:
    if value is None:
        return default

    numeric_value = _coerce_non_negative_float(name, value, stage=stage)
    integer_value = int(numeric_value)
    if numeric_value != float(integer_value):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid MonteRun inputs",
            {"stage": stage, "field": name, "reason": "non_integer_value"},
            False,
            400,
        )

    return integer_value


def _normalize_currency_symbol(value: Any) -> str:
    if not isinstance(value, str):
        return DEFAULT_CURRENCY_SYMBOL

    normalized = _clean_text(value)
    if not normalized:
        return DEFAULT_CURRENCY_SYMBOL

    currency_aliases = {
        "$": "$",
        "usd": "$",
        "dollar": "$",
        "dollars": "$",
        "€": "€",
        "eur": "€",
        "euro": "€",
        "euros": "€",
        "£": "£",
        "gbp": "£",
        "pound": "£",
        "pounds": "£",
        "₸": "₸",
        "kzt": "₸",
        "tenge": "₸",
    }
    return currency_aliases.get(normalized.casefold(), normalized)


def _coerce_positive_int(name: str, value: Any) -> int:
    if isinstance(value, bool):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a positive integer",
            {"field": name, "reason": "boolean_not_allowed"},
            False,
            400,
        )

    try:
        coerced = int(value)
    except (TypeError, ValueError) as exc:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a positive integer",
            {"field": name, "reason": "non_integer_value"},
            False,
            400,
        ) from exc

    if coerced < 1:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"{name} must be a positive integer",
            {"field": name, "reason": "below_minimum", "minimum": 1},
            False,
            400,
        )

    return coerced


@lru_cache(maxsize=1)
def _get_deepseek_client() -> Any:
    api_key = os.getenv(DEEPSEEK_API_KEY_ENV, "").strip()
    if not api_key:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "DeepSeek API key is not configured",
            {"env": DEEPSEEK_API_KEY_ENV},
            False,
            500,
        )

    try:
        openai_module = importlib.import_module("openai")
    except ModuleNotFoundError as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Official OpenAI client is not installed",
            {"package": "openai"},
            False,
            500,
        ) from exc

    openai_client = getattr(openai_module, "OpenAI", None)
    if openai_client is None:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Official OpenAI client is unavailable",
            {"package": "openai", "class": "OpenAI"},
            False,
            500,
        )

    try:
        return openai_client(
            api_key=api_key,
            base_url=DEEPSEEK_BASE_URL,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Failed to initialize DeepSeek client",
            {"reason": str(exc)},
            False,
            500,
        ) from exc


def _response_to_mapping(response: Any, *, stage: str) -> dict[str, Any]:
    if hasattr(response, "model_dump"):
        try:
            dumped = response.model_dump(mode="python")
        except TypeError:
            dumped = response.model_dump()
        if isinstance(dumped, Mapping):
            return dict(dumped)

    if isinstance(response, Mapping):
        return dict(response)

    raise ApiProblem(
        "INVALID_PARAMS",
        f"DeepSeek {stage} response was malformed",
        {"stage": stage},
        False,
        400,
    )


def _extract_response_text(response: Any, *, stage: str) -> str:
    response_body = _response_to_mapping(response, stage=stage)
    choices = response_body.get("choices")

    if not isinstance(choices, list) or not choices:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} response was empty",
            {"stage": stage},
            False,
            400,
        )

    first_choice = choices[0]
    if not isinstance(first_choice, Mapping):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} response was malformed",
            {"stage": stage},
            False,
            400,
        )

    message = first_choice.get("message")
    if not isinstance(message, Mapping):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} response was malformed",
            {"stage": stage},
            False,
            400,
        )

    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()

    if isinstance(content, list):
        text_chunks = []
        for item in content:
            if isinstance(item, Mapping):
                text_value = item.get("text")
                if isinstance(text_value, str) and text_value.strip():
                    text_chunks.append(text_value.strip())
        if text_chunks:
            return "\n".join(text_chunks)

    raise ApiProblem(
        "INVALID_PARAMS",
        f"DeepSeek {stage} response was empty",
        {"stage": stage},
        False,
        400,
    )


def _call_deepseek_json(
    *,
    system_prompt: str,
    user_content: str,
    stage: str,
    temperature: float,
) -> dict[str, Any]:
    client = _get_deepseek_client()

    try:
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=temperature,
        )
    except Exception as exc:
        LOGGER.exception("DeepSeek %s request failed", stage)
        raise ApiProblem(
            "INTERNAL_ERROR",
            f"DeepSeek {stage} request failed",
            {"stage": stage},
            True,
            502,
        ) from exc

    content = _extract_response_text(response, stage=stage)

    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid JSON",
            {"stage": stage, "reason": "invalid_json"},
            False,
            400,
        ) from exc

    if not isinstance(payload, Mapping):
        raise ApiProblem(
            "INVALID_PARAMS",
            f"DeepSeek {stage} returned invalid JSON",
            {"stage": stage, "reason": "non_object"},
            False,
            400,
        )

    return dict(payload)


@lru_cache(maxsize=1)
def _load_supabase_sdk():
    site_packages_paths = [path for path in sys.path if "site-packages" in path.lower()]
    spec = PathFinder.find_spec("supabase", site_packages_paths or None)
    if spec is None or spec.loader is None:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "supabase-py is not installed",
            {"package": "supabase"},
            False,
            500,
        )

    module = module_from_spec(spec)
    previous_module = sys.modules.get("supabase")
    sys.modules["supabase"] = module

    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        if previous_module is not None:
            sys.modules["supabase"] = previous_module
        else:
            sys.modules.pop("supabase", None)
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Failed to load supabase-py",
            {"package": "supabase", "reason": str(exc)},
            False,
            500,
        ) from exc

    return module


@lru_cache(maxsize=1)
def _get_supabase_client():
    supabase_url = os.getenv(SUPABASE_URL_ENV, "").strip()
    supabase_service_role_key = os.getenv(SUPABASE_SERVICE_ROLE_KEY_ENV, "").strip()

    if not supabase_url or not supabase_service_role_key:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Supabase is not configured",
            {"env": [SUPABASE_URL_ENV, SUPABASE_SERVICE_ROLE_KEY_ENV]},
            False,
            500,
        )

    supabase_sdk = _load_supabase_sdk()

    try:
        return supabase_sdk.create_client(supabase_url, supabase_service_role_key)
    except Exception as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "Failed to initialize Supabase client",
            {"reason": str(exc)},
            False,
            500,
        ) from exc


def _is_table_missing_error(exc: Exception) -> bool:
    if "PGRST205" in str(exc):
        return True

    response = getattr(exc, "message", None)
    return isinstance(response, Mapping) and response.get("code") == "PGRST205"


def _extract_json_object(value: Any) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None

        try:
            decoded = json.loads(stripped)
        except json.JSONDecodeError:
            return None

        if isinstance(decoded, Mapping):
            return dict(decoded)

    return None


def _merge_json_objects(
    base: Mapping[str, Any] | None,
    updates: Mapping[str, Any] | None,
) -> dict[str, Any]:
    merged: dict[str, Any] = dict(base or {})
    if not updates:
        return merged

    for key, value in updates.items():
        existing_value = merged.get(key)
        if value is None and key in merged:
            continue
        if isinstance(existing_value, Mapping) and isinstance(value, Mapping):
            merged[key] = _merge_json_objects(existing_value, value)
            continue

        merged[key] = value

    return merged


def _extract_first_text(row: Mapping[str, Any], fields: tuple[str, ...]) -> str | None:
    for field in fields:
        value = row.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def _extract_last_bot_question(row: Mapping[str, Any] | None) -> str | None:
    if row is None:
        return None

    direct_question = row.get(LAST_BOT_QUESTION_KEY)
    if isinstance(direct_question, str) and direct_question.strip():
        return direct_question.strip()

    metadata = _extract_json_object(row.get("metadata"))
    if metadata is not None:
        for key in PARSER_CONTEXT_LAST_BOT_QUESTION_FIELDS:
            metadata_question = metadata.get(key)
            if isinstance(metadata_question, str) and metadata_question.strip():
                return metadata_question.strip()

        for nested_key in ("parser", "context"):
            nested_metadata = metadata.get(nested_key)
            if not isinstance(nested_metadata, Mapping):
                continue

            for key in PARSER_CONTEXT_LAST_BOT_QUESTION_FIELDS:
                nested_question = nested_metadata.get(key)
                if isinstance(nested_question, str) and nested_question.strip():
                    return nested_question.strip()

    simulation_summary = _extract_json_object(row.get("simulation_summary"))
    if simulation_summary is not None:
        for key in PARSER_CONTEXT_LAST_BOT_QUESTION_FIELDS:
            summary_question = simulation_summary.get(key)
            if isinstance(summary_question, str) and summary_question.strip():
                return summary_question.strip()

    return None


def _fetch_optional_supabase_row(table: str, *, telegram_user_id: int) -> dict[str, Any] | None:
    try:
        response = (
            _get_supabase_client()
            .table(table)
            .select("*")
            .eq("telegram_user_id", telegram_user_id)
            .limit(1)
            .execute()
        )
    except ApiProblem:
        raise
    except Exception as exc:
        if _is_table_missing_error(exc):
            LOGGER.warning("Supabase table %s is missing; skipping Telegram state integration", table)
            return None

        LOGGER.warning("Supabase lookup failed for %s: %s", table, exc)
        return None

    rows = response.data or []
    if not rows:
        return None

    first_row = rows[0]
    return dict(first_row) if isinstance(first_row, Mapping) else None


def _build_parser_context_payload(
    telegram_context_row: Mapping[str, Any] | None,
    scenario_state_row: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    payload: dict[str, Any] = {}

    if telegram_context_row is not None:
        context_text = _extract_first_text(
            telegram_context_row,
            ("context_text", "context_summary", "summary", "context", "notes", "parser_context"),
        )
        base_params = _extract_json_object(telegram_context_row.get("base_params"))
        last_bot_question = _extract_last_bot_question(telegram_context_row)

        if context_text:
            payload["telegram_context"] = context_text
        if base_params:
            payload["base_params"] = base_params
        if last_bot_question:
            payload["last_bot_question"] = last_bot_question

    if scenario_state_row is not None:
        previous_params = _extract_json_object(scenario_state_row.get("params"))
        previous_source_text = _extract_first_text(scenario_state_row, ("source_text", "message_text", "user_text"))
        if "last_bot_question" not in payload:
            last_bot_question = _extract_last_bot_question(scenario_state_row)
            if last_bot_question:
                payload["last_bot_question"] = last_bot_question

        if previous_params:
            payload["previous_scenario"] = previous_params
        if previous_source_text:
            payload["previous_user_message"] = previous_source_text

    return payload or None


def _build_parser_input(user_text: str, parser_context_payload: Mapping[str, Any] | None) -> str:
    if not parser_context_payload:
        return user_text

    context_json = json.dumps(parser_context_payload, ensure_ascii=False, separators=(",", ":"))
    last_bot_question = _extract_last_bot_question(parser_context_payload)
    last_bot_question_block = f"{LAST_BOT_QUESTION_PREFIX}{last_bot_question}\n" if last_bot_question else ""
    return (
        f"{PARSER_INPUT_PREFIX}{context_json}\n"
        f"{last_bot_question_block}"
        "Use BASE_CONTEXT_JSON as trusted prior memory. "
        "If there is LAST_BOT_QUESTION, use it to interpret short follow-up answers. "
        "If USER_MESSAGE explicitly overrides a field, the new explicit value wins.\n"
        f"{PARSER_INPUT_USER_MESSAGE_PREFIX}{user_text}"
    )


def _extract_base_params_snapshot(parser_context_payload: Mapping[str, Any] | str | None) -> dict[str, Any] | None:
    if not parser_context_payload:
        return None

    if isinstance(parser_context_payload, str):
        return _extract_context_params(parser_context_payload)

    base_params = _extract_json_object(parser_context_payload.get("base_params"))
    if base_params:
        snapshot = {
            field: base_params[field]
            for field in MONTE_RUN_PARAM_FIELDS
            if base_params.get(field) is not None
        }
        if base_params.get(INCOME_DELAY_MONTHS_FIELD) is not None:
            snapshot[INCOME_DELAY_MONTHS_FIELD] = base_params[INCOME_DELAY_MONTHS_FIELD]
        for field in MONTE_RUN_OPTIONAL_PARAM_FIELDS:
            if base_params.get(field) is not None:
                snapshot[field] = base_params[field]
        if base_params.get(CURRENCY_SYMBOL_FIELD) is not None:
            snapshot[CURRENCY_SYMBOL_FIELD] = base_params[CURRENCY_SYMBOL_FIELD]
        return snapshot

    previous_scenario = _extract_json_object(parser_context_payload.get("previous_scenario"))
    if previous_scenario:
        snapshot = {
            field: previous_scenario[field]
            for field in MONTE_RUN_PARAM_FIELDS
            if previous_scenario.get(field) is not None
        }
        if previous_scenario.get(INCOME_DELAY_MONTHS_FIELD) is not None:
            snapshot[INCOME_DELAY_MONTHS_FIELD] = previous_scenario[INCOME_DELAY_MONTHS_FIELD]
        for field in MONTE_RUN_OPTIONAL_PARAM_FIELDS:
            if previous_scenario.get(field) is not None:
                snapshot[field] = previous_scenario[field]
        if previous_scenario.get(CURRENCY_SYMBOL_FIELD) is not None:
            snapshot[CURRENCY_SYMBOL_FIELD] = previous_scenario[CURRENCY_SYMBOL_FIELD]
        return snapshot

    return None


def _resolve_profile_id(
    telegram_user_id: int,
    telegram_context_row: Mapping[str, Any] | None,
    scenario_state_row: Mapping[str, Any] | None,
) -> str | None:
    for row in (scenario_state_row, telegram_context_row):
        if row is None:
            continue

        profile_id = row.get("profile_id")
        if isinstance(profile_id, str) and profile_id.strip():
            return profile_id.strip()

    try:
        response = (
            _get_supabase_client()
            .table("profiles")
            .select("id")
            .eq("telegram_user_id", telegram_user_id)
            .limit(1)
            .execute()
        )
    except ApiProblem:
        raise
    except Exception as exc:
        if _is_table_missing_error(exc):
            LOGGER.warning("Supabase table profiles is missing; scenario_state will be stored without profile_id")
            return None

        LOGGER.warning("Failed to resolve profile_id for Telegram user %s: %s", telegram_user_id, exc)
        return None

    rows = response.data or []
    if not rows or not isinstance(rows[0], Mapping):
        return None

    profile_id = rows[0].get("id")
    return profile_id.strip() if isinstance(profile_id, str) and profile_id.strip() else None


def _load_telegram_parser_context(
    telegram_user_id: int | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    if telegram_user_id is None:
        return None, None, None

    try:
        telegram_context_row = _fetch_optional_supabase_row(TELEGRAM_CONTEXT_TABLE, telegram_user_id=telegram_user_id)
        scenario_state_row = _fetch_optional_supabase_row(SCENARIO_STATE_TABLE, telegram_user_id=telegram_user_id)
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed; continuing without Telegram context: %s", exc.message)
        return None, None, None

    parser_context_payload = _build_parser_context_payload(telegram_context_row, scenario_state_row)
    return parser_context_payload, telegram_context_row, scenario_state_row


def _persist_scenario_state(
    *,
    telegram_user_id: int | None,
    request_id: str,
    source_text: str,
    params: Mapping[str, Any],
    simulation_data: Mapping[str, Any],
    telegram_context_row: Mapping[str, Any] | None,
    scenario_state_row: Mapping[str, Any] | None,
    comment: str | None = None,
    verdict: str | None = None,
) -> None:
    if telegram_user_id is None:
        return

    simulation_summary: dict[str, Any] = {
        "status": "ready",
        "base_runway_months": simulation_data.get("base_runway_months"),
        "survival_probability_12m": simulation_data.get("survival_probability_12m"),
        "levers": simulation_data.get("levers"),
    }
    if isinstance(simulation_data.get("smart_levers"), list):
        simulation_summary["smart_levers"] = simulation_data.get("smart_levers")
    if comment:
        simulation_summary["comment"] = comment
    if verdict:
        simulation_summary["verdict"] = verdict

    try:
        profile_id = _resolve_profile_id(telegram_user_id, telegram_context_row, scenario_state_row)
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed during scenario_state save: %s", exc.message)
        profile_id = None

    payload: dict[str, Any] = {
        "telegram_user_id": telegram_user_id,
        "latest_request_id": request_id,
        "source_text": source_text,
        "params": dict(params),
        "simulation_summary": simulation_summary,
    }

    if profile_id is not None:
        payload["profile_id"] = profile_id

    try:
        _get_supabase_client().table(SCENARIO_STATE_TABLE).upsert(payload, on_conflict="telegram_user_id").execute()
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed during scenario_state upsert: %s", exc.message)
    except Exception as exc:
        if _is_table_missing_error(exc):
            LOGGER.warning("Supabase table %s is missing; scenario_state was not persisted", SCENARIO_STATE_TABLE)
            return

        LOGGER.warning("Failed to upsert scenario_state for Telegram user %s: %s", telegram_user_id, exc)


def _persist_last_bot_question(
    *,
    telegram_user_id: int | None,
    request_id: str,
    source_text: str,
    question: str | None,
    telegram_context_row: Mapping[str, Any] | None,
    scenario_state_row: Mapping[str, Any] | None,
) -> None:
    if telegram_user_id is None or not isinstance(question, str):
        return

    question_text = question.strip()
    if not question_text:
        return

    existing_context_row = telegram_context_row
    if existing_context_row is None:
        try:
            existing_context_row = _fetch_optional_supabase_row(TELEGRAM_CONTEXT_TABLE, telegram_user_id=telegram_user_id)
        except ApiProblem as exc:
            LOGGER.warning("Supabase initialization failed while loading telegram_context for last_bot_question merge: %s", exc.message)
            existing_context_row = None

    if existing_context_row is not None:
        metadata = _extract_json_object(existing_context_row.get("metadata"))
        merged_metadata = _merge_json_objects(metadata, {LAST_BOT_QUESTION_METADATA_KEY: question_text})

        payload: dict[str, Any] = {
            "telegram_user_id": telegram_user_id,
            "metadata": merged_metadata,
        }

        try:
            profile_id = _resolve_profile_id(telegram_user_id, existing_context_row, scenario_state_row)
        except ApiProblem as exc:
            LOGGER.warning("Supabase initialization failed during telegram_context metadata save: %s", exc.message)
            profile_id = None

        if profile_id is not None:
            payload["profile_id"] = profile_id

        context_text = existing_context_row.get("context_text")
        if isinstance(context_text, str) and context_text.strip():
            payload["context_text"] = context_text

        base_params = _extract_json_object(existing_context_row.get("base_params"))
        if base_params:
            payload["base_params"] = base_params

        try:
            _get_supabase_client().table(TELEGRAM_CONTEXT_TABLE).upsert(payload, on_conflict="telegram_user_id").execute()
            return
        except ApiProblem as exc:
            LOGGER.warning("Supabase initialization failed during telegram_context metadata upsert: %s", exc.message)
        except Exception as exc:
            if not _is_table_missing_error(exc):
                LOGGER.warning("Failed to upsert telegram_context metadata for Telegram user %s: %s", telegram_user_id, exc)

    existing_state_row = scenario_state_row
    try:
        fresh_state_row = _fetch_optional_supabase_row(SCENARIO_STATE_TABLE, telegram_user_id=telegram_user_id)
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed while loading scenario_state for last_bot_question fallback: %s", exc.message)
        fresh_state_row = None

    if fresh_state_row is not None:
        existing_state_row = fresh_state_row

    previous_params = _extract_json_object(existing_state_row.get("params")) if existing_state_row is not None else None
    previous_summary = _extract_json_object(existing_state_row.get("simulation_summary")) if existing_state_row is not None else None
    simulation_summary = _merge_json_objects(previous_summary, {LAST_BOT_QUESTION_KEY: question_text})

    try:
        profile_id = _resolve_profile_id(telegram_user_id, telegram_context_row, existing_state_row)
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed during scenario_state last_bot_question fallback save: %s", exc.message)
        profile_id = None

    payload = {
        "telegram_user_id": telegram_user_id,
        "latest_request_id": request_id,
        "source_text": source_text,
        "params": dict(previous_params or {}),
        "simulation_summary": simulation_summary,
    }

    if profile_id is not None:
        payload["profile_id"] = profile_id

    try:
        _get_supabase_client().table(SCENARIO_STATE_TABLE).upsert(payload, on_conflict="telegram_user_id").execute()
    except ApiProblem as exc:
        LOGGER.warning("Supabase initialization failed during scenario_state last_bot_question upsert: %s", exc.message)
    except Exception as exc:
        if _is_table_missing_error(exc):
            LOGGER.warning("Supabase tables for last_bot_question persistence are missing; skipping save")
            return

        LOGGER.warning("Failed to persist last_bot_question for Telegram user %s: %s", telegram_user_id, exc)


def _extract_context_params(parser_input: str) -> dict[str, Any] | None:
    marker = PARSER_INPUT_PREFIX
    if not parser_input.startswith(marker):
        return None

    context_line = parser_input[len(marker) :].split("\n", 1)[0].strip()
    if not context_line:
        return None

    try:
        context_payload = json.loads(context_line)
    except json.JSONDecodeError:
        return None

    if not isinstance(context_payload, Mapping):
        return None

    params: dict[str, Any] = {}
    for context_key in ("base_params", "previous_scenario"):
        candidate = context_payload.get(context_key)
        if not isinstance(candidate, Mapping):
            continue

        for field in MONTE_RUN_PARAM_FIELDS:
            value = candidate.get(field)
            if value is not None:
                params[field] = value

        income_delay_months = candidate.get(INCOME_DELAY_MONTHS_FIELD)
        if income_delay_months is not None:
            params[INCOME_DELAY_MONTHS_FIELD] = income_delay_months

        for field in MONTE_RUN_OPTIONAL_PARAM_FIELDS:
            value = candidate.get(field)
            if value is not None:
                params[field] = value

        currency_symbol = candidate.get(CURRENCY_SYMBOL_FIELD)
        if currency_symbol is not None:
            params[CURRENCY_SYMBOL_FIELD] = currency_symbol

    return params or None


def _merge_extracted_params(
    raw_params: Any,
    fallback_params: Mapping[str, Any] | None,
) -> dict[str, Any]:
    merged: dict[str, Any] = dict(fallback_params or {})

    if isinstance(raw_params, Mapping):
        for field in MONTE_RUN_PARAM_FIELDS:
            value = raw_params.get(field)
            if value is not None:
                merged[field] = value

        income_delay_months = raw_params.get(INCOME_DELAY_MONTHS_FIELD)
        if income_delay_months is not None:
            merged[INCOME_DELAY_MONTHS_FIELD] = income_delay_months

        for field in MONTE_RUN_OPTIONAL_PARAM_FIELDS:
            value = raw_params.get(field)
            if value is not None:
                merged[field] = value

        currency_symbol = raw_params.get(CURRENCY_SYMBOL_FIELD)
        if currency_symbol is not None:
            merged[CURRENCY_SYMBOL_FIELD] = currency_symbol

    return merged


def _missing_param_fields(value: Mapping[str, Any]) -> list[str]:
    return [field for field in MONTE_RUN_PARAM_FIELDS if value.get(field) is None]


def _extract_optional_non_negative_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        numeric_value = _parse_numeric_string(value) if isinstance(value, str) else float(value)
    except (TypeError, ValueError):
        return None

    if not np.isfinite(numeric_value) or numeric_value < 0.0:
        return None

    return float(numeric_value)


def _apply_pessimistic_param_defaults(value: Mapping[str, Any]) -> dict[str, Any]:
    filled: dict[str, Any] = dict(value)

    if filled.get("cash") is None:
        filled["cash"] = 0.0
    if filled.get("monthly_income") is None:
        filled["monthly_income"] = 0.0

    fixed_missing = filled.get("fixed_expenses") is None
    flexible_missing = filled.get("flexible_expenses") is None

    if fixed_missing and flexible_missing:
        cash = _extract_optional_non_negative_float(filled.get("cash")) or 0.0
        monthly_income = _extract_optional_non_negative_float(filled.get("monthly_income")) or 0.0
        filled["fixed_expenses"] = max(monthly_income, cash / LEGACY_SIMULATION_MONTHS, 1.0)
        filled["flexible_expenses"] = 0.0
    else:
        if fixed_missing:
            filled["fixed_expenses"] = 0.0
        if flexible_missing:
            filled["flexible_expenses"] = 0.0

    return filled


def _build_clarification_question(missing_fields: list[str]) -> str:
    if not missing_fields:
        return "Что у тебя сейчас по cash, income и расходам?"

    return FIELD_QUESTIONS[missing_fields[0]]


def _normalize_assumptions(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    assumptions: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, Mapping):
            continue

        text = item.get("text")
        risk = item.get("risk")
        suggested_stress = item.get("suggested_stress")
        if (
            not isinstance(text, str)
            or not text.strip()
            or not isinstance(risk, str)
            or not risk.strip()
            or not isinstance(suggested_stress, Mapping)
        ):
            continue

        target = suggested_stress.get("target")
        if not isinstance(target, str) or not target.strip():
            continue
        normalized_target = _clean_text(target)
        if normalized_target not in SUGGESTED_STRESS_TARGETS:
            continue

        try:
            stress_value = (
                _parse_numeric_string(suggested_stress["value"])
                if isinstance(suggested_stress.get("value"), str)
                else float(suggested_stress["value"])
            )
        except (KeyError, TypeError, ValueError):
            continue

        if not np.isfinite(stress_value) or stress_value < 0.0:
            continue
        if normalized_target == BURN_MULTIPLIER_FIELD and stress_value < 1.0:
            continue

        assumptions.append(
            {
                "text": _clean_text(text),
                "risk": _clean_text(risk),
                "suggested_stress": {
                    "target": normalized_target,
                    "value": stress_value,
                },
            }
        )
        if len(assumptions) == 2:
            break

    return assumptions


def _parse_patch_number(value: Any) -> float:
    if isinstance(value, bool):
        raise TypeError("boolean_not_allowed")

    numeric_value = _parse_numeric_string(value) if isinstance(value, str) else float(value)
    if not np.isfinite(numeric_value):
        raise ValueError("non_finite_value")

    return float(numeric_value)


def _normalize_smart_levers(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) != 3:
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek extraction returned invalid smart_levers",
            {
                "stage": "extraction",
                "field": "smart_levers",
                "expected_count": 3,
                "actual_count": len(value) if isinstance(value, list) else None,
            },
            False,
            400,
        )

    smart_levers: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise ApiProblem(
                "INVALID_PARAMS",
                "DeepSeek extraction returned invalid smart_lever",
                {"stage": "extraction", "field": f"smart_levers[{index}]"},
                False,
                400,
            )

        title = item.get("title")
        effort = item.get("effort")
        math_patch = item.get("math_patch")
        if not isinstance(title, str) or not title.strip():
            raise ApiProblem(
                "INVALID_PARAMS",
                "DeepSeek extraction returned invalid smart_lever title",
                {"stage": "extraction", "field": f"smart_levers[{index}].title"},
                False,
                400,
            )
        if effort not in SMART_LEVER_EFFORTS:
            raise ApiProblem(
                "INVALID_PARAMS",
                "DeepSeek extraction returned invalid smart_lever effort",
                {"stage": "extraction", "field": f"smart_levers[{index}].effort"},
                False,
                400,
            )
        if not isinstance(math_patch, Mapping):
            raise ApiProblem(
                "INVALID_PARAMS",
                "DeepSeek extraction returned invalid smart_lever math_patch",
                {"stage": "extraction", "field": f"smart_levers[{index}].math_patch"},
                False,
                400,
            )

        normalized_patch: dict[str, float] = {}
        for key, raw_value in math_patch.items():
            if not isinstance(key, str):
                continue

            normalized_key = _clean_text(key)
            if normalized_key not in SMART_LEVER_PATCH_FIELDS:
                continue

            try:
                normalized_patch[normalized_key] = _parse_patch_number(raw_value)
            except (TypeError, ValueError):
                raise ApiProblem(
                    "INVALID_PARAMS",
                    "DeepSeek extraction returned invalid smart_lever math_patch value",
                    {"stage": "extraction", "field": f"smart_levers[{index}].math_patch.{normalized_key}"},
                    False,
                    400,
                ) from None

        if not normalized_patch or all(value == 0.0 for value in normalized_patch.values()):
            raise ApiProblem(
                "INVALID_PARAMS",
                "DeepSeek extraction returned inert smart_lever math_patch",
                {"stage": "extraction", "field": f"smart_levers[{index}].math_patch"},
                False,
                400,
            )

        smart_levers.append(
            {
                "title": _clean_text(title),
                "effort": effort,
                "math_patch": normalized_patch,
            }
        )

    return smart_levers


def _normalize_extraction_payload(
    payload: dict[str, Any],
    fallback_params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    status = payload.get("status")
    if status not in {"ready", "needs_clarification"}:
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek extraction returned invalid JSON",
            {"stage": "extraction", "field": "status"},
            False,
            400,
        )

    comment = payload.get("comment")
    if not isinstance(comment, str) or not comment.strip():
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek extraction returned invalid JSON",
            {"stage": "extraction", "field": "comment"},
            False,
            400,
        )
    cleaned_comment = _clean_text(comment)

    raw_params = payload.get("params")
    merged_params = _merge_extracted_params(raw_params, fallback_params)
    currency_symbol = _normalize_currency_symbol(merged_params.get(CURRENCY_SYMBOL_FIELD))
    missing_fields = _missing_param_fields(merged_params)
    assumptions = _normalize_assumptions(payload.get("assumptions"))
    smart_levers = _normalize_smart_levers(payload.get("smart_levers"))

    if missing_fields:
        LOGGER.info("DeepSeek extraction omitted fields; applying pessimistic defaults: %s", missing_fields)
        merged_params = _apply_pessimistic_param_defaults(merged_params)

    normalized_params = {
        field: _coerce_non_negative_float(field, merged_params[field], stage="extraction")
        for field in MONTE_RUN_PARAM_FIELDS
    }
    normalized_params[INCOME_DELAY_MONTHS_FIELD] = _coerce_non_negative_int(
        INCOME_DELAY_MONTHS_FIELD,
        merged_params.get(INCOME_DELAY_MONTHS_FIELD),
        stage="extraction",
        default=0,
    )
    normalized_params[CAPITAL_SHOCK_FIELD] = _coerce_non_negative_float(
        CAPITAL_SHOCK_FIELD,
        merged_params.get(CAPITAL_SHOCK_FIELD, 0.0),
        stage="extraction",
    )
    normalized_params[BURN_MULTIPLIER_FIELD] = _coerce_non_negative_float(
        BURN_MULTIPLIER_FIELD,
        merged_params.get(BURN_MULTIPLIER_FIELD, 1.0),
        stage="extraction",
    )
    normalized_params[CURRENCY_SYMBOL_FIELD] = currency_symbol
    result = {
        "status": "ready",
        "params": normalized_params,
        "question": None,
        "comment": cleaned_comment,
    }
    if assumptions:
        result["assumptions"] = assumptions
    result["smart_levers"] = smart_levers
    return result


def _call_extraction_stage(parser_input: str) -> dict[str, Any]:
    raw_payload = _call_deepseek_json(
        system_prompt=EXTRACTION_SYSTEM_PROMPT,
        user_content=parser_input,
        stage="extraction",
        temperature=0.1,
    )
    return _normalize_extraction_payload(raw_payload, _extract_context_params(parser_input))


@lru_cache(maxsize=1)
def _get_math_core():
    project_root = os.fspath(PROJECT_ROOT)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    try:
        from engine.monte_carlo import MonteRunParams, compute_metrics, run_simulation, simulate
    except Exception as exc:
        raise ApiProblem(
            "INTERNAL_ERROR",
            "MonteRun math core is unavailable",
            {"reason": str(exc)},
            False,
            500,
        ) from exc

    return MonteRunParams, run_simulation, simulate, compute_metrics


def _serialize_monte_run_params(
    params: Any,
    currency_symbol: Any = DEFAULT_CURRENCY_SYMBOL,
) -> dict[str, Any]:
    cash = float(params.cash)
    monthly_income = float(params.monthly_income)
    fixed_expenses = float(params.fixed_expenses)
    flexible_expenses = float(params.flexible_expenses)
    monthly_burn = fixed_expenses + flexible_expenses

    def _legacy_int_attr(name: str, default: int) -> int:
        value = getattr(params, name, None)
        if value is None or isinstance(value, bool):
            return default

        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _legacy_float_attr(name: str, default: float) -> float:
        value = getattr(params, name, None)
        if value is None or isinstance(value, bool):
            return default

        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    return {
        "cash": cash,
        "monthly_income": monthly_income,
        "fixed_expenses": fixed_expenses,
        "flexible_expenses": flexible_expenses,
        "initial_capital": cash,
        "monthly_burn": monthly_burn,
        "months": _legacy_int_attr("months", LEGACY_SIMULATION_MONTHS),
        "n_simulations": _legacy_int_attr("n_simulations", LEGACY_SIMULATION_PATHS),
        "income_delay_months": _legacy_int_attr("income_delay_months", 0),
        CAPITAL_SHOCK_FIELD: _legacy_float_attr(CAPITAL_SHOCK_FIELD, 0.0),
        BURN_MULTIPLIER_FIELD: _legacy_float_attr(BURN_MULTIPLIER_FIELD, 1.0),
        CURRENCY_SYMBOL_FIELD: _normalize_currency_symbol(currency_symbol),
    }


def _build_monte_run_params(raw_params: Mapping[str, Any]) -> Any:
    missing_fields = _missing_param_fields(raw_params)
    if missing_fields:
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek returned incomplete MonteRun inputs",
            {"missing_fields": missing_fields},
            False,
            400,
        )

    MonteRunParams, _, _, _ = _get_math_core()
    return MonteRunParams(
        cash=_coerce_non_negative_float("cash", raw_params.get("cash"), stage="extraction"),
        monthly_income=_coerce_non_negative_float("monthly_income", raw_params.get("monthly_income"), stage="extraction"),
        fixed_expenses=_coerce_non_negative_float("fixed_expenses", raw_params.get("fixed_expenses"), stage="extraction"),
        flexible_expenses=_coerce_non_negative_float("flexible_expenses", raw_params.get("flexible_expenses"), stage="extraction"),
        income_delay_months=_coerce_non_negative_int(
            INCOME_DELAY_MONTHS_FIELD,
            raw_params.get(INCOME_DELAY_MONTHS_FIELD),
            stage="extraction",
            default=0,
        ),
        capital_shock=_coerce_non_negative_float(
            CAPITAL_SHOCK_FIELD,
            raw_params.get(CAPITAL_SHOCK_FIELD, 0.0),
            stage="extraction",
        ),
        burn_multiplier=_coerce_non_negative_float(
            BURN_MULTIPLIER_FIELD,
            raw_params.get(BURN_MULTIPLIER_FIELD, 1.0),
            stage="extraction",
        ),
    )


def _normalize_simulation_result(raw_result: Any) -> dict[str, Any]:
    if not isinstance(raw_result, Mapping):
        raise ApiProblem(
            "INVALID_PARAMS",
            "MonteRun math core returned an invalid response",
            {"stage": "simulation", "reason": "non_object_result"},
            False,
            400,
        )

    raw_levers = raw_result.get("levers")
    if not isinstance(raw_levers, list) or len(raw_levers) != 3:
        raise ApiProblem(
            "INVALID_PARAMS",
            "MonteRun math core returned an invalid levers payload",
            {
                "stage": "simulation",
                "reason": "invalid_levers",
                "expected_count": 3,
                "actual_count": len(raw_levers) if isinstance(raw_levers, list) else None,
            },
            False,
            400,
        )

    normalized_levers: list[dict[str, Any]] = []
    for index, lever in enumerate(raw_levers):
        if not isinstance(lever, Mapping):
            raise ApiProblem(
                "INVALID_PARAMS",
                "MonteRun math core returned an invalid lever",
                {"stage": "simulation", "index": index, "reason": "non_object_lever"},
                False,
                400,
            )

        action = lever.get("action")
        if not isinstance(action, str) or not action.strip():
            raise ApiProblem(
                "INVALID_PARAMS",
                "MonteRun math core returned an invalid lever action",
                {"stage": "simulation", "index": index},
                False,
                400,
            )

        normalized_lever = {
            "action": action.strip(),
            "impact_months": _coerce_non_negative_float(
                f"levers[{index}].impact_months",
                lever.get("impact_months"),
                stage="simulation",
            ),
        }
        title = lever.get("title")
        effort = lever.get("effort")
        math_patch = lever.get("math_patch")
        if isinstance(title, str) and title.strip():
            normalized_lever["title"] = _clean_text(title)
        if effort in SMART_LEVER_EFFORTS:
            normalized_lever["effort"] = effort
        if isinstance(math_patch, Mapping):
            normalized_lever["math_patch"] = {
                str(key): value
                for key, value in math_patch.items()
                if isinstance(key, str) and key in SMART_LEVER_PATCH_FIELDS
            }

        normalized_levers.append(normalized_lever)

    normalized_levers.sort(key=lambda item: (-float(item["impact_months"]), str(item["action"])))

    result = {
        "base_runway_months": _coerce_non_negative_float(
            "base_runway_months",
            raw_result.get("base_runway_months"),
            stage="simulation",
        ),
        "survival_probability_12m": _coerce_non_negative_float(
            "survival_probability_12m",
            raw_result.get("survival_probability_12m"),
            stage="simulation",
            maximum=100.0,
        ),
        "levers": normalized_levers,
    }

    for field in ("months", "p10", "p50", "p90", "spaghetti_sample", "n_simulations", "survival_probability"):
        if field in raw_result:
            result[field] = raw_result[field]
    if isinstance(raw_result.get("smart_levers"), list):
        result["smart_levers"] = raw_result["smart_levers"]

    return result


def _run_math_core(params: Any) -> dict[str, Any]:
    _, run_simulation, simulate, compute_metrics = _get_math_core()

    try:
        raw_result = run_simulation(params)
        paths = simulate(
            initial_capital=params.cash,
            monthly_income=params.monthly_income,
            monthly_burn=params.fixed_expenses + params.flexible_expenses,
            months=LEGACY_SIMULATION_MONTHS,
            n_simulations=LEGACY_SIMULATION_PATHS,
            income_delay_months=getattr(params, INCOME_DELAY_MONTHS_FIELD, 0),
            capital_shock=getattr(params, CAPITAL_SHOCK_FIELD, 0.0),
            burn_multiplier=getattr(params, BURN_MULTIPLIER_FIELD, 1.0),
        )
        chart_data = compute_metrics(paths)
        raw_result.update(chart_data)
    except Exception as exc:
        LOGGER.exception("MonteRun simulation failed")
        raise ApiProblem(
            "INVALID_PARAMS",
            "MonteRun simulation failed",
            {"stage": "simulation"},
            False,
            400,
        ) from exc

    return _normalize_simulation_result(raw_result)


def _patched_float(value: float, delta: float) -> float:
    return max(float(value) + float(delta), 0.0)


def _apply_burn_delta(
    *,
    fixed_expenses: float,
    flexible_expenses: float,
    burn_delta: float,
) -> tuple[float, float]:
    if burn_delta >= 0.0:
        return fixed_expenses, flexible_expenses + burn_delta

    remaining_cut = abs(burn_delta)
    flexible_cut = min(flexible_expenses, remaining_cut)
    flexible_expenses -= flexible_cut
    remaining_cut -= flexible_cut
    fixed_expenses = max(fixed_expenses - remaining_cut, 0.0)
    return fixed_expenses, flexible_expenses


def _apply_math_patch_to_params(params: Any, math_patch: Mapping[str, Any]) -> Any:
    MonteRunParams, _, _, _ = _get_math_core()

    cash = _patched_float(float(params.cash), float(math_patch.get("cash", 0.0)))
    monthly_income = _patched_float(
        float(params.monthly_income),
        float(math_patch.get("monthly_income", 0.0)) + float(math_patch.get("income", 0.0)),
    )
    fixed_expenses = _patched_float(float(params.fixed_expenses), float(math_patch.get("fixed_expenses", 0.0)))
    flexible_expenses = _patched_float(float(params.flexible_expenses), float(math_patch.get("flexible_expenses", 0.0)))

    if "burn" in math_patch:
        fixed_expenses, flexible_expenses = _apply_burn_delta(
            fixed_expenses=fixed_expenses,
            flexible_expenses=flexible_expenses,
            burn_delta=float(math_patch["burn"]),
        )

    income_delay_months = max(
        int(getattr(params, INCOME_DELAY_MONTHS_FIELD, 0)) + int(float(math_patch.get(INCOME_DELAY_MONTHS_FIELD, 0.0))),
        0,
    )
    capital_shock = _patched_float(
        float(getattr(params, CAPITAL_SHOCK_FIELD, 0.0)),
        float(math_patch.get(CAPITAL_SHOCK_FIELD, 0.0)),
    )
    burn_multiplier = _patched_float(
        float(getattr(params, BURN_MULTIPLIER_FIELD, 1.0)),
        float(math_patch.get(BURN_MULTIPLIER_FIELD, 0.0)),
    )

    return MonteRunParams(
        cash=cash,
        monthly_income=monthly_income,
        fixed_expenses=fixed_expenses,
        flexible_expenses=flexible_expenses,
        income_delay_months=income_delay_months,
        capital_shock=capital_shock,
        burn_multiplier=burn_multiplier,
    )


def _build_smart_lever_results(
    *,
    params: Any,
    base_runway_months: float,
    smart_levers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for lever in smart_levers:
        patched_params = _apply_math_patch_to_params(params, lever["math_patch"])
        patched_result = _run_math_core(patched_params)
        impact_months = max(
            float(patched_result["base_runway_months"]) - float(base_runway_months),
            0.0,
        )
        results.append(
            {
                "action": lever["title"],
                "title": lever["title"],
                "effort": lever["effort"],
                "math_patch": dict(lever["math_patch"]),
                "impact_months": impact_months,
            }
        )

    results.sort(key=lambda item: (-float(item["impact_months"]), str(item["title"])))
    return results


def _apply_smart_levers_to_simulation(
    *,
    params: Any,
    simulation_result: Mapping[str, Any],
    smart_levers: list[dict[str, Any]],
) -> dict[str, Any]:
    normalized_result = _normalize_simulation_result(simulation_result)
    smart_lever_results = _build_smart_lever_results(
        params=params,
        base_runway_months=float(normalized_result["base_runway_months"]),
        smart_levers=smart_levers,
    )
    normalized_result["levers"] = smart_lever_results
    normalized_result["smart_levers"] = [
        {
            "title": lever["title"],
            "effort": lever["effort"],
            "math_patch": dict(lever["math_patch"]),
        }
        for lever in smart_lever_results
    ]
    return normalized_result


def _normalize_roast_payload(payload: dict[str, Any]) -> dict[str, Any]:
    verdict = payload.get("verdict")
    comment = payload.get("comment")
    lever_actions = payload.get("lever_actions")
    levers = payload.get("levers")

    if not isinstance(verdict, str) or not verdict.strip():
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek roast returned invalid JSON",
            {"stage": "roast", "field": "verdict"},
            False,
            400,
        )

    if not isinstance(comment, str) or not comment.strip():
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek roast returned invalid JSON",
            {"stage": "roast", "field": "comment"},
            False,
            400,
        )

    cleaned_verdict = _clean_text(verdict)
    cleaned_comment = _clean_text(comment)
    cleaned_lever_actions: list[str] = []

    if isinstance(levers, list) and len(levers) == 3:
        for index, lever in enumerate(levers):
            if not isinstance(lever, Mapping):
                raise ApiProblem(
                    "INVALID_PARAMS",
                    "DeepSeek roast returned invalid JSON",
                    {"stage": "roast", "field": f"levers[{index}]"},
                    False,
                    400,
                )

            action = lever.get("action")
            if not isinstance(action, str) or not action.strip():
                raise ApiProblem(
                    "INVALID_PARAMS",
                    "DeepSeek roast returned invalid JSON",
                    {"stage": "roast", "field": f"levers[{index}].action"},
                    False,
                    400,
                )

            cleaned_lever_actions.append(_clean_text(action))
    elif isinstance(lever_actions, list) and len(lever_actions) == 3:
        for index, action in enumerate(lever_actions):
            if not isinstance(action, str) or not action.strip():
                raise ApiProblem(
                    "INVALID_PARAMS",
                    "DeepSeek roast returned invalid JSON",
                    {"stage": "roast", "field": f"lever_actions[{index}]"},
                    False,
                    400,
                )
            cleaned_lever_actions.append(_clean_text(action))
    else:
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek roast returned invalid JSON",
            {"stage": "roast", "field": "levers"},
            False,
            400,
        )

    forbidden_brand = "forkverse"
    if (
        forbidden_brand in cleaned_verdict.casefold()
        or forbidden_brand in cleaned_comment.casefold()
        or any(forbidden_brand in action.casefold() for action in cleaned_lever_actions)
    ):
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek roast returned forbidden brand mention",
            {"stage": "roast", "reason": "forbidden_brand"},
            False,
            400,
        )

    return {
        "verdict": cleaned_verdict,
        "comment": cleaned_comment,
        "lever_actions": cleaned_lever_actions,
    }


def _call_roast_stage(
    *,
    user_text: str,
    extracted_params: Mapping[str, Any],
    simulation_result: Mapping[str, Any],
) -> dict[str, Any]:
    roast_input = (
        "Original user request anchor:\n"
        f"{user_text.strip()}\n\n"
        "CRITICAL LANGUAGE ANCHOR:\n"
        "Use only the Original user request above to determine the response language.\n\n"
        "Extracted params:\n"
        f"{json.dumps(dict(extracted_params), ensure_ascii=False, separators=(',', ':'))}\n\n"
        "Simulation:\n"
        f"{json.dumps(dict(simulation_result), ensure_ascii=False, separators=(',', ':'))}"
    )

    raw_payload = _call_deepseek_json(
        system_prompt=ROAST_SYSTEM_PROMPT,
        user_content=roast_input,
        stage="roast",
        temperature=0.9,
    )

    return _normalize_roast_payload(raw_payload)


def _apply_localized_lever_actions(
    simulation_result: Mapping[str, Any],
    localized_actions: list[str],
) -> dict[str, Any]:
    normalized_result = _normalize_simulation_result(simulation_result)
    normalized_levers = normalized_result.get("levers")

    if not isinstance(normalized_levers, list) or len(normalized_levers) != len(localized_actions):
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek roast returned invalid lever localization payload",
            {"stage": "roast", "field": "lever_actions"},
            False,
            400,
        )

    localized_levers: list[dict[str, Any]] = []
    for lever, localized_action in zip(normalized_levers, localized_actions, strict=True):
        updated_lever = dict(lever)
        updated_lever["action"] = localized_action
        if "title" in updated_lever:
            updated_lever["title"] = localized_action
        localized_levers.append(updated_lever)

    normalized_result["levers"] = localized_levers
    if isinstance(normalized_result.get("smart_levers"), list):
        normalized_result["smart_levers"] = [
            {
                **dict(smart_lever),
                "title": localized_lever["title"] if "title" in localized_lever else localized_lever["action"],
            }
            for smart_lever, localized_lever in zip(normalized_result["smart_levers"], localized_levers, strict=True)
            if isinstance(smart_lever, Mapping)
        ]
    return normalized_result


def _build_ready_data(
    *,
    params: Any,
    currency_symbol: Any,
    roast: Mapping[str, Any],
    simulation_result: Mapping[str, Any],
) -> dict[str, Any]:
    normalized_roast = _normalize_roast_payload(dict(roast))
    normalized_result = _apply_localized_lever_actions(
        simulation_result,
        normalized_roast["lever_actions"],
    )

    return {
        "status": "ready",
        "params": _serialize_monte_run_params(params, currency_symbol),
        CURRENCY_SYMBOL_FIELD: _normalize_currency_symbol(currency_symbol),
        "question": None,
        "verdict": normalized_roast["verdict"],
        "comment": normalized_roast["comment"],
        **normalized_result,
    }


def _build_needs_clarification_data(extraction_result: Mapping[str, Any]) -> dict[str, Any]:
    comment = extraction_result.get("comment")
    question = extraction_result.get("question")
    currency_symbol = _normalize_currency_symbol(extraction_result.get(CURRENCY_SYMBOL_FIELD))

    if not isinstance(comment, str) or not comment.strip():
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek extraction returned invalid JSON",
            {"stage": "extraction", "field": "comment"},
            False,
            400,
        )

    if not isinstance(question, str) or not question.strip():
        raise ApiProblem(
            "INVALID_PARAMS",
            "DeepSeek extraction returned invalid JSON",
            {"stage": "extraction", "field": "question"},
            False,
            400,
        )

    result = {
        "status": "needs_clarification",
        "params": None,
        CURRENCY_SYMBOL_FIELD: currency_symbol,
        "question": _clean_text(question),
        "comment": _clean_text(comment),
    }
    assumptions = extraction_result.get("assumptions")
    if isinstance(assumptions, list) and assumptions:
        result["assumptions"] = assumptions
    return result


def _extract_parser_text(parsed: Mapping[str, Any], field: str) -> str:
    value = parsed.get(field)
    if not isinstance(value, str):
        raise ApiProblem(
            "INVALID_PARAMS",
            "Parser response was malformed",
            {"field": field},
            False,
            400,
        )

    text = value.strip()
    if not text and field != "question":
        raise ApiProblem(
            "INVALID_PARAMS",
            "Parser response was malformed",
            {"field": field},
            False,
            400,
        )

    return text


def _call_groq(
    user_text: str,
    *,
    base_params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    extracted = _call_extraction_stage(user_text)
    raw_params = extracted.get("params")

    if extracted.get("status") != "ready":
        if not isinstance(raw_params, Mapping):
            return extracted

        merged_params = _merge_extracted_params(raw_params, base_params)
        if _missing_param_fields(merged_params):
            return extracted
    else:
        if not isinstance(raw_params, Mapping):
            raise ApiProblem(
                "INVALID_PARAMS",
                "DeepSeek extraction returned invalid params payload",
                {"stage": "extraction", "field": "params"},
                False,
                400,
            )

        merged_params = _merge_extracted_params(raw_params, base_params)

    legacy_params = {
        "initial_capital": int(round(float(merged_params["cash"]))),
        "monthly_burn": int(round(float(merged_params["fixed_expenses"]) + float(merged_params["flexible_expenses"]))),
        "monthly_income": int(round(float(merged_params["monthly_income"]))),
        "income_delay_months": _coerce_non_negative_int(
            INCOME_DELAY_MONTHS_FIELD,
            merged_params.get(INCOME_DELAY_MONTHS_FIELD),
            stage="extraction",
            default=0,
        ),
        CAPITAL_SHOCK_FIELD: _coerce_non_negative_float(
            CAPITAL_SHOCK_FIELD,
            merged_params.get(CAPITAL_SHOCK_FIELD, 0.0),
            stage="extraction",
        ),
        BURN_MULTIPLIER_FIELD: _coerce_non_negative_float(
            BURN_MULTIPLIER_FIELD,
            merged_params.get(BURN_MULTIPLIER_FIELD, 1.0),
            stage="extraction",
        ),
        "months": LEGACY_SIMULATION_MONTHS,
        "n_simulations": LEGACY_SIMULATION_PATHS,
        CURRENCY_SYMBOL_FIELD: _normalize_currency_symbol(merged_params.get(CURRENCY_SYMBOL_FIELD)),
    }

    result = {
        "status": "ready",
        "params": legacy_params,
        "question": None,
        "comment": extracted["comment"],
    }
    assumptions = extracted.get("assumptions")
    if isinstance(assumptions, list) and assumptions:
        result["assumptions"] = assumptions
    smart_levers = extracted.get("smart_levers")
    if isinstance(smart_levers, list) and smart_levers:
        result["smart_levers"] = smart_levers
    return result


def _run_simulation(
    initial_capital: Any,
    monthly_income: Any,
    monthly_burn: Any,
    months: Any = LEGACY_SIMULATION_MONTHS,
    n_simulations: Any = LEGACY_SIMULATION_PATHS,
    income_delay_months: Any = 0,
    capital_shock: Any = 0.0,
    burn_multiplier: Any = 1.0,
) -> list[list[float]]:
    _, _, simulate, _ = _get_math_core()

    try:
        paths = simulate(
            initial_capital=initial_capital,
            monthly_income=monthly_income,
            monthly_burn=monthly_burn,
            months=months,
            n_simulations=n_simulations,
            income_delay_months=income_delay_months,
            capital_shock=capital_shock,
            burn_multiplier=burn_multiplier,
        )
    except Exception as exc:
        LOGGER.exception("Legacy MonteRun trajectory simulation failed")
        raise ApiProblem(
            "INVALID_PARAMS",
            "MonteRun trajectory generation failed",
            {"stage": "simulation"},
            False,
            400,
        ) from exc

    return np.asarray(paths, dtype=np.float64).tolist()


def _build_simulation_response(trajectories: list[list[float]]) -> dict[str, Any]:
    _, _, _, compute_metrics = _get_math_core()

    try:
        result = compute_metrics(np.asarray(trajectories, dtype=np.float64))
    except Exception as exc:
        LOGGER.exception("Legacy MonteRun metrics build failed")
        raise ApiProblem(
            "INVALID_PARAMS",
            "MonteRun metrics generation failed",
            {"stage": "simulation"},
            False,
            400,
        ) from exc

    if not isinstance(result, Mapping):
        raise ApiProblem(
            "INVALID_PARAMS",
            "MonteRun metrics generation failed",
            {"stage": "simulation", "reason": "non_object_result"},
            False,
            400,
        )

    return dict(result)


_load_local_env_file()


class handler(BaseHTTPRequestHandler):
    server_version = "MonteRun"
    sys_version = ""

    def do_POST(self) -> None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        started_at = time.perf_counter()
        status_code = 200

        try:
            body = self._read_json_body()
            user_text = self._extract_text(body)
            telegram_user_id = self._extract_optional_telegram_user_id(body)
            parser_context_payload, telegram_context_row, scenario_state_row = _load_telegram_parser_context(telegram_user_id)
            parser_input = _build_parser_input(user_text, parser_context_payload)

            extraction_result = _call_extraction_stage(parser_input)
            if extraction_result.get("status") == "needs_clarification":
                data = _build_needs_clarification_data(extraction_result)
                _persist_last_bot_question(
                    telegram_user_id=telegram_user_id,
                    request_id=request_id,
                    source_text=user_text,
                    question=data.get("question") if isinstance(data, Mapping) else None,
                    telegram_context_row=telegram_context_row,
                    scenario_state_row=scenario_state_row,
                )
            else:
                raw_params = extraction_result.get("params")
                if not isinstance(raw_params, Mapping):
                    raise ApiProblem(
                        "INVALID_PARAMS",
                        "DeepSeek extraction returned invalid params payload",
                        {"stage": "extraction", "field": "params"},
                        False,
                        400,
                    )

                currency_symbol = _normalize_currency_symbol(raw_params.get(CURRENCY_SYMBOL_FIELD))
                monte_run_params = _build_monte_run_params(raw_params)
                serialized_params = _serialize_monte_run_params(monte_run_params, currency_symbol)
                simulation_result = _run_math_core(monte_run_params)
                smart_levers = extraction_result.get("smart_levers")
                if isinstance(smart_levers, list):
                    simulation_result = _apply_smart_levers_to_simulation(
                        params=monte_run_params,
                        simulation_result=simulation_result,
                        smart_levers=smart_levers,
                    )
                roast = _call_roast_stage(
                    user_text=user_text,
                    extracted_params=serialized_params,
                    simulation_result=simulation_result,
                )
                localized_simulation_result = _apply_localized_lever_actions(
                    simulation_result,
                    roast["lever_actions"],
                )
                data = _build_ready_data(
                    params=monte_run_params,
                    currency_symbol=currency_symbol,
                    roast=roast,
                    simulation_result=localized_simulation_result,
                )
                assumptions = extraction_result.get("assumptions")
                if isinstance(assumptions, list) and assumptions:
                    data["assumptions"] = assumptions
                _persist_scenario_state(
                    telegram_user_id=telegram_user_id,
                    request_id=request_id,
                    source_text=user_text,
                    params=serialized_params,
                    simulation_data=localized_simulation_result,
                    telegram_context_row=telegram_context_row,
                    scenario_state_row=scenario_state_row,
                    comment=roast["comment"],
                    verdict=roast["verdict"],
                )

            error = None
        except ApiProblem as exc:
            data = None
            error = _build_error(exc.code, exc.message, exc.details, exc.retryable)
            status_code = exc.http_status
        except Exception:
            LOGGER.exception(traceback.format_exc())
            data = None
            error = _build_error(
                "INTERNAL_ERROR",
                "Internal server error",
                None,
                False,
            )
            status_code = 500

        meta = _build_meta(request_id, started_at)
        self._send_envelope(
            {"data": data, "error": error, "meta": meta},
            meta["simulation_time_ms"],
            request_id,
            status_code=status_code,
        )

    def do_GET(self) -> None:
        self._send_method_not_allowed()

    def do_PUT(self) -> None:
        self._send_method_not_allowed()

    def do_PATCH(self) -> None:
        self._send_method_not_allowed()

    def do_DELETE(self) -> None:
        self._send_method_not_allowed()

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _read_json_body(self) -> dict[str, Any]:
        content_length_header = self.headers.get("Content-Length")
        if content_length_header is None:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Content-Length header is required",
                {"header": "Content-Length"},
                False,
                400,
            )

        try:
            content_length = int(content_length_header)
        except ValueError as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Invalid Content-Length header",
                {"header": "Content-Length", "value": content_length_header},
                False,
                400,
            ) from exc

        if content_length <= 0:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body is required",
                {"min_bytes": 1},
                False,
                400,
            )

        if content_length >= MAX_PAYLOAD_BYTES:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Payload too large",
                {"max_bytes": MAX_PAYLOAD_BYTES - 1},
                False,
                400,
            )

        raw_body = self.rfile.read(content_length)
        if len(raw_body) != content_length:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Incomplete request body",
                {"expected_bytes": content_length, "received_bytes": len(raw_body)},
                False,
                400,
            )

        if len(raw_body) >= MAX_PAYLOAD_BYTES:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Payload too large",
                {"max_bytes": MAX_PAYLOAD_BYTES - 1},
                False,
                400,
            )

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except UnicodeDecodeError as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body must be valid UTF-8 JSON",
                None,
                False,
                400,
            ) from exc
        except json.JSONDecodeError as exc:
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body must be valid JSON",
                {"line": exc.lineno, "column": exc.colno},
                False,
                400,
            ) from exc

        if not isinstance(payload, dict):
            raise ApiProblem(
                "INVALID_PARAMS",
                "Request body must be a JSON object",
                {"type": type(payload).__name__},
                False,
                400,
            )

        return payload

    def _extract_text(self, body: dict[str, Any]) -> str:
        text = body.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ApiProblem(
                "INVALID_PARAMS",
                "text is required",
                {"field": "text"},
                False,
                400,
            )

        return text.strip()

    def _extract_optional_telegram_user_id(self, body: dict[str, Any]) -> int | None:
        if "telegram_user_id" not in body or body["telegram_user_id"] is None:
            return None

        return _coerce_positive_int("telegram_user_id", body.get("telegram_user_id"))

    def _send_method_not_allowed(self) -> None:
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        started_at = time.perf_counter()
        meta = _build_meta(request_id, started_at)
        payload = json.dumps(
            {
                "data": None,
                "error": _build_error(
                    "INVALID_PARAMS",
                    "Method not allowed. Use POST.",
                    {"allowed_methods": ["POST"], "method": self.command},
                    False,
                ),
                "meta": meta,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        self.send_response(405)
        self.send_header("Allow", "POST")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Request-ID", request_id)
        self.send_header("X-Server-Timing", f"total;dur={meta['simulation_time_ms']}")
        self.end_headers()
        self.wfile.write(payload)

    def _send_envelope(
        self,
        payload: dict[str, Any],
        elapsed_ms: int,
        request_id: str,
        *,
        status_code: int,
    ) -> None:
        response_bytes = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        self.send_response(status_code)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("X-Request-ID", request_id)
        self.send_header("X-Server-Timing", f"total;dur={elapsed_ms}")
        self.end_headers()
        self.wfile.write(response_bytes)
