'use strict'
const { config } = require('../src/config')
const fs = require('node:fs/promises')
const { importMaterials } = require('../src/knowledge')
const { uploadSnapshot } = require('../src/storage')

async function uploadMaterials(settings = config) {
  // Resolve materialsRoot through config, independently of the shell's directory.
  const source = await fs.stat(settings.materialsRoot)
  if (!source.isDirectory()) throw new Error('资料路径不是文件夹：' + settings.materialsRoot)
  console.log('资料目录：' + settings.materialsRoot)
  console.log('正在同步材料名称和内容……')
  // Never read the remote index while building this machine's snapshot.
  const report = await importMaterials({ ...settings, storage: 'local' })
  console.log(JSON.stringify(report, null, 2))
  if (!report.documentCount) throw new Error('资料目录中没有可上传的材料，请检查上面的导入报告。')
  const missing = Object.entries({ COS_BUCKET: settings.cosBucket, COS_REGION: settings.cosRegion,
    COS_SECRET_ID: settings.cosSecretId, COS_SECRET_KEY: settings.cosSecretKey })
    .filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error('请在 backend/.env 或当前终端环境变量中填写：' + missing.join('、'))
  console.log('本地索引已更新，开始上传 COS……')
  return uploadSnapshot(settings)
}

if (require.main === module) {
  uploadMaterials().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      let message = String(error.message || error.code || '未知错误')
      for (const secret of [config.cosSecretId, config.cosSecretKey, config.cosToken]) {
        if (secret) message = message.split(secret).join('[已隐藏]')
      }
      console.error('上传失败：' + message)
      if (error.statusCode) console.error('HTTP 状态：' + error.statusCode)
      console.error('索引仅在文件上传完成后发布。')
      process.exitCode = 1
    })
}

module.exports = { uploadMaterials }
