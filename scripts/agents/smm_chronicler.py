#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


APP_NAME = "smm_chronicler"
try:
    LOCAL_TIMEZONE = ZoneInfo("Asia/Qyzylorda")
except ZoneInfoNotFoundError:
    LOCAL_TIMEZONE = timezone(timedelta(hours=5), name="Asia/Qyzylorda")
MODEL_ID = "deepseek/deepseek-chat"
OPENROUTER_API_URL = "https://api.deepseek.com/chat/completions"
TASK_TAG = "#task/for-marketing"
IN_PROGRESS_TAG = "#task/in-progress/smm"
APPROVAL_TAG = "#status/needs-approval"
LOG_HEADING = "## Log"
DAILY_BUDGET_LOG_HEADING = "## Daily Log"
RUN_LOCK_FILENAME = ".smm_chronicler.lock"
REQUEST_TIMEOUT_SECONDS = 45
DEFAULT_MAX_TOKENS = 320
BUDGET_LIMIT = Decimal("0.50")

# Direct DeepSeek night pricing in USD per million tokens.
DEFAULT_INPUT_COST_PER_MILLION = Decimal("0.14")
DEFAULT_OUTPUT_COST_PER_MILLION = Decimal("0.28")

SYSTEM_PROMPT = (
    "Ты циничный и ядовитый SMM-менеджер MonteRun из Алматы. "
    "Бьёшь в боль фрилансеров и стартаперов. "
    "Пишешь посты для X с сарказмом, но продаёшь реальную пользу калькулятора."
)


class SmmChroniclerError(RuntimeError):
    """Base error for the SMM chronicler."""


class DailyNoteMissingError(SmmChroniclerError):
    """Raised when today's Daily Note is missing."""


class BudgetLedgerMissingError(SmmChroniclerError):
    """Raised when the SMM budget ledger is missing."""


class BudgetLimitExceededError(SmmChroniclerError):
    """Raised when the hard budget limit blocks the run."""


class BudgetLedgerParseError(SmmChroniclerError):
    """Raised when the budget ledger cannot be parsed safely."""


class TaskStateError(SmmChroniclerError):
    """Raised when the marketing task tag is ambiguous."""


class AtomicLockError(SmmChroniclerError):
    """Raised when another SMM run already holds the lock."""


class ApiCallError(SmmChroniclerError):
    """Raised when the OpenRouter call fails."""


class GitFlowError(SmmChroniclerError):
    """Raised when git automation fails."""


@dataclass(frozen=True)
class Paths:
    repo_root: Path
    vault_root: Path
    daily_note_path: Path
    budget_note_path: Path
    draft_dir: Path
    draft_path: Path
    paperclip_dir: Path
    lock_path: Path
    git_log_day_dir: Path


@dataclass(frozen=True)
class BudgetState:
    stored_date: str | None
    stored_spend: Decimal
    effective_spend: Decimal
    hard_limit: Decimal
    status: str
    daily_log_lines: list[str]


@dataclass(frozen=True)
class GenerationResult:
    content: str
    usage: dict[str, Any]
    cost_usd: Decimal
    generation_id: str | None
    response_payload: dict[str, Any]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="MonteRun autonomous SMM chronicler")
    parser.add_argument("--date", dest="run_date", help="Override the run date in YYYY-MM-DD format.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run all local guards and writes without calling OpenRouter.",
    )
    parser.add_argument(
        "--push",
        dest="push",
        action="store_true",
        help="Commit and push managed artifacts after a successful generation.",
    )
    parser.add_argument(
        "--no-push",
        dest="push",
        action="store_false",
        help="Skip git commit/push even if a wrapper enables it.",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=DEFAULT_MAX_TOKENS,
        help="Upper bound for completion tokens used in hard-budget preflight.",
    )
    parser.add_argument("--vault-root", help="Optional override for the Obsidian vault path.")
    parser.set_defaults(push=False)
    return parser.parse_args(argv)


def current_local_time() -> datetime:
    return datetime.now(LOCAL_TIMEZONE)


def parse_run_date(raw_value: str | None) -> date:
    if not raw_value:
        return current_local_time().date()

    try:
        return date.fromisoformat(raw_value)
    except ValueError as exc:
        raise SmmChroniclerError(f"Invalid --date value: {raw_value}") from exc


