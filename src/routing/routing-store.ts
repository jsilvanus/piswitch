export interface PiBusConfig {
  hdmi: "hdmi0" | "hdmi1";
  atlonaInput: number; // 3 for Pi1, 4 for Pi2
  reservedFor?: string | null | undefined; // e.g. "projectors", "piprogram", or null if free
}

export interface RoutingConfig {
  atemDynamicInput: number; // default 4
  atlonaAtemOutput: number; // default 5
  piBuses: {
    pi1: PiBusConfig;
    pi2: PiBusConfig;
  };
  defaultAtemBus: "pi1" | "pi2";
}

export interface DynamicInputMapping {
  inputId: number;
  name: string;
  streamUrl?: string | undefined;
  sourceId?: string | undefined;
  preferredBus?: "pi1" | "pi2" | "auto" | undefined;
}

export class RoutingStore {
  private config: RoutingConfig;
  private dynamicInputs: Map<number, DynamicInputMapping> = new Map();
  private activeBusOnAir: "pi1" | "pi2" = "pi1";

  constructor(initial?: Partial<RoutingConfig>) {
    this.config = {
      atemDynamicInput: initial?.atemDynamicInput ?? 4,
      atlonaAtemOutput: initial?.atlonaAtemOutput ?? 5,
      piBuses: {
        pi1: {
          hdmi: initial?.piBuses?.pi1?.hdmi ?? "hdmi0",
          atlonaInput: initial?.piBuses?.pi1?.atlonaInput ?? 3,
          reservedFor: initial?.piBuses?.pi1?.reservedFor ?? null,
        },
        pi2: {
          hdmi: initial?.piBuses?.pi2?.hdmi ?? "hdmi1",
          atlonaInput: initial?.piBuses?.pi2?.atlonaInput ?? 4,
          reservedFor: initial?.piBuses?.pi2?.reservedFor ?? null,
        },
      },
      defaultAtemBus: initial?.defaultAtemBus ?? "pi1",
    };
  }

  getConfig(): RoutingConfig {
    return {
      atemDynamicInput: this.config.atemDynamicInput,
      atlonaAtemOutput: this.config.atlonaAtemOutput,
      piBuses: {
        pi1: { ...this.config.piBuses.pi1 },
        pi2: { ...this.config.piBuses.pi2 },
      },
      defaultAtemBus: this.config.defaultAtemBus,
    };
  }

  updateConfig(patch: Partial<RoutingConfig>): RoutingConfig {
    if (patch.atemDynamicInput !== undefined) this.config.atemDynamicInput = patch.atemDynamicInput;
    if (patch.atlonaAtemOutput !== undefined) this.config.atlonaAtemOutput = patch.atlonaAtemOutput;
    if (patch.defaultAtemBus !== undefined) this.config.defaultAtemBus = patch.defaultAtemBus;

    if (patch.piBuses?.pi1) {
      this.config.piBuses.pi1 = { ...this.config.piBuses.pi1, ...patch.piBuses.pi1 };
    }
    if (patch.piBuses?.pi2) {
      this.config.piBuses.pi2 = { ...this.config.piBuses.pi2, ...patch.piBuses.pi2 };
    }
    return this.getConfig();
  }

  setBusReservation(bus: "pi1" | "pi2", reservedFor: string | null): void {
    this.config.piBuses[bus].reservedFor = reservedFor;
  }

  isBusFree(bus: "pi1" | "pi2"): boolean {
    return !this.config.piBuses[bus].reservedFor;
  }

  registerDynamicInput(input: DynamicInputMapping): void {
    this.dynamicInputs.set(input.inputId, { ...input });
  }

  unregisterDynamicInput(inputId: number): boolean {
    return this.dynamicInputs.delete(inputId);
  }

  getDynamicInput(inputId: number): DynamicInputMapping | undefined {
    return this.dynamicInputs.get(inputId);
  }

  listDynamicInputs(): DynamicInputMapping[] {
    return Array.from(this.dynamicInputs.values());
  }

  /**
   * Determine which Pi bus should handle the incoming dynamic feed.
   * If preWarming=true and both buses are free, picks the alternate bus (Option 2).
   * If one bus is reserved for projectors/piprogram, falls back to the available bus (Option 1).
   */
  resolveBusForInput(inputId: number, preWarming = false): {
    bus: "pi1" | "pi2";
    hdmi: "hdmi0" | "hdmi1";
    atlonaInput: number;
    mode: "pre-warmed" | "direct-swap";
  } {
    const mapping = this.dynamicInputs.get(inputId);
    const preferred = mapping?.preferredBus;

    const pi1Free = this.isBusFree("pi1");
    const pi2Free = this.isBusFree("pi2");

    let chosenBus: "pi1" | "pi2" = this.config.defaultAtemBus;

    if (preferred === "pi1" && (pi1Free || !pi2Free)) {
      chosenBus = "pi1";
    } else if (preferred === "pi2" && (pi2Free || !pi1Free)) {
      chosenBus = "pi2";
    } else if (preWarming && pi1Free && pi2Free) {
      // Option 2: Pre-warm on alternate bus
      chosenBus = this.activeBusOnAir === "pi1" ? "pi2" : "pi1";
    } else if (!pi1Free && pi2Free) {
      chosenBus = "pi2";
    } else {
      chosenBus = "pi1";
    }

    const mode = preWarming && pi1Free && pi2Free && chosenBus !== this.activeBusOnAir ? "pre-warmed" : "direct-swap";
    const busConfig = this.config.piBuses[chosenBus];

    return {
      bus: chosenBus,
      hdmi: busConfig.hdmi,
      atlonaInput: busConfig.atlonaInput,
      mode,
    };
  }

  setActiveBusOnAir(bus: "pi1" | "pi2"): void {
    this.activeBusOnAir = bus;
  }

  getActiveBusOnAir(): "pi1" | "pi2" {
    return this.activeBusOnAir;
  }
}
