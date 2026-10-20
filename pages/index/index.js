const api = require('../../services/api')
const CACHE = 'knowledge-chat-v1'
// Render explicit line blocks so Skyline preserves model paragraphs and empty lines.
function displayMessage(message) {
  return Object.assign({}, message, { citations: message.citations || [], lines: String(message.content || '').split(/\r\n|\r|\n/).map(line => line || '\u00a0') })
}
Page({
  data: { input: '', messages: [], sending: false, ready: false, mode: '', status: '正在连接后端…', error: '', scrollInto: '', documentCount: 0 },
  onLoad() {
    this._closed = false
    try {
      const messages = wx.getStorageSync(CACHE)
      if (Array.isArray(messages)) this.setData({ messages: messages.slice(-30).map(displayMessage) })
    } catch (_) {}
    this.refreshHealth()
    this.refreshSources()
  },
  onUnload() { this._closed = true },
  onShow() { if (this.data.mode) this.refreshHealth() },
  refreshHealth() {
    this.setData({ status: '正在连接后端…' })
    api.health().then(res => this.setData({ ready: true, mode: res.modelMode, documentCount: res.documentCount,
      status: (!res.capabilities || !res.capabilities.materialTools || !res.capabilities.conversation || !res.capabilities.asyncChat ? '云端仍为旧版，请部署新版后端' : (res.modelMode === 'mock' ? '本地摘录模式' : (res.modelConfigured ? '模型 API 模式' : '模型 API 待配置'))) + ' · ' + res.documentCount + ' 份材料' }))
      .catch(err => this.setData({ ready: false, status: err.message }))
  },
  onInput(event) { this.setData({ input: event.detail.value }) },
  saveMessages(messages) {
    const trimmed = messages.slice(-30).map(displayMessage)
    this.setData({ messages: trimmed, scrollInto: trimmed.length ? 'message-' + trimmed[trimmed.length - 1].id : '' })
    try { wx.setStorageSync(CACHE, trimmed.map(message => Object.assign({}, message, { citations: message.citations.map(source => {
      const saved = Object.assign({}, source)
      delete saved.assetUrl; delete saved.assetPath; delete saved.assetError; delete saved.assetLoading
      return saved
    }) }))) } catch (_) {}
  },
  send() {
    const question = this.data.input.trim()
    if (!question || this.data.sending) return
    this.setData({ sending: true, input: '', error: '' })
    const id = String(Date.now())
    let left = 12000
    const history = []
    this.data.messages.slice(-20).reverse().forEach(message => {
      if (!left) return
      const references = (message.citations || []).map(source => source.title).filter(Boolean)
      const content = (message.content + (references.length ? '\n本轮参考材料：' + references.join('、') : '')).slice(-Math.min(left, 4000))
      left -= content.length
      history.unshift({ role: message.role, content })
    })
    this.saveMessages(this.data.messages.concat({ id: id + '-q', role: 'user', content: question }))
    api.chat(question, history).then(res => {
      this.saveMessages(this.data.messages.concat({ id: id + '-a', role: 'assistant', content: res.answer, citations: res.citations, mode: res.mode }))
      this.refreshSources(id + '-a')
    }).catch(err => { this.saveMessages(this.data.messages.filter(message => message.id !== id + '-q')); this.setData({ error: err.message, input: question }) })
      .finally(() => this.setData({ sending: false }))
  },
  updateSource(messageId, chunkId, patch) {
    if (this._closed) return
    this.setData({ messages: this.data.messages.map(message => message.id !== messageId ? message : Object.assign({}, message, {
      citations: message.citations.map(source => source.chunkId !== chunkId ? source : Object.assign({}, source, patch))
    })) })
  },
  refreshSources(messageId) {
    this.data.messages.filter(message => !messageId || message.id === messageId).forEach(message => {
      message.citations.forEach(source => {
        if (source.kind === 'image' || source.kind === 'video' || source.pageNumber) this.loadSourceAsset(message.id, source)
      })
    })
  },
  loadSourceAsset(messageId, source) {
    const update = patch => this.updateSource(messageId, source.chunkId, patch)
    const current = () => !this._closed && this.data.messages.some(message => message.id === messageId)
    update({ assetLoading: true, assetError: '', assetPath: '', assetUrl: '' })
    api.assetUrl(source.documentId, source.documentVersion, source.pageNumber || undefined).then(url => {
      if (!current()) return
      if (source.kind === 'video') { update({ assetUrl: url, assetLoading: false }); return }
      wx.downloadFile({ url, timeout: 120000, success: result => {
        if (!current()) return
        if (result.statusCode !== 200 || !result.tempFilePath) { update({ assetLoading: false, assetError: '图片加载失败，可重试；原文已在下方展示。' }); return }
        wx.getImageInfo({ src: result.tempFilePath, success: () => update({ assetPath: result.tempFilePath, assetLoading: false }),
          fail: () => update({ assetLoading: false, assetError: '图片解码失败，请重试。' }) })
      }, fail: () => update({ assetLoading: false, assetError: '图片下载失败，请检查网络后重试。' }) })
    }).catch(error => update({ assetLoading: false, assetError: error.message }))
  },
  retrySourceAsset(event) { this.loadSourceAsset(event.currentTarget.dataset.message, event.currentTarget.dataset.source) },
  onSourceAssetError(event) { this.updateSource(event.currentTarget.dataset.message, event.currentTarget.dataset.source.chunkId, { assetLoading: false, assetError: '媒体显示失败，请点击重试刷新链接。' }) },
  previewSourceImage(event) { const path = event.currentTarget.dataset.source.assetPath; if (path) wx.previewImage({ current: path, urls: [path] }) },
  openSource(event) {
    const s = event.currentTarget.dataset.source
    wx.navigateTo({ url: '/pages/source/source?id=' + encodeURIComponent(s.documentId) + '&version=' + encodeURIComponent(s.documentVersion) + '&chunk=' + encodeURIComponent(s.chunkId) })
  },
  openLibrary() { wx.navigateTo({ url: '/pages/library/library' }) },
  clearChat() {
    if (this.data.sending) return
    wx.showModal({ title: '清空本机对话', content: '将删除本机保存的消息和引用，不会删除原材料。', success: res => { if (res.confirm) { this.saveMessages([]); this.setData({ error: '' }) } } })
  }
})
