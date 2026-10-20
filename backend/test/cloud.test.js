'use strict'
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const COS = require('cos-nodejs-sdk-v5')
const { createServer } = require('../src/server')
const { uploadSnapshot } = require('../src/storage')
const id = 'a'.repeat(24), version = 'b'.repeat(64)
const cloudConfig = () => ({ deployment: 'cloud', storage: 'cos', mode: 'mock', dataRoot: '/unused', cosBucket: 'test-1234567890', cosRegion: 'ap-shanghai', cosSecretId: 'test-id', cosSecretKey: 'test-key' })
async function serve(t, config) {
  const server = createServer(config)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const base = 'http://127.0.0.1:' + server.address().port
  return (route, headers = {}) => fetch(base + route, { headers })
}
const headers = { 'x-wx-source': 'miniprogram', 'x-wx-openid': 'member' }
test('cloud accepts all mini program users while requiring gateway identity', async t => {
  t.after(() => mock.restoreAll())
  mock.method(COS.prototype, 'getObject', (args, cb) => cb(null, { Body: JSON.stringify({ documents: [] }) }))
  const config = cloudConfig(), request = await serve(t, config)
  assert.equal((await request('/ready')).status, 200)
  assert.equal((await request('/documents')).status, 401)
  assert.equal((await request('/documents', { 'x-wx-source': 'miniprogram' })).status, 401)
  assert.equal((await request('/documents', { 'x-wx-openid': 'member' })).status, 401)
  assert.equal((await request('/documents', headers)).status, 200)
  assert.equal((await request('/documents', { ...headers, 'x-wx-openid': 'new-user' })).status, 200)
  config.allowedOpenids = ['old-allowlist-member']
  assert.equal((await request('/documents', { ...headers, 'x-wx-openid': 'another-user' })).status, 200)
  assert.deepEqual(await (await request('/whoami', headers)).json(), { openid: 'member' })
})
test('cloud reads and caches COS index, validates versions, and signs only known assets', async t => {
  t.after(() => mock.restoreAll())
  const doc = { id, version, title: 'test', text: 'evidence', chunks: [], original: id + '.txt', pages: [{ number: 1, text: 'page', hasImage: true }] }
  let reads = 0, signed = 0
  mock.method(COS.prototype, 'getObject', (args, cb) => { reads++; assert.equal(args.Key, 'knowledge-agent/knowledge.json'); cb(null, { Body: JSON.stringify({ documents: [doc] }) }) })
  mock.method(COS.prototype, 'headObject', (args, cb) => cb(null, {}))
  mock.method(COS.prototype, 'getObjectUrl', args => { signed++; assert.equal(args.Expires, 600); assert.equal(args.Protocol, 'https:'); return 'https://bucket.example/' + args.Key + '?signed=test' })
  const request = await serve(t, cloudConfig())
  assert.equal((await (await request('/health', headers)).json()).developmentOnly, false)
  assert.equal((await (await request('/documents', headers)).json()).documents.length, 1)
  const route = '/documents/' + id
  assert.equal((await request(route + '/original?version=old', headers)).status, 409)
  assert.equal((await request(route + '/pages/2/image?version=' + version, headers)).status, 404)
  const asset = await (await request(route + '/original?version=' + version, headers)).json()
  assert.match(asset.url, /^https:/); assert.equal(asset.expiresIn, 600)
  assert.equal((await (await request(route + '/pages/1?version=' + version, headers)).json()).page.hasImage, true)
  assert.equal(reads, 1); assert.equal(signed, 1)
})
test('upload publishes index after assets and records actual preview availability', async t => {
  t.after(() => mock.restoreAll())
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-upload-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const original = id + '-' + version + '.txt'
  await fs.mkdir(path.join(root, 'originals')); await fs.writeFile(path.join(root, 'originals', original), 'data')
  const previews = path.join(root, 'previews', id, version)
  await fs.mkdir(previews, { recursive: true }); await fs.writeFile(path.join(previews, '1.png'), 'png')
  await fs.writeFile(path.join(root, 'knowledge.json'), JSON.stringify({ documents: [{ id, version, original, pages: [{ number: 1 }, { number: 2 }] }] }))
  const operations = []
  mock.method(COS.prototype, 'headObject', (args, cb) => cb({ statusCode: 404 }))
  mock.method(COS.prototype, 'sliceUploadFile', (args, cb) => { operations.push(args.Key); cb(null, {}) })
  mock.method(COS.prototype, 'putObject', (args, cb) => {
    operations.push(args.Key)
    const pages = JSON.parse(args.Body).documents[0].pages
    assert.equal(pages[0].hasImage, true); assert.equal(pages[1].hasImage, false); cb(null, {})
  })
  const config = { ...cloudConfig(), dataRoot: root }
  await uploadSnapshot(config)
  assert.equal(operations.length, 3); assert.equal(operations[2], 'knowledge-agent/knowledge.json')
  operations.length = 0
  mock.method(COS.prototype, 'sliceUploadFile', (args, cb) => cb(new Error('upload failed')))
  await assert.rejects(uploadSnapshot(config), /upload failed/)
  assert.equal(operations.length, 0, 'Failed asset upload must never publish index')
})
test('mini program routes JSON via callContainer and retrieves signed media URLs', async () => {
  const config = { mode: 'container', env: 'test-env', service: 'test-service' }, calls = [], module = { exports: {} }
  const source = await fs.readFile(path.join(__dirname, '../../services/api.js'), 'utf8')
  vm.runInNewContext(source, { module, require: () => config, wx: { cloud: { callContainer(args) { calls.push(args); args.success({ statusCode: 200, data: args.path.includes('/original') ? { url: 'https://cos.example/signed' } : { status:'completed',result:{answer:'ok'} } }) } } }, encodeURIComponent, Promise, Error })
  const api = module.exports
  assert.equal((await api.chat('question')).answer, 'ok')
  assert.equal(calls[0].config.env, 'test-env'); assert.equal(calls[0].header['X-WX-SERVICE'], 'test-service')
  assert.equal(calls[0].path, '/chat/jobs'); assert.equal(calls[0].data.question, 'question');assert.equal(calls[0].timeout,12000)
  assert.equal(await api.assetUrl(id, version), 'https://cos.example/signed')
})

test('cloud jobs persist to COS and can be read from another replica',async t=>{
  t.after(()=>mock.restoreAll())
  const {createJobStore}=require('../src/jobs'),objects=new Map()
  mock.method(COS.prototype,'putObject',(args,cb)=>{assert.match(args.Key,/knowledge-agent\/chat-jobs\/[a-f0-9-]+\.json$/);objects.set(args.Key,args.Body);cb(null,{})})
  mock.method(COS.prototype,'getObject',(args,cb)=>objects.has(args.Key)?cb(null,{Body:objects.get(args.Key)}):cb({statusCode:404}))
  const config={...cloudConfig(),timeout:45000},worker=createJobStore(config),replica=createJobStore(config)
  const job=await worker.create('owner')
  assert.equal((await replica.get(job.id,'owner')).status,'running')
  await worker.finish(job,{answer:'已完成',citations:[]})
  const status=await replica.get(job.id,'owner')
  assert.equal(status.status,'completed');assert.equal(status.result.answer,'已完成')
  await assert.rejects(replica.get(job.id,'another-owner'),/不存在/)
})
