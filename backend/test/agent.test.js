'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { importMaterials, loadIndex, retrieve, splitText } = require('../src/knowledge')
const { generateAnswer } = require('../src/model')
const { createServer } = require('../src/server')
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-agent-'))
  const config = { materialsRoot: path.join(root, 'materials'), dataRoot: path.join(root, 'data'), mode: 'mock', timeout: 3000 }
  await fs.mkdir(config.materialsRoot)
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return config
}
async function serve(t, config) {
  const server = createServer(config)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const base = 'http://127.0.0.1:' + server.address().port
  return (route, options) => fetch(base + route, options)
}
const post = question => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) })
test('empty knowledge does not fabricate evidence', async t => {
  const config = await fixture(t), request = await serve(t, config)
  const result = await (await request('/chat', post('质保期限'))).json()
  assert.equal(result.citations.length, 0)
  assert.match(result.answer, /本地摘录模式.*尚未调用模型/)
})
test('import, Chinese retrieval, citations, original text and bytes remain consistent', async t => {
  const config = await fixture(t)
  const text = '# 示例材料\r\n设备质保期限为十二个月。\r\n故障可联系售后人员。\r\n'
  await fs.writeFile(path.join(config.materialsRoot, '测试.md'), text)
  await fs.writeFile(path.join(config.materialsRoot, 'README.md'), 'ignored')
  await fs.writeFile(path.join(config.materialsRoot, 'scan.pdf'), 'not parsed')
  const imported = await importMaterials(config)
  assert.equal(imported.documentCount, 1); assert.equal(imported.skipped.length, 1)
  const index = await loadIndex(config)
  assert.equal(retrieve(index, '质保期限')[0].doc.title, '测试.md')
  const request = await serve(t, config)
  const health = await (await request('/health')).json()
  assert.equal(health.documentCount, 1); assert.equal(health.developmentOnly, true)
  const answer = await (await request('/chat', post('设备质保期限'))).json()
  assert.equal(answer.mode, 'mock'); assert.match(answer.answer, /尚未调用模型/)
  const source = answer.citations[0]
  assert.match(source.quote, /十二个月/)
  const route = '/documents/' + source.documentId
  const chunk = await (await request(route + '/chunks/' + source.chunkId + '?version=' + source.documentVersion)).json()
  assert.equal(chunk.chunk.text, source.quote)
  const full = await (await request(route + '?version=' + source.documentVersion)).json()
  assert.equal(full.lines[1].text, '设备质保期限为十二个月。')
  const original = await (await request(route + '/original?version=' + source.documentVersion)).text()
  assert.equal(original, text)
})
test('updated versions invalidate old citations, deletion withdraws access', async t => {
  const config = await fixture(t), filename = path.join(config.materialsRoot, 'a.txt')
  await fs.writeFile(filename, '保修期限十二个月。'); await importMaterials(config)
  const old = (await loadIndex(config)).documents[0]
  await fs.writeFile(filename, '保修期限二十四个月。'); await importMaterials(config)
  const latest = (await loadIndex(config)).documents[0]
  assert.equal(old.id, latest.id); assert.notEqual(old.version, latest.version)
  const request = await serve(t, config)
  assert.equal((await request('/documents/' + old.id + '?version=' + old.version)).status, 409)
  await fs.unlink(filename); await importMaterials(config)
  assert.equal((await request('/documents/' + old.id)).status, 404)
  assert.equal((await (await request('/documents')).json()).documents.length, 0)
})
test('validation rejects malformed questions and path traversal', async t => {
  const config = await fixture(t), request = await serve(t, config)
  for (const question of ['', ' '.repeat(5), 'a'.repeat(2001), 42]) assert.equal((await request('/chat', post(question))).status, 400)
  assert.equal((await request('/chat', {method: 'POST', body: '{}'})).status, 415)
  assert.equal((await request('/documents/%2e%2e%2f.env/original')).status, 404)
  const malformed = await request('/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{'})
  assert.equal(malformed.status, 400)
})
test('non UTF8 and empty files are explicitly skipped', async t => {
  const config = await fixture(t)
  await fs.writeFile(path.join(config.materialsRoot, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x80]))
  await fs.writeFile(path.join(config.materialsRoot, 'empty.txt'), '  ')
  const result = await importMaterials(config)
  assert.equal(result.documentCount, 0); assert.equal(result.skipped.length, 2)
})
const evidence = [{ id: '1', title: '手册', quote: '保修十二个月。', location: '第1行' }]
const apiConfig = { mode: 'api', apiUrl: 'https://model.example/chat/completions', apiKey: 'test-only', model: 'test', timeout: 3000 }
const modelResponse = output => async () => ({ok:true, json:async () => ({choices:[{message:{content: JSON.stringify(output)}}]})})
test('API adapter sends credentials only server-side and reads cited answers', async () => {
  const output = await generateAnswer('保修多久', evidence, apiConfig, async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-only')
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'test'); assert.match(body.messages[1].content, /保修十二个月/)
    return {ok:true, json:async () => ({choices:[{message:{content:JSON.stringify({answer:'保修十二个月。[1]',usedIds:['1']})}}]})}
  })
  assert.deepEqual(output.usedIds, ['1']); assert.equal(output.mode, 'api')
})
test('invented and inconsistent citations are rejected', async () => {
  for (const value of [{answer:'答案[9]',usedIds:['9']}, {answer:'答案[1]',usedIds:[]}, {answer:'答案',usedIds:['1']}]) {
    await assert.rejects(generateAnswer('问题', evidence, apiConfig, modelResponse(value)), /引用/)
  }
})
test('missing API configuration and upstream errors surface clearly', async () => {
  await assert.rejects(generateAnswer('问题', evidence, {...apiConfig,apiKey:''}), /填写/)
  await assert.rejects(generateAnswer('问题', evidence, apiConfig, async () => ({ok:false,status:401})), /HTTP 401/)
  await assert.rejects(generateAnswer('问题', evidence, apiConfig, async () => {throw new Error('secret raw error')}), /请求失败或超时/)
})
test('chunks stay bounded even when a source has one long line', () => {
  const text = '资料'.repeat(3000)
  const chunks = splitText(text)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(c => c.text.length <= 1000))
  assert.equal(chunks.map(c => c.text).join(''), text)
  assert.ok(chunks.every(c => c.lineStart === 1 && c.lineEnd === 1))
})

test('model accepts compatible root URLs and readable Chinese or escaped responses', async () => {
  const {resolveEndpoint,readAnswer}=require('../src/model')
  assert.equal(resolveEndpoint('https://provider.example/compatible-mode/v1/').pathname,'/compatible-mode/v1/chat/completions')
  assert.equal(resolveEndpoint('https://provider.example/v1/chat/completions').pathname,'/v1/chat/completions')
  assert.equal(readAnswer('保修十二个月。[1]',evidence).answer,'保修十二个月。[1]')
  const escaped=JSON.stringify({answer:'\\u4f60\\u597d[1]',usedIds:['1']})
  assert.equal(readAnswer(escaped,evidence).answer,'你好[1]')
})
test('configured model adapter disables thinking only when explicitly selected', async () => {
  let invoked=false
  await generateAnswer('问题',evidence,{...apiConfig,apiUrl:'https://model.example/v1',enableThinking:false},async(url,options)=>{
    invoked=true;assert.equal(url.pathname,'/v1/chat/completions');assert.equal(JSON.parse(options.body).enable_thinking,false)
    return {ok:true,json:async()=>({choices:[{message:{content:'可读中文回答[1]'}}]})}
  })
  assert.equal(invoked,true)
})
