import { Atem } from "atem-connection";
import type {
  DownstreamKeySetup,
  MediaPlayerInfo,
  VideoMixerAdapter,
  VideoMixerDownstreamKeyerState,
  VideoMixerFadeToBlackState,
  VideoMixerState,
  VideoMixerStateListener,
  VideoMixerTransitionState,
} from "../types.js";

export const DEFAULT_ATEM_PORT = 9910;
export const ATEM_CONNECT_WARN_MS = 5000;
export const ATEM_RECONNECT_MIN_MS = 1000;
export const ATEM_RECONNECT_MAX_MS = 30000;

export interface AtemLogger {
  warn(obj: object, msg: string): void;
  info?(obj: object, msg: string): void;
}

export interface AtemClient {
  connect(address: string, port?: number): Promise<void>;
  disconnect(): Promise<void>;
  changeProgramInput(input: number, me?: number): Promise<void>;
  changePreviewInput(input: number, me?: number): Promise<void>;
  cut(me?: number): Promise<void>;
  autoTransition?(me?: number): Promise<void>;
  fadeToBlack?(me?: number): Promise<void>;
  setDownstreamKeyTie?(tie: boolean, key?: number): Promise<void>;
  readonly state: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  uploadStill?(index: number, data: Buffer, name: string, description: string): Promise<unknown>;
  clearMediaPoolStill?(stillId: number): Promise<void>;
  setMediaPlayerSource?(props: { sourceType: number; stillIndex: number }, player?: number): Promise<void>;
  setDownstreamKeyFillSource?(input: number, key?: number): Promise<void>;
  setDownstreamKeyCutSource?(input: number, key?: number): Promise<void>;
  setDownstreamKeyOnAir?(onAir: boolean, key?: number): Promise<void>;
}

