'use strict'
const { config } = require('../src/config')
const { uploadSnapshot } = require('../src/storage')
uploadSnapshot(config).then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(() => { console.error('上传失败。请检查 COS 环境变量、桶权限、网络和 backend/data/knowledge.json。索引仅在文件上传完成后发布。'); process.exitCode = 1 })
