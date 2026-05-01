# 00_MonteRun_Function_Document_Map

Source: `C:\ForkVerse\00_MonteRun_Function_Document_Map.docx`
Imported: 2026-04-18

Current launch-hardening status: updated 2026-05-01. The canonical trio plus current notes in this Specs folder override older imported `.docx` wording when there is a conflict.

MonteRun

Карта документов и индекс функций

Общий index всех feature specs MonteRun.

Документ

00_MonteRun_Function_Document_Map

Статус

Draft v1.0

Назначение. Этот документ описывает одну конкретную функцию продукта MonteRun и фиксирует её цель, логику, интерфейс, правила, метрики и границы реализации для MVP.

1. Назначение пакета

Этот файл связывает PRD и отдельные спецификации по функциям. Он нужен, чтобы команда быстро понимала, где лежит логика расчёта, где описан интерфейс, где зафиксированы tone policies и где находятся будущие расширения.

2. Набор документов

Документ

Что покрывает

01. Input & Onboarding

Сбор первичных данных, форматы, UX первого расчёта, валидация, правила простоты.

02. Runway & Survival Engine

Детерминированная математика, burn, runway, survival score, ограничения расчёта.

03. Levers Engine & Main Screen

Главный экран, ранжирование рычагов, визуальная иерархия, action loop.

04. Stress Modes

Плохие сценарии, названия режимов, логика и ожидаемый эффект на runway.

05. Verdict Voice Layer

Tone modes, output rules, white-label safety, praise discipline.

06. Scenario Recalculation & History

Сохранение сценариев, delta view, повторный расчёт и возвращаемость. Current launch subset: browser baseline/latest state for what-if and sharing.

07. Share Card Generator

Карточки для шерина, структура данных, визуальные правила и экспорт. Current: Delta Share Card with localStorage, URL params, `/share`, and `/api/og`.

08. Telegram Bot Layer

Диалоги, быстрые пересчёты, micro-prompts, deep link flow. Current: Telegram Drift Alerts via Supabase `user_alerts`, protected cron, and Telegram `sendMessage`.

09. Landing Page & Acquisition

Лендинг, ценностное предложение, воронка запуска и CTA.

10. Analytics & Event Tracking

События, продуктовые метрики, health signals и launch instrumentation.

11. White-Label Readiness

Готовность ядра к B2B без токсичного тона и без переписывания движка.

3. Правило приоритета

Если документы конфликтуют между собой, приоритет такой: canonical trio -> current implementation notes -> PRD -> детерминированная математика -> feature spec -> copy/tone guidance. Текст никогда не должен ломать математику.

4. Рекомендуемый порядок разработки

• Input & Onboarding

• Runway & Survival Engine

• Levers Engine & Main Screen

• Stress Modes

• Scenario Recalculation & History

• Verdict Voice Layer

• Share Card Generator

• Analytics & Event Tracking

• Telegram Bot Layer

• Landing Page & Acquisition

• White-Label Readiness