def load_local_env_file(repo_root: Path) -> None:
    env_path = repo_root / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        os.environ[key] = value.strip()


def load_autolog_config(repo_root: Path) -> dict[str, Any]:
    config_path = repo_root / ".forkverse" / "obsidian-autolog.json"
    if not config_path.exists():
        return {}

    return json.loads(config_path.read_text(encoding="utf-8"))


def resolve_paths(repo_root: Path, run_date: date, vault_override: str | None) -> Paths:
    config = load_autolog_config(repo_root)
    vault_root = Path(vault_override or config.get("vaultPath") or (repo_root / "Obsidian")).resolve()
    daily_notes_folder = config.get("dailyNotesFolder", "Daily Notes")
    git_log_folder = config.get("gitLogFolder", "00-Inbox/Git Log")

    date_label = run_date.isoformat()
    daily_note_path = vault_root / daily_notes_folder / f"{date_label}.md"
    budget_note_path = vault_root / "03-Resources" / "Budgets" / "SMM-Costs.md"
    draft_dir = vault_root / "02-Areas" / "Marketing" / "Drafts"
    draft_path = draft_dir / f"post_{date_label}.md"
    paperclip_dir = vault_root / "03-Resources" / "Paperclip-Reference"
    lock_path = paperclip_dir / RUN_LOCK_FILENAME
    git_log_day_dir = vault_root / git_log_folder / date_label

    return Paths(
        repo_root=repo_root,
        vault_root=vault_root,
        daily_note_path=daily_note_path,
        budget_note_path=budget_note_path,
        draft_dir=draft_dir,
        draft_path=draft_path,
        paperclip_dir=paperclip_dir,
        lock_path=lock_path,
        git_log_day_dir=git_log_day_dir,
    )


def ensure_support_dirs(paths: Paths) -> None:
    paths.paperclip_dir.mkdir(parents=True, exist_ok=True)
    paths.draft_dir.mkdir(parents=True, exist_ok=True)
    paths.budget_note_path.parent.mkdir(parents=True, exist_ok=True)


def read_text_strict(path: Path, label: str) -> str:
    if not path.exists():
        if label == "daily-note":
            raise DailyNoteMissingError(f"Daily Note not found: {path}")
        if label == "budget":
            raise BudgetLedgerMissingError(f"Budget ledger not found: {path}")
        raise SmmChroniclerError(f"Required file not found: {path}")

    return path.read_text(encoding="utf-8")


def write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent, suffix=".tmp") as handle:
        handle.write(content)
        temp_name = handle.name

    os.replace(temp_name, path)


def add_line_under_heading(content: str, heading: str, line: str) -> str:
    lines = content.splitlines()
    if line in lines:
        return content if content.endswith("\n") else f"{content}\n"

    for index, existing in enumerate(lines):
        if existing.strip() == heading:
            lines.insert(index + 1, line)
            return "\n".join(lines).rstrip() + "\n"

    if lines and lines[-1].strip():
        lines.append("")
    lines.extend([heading, line])
    return "\n".join(lines).rstrip() + "\n"


def sanitize_log_value(value: str) -> str:
    return value.replace("`", "'").replace("\n", " ").strip()


def build_log_line(run_id: str, op: str, result: str, **details: str) -> str:
    stamp = current_local_time().strftime("%Y-%m-%d %H:%M:%S")
    parts = [
        f"- {stamp}",
        f"`{APP_NAME}`",
        f"run=`{sanitize_log_value(run_id)}`",
        f"op=`{sanitize_log_value(op)}`",
    ]
    for key, value in details.items():
        if value:
            parts.append(f"{sanitize_log_value(key)}=`{sanitize_log_value(value)}`")
    parts.append(f"result=`{sanitize_log_value(result)}`")
    return " | ".join(parts)


def append_daily_log(daily_note_path: Path, run_id: str, op: str, result: str, **details: str) -> None:
    content = read_text_strict(daily_note_path, "daily-note")
    updated = add_line_under_heading(content, LOG_HEADING, build_log_line(run_id, op, result, **details))
    write_atomic(daily_note_path, updated)


def extract_section_lines(text: str, heading: str) -> list[str]:
    lines = text.splitlines()
    start_index: int | None = None
    for index, line in enumerate(lines):
        if line.strip() == heading:
            start_index = index + 1
            break

    if start_index is None:
        return []

    collected: list[str] = []
    for line in lines[start_index:]:
        if line.startswith("## "):
            break
        if line.strip():
            collected.append(line)
    return collected


