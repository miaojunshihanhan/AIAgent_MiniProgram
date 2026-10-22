const api = require('../../services/api')
const access = require('../../services/access')
const share = require('../../services/share')
Page({
  data: { documents: [], loading: true, error: '' },
  onLoad() { share.enable(); this.checkAccess() },
  onShow() { if (this._hasShown) this.checkAccess(); this._hasShown = true },
  onShareAppMessage() { return share.build('library', this, false) },
  onShareTimeline() { return share.build('library', this, true) },
  onUnload() { this._accessClosed = true },
  checkAccess() { return access.check(this, api, false, () => this.load()) },
  load() {
    this.setData({ loading: true, error: '' })
    api.documents().then(res => this.setData({ documents: res.documents.map(doc => Object.assign({}, doc, { shortVersion: doc.version.slice(0, 12) })) }))
      .catch(err => this.setData({ error: err.message })).finally(() => this.setData({ loading: false }))
  },
  openDocument(event) {
    const doc = event.currentTarget.dataset.document
    wx.navigateTo({ url: '/pages/source/source?id=' + encodeURIComponent(doc.id) + '&version=' + encodeURIComponent(doc.version) })
  }
})
