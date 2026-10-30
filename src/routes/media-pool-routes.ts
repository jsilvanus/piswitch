import type { FastifyInstance } from "fastify";
import type { MediaPoolManager } from "../media-pool/media-pool-manager.js";
import type { VideoMixerAdapter, MediaPoolKind } from "../types.js";

const MAX_STILL_BYTES = 64 * 1024 * 1024;

export function registerMediaPoolRoutes(
  app: FastifyInstance,
  mediaPool: MediaPoolManager,
  mixer: VideoMixerAdapter
): void {
  const prefixes = ["/api/v1/video-mixer", "/api/v1/atem"];

  for (const prefix of prefixes) {
    // 1. GET media-pool summary
    app.get(`${prefix}/media-pool`, async () => {
      const state = mixer.getState();
      return {
        connected: state.connected,
        config: mediaPool.getConfig(),
        slideBuffer: mediaPool.getSlideBufferState(),
        mediaPlayers: mediaPool.getMediaPlayers(),
      };
    });

    // 2. GET media-pool slots
    app.get<{ Querystring: { pool?: string } }>(
      `${prefix}/media-pool/slots`,
      async (request) => {
        const pool = request.query.pool as MediaPoolKind | undefined;
        return {
          slots: mediaPool.getSlots(pool),
        };
      }
    );

    // 3. GET specific slot
    app.get<{ Params: { slot: string } }>(
      `${prefix}/media-pool/slots/:slot`,
      async (request, reply) => {
        const slot = Number(request.params.slot);
        if (!Number.isInteger(slot) || slot < 1) {
          return reply.code(422).send({
            error: { code: "INVALID_SLOT", message: "Slot must be a positive integer" },
          });
        }

        const data = mediaPool.getSlot(slot);
        if (!data) {
          return reply.code(404).send({
            error: { code: "SLOT_NOT_FOUND", message: `Slot ${slot} not found` },
          });
        }
        return data;
      }
    );

    // 4. PUT upload still to slot (octet-stream)
    app.put<{
      Params: { slot: string };
      Querystring: { name?: string; pool?: string };
      Body: Buffer;
    }>(
      `${prefix}/media-pool/slots/:slot`,
      { bodyLimit: MAX_STILL_BYTES },
      async (request, reply) => {
        const slot = Number(request.params.slot);
        if (!Number.isInteger(slot) || slot < 1) {
          return reply.code(422).send({
            error: { code: "INVALID_SLOT", message: "Slot must be a positive integer" },
          });
        }

        if (!request.body || request.body.length === 0) {
          return reply.code(422).send({
            error: { code: "EMPTY_BODY", message: "Still image data is required" },
          });
        }

        const state = mixer.getState();
        if (!state.connected && mixer.backend === "atem") {
          return reply.code(503).send({
            error: { code: "NOT_CONNECTED", message: "Video mixer hardware is not connected" },
          });
        }

        try {
          const name = request.query.name?.slice(0, 64);
          const pool = request.query.pool as MediaPoolKind | undefined;
          const result = await mediaPool.uploadStill(slot, request.body, name, pool);
          return reply.code(200).send({
            slot: result.slot,
            name: result.name,
            pool: result.pool,
            bytes: request.body.length,
          });
        } catch (err) {
          return reply.code(500).send({
            error: { code: "UPLOAD_FAILED", message: (err as Error).message },
          });
        }
      }
    );

    // 5. DELETE clear still in slot
    app.delete<{ Params: { slot: string } }>(
      `${prefix}/media-pool/slots/:slot`,
      async (request, reply) => {
        const slot = Number(request.params.slot);
        if (!Number.isInteger(slot) || slot < 1) {
          return reply.code(422).send({
            error: { code: "INVALID_SLOT", message: "Slot must be a positive integer" },
          });
        }

        try {
          const result = await mediaPool.clearSlot(slot);
          return reply.code(200).send({ slot: result.slot, cleared: true });
        } catch (err) {
          return reply.code(500).send({
            error: { code: "CLEAR_FAILED", message: (err as Error).message },
          });
        }
      }
    );

    // 6. GET media players
    app.get(`${prefix}/media-players`, async () => {
      return {
        players: mediaPool.getMediaPlayers(),
      };
    });

    // 7. PUT media player source (point player to slot)
    app.put<{
      Params: { player: string };
      Body: { slot?: unknown };
    }>(
      `${prefix}/media-players/:player/source`,
      async (request, reply) => {
        const player = Number(request.params.player);
        const slot = Number(request.body?.slot);

        if (!Number.isInteger(player) || player < 1 || player > 4) {
          return reply.code(422).send({
            error: { code: "INVALID_PLAYER", message: "Player must be an integer between 1 and 4" },
          });
        }

        if (!Number.isInteger(slot) || slot < 1) {
          return reply.code(422).send({
            error: { code: "INVALID_SLOT", message: "Slot must be a positive integer" },
          });
        }

        try {
          await mediaPool.setMediaPlayerSource(player, slot);
          return reply.code(200).send({
            player,
            stillSlot: slot,
          });
        } catch (err) {
          return reply.code(500).send({
            error: { code: "PLAYER_SOURCE_FAILED", message: (err as Error).message },
          });
        }
      }
    );

    // 8. POST advance circular slide buffer
    app.post<{ Body?: { slot?: unknown } }>(
      `${prefix}/media-pool/slides/advance`,
      async (request, reply) => {
        const targetSlot = request.body?.slot !== undefined ? Number(request.body.slot) : undefined;
        if (targetSlot !== undefined && (!Number.isInteger(targetSlot) || targetSlot < 1)) {
          return reply.code(422).send({
            error: { code: "INVALID_SLOT", message: "Target slot must be a positive integer" },
          });
        }

        try {
          const res = await mediaPool.advanceSlide(targetSlot);
          return reply.code(200).send(res);
        } catch (err) {
          return reply.code(422).send({
            error: { code: "ADVANCE_FAILED", message: (err as Error).message },
          });
        }
      }
    );

    // 9. GET slide buffer status
    app.get(`${prefix}/media-pool/slides/status`, async () => {
      return mediaPool.getSlideBufferState();
    });
  }
}
