const fs = require('fs');
const path = require('path');

// Load environment variables from /opt/agent-bridge/.env
const envConfig = {};
const envPath = fs.existsSync('/opt/agent-bridge/.env') 
  ? '/opt/agent-bridge/.env' 
  : path.resolve(__dirname, '.env');

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      envConfig[key] = val;
    }
  });
}

module.exports = {
  apps: [
    {
      name: 'proxmox-codex-bridge',
      cwd: '/opt/agent-bridge/dashboard',
      script: 'build/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: 6379,
        ...envConfig
      },
      error_file: '/opt/agent-bridge/logs/pm2-error.log',
      out_file: '/opt/agent-bridge/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};
