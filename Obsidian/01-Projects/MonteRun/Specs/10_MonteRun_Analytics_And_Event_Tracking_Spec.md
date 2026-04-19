# 10_MonteRun_Analytics_And_Event_Tracking_Spec

Source: `C:\ForkVerse\10_MonteRun_Analytics_And_Event_Tracking_Spec.docx`
Imported: 2026-04-18

MonteRun

Спецификация функции: Analytics & Event Tracking

Что измерять, чтобы не жить в иллюзиях.

Документ

10_MonteRun_Analytics_And_Event_Tracking_Spec

Статус

Draft v1.0

Назначение. Этот документ описывает одну конкретную функцию продукта MonteRun и фиксирует её цель, логику, интерфейс, правила, метрики и границы реализации для MVP.

1. Цель функции

Измерять не vanity-метрики, а признаки реальной полезности: lever interaction, stress usage, recalculation and return rate.

2. North-star mindset

Retention важнее share rate. Если люди не пересчитывают сценарии после первого вау-момента, продукт пока не доказал ценность.

3. Базовые события MVP

Event

Зачем нужен

input_submitted

Понять конверсию в первый verdict.

first_verdict_rendered

Контроль time-to-value.

lever_opened

Понять, взаимодействуют ли с ключевой частью продукта.

stress_mode_run

Проверить полезность stress engine.

scenario_saved

Измерить намерение вернуться.

scenario_recalculated

Главный сигнал usefulness.

share_card_generated

Вторичная, не основная метрика.

4. KPI MVP

• Time to first verdict under 60 seconds.

• At least 50% users interact with one or more levers.

• At least 35% users run a stress mode.

• Week-1 return rate is a core decision metric.

5. Guardrails

• Не оптимизировать продукт под share rate в ущерб recalculation.

• Не путать открытие карточки с реальной полезностью.

• Считать retention по meaningful actions, а не по пустым визитам.
