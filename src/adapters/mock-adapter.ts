import type {
  DownstreamKeySetup,
  MediaPlayerInfo,
  VideoMixerAdapter,
  VideoMixerInput,
  VideoMixerState,
  VideoMixerStateListener,
} from "../types.js";

export interface MockAdapterOptions {
  connected?: boolean;
  inputs?: VideoMixerInput[];
}

export class MockAdapter implements VideoMixerAdapter {
  readonly backend = "mock" as const;

  private connected: boolean;
  private programInput: number | null = 1;
  private previewInput: number | null = 2;
  private inTransition = false;
  private remainingFrames = 0;
  private fullyBlack = false;
  private dskStates = [
    { dsk: 1, onAir: false, tie: false, inTransition: false },
    { dsk: 2, onAir: false, tie: false, inTransition: false },
    { dsk: 3, onAir: false, tie: false, inTransition: false },
    { dsk: 4, onAir: false, tie: false, inTransition: false },
  ];
  private inputs: VideoMixerInput[];
  private listeners: VideoMixerStateListener[] = [];
  public uploadedStills: Map<number, { data: Buffer; name: string }> = new Map();
  public mediaPlayers: Map<number, { sourceType: "still" | "clip"; stillSlot: number | null }> = new Map([
    [1, { sourceType: "still", stillSlot: 1 }],
    [2, { sourceType: "still", stillSlot: null }],
  ]);

  constructor(options: MockAdapterOptions = {}) {
    this.connected = options.connected ?? true;
    this.inputs = options.inputs ?? [
      { id: 1, name: "Camera 1 (Center)", kind: "sdi", available: true },
      { id: 2, name: "Camera 2 (Pulpit)", kind: "sdi", available: true },
      { id: 3, name: "Camera 3 (Altar)", kind: "sdi", available: true },
      { id: 4, name: "PC / Slides", kind: "hdmi", available: true },
      { id: 5, name: "Phone Cam 1", kind: "phone", available: true },
      { id: 6, name: "Phone Cam 2", kind: "phone", available: false },
    ];
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

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.notify();
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
    const prev = this.programInput;
    this.programInput = this.previewInput;
    this.previewInput = prev;
    this.notify();
  }

  async autoTransition(): Promise<void> {
    // In mock, perform the swap
    const prev = this.programInput;
    this.programInput = this.previewInput;
    this.previewInput = prev;
    this.notify();
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

  async clearStill(slotIndex: number): Promise<void> {
    this.uploadedStills.delete(slotIndex);
    this.notify();
  }

  async setMediaPlayerSource(player: number, slotIndex: number): Promise<void> {
    const p = player + 1; // Convert 0-based to 1-based
    this.mediaPlayers.set(p, { sourceType: "still", stillSlot: slotIndex + 1 });
    this.notify();
  }

  getMediaPlayers(): MediaPlayerInfo[] {
    return Array.from(this.mediaPlayers.entries()).map(([player, p]) => ({
      player,
      playing: false,
      loop: false,
      sourceType: p.sourceType,
      stillSlot: p.stillSlot,
    }));
  }

  addInput(input: VideoMixerInput): void {
    const existing = this.inputs.findIndex((i) => i.id === input.id);
    if (existing >= 0) {
      this.inputs[existing] = input;
    } else {
      this.inputs.push(input);
      this.inputs.sort((a, b) => a.id - b.id);
    }
    this.notify();
  }

  removeInput(id: number): void {
    this.inputs = this.inputs.filter((i) => i.id !== id);
    this.notify();
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
