const api = require('../../services/api')
const access = require('../../services/access')
const CACHE = 'knowledge-chat-v1'
const PENDING = 'knowledge-chat-pending-v1'
// Render explicit line blocks so Skyline preserves model paragraphs and empty lines.
function displayMessage(message) {
  return Object.assign({}, message, { citations: message.citations || [], lines: String(message.content || '').split(/\r\n|\r|\n/).map(line => line || '\u00a0') })
}
Page({
  data: { input: '', messages: [], sending: false, ready: false, mode: '', status: '正在连接后端…', error: '', scrollInto: '', documentCount: 0, waitingText: '', elapsed: 0, pendingJob: false },
  onLoad() {
    this.checkAccess()
  },
  checkAccess() {
    return access.check(this, api, false, () => {
      if (!this._initialized) { this._initialized = true; this.initialize() }
      else this.refreshHealth()
    })
  },
  initialize() {
    this._closed = false
    try {
      const messages = wx.getStorageSync(CACHE)
      if (Array.isArray(messages)) this.setData({ messages: messages.slice(-30).map(displayMessage) })
    } catch (_) {}
    this.refreshHealth()
    this.refreshSources()
    try { const pending = wx.getStorageSync(PENDING); if (pending && pending.jobId) { this._pending = pending; this.setData({ pendingJob: true }); this.resumeAnswer() } } catch (_) {}
  },
  onUnload() { this._accessClosed = true; this._closed = true; this.stopTimer() },
  onShow() { if (this._hasShown) this.checkAccess(); this._hasShown = true },
  refreshHealth() {
    this.setData({ status: '正在连接后端…' })
    api.health().then(res => this.setData({ ready: true, mode: res.modelMode, documentCount: res.documentCount,
      status: (!res.capabilities || !res.capabilities.streaming || !res.capabilities.singleModelCall ? '云端仍为旧版，请部署新版后端' : (res.modelMode === 'mock' ? '本地摘录模式' : (res.modelConfigured ? '模型 API 模式 · 流式' : '模型 API 待配置'))) + ' · ' + res.documentCount + ' 份材料' }))
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
    if (!question || this.data.sending || this._pending) return
    this.setData({ sending: true, input: '', error: '' })
    const id = String(Date.now())
    let left = 6000
    const history = []
    this.data.messages.slice(-8).reverse().forEach(message => {
      if (!left) return
      const references = (message.citations || []).map(source => source.title).filter(Boolean)
      const raw = message.content + (references.length ? '\n本轮参考材料：' + references.join('、') : '')
      const limit = Math.min(left, message.role === 'assistant' ? 1000 : 1500)
      const head = Math.floor(limit * 0.7), tail = Math.max(0, limit - head - 1)
      const content = raw.length > limit ? raw.slice(0, head) + '…' + (tail ? raw.slice(-tail) : '') : raw
      left -= content.length
      history.unshift({ role: message.role, content })
    })
    this.saveMessages(this.data.messages.concat({ id: id + '-q', role: 'user', content: question }))
    this.runAnswer(question, history, id)
  },
  stopTimer() { if (this._waitTimer) clearInterval(this._waitTimer); this._waitTimer = null },
  showPartial(id,text) {
    if(this._closed||this._paused||!text)return
    const answerId=id+'-a',message=displayMessage({id:answerId,role:'assistant',content:text,citations:[],partial:true})
    const messages=this.data.messages.filter(m=>m.id!==answerId).concat(message).slice(-30)
    this.setData({messages,scrollInto:'message-'+answerId,waitingText:'正在输出回答…'})
  },
  runAnswer(question, history, id, jobId) {
    this._paused = false
    this._firstText = null
    this.setData({ sending: true, waitingText: jobId ? '正在恢复原回答…' : '正在提交问题…', error: '', elapsed: 0 })
    const started = Date.now(); this.stopTimer()
    this._waitTimer = setInterval(() => { if (!this._closed) this.setData({ elapsed: Math.floor((Date.now() - started) / 1000) }) }, 1000)
    api.chat(question, history, { jobId, isCancelled: () => this._closed || this._paused,
      onText: text => {if(!this._firstText){this._firstText=Date.now();console.info('[chat timing] firstDisplayMs='+(this._firstText-started))}this.showPartial(id,text)},
      onJob: value => { this._pending = {jobId:value,question,id}; try { wx.setStorageSync(PENDING, this._pending) } catch (_) {} },
      onProgress: value => { if (!this._closed && value.progress) this.setData({ waitingText: value.progress.label || '正在等待模型回答…' }) }
    }).then(res => {
      if (this._closed) return
      this.saveMessages(this.data.messages.filter(message=>message.id!==id+'-a').concat({ id: id + '-a', role: 'assistant', content: res.answer, citations: res.citations, mode: res.mode }))
      console.info('[chat timing] totalDisplayMs='+(Date.now()-started),res.timings||{})
      this.refreshSources(id + '-a')
      this.clearPending()
    }).catch(err => {
      if (this._closed) return
      if (err.jobId && !err.terminal) this.setData({ error: err.message, pendingJob: true })
      else { this.clearPending(); this.saveMessages(this.data.messages.filter(message => message.id !== id + '-q'&&message.id!==id+'-a')); this.setData({ error: err.message, input: this.data.input || question }) }
    }).finally(() => { this.stopTimer(); if (!this._closed) this.setData({ sending: false }) })
  },
  clearPending() { this._pending = null; this.setData({ pendingJob: false }); try { if (wx.removeStorageSync) wx.removeStorageSync(PENDING) } catch (_) {} },
  resumeAnswer() { if (this.data.sending || !this._pending) return; const p = this._pending; this.runAnswer(p.question, [], p.id, p.jobId) },
  pauseWaiting() { this._paused = true; this.setData({ waitingText: '正在暂停等待，后台任务仍会继续…' }) },
  discardPending() { this.clearPending(); this.setData({ error: '' }) },
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
    const assetStarted=Date.now()
    const update = patch => this.updateSource(messageId, source.chunkId, patch)
    const current = () => !this._closed && this.data.messages.some(message => message.id === messageId)
    update({ assetLoading: true, assetError: '', assetPath: '', assetUrl: '' })
    api.assetUrl(source.documentId, source.documentVersion, source.pageNumber || undefined).then(url => {
      console.info('[chat timing] assetUrlMs='+(Date.now()-assetStarted),'kind='+source.kind)
      if (!current()) return
      if (source.kind === 'video') { update({ assetUrl: url, assetLoading: false }); return }
      wx.downloadFile({ url, timeout: 120000, success: result => {
        if (!current()) return
        if (result.statusCode !== 200 || !result.tempFilePath) { update({ assetLoading: false, assetError: '图片加载失败，可重试；原文已在下方展示。' }); return }
        wx.getImageInfo({ src: result.tempFilePath, success: () => {console.info('[chat timing] imageReadyMs='+(Date.now()-assetStarted));update({ assetPath: result.tempFilePath, assetLoading: false })},
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
    wx.showModal({ title: '清空本机对话', content: '将删除本机保存的消息和引用，不会删除原材料。', success: res => { if (res.confirm) { this.clearPending(); this.saveMessages([]); this.setData({ error: '' }) } } })
  }
})
