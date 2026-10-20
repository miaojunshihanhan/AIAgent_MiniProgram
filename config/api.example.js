// Copy to api.js. Never put model or COS secrets in mini program files.
module.exports = { mode: 'container', env: 'YOUR-CLOUD-ENV-ID', service: 'YOUR-SERVICE-NAME', timeout: 60000 }
// Local debugging: { mode: 'local', baseUrl: 'http://127.0.0.1:3000', timeout: 60000 }
