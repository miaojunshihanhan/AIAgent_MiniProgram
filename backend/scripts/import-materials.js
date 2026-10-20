'use strict'
const { config } = require('../src/config')
const { importMaterials } = require('../src/knowledge')
// Import always builds the local snapshot, even when uploading to COS afterwards.
importMaterials({ ...config, storage: 'local' }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error('导入失败：', error.message); process.exitCode = 1 })
