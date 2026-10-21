// Public introduction content. Only fill contact fields with real public details.
module.exports = {
  name: '材料助手',
  tagline: '整理有方法，学习有方向。',
  description: '从资料分类到阅读笔记，提供清晰、实用的学习资料整理指南，帮助你建立自己的学习习惯。',
  contact: {
    phone: '',
    email: '',
    address: '',
    // WeChat openLocation uses GCJ-02 coordinates. Keep null until verified.
    latitude: null,
    longitude: null,
    locationName: ''
  },
  topics: [
    { id: 'organize', number: '01', title: '给资料一个清晰的位置', summary: '按课程与主题分类，用统一命名减少寻找时间。',
      paragraphs: ['先为每门课程建立独立目录，再按课件、阅读材料、练习和笔记分组。分类不必太细，能快速找到资料即可。', '文件名建议包含日期、主题与版本，例如“2026-10-21_阅读笔记_v1”。保留原始文件，整理后的笔记单独存放。', '每周清理一次重复文件，将暂时不用的内容移入归档目录。重要资料在可信设备上备份，避免只保存一份。'] },
    { id: 'reading', number: '02', title: '带着问题开始阅读', summary: '先看目录，再找重点，最后用自己的话复述。',
      paragraphs: ['阅读前先浏览标题和目录，写下希望解决的两个问题。明确目标可以帮助你选择阅读顺序。', '阅读时区分事实、观点与例子。摘录关键句时同时记录资料名称、日期和页码，方便以后核对。', '读完后关闭资料，用自己的话写下三个要点。不能解释清楚的地方，回到原文补充理解。'] },
    { id: 'review', number: '03', title: '让笔记真正参与复习', summary: '把要点变成小问题，用短时间重复巩固。',
      paragraphs: ['每条笔记围绕一个主题，记录“核心概念、自己的理解、具体例子、待确认问题”。避免只复制大段原文。', '将知识点改写成可以自测的问题，先尝试回忆，再核对笔记。把容易混淆的内容放在一起比较。', '按自己的学习节奏安排复习。每次复习后补充仍不清楚的问题，及时更新笔记中的来源和结论。'] }
  ],
  checklist: [
    { id: 'sort', title: '按课程或主题完成资料分类' },
    { id: 'name', title: '为常用文件设置清晰的名称' },
    { id: 'source', title: '为笔记记录原文来源和位置' },
    { id: 'summary', title: '用自己的话总结三个知识点' },
    { id: 'backup', title: '备份重要资料并安排下次复习' }
  ],
  faqs: [
    { id: 'purpose', question: '这里可以做什么？', answer: '你可以阅读产品介绍和资料整理指南，搜索学习主题，并使用学习清单记录自己的整理进度。' },
    { id: 'offline', question: '阅读指南需要上传资料吗？', answer: '不需要。指南和清单在小程序内提供，不需要上传个人学习资料。打开页面时需要联网获取当前服务状态。' },
    { id: 'save', question: '清单进度会保存在哪里？', answer: '清单只保存在当前设备的微信本地存储中，不上传服务器、不跨设备同步。清除小程序数据或更换设备后可能丢失。' },
    { id: 'reset', question: '如何重新开始学习清单？', answer: '进入“学习清单”，点击“重置清单”，确认后即可清除当前设备保存的勾选记录。' },
    { id: 'privacy', question: '介绍页面会收集哪些信息？', answer: '介绍与指南无需填写姓名、手机号或位置。页面联网读取服务状态；学习清单使用本地存储。拨号与地图仅在配置真实联系方式后提供，并由你主动点击使用。' }
  ]
}
