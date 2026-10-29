// index.ts 角色列表页
interface Profile {
  _id: string
  name: string
  relation: string
  avatarFileID?: string
  initial?: string
  createdAt?: string
}

Page({
  data: {
    profiles: [] as Profile[],
    loading: true,
  },

  onLoad() {
    this.showConsentOnce()
  },

  onShow() {
    this.loadProfiles()
  },

  async loadProfiles() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const res = await db
        .collection('profiles')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()
      const profiles = (res.data as unknown as Profile[]).map((p) => ({
        ...p,
        initial: (p.name || '·')[0],
      }))
      this.setData({ profiles, loading: false })
    } catch (e) {
      console.error('load profiles failed', e)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败，请检查云环境', icon: 'none' })
    }
  },

  // 首次进入提示：AI 模拟声明 + 隐私告知
  showConsentOnce() {
    if (wx.getStorageSync('consent_v1')) return
    wx.showModal({
      title: '使用前须知',
      content:
        '本小程序中的角色均由 AI 模拟生成，回复并非真人发出。\n\n' +
        '你上传的聊天素材须为你与当事人的聊天内容；当事人已不在世的，请确认你是其近亲属。\n\n' +
        '素材仅用于提炼说话风格，原始内容不会保存到服务器，详见隐私政策。',
      confirmText: '我已知晓并同意',
      cancelText: '查看隐私政策',
      success: (res) => {
        if (res.confirm) {
          wx.setStorageSync('consent_v1', Date.now())
        } else {
          wx.navigateTo({ url: '../privacy/privacy' })
        }
      },
    })
  },

  goCreate() {
    wx.navigateTo({ url: '../create/create' })
  },

  goChat(e: WechatMiniprogram.TapEvent) {
    const { id, name } = e.currentTarget.dataset as { id: string; name: string }
    wx.navigateTo({ url: `../chat/chat?profileId=${id}&name=${encodeURIComponent(name)}` })
  },

  onLongPress(e: WechatMiniprogram.TapEvent) {
    const { id, name } = e.currentTarget.dataset as { id: string; name: string }
    wx.showActionSheet({
      itemList: [`删除「${name}」及其全部对话`],
      itemColor: '#E64545',
      success: (res) => {
        if (res.tapIndex === 0) this.deleteProfile(id)
      },
    })
  },

  async deleteProfile(profileId: string) {
    wx.showLoading({ title: '正在删除…' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'deleteProfile',
        config: { timeout: 60 } as any,
        data: { profileId },
      })
      wx.hideLoading()
      const result = res.result as { code: number; error?: string }
      if (result.code === 0) {
        wx.showToast({ title: '已删除', icon: 'success' })
        this.loadProfiles()
      } else {
        wx.showToast({ title: result.error || '删除失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  },

  goPrivacy() {
    wx.navigateTo({ url: '../privacy/privacy' })
  },
})
