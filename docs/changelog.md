# 2026-04-09

- Реализовано базовое математическое ядро Monte Carlo для `Fork Zero` на `numpy` с полной векторизацией по симуляциям и генератором `np.random.default_rng()`.
- Принято допущение: месячный net cash flow моделируется нормальным распределением вокруг `monthly_income - monthly_burn`, а стандартное отклонение задаётся как `max(1.0, 10% monthly_income + 5% monthly_burn)`.
- В `compute_metrics()` добавлена защита API-контракта: все `numpy`-скаляры и массивы конвертируются в native Python `int`/`float`/`list` до возврата в envelope.
- Для `SpaghettiChart` percentiles `p10` и `p90` сведены в одну `Area` как confidence band без разрыва математического смысла между границами диапазона.
- Поверх confidence band накладываются до 50 тонких полупрозрачных spaghetti-линий, а медиана `p50` рисуется отдельной контрастной линией поверх всех траекторий.
- `cashoutMonth` вычисляется через `useMemo()` с clamping минимум до месяца `1`; если `cashoutDateMedian` раньше `startDate`, компонент пишет `console.warn`.
- Реализован эндпоинт `/api/parse` для serverless-парсинга входящего текста в параметры симуляции.
- Используем Gemini 3 Flash через прямой HTTP-вызов Google AI Studio без тяжёлых SDK.
- Внедрена защита от бесконечных диалогов: ответ `needs_clarification` пробрасывает пользователю один уточняющий вопрос.
- Реализован `SimulatorClient.tsx` с конечным автоматом состояний.
- Добавлен маппинг сырых данных `/api/simulate` в пропсы `SpaghettiChart` с генерацией `forkSummary` и `startDate`.
- `app/page.tsx` оставлен серверным компонентом.
- Исправлена типизация `darkMode` в `tailwind.config.ts`: для Tailwind v4+ используется строковое значение `\"class\"`, совместимое с TypeScript strict mode и production build.

# 2026-04-10

- `api/parse.py` полностью мигрирован с Gemini на Groq `llama-3.1-8b-instant`: вызов переведен на OpenAI-совместимый `/chat/completions`, удалены `PARSER_RESPONSE_SCHEMA`, `systemInstruction`, `generationConfig` и вся Google/Gemini-специфика.
- В `api/parse.py` добавлен `_run_simulation`, который использует существующие `simulate()` и `compute_metrics()` из `engine/monte_carlo.py`; после `status == "ready"` backend сразу возвращает `trajectories`, `percentiles`, `survival_probability` и `chartData` для графика.
- `prompts/parser_v1.txt` переписан в жёсткий zero-shot prompt: модель обязана сама агрегировать расходы, не писать формулы в JSON и не задавать лишних уточняющих вопросов, если данных достаточно для примерной оценки.
- `api/parse.py` переведён на встроенную NumPy-симуляцию сразу после `status == "ready"`: backend теперь возвращает `status`, `params` и готовые `trajectories` в одном envelope без отдельного шага simulation engine.
