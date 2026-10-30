import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const { app, mixer } = buildApp(config);

  if (config.backend === "atem" && config.atemHost) {
    app.log.info({ host: config.atemHost, port: config.atemPort }, "Connecting to ATEM switcher");
    mixer.connect?.(config.atemHost, config.atemPort).catch((err) => {
      app.log.warn({ err }, "Initial ATEM connection failed; will retry in background");
    });
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "Shutting down piswitch");
    await mixer.disconnect?.();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ port: config.port, host: config.host, backend: config.backend }, "piswitch listening");
  } catch (err) {
    app.log.error(err, "Failed to start piswitch");
    process.exit(1);
  }
}

void start();
