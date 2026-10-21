const api = require('../../services/api')
const access = require('../../services/access')
Page({
  data: { document: null, chunk: null, lines: [], nextOffset: null, loading: true, error: '', fullLoaded: false, shortVersion: '', originalUrl: '', opening: false, videoError: '', downloading: false, videoProgress: 0, slide: null, slideCount: 0, slideImage: '', imagePath: '', imageHeight: 420, slideImageHeight: 360, imageLoading: false, imageError: '', slideLoading: false, slideImageLoading: false, slideImageError: '' },
  onLoad(options) {
    this._sourceOptions = options
    this.checkAccess()
  },
  checkAccess() {
    return access.check(this, api, false, () => {
      if (!this._initialized) { this._initialized = true; this.initialize(this._sourceOptions || {}) }
    })
  },
  onShow() { if (this._hasShown) this.checkAccess(); this._hasShown = true },
  initialize(options) {
    this._previewCache = {}; this._previewSerial = 0; this._slideSerial = 0; this._closed = false
    this.documentId = options.id || ''; this.version = options.version || ''; this.chunkId = options.chunk || ''
    this.load()
  },
  onUnload() {
    this._accessClosed = true
    this._closed = true; this._previewSerial++; this._slideSerial++
    if (this._imageTask && this._imageTask.abort) this._imageTask.abort()
  },
  setDocument(document) {
    this.documentId = document.id || this.documentId
    this.version = document.version
    const originalUrl = api.originalUrl ? api.originalUrl(this.documentId, this.version) : ''
    this.setData({ document, shortVersion: document.version.slice(0, 12), originalUrl })
    if (document.kind === 'image' && originalUrl) this.loadPreview(originalUrl, false)
    if (api.assetUrl) {
      const version = this.version
      api.assetUrl(this.documentId, version).then(url => {
        if (this._closed || this.version !== version) return
        this.setData({ originalUrl: url })
        if (document.kind === 'image') this.loadPreview(url, false)
      }).catch(error => { if (!this._closed && this.version === version) this.setData({ error: error.message }) })
    }
  },
  loadPreview(url, slide) {
    const serial = this._previewSerial = (this._previewSerial || 0) + 1
    if (this._imageTask && this._imageTask.abort) this._imageTask.abort()
    const pathKey = slide ? 'slideImage' : 'imagePath'
    const errorKey = slide ? 'slideImageError' : 'imageError'
    const loadingKey = slide ? 'slideImageLoading' : 'imageLoading'
    const heightKey = slide ? 'slideImageHeight' : 'imageHeight'
    this.setData({ [pathKey]: '', [errorKey]: '', [loadingKey]: true })
    const current = () => !this._closed && serial === this._previewSerial
    const fail = detail => {
      if (!current()) return
      this.setData({ [pathKey]: '', [loadingKey]: false, [errorKey]: '图片预览失败：' + detail + '。请检查后端连接及微信 downloadFile 合法域名；局域网真机调试需开启开发工具的“不校验合法域名”设置。' })
    }
    const decode = localPath => wx.getImageInfo({ src: localPath,
      success: info => {
        if (!current()) return
        if (!(info.width > 0 && info.height > 0)) { fail('图片尺寸无效'); return }
        this._previewCache = this._previewCache || {}
        this._previewCache[url] = localPath
        this.setData({ [pathKey]: localPath, [heightKey]: slide ? this.data.slideImageHeight : Math.max(1, Math.round(690 * info.height / info.width)), [loadingKey]: false })
      },
      fail: error => { if (this._previewCache) delete this._previewCache[url]; fail(error.errMsg || '设备无法解码图片') }
    })
    if (this._previewCache && this._previewCache[url]) { decode(this._previewCache[url]); return }
    this._imageTask = wx.downloadFile({ url, timeout: 120000,
      success: result => {
        if (!current()) return
        if (result.statusCode !== 200 || !result.tempFilePath) { fail('HTTP ' + result.statusCode); return }
        decode(result.tempFilePath)
      },
      fail: error => fail(error.errMsg || '下载失败')
    })
  },
  onPreviewError(event) {
    const slide = event.currentTarget.dataset.kind === 'slide'
    const url = slide ? this._slideImageUrl : this.data.originalUrl
    if (this._previewCache) delete this._previewCache[url]
    this.setData({ [slide ? 'slideImage' : 'imagePath']: '', [slide ? 'slideImageLoading' : 'imageLoading']: false,
      [slide ? 'slideImageError' : 'imageError']: '设备未能显示图片：' + ((event.detail || {}).errMsg || '图片渲染失败') + '，请点击重试。' })
  },
  retryImage() {
    if (api.assetUrl) {
      api.assetUrl(this.documentId, this.version).then(url => {
        if (this._closed) return
        this.setData({ originalUrl: url }); this.loadPreview(url, false)
      }).catch(error => { if (!this._closed) this.setData({ imageError: error.message }) })
    } else if (this.data.originalUrl) this.loadPreview(this.data.originalUrl, false)
  },
  retrySlideImage() { if (api.assetUrl && this.data.slide) this.loadSlide(this.data.slide.number); else if (this._slideImageUrl) this.loadPreview(this._slideImageUrl, true); else if (this.data.slide) this.loadSlide(this.data.slide.number) },
  previewSlideImage() { if (this.data.slideImage) wx.previewImage({ urls: [this.data.slideImage], current: this.data.slideImage }) },
  loadSlide(number) {
    if (!api.page) return
    const serial = this._slideSerial = (this._slideSerial || 0) + 1
    this._previewSerial = (this._previewSerial || 0) + 1
    if (this._imageTask && this._imageTask.abort) this._imageTask.abort()
    this._slideImageUrl = ''
    this.setData({ slideLoading: true, slideImage: '', slideImageError: '', slideImageLoading: false })
    api.page(this.documentId, this.version, number).then(res => {
      if (this._closed || serial !== this._slideSerial) return
      this.setData({ slide: res.page, slideCount: res.pageCount, slideLoading: false })
      if (res.page.hasImage) {
        if (api.assetUrl) {
          api.assetUrl(this.documentId, this.version, number).then(url => {
            if (this._closed || serial !== this._slideSerial) return
            this._slideImageUrl = url; this.loadPreview(url, true)
          }).catch(error => { if (!this._closed && serial === this._slideSerial) this.setData({ slideImageError: error.message, slideImageLoading: false }) })
          return
        }
        this._slideImageUrl = api.pageImageUrl(this.documentId, this.version, number)
        this.loadPreview(this._slideImageUrl, true)
      }
    }).catch(err => { if (!this._closed && serial === this._slideSerial) this.setData({ slideLoading: false, error: err.message }) })
  },
  previousSlide() { if (this.data.slide && !this.data.slideLoading && this.data.slide.number > 1) this.loadSlide(this.data.slide.number - 1) },
  nextSlide() { if (this.data.slide && !this.data.slideLoading && this.data.slide.number < this.data.slideCount) this.loadSlide(this.data.slide.number + 1) },
  load() {
    this.setData({ loading: true, error: '' })
    if (this.chunkId) {
      api.chunk(this.documentId, this.version, this.chunkId).then(res => { this.setDocument(res.document); this.setData({ chunk: res.chunk }); if(res.chunk.pageNumber)this.loadSlide(res.chunk.pageNumber) })
        .catch(err => this.setData({ error: err.message })).finally(() => this.setData({ loading: false }))
    } else this.loadFull()
  },
  loadFull() {
    this.setData({ loading: true, error: '' })
    api.document(this.documentId, this.version, 0).then(res => {
      this.setDocument(res.document)
      if(res.document.format === 'pptx' && !this.data.slide)this.loadSlide(1)
      this.setData({ lines: res.lines, nextOffset: res.nextOffset, fullLoaded: true })
    }).catch(err => this.setData({ error: err.message })).finally(() => this.setData({ loading: false }))
  },
  onVideoError(event) {
    const detail = event.detail || {}
    console.error('[video]', detail)
    this.setData({ videoError: '视频流播放失败：' + (detail.errMsg || detail.message || '播放器未返回错误详情') + '。可尝试下方下载后播放。' })
  },
  onVideoReady() { this.setData({ videoError: '' }) },
  downloadVideo() {
    if (this.data.downloading) return
    this.setData({ downloading: true, videoProgress: 0, videoError: '' })
    const download = url => {
    const task = wx.downloadFile({ url, timeout: 120000,
      success: res => {
        if (res.statusCode !== 200) { this.setData({ videoError: '视频下载失败：HTTP ' + res.statusCode }); return }
        this.setData({ originalUrl: res.tempFilePath })
      },
      fail: error => this.setData({ videoError: '视频下载失败：' + error.errMsg }),
      complete: () => this.setData({ downloading: false })
    })
    if (task && task.onProgressUpdate) task.onProgressUpdate(progress => this.setData({ videoProgress: progress.progress }))
    }
    if (api.assetUrl) api.assetUrl(this.documentId, this.version).then(url => { if (!this._closed) download(url) })
      .catch(error => { if (!this._closed) this.setData({ downloading: false, videoError: error.message }) })
    else download(api.originalUrl(this.documentId, this.version))
  },
  previewImage() { if (this.data.imagePath) wx.previewImage({ urls: [this.data.imagePath], current: this.data.imagePath }) },
  openOriginal() {
    if (this.data.opening || !this.data.originalUrl) return
    this.setData({ opening: true, error: '' })
    const download = url => wx.downloadFile({ url, timeout: 120000, success: res => {
      if (res.statusCode !== 200) { this.setData({ opening: false, error: '原件下载失败，请刷新资料库后重试。' }); return }
      wx.openDocument({ filePath: res.tempFilePath, fileType: this.data.document.format, showMenu: true,
        fail: () => this.setData({ error: '此设备无法打开该原件，可先查看下方提取文本；较大文件请在电脑端查看。' }),
        complete: () => { this.setData({ opening: false }) } })
    }, fail: () => this.setData({ opening: false, error: '下载原件失败，请检查网络；大文件建议在电脑查看。' }) })
    if (api.assetUrl) api.assetUrl(this.documentId, this.version).then(url => { if (!this._closed) download(url) })
      .catch(error => { if (!this._closed) this.setData({ opening: false, error: error.message }) })
    else download(this.data.originalUrl)
  },
  loadMore() {
    if (this.data.loading || this.data.nextOffset === null) return
    this.setData({ loading: true, error: '' })
    api.document(this.documentId, this.version, this.data.nextOffset).then(res => this.setData({ lines: this.data.lines.concat(res.lines), nextOffset: res.nextOffset }))
      .catch(err => this.setData({ error: err.message })).finally(() => this.setData({ loading: false }))
  }
})
