import type { FastifyInstance } from "fastify";
import type { RoutingStore } from "../routing/routing-store.js";

export function registerRoutingRoutes(app: FastifyInstance, store: RoutingStore): void {
  app.get("/api/v1/video-mixer/routing", async () => {
    return {
      config: store.getConfig(),
      activeBusOnAir: store.getActiveBusOnAir(),
      dynamicInputs: store.listDynamicInputs(),
    };
  });

  app.put<{ Body: { config?: unknown; reservations?: unknown } }>(
    "/api/v1/video-mixer/routing",
    async (request, reply) => {
      const { config, reservations } = request.body ?? {};

      if (config && typeof config === "object") {
        store.updateConfig(config as any);
      }

      if (reservations && typeof reservations === "object") {
        const resObj = reservations as Record<string, unknown>;
        if ("pi1" in resObj) {
          store.setBusReservation("pi1", typeof resObj.pi1 === "string" ? resObj.pi1 : null);
        }
        if ("pi2" in resObj) {
          store.setBusReservation("pi2", typeof resObj.pi2 === "string" ? resObj.pi2 : null);
        }
      }

      return reply.code(200).send({
        ok: true,
        config: store.getConfig(),
        activeBusOnAir: store.getActiveBusOnAir(),
      });
    }
  );
}
