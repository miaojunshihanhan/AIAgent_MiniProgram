// app.js
App({
  onLaunch() {
    const config = require('./config/api')
    if (config.mode === 'container' && wx.cloud) wx.cloud.init({ env: config.env })
  }
})
