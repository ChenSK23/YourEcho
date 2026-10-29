# 有个回音 — 项目说明

（原名「念想」，因小程序名称占用改名。）

微信小程序：用户主动提供聊天素材 → 云函数提炼"说话风格画像" → 以该风格与用户对话。

## 技术栈

- 微信小程序：TypeScript + SCSS，目录 `miniprogram/` + 云函数 `cloudfunctions/`（`appid` 为 touristappid 游客模式，开发时替换为自己的）
- 电脑版：`desktop/` —— Express + 原生 JS SPA + `data/db.json` 文件存储，`npm install && npm start` 即用；API Key 存 `data/config.json` 或环境变量
- LLM：任意 OpenAI 兼容接口，默认 `deepseek-chat`。配置键：`LLM_API_KEY`（兼容旧名 `DEEPSEEK_API_KEY`）、`LLM_BASE_URL`、`LLM_MODEL`；小程序版在云函数环境变量配置（`LLM_BASE_URL` 须为 https）

电脑版与小程序版差异：无 msgSecCheck / OCR / openid；prompt 构建逻辑两端保持一致（`server.js` 与 `cloudfunctions/chat`+`extractStyle` 同构，改动需同步）。

## 云资源准备（首次部署）

1. **开通云开发环境**：开发者工具 → 云开发 → 创建环境。
2. **创建数据库集合**（云开发控制台 → 数据库），权限均设为"仅创建者可读写"：
   - `profiles` — `{ _openid, name, relation, avatarFileID, styleProfile, createdAt }`
     - `styleProfile` 字段：`summary/tone/addressing/catchphrases[]/habits[]/sentenceStyle/emojiStyle/replyRhythm/emotionalStyle/examples[]`
   - `conversations` — `{ _openid, profileId, lastMessage, updatedAt, createdAt }`
   - `messages` — `{ _openid, conversationId, role, content, createdAt }`
3. **部署云函数**（开发者工具中右键函数目录 → 上传并部署：云端安装依赖）：
   - `chat`、`extractStyle`、`deleteProfile`、`ocrText`
4. **配置 LLM**：云函数 `chat` 和 `extractStyle` 的环境变量中设置 `LLM_API_KEY`（`LLM_BASE_URL`/`LLM_MODEL` 可选，默认 DeepSeek；`LLM_BASE_URL` 须为 https）。
5. `chat` / `extractStyle` 的 `config.json` 已声明 `security.msgSecCheck` 权限和 60s 超时，部署后可在控制台确认生效。

## 数据流

> 注意：云函数中 `db.add` 不会自动写入 `_openid`，所有 `profiles`/`conversations`/`messages` 的 add 都必须显式带 `_openid: OPENID`，否则归属校验和小程序端"仅创建者可读写"权限都会失败。

- 建角色（两种模式，`create` 页）：
  - 素材模式：粘贴文本 / 导入 txt / 上传聊天截图（`ocrText` 函数 OCR 后回填）→ `extractStyle`（msgSecCheck → DeepSeek 抽取 JSON 画像 → 写 `profiles`）。原始素材与临时截图均不落库。
  - 描述模式：无素材时填 ≥10 字风格描述 → `extractStyle` 按描述构建画像（examples 为想象生成）。
- 对话：`chat` 页 → `chat` 云函数（校验归属 → msgSecCheck 入参 → 读最近 20 条历史 → DeepSeek → msgSecCheck 回复 → 写 `messages`）。回复中 `|||` 表示连发消息，前端拆成多气泡。
- 删除：首页长按卡片 → `deleteProfile` 级联删除会话、消息、头像文件。

## 云函数清单

| 函数 | 职责 | openapi 权限 |
|---|---|---|
| `extractStyle` | 素材→风格画像 / 描述→风格画像 | `security.msgSecCheck` |
| `chat` | 对话生成 | `security.msgSecCheck` |
| `ocrText` | 截图 OCR（printedText），临时图片即删 | `ocr.printedText` |
| `deleteProfile` | 级联删除角色数据 | — |

## 合规要求

- 聊天页常驻"AI 模拟"标识；首次进入有知情弹窗；`pages/privacy` 为隐私政策页。
- 所有进出文本必须过 `msgSecCheck`，不要绕过。
- AI 被问及身份时必须承认是模拟（见 `buildSystemPrompt` 护栏）。

## 本地开发

- 微信开发者工具打开项目根目录；编译插件已启用 TypeScript + SCSS。
- 类型检查：`npx tsc --noEmit`（需先 `npm install`）。
- `util.ts` 为脚手架保留的通用工具，当前未使用。

## 已知限制 / 后续项

- 回复为非流式（云函数一次性返回），前端用打字机效果模拟；如需真流式可换云托管 + `wx.request` chunked/SSE。
- 历史消息每会话最多读最近 50 条，未做分页加载。
- 限流：`chat` 每 openid 每分钟 20 条、`extractStyle` 每分钟 3 次（靠 `createdAt` 计数实现，无额外存储）。
