const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const HISTORY_LIMIT = 20
const MAX_MESSAGE_LEN = 2000
const RATE_LIMIT_PER_MIN = 20

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
    temperature: options.temperature ?? 0.9,
    max_tokens: options.maxTokens ?? 1024,
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { profileId, message } = event

  if (!profileId || typeof message !== 'string' || !message.trim()) {
    return { code: 400, error: '参数不完整' }
  }
  const text = message.trim().slice(0, MAX_MESSAGE_LEN)

  const profileRes = await db
    .collection('profiles')
    .doc(profileId)
    .get()
    .catch(() => null)
  const profile = profileRes && profileRes.data
  if (!profile || profile._openid !== OPENID) {
    return { code: 403, error: '角色不存在或无权访问' }
  }

  if (!(await checkText(OPENID, text))) {
    return { code: 451, error: '消息未通过内容安全检测，请换一种表达' }
  }

  // 限流：每分钟最多 RATE_LIMIT_PER_MIN 条
  const recent = await db
    .collection('messages')
    .where({
      _openid: OPENID,
      role: 'user',
      createdAt: _.gt(new Date(Date.now() - 60 * 1000)),
    })
    .count()
  if (recent.total >= RATE_LIMIT_PER_MIN) {
    return { code: 429, error: '说得太快啦，歇一会儿再聊' }
  }

  // 一个 openid + profile 对应一条会话
  const convRes = await db
    .collection('conversations')
    .where({ _openid: OPENID, profileId })
    .limit(1)
    .get()
  let conversationId
  if (convRes.data.length) {
    conversationId = convRes.data[0]._id
  } else {
    const created = await db.collection('conversations').add({
      data: {
        _openid: OPENID,
        profileId,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    })
    conversationId = created._id
  }

  const historyRes = await db
    .collection('messages')
    .where({ _openid: OPENID, conversationId })
    .orderBy('createdAt', 'desc')
    .limit(HISTORY_LIMIT)
    .get()
  const history = historyRes.data
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }))

  const llmMessages = [
    { role: 'system', content: buildSystemPrompt(profile) },
    ...history,
    { role: 'user', content: text },
  ]

  let reply
  try {
    reply = (await callDeepSeek(llmMessages)).trim()
  } catch (e) {
    console.error('DeepSeek call failed', e)
    return { code: 502, error: 'AI 服务暂时不可用，请稍后再试' }
  }

  if (!(await checkText(OPENID, reply))) {
    reply = '……这个话题我不太想接，咱们聊点别的吧。'
  }

  const now = db.serverDate()
  await db.collection('messages').add({
    data: { _openid: OPENID, conversationId, role: 'user', content: text, createdAt: now },
  })
  await db.collection('messages').add({
    data: { _openid: OPENID, conversationId, role: 'assistant', content: reply, createdAt: now },
  })
  await db
    .collection('conversations')
    .doc(conversationId)
    .update({ data: { updatedAt: now, lastMessage: reply.slice(0, 50) } })

  return { code: 0, reply }
}
