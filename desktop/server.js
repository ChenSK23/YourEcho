// 有个回音 · 电脑版服务端
// Express + 本地 JSON 文件存储 + DeepSeek（OpenAI 兼容接口）
const express = require('express')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const DATA_DIR = path.join(__dirname, 'data')
const DB_FILE = path.join(DATA_DIR, 'db.json')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const PORT = process.env.PORT || 3000

const HISTORY_LIMIT = 20
const MAX_MESSAGE_LEN = 2000
const MAX_SAMPLE_LEN = 20000

// ---------- 本地存储 ----------
function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
function saveJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
}

fs.mkdirSync(DATA_DIR, { recursive: true })
const db = loadJson(DB_FILE, { profiles: [], messages: [] })
const saveDb = () => saveJson(DB_FILE, db)

const DEFAULT_BASE = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-chat'

// 配置优先级：环境变量 > data/config.json > 默认值
function getLlmConfig() {
  const cfg = loadJson(CONFIG_FILE, {})
  return {
    key: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || cfg.apiKey || '',
    base: (process.env.LLM_BASE_URL || cfg.apiBase || DEFAULT_BASE).replace(/\/+$/, ''),
    model: process.env.LLM_MODEL || cfg.model || DEFAULT_MODEL,
  }
}

// ---------- LLM（任意 OpenAI 兼容接口）----------
async function callLLM(messages, { jsonMode = false, temperature = 0.9, maxTokens = 1024 } = {}) {
  const { key, base, model } = getLlmConfig()
  if (!key) {
    throw new Error('还没有配置 API Key，点右上角「设置」填入')
  }
  const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`

  const attempt = async (useJsonMode) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    })
    const json = await res.json().catch(() => ({}))
    const content = json.choices && json.choices[0] && json.choices[0].message.content
    if (!content) {
      throw new Error(`LLM 调用失败：${JSON.stringify(json).slice(0, 300)}`)
    }
    return content
  }

  try {
    return await attempt(jsonMode)
  } catch (e) {
    // 部分兼容服务不支持 response_format，降级重试一次
    if (jsonMode) return attempt(false)
    throw e
  }
}

// ---------- Prompt 构建（与小程序云函数保持一致）----------
const STYLE_FIELDS =
  `{"summary": "100字以内的说话风格概述", ` +
  `"tone": "语气特征，如温柔/直率/毒舌/敷衍", ` +
  `"addressing": "TA平时怎么称呼对方，如宝贝/直呼其名/起外号/几乎不称呼", ` +
  `"catchphrases": ["口头禅或高频用语，最多8个"], ` +
  `"habits": ["表达习惯，如爱用短句、爱反问、句末语气词、爱省略主语等，最多6条"], ` +
  `"sentenceStyle": "句式与标点习惯，如不用句号、爱用波浪线、问号连用、频繁分行", ` +
  `"emojiStyle": "emoji和表情使用习惯，一句话描述", ` +
  `"replyRhythm": "回复节奏：是否秒回、喜欢一条长消息还是连发好几条短消息", ` +
  `"emotionalStyle": "情绪表达方式：开心、敷衍、不耐烦、关心人时分别什么样", ` +
  `"examples": ["原样摘录TA最典型的消息，5到8条，不要改写"]}`

function buildExtractionMessages(name, relation, sample) {
  return [
    {
      role: 'system',
      content:
        '你是说话风格分析器。从用户提供的聊天片段中，分析指定人物的说话风格。' +
        '只输出合法 JSON，不要输出任何其他文字。',
    },
    {
      role: 'user',
      content:
        `以下是"${name}"（与用户的关系：${relation || '未说明'}）的聊天片段：\n` +
        `---\n${sample}\n---\n` +
        `请只分析"${name}"这个人发出的消息，忽略其他人的消息。如果片段里混有多个人的发言，` +
        `根据上下文、称呼和排版习惯区分。没有把握的字段给空字符串或空数组，不要编造。\n` +
        `输出 JSON，字段如下：\n${STYLE_FIELDS}`,
    },
  ]
}

function buildDescriptionMessages(name, relation, description) {
  return [
    {
      role: 'system',
      content:
        '你是说话风格构建器。根据用户对某人的描述，构建这个人的说话风格画像。' +
        '只输出合法 JSON，不要输出任何其他文字。',
    },
    {
      role: 'user',
      content:
        `用户想让 AI 扮演"${name}"（与用户的关系：${relation || '未说明'}）。\n` +
        `用户对 TA 说话方式的描述：\n---\n${description}\n---\n` +
        `请根据描述合理推断 TA 的风格，输出 JSON，字段如下（拿不准的字段留空，不要硬编；` +
        `examples 字段请根据描述想象 TA 可能会说的话，5到8条）：\n${STYLE_FIELDS}`,
    },
  ]
}

function buildSystemPrompt(profile) {
  const p = profile.styleProfile || {}
  const lines = [
    `你正在扮演"${profile.name}"，与用户的关系是"${profile.relation || '朋友'}"。你的任务是用 TA 的说话方式陪用户聊天。`,
  ]
  if (p.summary) lines.push(`【说话风格概述】${p.summary}`)
  if (p.tone) lines.push(`语气特征：${p.tone}`)
  if (p.addressing) lines.push(`对用户的称呼习惯：${p.addressing}`)
  if (Array.isArray(p.catchphrases) && p.catchphrases.length) {
    lines.push(`口头禅/高频用语：${p.catchphrases.join('、')}`)
  }
  if (Array.isArray(p.habits) && p.habits.length) {
    lines.push(`表达习惯：${p.habits.join('；')}`)
  }
  if (p.sentenceStyle) lines.push(`句式与标点习惯：${p.sentenceStyle}`)
  if (p.emojiStyle) lines.push(`emoji 与表情使用习惯：${p.emojiStyle}`)
  if (p.replyRhythm) lines.push(`回复节奏：${p.replyRhythm}`)
  if (p.emotionalStyle) lines.push(`情绪表达方式：${p.emotionalStyle}`)
  if (Array.isArray(p.examples) && p.examples.length) {
    lines.push('【TA 说过的话（仅作风格参考，不要复述）】')
    p.examples.slice(0, 8).forEach((s) => lines.push(`- ${s}`))
  }
  lines.push(
    '【规则】只输出聊天内容本身，不要解释、不要加角色名前缀、不要用括号描述动作。' +
      '回复的长度和分段方式要贴近 TA 的习惯。' +
      '如果 TA 习惯一次连发多条短消息，用 ||| 分隔各条消息；否则不要使用 |||。' +
      '如果用户询问你是否是 AI 或质疑你的身份，必须诚实承认你是 AI 模拟，不能继续伪装。'
  )
  return lines.join('\n')
}

// ---------- API ----------
const app = express()
app.use(express.json({ limit: '2mb' }))
app.use(express.static(path.join(__dirname, 'public')))

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e)
    res.status(500).json({ error: String(e.message || e).slice(0, 300) })
  })

app.get('/api/status', (req, res) => {
  const { key, base, model } = getLlmConfig()
  res.json({ hasKey: !!key, apiBase: base, model })
})

// 保存 LLM 配置到本地 data/config.json（Key 不会回显）
app.post('/api/config', (req, res) => {
  const cfg = loadJson(CONFIG_FILE, {})
  const { apiKey, apiBase, model } = req.body || {}
  if (typeof apiKey === 'string' && apiKey.trim()) cfg.apiKey = apiKey.trim()
  if (typeof apiBase === 'string' && apiBase.trim()) {
    cfg.apiBase = apiBase.trim().replace(/\/+$/, '')
  }
  if (typeof model === 'string' && model.trim()) cfg.model = model.trim()
  if (!cfg.apiKey) return res.status(400).json({ error: 'API Key 不能为空' })
  saveJson(CONFIG_FILE, cfg)
  res.json({ ok: true })
})

app.get('/api/profiles', (req, res) => {
  const list = db.profiles
    .slice()
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .map(({ id, name, relation, createdAt }) => ({ id, name, relation, createdAt }))
  res.json({ profiles: list })
})

app.post(
  '/api/profiles',
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim()
    const relation = String(req.body.relation || '').trim().slice(0, 20)
    const sample = String(req.body.sampleText || '').trim().slice(0, MAX_SAMPLE_LEN)
    const desc = String(req.body.description || '').trim().slice(0, 2000)

    if (!name || name.length > 30) {
      return res.status(400).json({ error: '请填写角色昵称（30字以内）' })
    }
    if (sample.length < 50 && desc.length < 10) {
      return res.status(400).json({ error: '提供至少 50 字聊天素材，或 10 字以上的风格描述' })
    }

    const messages =
      sample.length >= 50
        ? buildExtractionMessages(name, relation, sample)
        : buildDescriptionMessages(name, relation, desc)
    const raw = await callLLM(messages, { jsonMode: true, temperature: 0.3, maxTokens: 1500 })
    const styleProfile = JSON.parse(raw)

    const profile = {
      id: crypto.randomUUID(),
      name,
      relation,
      styleProfile,
      createdAt: new Date().toISOString(),
      // 原始素材不落盘
    }
    db.profiles.push(profile)
    saveDb()
    res.json({ profile: { id: profile.id, name: profile.name } })
  })
)

app.delete('/api/profiles/:id', (req, res) => {
  const { id } = req.params
  const before = db.profiles.length
  db.profiles = db.profiles.filter((p) => p.id !== id)
  db.messages = db.messages.filter((m) => m.profileId !== id)
  if (db.profiles.length === before) return res.status(404).json({ error: '角色不存在' })
  saveDb()
  res.json({ ok: true })
})

app.get('/api/profiles/:id/messages', (req, res) => {
  const msgs = db.messages
    .filter((m) => m.profileId === req.params.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-100)
    .map(({ id, role, content }) => ({ id, role, content }))
  res.json({ messages: msgs })
})

app.post(
  '/api/chat',
  wrap(async (req, res) => {
    const { profileId } = req.body
    const text = String(req.body.message || '').trim().slice(0, MAX_MESSAGE_LEN)
    const profile = db.profiles.find((p) => p.id === profileId)
    if (!profile) return res.status(404).json({ error: '角色不存在' })
    if (!text) return res.status(400).json({ error: '消息不能为空' })

    const history = db.messages
      .filter((m) => m.profileId === profileId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content }))

    const reply = (
      await callLLM([
        { role: 'system', content: buildSystemPrompt(profile) },
        ...history,
        { role: 'user', content: text },
      ])
    ).trim()

    const now = new Date().toISOString()
    db.messages.push(
      { id: crypto.randomUUID(), profileId, role: 'user', content: text, createdAt: now },
      { id: crypto.randomUUID(), profileId, role: 'assistant', content: reply, createdAt: now }
    )
    saveDb()
    res.json({ reply })
  })
)

app.listen(PORT, () => {
  console.log(`有个回音已启动：http://localhost:${PORT}`)
  if (!getLlmConfig().key) {
    console.log('提示：还没配置 DeepSeek API Key，打开页面后点右上角「设置」填入')
  }
})
