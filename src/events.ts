import { EventEmitter } from "node:events";
import type { VideoMixerState } from "./types.js";

export type SwitchEvent =
  | { type: "video-mixer"; data: VideoMixerState }
  | { type: "atem"; data: VideoMixerState }
  | { type: "ready"; data: { status: string; time: string } };

export class SwitchEventBroker {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: SwitchEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: SwitchEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }

  listenerCount(): number {
    return this.emitter.listenerCount("event");
  }
}
