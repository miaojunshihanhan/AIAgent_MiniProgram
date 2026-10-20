'use strict'
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const envFile = path.join(root, '.env')
const localEnv = {}
// Production uses only the container's environment; local .env is a fallback.
if (process.env.DEPLOYMENT_MODE !== 'cloud' && process.env.NODE_ENV !== 'production' && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    let value = match[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    localEnv[match[1]] = value
  }
}
function createConfig(env, fallback = {}) {
  // All runtime aliases take precedence over any local-file spelling.
  const value = (...names) => {
    for (const source of [env, fallback]) for (const name of names) {
      if (source[name] !== undefined) return String(source[name]).trim()
    }
    return ''
  }
  const deployment = value('DEPLOYMENT_MODE') || 'local'
  const cloud = deployment === 'cloud'
  const apiKey = value('MODEL_API_KEY', 'API_KEY')
  return {
    deployment,
    storage: value('STORAGE_MODE') || (cloud ? 'cos' : 'local'),
    cosBucket: value('COS_BUCKET'), cosRegion: value('COS_REGION'),
    cosPrefix: value('COS_PREFIX') || 'knowledge-agent',
    cosSecretId: value('COS_SECRET_ID'), cosSecretKey: value('COS_SECRET_KEY'),
    cosToken: value('COS_SESSION_TOKEN'),
    host: value('HOST') || (cloud ? '0.0.0.0' : '127.0.0.1'),
    port: Number(value('PORT') || (cloud ? 8080 : 3000)),
    mode: value('MODEL_MODE') || (apiKey ? 'api' : 'mock'),
    apiUrl: value('MODEL_API_URL', 'API_URL'), apiKey,
    model: value('MODEL_NAME', 'MODEL'),
    enableThinking: value('MODEL_ENABLE_THINKING') === 'false' ? false : undefined,
    timeout: Number(value('MODEL_TIMEOUT_MS') || 90000),
    materialsRoot: path.resolve(root, value('MATERIALS_ROOT') || 'materials'),
    dataRoot: path.resolve(root, value('DATA_ROOT') || 'data')
  }
}
const config = createConfig(process.env, localEnv)
module.exports = { config, createConfig }
