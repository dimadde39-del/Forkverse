# 02_MonteRun_Runway_And_Survival_Engine_Spec

Source: `C:\ForkVerse\02_MonteRun_Runway_And_Survival_Engine_Spec.docx`
Imported: 2026-04-18

MonteRun

Спецификация функции: Runway & Survival Engine

Математическое ядро без LLM и без импровизации.

Документ

02_MonteRun_Runway_And_Survival_Engine_Spec

Статус

Draft v1.0

Назначение. Этот документ описывает одну конкретную функцию продукта MonteRun и фиксирует её цель, логику, интерфейс, правила, метрики и границы реализации для MVP.

1. Цель функции

Посчитать жёсткий baseline: burn rate, runway и survival band на основе прозрачной и детерминированной логики. Это главный источник доверия в продукте.

2. Правило архитектуры

Никакая LLM не участвует в расчёте денег, сроков или вероятностей. Модель получает только уже посчитанный output.

3. Основные выходы

Метрика

Описание

Burn rate

Чистый денежный расход или чистый отрицательный поток в месяц.

Runway

Сколько месяцев пользователь проживёт при текущем режиме.

Stress-adjusted runway

Runway после применения выбранного stress mode.

Survival band

Понятный пользователю диапазон выживаемости, а не псевдоточная магическая цифра.

Supporting values

Net monthly delta, cash floor date, monthly buffer.

4. Расчётные правила

• Расчёт должен быть воспроизводимым при одинаковых входных данных.

• Все assumptions должны быть видимы в коде и документации.

• Нет скрытых оптимистичных коэффициентов ради красивого результата.

• Если uncertainty включена, система должна явно маркировать диапазон, а не притворяться абсолютной точностью.

5. Output contract

Поле

Тип / правило

monthly_income_base

number

monthly_expenses_fixed

number

monthly_delta

number

cash_on_hand

number

runway_months_base

number, >= 0

runway_months_stress

number, >= 0

survival_band

enum: critical / fragile / stable / resilient

calculation_notes

array of deterministic assumptions

6. Guardrails

• Не выдавать инвестиционные рекомендации.

• Не маскировать слабый сценарий мягким текстом.

• Не подменять нехватку данных “умными догадками”.

7. Технический подход MVP

Реализация допустима на Python или TypeScript. Для стартовой версии приоритет у читаемости, тестируемости и явных формул. Производительность важна, но не важнее прозрачности.
