'use strict'
const config = require('../config/share')
const routes = {
  chat: '/pages/index/index', introduction: '/pages/intro/intro',
  library: '/pages/library/library', information: '/pages/information/information', document: '/pages/source/source'
}

function queryString(values) {
  return Object.keys(values).filter(key => values[key] !== '' && values[key] !== undefined && values[key] !== null)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(values[key]))).join('&')
}

function build(key, page, timeline) {
  const data = page.data || {}
  let detail, title = '', query = ''
  if (key === 'information') {
    const topic = data.topic
    title = topic ? topic.title : data.title || '学习指南'
    detail = topic ? config.topics[topic.id] : config.sections[data.section || 'about']
    query = queryString(topic ? { topic: topic.id } : { section: data.section || 'about' })
  } else if (key === 'document') {
    const document = data.document || {}
    const options = page._sourceOptions || {}
    const id = page.documentId || options.id || ''
    title = document.title || '资料详情'
    detail = config.documents[id] || config.documents[document.title]
    query = queryString({ id, version: page.version || options.version, chunk: page.chunkId || options.chunk,
      page: (data.slide && data.slide.number) || page._sharedPage || options.page })
  }
  const layers = [config.defaults, config.pages[key], detail].filter(Boolean)
  let shareTitle = '', imageUrl = ''
  layers.forEach(layer => {
    shareTitle = (timeline && layer.timelineTitle) || layer.title || shareTitle
    imageUrl = (timeline && layer.timelineImageUrl) || layer.imageUrl || imageUrl
  })
  return Object.assign({ title: shareTitle.replace(/\{title\}/g, () => title) },
    imageUrl ? { imageUrl } : {},
    timeline ? { query } : { path: routes[key] + (query ? '?' + query : '') })
}

function enable() {
  if (typeof wx !== 'undefined' && typeof wx.showShareMenu === 'function') {
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
  }
}

module.exports = { build, enable }
