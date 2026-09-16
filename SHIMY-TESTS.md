# Shimy — тестування та підготовка даних

Цей документ містить лише те, що стосується **Shimy**: підготовку тестових користувачів, helper-скрипти, load-тести, env-змінні та типові сценарії запуску.

API:
- REST: `https://api.shimy.app/api/v1`
- WebSocket: `wss://api.shimy.app/ws/connect`

Інструменти:
- [k6](https://k6.io/) для load-тестів
- Node.js для helper-скриптів

---

## 1. Передумови

| Інструмент | Чому потрібно | Встановлення |
|---|---|---|
| k6 >= 0.50 | запускає сценарії навантаження | `brew install k6` |
| Node.js >= 18 | запускає helper-скрипти і генерацію звітів | `brew install node` |

`npm install` не потрібен: проект не використовує зовнішні npm-залежності.

---

## 2. Структура Shimy-частини

```text
load-tests/
├── shimy/
│   ├── lib/
│   │   └── auth.js
│   ├── shimyFeedLoad.js
│   └── shimyChatLoad.js
├── reports/
│   └── Shimy/
│       └── <TIMESTAMP>/
└── shimy/.secrets/
    ├── users.example.json
    ├── users.json
    └── demo-state.json

tools/
├── shimy-bootstrap-chats.mjs
├── shimy-bootstrap-posts.mjs
├── shimy-seed-demo.mjs
├── k6-html-report.mjs
├── k6-compare-index.mjs
└── ...
```

Головні файли:
- `load-tests/shimy/shimyFeedLoad.js` — REST test для feed
- `load-tests/shimy/shimyChatLoad.js` — WebSocket test для chat
- `tools/shimy-bootstrap-posts.mjs` — створення постів для пулу користувачів
- `tools/shimy-seed-demo.mjs` — демо-дані для одного цільового користувача

---

## 3. Підготовка тестових користувачів

Усі Shimy-команди читають пул користувачів із файлу:

```text
load-tests/shimy/.secrets/users.json
```

### Кроки

1. Скопіювати шаблон:

```bash
cp load-tests/shimy/.secrets/users.example.json \
  load-tests/shimy/.secrets/users.json
```

2. Заповнити `users[]` реальними обліковими записами.
3. Ключові поля для кожного користувача:

```json
{
  "id": 1,
  "pair_id": 1,
  "phone_number": "+380...",
  "password": "...",
  "post_id": "..."
}
```

4. Два користувача з однаковим `pair_id` формують чат-пару.
5. Для `bootstrap-chats` або `seed-demo` розумна кількість користувачів — 20+ для нормального тестування, 50+ для стабільних chat load-випробувань.

> Реальний `users.json` і бекапи `*.bak` ігноруються git-ом.

---

## 4. Helper-скрипти

Це не load-тести, а один-shot сценарії для наповнення dev-DB і підготовки контенту для наступних перевірок. У проекті є три основні Shimy helper-скрипти, кожен з яких відповідає за окремий тип підготовки даних.

### 4.0 Короткий довідник по helper-скриптах

| Скрипт | Шлях | Що робить | Основні команди |
|---|---|---|---|
| `shimy-bootstrap-chats.mjs` | `tools/shimy-bootstrap-chats.mjs` | Створює чати для всіх `pair_id` через повний флоу `post → response → approve` | `npm run shimy:bootstrap-chats`, `:dry`, `:force` |
| `shimy-bootstrap-posts.mjs` | `tools/shimy-bootstrap-posts.mjs` | Створює по одному активному посту на кожного користувача пулу | `npm run shimy:bootstrap-posts`, `:dry`, `:force`, `:teardown` |
| `shimy-seed-demo.mjs` | `tools/shimy-seed-demo.mjs` | Сіє контент для одного цільового користувача X: feed + chats | `npm run shimy:seed-demo`, `:dry`, `:teardown` |

### Суть та типи запуску

Усі helper-скрипти підтримують один із трьох типів режимів:

- `default` — виконати дію на реальному API
- `--dry-run` — показати план без виконання запитів
- `--force` або `--teardown` — форсоване перестворення / видалення даних

Типові приклади:

```bash
# idempotent: тільки те, чого ще не існує
npm run shimy:bootstrap-posts

# план без реальних викликів
npm run shimy:bootstrap-chats:dry

# повне перестворення усіх чатів / постів
npm run shimy:bootstrap-chats:force
npm run shimy:bootstrap-posts:force

# повне очищення створених/demo-даних
npm run shimy:bootstrap-posts:teardown
npm run shimy:seed-demo:teardown
```

### Рекомендований порядок підготовки даних

```bash
# 1. підготувати пул користувачів
cp load-tests/shimy/.secrets/users.example.json \
  load-tests/shimy/.secrets/users.json

# 2. створити чати для пар
npm run shimy:bootstrap-chats

# 3. створити по одному активному посту на кожного користувача
npm run shimy:bootstrap-posts

# 4. при потребі — згенерувати демо-контент для одного target user
npm run shimy:seed-demo
```

### 4.1 Bootstrap chats

Команда створює чати для всіх `pair_id` із `users.json`, проходячи повний цикл:

`post -> response -> approve`

```bash
npm run shimy:bootstrap-chats
npm run shimy:bootstrap-chats:dry
npm run shimy:bootstrap-chats:force
```

Що робить:
- читає `users.json`
- для кожної пари створює/поновлює `chat_id`
- записує стан назад у `users.json`
- робить `.bak` резервну копію перед змінами

### 4.2 Bootstrap posts

Команда створює по одному активному посту на кожного користувача пулу. Shimy дозволяє лише один активний пост на користувача.

```bash
npm run shimy:bootstrap-posts
npm run shimy:bootstrap-posts:dry
npm run shimy:bootstrap-posts:force
npm run shimy:bootstrap-posts:teardown
npm run shimy:bootstrap-posts:teardown:dry
```

Пояснення:
- `bootstrap-posts` — idempotent mode: створює пост тільки тим, у кого його немає
- `--force` — видаляє старий активний пост і створює новий
- `--teardown` — видаляє всі пости в пулі без створення нових

Поширені env-змінні:

| Var | Default | Значення |
|---|---|---|
| `LAT`, `LON` | `33.42828810, -117.61373852` | геоцентр для постів |
| `RADIUS_MILES` | `20` | радіус видимості |
| `JITTER_MILES` | `1.5` | випадковий розкид навколо точки |
| `USER_LIMIT` | всі | працювати лише з першими N користувачами |
| `SHIMY_BASE` | `https://api.shimy.app/api/v1` | базовий API URL |

> В `--teardown` режимі `USER_LIMIT` ігнорується: очищення виконується для всього пулу, щоб гарантувати чистий feed для повторного тестування.

### 4.3 Seed demo data

Скрипт `shimy-seed-demo` створює природний демо-контент для одного цільового користувача X.

Мета:
1. створити `FEED_POSTS` постів від різних користувачів пулу біля координат X
2. створити `CHAT_COUNT` чатів між X і іншими користувачами пулу

```bash
npm run shimy:seed-demo
npm run shimy:seed-demo:dry
npm run shimy:seed-demo:teardown
```

Важливі env-змінні:

| Var | Default | Значення |
|---|---|---|
| `TARGET_PHONE` | `+14842690042` | телефон цільового користувача |
| `TARGET_PASSWORD` | `test1234` | пароль цільового користувача |
| `TARGET_LAT` | `33.42828810` | широта |
| `TARGET_LON` | `-117.61373852` | довгота |
| `FEED_POSTS` | `12` | кількість feed-постів |
| `CHAT_COUNT` | `12` | кількість чатів z X |
| `POOL_OFFSET` | `0` | з якого індексу починати вибірку з пулу |
| `JITTER_MILES` | `0.3` | випадковий розкид навколо точки X |

```bash
TARGET_PHONE=+380... TARGET_PASSWORD=secret \
  TARGET_LAT=40.7128 TARGET_LON=-74.0060 \
  FEED_POSTS=20 CHAT_COUNT=10 \
  npm run shimy:seed-demo
```

Створені артефакти зберігаються в:

```text
load-tests/shimy/.secrets/demo-state.json
```

Це потрібно для `--teardown` і очищення демо-даних.

---

## 5. Load-тести для Shimy

Усі тести стартують через `PROFILE` і мають стандартні профілі:
- `smoke`
- `load`
- `stress`

### 5.1 Feed (REST)

Файл: `load-tests/shimy/shimyFeedLoad.js`

Ціль: `GET /api/v1/feed/?radius&latitude&longitude`

Команди:

```bash
npm run shimy:feed
npm run shimy:feed:smoke
npm run shimy:feed:load
npm run shimy:feed:stress
```

Профілі:
- `smoke`: до 10 VU
- `load`: до 200 VU
- `stress`: до 500→1000 VU

Ключові метрики:
- `http_req_duration{...}`
- `http_req_failed`
- `feed_latency_ms`

### 5.2 Chat (WebSocket)

Файл: `load-tests/shimy/shimyChatLoad.js`

Ціль: `wss://api.shimy.app/ws/connect?token=<jwt>`

Режими через `MODE`:
- `send` — стандартний режим, сторінка обмінюється `chat.send` / `chat.message`
- `typing` — легший механізм `chat.typing`, без запису в БД

Команди:

```bash
npm run shimy:chat
npm run shimy:chat:smoke
npm run shimy:chat:load
npm run shimy:chat:load:typing
npm run shimy:chat:stress
npm run shimy:chat:stress:typing
npm run shimy:chat:typing
```

Профілі:
- `smoke`: 10 VU
- `load`: 50 VU
- `stress`: 50 VU, довша сесія

Ключові метрики:
- `socket_connection_failures`
- `socket_session_duration`
- `chat_delivery_latency_ms`
- `ws_close_4409`

> Один і той самий користувач не може мати більше одного активного websocket. Тому `chat` VU жорстко обмежуються розміром пулу (`USERS.length`).

---

## 6. Env-змінні

Основні змінні, які використовуються у Shimy-командах:

| Var | Для чого | Приклад |
|---|---|---|
| `PROFILE` | вибір профілю (`smoke`, `load`, `stress`) | `PROFILE=stress` |
| `MODE` | режим чату (`send`, `typing`) | `MODE=typing` |
| `TIMELINE` | виводити `raw.ndjson` для графіків по часу | `TIMELINE=1` |
| `USER_LIMIT` | обмежити вибірку користувачів | `USER_LIMIT=50` |
| `LAT`, `LON` | геоцентр для feed та постів | `LAT=49.79 LON=24.04` |
| `TARGET_*` | цільовий користувач для demo | `TARGET_PHONE=...` |
| `FEED_POSTS`, `CHAT_COUNT` | кількість demo-даних | `FEED_POSTS=20` |
| `POOL_OFFSET` | зміщення індекса в пулі | `POOL_OFFSET=24` |
| `JITTER_MILES` | рандомізація координат | `JITTER_MILES=0.3` |

Приклади:

```bash
USER_LIMIT=20 TIMELINE=1 npm run shimy:feed:smoke
USER_LIMIT=50 TIMELINE=1 npm run shimy:chat:stress:typing
```

---

## 7. Звіти та артефакти

Кожен запуск k6 пише звіт у папку виду:

```text
load-tests/reports/Shimy/<TIMESTAMP>/
```

Головні файли:
- `summary.html` — інтерактивний HTML-звіт
- `summary.json` — сирий JSON-експорт k6
- `summary.csv` — таблиця метрик
- `summary.md` — короткий висновок
- `meta.json` — метадані про профіль/режим/тест-файл
- `raw.ndjson` — таймлайн даних, якщо `TIMELINE=1`

Порівняльна сторінка оновлюється автоматично:

```text
load-tests/reports/Shimy/index.html
```

---

## 8. Типові сценарії

### 8.1 Перший запуск

```bash
cp load-tests/shimy/.secrets/users.example.json \
  load-tests/shimy/.secrets/users.json

npm run shimy:bootstrap-chats
npm run shimy:feed:smoke
npm run shimy:chat:smoke
```

### 8.2 Повний benchmark цикл

```bash
npm run shimy:bootstrap-chats:force

TIMELINE=1 npm run shimy:feed:load
TIMELINE=1 npm run shimy:chat:load
TIMELINE=1 npm run shimy:chat:load:typing

TIMELINE=1 npm run shimy:feed:stress
TIMELINE=1 npm run shimy:chat:stress
```

### 8.3 Demo для PM / Product

```bash
npm run shimy:seed-demo
# ... ручна перевірка UI ...
npm run shimy:seed-demo:teardown
```

### 8.4 Очистити всі posts у пулі

```bash
npm run shimy:bootstrap-posts:teardown
```

---

## 9. Важливі застереження

- `users.json` — обов'язковий для більшості сценаріїв; його треба заповнити реальними обліковими записами.
- Для chat-тестів key constraint — один websocket на користувача.
- `seed-demo` і `bootstrap-posts` сильно залежать від правильності початкової гео-локації і реальної бази API.
- `TIMELINE=1` збільшує обсяг даних і рекомендований для load/stress сценаріїв, а не для маленьких smoke checks.
- `scripts/k6-run-report.sh` є основним runner-ом для k6 і автоматично генерує HTML/CSV/JSON звіти.

Ця документація містить лише Shimy-області проекту. Для опису Flowk-незалежних сценаріїв дивіться кореневий [README.md](README.md).

---

## Типові сценарії (рецепти)

### Перше налаштування
```bash
# 1. Заповнити users.json (див. «Підготовка тестових юзерів»)
# 2. Створити чати для всіх пар
npm run shimy:bootstrap-chats
# 3. Sanity-перевірка обох ендпоінтів
npm run shimy:feed:smoke
npm run shimy:chat:smoke
```

### Повна сесія тестування (smoke → load → stress)
```bash
# Чати спершу оновити — вони експайряться після ~3 год бездіяльності
npm run shimy:bootstrap-chats:force

npm run shimy:feed:smoke
npm run shimy:chat:smoke

TIMELINE=1 npm run shimy:feed:load
TIMELINE=1 npm run shimy:chat:load
TIMELINE=1 npm run shimy:chat:load:typing

# Stress — пауза ~5 хв між запусками, щоб dev відновився
TIMELINE=1 npm run shimy:feed:stress
TIMELINE=1 npm run shimy:chat:stress
```

### Повторне тестування після бекенд-фіксу (apples-to-apples)
```bash
# Той самий підмножина юзерів, що й минулого разу
export USER_LIMIT=50

npm run shimy:bootstrap-chats:force
npm run shimy:feed:smoke
npm run shimy:chat:smoke
TIMELINE=1 npm run shimy:feed:load
TIMELINE=1 npm run shimy:feed:stress
TIMELINE=1 npm run shimy:chat:stress
```

### Демо для PM на реальному пристрої
```bash
# Координати беремо з РЕАЛЬНОГО feed-запиту юзера (live-GPS), а не з профілю!
TARGET_PHONE=+1... TARGET_PASSWORD=... \
TARGET_LAT=<lat з feed-запиту> TARGET_LON=<lon з feed-запиту> \
npm run shimy:seed-demo

# Після демо
npm run shimy:seed-demo:teardown
```

### Очистити dev-БД від постів пулу (перед A/B порівнянням)
```bash
npm run shimy:bootstrap-posts:teardown
```

---

## Важливі застереження

**1. Чати живуть ~3 години.** Shimy видаляє чат після ~3 год без повідомлень.
Перед тестуванням чату майже завжди потрібен `shimy:bootstrap-chats:force`.

**2. WebSocket: один конект на юзера (код 4409).** Другий WS того ж юзера
закриває перший. Тому chat-тести обмежені розміром пулу. Більше VU = більше
юзерів у `users.json`.

**3. Feed бере LIVE-GPS пристрою, а не профіль.** Координати у feed-запиті
мають ~14 значущих цифр (сирий GPS девайсу). Щоб юзер побачив пости, вони мають
бути в радіусі від його **поточного фізичного положення**, а НЕ:
- координат його старого поста (можуть бути застарілі),
- generic-координат міста з Google (зсув сотні метрів — десятки миль),
- координат профілю в адмінці.
Найнадійніше для демо — взяти координати з **реального feed-запиту** юзера.

**4. Точність координат — не проблема.** Округлення в адмінці (8 знаків) дає
похибку <1 мм, GPS-дрейф нерухомого телефону ~3 см. При радіусі фіда 20 миль
обидва фактори математично невидимі. Значення має лише **груба локація в милях**.

**5. Не гнати stress на «гарячому» сервері.** Між load і stress давати dev
~5 хв на recovery, інакше цифри спотворюються.

**6. Секрети.** `users.json` / `demo-state.json` / `*.bak` — gitignored. У git
комітиться лише `users.example.json` з плейсхолдерами. Перевір перед `git add`,
що реальні креди не потрапляють у `users.example.json`.
