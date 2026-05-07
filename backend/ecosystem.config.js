module.exports = {
  apps: [
    {
      name: "restaurant-chatbot",
      script: "./src/index.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      max_memory_restart: "500M",
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
