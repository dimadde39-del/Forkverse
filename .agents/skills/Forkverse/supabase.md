name: supabase
description: Production Supabase интеграция ForkVerse. RLS first, schema, triggers, service_role.

## Hard Rules
- RLS включён на **каждой** таблице
- service_role ключ — только в server-side коде (бот, Vercel functions). На клиенте — только anon_key.
- Все privileged операции проходят через server-side client / service layer.
- updated_at обновляется **только** триггером БД
- Все foreign key связи — с on delete cascade где логично (simulations → patches, simulations → checkins и т.д.)

**Anti-patterns**
- Ручное updated_at в коде
- service_role на клиенте
- Новая таблица без RLS
- .select('*') без необходимости
- Игнорирование usage tracking
- Отсутствие on delete cascade на связанных таблицах

**Edge cases**
- Пользователь удалён из auth.users
- Telegram token уже использован
- Pending checkin + новая симуляция
- Гонка при increment usage (одновременные запросы)
- Месячный лимит исчерпан ровно в момент запроса

**Definition of done**
- RLS включён и проверен для каждой таблицы
- updated_at обновляется только триггером
- Профили создаются через upsert без ручного timestamp
- Все серверные вызовы используют service_role через server-side client
- on delete cascade настроен где нужно
- Типы Database сгенерированы и используются
- Usage tracking проверяется перед каждой симуляцией
