'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createConfig } = require('../src/config')
test('cloud runtime reads model and COS environment variables directly', () => {
  const config = createConfig({ DEPLOYMENT_MODE: 'cloud', MODEL_API_URL: 'https://model.example/v1', MODEL_API_KEY: 'test-key', MODEL_NAME: 'test-model', COS_BUCKET: 'test-123', COS_REGION: 'ap-shanghai', COS_SECRET_ID: 'test-id', COS_SECRET_KEY: 'test-secret', ALLOWED_OPENIDS: 'member, colleague' })
  assert.equal(config.apiUrl, 'https://model.example/v1'); assert.equal(config.apiKey, 'test-key')
  assert.equal(config.model, 'test-model'); assert.equal(config.mode, 'api')
  assert.equal(config.cosBucket, 'test-123'); assert.equal(config.cosRegion, 'ap-shanghai')
  assert.equal(config.cosSecretId, 'test-id'); assert.equal(config.cosSecretKey, 'test-secret')
  assert.equal(config.host, '0.0.0.0'); assert.equal(config.port, 8080); assert.equal(config.storage, 'cos')
  assert.equal(Object.hasOwn(config, 'allowedOpenids'), false, 'Legacy ALLOWED_OPENIDS must not restrict users')
})
test('runtime model aliases override local file values and explicit mock is preserved', () => {
  const config = createConfig({ API_URL: 'https://cloud.example', API_KEY: 'cloud-key', MODEL: 'cloud-model', MODEL_MODE: 'mock' }, { MODEL_API_URL: 'https://local.example', MODEL_API_KEY: 'local-key', MODEL_NAME: 'local-model' })
  assert.equal(config.apiUrl, 'https://cloud.example'); assert.equal(config.apiKey, 'cloud-key')
  assert.equal(config.model, 'cloud-model'); assert.equal(config.mode, 'mock')
  assert.equal(createConfig({ MODEL_API_KEY: 'canonical', API_KEY: 'alias' }).apiKey, 'canonical')
  assert.equal(createConfig({ MODEL_API_KEY: '' }, { MODEL_API_KEY: 'local-key' }).apiKey, '')
})
test('local defaults work and unused template MySQL variables do not alter storage', () => {
  const config = createConfig({ MYSQL_ADDRESS: 'unused', MYSQL_USERNAME: 'unused', MYSQL_PASSWORD: 'unused' })
  assert.equal(config.storage, 'local'); assert.equal(config.port, 3000); assert.equal(config.mode, 'mock')
})
