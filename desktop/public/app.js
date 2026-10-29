// 有个回音 · 电脑版前端逻辑
const $ = (id) => document.getElementById(id)

const state = {
  profiles: [],
  current: null,      // 当前选中的 profile
  sending: false,
  typingTimers: [],
}

// ---------- 工具 ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `请求失败 ${res.status}`)
  return json
}

function openModal(id) { $(id).classList.remove('hidden') }
function closeModal(id) { $(id).classList.add('hidden') }

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

// ---------- 角色列表 ----------
async function loadProfiles() {
  const { profiles } = await api('/api/profiles')
  state.profiles = profiles
  renderProfiles()
}

function renderProfiles() {
  const list = $('profileList')
  list.innerHTML = ''
  state.profiles.forEach((p) => {
    const card = document.createElement('div')
    card.className = 'profile-card' + (state.current?.id === p.id ? ' active' : '')
    card.innerHTML =
      `<div class="p-avatar">${escapeHtml((p.name || '·')[0])}</div>` +
      `<div><div class="p-name">${escapeHtml(p.name)}</div>` +
      `<div class="p-relation">${escapeHtml(p.relation || '朋友')}</div></div>`
    card.onclick = () => selectProfile(p)
    list.appendChild(card)
  })
}

// ---------- 聊天 ----------
async function selectProfile(p) {
  state.current = p
  renderProfiles()
  $('emptyState').classList.add('hidden')
  $('chatHeader').classList.remove('hidden')
  $('aiBadge').classList.remove('hidden')
  $('messages').classList.remove('hidden')
  $('composer').classList.remove('hidden')
  $('chatName').textContent = p.name
  $('chatRelation').textContent = p.relation || '朋友'
  const { messages } = await api(`/api/profiles/${p.id}/messages`)
  $('messages').innerHTML = ''
  messages.forEach((m) => appendBubble(m.role, m.content))
  scrollBottom()
}

function appendBubble(role, content, id) {
  const row = document.createElement('div')
  row.className = `row ${role}`
  const bubble = document.createElement('div')
  bubble.className = `bubble ${role}`
  bubble.textContent = content
  if (id) bubble.dataset.mid = id
  row.appendChild(bubble)
  $('messages').appendChild(row)
  return bubble
}

function scrollBottom() {
  const m = $('messages')
  m.scrollTop = m.scrollHeight
}

async function send() {
  const text = $('inputBox').value.trim()
  if (!text || state.sending || !state.current) return
  $('inputBox').value = ''
  appendBubble('user', text)
  scrollBottom()

  const placeholder = appendBubble('assistant', '…', 'typing')
  placeholder.classList.add('typing')
  state.sending = true
  $('btnSend').disabled = true

  try {
    const { reply } = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ profileId: state.current.id, message: text }),
    })
    await typewriter(placeholder, reply)
  } catch (e) {
    placeholder.classList.remove('typing')
    placeholder.textContent = `出错了：${e.message}`
  } finally {
    state.sending = false
    $('btnSend').disabled = false
  }
}

// 打字机：按 ||| 拆成多条气泡，逐条逐字展开，模拟连发短消息
function typewriter(bubble, fullText) {
  return new Promise((resolve) => {
    const parts = fullText.split('|||').map((s) => s.trim()).filter(Boolean)
    const queue = parts.length ? parts : [fullText]

    const playNext = (target, text, rest) => {
      target.classList.remove('typing')
      let shown = 0
      const timer = setInterval(() => {
        shown = Math.min(text.length, shown + 3)
        target.textContent = text.slice(0, shown)
        scrollBottom()
        if (shown >= text.length) {
          clearInterval(timer)
          const [head, ...tail] = rest
          if (head !== undefined) {
            const next = appendBubble('assistant', '')
            next.classList.add('typing')
            scrollBottom()
            state.typingTimers.push(setTimeout(() => playNext(next, head, tail), 400))
          } else {
            resolve()
          }
        }
      }, 40)
      state.typingTimers.push(timer)
    }

    const [head, ...tail] = queue
    playNext(bubble, head, tail)
  })
}

// ---------- 新建角色 ----------
async function submitCreate() {
  const name = $('fName').value.trim()
  const body = {
    name,
    relation: $('fRelation').value.trim(),
    sampleText: $('fSample').value.trim(),
    description: $('fDesc').value.trim(),
  }
  if (!name) return alert('先给 TA 起个名字')
  if (body.sampleText.length < 50 && body.description.length < 10) {
    return alert('提供至少 50 字聊天素材，或 10 字以上的风格描述')
  }
  const btn = $('btnCreateSubmit')
  btn.disabled = true
  btn.textContent = '正在分析说话风格…'
  try {
    const { profile } = await api('/api/profiles', { method: 'POST', body: JSON.stringify(body) })
    closeModal('createModal')
    await loadProfiles()
    const p = state.profiles.find((x) => x.id === profile.id)
    if (p) selectProfile(p)
  } catch (e) {
    alert(e.message)
  } finally {
    btn.disabled = false
    btn.textContent = '生成 TA 的说话方式'
  }
}

// ---------- 删除 ----------
async function deleteCurrent() {
  if (!state.current) return
  if (!confirm(`删除「${state.current.name}」及其全部对话？删除后不可恢复。`)) return
  await api(`/api/profiles/${state.current.id}`, { method: 'DELETE' })
  state.current = null
  $('chatHeader').classList.add('hidden')
  $('aiBadge').classList.add('hidden')
  $('messages').classList.add('hidden')
  $('composer').classList.add('hidden')
  $('emptyState').classList.remove('hidden')
  await loadProfiles()
}

// ---------- 事件绑定 ----------
$('btnCreate').onclick = () => openModal('createModal')
$('btnCreateCancel').onclick = () => closeModal('createModal')
$('btnCreateSubmit').onclick = submitCreate
$('btnSend').onclick = send
$('inputBox').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send()
})
$('btnDelete').onclick = deleteCurrent

$('fFile').addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return
  if (file.size > 1024 * 1024) return alert('文件超过 1MB，请截取部分导入')
  const reader = new FileReader()
  reader.onload = () => { $('fSample').value = String(reader.result || '').slice(0, 20000) }
  reader.readAsText(file)
})

$('btnSettings').onclick = async () => {
  // 回填当前配置（不回显 Key）
  try {
    const s = await api('/api/status')
    $('fApiBase').value = s.apiBase || ''
    $('fModel').value = s.model || ''
  } catch {}
  openModal('settingsModal')
}
$('btnSettingsClose').onclick = () => closeModal('settingsModal')
$('btnSettingsSave').onclick = async () => {
  const body = {
    apiKey: $('fApiKey').value.trim(),
    apiBase: $('fApiBase').value.trim(),
    model: $('fModel').value.trim(),
  }
  try {
    await api('/api/config', { method: 'POST', body: JSON.stringify(body) })
    closeModal('settingsModal')
  } catch (e) {
    alert(e.message)
  }
}

$('btnAbout').onclick = () => openModal('aboutModal')
$('btnAboutClose').onclick = () => closeModal('aboutModal')
document.querySelectorAll('.modal-mask').forEach((mask) => {
  mask.addEventListener('click', (e) => {
    if (e.target === mask) mask.classList.add('hidden')
  })
})

// ---------- 启动 ----------
;(async () => {
  await loadProfiles()
  const { hasKey } = await api('/api/status')
  if (!hasKey) openModal('settingsModal')
})()
