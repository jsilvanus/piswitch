export interface VideoMixerTransitionState {
  inTransition: boolean;
  remainingFrames: number;
}

export interface VideoMixerFadeToBlackState {
  fullyBlack: boolean;
  inTransition: boolean;
  remainingFrames: number;
}

export interface VideoMixerDownstreamKeyerState {
  /** 1-based downstream keyer number (1..4) */
  dsk: number;
  onAir: boolean;
  tie: boolean;
  inTransition: boolean;
}

export interface VideoMixerInput {
  id: number;
  name: string;
  kind: "sdi" | "hdmi" | "phone" | "rtsp" | "webrtc" | "still" | "color" | "internal";
  available: boolean;
}

export interface VideoMixerState {
  connected: boolean;
  backend: "atem" | "pi" | "mock";
  programInput: number | null;
  previewInput: number | null;
  transition: VideoMixerTransitionState;
  fadeToBlack: VideoMixerFadeToBlackState;
  downstreamKeyers: VideoMixerDownstreamKeyerState[];
  inputs?: VideoMixerInput[];
}

export interface DownstreamKeySetup {
  dsk: number;
  mediaPlayer: number;
  stillIndex: number;
  fillInput: number;
  cutInput: number;
}

export type MediaPoolKind = "slides" | "graphics" | "unassigned";

export interface MediaPoolSlot {
  slot: number; // 1-based (1..64)
  pool: MediaPoolKind;
  isUsed: boolean;
  name?: string | undefined;
  description?: string | undefined;
  updatedAt?: string | undefined;
}

export interface MediaPoolConfig {
  totalSlots: number;
  slides: {
    startSlot: number;
    endSlot: number;
    count: number;
  };
  graphics: {
    startSlot: number;
    endSlot: number;
    count: number;
  };
}

export interface SlideBufferState {
  activeSlot: number; // 1-based (1..6)
  sequence: number; // Monotonic step count
  history: number[];
  staleSlot: number | null; // The (N - 2) slot that was cleared
  lookaheadSlots: number[]; // Next slots ready or queued
}

export interface MediaPlayerInfo {
  player: number; // 1-based (1..4)
  playing: boolean;
  loop: boolean;
  sourceType: "still" | "clip";
  stillSlot: number | null; // 1-based (1..64)
}

export type VideoMixerStateListener = (state: VideoMixerState) => void;

export interface VideoMixerAdapter {
  readonly backend: "atem" | "pi" | "mock";
  getState(): VideoMixerState;
  setProgram(input: number): Promise<void>;
  setPreview(input: number): Promise<void>;
  cut(): Promise<void>;
  autoTransition(): Promise<void>;
  fadeToBlack(): Promise<void>;
  setDownstreamKeyOnAir(dskIndex: number, onAir: boolean): Promise<void>;
  setDownstreamKeyTie(dskIndex: number, tie: boolean): Promise<void>;
  setupDownstreamKey(setup: DownstreamKeySetup): Promise<void>;
  uploadStill?(slotIndex: number, rgba: Buffer, name: string): Promise<void>;
  clearStill?(slotIndex: number): Promise<void>;
  setMediaPlayerSource?(player: number, slotIndex: number): Promise<void>;
  getMediaPlayers?(): MediaPlayerInfo[];
  onStateChange(listener: VideoMixerStateListener): void;
  connect?(address?: string, port?: number): Promise<void>;
  disconnect?(): Promise<void>;
}
