# YourEcho · 有个回音

> You say something — and it answers in their voice.

YourEcho lets you import a saved chat history, distill a person's speaking style (catchphrases, punctuation habits, reply rhythm…), and then chat with an AI that talks the way they did.

[English](#english) · [中文](#中文)

---

## English

### Two flavors

| Directory | Form | For |
|---|---|---|
| `desktop/` | **Desktop app** (Node + browser, runs locally) | Download & run; data stays on your machine |
| `miniprogram/` + `cloudfunctions/` | WeChat Mini-Program (WeChat CloudBase) | Mobile use; requires your own appid & cloud env |

### Desktop — quick start

**Requires**: Node.js ≥ 18

```bash
cd desktop
npm install
npm start
```

Open <http://localhost:3000>, click **Settings** (top-right) and configure your LLM — **any OpenAI-compatible API works** (DeepSeek, OpenAI, Qwen, GLM, local Ollama…): API base URL, key and model name. Defaults are [DeepSeek](https://platform.deepseek.com) (`sk-…`, a few dollars lasts a long time). Then:

1. **Summon an echo**: name the person → paste chat history (≥50 chars) or import a `.txt` file — no history? Just describe their style in a few lines
2. **Chat**: click a card on the left; the AI replies in their voice. People who send bursts of short messages will actually burst into multiple bubbles

Config is stored at `desktop/data/config.json`; all profiles & chats live in `desktop/data/db.json`. Both are gitignored.

You can also configure via environment variables:

```bash
LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-chat npm start
```

### Features

- Two creation modes: distill from real chat logs, or build from a free-text description
- 9-dimension style profile: summary, tone, addressing, catchphrases, habits, sentence/punctuation style, emoji usage, reply rhythm, emotional expression
- Message-burst simulation (`|||` split → sequential bubbles with typing effect)
- Local persistence; deleting a profile cascades all its messages

### WeChat Mini-Program

Requires: WeChat DevTools + your own appid + CloudBase env + `LLM_API_KEY` (env vars `LLM_BASE_URL`/`LLM_MODEL` optional, default DeepSeek).

Deployment steps, DB schema and compliance notes: see [AGENTS.md](./AGENTS.md). `appid` in `project.config.json` is set to `touristappid` — replace with your own to publish.

### Privacy & compliance

- Raw chat material is used **once** to build the style profile and is never stored
- Material about third parties: living people require informed consent; for the deceased, you must be a close relative and the material must be chats between you two
- Every AI reply is labeled as simulated; the AI must admit it's a simulation when asked
- Built for remembrance — please use it gently

### Tech stack

- Desktop: Node 18+ / Express / vanilla JS SPA / JSON file store
- Mini-Program: TypeScript + SCSS / WeChat CloudBase (functions + database)
- LLM: any OpenAI-compatible chat API (default `deepseek-chat`)

### License

MIT

---

## 中文

你说的话，TA 的语气替你回答。

导入一段你保存的聊天记录，AI 提炼出那个人的说话风格（口头禅、标点习惯、回复节奏……），之后以 TA 的方式和你对话。

### 两种形态

| 目录 | 形态 | 适用 |
|---|---|---|
| `desktop/` | **电脑版**（Node + 浏览器，本地运行） | 下载即用，数据只在自己电脑上 |
| `miniprogram/` + `cloudfunctions/` | 微信小程序（云开发） | 手机上用，需要自己的小程序账号和云环境 |

### 电脑版 · 开箱即用

**要求**：Node.js ≥ 18

```bash
cd desktop
npm install
npm start
```

打开 <http://localhost:3000>，右上角「设置」配置 LLM——**任意 OpenAI 兼容接口都行**（DeepSeek / OpenAI / 通义 / GLM / Ollama 本地…）：填接口地址、API Key、模型名。默认是 [DeepSeek](https://platform.deepseek.com)（sk- 开头，几块钱能用很久）。然后：

1. **召唤一个回音**：填昵称 → 粘贴聊天记录（≥50字）或导入 `.txt`，没有素材就写几句风格描述
2. **开聊**：点左侧卡片进入对话，AI 按画像的语气回复，爱连发短句的人会真的连发多条气泡

配置保存位置：`desktop/data/config.json`；所有角色和对话在 `desktop/data/db.json`。这两个文件已被 `.gitignore` 排除，不会上传。

也可以用环境变量提供配置：

```bash
LLM_API_KEY=sk-xxx LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-chat npm start
```

### 功能

- 双模式建角色：聊天素材提炼 / 纯文字描述构建
- 9 维风格画像：概述、语气、称呼、口头禅、表达习惯、句式标点、emoji 习惯、回复节奏、情绪表达
- 连发短消息模拟（`|||` 分条 → 多气泡逐条打字机）
- 对话历史本地持久化，删除角色级联清空

### 微信小程序版

需要：微信开发者工具 + 自己的小程序 appid + 云开发环境 + `LLM_API_KEY`（`LLM_BASE_URL`/`LLM_MODEL` 可选，默认 DeepSeek）。

部署步骤、数据库结构、合规要求见 [AGENTS.md](./AGENTS.md)。`project.config.json` 里的 `appid` 已置为 `touristappid`，开发时换成自己的。

### 隐私与合规

- 聊天素材只用于一次性提炼风格画像，**原始文本不保存**
- 素材涉及第三人：在世者须知情同意；已故者须为其近亲属且素材为你们之间的聊天内容
- 所有 AI 回复都有"模拟生成"标识；AI 被问身份时必须承认是模拟
- 本工具用于思念陪伴，请理性使用

### 技术栈

- 电脑版：Node 18+ / Express / 原生 JS SPA / JSON 文件存储
- 小程序：TypeScript + SCSS / 微信云开发（云函数+云数据库）
- LLM：任意 OpenAI 兼容对话接口（默认 `deepseek-chat`）

### License

MIT
