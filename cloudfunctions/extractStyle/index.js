const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_SAMPLE_LEN = 20000
const CHECK_CHUNK = 2000
const RATE_LIMIT_PER_MIN = 3

async function checkText(openid, content) {
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: 4,
      version: 2,
      content,
    })
    if (res.errCode !== 0) {
      console.error('msgSecCheck rejected', res.errCode, res.errMsg)
    }
    return res.errCode === 0
  } catch (e) {
    console.error('msgSecCheck threw', e)
    return false
  }
}

// 素材太长时抽样检测头/中/尾三段，兼顾安全与耗时
async function checkSample(openid, text) {
  if (text.length <= CHECK_CHUNK) return checkText(openid, text)
  const chunks =
    text.length <= CHECK_CHUNK * 3
      ? [text.slice(0, CHECK_CHUNK), text.slice(-CHECK_CHUNK)]
      : [
          text.slice(0, CHECK_CHUNK),
          text.slice(Math.floor(text.length / 2), Math.floor(text.length / 2) + CHECK_CHUNK),
          text.slice(-CHECK_CHUNK),
        ]
  for (const c of chunks) {
    if (!(await checkText(openid, c))) return false
  }
  return true
}

const LLM_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com'
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat'

function callDeepSeek(messages, options = {}) {
  if (!LLM_API_KEY) {
    return Promise.reject(new Error('LLM_API_KEY 环境变量未配置'))
  }
  const base = new URL(LLM_BASE_URL)
  const reqPath = base.pathname.endsWith('/chat/completions')
    ? base.pathname
    : `${base.pathname.replace(/\/+$/, '')}/chat/completions`
  const body = JSON.stringify({
    model: LLM_MODEL,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 1500,
    response_format: { type: 'json_object' },
  })
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: base.host,
        path: reqPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LLM_API_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 55000,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            const content = json.choices && json.choices[0] && json.choices[0].message.content
            if (content) resolve(content)
            else reject(new Error(`DeepSeek error: ${data.slice(0, 300)}`))
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('DeepSeek request timeout')))
    req.on('error', reject)
    req.end(body)
  })
}

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
        `输出 JSON，字段如下：\n` +
        `{"summary": "100字以内的说话风格概述", ` +
        `"tone": "语气特征，如温柔/直率/毒舌/敷衍", ` +
        `"addressing": "TA平时怎么称呼对方，如宝贝/直呼其名/起外号/几乎不称呼", ` +
        `"catchphrases": ["口头禅或高频用语，最多8个"], ` +
        `"habits": ["表达习惯，如爱用短句、爱反问、句末语气词、爱省略主语等，最多6条"], ` +
        `"sentenceStyle": "句式与标点习惯，如不用句号、爱用波浪线、问号连用、频繁分行", ` +
        `"emojiStyle": "emoji和表情使用习惯，一句话描述", ` +
        `"replyRhythm": "回复节奏：是否秒回、喜欢一条长消息还是连发好几条短消息", ` +
        `"emotionalStyle": "情绪表达方式：开心、敷衍、不耐烦、关心人时分别什么样", ` +
        `"examples": ["原样摘录TA最典型的消息，5到8条，不要改写"]}`,
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
        `请根据描述合理推断 TA 的风格，输出 JSON，字段如下（拿不准的字段留空，不要硬编）：\n` +
        `{"summary": "100字以内的说话风格概述", ` +
        `"tone": "语气特征", ` +
        `"addressing": "TA可能怎么称呼对方", ` +
        `"catchphrases": ["口头禅或高频用语，最多8个"], ` +
        `"habits": ["表达习惯，最多6条"], ` +
        `"sentenceStyle": "句式与标点习惯", ` +
        `"emojiStyle": "emoji和表情使用习惯，一句话描述", ` +
        `"replyRhythm": "回复节奏：一条长消息还是连发好几条短消息", ` +
        `"emotionalStyle": "情绪表达方式", ` +
        `"examples": ["根据描述想象TA可能会说的话，5到8条"]}`,
    },
  ]
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { name, relation, sampleText, description } = event

  if (typeof name !== 'string' || !name.trim() || name.trim().length > 30) {
    return { code: 400, error: '请填写角色昵称（30字以内）' }
  }

  // 限流：每分钟最多创建 RATE_LIMIT_PER_MIN 个角色
  const recent = await db
    .collection('profiles')
    .where({ _openid: OPENID, createdAt: _.gt(new Date(Date.now() - 60 * 1000)) })
    .count()
  if (recent.total >= RATE_LIMIT_PER_MIN) {
    return { code: 429, error: '创建太频繁了，歇一会儿再试' }
  }

  const sample = typeof sampleText === 'string' ? sampleText.trim().slice(0, MAX_SAMPLE_LEN) : ''
  const desc = typeof description === 'string' ? description.trim().slice(0, 2000) : ''
  const hasSample = sample.length >= 50
  const hasDesc = desc.length >= 10
  if (!hasSample && !hasDesc) {
    return { code: 400, error: '提供至少 50 字聊天素材，或 10 字以上的风格描述' }
  }

  if (hasSample && !(await checkSample(OPENID, sample))) {
    return { code: 451, error: '素材未通过内容安全检测，请检查文本内容' }
  }
  if (hasDesc && !(await checkText(OPENID, desc))) {
    return { code: 451, error: '风格描述未通过内容安全检测，请换一种表达' }
  }

  let styleProfile
  try {
    // 有素材优先从记录分析，否则按描述构建
    const messages = hasSample
      ? buildExtractionMessages(name.trim(), relation, sample)
      : buildDescriptionMessages(name.trim(), relation, desc)
    const raw = await callDeepSeek(messages)
    styleProfile = JSON.parse(raw)
  } catch (e) {
    console.error('style extraction failed:', e.message || e)
    return { code: 502, error: '风格分析失败，请稍后再试' }
  }

  const res = await db.collection('profiles').add({
    data: {
      _openid: OPENID,
      name: name.trim(),
      relation: (relation || '').trim().slice(0, 20),
      avatarFileID: event.avatarFileID || '',
      styleProfile,
      createdAt: db.serverDate(),
      // 原始素材不落地存储
    },
  })

  return { code: 0, profileId: res._id, styleProfile }
}
