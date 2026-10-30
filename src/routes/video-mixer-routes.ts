import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { VideoMixerAdapter } from "../types.js";
import { PiSoftwareAdapter } from "../adapters/pi-software-adapter.js";

export interface VideoMixerRouteOptions {
  maxInput?: number;
}

const DEFAULT_MAX_INPUT = 40;
const MAX_DSK = 4;
const MAX_STILL_BYTES = 64 * 1024 * 1024;

function parseInput(value: unknown, max: number): number | null {
  const input = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(input) || input < 1 || input > max) return null;
  return input;
}

function parseDsk(value: unknown): number | null {
  const dsk = Number(value);
  return Number.isInteger(dsk) && dsk >= 1 && dsk <= MAX_DSK ? dsk : null;
}

function notConnected(reply: FastifyReply, isAtemRoute: boolean): unknown {
  const code = isAtemRoute ? "ATEM_NOT_CONNECTED" : "MIXER_NOT_CONNECTED";
  const message = isAtemRoute ? "ATEM switcher is not connected" : "Video mixer is not connected";
  return reply.code(503).send({ error: { code, message } });
}

export function registerVideoMixerRoutes(
  app: FastifyInstance,
  mixer: VideoMixerAdapter,
  options: VideoMixerRouteOptions = {}
): void {
  const maxInput = options.maxInput ?? DEFAULT_MAX_INPUT;

  // Raw octet-stream for still image uploads
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: MAX_STILL_BYTES },
    (_req, body, done) => {
      done(null, body);
    }
  );

  // Both /api/v1/video-mixer and /api/v1/atem aliases
  const prefixes = ["/api/v1/video-mixer", "/api/v1/atem"] as const;

  for (const prefix of prefixes) {
    const isAtem = prefix.endsWith("/atem");

    // 1. GET state
    app.get(prefix, async () => mixer.getState());

    // 2. PUT program
    app.put<{ Body: { input?: unknown } }>(`${prefix}/program`, async (request, reply) => {
      const input = parseInput(request.body?.input, maxInput);
      if (input === null) {
        return reply.code(422).send({
          error: { code: "INVALID_INPUT", message: `Mixer input must be an integer between 1 and ${maxInput}` },
        });
      }
      if (!mixer.getState().connected) return notConnected(reply, isAtem);
      await mixer.setProgram(input);
      return reply.code(200).send(mixer.getState());
    });

    // 3. PUT preview
    app.put<{ Body: { input?: unknown } }>(`${prefix}/preview`, async (request, reply) => {
      const input = parseInput(request.body?.input, maxInput);
      if (input === null) {
        return reply.code(422).send({
          error: { code: "INVALID_INPUT", message: `Mixer input must be an integer between 1 and ${maxInput}` },
        });
      }
      if (!mixer.getState().connected) return notConnected(reply, isAtem);
      await mixer.setPreview(input);
      return reply.code(200).send(mixer.getState());
    });

    // 4. POST cut
    app.post(`${prefix}/cut`, async (_request, reply) => {
      if (!mixer.getState().connected) return notConnected(reply, isAtem);
      await mixer.cut();
      return reply.code(200).send(mixer.getState());
    });

    // 5. POST auto
    app.post(`${prefix}/auto`, async (_request, reply) => {
      if (!mixer.getState().connected) return notConnected(reply, isAtem);
      await mixer.autoTransition();
      return reply.code(200).send(mixer.getState());
    });

    // 6. POST ftb
    app.post(`${prefix}/ftb`, async (_request, reply) => {
      if (!mixer.getState().connected) return notConnected(reply, isAtem);
      await mixer.fadeToBlack();
      return reply.code(200).send(mixer.getState());
    });

    // 7. PUT DSK on-air
    app.put<{ Params: { dsk: string }; Body: { onAir?: unknown } }>(
      `${prefix}/dsk/:dsk/on-air`,
      async (request, reply) => {
        const dsk = parseDsk(request.params.dsk);
        if (dsk === null || typeof request.body?.onAir !== "boolean") {
          return reply.code(422).send({
            error: { code: "INVALID_REQUEST", message: `dsk must be 1-${MAX_DSK} and onAir must be a boolean` },
          });
        }
        if (!mixer.getState().connected) return notConnected(reply, isAtem);
        await mixer.setDownstreamKeyOnAir(dsk - 1, request.body.onAir);
        return reply.code(200).send(mixer.getState());
      }
    );

    // 8. PUT DSK tie
    app.put<{ Params: { dsk: string }; Body: { tie?: unknown } }>(
      `${prefix}/dsk/:dsk/tie`,
      async (request, reply) => {
        const dsk = parseDsk(request.params.dsk);
        if (dsk === null || typeof request.body?.tie !== "boolean") {
          return reply.code(422).send({
            error: { code: "INVALID_REQUEST", message: `dsk must be 1-${MAX_DSK} and tie must be a boolean` },
          });
        }
        if (!mixer.getState().connected) return notConnected(reply, isAtem);
        await mixer.setDownstreamKeyTie(dsk - 1, request.body.tie);
        return reply.code(200).send(mixer.getState());
      }
    );

    // 9. PUT still upload
    app.put<{ Params: { slot: string }; Querystring: { name?: string }; Body: Buffer }>(
      `${prefix}/media/stills/:slot`,
      { bodyLimit: MAX_STILL_BYTES },
      async (request, reply) => {
        const slot = Number(request.params.slot);
        if (
          !Number.isInteger(slot) ||
          slot < 1 ||
          slot > 64 ||
          !Buffer.isBuffer(request.body) ||
          request.body.length === 0
        ) {
          return reply.code(422).send({
            error: {
              code: "INVALID_REQUEST",
              message: "slot must be 1-64 and the body raw RGBA bytes (application/octet-stream)",
            },
          });
        }
        if (!mixer.getState().connected) return notConnected(reply, isAtem);
        if (mixer.uploadStill) {
          await mixer.uploadStill(slot - 1, request.body, request.query.name?.slice(0, 64) || "piswitch");
        }
        return reply.code(200).send({ slot, bytes: request.body.length });
      }
    );

    // 10. PUT DSK setup
    app.put<{
      Params: { dsk: string };
      Body: { mediaPlayer?: unknown; slot?: unknown; fillInput?: unknown; cutInput?: unknown };
    }>(`${prefix}/dsk/:dsk/setup`, async (request, reply) => {
      const dsk = parseDsk(request.params.dsk);
      const { mediaPlayer, slot, fillInput, cutInput } = request.body ?? {};
      const ok = (v: unknown, max: number): v is number =>
        typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
      if (dsk === null || !ok(mediaPlayer, 4) || !ok(slot, 64) || !ok(fillInput, 65535) || !ok(cutInput, 65535)) {
        return reply.code(422).send({
          error: {
            code: "INVALID_REQUEST",
            message: "dsk 1-4, mediaPlayer 1-4, slot 1-64, fillInput and cutInput positive integers",
          },
        });
      }
      if (!mixer.getState().connected) return notConnected(reply, isAtem);
      await mixer.setupDownstreamKey({
        dsk: dsk - 1,
        mediaPlayer: mediaPlayer - 1,
        stillIndex: slot - 1,
        fillInput,
        cutInput,
      });
      return reply.code(200).send(mixer.getState());
    });
  }

  // --- Dynamic Input & Phone Camera Endpoints (under /api/v1/video-mixer) ---
  app.get("/api/v1/video-mixer/inputs", async () => {
    return {
      inputs: mixer.getState().inputs ?? [],
    };
  });

  app.post<{ Body: { id?: unknown; name?: unknown; streamUrl?: unknown; deviceInfo?: unknown } }>(
    "/api/v1/video-mixer/inputs/phone",
    async (request, reply) => {
      const { id, name, streamUrl, deviceInfo } = request.body ?? {};
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId < 1 || typeof name !== "string" || !name.trim()) {
        return reply.code(422).send({
          error: { code: "INVALID_REQUEST", message: "id must be positive integer and name must be non-empty string" },
        });
      }

      if (mixer instanceof PiSoftwareAdapter) {
        const registered = mixer.registerPhoneCamera({
          id: numId,
          name: name.trim(),
          streamUrl: typeof streamUrl === "string" ? streamUrl : undefined,
          deviceInfo: typeof deviceInfo === "string" ? deviceInfo : undefined,
        });
        return reply.code(201).send({ ok: true, input: registered });
      }

      return reply.code(200).send({
        ok: true,
        input: { id: numId, name: name.trim(), kind: "phone", available: true },
      });
    }
  );

  app.delete<{ Params: { id: string } }>("/api/v1/video-mixer/inputs/phone/:id", async (request, reply) => {
    const numId = Number(request.params.id);
    if (!Number.isInteger(numId) || numId < 1) {
      return reply.code(422).send({
        error: { code: "INVALID_REQUEST", message: "id must be positive integer" },
      });
    }

    if (mixer instanceof PiSoftwareAdapter) {
      const removed = mixer.unregisterPhoneCamera(numId);
      return reply.code(200).send({ ok: true, removed });
    }

    return reply.code(200).send({ ok: true, removed: true });
  });
}
