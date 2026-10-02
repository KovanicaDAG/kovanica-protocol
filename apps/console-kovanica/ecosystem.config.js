module.exports = {
  apps: [
    {
      name: 'kovanica-console',
      script: 'npx',
      args: 'serve -s dist -l 3000',
      cwd: '/root/kovanica/mobile/console/kovanica',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/kovanica-console-error.log',
      out_file: '/var/log/kovanica-console-out.log',
      merge_logs: true
    }
  ]
};