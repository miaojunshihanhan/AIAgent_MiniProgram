const api = require('../../services/api')
const CACHE = 'knowledge-chat-v1'
// Render explicit line blocks so Skyline preserves model paragraphs and empty lines.
function displayMessage(message) {
  return Object.assign({}, message, { lines: String(message.content || '').split(/\r\n|\r|\n/).map(line => line || '\u00a0') })
}
Page({
  data: { input: '', messages: [], sending: false, ready: false, mode: '', status: '正在连接后端…', error: '', scrollInto: '', documentCount: 0 },
  onLoad() {
    try {
      const messages = wx.getStorageSync(CACHE)
      if (Array.isArray(messages)) this.setData({ messages: messages.slice(-30).map(displayMessage) })
    } catch (_) {}
    this.refreshHealth()
  },
  onShow() { if (this.data.mode) this.refreshHealth() },
  refreshHealth() {
    this.setData({ status: '正在连接后端…' })
    api.health().then(res => this.setData({ ready: true, mode: res.modelMode, documentCount: res.documentCount,
      status: (res.modelMode === 'mock' ? '本地摘录模式' : (res.modelConfigured ? '模型 API 模式' : '模型 API 待配置')) + ' · ' + res.documentCount + ' 份材料' }))
      .catch(err => this.setData({ ready: false, status: err.message }))
  },
  onInput(event) { this.setData({ input: event.detail.value }) },
  saveMessages(messages) {
    const trimmed = messages.slice(-30).map(displayMessage)
    this.setData({ messages: trimmed, scrollInto: trimmed.length ? 'message-' + trimmed[trimmed.length - 1].id : '' })
    try { wx.setStorageSync(CACHE, trimmed) } catch (_) {}
  },
  send() {
    const question = this.data.input.trim()
    if (!question || this.data.sending) return
    this.setData({ sending: true, input: '', error: '' })
    const id = String(Date.now())
    this.saveMessages(this.data.messages.concat({ id: id + '-q', role: 'user', content: question }))
    api.chat(question).then(res => {
      this.saveMessages(this.data.messages.concat({ id: id + '-a', role: 'assistant', content: res.answer, citations: res.citations, mode: res.mode }))
    }).catch(err => this.setData({ error: err.message, input: question }))
      .finally(() => this.setData({ sending: false }))
  },
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
