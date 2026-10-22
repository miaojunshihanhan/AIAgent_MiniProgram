'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const sharing = require('../../services/share')
const introduction = require('../../config/introduction')
const sharePages = [
  ['pages/index/index', 'chat'],
  ['pages/intro/intro', 'introduction'],
  ['pages/library/library', 'library'],
  ['pages/information/information', 'information'],
  ['pages/source/source', 'document']
]
function page(relative, api, wx = {}) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), { require: name => name.endsWith('/access') ? { check: (page, service, introductionMode, ready) => { page.setData({ accessReady: true }); if (ready) ready() } } : (name.endsWith('/share') ? sharing : (name.endsWith('/introduction') ? introduction : api)), Page: value => {definition = value}, wx, Date, encodeURIComponent, setInterval:()=>1, clearInterval:()=>{} })
  definition.data = JSON.parse(JSON.stringify(definition.data))
  definition.setData = values => Object.assign(definition.data, values)
  return definition
}
const tick = () => new Promise(resolve => setImmediate(resolve))
test('both pages open and close the shared announcement dialog without merging notice blocks', () => {
  for (const route of ['pages/intro/intro.js', 'pages/index/index.js']) {
    const view = page(route, {})
    view.setData({ announcement: '维护公告：今晚 20:00 更新', stableNotice: '常驻公告：2026-10-22 已更新 & v2.0' })
    view.showAnnouncement()
    assert.equal(view.data.announcementVisible, true)
    assert.equal(view.data.stableNotice, '常驻公告：2026-10-22 已更新 & v2.0')
    assert.equal(view.data.announcement, '维护公告：今晚 20:00 更新')
    view.closeAnnouncement()
    assert.equal(view.data.announcementVisible, false)
    view.setData({ announcement: '' })
    view.showAnnouncement()
    assert.equal(view.data.announcementVisible, true)
    view.setData({ stableNotice: '' })
    assert.equal(view.data.stableNotice, '')
    const markup = fs.readFileSync(path.join(root, route.replace('.js', '.wxml')), 'utf8')
    assert.ok(markup.includes('is="announcement"'))
  }
  const template = fs.readFileSync(path.join(root, 'services/announcement.wxml'), 'utf8')
  assert.ok(template.indexOf('{{stableNotice}}') < template.indexOf('{{announcement}}', template.indexOf('{{stableNotice}}')))
  assert.ok(template.includes('wx:if="{{stableNotice}}"'))
  assert.ok(template.includes('wx:if="{{announcement}}"'))
  assert.ok(!template.includes('暂无公告'))
  assert.match(fs.readFileSync(path.join(root, 'app.wxss'), 'utf8'), /\.announcement-paragraph\{display:block;/)
})
test('all shareable pages enable timeline sharing and define both share callbacks', () => {
  for (const [route, key] of sharePages) {
    const options = JSON.parse(fs.readFileSync(path.join(root, route + '.json'), 'utf8'))
    const source = fs.readFileSync(path.join(root, route + '.js'), 'utf8')
    assert.equal(options.enableShareTimeline, true, route + ' must enable timeline sharing')
    assert.ok(source.includes("onShareAppMessage() { return share.build('" + key + "', this, false)"), route + ' must define friend sharing')
    assert.ok(source.includes("onShareTimeline() { return share.build('" + key + "', this, true)"), route + ' must define timeline sharing')
  }
})
test('configured share covers are local package files', () => {
  const config = require('../../config/share')
  const groups = [config.defaults, ...Object.values(config.pages), ...Object.values(config.sections), ...Object.values(config.topics)]
  for (const entry of groups) {
    for (const field of ['imageUrl', 'timelineImageUrl']) {
      assert.ok(entry[field].startsWith('/'), field + ' must use a local mini-program path')
      assert.ok(fs.existsSync(path.join(root, entry[field].slice(1))), entry[field] + ' must exist in the package')
    }
  }
})
test('share cards preserve guide sections, document versions, citation chunks, and slide pages', () => {
  const section = sharing.build('information', { data: { section: 'faq', title: '常见问题' } }, false)
  assert.equal(section.path, '/pages/information/information?section=faq')
  assert.equal(section.title, '常见问题 · 护理问答助手')
  const topic = sharing.build('information', { data: { topic: { id: 'reading', title: '带着问题开始阅读' } } }, true)
  assert.equal(topic.query, 'topic=reading')
  assert.equal(topic.path, undefined)
  assert.equal(topic.title, '带着问题开始阅读 · 护理学习指南')
  const document = sharing.build('document', { documentId: 'doc id', version: 'v&1', chunkId: 'chunk/2', data: { document: { title: '课件' }, slide: { number: 7 } } }, false)
  assert.match(document.path, /^\/pages\/source\/source\?id=doc%20id&version=v%261&chunk=chunk%2F2&page=7$/)
  const timeline = sharing.build('document', { documentId: 'doc', version: 'version', data: { document: { title: '讲义' } } }, true)
  assert.equal(timeline.query, 'id=doc&version=version')
  assert.equal(timeline.path, undefined)
})
test('per-document share settings override defaults and restore a shared slide', async () => {
  const config = require('../../config/share')
  config.documents['测试资料'] = { title: '好友：{title}', imageUrl: 'https://cos.example/friend.jpg', timelineTitle: '朋友圈：{title}', timelineImageUrl: 'https://cos.example/square.jpg' }
  try {
    const pageState = { _sourceOptions: { id: 'd', version: 'v' }, data: { document: { title: '测试资料' } } }
    assert.equal(sharing.build('document', pageState, false).title, '好友：测试资料')
    assert.equal(sharing.build('document', pageState, true).imageUrl, 'https://cos.example/square.jpg')
  } finally { delete config.documents['测试资料'] }
  let opened
  const source = page('pages/source/source.js', {
    document: async () => ({ document: { id: 'd', version: 'v', title: '课件', format: 'pptx' }, lines: [], nextOffset: null }),
    page: async (id, version, number) => { opened = number; return { page: { number, hasImage: false }, pageCount: 10 } }
  })
  source.onLoad({ id: 'd', version: 'v', page: '7' })
  await tick()
  assert.equal(opened, 7)
  source.setData({ slide: { number: 8 } })
  assert.match(source.onShareAppMessage().path, /page=8$/)
})
test('partial answers update one bubble and final answer replaces it',async()=>{
 let stream,finish
 const app=page('pages/index/index.js',{chat:(q,h,options)=>{stream=options.onText;return new Promise(resolve=>{finish=resolve})}},{setStorageSync:()=>{}})
 app.setData({input:'我的问题'});app.send()
 stream('第一段');stream('第一段\n第二段')
 assert.equal(app.data.messages.length,2);assert.equal(app.data.messages[1].partial,true)
 assert.equal(app.data.messages[1].content,'第一段\n第二段')
 finish({answer:'最终要点',citations:[],mode:'api'});await tick()
 assert.equal(app.data.messages.length,2);assert.equal(app.data.messages[1].content,'最终要点');assert.equal(app.data.messages[1].partial,undefined)
})
test('chat sends question, persists cited answer, and opens exact source route', async () => {
  const saved = [], navigated = []
  const source = {documentId:'doc',documentVersion:'version',chunkId:'chunk'}
  const app = page('pages/index/index.js', {chat: async question => { assert.equal(question, '质保多久'); return {answer:'十二个月[1]',citations:[source],mode:'mock'} }},
    {setStorageSync: (key, value) => saved.push(value), navigateTo: value => navigated.push(value.url)})
  app.setData({input:'质保多久'}); app.send(); await tick()
  assert.equal(app.data.sending, false); assert.equal(app.data.messages.length, 2)
  assert.equal(app.data.messages[1].citations[0].chunkId, 'chunk'); assert.equal(saved.length, 2)
  app.openSource({currentTarget:{dataset:{source}}})
  assert.match(navigated[0], /id=doc&version=version&chunk=chunk/)
})
test('failed chat restores question and enables retry', async () => {
  const app = page('pages/index/index.js', {chat: async () => {throw new Error('连接失败')}}, {setStorageSync: () => {}})
  app.setData({input:'原始问题'}); app.send(); await tick()
  assert.equal(app.data.sending, false); assert.equal(app.data.input, '原始问题'); assert.equal(app.data.error, '连接失败')
  assert.equal(app.data.messages.length, 0)
})
test('temporary polling failure preserves job and resumes it without submitting question again',async()=>{
 const storage=new Map();let attempts=0
 const app=page('pages/index/index.js',{chat:async(q,h,options)=>{
  attempts++
  if(attempts===1){options.onJob('original-job');options.onProgress({progress:{label:'正在读取相关材料'}});throw Object.assign(new Error('网络不稳定'),{jobId:'original-job'})}
  assert.equal(options.jobId,'original-job');return {answer:'已恢复的原回答',citations:[],mode:'api'}
 }},{setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)})
 app.setData({input:'我的问题'});app.send();await tick()
 assert.equal(app.data.pendingJob,true);assert.equal(app.data.messages.length,1);assert.equal(app.data.waitingText,'正在读取相关材料')
 assert.equal(storage.get('knowledge-chat-pending-v1').jobId,'original-job')
 app.resumeAnswer();await tick()
 assert.equal(attempts,2);assert.equal(app.data.messages.length,2);assert.equal(app.data.messages[1].content,'已恢复的原回答')
 assert.equal(app.data.pendingJob,false);assert.equal(storage.has('knowledge-chat-pending-v1'),false)
})
test('reopening chat resumes saved job and keeps typed draft while waiting',async()=>{
 let options
 const saved={jobId:'saved-job',id:'old',question:'此前问题'}
 const app=page('pages/index/index.js',{health:async()=>({modelMode:'api',documentCount:1}),chat:async(q,h,o)=>{options=o;return {answer:'恢复结果',citations:[],mode:'api'}}},
 {getStorageSync:key=>key==='knowledge-chat-pending-v1'?saved:[{id:'old-q',role:'user',content:'此前问题'}],setStorageSync:()=>{},removeStorageSync:()=>{}})
 app.onLoad();app.onInput({detail:{value:'正在输入的下个问题'}});await tick()
 assert.equal(options.jobId,'saved-job');assert.equal(app.data.messages[1].content,'恢复结果');assert.equal(app.data.input,'正在输入的下个问题')
})

