import type { FastifyInstance } from "fastify";
import type { VideoMixerAdapter } from "../types.js";

export function registerStatusRoutes(app: FastifyInstance, mixer: VideoMixerAdapter): void {
  app.get("/health", async () => {
    const state = mixer.getState();
    return {
      status: "ok",
      service: "piswitch",
      connected: state.connected,
      backend: state.backend,
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/v1/status", async () => {
    const state = mixer.getState();
    return {
      service: "piswitch",
      version: "0.1.0",
      backend: state.backend,
      connected: state.connected,
      programInput: state.programInput,
      previewInput: state.previewInput,
      transition: state.transition,
      fadeToBlack: state.fadeToBlack,
      downstreamKeyers: state.downstreamKeyers,
      inputs: state.inputs ?? [],
      timestamp: new Date().toISOString(),
    };
  });
}
