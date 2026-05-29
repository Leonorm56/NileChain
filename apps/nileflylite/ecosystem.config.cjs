module.exports = {
  apps: [{
    name: "nileflylite",
    script: "server.js",
    cwd: __dirname,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    error_file: "err.log",
    out_file: "out.log",
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    env: {
      NODE_ENV: "production"
    }
  }]
};
