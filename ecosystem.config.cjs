/** PM2 进程配置：在 server 目录执行 pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'zuqiu-api',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