test('follow-up passes bounded history and material names without duplicating current question', async () => {
  let sent
  const app = page('pages/index/index.js', {chat: async (question, history) => {sent={question,history};return {answer:'继续回答',citations:[],mode:'api'}}}, {setStorageSync:()=>{}})
  app.setData({messages:[{id:'q',role:'user',content:'怎么拍嗝？',citations:[]},{id:'a',role:'assistant',content:'请参考演示[1]',citations:[{title:'拍嗝演示.mp4'}]}],input:'还有其他姿势吗？'})
  app.send();await tick()
  assert.equal(sent.question,'还有其他姿势吗？');assert.equal(sent.history.length,2)
  assert.equal(sent.history[0].content,'怎么拍嗝？');assert.match(sent.history[1].content,/拍嗝演示.mp4/)
  assert.ok(sent.history.every(message=>message.content!==sent.question))
})

test('chat shows inline media, downloads images and does not persist expiring asset URLs', async () => {
  let download, saved
  const sources=[{id:'1',documentId:'image-doc',documentVersion:'v',chunkId:'image',kind:'image',quote:'名称'},
    {id:'2',documentId:'video-doc',documentVersion:'v',chunkId:'video',kind:'video',quote:'名称'}]
  const app=page('pages/index/index.js',{chat:async()=>({answer:'请参考[1][2]',citations:sources,mode:'api'}),assetUrl:async id=>'https://cos.example/'+id},
    {setStorageSync:(key,messages)=>{saved=messages},downloadFile:options=>{download=options},getImageInfo:options=>options.success({width:640,height:480})})
  app.setData({input:'给我相关材料'});app.send();await tick()
  assert.equal(download.url,'https://cos.example/image-doc');download.success({statusCode:200,tempFilePath:'wxfile://inline.png'})
  const message=app.data.messages[1]
  assert.equal(message.citations[0].assetPath,'wxfile://inline.png');assert.equal(message.citations[1].assetUrl,'https://cos.example/video-doc')
  app.saveMessages(app.data.messages)
  assert.equal(saved[1].citations[0].assetPath,undefined);assert.equal(saved[1].citations[1].assetUrl,undefined)
  app.onSourceAssetError({currentTarget:{dataset:{message:message.id,source:message.citations[1]}}})
  assert.match(app.data.messages[1].citations[1].assetError,/重试/)
  app.retrySourceAsset({currentTarget:{dataset:{message:message.id,source:message.citations[1]}}});await tick()
  assert.equal(app.data.messages[1].citations[1].assetError,'')
  const xml=fs.readFileSync(path.join(root,'pages/index/index.wxml'),'utf8')
  assert.match(xml,/source.pageText \|\| source.quote/);assert.match(xml,/<video[^>]*source.assetUrl/)
  assert.match(xml,/<text wx:if="{{!source.metadataOnly}}" class="source-quote"/)
  assert.match(xml,/<view wx:if="{{!source.metadataOnly}}" class="source-location"/)
  const json=JSON.parse(fs.readFileSync(path.join(root,'pages/index/index.json'),'utf8'))
  assert.equal(json.renderer,'webview')
})

