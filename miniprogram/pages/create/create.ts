// create.ts 新建角色页
const MAX_SAMPLE_LEN = 20000

Page({
  data: {
    name: '',
    relation: '',
    sampleText: '',
    description: '',
    avatarTempPath: '',
    submitting: false,
    recognizing: false,
  },

  onNameInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ name: e.detail.value })
  },

  onRelationInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ relation: e.detail.value })
  },

  onSampleInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ sampleText: e.detail.value })
  },

  onDescInput(e: WechatMiniprogram.InputEvent) {
    this.setData({ description: e.detail.value })
  },

  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: (res) => {
        this.setData({ avatarTempPath: res.tempFiles[0].tempFilePath })
      },
    })
  },

  // 从聊天记录里选择导出的 txt 文件
  importFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['txt'],
      success: (res) => {
        const file = res.tempFiles[0]
        if (file.size > 1024 * 1024) {
          wx.showToast({ title: '文件超过 1MB，请截取部分导入', icon: 'none' })
          return
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => {
            const content = String(r.data || '').slice(0, MAX_SAMPLE_LEN)
            this.setData({ sampleText: content })
            wx.showToast({ title: '已导入', icon: 'success' })
          },
          fail: () => wx.showToast({ title: '文件读取失败', icon: 'none' }),
        })
      },
    })
  },

  // 相册选聊天截图 → 上传临时文件 → OCR 识别 → 回填文本框
  async importScreenshots() {
    if (this.data.recognizing) return
    const chosen = await wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
    }).catch(() => null)
    if (!chosen || !chosen.tempFiles.length) return

    this.setData({ recognizing: true })
    wx.showLoading({ title: '识别截图中…', mask: true })
    try {
      const fileIDs = await Promise.all(
        chosen.tempFiles.map((f, i) =>
          wx.cloud.uploadFile({
            cloudPath: `ocr-tmp/${Date.now()}-${i}-${Math.floor(Math.random() * 1e4)}.png`,
            filePath: f.tempFilePath,
          }).then((r) => r.fileID)
        )
      )
      const res = await wx.cloud.callFunction({
        name: 'ocrText',
        config: { timeout: 60 } as any,
        data: { fileIDs },
      })
      wx.hideLoading()
      const result = res.result as { code: number; text?: string; error?: string }
      if (result.code === 0 && result.text) {
        const merged = (this.data.sampleText + '\n' + result.text)
          .trim()
          .slice(0, MAX_SAMPLE_LEN)
        this.setData({ sampleText: merged })
        wx.showToast({ title: '识别完成，可校对', icon: 'none' })
      } else {
        wx.showToast({ title: result.error || '识别失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('ocr import failed', e)
      wx.showToast({ title: '识别失败，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ recognizing: false })
    }
  },

  async submit() {
    const { name, relation, sampleText, description, avatarTempPath, submitting } = this.data
    if (submitting) return
    if (!name.trim()) {
      wx.showToast({ title: '先给 TA 起个名字', icon: 'none' })
      return
    }
    if (sampleText.trim().length < 50 && description.trim().length < 10) {
      wx.showToast({ title: '提供聊天素材，或描述 TA 的风格', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    wx.showLoading({ title: '正在分析说话风格…', mask: true })

    try {
      let avatarFileID = ''
      if (avatarTempPath) {
        const up = await wx.cloud.uploadFile({
          cloudPath: `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
          filePath: avatarTempPath,
        })
        avatarFileID = up.fileID
      }

      const res = await wx.cloud.callFunction({
        name: 'extractStyle',
        config: { timeout: 60 } as any,
        data: {
          name: name.trim(),
          relation: relation.trim(),
          sampleText: sampleText.trim(),
          description: description.trim(),
          avatarFileID,
        },
      })
      wx.hideLoading()
      const result = (res.result || {}) as {
        code?: number
        profileId?: string
        error?: string
      }
      if (result.code === 0 && result.profileId) {
        wx.redirectTo({
          url: `../chat/chat?profileId=${result.profileId}&name=${encodeURIComponent(name.trim())}`,
        })
      } else {
        wx.showModal({
          title: '创建失败',
          content: result.error || `函数返回异常：${JSON.stringify(result)}`,
          showCancel: false,
        })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('create profile failed', e)
      const detail =
        (e as { errMsg?: string }).errMsg || (e as Error).message || '未知错误'
      wx.showModal({ title: '创建失败', content: String(detail), showCancel: false })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
