const api = require('../../services/api')
const access = require('../../services/access')
Page({
  data: { documents: [], loading: true, error: '' },
  onLoad() { this.checkAccess() },
  onShow() { if (this._hasShown) this.checkAccess(); this._hasShown = true },
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
