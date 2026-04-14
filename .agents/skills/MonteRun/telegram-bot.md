name: telegram-bot
description: Production Telegram-бот MonteRun. Webhooks-only, ежедневные чекины, MarkdownV2, холодный тон.

## Hard Rules
- Только webhooks. Polling запрещён навсегда.
- Все динамические данные — escape_md() + MarkdownV2
- Максимум один вопрос в день (проверка pending checkin)
- Idempotency checkins: перед отправкой нового — проверять, есть ли уже отправленный сегодня
- Холодный, констатирующий тон. Никакого мотивационного говна.

## recalculate_survival() — envelope-aware
(код из v5 сохранён, но теперь явно берёт result["data"]["survival_probability"])

**Anti-patterns**
- parse_mode='Markdown' с динамикой
- Polling вместо webhook
- Сообщения длиннее 3–4 строк
- Отправка чека без проверки pending
- Игнорирование race condition scheduler/webhook

**Edge cases**
- Пользователь заблокировал бота
- Два чека в один день (race condition)
- Ответ с Markdown-спецсимволами
- API recalculate вернул error или null

**Definition of done**
- Все сообщения в MarkdownV2 + escape_md
- Webhook настроен и работает
- Scheduler в Asia/Almaty
- Idempotency checkins реализован
- recalculate_survival работает с envelope
- Тесты покрывают message formatting, webhook flow, error handling и scheduler behavior

