'use strict'
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const COS = require('cos-nodejs-sdk-v5')
const { uploadMaterials } = require('../scripts/upload-cos')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-materials-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  t.after(() => mock.restoreAll())
  const settings = { materialsRoot: path.join(root, 'materials'), dataRoot: path.join(root, 'data'),
    storage: 'cos', cosBucket: 'test-1234567890', cosRegion: 'ap-shanghai', cosSecretId: 'test-id', cosSecretKey: 'test-key' }
  await fs.mkdir(settings.materialsRoot)
  return settings
}

test('upload synchronizes renamed, edited and removed materials before publishing COS index', async t => {
  const settings = await fixture(t), published = [], uploaded = new Map()
  mock.method(COS.prototype, 'getObject', () => assert.fail('Import must use the local snapshot'))
  mock.method(COS.prototype, 'headObject', (args, cb) => cb({ statusCode: 404 }))
  mock.method(COS.prototype, 'sliceUploadFile', (args, cb) => {
    uploaded.set(args.Key, require('node:fs').readFileSync(args.FilePath, 'utf8')); cb(null, {})
  })
  mock.method(COS.prototype, 'putObject', (args, cb) => { published.push(JSON.parse(args.Body)); cb(null, {}) })
  await fs.writeFile(path.join(settings.materialsRoot, '旧名称.txt'), '原始内容')
  await fs.writeFile(path.join(settings.materialsRoot, '待删除.txt'), '待删除内容')
  await uploadMaterials(settings)
  const old = published[0].documents.find(d => d.title === '旧名称.txt')
  await fs.rename(path.join(settings.materialsRoot, '旧名称.txt'), path.join(settings.materialsRoot, '新名称.txt'))
  await fs.unlink(path.join(settings.materialsRoot, '待删除.txt'))
  await uploadMaterials(settings)
  assert.equal(published[1].documents.length, 1)
  const current = published[1].documents[0]
  assert.equal(current.title, '新名称.txt'); assert.equal(current.relativePath, '新名称.txt')
  assert.notEqual(current.id, old.id)
  assert.equal(current.version, old.version, 'Renaming must preserve the content version')
  assert.equal(uploaded.get('knowledge-agent/originals/' + current.original), '原始内容')
  const local = JSON.parse(await fs.readFile(path.join(settings.dataRoot, 'knowledge.json'), 'utf8'))
  assert.equal(local.documents[0].title, '新名称.txt')
  await fs.writeFile(path.join(settings.materialsRoot, '新名称.txt'), '更新后的内容')
  await uploadMaterials(settings)
  const edited = published[2].documents[0]
  assert.equal(edited.id, current.id); assert.notEqual(edited.version, current.version)
  assert.equal(uploaded.get('knowledge-agent/originals/' + edited.original), '更新后的内容')
})

test('missing credentials identify required variables without attempting COS calls', async t => {
  const settings = await fixture(t)
  await fs.writeFile(path.join(settings.materialsRoot, '材料.txt'), '资料内容')
  settings.cosSecretId = ''; settings.cosSecretKey = ''
  mock.method(COS.prototype, 'headObject', () => assert.fail('Must not access COS'))
  await assert.rejects(uploadMaterials(settings), /COS_SECRET_ID、COS_SECRET_KEY/)
})

test('missing source directory does not publish the stale snapshot or create an empty source', async t => {
  const settings = await fixture(t)
  settings.materialsRoot = path.join(settings.materialsRoot, '不存在')
  await assert.rejects(uploadMaterials(settings), { code: 'ENOENT' })
  await assert.rejects(fs.stat(settings.materialsRoot), { code: 'ENOENT' })
})
