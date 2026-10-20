'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
function page(relative, api, wx = {}) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), { require: () => api, Page: value => {definition = value}, wx, Date, encodeURIComponent })
  definition.data = JSON.parse(JSON.stringify(definition.data))
  definition.setData = values => Object.assign(definition.data, values)
  return definition
}
const tick = () => new Promise(resolve => setImmediate(resolve))
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
