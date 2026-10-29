const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BATCH = 100

async function removeWhere(where) {
  // 逐批删除直到清空
  for (;;) {
    const res = await db.collection('messages').where(where).limit(BATCH).get()
    if (!res.data.length) break
    await Promise.all(
      res.data.map((m) => db.collection('messages').doc(m._id).remove())
    )
    if (res.data.length < BATCH) break
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { profileId } = event
  if (!profileId) return { code: 400, error: '参数不完整' }

  const profileRes = await db
    .collection('profiles')
    .doc(profileId)
    .get()
    .catch(() => null)
  const profile = profileRes && profileRes.data
  if (!profile || profile._openid !== OPENID) {
    return { code: 403, error: '角色不存在或无权访问' }
  }

  // 删会话 + 消息
  const convRes = await db
    .collection('conversations')
    .where({ _openid: OPENID, profileId })
    .get()
  for (const conv of convRes.data) {
    await removeWhere({ _openid: OPENID, conversationId: conv._id })
    await db.collection('conversations').doc(conv._id).remove()
  }

  // 删头像文件（如有）
  if (profile.avatarFileID) {
    await cloud.deleteFile({ fileList: [profile.avatarFileID] }).catch(() => null)
  }

  await db.collection('profiles').doc(profileId).remove()
  return { code: 0 }
}
