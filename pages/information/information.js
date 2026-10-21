const api = require('../../services/api')
const access = require('../../services/access')
const content = require('../../config/introduction')
const CACHE = 'learning-checklist-v1'
const titles = { about: '产品介绍', checklist: '学习清单', faq: '常见问题', contact: '关于与联系' }
Page({
  data: { accessReady: false, accessError: '', title: '学习指南', section: '', topic: null, name: content.name, description: content.description, faqs: content.faqs, expanded: '', checklist: [], completed: 0, progress: 0, storageError: '', contact: content.contact, hasLocation: false },
  onLoad(options) {
    const topic = content.topics.find(item => item.id === options.topic)
    const section = topic ? 'topic' : (titles[options.section] ? options.section : 'about')
    const contact = content.contact
    const hasLocation = !!contact.address && typeof contact.latitude === 'number' && typeof contact.longitude === 'number' && Number.isFinite(contact.latitude) && Number.isFinite(contact.longitude) && Math.abs(contact.latitude) <= 90 && Math.abs(contact.longitude) <= 180
    this.setData({ section, topic: topic || null, title: topic ? '学习指南' : titles[section], hasLocation })
    this.restoreChecklist()
    this.checkAccess()
  },
  onShow() { if (this._hasShown) this.checkAccess(); this._hasShown = true },
  onUnload() { this._accessClosed = true },
  checkAccess() { return access.check(this, api, true) },
  restoreChecklist() {
    let saved = []
    try { const value = wx.getStorageSync(CACHE); if (Array.isArray(value)) saved = value } catch (_) {}
    this.updateChecklist(saved, false)
  },
  updateChecklist(ids, persist = true) {
    const valid = content.checklist.filter(item => ids.includes(item.id)).map(item => item.id)
    let storageError = ''
    if (persist) {
      try { wx.setStorageSync(CACHE, valid) } catch (_) { storageError = '本机存储失败，本次进度仅在当前页面保留。' }
    }
    this.setData({ checklist: content.checklist.map(item => Object.assign({}, item, { checked: valid.includes(item.id) })), completed: valid.length, progress: Math.round(valid.length / content.checklist.length * 100), storageError })
  },
  onChecklistChange(event) { this.updateChecklist(event.detail.value) },
  resetChecklist() {
    wx.showModal({ title: '重置学习清单', content: '将清除本机保存的勾选记录，是否继续？', success: result => { if (result.confirm) this.updateChecklist([]) } })
  },
  toggleQuestion(event) { const id = event.currentTarget.dataset.id; this.setData({ expanded: this.data.expanded === id ? '' : id }) },
  openChecklist() { wx.navigateTo({ url: '/pages/information/information?section=checklist' }) },
  goHome() { wx.reLaunch({ url: '/pages/intro/intro' }) },
  callPhone() {
    if (!content.contact.phone) return
    wx.makePhoneCall({ phoneNumber: content.contact.phone, fail: error => { if (!/cancel/i.test(error.errMsg || '')) wx.showToast({ title: '暂时无法拨号，请稍后重试', icon: 'none' }) } })
  },
  openLocation() {
    if (!this.data.hasLocation) return
    wx.openLocation({ latitude: content.contact.latitude, longitude: content.contact.longitude, name: content.contact.locationName || content.name, address: content.contact.address, scale: 16, fail: () => wx.showToast({ title: '暂时无法打开地图', icon: 'none' }) })
  }
})
