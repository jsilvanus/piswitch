import type {
  DownstreamKeySetup,
  VideoMixerAdapter,
  VideoMixerInput,
  VideoMixerState,
  VideoMixerStateListener,
} from "../types.js";

export interface PhoneCameraSource {
  id: number;
  name: string;
  streamUrl?: string | undefined;
  deviceInfo?: string | undefined;
  connectedAt?: string | undefined;
}

export interface PiSoftwareAdapterOptions {
  inputs?: VideoMixerInput[];
  transitionDurationMs?: number;
}

/**
 * Software Video Mixer running on the Raspberry Pi.
 * Supports dynamic video sources including network phone cameras (RTSP, SRT, WebRTC via MediaMTX),
 * local capture cards, test patterns, and slide overlays.
 */
export class PiSoftwareAdapter implements VideoMixerAdapter {
  readonly backend = "pi" as const;

  private connected = true;
  private programInput: number | null = 1;
  private previewInput: number | null = 2;
  private inTransition = false;
  private remainingFrames = 0;
  private fullyBlack = false;
  private transitionDurationMs: number;
  private transitionTimer: NodeJS.Timeout | null = null;

  private dskStates = [
    { dsk: 1, onAir: false, tie: false, inTransition: false },
    { dsk: 2, onAir: false, tie: false, inTransition: false },
  ];

  private inputs: VideoMixerInput[] = [
    { id: 1, name: "Main Cam (Center)", kind: "sdi", available: true },
    { id: 2, name: "Pulpit Cam", kind: "sdi", available: true },
    { id: 3, name: "Altar Cam", kind: "sdi", available: true },
    { id: 4, name: "PiProgram Slides", kind: "internal", available: true },
  ];

  private phoneSources: Map<number, PhoneCameraSource> = new Map();
  private uploadedStills: Map<number, { data: Buffer; name: string }> = new Map();
  private listeners: VideoMixerStateListener[] = [];

  constructor(options: PiSoftwareAdapterOptions = {}) {
    if (options.inputs) {
      this.inputs = [...options.inputs];
    }
    this.transitionDurationMs = options.transitionDurationMs ?? 500;
  }

  getState(): VideoMixerState {
    return {
      connected: this.connected,
      backend: this.backend,
      programInput: this.programInput,
      previewInput: this.previewInput,
      transition: {
        inTransition: this.inTransition,
        remainingFrames: this.remainingFrames,
      },
      fadeToBlack: {
        fullyBlack: this.fullyBlack,
        inTransition: false,
        remainingFrames: 0,
      },
      downstreamKeyers: this.dskStates.map((d) => ({ ...d })),
      inputs: this.inputs.map((i) => ({ ...i })),
    };
  }

  async setProgram(input: number): Promise<void> {
    this.programInput = input;
    this.notify();
  }

  async setPreview(input: number): Promise<void> {
    this.previewInput = input;
    this.notify();
  }

  async cut(): Promise<void> {
    if (this.inTransition) this.cancelTransition();
    const prev = this.programInput;
    this.programInput = this.previewInput;
    this.previewInput = prev;

    // Any DSK with tie=true toggles on air
    for (const dsk of this.dskStates) {
      if (dsk.tie) {
        dsk.onAir = !dsk.onAir;
      }
    }
    this.notify();
  }

  async autoTransition(): Promise<void> {
    if (this.inTransition) return;
    this.inTransition = true;
    this.remainingFrames = Math.round((this.transitionDurationMs / 1000) * 25);
    this.notify();

    if (this.transitionTimer) clearTimeout(this.transitionTimer);
    this.transitionTimer = setTimeout(() => {
      this.inTransition = false;
      this.remainingFrames = 0;
      const prev = this.programInput;
      this.programInput = this.previewInput;
      this.previewInput = prev;
      for (const dsk of this.dskStates) {
        if (dsk.tie) dsk.onAir = !dsk.onAir;
      }
      this.transitionTimer = null;
      this.notify();
    }, this.transitionDurationMs);
  }

  private cancelTransition(): void {
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = null;
    }
    this.inTransition = false;
    this.remainingFrames = 0;
  }

  async fadeToBlack(): Promise<void> {
    this.fullyBlack = !this.fullyBlack;
    this.notify();
  }

  async setDownstreamKeyOnAir(dskIndex: number, onAir: boolean): Promise<void> {
    const keyer = this.dskStates[dskIndex];
    if (keyer) {
      keyer.onAir = onAir;
      this.notify();
    }
  }

  async setDownstreamKeyTie(dskIndex: number, tie: boolean): Promise<void> {
    const keyer = this.dskStates[dskIndex];
    if (keyer) {
      keyer.tie = tie;
      this.notify();
    }
  }

  async setupDownstreamKey(_setup: DownstreamKeySetup): Promise<void> {
    this.notify();
  }

  async uploadStill(slotIndex: number, rgba: Buffer, name: string): Promise<void> {
    this.uploadedStills.set(slotIndex, { data: rgba, name });
    this.notify();
  }

  // Phone Camera & Dynamic Source Management
  registerPhoneCamera(source: PhoneCameraSource): VideoMixerInput {
    this.phoneSources.set(source.id, {
      ...source,
      connectedAt: source.connectedAt ?? new Date().toISOString(),
    });

    const mixerInput: VideoMixerInput = {
      id: source.id,
      name: source.name,
      kind: "phone",
      available: true,
    };

    const existingIdx = this.inputs.findIndex((i) => i.id === source.id);
    if (existingIdx >= 0) {
      this.inputs[existingIdx] = mixerInput;
    } else {
      this.inputs.push(mixerInput);
      this.inputs.sort((a, b) => a.id - b.id);
    }

    this.notify();
    return mixerInput;
  }

  unregisterPhoneCamera(id: number): boolean {
    const removedPhone = this.phoneSources.delete(id);
    const existing = this.inputs.find((i) => i.id === id);
    if (existing && existing.kind === "phone") {
      existing.available = false;
      this.notify();
      return true;
    }
    return removedPhone;
  }

  getPhoneCameras(): PhoneCameraSource[] {
    return Array.from(this.phoneSources.values());
  }

  onStateChange(listener: VideoMixerStateListener): void {
    this.listeners.push(listener);
  }

  private notify(): void {
    const s = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(s);
      } catch {}
    }
  }
}
