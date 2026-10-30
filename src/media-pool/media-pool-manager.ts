import type {
  MediaPoolConfig,
  MediaPoolKind,
  MediaPoolSlot,
  MediaPlayerInfo,
  SlideBufferState,
  VideoMixerAdapter,
} from "../types.js";

export interface AdvanceSlideResult {
  activeSlot: number;
  sequence: number;
  clearedSlot: number | null;
  nextUploadSlot: number;
  lookaheadSlots: number[];
}

export class MediaPoolManager {
  private mixer: VideoMixerAdapter;
  private config: MediaPoolConfig;
  private slots: Map<number, MediaPoolSlot> = new Map();
  private slideBuffer: SlideBufferState;

  constructor(mixer: VideoMixerAdapter, customConfig?: Partial<MediaPoolConfig>) {
    this.mixer = mixer;

    this.config = {
      totalSlots: customConfig?.totalSlots ?? 24,
      slides: customConfig?.slides ?? {
        startSlot: 1,
        endSlot: 6,
        count: 6,
      },
      graphics: customConfig?.graphics ?? {
        startSlot: 7,
        endSlot: 24,
        count: 18,
      },
    };

    // Initialize all slots up to totalSlots
    for (let slot = 1; slot <= this.config.totalSlots; slot++) {
      let pool: MediaPoolKind = "unassigned";
      if (slot >= this.config.slides.startSlot && slot <= this.config.slides.endSlot) {
        pool = "slides";
      } else if (slot >= this.config.graphics.startSlot && slot <= this.config.graphics.endSlot) {
        pool = "graphics";
      }

      this.slots.set(slot, {
        slot,
        pool,
        isUsed: false,
      });
    }

    this.slideBuffer = {
      activeSlot: this.config.slides.startSlot,
      sequence: 1,
      history: [this.config.slides.startSlot],
      staleSlot: null,
      lookaheadSlots: this.computeLookahead(this.config.slides.startSlot),
    };
  }

  getConfig(): MediaPoolConfig {
    return { ...this.config };
  }

  getSlots(poolFilter?: MediaPoolKind): MediaPoolSlot[] {
    const list = Array.from(this.slots.values());
    if (poolFilter) {
      return list.filter((s) => s.pool === poolFilter);
    }
    return list;
  }

  getSlot(slotNumber: number): MediaPoolSlot | undefined {
    return this.slots.get(slotNumber);
  }

  getSlideBufferState(): SlideBufferState {
    return {
      ...this.slideBuffer,
      lookaheadSlots: [...this.slideBuffer.lookaheadSlots],
      history: [...this.slideBuffer.history],
    };
  }

  getMediaPlayers(): MediaPlayerInfo[] {
    if (this.mixer.getMediaPlayers) {
      return this.mixer.getMediaPlayers();
    }
    return [
      { player: 1, playing: false, loop: false, sourceType: "still", stillSlot: this.slideBuffer.activeSlot },
      { player: 2, playing: false, loop: false, sourceType: "still", stillSlot: null },
    ];
  }

  async setMediaPlayerSource(player: number, slot: number): Promise<void> {
    if (slot < 1 || slot > this.config.totalSlots) {
      throw new Error(`Invalid slot ${slot}: must be between 1 and ${this.config.totalSlots}`);
    }
    if (this.mixer.setMediaPlayerSource) {
      await this.mixer.setMediaPlayerSource(player - 1, slot - 1);
    }
  }

  async uploadStill(
    slot: number,
    rgba: Buffer,
    name?: string,
    requestedPool?: MediaPoolKind
  ): Promise<MediaPoolSlot> {
    if (slot < 1 || slot > this.config.totalSlots) {
      throw new Error(`Invalid slot ${slot}: must be between 1 and ${this.config.totalSlots}`);
    }

    let assignedPool: MediaPoolKind = requestedPool ?? "unassigned";
    if (slot >= this.config.slides.startSlot && slot <= this.config.slides.endSlot) {
      assignedPool = "slides";
    } else if (slot >= this.config.graphics.startSlot && slot <= this.config.graphics.endSlot) {
      assignedPool = "graphics";
    }

    if (this.mixer.uploadStill) {
      await this.mixer.uploadStill(slot - 1, rgba, name || `slot-${slot}`);
    }

    const updated: MediaPoolSlot = {
      slot,
      pool: assignedPool,
      isUsed: true,
      name: name || `slot-${slot}`,
      updatedAt: new Date().toISOString(),
    };
    this.slots.set(slot, updated);
    return updated;
  }

  async clearSlot(slot: number): Promise<MediaPoolSlot> {
    if (slot < 1 || slot > this.config.totalSlots) {
      throw new Error(`Invalid slot ${slot}: must be between 1 and ${this.config.totalSlots}`);
    }

    if (this.mixer.clearStill) {
      await this.mixer.clearStill(slot - 1);
    }

    const current = this.slots.get(slot);
    const updated: MediaPoolSlot = {
      slot,
      pool: current?.pool ?? "unassigned",
      isUsed: false,
      name: undefined,
      description: undefined,
      updatedAt: new Date().toISOString(),
    };
    this.slots.set(slot, updated);
    return updated;
  }

  /**
   * Advances the circular slide buffer (6-slot circle).
   * Policy: Progresses active slot to next (or targetSlot), points Media Player 1 to it (0ms cut),
   * and automatically clears/deletes the slot (N - 2) once we have progressed +2 from it.
   */
  async advanceSlide(targetSlot?: number): Promise<AdvanceSlideResult> {
    const { startSlot, endSlot, count } = this.config.slides;

    let nextSlot: number;
    if (targetSlot !== undefined) {
      if (targetSlot < startSlot || targetSlot > endSlot) {
        throw new Error(
          `targetSlot ${targetSlot} outside slides pool range [${startSlot}..${endSlot}]`
        );
      }
      nextSlot = targetSlot;
    } else {
      const offset = (this.slideBuffer.activeSlot - startSlot + 1) % count;
      nextSlot = startSlot + offset;
    }

    this.slideBuffer.sequence++;
    this.slideBuffer.activeSlot = nextSlot;
    this.slideBuffer.history.push(nextSlot);

    // Calculate stale slot to delete: 2 steps behind current in the circular buffer
    let clearedSlot: number | null = null;
    if (this.slideBuffer.sequence > 2) {
      const staleOffset = (nextSlot - startSlot - 2 + count * 2) % count;
      const calculatedStaleSlot = startSlot + staleOffset;
      await this.clearSlot(calculatedStaleSlot);
      clearedSlot = calculatedStaleSlot;
      this.slideBuffer.staleSlot = clearedSlot;
    }

    // Point Media Player 1 to the new active slot (instant cut)
    await this.setMediaPlayerSource(1, nextSlot);

    this.slideBuffer.lookaheadSlots = this.computeLookahead(nextSlot);

    // Next upload slot is the slot furthest ahead (or the one just cleared)
    const nextUploadSlot = clearedSlot ?? ((nextSlot - startSlot + 2) % count) + startSlot;

    return {
      activeSlot: nextSlot,
      sequence: this.slideBuffer.sequence,
      clearedSlot,
      nextUploadSlot,
      lookaheadSlots: this.slideBuffer.lookaheadSlots,
    };
  }

  private computeLookahead(activeSlot: number): number[] {
    const { startSlot, count } = this.config.slides;
    const offset = activeSlot - startSlot;
    return [
      startSlot + ((offset + 1) % count),
      startSlot + ((offset + 2) % count),
    ];
  }
}
