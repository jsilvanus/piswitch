import type { FastifyInstance } from "fastify";
import type { SwitchEventBroker } from "../events.js";
import type { VideoMixerAdapter } from "../types.js";

export function registerEventsRoutes(
  app: FastifyInstance,
  broker: SwitchEventBroker,
  mixer: VideoMixerAdapter
): void {
  const handler = async (request: any, reply: any) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const sendEvent = (type: string, data: unknown) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Emit initial status
    sendEvent("ready", { status: "connected", time: new Date().toISOString() });
    sendEvent("video-mixer", mixer.getState());
    sendEvent("atem", mixer.getState());

    const unsubscribe = broker.subscribe((event) => {
      sendEvent(event.type, event.data);
    });

    request.raw.on("close", () => {
      unsubscribe();
    });
  };

  app.get("/api/v1/events", handler);
  app.get("/api/v1/video-mixer/events", handler);
}
