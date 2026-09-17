# Flowk — legacy load tests

Цей документ містить лише те, що стосується **Flowk**: legacy API сценарії, WebSocket тести і базові load-патерни для існуючої платформи.

Цей файл є окремим доменом у репозиторії: Shimy-скрипти живуть у `load-tests/shimy/` і `tools/shimy-*.mjs`, а Flowk-скрипти тепер відокремлені в `load-tests/flowk/`.

---

## 1. Що відноситься до Flowk

Основні Flowk-скрипти:

- `load-tests/flowk/discoveryLoadTest.js`
- `load-tests/flowk/discoveryLoadTest_test.js`
- `load-tests/flowk/feedLoad.js`
- `load-tests/flowk/likeLoadTest.js`
- `load-tests/flowk/badgetTest.js`
- `load-tests/flowk/requestFlowks.js`
- `load-tests/flowk/showCommentsLoad.js`
- `load-tests/flowk/websocketLoad_test.js`

Вони напряму тестують Flowk API і WebSocket endpoints, наприклад:

- `https://api.letsflowk.com/v1/flowk/discovery?...`
- `https://devapi.letsflowk.com/v1/flowk/like/...`
- `https://devapi.letsflowk.com/v1/comment/...`
- `ws://stageapi.letsflowk.com:2347?...`

---

## 2. Типи сценаріїв

### 2.1 Discovery / feed-like browsing

- `discoveryLoadTest.js`
- `discoveryLoadTest_test.js`

Мета: перевірити швидкість завантаження / discovery-ендпоінтів під навантаженням.

### 2.2 Feed / реальний socket потік

- `feedLoad.js`
- `websocketLoad_test.js`

Мета: перевірити потік даних через WebSocket/фід-ендпоінт і це вже не є Shimy.

### 2.3 Like / comments / badget

- `likeLoadTest.js`
- `showCommentsLoad.js`
- `badgetTest.js`

Мета: перевірити окремі business-флоу, що відносяться до Flowk product API.

---

## 3. Базові команди запуску

Загальний раннер:

```bash
./scripts/k6-run-report.sh flowk/discoveryLoadTest.js
./scripts/k6-run-report.sh flowk/feedLoad.js
./scripts/k6-run-report.sh flowk/likeLoadTest.js
```

Крізь npm:

```bash
npm run flowk:discovery
npm run flowk:feed
npm run flowk:comments
npm run flowk:like
npm run flowk:badget
```

---

## 4. Принципи розділення з Shimy

Репозиторій має бути візуально і логічно розділений так:

- Flowk = `load-tests/flowk/*.js` + legacy endpoints
- Shimy = `load-tests/shimy/*.js` + `tools/shimy-*.mjs`
- Спільне = `scripts/k6-run-report.sh`, генерація HTML/CSV/JSON, порівняння звітів

Тобто, загальні інструменти для звітів залишаються спільними, але domain-specific сценарії і data-prep logic мають жити окремо.

---

## 5. Примітки

- Flowk сценарії в цьому репозиторії виглядають як legacy quick checks і не мають окремого helper-пула користувачів, як у Shimy.
- Shimy має окрему секретну папку `load-tests/shimy/.secrets/` і окремі сценарії bootstrap/data seeding.
- Репозиторій уже розділений на окремі каталоги `flowk/` і `shimy/`, а цей документ служить опорним переліченням Flowk-модулів.