def parse_decimal(raw_value: str, context: str) -> Decimal:
    try:
        return Decimal(raw_value)
    except InvalidOperation as exc:
        raise BudgetLedgerParseError(f"Invalid decimal in {context}: {raw_value}") from exc


def parse_budget_state(text: str, run_date: date) -> BudgetState:
    date_match = re.search(r"^- Date:\s*(?P<value>\d{4}-\d{2}-\d{2})?\s*$", text, flags=re.MULTILINE)
    spend_match = re.search(r"^- Spend today:\s*\$(?P<value>\d+(?:\.\d{1,6})?)\s*$", text, flags=re.MULTILINE)
    limit_match = re.search(r"^- Hard limit:\s*\$(?P<value>\d+(?:\.\d{1,6})?)\s*$", text, flags=re.MULTILINE)
    status_match = re.search(r"^- Status:\s*(?P<value>.+?)\s*$", text, flags=re.MULTILINE)

    if not date_match or not spend_match or not limit_match or not status_match:
        raise BudgetLedgerParseError("Budget ledger is missing required fields.")

    stored_date = date_match.group("value")
    stored_spend = parse_decimal(spend_match.group("value"), "Spend today")
    hard_limit = parse_decimal(limit_match.group("value"), "Hard limit")
    status = status_match.group("value").strip()

    if hard_limit != BUDGET_LIMIT:
        raise BudgetLedgerParseError("Hard limit in SMM-Costs.md must stay at $0.50.")

    if stored_date and stored_date != run_date.isoformat():
        effective_spend = Decimal("0")
    elif not stored_date and stored_spend != Decimal("0"):
        raise BudgetLedgerParseError("Budget ledger date is blank while spend is non-zero.")
    else:
        effective_spend = stored_spend

    return BudgetState(
        stored_date=stored_date,
        stored_spend=stored_spend,
        effective_spend=effective_spend,
        hard_limit=hard_limit,
        status=status,
        daily_log_lines=extract_section_lines(text, DAILY_BUDGET_LOG_HEADING),
    )


def format_money(value: Decimal, places: int = 6) -> str:
    quant = Decimal("0.000001") if places == 6 else Decimal("0.01")
    return f"{value.quantize(quant, rounding=ROUND_HALF_UP):f}"


def render_budget_note(run_date: date, spend_today: Decimal, hard_limit: Decimal, daily_log_lines: list[str]) -> str:
    status = "limit reached" if spend_today >= hard_limit else "within limit"
    lines = [
        "# SMM Costs",
        "",
        f"- Date: {run_date.isoformat()}",
        f"- Spend today: ${format_money(spend_today)}",
        f"- Hard limit: ${format_money(hard_limit, places=2)}",
        f"- Status: {status}",
        "",
        DAILY_BUDGET_LOG_HEADING,
    ]
    if daily_log_lines:
        lines.extend(daily_log_lines)
    else:
        lines.append("-")
    return "\n".join(lines).rstrip() + "\n"


def append_budget_usage(
    budget_note_path: Path,
    budget_state: BudgetState,
    run_date: date,
    run_id: str,
    delta_cost: Decimal,
    prompt_tokens: int,
    completion_tokens: int,
    draft_link: str,
) -> Decimal:
    new_total = budget_state.effective_spend + delta_cost
    usage_line = (
        f"- {current_local_time().strftime('%Y-%m-%d %H:%M:%S')} | run=`{sanitize_log_value(run_id)}`"
        f" | cost=`${format_money(delta_cost)}` | prompt=`{prompt_tokens}` | completion=`{completion_tokens}`"
        f" | draft=`{sanitize_log_value(draft_link)}`"
    )
    lines = [line for line in budget_state.daily_log_lines if line.strip() and line.strip() != "-"]
    lines.insert(0, usage_line)
    write_atomic(
        budget_note_path,
        render_budget_note(run_date, new_total, budget_state.hard_limit, lines),
    )
    return new_total


def count_tag_occurrences(text: str, tag: str) -> int:
    count = 0
    in_code_block = False
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if in_code_block or stripped.startswith(">"):
            continue
        count += line.count(tag)
    return count


