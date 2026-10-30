export interface AppConfig {
  port: number;
  host: string;
  backend: "atem" | "pi" | "mock";
  atemHost?: string | undefined;
  atemPort: number;
  apiKey?: string | undefined;
  allowedHosts: string[];
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
    port: Number(env.PISWITCH_PORT || 3106),
    host: env.PISWITCH_HOST || "0.0.0.0",
    backend,
    atemHost,
    atemPort: Number.isInteger(atemPort) && atemPort > 0 ? atemPort : 9910,
    apiKey: env.PISWITCH_API_KEY?.trim() || undefined,
    allowedHosts,
  };
}
