// app.ts
App<IAppOption>({
  globalData: {},
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      // 自动使用当前开通的云开发环境
      env: (wx.cloud as unknown as { DYNAMIC_CURRENT_ENV: string }).DYNAMIC_CURRENT_ENV,
      traceUser: true,
    })
  },
})