def get_task_state(text: str) -> str:
    queued_count = count_tag_occurrences(text, TASK_TAG)
    in_progress_count = count_tag_occurrences(text, IN_PROGRESS_TAG)

    if queued_count == 0 and in_progress_count == 0:
        return "missing"
    if queued_count == 0 and in_progress_count == 1:
        return "in-progress"
    if queued_count == 1 and in_progress_count == 0:
        return "ready"

    raise TaskStateError(
        "Daily Note contains an ambiguous SMM task state. Expected exactly one queued tag or one in-progress tag."
    )


def claim_task_tag(text: str) -> str:
    state = get_task_state(text)
    if state != "ready":
        raise TaskStateError(f"Cannot claim task from state: {state}")

    updated_lines: list[str] = []
    in_code_block = False
    replaced = False
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            updated_lines.append(line)
            continue
        if in_code_block or stripped.startswith(">"):
            updated_lines.append(line)
            continue
        if TASK_TAG in line:
            if replaced or line.count(TASK_TAG) != 1:
                raise TaskStateError("Expected exactly one replaceable #task/for-marketing tag.")
            updated_lines.append(line.replace(TASK_TAG, IN_PROGRESS_TAG, 1))
            replaced = True
            continue
        updated_lines.append(line)

    if not replaced:
        raise TaskStateError("Failed to atomically claim the marketing task tag.")

    return "\n".join(updated_lines).rstrip() + "\n"


def acquire_atomic_lock(lock_path: Path) -> int:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    try:
        descriptor = os.open(str(lock_path), flags)
    except FileExistsError as exc:
        raise AtomicLockError(f"Another {APP_NAME} run is already in progress: {lock_path}") from exc

    payload = (
        f"pid={os.getpid()}\n"
        f"time={current_local_time().isoformat()}\n"
        f"cwd={Path.cwd()}\n"
    )
    os.write(descriptor, payload.encode("utf-8"))
    return descriptor


def release_atomic_lock(lock_path: Path, descriptor: int | None) -> None:
    if descriptor is not None:
        os.close(descriptor)
    if lock_path.exists():
        lock_path.unlink()


def get_pricing() -> tuple[Decimal, Decimal]:
    input_price = os.environ.get("OPENROUTER_INPUT_COST_PER_MILLION", "").strip()
    output_price = os.environ.get("OPENROUTER_OUTPUT_COST_PER_MILLION", "").strip()

    if input_price and output_price:
        return parse_decimal(input_price, "OPENROUTER_INPUT_COST_PER_MILLION"), parse_decimal(
            output_price,
            "OPENROUTER_OUTPUT_COST_PER_MILLION",
        )

    return DEFAULT_INPUT_COST_PER_MILLION, DEFAULT_OUTPUT_COST_PER_MILLION


def estimate_worst_case_cost(system_prompt: str, user_prompt: str, max_tokens: int) -> Decimal:
    if max_tokens <= 0:
        raise SmmChroniclerError("--max-tokens must be a positive integer.")

    input_price, output_price = get_pricing()
    prompt_token_upper_bound = len(system_prompt) + len(user_prompt)
    prompt_cost = (Decimal(prompt_token_upper_bound) * input_price) / Decimal(1_000_000)
    completion_cost = (Decimal(max_tokens) * output_price) / Decimal(1_000_000)
    return prompt_cost + completion_cost


def compute_actual_cost(usage: dict[str, Any]) -> Decimal:
    raw_cost = usage.get("cost")
    if raw_cost is not None:
        return parse_decimal(str(raw_cost), "usage.cost")

    input_price, output_price = get_pricing()
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    prompt_cost = (Decimal(prompt_tokens) * input_price) / Decimal(1_000_000)
    completion_cost = (Decimal(completion_tokens) * output_price) / Decimal(1_000_000)
    return prompt_cost + completion_cost


def coerce_message_text(message_content: Any) -> str:
    if isinstance(message_content, str):
        return message_content.strip()
    if isinstance(message_content, list):
        chunks: list[str] = []
        for item in message_content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        return "\n".join(chunk.strip() for chunk in chunks if chunk.strip()).strip()
    return ""


