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
