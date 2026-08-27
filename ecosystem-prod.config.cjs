module.exports = {
  apps: [
    {
      name: 'veiledhood-prod',
      script: 'api/dist/src/index.js',
      cwd: '/var/www/veiledhood-prod',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};