def require_api_key(repo_root: Path) -> str:
    load_local_env_file(repo_root)
    for env_name in ("DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "PROVIDER_API_KEY"):
        value = os.environ.get(env_name, "").strip()
        if value:
            return value
    raise SmmChroniclerError(
        "API key is not configured. Set DEEPSEEK_API_KEY, OPENROUTER_API_KEY, or PROVIDER_API_KEY."
    )


def load_paperclip_context(paperclip_dir: Path, max_chars: int = 2400) -> str:
    snippets: list[str] = []
    for note_path in sorted(paperclip_dir.glob("*.md")):
        text = note_path.read_text(encoding="utf-8").strip()
        if not text:
            continue
        snippets.append(f"[{note_path.stem}]\n{text[:800]}")
        if sum(len(chunk) for chunk in snippets) >= max_chars:
            break

    if not snippets:
        return "Paperclip fallback: ruthless leverage, zero waste, concrete utility, no motivational fluff."

    return "\n\n".join(snippets)[:max_chars]


def extract_marketing_context(daily_text: str, limit: int = 10) -> list[str]:
    keywords = ("marketing", "smm", "x", "post", "twitter", "calculator", "freelance", "startup", "founder")
    collected: list[str] = []
    for line in daily_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("```") or stripped.startswith(">"):
            continue
        lowered = stripped.lower()
        if TASK_TAG in stripped or IN_PROGRESS_TAG in stripped or any(keyword in lowered for keyword in keywords):
            collected.append(stripped)
        if len(collected) >= limit:
            break
    return collected


def build_user_prompt(run_date: date, daily_text: str, paperclip_context: str) -> str:
    marketing_context = extract_marketing_context(daily_text)
    context_block = "\n".join(f"- {line}" for line in marketing_context) if marketing_context else "- No explicit marketing lines found in the Daily Note."

    return (
        f"Дата запуска: {run_date.isoformat()}\n"
        "Продукт: MonteRun calculator.\n"
        "Задача: создать один основной пост для X и две короткие альтернативные подводки.\n"
        "Аудитория: фрилансеры и стартаперы, у которых нет ясности по runway, burn и точке смерти.\n"
        "Продаём не мечту, а реальную пользу: калькулятор помогает трезво посчитать runway и увидеть кассовую яму заранее.\n"
        "Тон: сарказм, жёсткость, укол по боли, без клоунады и без пустой мотивации.\n"
        "Нельзя: канцелярит, банальности, завиральная магия, обещания x10.\n"
        "Нужно: конкретная польза, цепкий hook, продающая ясность.\n\n"
        "Контекст из Daily Note:\n"
        f"{context_block}\n\n"
        "Paperclip context:\n"
        f"{paperclip_context}\n\n"
        "Верни только Markdown в таком формате:\n"
        "## Main Post\n"
        "<готовый пост для X, до 280 символов>\n\n"
        "## Alternate Hooks\n"
        "- <вариант 1>\n"
        "- <вариант 2>\n\n"
        "## Why It Works\n"
        "<1-2 предложения, почему это продаёт калькулятор>\n"
    )


def call_openrouter(api_key: str, user_prompt: str, max_tokens: int) -> GenerationResult:
    payload = {
        "model": MODEL_ID,
        "stream": False,
        "temperature": 0.9,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    }
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        OPENROUTER_API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ApiCallError(f"OpenRouter HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise ApiCallError(f"OpenRouter network error: {exc}") from exc

    choices = response_payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ApiCallError("OpenRouter response does not contain choices.")

    message = choices[0].get("message", {})
    content = coerce_message_text(message.get("content"))
    if not content:
        raise ApiCallError("OpenRouter response did not return usable content.")

    usage = response_payload.get("usage")
    if not isinstance(usage, dict):
        raise ApiCallError("OpenRouter response is missing usage accounting.")

    cost_usd = compute_actual_cost(usage)
    generation_id = response_payload.get("id")
    generation_id_value = str(generation_id) if generation_id is not None else None

    return GenerationResult(
        content=content,
        usage=usage,
        cost_usd=cost_usd,
        generation_id=generation_id_value,
        response_payload=response_payload,
    )


def render_draft(run_date: date, result: GenerationResult) -> str:
    generated_at = current_local_time().strftime("%Y-%m-%d %H:%M:%S %Z")
    prompt_tokens = int(result.usage.get("prompt_tokens") or 0)
    completion_tokens = int(result.usage.get("completion_tokens") or 0)
    draft_lines = [
        f"# MonteRun X Draft - {run_date.isoformat()}",
        "",
        APPROVAL_TAG,
        "",
        "## Metadata",
        f"- Generated: {generated_at}",
        f"- Model: `{MODEL_ID}`",
        f"- Prompt tokens: `{prompt_tokens}`",
        f"- Completion tokens: `{completion_tokens}`",
        f"- Cost: `${format_money(result.cost_usd)}`",
        f"- Daily Note: `[[Daily Notes/{run_date.isoformat()}]]`",
    ]
    if result.generation_id:
        draft_lines.append(f"- OpenRouter Generation ID: `{result.generation_id}`")
    draft_lines.extend(["", "## Draft", result.content.strip(), ""])
    return "\n".join(draft_lines).rstrip() + "\n"


def run_git(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    process = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if process.returncode != 0:
        stderr = process.stderr.strip() or process.stdout.strip() or "unknown git error"
        raise GitFlowError(f"git {' '.join(args)} failed: {stderr}")
    return process


def relative_to_repo(repo_root: Path, path: Path) -> str:
    return os.fspath(path.resolve().relative_to(repo_root.resolve()))


def has_changes_for(repo_root: Path, targets: list[str]) -> bool:
    process = subprocess.run(
        ["git", "status", "--porcelain=v1", "--", *targets],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    return bool(process.stdout.strip())


def run_git_flow(paths: Paths, run_date: date) -> None:
    primary_targets = [
        relative_to_repo(paths.repo_root, paths.daily_note_path),
        relative_to_repo(paths.repo_root, paths.budget_note_path),
        relative_to_repo(paths.repo_root, paths.draft_path),
    ]
    run_git(paths.repo_root, "add", "--", *primary_targets)
    run_git(paths.repo_root, "commit", "-m", f"feat: add smm chronicler draft {run_date.isoformat()}")
    run_git(paths.repo_root, "push")

    autolog_targets = [
        relative_to_repo(paths.repo_root, paths.daily_note_path),
        relative_to_repo(paths.repo_root, paths.git_log_day_dir),
    ]
    if has_changes_for(paths.repo_root, autolog_targets):
        run_git(paths.repo_root, "add", "--", *autolog_targets)
        run_git(paths.repo_root, "commit", "-m", f"docs: sync smm autolog {run_date.isoformat()}")
        run_git(paths.repo_root, "push")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    repo_root = Path(__file__).resolve().parents[2]
    run_date = parse_run_date(args.run_date)
    paths = resolve_paths(repo_root, run_date, args.vault_root)

    run_id = current_local_time().strftime("%Y%m%d-%H%M%S")
    lock_descriptor: int | None = None

    if not paths.daily_note_path.exists():
        raise DailyNoteMissingError(f"Daily Note not found for {run_date.isoformat()}: {paths.daily_note_path}")

    daily_text = read_text_strict(paths.daily_note_path, "daily-note")
    task_state = get_task_state(daily_text)
    if task_state == "missing":
        print("No #task/for-marketing tag found. Zero-cost exit.")
        return 0

    if task_state == "in-progress":
        print("Task already claimed by another SMM run. Zero-cost exit.")
        return 0

    ensure_support_dirs(paths)
    budget_text = read_text_strict(paths.budget_note_path, "budget")
    budget_state = parse_budget_state(budget_text, run_date)
    if budget_state.effective_spend >= budget_state.hard_limit:
        append_daily_log(
            paths.daily_note_path,
            run_id,
            "budget-check",
            "halted",
            budget=f"${format_money(budget_state.effective_spend)}",
            threshold=f"${format_money(budget_state.hard_limit, places=2)}",
        )
        raise BudgetLimitExceededError(
            f"Hard budget already exhausted for {run_date.isoformat()}: ${format_money(budget_state.effective_spend)}"
        )

    try:
        lock_descriptor = acquire_atomic_lock(paths.lock_path)
        daily_text = read_text_strict(paths.daily_note_path, "daily-note")
        budget_text = read_text_strict(paths.budget_note_path, "budget")
        task_state = get_task_state(daily_text)
        budget_state = parse_budget_state(budget_text, run_date)

        if task_state != "ready":
            return 0

        if budget_state.effective_spend >= budget_state.hard_limit:
            append_daily_log(
                paths.daily_note_path,
                run_id,
                "budget-check",
                "halted",
                budget=f"${format_money(budget_state.effective_spend)}",
                threshold=f"${format_money(budget_state.hard_limit, places=2)}",
            )
            raise BudgetLimitExceededError("Hard budget exceeded before API call.")

        claimed_daily = claim_task_tag(daily_text)
        write_atomic(paths.daily_note_path, claimed_daily)
        append_daily_log(
            paths.daily_note_path,
            run_id,
            "atomic-claim",
            "locked",
            tag=f"{TASK_TAG} -> {IN_PROGRESS_TAG}",
        )
        append_daily_log(
            paths.daily_note_path,
            run_id,
            "budget-check",
            "passed",
            budget=f"${format_money(budget_state.effective_spend)}",
            threshold=f"${format_money(budget_state.hard_limit, places=2)}",
        )

        paperclip_context = load_paperclip_context(paths.paperclip_dir)
        user_prompt = build_user_prompt(run_date, claimed_daily, paperclip_context)
        worst_case_cost = estimate_worst_case_cost(SYSTEM_PROMPT, user_prompt, args.max_tokens)
        if budget_state.effective_spend + worst_case_cost > budget_state.hard_limit:
            append_daily_log(
                paths.daily_note_path,
                run_id,
                "budget-preflight",
                "halted",
                current=f"${format_money(budget_state.effective_spend)}",
                reserve=f"${format_money(worst_case_cost)}",
                threshold=f"${format_money(budget_state.hard_limit, places=2)}",
            )
            raise BudgetLimitExceededError(
                "Worst-case OpenRouter request would break the hard budget before the first API call."
            )

        append_daily_log(
            paths.daily_note_path,
            run_id,
            "budget-preflight",
            "passed",
            reserve=f"${format_money(worst_case_cost)}",
        )

        if args.dry_run:
            append_daily_log(paths.daily_note_path, run_id, "dry-run", "complete")
            print("Dry run complete. No API call executed.")
            return 0

        api_key = require_api_key(repo_root)
        generation_result = call_openrouter(api_key, user_prompt, args.max_tokens)
        prompt_tokens = int(generation_result.usage.get("prompt_tokens") or 0)
        completion_tokens = int(generation_result.usage.get("completion_tokens") or 0)

        append_daily_log(
            paths.daily_note_path,
            run_id,
            "generation",
            "ok",
            prompt=str(prompt_tokens),
            completion=str(completion_tokens),
            cost=f"${format_money(generation_result.cost_usd)}",
        )

        write_atomic(paths.draft_path, render_draft(run_date, generation_result))
        append_daily_log(
            paths.daily_note_path,
            run_id,
            "draft-write",
            "ok",
            artifact=f"[[02-Areas/Marketing/Drafts/post_{run_date.isoformat()}]]",
            status=APPROVAL_TAG,
        )

        new_total = append_budget_usage(
            paths.budget_note_path,
            budget_state,
            run_date,
            run_id,
            generation_result.cost_usd,
            prompt_tokens,
            completion_tokens,
            f"[[02-Areas/Marketing/Drafts/post_{run_date.isoformat()}]]",
        )
        append_daily_log(
            paths.daily_note_path,
            run_id,
            "budget-update",
            "ok",
            total=f"${format_money(new_total)}",
        )

        if new_total > budget_state.hard_limit:
            append_daily_log(
                paths.daily_note_path,
                run_id,
                "budget-update",
                "halted",
                total=f"${format_money(new_total)}",
                threshold=f"${format_money(budget_state.hard_limit, places=2)}",
            )
            raise BudgetLimitExceededError(
                "Actual usage crossed the hard budget limit. Pricing constants may need to be updated."
            )

        append_daily_log(paths.daily_note_path, run_id, "finish", "done")

        if args.push:
            append_daily_log(paths.daily_note_path, run_id, "git-flow", "queued")
            run_git_flow(paths, run_date)

        print(f"Draft saved to {paths.draft_path}")
        return 0
    except SmmChroniclerError:
        if paths.daily_note_path.exists():
            append_daily_log(paths.daily_note_path, run_id, "finish", "failed")
        raise
    except Exception as exc:
        if paths.daily_note_path.exists():
            append_daily_log(paths.daily_note_path, run_id, "finish", "failed", error=type(exc).__name__)
        raise
    finally:
        release_atomic_lock(paths.lock_path, lock_descriptor)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SmmChroniclerError as exc:
        print(f"{APP_NAME}: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
