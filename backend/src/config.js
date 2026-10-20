'use strict'
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || process.env[match[1]] !== undefined) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[match[1]] = value
  }
}
const config = {
  deployment: process.env.DEPLOYMENT_MODE || 'local',
  allowedOpenids: (process.env.ALLOWED_OPENIDS || '').split(',').map(s => s.trim()).filter(Boolean),
  storage: process.env.STORAGE_MODE || 'local',
  cosBucket: process.env.COS_BUCKET || '', cosRegion: process.env.COS_REGION || '',
  cosPrefix: process.env.COS_PREFIX || 'knowledge-agent',
  cosSecretId: process.env.COS_SECRET_ID || '', cosSecretKey: process.env.COS_SECRET_KEY || '',
  cosToken: process.env.COS_SESSION_TOKEN || '',
  host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000),
  mode: process.env.MODEL_MODE || 'mock', apiUrl: process.env.MODEL_API_URL || '',
  apiKey: process.env.MODEL_API_KEY || '', model: process.env.MODEL_NAME || '',
  enableThinking: process.env.MODEL_ENABLE_THINKING === 'false' ? false : undefined,
  timeout: Number(process.env.MODEL_TIMEOUT_MS || 45000),
  materialsRoot: path.resolve(root, process.env.MATERIALS_ROOT || 'materials'),
  dataRoot: path.resolve(root, process.env.DATA_ROOT || 'data')
}
module.exports = { config }
