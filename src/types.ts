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
  onStateChange(listener: VideoMixerStateListener): void;
  connect?(address?: string, port?: number): Promise<void>;
  disconnect?(): Promise<void>;
}