export interface AtemAdapterOptions {
  meIndex?: number;
  createClient?: () => AtemClient;
  logger?: AtemLogger | undefined;
  connectWarnMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

const IDLE_TRANSITION: VideoMixerTransitionState = { inTransition: false, remainingFrames: 0 };
const IDLE_FTB: VideoMixerFadeToBlackState = { fullyBlack: false, inTransition: false, remainingFrames: 0 };

function assertInput(input: number, name: string): void {
  if (!Number.isInteger(input) || input < 1) {
    throw new RangeError(`${name} must be a positive integer input number`);
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class AtemAdapter implements VideoMixerAdapter {
  readonly backend = "atem" as const;

  private readonly meIndex: number;
  private readonly createClient: () => AtemClient;
  private client: AtemClient | null = null;
  private connected = false;
  private listeners = new Set<VideoMixerStateListener>();
  private readonly logger: AtemLogger | undefined;
  private readonly connectWarnMs: number;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;
  private target: { host: string; port: number } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs: number;

  constructor(options: AtemAdapterOptions = {}) {
    this.meIndex = options.meIndex ?? 0;
    this.createClient = options.createClient ?? (() => new Atem() as unknown as AtemClient);
    this.logger = options.logger;
    this.connectWarnMs = options.connectWarnMs ?? ATEM_CONNECT_WARN_MS;
    this.reconnectMinMs = options.reconnectMinMs ?? ATEM_RECONNECT_MIN_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? ATEM_RECONNECT_MAX_MS;
    this.reconnectDelayMs = this.reconnectMinMs;
  }

  async connect(host?: string, port: number = DEFAULT_ATEM_PORT): Promise<void> {
    const target = host?.trim();
    if (!target) return;
    this.clearReconnectTimer();
    this.target = { host: target, port };
    this.reconnectDelayMs = this.reconnectMinMs;
    await this.open();
  }

  private async open(): Promise<void> {
    if (!this.target) return;
    const { host: target, port } = this.target;
    if (this.client) {
      const previous = this.client;
      this.client = null;
      this.connected = false;
      try {
        await previous.disconnect();
      } catch {}
    }

    const client = this.createClient();
    this.client = client;
    const warnTimer = setTimeout(() => {
      if (this.client === client && !this.connected) {
        this.logger?.warn(
          { host: target, port },
          `ATEM not connected after ${this.connectWarnMs} ms; check PISWITCH_ATEM_HOST and PISWITCH_ATEM_PORT (default port is 9910)`
        );
      }
    }, this.connectWarnMs);
    warnTimer.unref();

    client.on("connected", () => {
      if (this.client !== client) return;
      clearTimeout(warnTimer);
      this.connected = true;
      this.reconnectDelayMs = this.reconnectMinMs;
      this.logger?.info?.({ host: target, port }, "ATEM connected");
      this.emit();
    });

    client.on("disconnected", () => {
      if (this.client !== client) return;
      clearTimeout(warnTimer);
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.logger?.warn({ host: target, port }, "ATEM disconnected");
      this.emit();
      this.scheduleReconnect();
    });

    client.on("stateChanged", () => {
      if (this.client === client && this.connected) this.emit();
    });

    client.on("error", (error: unknown) => {
      if (this.client !== client) return;
      this.logger?.warn({ host: target, port, err: error }, "ATEM connection error");
    });

    try {
      await client.connect(target, port);
    } catch (error) {
      clearTimeout(warnTimer);
      this.logger?.warn({ host: target, port, err: error }, "ATEM connection failed");
      if (this.client === client) this.scheduleReconnect();
      throw error;
    }
  }

  private scheduleReconnect(): void {
    if (!this.target || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectMaxMs, this.reconnectDelayMs * 2);
    this.logger?.info?.({ host: this.target.host, port: this.target.port, delayMs: delay }, "ATEM reconnect scheduled");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.target) return;
      this.open().catch(() => undefined);
    }, delay);
    this.reconnectTimer.unref();
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async disconnect(): Promise<void> {
    this.target = null;
    this.clearReconnectTimer();
    this.reconnectDelayMs = this.reconnectMinMs;
    const client = this.client;
    this.client = null;
    const wasConnected = this.connected;
    this.connected = false;
    if (client) {
      try {
        await client.disconnect();
      } catch {}
    }
    if (wasConnected) this.emit();
  }

  getState(): VideoMixerState {
    if (!this.client || !this.connected) {
      return {
        connected: false,
        backend: this.backend,
        programInput: null,
        previewInput: null,
        transition: { ...IDLE_TRANSITION },
        fadeToBlack: { ...IDLE_FTB },
        downstreamKeyers: [],
      };
    }
    const me = readMixEffect(this.client.state, this.meIndex);
    return {
      connected: true,
      backend: this.backend,
      programInput: me?.programInput ?? null,
      previewInput: me?.previewInput ?? null,
      transition: me?.transition ?? { ...IDLE_TRANSITION },
      fadeToBlack: me?.fadeToBlack ?? { ...IDLE_FTB },
      downstreamKeyers: readDownstreamKeyers(this.client.state),
    };
  }

  onStateChange(listener: VideoMixerStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async setProgram(input: number): Promise<void> {
    assertInput(input, "input");
    const client = this.client;
    if (!client) return;
    this.requireConnected();
    await client.changeProgramInput(input, this.meIndex);
  }

  async setPreview(input: number): Promise<void> {
    assertInput(input, "input");
    const client = this.client;
    if (!client) return;
    this.requireConnected();
    await client.changePreviewInput(input, this.meIndex);
  }

  async cut(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.requireConnected();
    await client.cut(this.meIndex);
  }

  async autoTransition(): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.autoTransition) throw new Error("ATEM client does not support auto transitions");
    await client.autoTransition(this.meIndex);
  }

