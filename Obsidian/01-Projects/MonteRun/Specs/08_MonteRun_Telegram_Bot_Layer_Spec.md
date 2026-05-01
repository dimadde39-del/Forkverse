# 08_MonteRun_Telegram_Bot_Layer_Spec

Source: `C:\ForkVerse\08_MonteRun_Telegram_Bot_Layer_Spec.docx`
Imported: 2026-04-18

Current launch-hardening status: updated 2026-05-01.

MonteRun

Спецификация функции: Telegram Bot Layer

Быстрые пересчёты и допросы без трения.

Документ

08_MonteRun_Telegram_Bot_Layer_Spec

Статус

Draft v1.0

Назначение. Этот документ описывает одну конкретную функцию продукта MonteRun и фиксирует её цель, логику, интерфейс, правила, метрики и границы реализации для MVP.

1. Цель функции

Дать пользователю быстрый канал для micro-updates и пересчётов без захода на полный веб-интерфейс.

2. Роль в продукте

Telegram нужен не как отдельный продукт, а как retention layer: лёгкий способ обновить данные, пересчитать сценарий и напомнить о хрупкости плана.

Current shipped loop: Telegram Drift Alerts exist as a lightweight retention path. The share card can open Telegram with a start token, `/api/tg_webhook` stores a row in Supabase `user_alerts`, and protected `/api/cron/drift` sends the 7-day drift prompt through Telegram `sendMessage`.

3. Основные команды / действия MVP

Функция

Описание

Open current runway

Показать краткий summary текущего сценария.

Update income

Обновить доход и пересчитать.

Update expense

Добавить или изменить расход.

Run stress mode

Проверить Bad Month / Late Payments и т.п.

View top levers

Вернуть 3 главных рычага.

Current launch subset

Function

Description

Track survival from share card

Telegram `/start` accepts a compact runway token and registers the user for drift alerting.

7-day drift alert

Cron finds `user_alerts` rows older than 7 days with no `last_pinged_at`, sends the survival prompt, then marks the row pinged.

Privacy boundary

Stores only Telegram id, last runway months, `created_at`, and `last_pinged_at`; raw scenario text, verdict copy, and share URL params are not stored for this alert loop.

4. UX-принципы

• Один вопрос за сообщение.

• Минимум клавиатурного трения.

• Короткие ответы, пригодные для мобильного экрана.

• Переход в веб только там, где требуется большой визуальный экран.

5. Tone use

По умолчанию Telegram может использовать brutal или cold mode. Но даже brutal mode должен оставаться контролируемым verdict style, а не шутовским флудом.

6. Не делаем в MVP

• Сложные ветвящиеся сценарии диалога.

• Голосовые ответы.

• Автоматические ежедневные допросы без доказанного product-market fit.

• Multi-agent Telegram backend chains. The current launch loop is deterministic webhook/cron plumbing plus Telegram `sendMessage`.
