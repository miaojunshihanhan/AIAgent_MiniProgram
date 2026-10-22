'use strict'

const { config } = require('../src/config')
const fs = require('node:fs/promises')
const path = require('node:path')

const sourceRoot = path.join(__dirname, '..', 'share-images')
const imageTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' }

async function listImages(directory, parent = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = path.join(parent, entry.name)
    if (entry.isDirectory()) files.push(...await listImages(path.join(directory, entry.name), relative))
    else if (entry.isFile() && imageTypes[path.extname(entry.name).toLowerCase()]) files.push(relative)
  }
  return files
}

function invoke(cos, method, params) {
  return new Promise((resolve, reject) => cos[method]({ Bucket: config.cosBucket, Region: config.cosRegion, ...params }, (error, result) => error ? reject(error) : resolve(result)))
}

async function uploadShareImages() {
  const missing = Object.entries({ COS_BUCKET: config.cosBucket, COS_REGION: config.cosRegion,
    COS_SECRET_ID: config.cosSecretId, COS_SECRET_KEY: config.cosSecretKey })
    .filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error('请在 backend/.env 或终端环境变量中填写：' + missing.join('、'))

  let files
  try { files = await listImages(sourceRoot) }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('分享图片目录不存在：' + sourceRoot)
    throw error
  }
  if (!files.length) throw new Error('请先将 JPG/PNG 图片放入 backend/share-images。')

  const COS = require('cos-nodejs-sdk-v5')
  const cos = new COS({ SecretId: config.cosSecretId, SecretKey: config.cosSecretKey, SecurityToken: config.cosToken || undefined })
  const prefix = (config.cosPrefix || 'knowledge-agent').replace(/^\/+|\/+$/g, '')
  const uploaded = []
  for (const relative of files) {
    const filename = path.join(sourceRoot, relative)
    const key = prefix + '/share/' + relative.split(path.sep).join('/')
    await invoke(cos, 'sliceUploadFile', {
      Key: key,
      FilePath: filename,
      ContentType: imageTypes[path.extname(filename).toLowerCase()],
      AsyncLimit: 2
    })
    uploaded.push({ file: relative, key })
    console.log('已上传：' + key)
  }

  console.log('\n请在 config/share.js 中将对应图片的 imageUrl 填为以下地址。')
  console.log('请为 COS 配置公开读或 CDN；分享卡片不能使用私有桶临时签名 URL。')
  const host = config.cosBucket + '.cos.' + config.cosRegion + '.myqcloud.com'
  for (const item of uploaded) console.log(item.file + '  https://' + host + '/' + item.key.split('/').map(encodeURIComponent).join('/'))
  return uploaded
}

if (require.main === module) {
  uploadShareImages().catch(error => {
    let message = String(error.message || error.code || '未知错误')
    for (const secret of [config.cosSecretId, config.cosSecretKey, config.cosToken]) {
      if (secret) message = message.split(secret).join('[已隐藏]')
    }
    console.error('分享图片上传失败：' + message)
    process.exitCode = 1
  })
}

module.exports = { uploadShareImages }
