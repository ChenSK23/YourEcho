// chat.ts 对话页
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ChatResult {
  code: number
  reply?: string
  error?: string
}

const HISTORY_LIMIT = 50

Page({
  data: {
    profileId: '',
    messages: [] as ChatMessage[],
    input: '',
    sending: false,
    scrollInto: '',
  },

  msgSeq: 0,
  typingTimer: 0,
  bubbleTimer: 0,
  unloaded: false,

  onLoad(query: Record<string, string | undefined>) {
    const profileId = query.profileId || ''
    const name = decodeURIComponent(query.name || '')
    this.setData({ profileId })
    if (name) wx.setNavigationBarTitle({ title: name })
    this.loadHistory()
  },

  onUnload() {
    this.unloaded = true
    clearInterval(this.typingTimer)
    clearTimeout(this.bubbleTimer)
  },

  async loadHistory() {
    try {
      const db = wx.cloud.database()
      const convRes = await db
        .collection('conversations')
        .where({ profileId: this.data.profileId })
        .limit(1)
        .get()
      if (!convRes.data.length) return

      const msgRes = await db
        .collection('messages')
        .where({ conversationId: convRes.data[0]._id })
        .orderBy('createdAt', 'asc')
        .limit(HISTORY_LIMIT)
        .get()

      const messages = msgRes.data.map((m) => ({
        id: String(m._id),
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
      }))
      this.msgSeq = messages.length
      this.setData({ messages })
      this.scrollToBottom()
    } catch (e) {
      console.error('load history failed', e)
    }
  },

  onInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ input: e.detail.value })
  },

  pushMessage(role: 'user' | 'assistant', content: string): string {
    const id = `local-${this.msgSeq++}`
    const messages = this.data.messages.concat([{ id, role, content }])
    this.setData({ messages })
    this.scrollToBottom()
    return id
  },

  scrollToBottom() {
    const last = this.data.messages[this.data.messages.length - 1]
    if (last) this.setData({ scrollInto: `msg-${last.id}` })
  },

  async send() {
    const text = this.data.input.trim()
    if (!text || this.data.sending || !this.data.profileId) return

    this.pushMessage('user', text)
    this.setData({ input: '', sending: true })

    // “正在输入”占位气泡
    const placeholderId = this.pushMessage('assistant', '…')

    try {
      const res = await wx.cloud.callFunction({
        name: 'chat',
        config: { timeout: 60 } as any,
        data: { profileId: this.data.profileId, message: text },
      })
      const result = res.result as ChatResult
      if (result.code === 0 && result.reply) {
        this.typewriter(placeholderId, result.reply)
      } else {
        this.replaceMessage(placeholderId, result.error || '出了点问题，请稍后再试')
        this.setData({ sending: false })
      }
    } catch (e) {
      console.error('chat failed', e)
      const detail =
        (e as { errMsg?: string }).errMsg || (e as Error).message || '未知错误'
      this.replaceMessage(placeholderId, `出错了：${detail}`)
      this.setData({ sending: false })
    }
  },

  // 打字机效果：按 ||| 拆成多条气泡，逐条逐字展开，模拟连发短消息
  typewriter(placeholderId: string, fullText: string) {
    clearInterval(this.typingTimer)
    const parts = fullText
      .split('|||')
      .map((s) => s.trim())
      .filter(Boolean)
    const queue = parts.length ? parts : [fullText]

    const playNext = (bubbleId: string, text: string, rest: string[]) => {
      if (this.unloaded) return
      let shown = 0
      this.typingTimer = setInterval(() => {
        shown = Math.min(text.length, shown + 3)
        this.replaceMessage(bubbleId, text.slice(0, shown))
        if (shown >= text.length) {
          clearInterval(this.typingTimer)
          const [head, ...tail] = rest
          if (head !== undefined) {
            // 连发下一条前稍停顿，模拟真人发消息的节奏
            const nextId = this.pushMessage('assistant', '')
            this.bubbleTimer = setTimeout(
              () => playNext(nextId, head, tail),
              400
            ) as unknown as number
          } else {
            this.setData({ sending: false })
          }
        }
      }, 45) as unknown as number
    }

    const [head, ...tail] = queue
    playNext(placeholderId, head, tail)
  },

  replaceMessage(id: string, content: string) {
    const idx = this.data.messages.findIndex((m) => m.id === id)
    if (idx < 0) return
    this.setData({ [`messages[${idx}].content`]: content })
    this.scrollToBottom()
  },
})
