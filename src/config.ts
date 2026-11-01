export interface AppConfig {
  port: number;
  host: string;
  backend: "atem" | "pi" | "mock";
  atemHost?: string | undefined;
  atemPort: number;
  apiKey?: string | undefined;
  allowedHosts: string[];
  atemDynamicInput: number;
  atlonaAtemOutput: number;
  pimatrixUrl?: string | undefined;
  pigatewayUrl?: string | undefined;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const atemHost = env.PISWITCH_ATEM_HOST?.trim() || env.PIGATEWAY_ATEM_HOST?.trim() || undefined;
  const atemPort = Number(env.PISWITCH_ATEM_PORT || env.PIGATEWAY_ATEM_PORT || 9910);

  let backend: "atem" | "pi" | "mock" = "pi";
  const rawBackend = env.PISWITCH_BACKEND?.toLowerCase().trim();
  if (rawBackend === "atem" || rawBackend === "pi" || rawBackend === "mock") {
    backend = rawBackend;
  } else if (atemHost) {
    backend = "atem";
  }

  const allowedHosts = (env.PISWITCH_AUTH_ALLOWED_HOSTS || "127.0.0.1,::1,localhost")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    port: Number(env.PISWITCH_PORT || 3103),
    host: env.PISWITCH_HOST || "0.0.0.0",
    backend,
    atemHost,
    atemPort: Number.isInteger(atemPort) && atemPort > 0 ? atemPort : 9910,
    apiKey: env.PISWITCH_API_KEY?.trim() || undefined,
    allowedHosts,
    atemDynamicInput: Number(env.PISWITCH_ATEM_DYNAMIC_INPUT || 4),
    atlonaAtemOutput: Number(env.PISWITCH_ATLONA_ATEM_OUTPUT || 5),
    pimatrixUrl: env.PISWITCH_PIMATRIX_URL?.trim() || undefined,
    pigatewayUrl: env.PISWITCH_PIGATEWAY_URL?.trim() || undefined,
  };
}
