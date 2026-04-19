# MonteRun_PRD

Source: `C:\ForkVerse\MonteRun_PRD.docx`
Imported: 2026-04-18

MonteRun

Product Requirements Document

Версия 1.0  |  Anti-Copium Financial Engine  |  Runway & Survival MVP

Документ

PRD для первого коммерческого MVP MonteRun.

Цель

Определить продуктовые требования, UX-петлю, ядро расчёта, stress modes, tone layering и критерии запуска.

MonteRun превращает финансовую тревогу в пересчитываемую модель выживания.

Продукт не даёт инвестиционных советов и не обещает успех. Он считает реальность: burn rate, runway, стрессовые сценарии и рычаги, которые действительно меняют исход.

1. Product Summary

Жёсткий, но полезный runway simulator для людей, которым нужны цифры вместо копиума.

1.1 Problem Statement

Большинство финансовых приложений либо скучно считают базовые показатели, либо имитируют “умный” коучинг. Пользователь получает красивые советы, но не видит, насколько его план хрупок при реальном стрессе: задержке выплат, падении дохода, неожиданной трате или потере клиента.

1.2 Product Thesis

MonteRun строится вокруг трёх принципов: Math decides. Levers guide. Voice delivers. Сначала движок считает сухую математику, затем показывает наиболее сильные рычаги изменения, и только после этого оборачивает вывод в выбранный verdict style.

1.3 Core Promise

Покажи, сколько ты реально протянешь, если убрать самообман и смоделировать плохие месяцы.

Продуктовая дисциплина: никаких инвестиционных советов, никакой магии LLM в расчётах, никакого фокуса на виральности в ущерб retention.

2. Users and Jobs-to-be-Done

2.1 Primary User

Фрилансер, соло-предприниматель или операционный специалист 20-35 лет с нестабильным денежным потоком. У него есть подушка, хаотичный доход, страх кассового разрыва и постоянные решения под давлением: увольнение, новый проект, крупная покупка, рекламный бюджет, переезд.

2.2 Core Jobs

• Понять, на сколько месяцев хватит денег при текущем burn rate.

• Увидеть, как быстро схлопывается runway при одном плохом месяце.

• Понять, какие 3-5 изменений сильнее всего улучшают выживаемость.

• Сравнить базовый сценарий с stress mode перед важным решением.

• Сохранить и пересчитать сценарий после изменения дохода, расходов или долга.

3. Scope

In Scope for MVP

Out of Scope for MVP

Deferred

Runway & Survival

Инвестиционные советы

Goal probability beyond runway

Levers by impact

Кредитный lead-gen

Saved scenario history

3-4 stress modes

Полноценный B2B portal

Premium exports / PDF reports

Tone layer modes

Голосовой ввод

Bank-grade white-label API

Share card

Marketplace / social feed

Telegram follow-up bot

4. Core User Experience

4.1 Input Layer

• Cash on hand / current savings

• Monthly income (average and range if needed)

• Fixed monthly expenses

• Debt obligations

• Optional one-time expected expense

• Optional toggle for unstable income

4.2 Primary Output

• Base runway in months

• Stress-adjusted runway

• Burn rate

• Survival score or probability band

• Top levers by impact, effort and time-to-effect

• Short verdict in selected delivery voice

4.3 Main Screen Priority

Главный экран должен быть построен вокруг levers, а не вокруг текста. Вердикт даёт удар, но рычаги дают ощущение контроля. Визуальная иерархия экрана:

• Runway (крупное главное число)

• Base vs Stress comparison

• Top 3 levers by impact

• Scenario toggle

• Verdict block

• Share action

5. Functional Requirements

ID

Area

Requirement

Priority

FR-01

Inputs

Система принимает базовые финансовые входы и валидирует пустые/невозможные значения.

P0

FR-02

Math Core

Система рассчитывает burn rate, base runway и cash depletion timeline без участия LLM.

P0

FR-03

Stress Modes

