'use strict'
const { config } = require('../src/config')
const { importMaterials } = require('../src/knowledge')
importMaterials(config).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error('导入失败：', error.message); process.exitCode = 1 })