test('cached media fetches fresh signed URLs on reload and keeps text if download fails', async()=>{
  let download
  const cached=[{id:'old',role:'assistant',content:'演示[1]',citations:[{chunkId:'c',documentId:'d',documentVersion:'v',kind:'image',quote:'完整依据'}]}]
  const app=page('pages/index/index.js',{health:async()=>({modelMode:'api',documentCount:1}),assetUrl:async()=> 'https://cos.example/fresh'},
    {getStorageSync:()=>cached,downloadFile:options=>{download=options}})
  app.onLoad();await tick();assert.equal(download.url,'https://cos.example/fresh')
  download.fail({errMsg:'offline'})
  assert.equal(app.data.messages[0].citations[0].quote,'完整依据');assert.match(app.data.messages[0].citations[0].assetError,/下载失败/)
})
test('source page binds citation version and paginates original lines', async () => {
  const calls = [], document = {version:'version',title:'手册'}
  const app = page('pages/source/source.js', {
    chunk: async (...args) => {calls.push(args);return {document,chunk:{text:'原文',lineStart:1,lineEnd:1}}},
    document: async (id, version, offset) => ({document,lines:[{number:offset+1,text:'原文'}],nextOffset:offset===0?80:null})
  })
  app.onLoad({id:'doc',version:'version',chunk:'chunk'}); await tick()
  assert.deepEqual(calls[0], ['doc','version','chunk']); assert.equal(app.data.chunk.text, '原文')
  app.loadFull(); await tick(); assert.equal(app.data.lines.length, 1)
  app.loadMore(); await tick(); assert.equal(app.data.lines.length, 2); assert.equal(app.data.nextOffset, null)
})
test('every registered page has its implementation and backend is excluded from package', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
  for (const name of app.pages) for (const ext of ['js','json','wxml','wxss']) assert.ok(fs.existsSync(path.join(root,name+'.'+ext)))
  const project = JSON.parse(fs.readFileSync(path.join(root,'project.config.example.json'),'utf8'))
  assert.ok(project.packOptions.ignore.some(item => item.type==='folder' && item.value==='backend'))
})

