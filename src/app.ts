import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { SwitchEventBroker } from "./events.js";
import type { VideoMixerAdapter } from "./types.js";
import { AtemAdapter } from "./adapters/atem-adapter.js";
import { PiSoftwareAdapter } from "./adapters/pi-software-adapter.js";
import { MockAdapter } from "./adapters/mock-adapter.js";
import { RoutingStore } from "./routing/routing-store.js";
import { registerStatusRoutes } from "./routes/status-routes.js";
import { registerEventsRoutes } from "./routes/events-routes.js";
import { registerVideoMixerRoutes } from "./routes/video-mixer-routes.js";
import { registerRoutingRoutes } from "./routes/routing-routes.js";

export interface BuildAppResult {
  app: FastifyInstance;
  mixer: VideoMixerAdapter;
  eventBroker: SwitchEventBroker;
  routingStore: RoutingStore;
}

export function buildApp(config: AppConfig, customMixer?: VideoMixerAdapter, customRoutingStore?: RoutingStore): BuildAppResult {
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  const eventBroker = new SwitchEventBroker();
  const routingStore =
    customRoutingStore ??
    new RoutingStore({
      atemDynamicInput: config.atemDynamicInput,
      atlonaAtemOutput: config.atlonaAtemOutput,
    });

  let mixer: VideoMixerAdapter;
  if (customMixer) {
    mixer = customMixer;
  } else if (config.backend === "atem") {
    mixer = new AtemAdapter({ logger: app.log });
  } else if (config.backend === "mock") {
    mixer = new MockAdapter();
  } else {
    mixer = new PiSoftwareAdapter();
  }

  // Forward mixer state changes to SSE broker
  mixer.onStateChange((state) => {
    eventBroker.emit({ type: "video-mixer", data: state });
    eventBroker.emit({ type: "atem", data: state });
  });

  // Auth Hook (protect non-GET routes if apiKey configured)
  if (config.apiKey) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.method === "GET" || request.method === "OPTIONS" || request.method === "HEAD") {
        return;
      }
      if (request.url === "/health") return;

      const ip = request.ip || "";
      if (config.allowedHosts.includes(ip)) {
        return;
      }

      const keyHeader = request.headers["x-api-key"];
      const authHeader = request.headers.authorization;
      const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

      if (keyHeader === config.apiKey || bearer === config.apiKey) {
        return;
      }

      return reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "Missing or invalid API key" },
      });
    });
  }

  // Register routes
  registerStatusRoutes(app, mixer);
  registerEventsRoutes(app, eventBroker, mixer);
  registerVideoMixerRoutes(app, mixer);
  registerRoutingRoutes(app, routingStore);

  return { app, mixer, eventBroker, routingStore };
}
