#!/usr/bin/env node

export interface CliOptions {
  url: string;
  apiKey?: string | undefined;
  json: boolean;
  args: string[];
}

function parseCliArgs(argv: string[]): CliOptions {
  let url = process.env.PISWITCH_URL || "http://127.0.0.1:3106";
  let apiKey = process.env.PISWITCH_API_KEY;
  let json = false;
  const args: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--url" && i + 1 < argv.length) {
      url = argv[++i]!;
    } else if (arg === "--key" && i + 1 < argv.length) {
      apiKey = argv[++i]!;
    } else if (arg === "--json") {
      json = true;
    } else if (!arg.startsWith("-")) {
      args.push(arg);
    }
  }

  return { url, apiKey, json, args };
}

async function request(options: CliOptions, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (options.apiKey) headers["x-api-key"] = options.apiKey;
  if (body) headers["content-type"] = "application/json";

  const reqInit: RequestInit = {
    method,
    headers,
  };
  if (body) reqInit.body = JSON.stringify(body);

  const res = await fetch(`${options.url}${path}`, reqInit);

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const err = data?.error?.message || `HTTP ${res.status}: ${text}`;
    throw new Error(err);
  }

  return data;
}

export async function runCli(argv: string[]): Promise<number> {
  const opts = parseCliArgs(argv);
  const command = opts.args[0] || "help";

  try {
    switch (command) {
      case "status": {
        const res = await request(opts, "GET", "/api/v1/status");
        if (opts.json) {
          console.log(JSON.stringify(res, null, 2));
        } else {
          console.log(`Service:    ${res.service} v${res.version}`);
          console.log(`Backend:    ${res.backend}`);
          console.log(`Connected:  ${res.connected ? "YES" : "NO"}`);
          console.log(`Program:    Input ${res.programInput ?? "-"}`);
          console.log(`Preview:    Input ${res.previewInput ?? "-"}`);
          console.log(`FTB:        ${res.fadeToBlack?.fullyBlack ? "BLACK" : "OFF"}`);
          if (res.inputs && res.inputs.length > 0) {
            console.log("\nInputs:");
            for (const input of res.inputs) {
              const mark = input.id === res.programInput ? "[PGM]" : input.id === res.previewInput ? "[PVW]" : "     ";
              console.log(`  ${mark} ${input.id}: ${input.name} (${input.kind}) - ${input.available ? "OK" : "OFFLINE"}`);
            }
          }
        }
        return 0;
      }

      case "program":
      case "pgm": {
        const input = Number(opts.args[1]);
        if (!Number.isInteger(input) || input < 1) {
          console.error("Usage: piswitch program <inputNumber>");
          return 1;
        }
        const res = await request(opts, "PUT", "/api/v1/video-mixer/program", { input });
        if (opts.json) console.log(JSON.stringify(res, null, 2));
        else console.log(`Program set to input ${input}`);
        return 0;
      }

      case "preview":
      case "pvw": {
        const input = Number(opts.args[1]);
        if (!Number.isInteger(input) || input < 1) {
          console.error("Usage: piswitch preview <inputNumber>");
          return 1;
        }
        const res = await request(opts, "PUT", "/api/v1/video-mixer/preview", { input });
        if (opts.json) console.log(JSON.stringify(res, null, 2));
        else console.log(`Preview set to input ${input}`);
        return 0;
      }

      case "cut": {
        const res = await request(opts, "POST", "/api/v1/video-mixer/cut");
        if (opts.json) console.log(JSON.stringify(res, null, 2));
        else console.log("CUT executed (swapped Program and Preview)");
        return 0;
      }

      case "auto": {
        const res = await request(opts, "POST", "/api/v1/video-mixer/auto");
        if (opts.json) console.log(JSON.stringify(res, null, 2));
        else console.log("AUTO transition triggered");
        return 0;
      }

      case "ftb": {
        const res = await request(opts, "POST", "/api/v1/video-mixer/ftb");
        if (opts.json) console.log(JSON.stringify(res, null, 2));
        else console.log("Fade to Black toggled");
        return 0;
      }

      case "dsk": {
        const dsk = Number(opts.args[1]);
        if (!Number.isInteger(dsk) || dsk < 1 || dsk > 4) {
          console.error("Usage: piswitch dsk <1-4> [tie] on|off");
          return 1;
        }
        const hasTie = opts.args[2] === "tie";
        const valStr = hasTie ? opts.args[3] : opts.args[2];
        const val = valStr === "on" ? true : valStr === "off" ? false : null;
        if (val === null) {
          console.error("Usage: piswitch dsk <1-4> [tie] on|off");
          return 1;
        }

        const path = hasTie ? `/api/v1/video-mixer/dsk/${dsk}/tie` : `/api/v1/video-mixer/dsk/${dsk}/on-air`;
        const body = hasTie ? { tie: val } : { onAir: val };
        const res = await request(opts, "PUT", path, body);
        if (opts.json) console.log(JSON.stringify(res, null, 2));
        else console.log(`DSK ${dsk} ${hasTie ? "tie" : "on-air"} set to ${val}`);
        return 0;
      }

      case "phone": {
        const sub = opts.args[1];
        if (sub === "add") {
          const id = Number(opts.args[2]);
          const name = opts.args[3];
          const streamUrl = opts.args[4];
          if (!id || !name) {
            console.error("Usage: piswitch phone add <id> <name> [streamUrl]");
            return 1;
          }
          const res = await request(opts, "POST", "/api/v1/video-mixer/inputs/phone", { id, name, streamUrl });
          if (opts.json) console.log(JSON.stringify(res, null, 2));
          else console.log(`Phone camera registered: Input ${id} (${name})`);
          return 0;
        } else if (sub === "remove" || sub === "rm") {
          const id = Number(opts.args[2]);
          if (!id) {
            console.error("Usage: piswitch phone remove <id>");
            return 1;
          }
          const res = await request(opts, "DELETE", `/api/v1/video-mixer/inputs/phone/${id}`);
          if (opts.json) console.log(JSON.stringify(res, null, 2));
          else console.log(`Phone camera input ${id} removed`);
          return 0;
        }
        console.error("Usage: piswitch phone <add|remove> ...");
        return 1;
      }

      case "help":
      default: {
        console.log("Usage: piswitch <command> [options]");
        console.log("\nCommands:");
        console.log("  status                     Show video mixer status and inputs");
        console.log("  program <input>            Switch Program bus directly to input");
        console.log("  preview <input>            Set Preview bus to input");
        console.log("  cut                        Trigger CUT transition");
        console.log("  auto                       Trigger AUTO transition");
        console.log("  ftb                        Toggle Fade to Black");
        console.log("  dsk <1-4> [tie] on|off     Control Downstream Keyer on-air or tie");
        console.log("  phone add <id> <name> [url] Register a phone camera feed");
        console.log("  phone remove <id>          Remove a phone camera feed");
        console.log("\nOptions:");
        console.log("  --url <url>                piswitch server URL (default: http://127.0.0.1:3106)");
        console.log("  --key <apiKey>             API key if required");
        console.log("  --json                     Output JSON format");
        return 0;
      }
    }
  } catch (err: any) {
    if (opts.json) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(`Error: ${err.message}`);
    }
    return 1;
  }
}

if (import.meta.url.startsWith("file:") && process.argv[1]?.endsWith("cli.ts")) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
