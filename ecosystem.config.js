module.exports = {
  apps: [
    {
      name: 'apple-bot-ui',
      script: 'ui-server.js',
      cwd: __dirname,
      env: { UI_PORT: process.env.UI_PORT || 3310 },
      autorestart: true,
      max_restarts: 10,
      kill_timeout: 10000, // ให้เวลาบอต/เบราว์เซอร์ลูกปิดตัวก่อนโดน kill
      time: true,
    },
  ],
};