test('media opened from library receives original URL', async () => {
  const app = page('pages/source/source.js', {document: async () => ({document:{id:'doc',version:'v',kind:'video'},lines:[],nextOffset:null}), originalUrl: (id,version) => '/documents/'+id+'/original?version='+version})
  app.onLoad({id:'doc',version:'v'}); await tick()
  assert.equal(app.data.originalUrl,'/documents/doc/original?version=v')
})

test('WXML bindings contain executable operators rather than HTML entities', () => {
  const folders = ['pages', 'components']
  const templates = []
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(relative)
      else if (entry.name.endsWith('.wxml')) templates.push(relative)
    }
  }
  folders.forEach(walk)
  let count = 0
  for (const relative of templates) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    for (const match of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      const expression = match[1]
      assert.doesNotMatch(expression, /&(?:amp|lt|gt|quot|apos);/, relative + ': escaped operator in binding')
      assert.doesNotThrow(() => new vm.Script('(' + expression + ')'), relative + ': invalid binding: ' + expression)
      count++
    }
  }
  assert.ok(count > 20, 'Expected all application bindings to be inspected')
})

test('video player provides concrete errors and downloads local fallback', () => {
  let options
  const app=page('pages/source/source.js',{originalUrl:()=> 'http://test/video.mp4'}, {downloadFile:value=>{options=value;return {onProgressUpdate:handler=>handler({progress:50})}}})
  app.documentId='doc';app.version='v'
  app.onVideoError({detail:{errMsg:'decode failure'}})
  assert.match(app.data.videoError,/decode failure/)
  app.downloadVideo();assert.equal(app.data.videoProgress,50)
  options.success({statusCode:200,tempFilePath:'wxfile://cached.mp4'});options.complete()
  assert.equal(app.data.originalUrl,'wxfile://cached.mp4');assert.equal(app.data.downloading,false)
})

