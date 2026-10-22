'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { WebSocket } = require('ws')
const { createServer } = require('../src/server')
const root = path.resolve(__dirname, '../..')
const content = require('../../config/introduction')
async function serve(t, uploadCheck) {
  let calls = 0
  const server = createServer({ uploadCheck, deployment: 'cloud', storage: 'local', dataRoot: '/unused', mode: 'mock' }, { generateAnswer: () => { calls++; throw new Error('must not invoke model') } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const base = 'http://127.0.0.1:' + server.address().port
  const headers = { 'x-wx-source': 'miniprogram', 'x-wx-openid': 'user', 'content-type': 'application/json' }
  return { base, headers, calls: () => calls, request: (route, options = {}) => fetch(base + route, { ...options, headers }) }
}
test('introduction config needs no index, exposes only boolean, and retains cloud authentication', async t => {
  const { request, base } = await serve(t, true)
  const res = await request('/public-config')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await res.json(), { uploadCheck: true })
  assert.equal((await request('/health')).status, 200)
  assert.equal((await fetch(base + '/public-config')).status, 401)
})
test('UPLOAD_CHECK blocks model, document, asset and job routes before reading storage', async t => {
  const server = await serve(t, true)
  for (const route of ['/chat', '/chat/jobs', '/documents', '/documents/' + 'a'.repeat(24) + '/original', '/chat/jobs/00000000-0000-0000-0000-000000000000']) {
    const res = await server.request(route, route.startsWith('/chat') && !route.includes('00000000') ? { method: 'POST', body: JSON.stringify({ question: '你好' }) } : {})
    assert.equal(res.status, 503, route)
    assert.equal((await res.json()).uploadCheck, true)
  }
  assert.equal(server.calls(), 0)
})
test('UPLOAD_CHECK blocks websocket upgrades', async t => {
  const { base, headers } = await serve(t, true)
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/chat/jobs/00000000-0000-0000-0000-000000000000/stream', { headers })
    ws.on('open', () => { ws.terminate(); reject(new Error('stream must not open')) })
    ws.on('error', reject)
    ws.on('unexpected-response', (req, res) => { assert.equal(res.statusCode, 503); res.resume(); resolve() })
  })
})
test('false preserves normal chat even for local preset questions', async t => {
  const { request } = await serve(t, false)
  assert.deepEqual(await (await request('/public-config')).json(), { uploadCheck: false })
  const res = await request('/chat/jobs', { method: 'POST', body: JSON.stringify({ question: '你好' }) })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'completed')
})
function moduleInVm(file, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { module, ...globals })
  return module.exports
}

test('missing public-config explains deployment and preserves HTTP status without choosing a mode', async () => {
  let response = { statusCode: 404, data: { error: '接口不存在。' } }
  const api = moduleInVm('services/api.js', {
    require: () => ({ mode: 'container', env: 'test', service: 'test' }),
    wx: { cloud: { callContainer: args => args.success(response) }, reLaunch() { assert.fail('must not choose a mode on failure') } }
  })
  await assert.rejects(api.publicConfig(), error => error.status === 404 && /部署最新后端代码/.test(error.message))
  for (const uploadCheck of [true, false]) {
    response = { statusCode: 200, data: { uploadCheck } }
    assert.equal((await api.publicConfig()).uploadCheck, uploadCheck)
  }
})
test('page gate checks every entry, redirects either way, and fails closed on invalid or failed config', async () => {
  const routes = [], wx = { reLaunch: options => routes.push(options.url) }
  const access = moduleInVm('services/access.js', { wx })
  const page = { data: {}, setData(patch) { Object.assign(this.data, patch) } }
  let ready = 0, checks = 0, mode = true
  const api = { publicConfig: async () => { checks++; return { uploadCheck: mode } } }
  await access.check(page, api, false, () => ready++)
  assert.equal(page.data.accessReady, false); assert.equal(ready, 0); assert.equal(routes.pop(), '/pages/intro/intro')
  mode = false
  await access.check(page, api, false, () => ready++)
  assert.equal(page.data.accessReady, true); assert.equal(ready, 1); assert.equal(checks, 2)
  await access.check(page, api, true)
  assert.equal(routes.pop(), '/pages/index/index')
  await access.check(page, { publicConfig: async () => ({}) }, false)
  assert.equal(page.data.accessReady, false); assert.ok(page.data.accessError)
  await access.check(page, { publicConfig: async () => { throw new Error('offline') } }, false)
  assert.equal(page.data.accessReady, false); assert.equal(page.data.accessError, 'offline')
})
test('closed pages do not navigate when an old config request completes', async () => {
  let finish
  const access = moduleInVm('services/access.js', { wx: { reLaunch() { assert.fail('page already closed') } } })
  const page = { setData() {} }
  const pending = access.check(page, { publicConfig: () => new Promise(resolve => { finish = resolve }) }, false)
  page._accessClosed = true
  finish({ uploadCheck: true })
  await pending
})
function informationPage(wx) {
  let definition
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/information/information.js'), 'utf8'), {
    require: name => name.endsWith('/introduction') ? content : (name.endsWith('/access') ? { check: () => {} } : (name.endsWith('/share') ? require('../../services/share') : {})),
    wx, Page: value => { definition = value }
  })
  definition.data = JSON.parse(JSON.stringify(definition.data))
  definition.setData = patch => Object.assign(definition.data, patch)
  return definition
}
test('learning checklist restores valid entries, persists choices, and resets only after confirmation', () => {
  const storage = new Map([['learning-checklist-v1', ['sort', 'sort', 'unknown']]])
  let modal
  const page = informationPage({ getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), showModal: options => { modal = options } })
  page.onLoad({ section: 'checklist' })
  assert.equal(page.data.completed, 1)
  page.onChecklistChange({ detail: { value: ['sort', 'name'] } })
  assert.equal(page.data.progress, 40); assert.equal(storage.get('learning-checklist-v1').length, 2)
  page.resetChecklist(); modal.success({ confirm: false }); assert.equal(page.data.completed, 2)
  page.resetChecklist(); modal.success({ confirm: true }); assert.equal(page.data.completed, 0)
  assert.equal(storage.get('learning-checklist-v1').length, 0)
})
test('FAQ toggles answers, unknown topic falls back, and unconfigured contact actions stay inactive', () => {
  const page = informationPage({ getStorageSync: () => [] })
  page.onLoad({ topic: 'missing', section: 'unknown' }); assert.equal(page.data.section, 'about')
  const event = { currentTarget: { dataset: { id: 'purpose' } } }
  page.toggleQuestion(event); assert.equal(page.data.expanded, 'purpose')
  page.toggleQuestion(event); assert.equal(page.data.expanded, '')
  assert.equal(page.data.hasLocation, false)
  page.callPhone(); page.openLocation()
})
