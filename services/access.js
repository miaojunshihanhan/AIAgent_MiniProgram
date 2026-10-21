// Always recheck the server on page entry; never persist the mode in local storage.
function check(page, api, introduction, onReady) {
  if (page._checkingAccess) return
  page._checkingAccess = true
  const serial = page._accessSerial = (page._accessSerial || 0) + 1
  page.setData({ accessReady: false, accessError: '' })
  return api.publicConfig().then(config => {
    if (page._accessClosed || serial !== page._accessSerial) return
    if (!config || typeof config.uploadCheck !== 'boolean') throw new Error('页面配置暂不可用，请稍后重试。')
    if (config.uploadCheck !== introduction) {
      wx.reLaunch({
        url: config.uploadCheck ? '/pages/intro/intro' : '/pages/index/index',
        fail: () => { if (!page._accessClosed) page.setData({ accessError: '页面切换失败，请点击重新加载。' }) }
      })
      return
    }
    page.setData({ accessReady: true })
    if (onReady) onReady()
  }).catch(error => {
    if (!page._accessClosed && serial === page._accessSerial) page.setData({ accessError: error.message || '网络连接失败，请重新加载。' })
  }).finally(() => { page._checkingAccess = false })
}
module.exports = { check }