test('chat preserves paragraphs, empty lines, and long text for bounded line rendering', async () => {
  const answer = '第一段\r\n\r\n第二段\n' + 'x'.repeat(500)
  const app = page('pages/index/index.js', {chat: async () => ({answer,citations:[],mode:'api'})}, {setStorageSync: () => {}})
  app.setData({input:'测试换行'}); app.send(); await tick()
  const message = app.data.messages[1]
  assert.equal(message.content, answer)
  assert.deepEqual(Array.from(message.lines), ['第一段', '\u00a0', '第二段', 'x'.repeat(500)])
})

test('cached chat receives the same paragraph rendering after reload', async () => {
  const app = page('pages/index/index.js', {health: async () => ({modelMode:'mock',documentCount:0})}, {getStorageSync: () => [{id:'old',role:'assistant',content:'甲\n乙'}]})
  app.onLoad(); await tick()
  assert.deepEqual(Array.from(app.data.messages[0].lines), ['甲', '乙'])
  assert.match(app.data.status,/云端仍为旧版/)
})

test('health identifies the deployed conversation backend and configured model mode',async()=>{
  const app=page('pages/index/index.js',{health:async()=>({modelMode:'api',modelConfigured:true,documentCount:3,runtimeVersion:'2026-10-20-chat-v6',capabilities:{conversation:true,materialTools:true,asyncChat:true,chatProgress:true,streaming:true,singleModelCall:true}})})
  app.refreshHealth();await tick()
  assert.equal(app.data.status,'模型 API 模式 · 流式 · 3 份材料')
})

