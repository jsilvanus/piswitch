import type { AppConfig } from "../config.js";
import type { RoutingStore } from "./routing-store.js";

export interface RouteResult {
  ok: boolean;
  bus?: "pi1" | "pi2" | undefined;
  atlonaInput?: number | undefined;
  atlonaOutput?: number | undefined;
  message?: string | undefined;
  error?: string | undefined;
}

export class MatrixRouter {
  constructor(
    private readonly config: AppConfig,
    private readonly routingStore: RoutingStore,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /**
   * Routes the matrix (Atlona / PiMatrix) when an RTMP/RTSP camera source is selected.
   */
  async routeForInput(inputId: number): Promise<RouteResult> {
    const busInfo = this.routingStore.resolveBusForInput(inputId);
    const atlonaOutput = this.config.atlonaAtemOutput ?? 5;
    const atlonaInput = busInfo.atlonaInput;

    this.routingStore.setActiveBusOnAir(busInfo.bus);

    const targetUrl = this.config.pimatrixUrl || this.config.pigatewayUrl;
    if (!targetUrl) {
      return {
        ok: true,
        bus: busInfo.bus,
        atlonaInput,
        atlonaOutput,
        message: `Simulated matrix route: Atlona ${atlonaInput} -> ${atlonaOutput}`,
      };
    }

    try {
      const res = await this.fetchFn(`${targetUrl.replace(/\/+$/, "")}/api/v1/matrix/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Actor": "piswitch",
        },
        body: JSON.stringify({ input: atlonaInput, output: atlonaOutput }),
        signal: AbortSignal.timeout(3000),
      });

      return {
        ok: res.ok,
        bus: busInfo.bus,
        atlonaInput,
        atlonaOutput,
      };
    } catch (err) {
      return {
        ok: false,
        bus: busInfo.bus,
        atlonaInput,
        atlonaOutput,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
