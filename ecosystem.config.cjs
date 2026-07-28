const path = require("node:path");

const projectRoot = __dirname;

module.exports = {
  apps: [
    {
      name: "ossd-course-portal",
      cwd: projectRoot,
      script: path.join(projectRoot, "scripts", "start-production.mjs"),
      interpreter: "node",
      args: "--env .env.production --root dist --port 8891 --skip-check",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 5000,
      max_memory_restart: "768M",
      kill_timeout: 10000,
      out_file: path.join(projectRoot, "logs", "pm2-out.log"),
      error_file: path.join(projectRoot, "logs", "pm2-error.log"),
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
