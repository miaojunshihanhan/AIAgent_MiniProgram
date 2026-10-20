const config = require('../config/api')
function request(path, options) {
  options = options || {}
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.baseUrl.replace(/\/$/, '') + path,
      method: options.method || 'GET', data: options.data,
      timeout: config.timeout, header: { 'content-type': 'application/json' },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(new Error((res.data && res.data.error) || ('请求失败：HTTP ' + res.statusCode)))
      },
      fail(error) { reject(new Error('无法连接后端 ' + config.baseUrl + '。手机和电脑须同一 Wi-Fi，检查后端监听、防火墙及调试网络设置。' + (error.errMsg || ''))) }
    })
  })
}
module.exports = {
  originalUrl: (id, version) => config.baseUrl.replace(/\/$/, '') + '/documents/' + encodeURIComponent(id) + '/original?version=' + encodeURIComponent(version),
  page: (id,v,n) => request('/documents/'+id+'/pages/'+n+'?version='+v),
  pageImageUrl: (id,v,n) => config.baseUrl.replace(/\/$/, '')+'/documents/'+encodeURIComponent(id)+'/pages/'+n+'/image?version='+encodeURIComponent(v),
  health: () => request('/health'),
  chat: question => request('/chat', { method: 'POST', data: { question } }),
  documents: () => request('/documents'),
  document: (id, version, offset) => request('/documents/' + encodeURIComponent(id) + '?version=' + encodeURIComponent(version || '') + '&offset=' + (offset || 0)),
  chunk: (id, version, chunkId) => request('/documents/' + encodeURIComponent(id) + '/chunks/' + encodeURIComponent(chunkId) + '?version=' + encodeURIComponent(version))
}