Система выполняет stress runs минимум для 3 сценариев: bad month, income drop, unexpected expense.

P0

FR-04

Levers Engine

Система показывает пользователю 3-5 изменений с наибольшим impact на runway.

P0

FR-05

Tone Layer

Система поддерживает режимы cold, brutal и white-label поверх одного и того же числового ядра.

P1

FR-06

Scenario Compare

Пользователь может переключаться между base и stress результатами без перезагрузки расчёта.

P1

FR-07

Share Card

Система генерирует лаконичную share-card с ключевой цифрой, контекстом и verdict line.

P1

FR-08

Save & Recalc

Пользователь может сохранить текущий сценарий и пересчитать его после изменения параметров.

P2

6. Stress Modes

Stress modes должны моделировать не академические, а узнаваемые жизненные удары. Названия и сценарии должны быть понятны без финансового образования.

Mode

What Happens

Why It Matters

MVP

Late Payments

Часть дохода смещается на следующий месяц.

Бьёт по фрилансерам и агентствам.

Yes

Bad Month

Переменный доход падает, discretionary spend растёт.

Показывает хрупкость базового плана.

Yes

Client Loss

Исчезает ключевой источник дохода.

Проверяет зависимость от одного клиента.

Yes

Emergency Expense

Возникает единоразовая крупная трата.

Показывает, как быстро схлопывается runway.

Yes

7. System Architecture

7.1 Rule of Separation

• Math Core: deterministic engine in Python or TypeScript. No LLM access to financial calculation.

• Scenario Engine: generates baseline and stress outputs plus lever ranking.

• Tone Layer: LLM receives only structured results and converts them into selected verdict style.

• Presentation Layer: fast web UI and share-card renderer.

7.2 Tone Modes

Mode

Audience

Output posture

Usage

brutal

Social / Telegram

Compressed, sharp, memorable, controlled aggression.

Share cards, launch content

cold

Premium user

Sparse, terminal-like, numeric, restrained.

Default serious mode

white-label

B2B / API

Neutral, safe, factual, brand-agnostic.

Future integration layer

8. Success Metrics

8.1 Product Metrics

• Time to first verdict under 60 seconds from opening the product.

• At least 50% of new users interact with one or more levers.

• At least 35% of new users run a stress mode after base scenario.

• Scenario recalculation rate is more important than raw share rate.

• Week-1 return rate is the core retention KPI for MVP.

8.2 Launch Health Signals

• Users understand the main output without tutorial.

• Verdicts feel precise, not gimmicky.

• Levers are actionable and not obvious filler.

• Stress modes create insight, not confusion.

9. Delivery Plan

Sprint

Theme

Deliverables

Exit Criteria

1

Core Engine

Input schema, deterministic math core, base runway, initial lever calculation.

Base outputs are correct and reproducible.

2

Stress Engine

3-4 stress modes, compare view, scenario toggles.

User sees meaningful delta between base and stress.

3

Interface

Minimal SaaS UI, main screen hierarchy, verdict block, tone modes.

First useful result feels premium and instant.

4

Share & Launch

Share-card generator, landing page, analytics, launch copy.

Product is shareable without looking like a meme.

10. Risks and Guardrails

• Risk: product becomes a roast toy instead of a decision tool. Guardrail: levers and recalculation stay above copywriting in priority.

• Risk: model complexity overwhelms onboarding. Guardrail: keep MVP inputs brutally simple.

• Risk: weak lever suggestions reduce trust. Guardrail: rank levers by explicit math, not handcrafted text.

• Risk: tone becomes too clownish. Guardrail: define verdict policies and approved output behavior.

• Risk: future B2B distracts the team. Guardrail: no bank/API work before retention proof.

11. Decision Summary

MonteRun MVP is a runway and survival simulator for people who want numbers instead of copium. The MVP succeeds if users do not just read a verdict, but interact with levers, test stress scenarios, and return whenever reality changes.

Internal rule: retention beats virality, math beats tone, and scenario clarity beats feature breadth.
