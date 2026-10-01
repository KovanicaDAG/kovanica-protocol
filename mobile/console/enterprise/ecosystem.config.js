module.exports = {
  apps: [
    {
      name: 'kovanica-enterprise-console',
      script: 'npx',
      args: 'serve -s dist -l 3001',
      cwd: '/root/kovanica/mobile/console/enterprise',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/kovanica-enterprise-console-error.log',
      out_file: '/var/log/kovanica-enterprise-console-out.log',
      merge_logs: true
    }
  ]
};