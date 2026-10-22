const api = require('../../services/api')
const access = require('../../services/access')
const content = require('../../config/introduction')
const share = require('../../services/share')
Page({
  data: { accessReady: false, accessError: '', name: content.name, tagline: content.tagline, description: content.description, topics: content.topics, keyword: '', results: content.topics },
  onLoad() { share.enable(); this.checkAccess() },
  onShow() { if (this._hasShown) this.checkAccess(); this._hasShown = true },
  onUnload() { this._accessClosed = true },
  checkAccess() { return access.check(this, api, true) },
  onSearch(event) {
    const keyword = event.detail.value.slice(0, 60)
    const query = keyword.trim().toLowerCase()
    this.setData({ keyword, results: content.topics.filter(topic => (topic.title + topic.summary + topic.paragraphs.join('')).toLowerCase().includes(query)) })
  },
  openInformation(event) {
    const section = event.currentTarget.dataset.section
    if (['about', 'checklist', 'faq', 'contact'].includes(section)) wx.navigateTo({ url: '/pages/information/information?section=' + section })
  },
  openTopic(event) {
    const id = event.currentTarget.dataset.id
    if (content.topics.some(topic => topic.id === id)) wx.navigateTo({ url: '/pages/information/information?topic=' + encodeURIComponent(id) })
  },
  onShareAppMessage() { return share.build('introduction', this, false) },
  onShareTimeline() { return share.build('introduction', this, true) }
})