  async fadeToBlack(): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.fadeToBlack) throw new Error("ATEM client does not support fade to black");
    await client.fadeToBlack(this.meIndex);
  }

  async setDownstreamKeyTie(dskIndex: number, tie: boolean): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.setDownstreamKeyTie) throw new Error("ATEM client does not support keyer control");
    await client.setDownstreamKeyTie(tie, dskIndex);
  }

  async setDownstreamKeyOnAir(dskIndex: number, onAir: boolean): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.setDownstreamKeyOnAir) throw new Error("ATEM client does not support keyer control");
    await client.setDownstreamKeyOnAir(onAir, dskIndex);
  }

  async uploadStill(stillIndex: number, rgba: Buffer, name: string): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.uploadStill) throw new Error("ATEM client does not support media pool uploads");
    await client.uploadStill(stillIndex, rgba, name, "piswitch slide");
  }

  async setupDownstreamKey(setup: DownstreamKeySetup): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.setMediaPlayerSource || !client.setDownstreamKeyFillSource || !client.setDownstreamKeyCutSource) {
      throw new Error("ATEM client does not support keyer control");
    }
    await client.setMediaPlayerSource({ sourceType: 1, stillIndex: setup.stillIndex }, setup.mediaPlayer);
    await client.setDownstreamKeyFillSource(setup.fillInput, setup.dsk);
    await client.setDownstreamKeyCutSource(setup.cutInput, setup.dsk);
  }

  async clearStill(stillIndex: number): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.clearMediaPoolStill) throw new Error("ATEM client does not support clearing stills");
    await client.clearMediaPoolStill(stillIndex);
  }

  async setMediaPlayerSource(player: number, stillIndex: number): Promise<void> {
    this.requireConnected();
    const client = this.requireClient();
    if (!client.setMediaPlayerSource) throw new Error("ATEM client does not support media player source control");
    await client.setMediaPlayerSource({ sourceType: 1, stillIndex }, player);
  }

  getMediaPlayers(): MediaPlayerInfo[] {
    const rawState = this.client?.state as { media?: { players?: Array<{ playing?: boolean; loop?: boolean; stillIndex?: number; clipIndex?: number; sourceType?: number }> } } | undefined;
    const players = rawState?.media?.players;
    if (!Array.isArray(players) || players.length === 0) {
      return [
        { player: 1, playing: false, loop: false, sourceType: "still", stillSlot: 1 },
        { player: 2, playing: false, loop: false, sourceType: "still", stillSlot: null },
      ];
    }
    return players.map((p, idx) => ({
      player: idx + 1,
      playing: Boolean(p?.playing),
      loop: Boolean(p?.loop),
      sourceType: p?.sourceType === 2 ? "clip" : "still",
      stillSlot: p?.stillIndex != null ? p.stillIndex + 1 : null,
    }));
  }

  private requireClient(): AtemClient {
    if (!this.client) throw new Error("ATEM is not connected");
    return this.client;
  }

  private requireConnected(): void {
    if (!this.connected) throw new Error("ATEM is not connected");
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

interface MixEffectReading {
  programInput: number | null;
  previewInput: number | null;
  transition: VideoMixerTransitionState;
  fadeToBlack: VideoMixerFadeToBlackState;
}

function readDownstreamKeyers(state: unknown): VideoMixerDownstreamKeyerState[] {
  const keyers = (state as { video?: { downstreamKeyers?: unknown } } | undefined)?.video?.downstreamKeyers;
  if (!Array.isArray(keyers)) return [];
  const result: VideoMixerDownstreamKeyerState[] = [];
  keyers.forEach((raw, index) => {
    const k = raw as { onAir?: unknown; inTransition?: unknown; properties?: { tie?: unknown } } | undefined;
    if (!k) return;
    result.push({
      dsk: index + 1,
      onAir: k.onAir === true,
      tie: k.properties?.tie === true,
      inTransition: k.inTransition === true,
    });
  });
  return result;
}

function readMixEffect(state: unknown, meIndex: number): MixEffectReading | null {
  const video = (state as { video?: { mixEffects?: unknown } } | undefined)?.video;
  const mixEffects = video?.mixEffects;
  if (!Array.isArray(mixEffects)) return null;
  const me = mixEffects[meIndex] as
    | {
        programInput?: unknown;
        previewInput?: unknown;
        transitionPosition?: { inTransition?: unknown; remainingFrames?: unknown };
        fadeToBlack?: { isFullyBlack?: unknown; inTransition?: unknown; remainingFrames?: unknown };
      }
    | undefined;
  if (!me) return null;
  const position = me.transitionPosition;
  return {
    programInput: readNumber(me.programInput),
    previewInput: readNumber(me.previewInput),
    transition: {
      inTransition: position?.inTransition === true,
      remainingFrames: readNumber(position?.remainingFrames) ?? 0,
    },
    fadeToBlack: {
      fullyBlack: me.fadeToBlack?.isFullyBlack === true,
      inTransition: me.fadeToBlack?.inTransition === true,
      remainingFrames: readNumber(me.fadeToBlack?.remainingFrames) ?? 0,
    },
  };
}