test('image preview downloads and decodes a local file before display and zoom', async () => {
  let download, preview
  const app = page('pages/source/source.js', {
    document: async () => ({document:{id:'doc',version:'v',kind:'image',format:'jpg'},lines:[],nextOffset:null}),
    originalUrl: () => 'http://backend/doc/original?version=v'
  }, {downloadFile: options => {download=options;return {abort(){}}},
    getImageInfo: options => { assert.equal(options.src,'wxfile://image.jpg'); options.success({width:1200,height:800}) },
    previewImage: options => {preview=options}})
  app.onLoad({id:'doc',version:'v'});await tick()
  assert.equal(app.data.imageLoading,true);assert.equal(app.data.imagePath,'')
  download.success({statusCode:200,tempFilePath:'wxfile://image.jpg'})
  assert.equal(app.data.imagePath,'wxfile://image.jpg');assert.equal(app.data.imageHeight,460)
  app.previewImage();assert.equal(preview.current,'wxfile://image.jpg')
})
test('image failures are visible and retry can recover without a blank preview', () => {
  let download
  const app = page('pages/source/source.js', {}, {downloadFile: options => {download=options;return {abort(){}}}, getImageInfo: options => options.success({width:100,height:200})})
  app.setData({originalUrl:'http://backend/image'})
  app.retryImage();download.fail({errMsg:'downloadFile:fail domain blocked'})
  assert.match(app.data.imageError,/domain blocked/);assert.equal(app.data.imageLoading,false)
  app.retryImage();download.success({statusCode:404})
  assert.match(app.data.imageError,/HTTP 404/)
  app.retryImage();download.success({statusCode:200,tempFilePath:'wxfile://retry.jpg'})
  assert.equal(app.data.imageError,'');assert.equal(app.data.imagePath,'wxfile://retry.jpg')
})
test('PPT uses local page images and keeps extracted text when decoding fails', async () => {
  let download, decode
  const app = page('pages/source/source.js', {
    page: async (id,v,n) => ({page:{number:n,text:'本页依据',hasImage:true},pageCount:3}),pageImageUrl:(id,v,n)=>'http://backend/'+n+'.png'
  }, {downloadFile: options=>{download=options;return {abort(){}}},getImageInfo: options=>{decode=options}})
  app.documentId='doc';app.version='v';app.loadSlide(2);await tick()
  download.success({statusCode:200,tempFilePath:'wxfile://slide.png'});decode.fail({errMsg:'invalid image'})
  assert.equal(app.data.slide.text,'本页依据');assert.match(app.data.slideImageError,/invalid image/)
  app.retrySlideImage();download.success({statusCode:200,tempFilePath:'wxfile://slide.png'});decode.success({width:1600,height:900})
  assert.equal(app.data.slideImage,'wxfile://slide.png');assert.equal(app.data.slideImageHeight,360)
})
test('late image decoding and page responses cannot overwrite the current PPT page', async () => {
  const pending=[], downloads=[], decodes=[]
  const app=page('pages/source/source.js', {page:(id,v,n)=>new Promise(resolve=>pending.push({n,resolve})),pageImageUrl:(id,v,n)=>'http://backend/'+n},
    {downloadFile:o=>{downloads.push(o);return {abort(){}}},getImageInfo:o=>decodes.push(o)})
  app.loadSlide(1);pending[0].resolve({page:{number:1,hasImage:true},pageCount:3});await tick()
  downloads[0].success({statusCode:200,tempFilePath:'wxfile://old'});
  app.loadSlide(2);app.loadSlide(3)
  pending[2].resolve({page:{number:3,hasImage:true},pageCount:3});await tick()
  pending[1].resolve({page:{number:2,hasImage:true},pageCount:3});await tick()
  decodes[0].success({width:100,height:100});assert.equal(app.data.slideImage,'');assert.equal(app.data.slide.number,3)
  downloads[1].success({statusCode:200,tempFilePath:'wxfile://current'});decodes[1].success({width:100,height:100})
  assert.equal(app.data.slideImage,'wxfile://current')
  app.onUnload();downloads[1].fail({errMsg:'abort'});assert.equal(app.data.slideImageError,'')
})

test('PPT viewport stays fixed through metadata, download, decoding, failure and retry', async () => {
  let resolvePage, download, decode
  const app = page('pages/source/source.js', {page: () => new Promise(resolve => {resolvePage=resolve}),pageImageUrl: () => 'http://backend/slide'},
    {downloadFile: o => {download=o;return {abort(){}}},getImageInfo: o => {decode=o}})
  const height=app.data.slideImageHeight
  for (const size of [{width:1600,height:900},{width:600,height:1800}]) {
    app.loadSlide(1);assert.equal(app.data.slideImageHeight,height)
    resolvePage({page:{number:1,text:'依据',hasImage:true},pageCount:2});await tick()
    assert.equal(app.data.slideImageLoading,true);assert.equal(app.data.slideImageHeight,height)
    download.success({statusCode:200,tempFilePath:'wxfile://slide'})
    decode.success(size);assert.equal(app.data.slideImageHeight,height)
  }
  app.retrySlideImage();decode.fail({errMsg:'cache expired'})
  assert.equal(app.data.slideImageHeight,height);assert.ok(app.data.slideImageError)
  app.retrySlideImage();download.success({statusCode:200,tempFilePath:'wxfile://retry'});decode.success({width:800,height:600})
  assert.equal(app.data.slideImageHeight,height)
  const xml=fs.readFileSync(path.join(root,'pages/source/source.wxml'),'utf8')
  const css=fs.readFileSync(path.join(root,'pages/source/source.wxss'),'utf8')
  assert.match(xml, /class="slide-stage"/)
  assert.match(xml, /class="slide-stage-loading"/)
  assert.match(css, /\.slide-stage\{[^}]*height:360rpx/)
})
