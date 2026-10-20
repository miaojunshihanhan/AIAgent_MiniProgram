const api = require('../../services/api')
Page({
  data: { document: null, chunk: null, lines: [], nextOffset: null, loading: true, error: '', fullLoaded: false, shortVersion: '', originalUrl: '', opening: false, videoError: '', downloading: false, videoProgress: 0 },
  onLoad(options) {
    this.documentId = options.id || ''; this.version = options.version || ''; this.chunkId = options.chunk || ''
    this.load()
  },
  loadSlide(number) {
    if(!api.page)return
    api.page(this.documentId,this.version,number).then(res=>this.setData({slide:res.page,slideCount:res.pageCount,slideImage:res.page.hasImage?api.pageImageUrl(this.documentId,this.version,number):''})).catch(err=>this.setData({error:err.message}))
  },
  previousSlide(){if(this.data.slide.number>1)this.loadSlide(this.data.slide.number-1)},
  nextSlide(){if(this.data.slide.number<this.data.slideCount)this.loadSlide(this.data.slide.number+1)},
  load() {
    this.setData({ loading: true, error: '' })
    if (this.chunkId) {
      api.chunk(this.documentId, this.version, this.chunkId).then(res => { if(res.chunk.pageNumber)this.loadSlide(res.chunk.pageNumber);this.setData({ document: res.document, chunk: res.chunk, shortVersion: res.document.version.slice(0, 12), originalUrl: api.originalUrl ? api.originalUrl(res.document.id, res.document.version) : '' }) })
        .catch(err => this.setData({ error: err.message })).finally(() => this.setData({ loading: false }))
    } else this.loadFull()
  },
  loadFull() {
    this.setData({ loading: true, error: '' })
    api.document(this.documentId, this.version, 0).then(res => {
      this.version = res.document.version
      if(res.document.format === 'pptx' && !this.data.slide)this.loadSlide(1)
      this.setData({ document: res.document, lines: res.lines, nextOffset: res.nextOffset, fullLoaded: true, shortVersion: res.document.version.slice(0, 12), originalUrl: api.originalUrl ? api.originalUrl(res.document.id, res.document.version) : '' })
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
    const task = wx.downloadFile({ url: api.originalUrl(this.documentId, this.version), timeout: 120000,
      success: res => {
        if (res.statusCode !== 200) { this.setData({ videoError: '视频下载失败：HTTP ' + res.statusCode }); return }
        this.setData({ originalUrl: res.tempFilePath })
      },
      fail: error => this.setData({ videoError: '视频下载失败：' + error.errMsg }),
      complete: () => this.setData({ downloading: false })
    })
    if (task && task.onProgressUpdate) task.onProgressUpdate(progress => this.setData({ videoProgress: progress.progress }))
  },
  previewImage() { wx.previewImage({ urls: [this.data.originalUrl], current: this.data.originalUrl }) },
  openOriginal() {
    if (this.data.opening || !this.data.originalUrl) return
    this.setData({ opening: true, error: '' })
    wx.downloadFile({ url: this.data.originalUrl, timeout: 120000, success: res => {
      if (res.statusCode !== 200) { this.setData({ opening: false, error: '原件下载失败，请刷新资料库后重试。' }); return }
      wx.openDocument({ filePath: res.tempFilePath, fileType: this.data.document.format, showMenu: true,
        fail: () => this.setData({ error: '此设备无法打开该原件，可先查看下方提取文本；较大文件请在电脑端查看。' }),
        complete: () => { this.setData({ opening: false }) } })
    }, fail: () => this.setData({ opening: false, error: '下载原件失败，请检查网络；大文件建议在电脑查看。' }) })
  },
  loadMore() {
    if (this.data.loading || this.data.nextOffset === null) return
    this.setData({ loading: true, error: '' })
    api.document(this.documentId, this.version, this.data.nextOffset).then(res => this.setData({ lines: this.data.lines.concat(res.lines), nextOffset: res.nextOffset }))
      .catch(err => this.setData({ error: err.message })).finally(() => this.setData({ loading: false }))
  }
})
