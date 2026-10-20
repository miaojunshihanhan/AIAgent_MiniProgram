const config = require('../config/api')
function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => {
    const args = {
      method: options.method || 'GET', data: options.data, timeout: config.timeout || 60000,
      header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(new Error((res.data && res.data.error) || ('请求失败：HTTP ' + res.statusCode)))
      },
      fail(error) { reject(new Error((config.mode === 'container' ? '无法连接云托管，请检查版本发布状态、小程序环境关联与服务访问权限。' : '无法连接本地后端，请检查地址、同一 Wi-Fi 和防火墙。') + (error.errMsg || ''))) }
    }
    if (config.mode === 'container') {
      if (!wx.cloud || !wx.cloud.callContainer) { reject(new Error('当前微信基础库不支持云托管调用，请更新基础库及微信客户端。')); return }
      args.config = { env: config.env }; args.path = path
      args.header['X-WX-SERVICE'] = config.service
      wx.cloud.callContainer(args)
    } else {
      args.url = config.baseUrl.replace(/\/$/, '') + path
      wx.request(args)
    }
  })
}
function assetPath(id, version, page) {
  return '/documents/' + encodeURIComponent(id) + (page ? '/pages/' + encodeURIComponent(page) + '/image' : '/original') + '?version=' + encodeURIComponent(version)
}
function assetUrl(id, version, page) {
  const path = assetPath(id, version, page)
  if (config.mode === 'container') return request(path + '&download=1').then(result => {
    if (!result.url || !/^https:\/\//.test(result.url)) throw new Error('未获取到文件临时下载链接。')
    return result.url
  })
  return Promise.resolve(config.baseUrl.replace(/\/$/, '') + path)
}
module.exports = {
  originalUrl: (id, version) => config.mode === 'container' ? '' : config.baseUrl.replace(/\/$/, '') + assetPath(id, version),
  pageImageUrl: (id, version, n) => config.mode === 'container' ? '' : config.baseUrl.replace(/\/$/, '') + assetPath(id, version, n),
  assetUrl,
  health: () => request('/health'),
  chat: question => request('/chat', { method: 'POST', data: { question } }),
  documents: () => request('/documents'),
  page: (id, version, n) => request('/documents/' + encodeURIComponent(id) + '/pages/' + encodeURIComponent(n) + '?version=' + encodeURIComponent(version)),
  document: (id, version, offset) => request('/documents/' + encodeURIComponent(id) + '?version=' + encodeURIComponent(version || '') + '&offset=' + (offset || 0)),
  chunk: (id, version, chunkId) => request('/documents/' + encodeURIComponent(id) + '/chunks/' + encodeURIComponent(chunkId) + '?version=' + encodeURIComponent(version))
}
