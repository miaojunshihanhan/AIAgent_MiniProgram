'use strict'
const fs = require('node:fs')
const path = require('node:path')
const clients = new WeakMap(), indexes = new WeakMap()
function client(config) {
  if (clients.has(config)) return clients.get(config)
  if (!config.cosBucket || !config.cosRegion || !config.cosSecretId || !config.cosSecretKey) {
    throw Object.assign(new Error('请在服务环境变量配置 COS_BUCKET、COS_REGION、COS_SECRET_ID、COS_SECRET_KEY。'), { status: 503 })
  }
  const COS = require('cos-nodejs-sdk-v5')
  const instance = new COS({ SecretId: config.cosSecretId, SecretKey: config.cosSecretKey, SecurityToken: config.cosToken || undefined, Timeout: 20000 })
  clients.set(config, instance); return instance
}
function key(config, relative) { return (config.cosPrefix || 'knowledge-agent').replace(/^\/+|\/+$/g, '') + '/' + relative }
function invoke(config, method, params) {
  return new Promise((resolve, reject) => client(config)[method]({ Bucket: config.cosBucket, Region: config.cosRegion, ...params }, (error, result) => error ? reject(error) : resolve(result)))
}
async function loadCloudIndex(config) {
  client(config)
  let entry = indexes.get(config)
  if (entry && entry.value && Date.now() < entry.expires) return entry.value
  if (entry && entry.pending) return entry.pending
  entry = { pending: null }; indexes.set(config, entry)
  entry.pending = invoke(config, 'getObject', { Key: key(config, 'knowledge.json') }).then(result => {
    const value = JSON.parse(Buffer.isBuffer(result.Body) ? result.Body.toString('utf8') : result.Body)
    if (!Array.isArray(value.documents)) throw new Error('COS 资料索引格式错误。')
    entry.value = value; entry.expires = Date.now() + 60000; return value
  }).catch(() => { indexes.delete(config); throw Object.assign(new Error('读取云端资料失败，请检查 COS 配置和权限，并先执行 npm run upload:cos。'), { status: 503 }) })
    .finally(() => { entry.pending = null })
  return entry.pending
}
async function signedAsset(config, relative) {
  const Key = key(config, relative)
  try { await invoke(config, 'headObject', { Key }) }
  catch (error) {
    if (error.statusCode === 404) throw Object.assign(new Error('原文件或页图不存在，请重新上传资料。'), { status: 404 })
    throw Object.assign(new Error('读取对象存储失败，请检查服务的 COS 权限。'), { status: 503 })
  }
  const url = client(config).getObjectUrl({ Bucket: config.cosBucket, Region: config.cosRegion, Key, Sign: true, Expires: 600, Protocol: 'https:' })
  return { url, expiresIn: 600 }
}
async function uploadSnapshot(config) {
  const index = JSON.parse(await fs.promises.readFile(path.join(config.dataRoot, 'knowledge.json'), 'utf8'))
  if (!Array.isArray(index.documents) || !index.documents.length) throw new Error('资料索引为空，请先 npm run import。')
  let uploaded = 0
  async function upload(relative) {
    const filename = path.join(config.dataRoot, ...relative.split('/'))
    const stat = await fs.promises.stat(filename)
    if (relative !== 'knowledge.json') {
      try { const head = await invoke(config, 'headObject', { Key: key(config, relative) }); if (Number(head.headers['content-length']) === stat.size) return }
      catch (error) { if (error.statusCode !== 404) throw error }
    }
    const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.json': 'application/json; charset=utf-8' }
    await new Promise((resolve, reject) => client(config).sliceUploadFile({ Bucket: config.cosBucket, Region: config.cosRegion, Key: key(config, relative), FilePath: filename, ContentType: types[path.extname(filename).toLowerCase()] || 'application/octet-stream', AsyncLimit: 2 }, error => error ? reject(error) : resolve()))
    uploaded++; console.log('已上传：' + relative)
  }
  for (const doc of index.documents) {
    if (!/^[a-f0-9]{24}$/.test(doc.id) || !/^[a-f0-9]{64}$/.test(doc.version)) throw new Error('非法文档版本。')
    if (!doc.original || path.basename(doc.original) !== doc.original || /[\\/]/.test(doc.original)) throw new Error('非法原件路径。')
    await upload('originals/' + doc.original)
    for (const page of doc.pages || []) {
      if (!Number.isInteger(page.number) || page.number < 1) throw new Error('非法页码。')
      page.hasImage = false
      const relative = 'previews/' + doc.id + '/' + doc.version + '/' + page.number + '.png'
      try { await fs.promises.access(path.join(config.dataRoot, ...relative.split('/'))) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      await upload(relative)
      page.hasImage = true
    }
  }
  // Publish the index only after all referenced assets are available.
  await invoke(config, 'putObject', { Key: key(config, 'knowledge.json'), Body: JSON.stringify(index), ContentType: 'application/json; charset=utf-8' })
  uploaded++
  return { documentCount: index.documents.length, uploaded, prefix: key(config, '') }
}
async function saveChatJob(config,job){
  await invoke(config,'putObject',{Key:key(config,'chat-jobs/'+job.id+'.json'),Body:JSON.stringify(job),ContentType:'application/json; charset=utf-8'})
}
async function loadChatJob(config,id){
  try{
    const result=await invoke(config,'getObject',{Key:key(config,'chat-jobs/'+id+'.json')})
    return JSON.parse(Buffer.isBuffer(result.Body)?result.Body.toString('utf8'):result.Body)
  }catch(error){if(error.statusCode===404)return null;throw error}
}
module.exports = { loadCloudIndex, signedAsset, uploadSnapshot, saveChatJob, loadChatJob }
