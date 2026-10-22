'use strict'

const introduction = require('./introduction')

// 分享文案和本地封面统一在这里填写，详见 SHARE.md。
// title/imageUrl 用于好友；timelineTitle/timelineImageUrl 用于朋友圈。
// imageUrl 可使用小程序代码包内的本地图片路径。
module.exports = {
  defaults: {
    title: introduction.name + '广州华商学院AI助学护理问答助手',
    imageUrl: '/pages/index/share-home.jpg',
    timelineTitle: introduction.name + ' · 广州华商学院 AI 助学护理问答助手',
    timelineImageUrl: '/pages/index/share-home.jpg'
  },
  pages: {
    chat: { title: 'AI助学护理问答', imageUrl: '/pages/index/share-home.jpg', timelineTitle: 'AI助学护理问答 · 随时查阅护理资料', timelineImageUrl: '/pages/index/share-home.jpg' },
    introduction: { title: ' 广州华商学院AI助学护理问答助手 ', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '广州华商学院 AI 助学护理问答助手', 
    timelineImageUrl: '/pages/index/share-home.jpg' },
    library: { title: '好友给你分享了母婴护理资料库', 
    imageUrl: '/pages/index/share-library.jpg', 
    timelineTitle: '母婴护理资料库 · 学习资料一处查阅', 
    timelineImageUrl: '/pages/index/share-library.jpg' },
    information: { title: '{title} · 关于护理问答助手', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '{title} · 护理学习指南', 
    timelineImageUrl: '/pages/index/share-home.jpg' },
    document: { title: '好友给你分享了 {title}', 
    imageUrl: '/pages/index/share-document.jpg', 
    timelineTitle: '护理学习资料：{title}', 
    timelineImageUrl: '/pages/index/share-document.jpg' }
  },
  sections: {
    about: { title: '产品介绍 · 关于护理问答助手', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '产品介绍 · 护理问答助手', 
    timelineImageUrl: '/pages/index/share-home.jpg' },
    checklist: { title: '学习清单 · 护理学习指南', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '学习清单 · 规划护理学习', 
    timelineImageUrl: '/pages/index/share-home.jpg' },
    faq: { title: '常见问题 · 护理问答助手', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '常见问题 · 护理问答助手', 
    timelineImageUrl: '/pages/index/share-home.jpg' },
    contact: { title: '关于与联系 · 护理问答助手', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '关于与联系 · 护理问答助手', 
    timelineImageUrl: '/pages/index/share-home.jpg' }
  },
  topics: {
    organize: { title: '给资料一个清晰的位置 · 护理学习指南', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '给资料一个清晰的位置 · 护理学习指南', 
    timelineImageUrl: '/pages/index/share-home.jpg' },
    reading: { title: '带着问题开始阅读 · 护理学习指南', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '带着问题开始阅读 · 护理学习指南', 
    timelineImageUrl: '/pages/index/share-home.jpg' },
    review: { title: '让笔记真正参与复习 · 护理学习指南', 
    imageUrl: '/pages/index/share-home.jpg', 
    timelineTitle: '让笔记真正参与复习 · 护理学习指南', 
    timelineImageUrl: '/pages/index/share-home.jpg' }
  },
  documents: {
    // '资料ID或完整标题': { title: '自定义标题', imageUrl: '/pages/index/share-document.jpg', timelineTitle: '', timelineImageUrl: '/pages/index/share-document.jpg' }
  }
}
