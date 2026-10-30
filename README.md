# piswitch

Universal Video Mixer microservice and CLI for Raspberry Pi.

`piswitch` decouples client interfaces and services from specific switcher hardware. It provides a standardized REST and SSE interface (`/api/v1/video-mixer/*`) capable of driving:
1. **Hardware Switchers**: Blackmagic ATEM SDI / Mini Extreme ISO via UDP protocol.
2. **Pi Software Mixer**: Software mixing directly on the Raspberry Pi (GStreamer / FFmpeg / MediaMTX), supporting extra cameras such as mobile phones (WebRTC, SRT, RTSP).
3. **Simulated / Mock**: Testing and CI without hardware.

Backward-compatible `/api/v1/atem/*` endpoints and event channels are preserved so existing clients, tally lights, and matrix proxies continue working seamlessly.

---

## Architecture in the Pi Ecosystem

```
   [ picontrol Web UI & CLI ]
                │
                ▼
          [ piswitch ] (:3106)
          /    │     \
         /     │      \
        ▼      │       ▼
 [ ATEM Switcher ]  [ Pi Software Mixer ]
 (SDI / Mini)       (MediaMTX + Phone feeds)
```

- **Port**: `3106` (adjacent to `pigateway` :3100 and `pitube` :3105).
- **SSE Events**: `GET /api/v1/events` pushes `{ type: "video-mixer", data: state }` and `{ type: "atem", data: state }`.

---

## HTTP API

### Canonical Endpoints (`/api/v1/video-mixer/*`)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health status. |
| `GET` | `/api/v1/status` | Extended mixer status, backend type, and input list. |
| `GET` | `/api/v1/video-mixer` | Current switcher state (`programInput`, `previewInput`, `transition`, `fadeToBlack`, `downstreamKeyers`). |
| `PUT` | `/api/v1/video-mixer/program` | Set Program bus input directly (`{"input": number}`). |
| `PUT` | `/api/v1/video-mixer/preview` | Set Preview bus input (`{"input": number}`). |
| `POST` | `/api/v1/video-mixer/cut` | Perform immediate CUT transition (swapping Program and Preview). |
| `POST` | `/api/v1/video-mixer/auto` | Trigger AUTO transition (mix/wipe). |
| `POST` | `/api/v1/video-mixer/ftb` | Toggle Fade to Black. |
| `PUT` | `/api/v1/video-mixer/dsk/:dsk/on-air` | Set downstream keyer on/off air (`{"onAir": boolean}`). |
| `PUT` | `/api/v1/video-mixer/dsk/:dsk/tie` | Set downstream keyer tie (`{"tie": boolean}`). |
| `PUT` | `/api/v1/video-mixer/dsk/:dsk/setup` | Configure DSK sources (`{"mediaPlayer": n, "slot": n, ...}`). |
| `PUT` | `/api/v1/video-mixer/media/stills/:slot` | Upload still slide image (raw RGBA `application/octet-stream`). |
| `GET` | `/api/v1/video-mixer/inputs` | List configured and dynamic inputs (SDI, HDMI, phone cameras). |
| `POST` | `/api/v1/video-mixer/inputs/phone` | Register a phone camera feed (`{"id": n, "name": "...", "streamUrl": "..."}`). |
| `DELETE` | `/api/v1/video-mixer/inputs/phone/:id` | Unregister a phone camera feed. |
| `GET` | `/api/v1/events` | Server-Sent Events stream for real-time mixer state updates. |

*(All `/api/v1/atem/*` paths are fully supported as drop-in backwards-compatible aliases)*

---

## CLI Usage

`piswitch` includes a built-in CLI:

```bash
# Check status
piswitch status

# Video switching
piswitch program 1     # Set Program to Input 1
piswitch preview 2     # Set Preview to Input 2
piswitch cut           # CUT transition
piswitch auto          # AUTO transition
piswitch ftb           # Toggle Fade to Black

# Keyers
piswitch dsk 1 on
piswitch dsk 1 tie on

# Manage Phone Cameras
piswitch phone add 5 "Pastor Phone" rtsp://mediamtx:8554/pastor
piswitch phone remove 5
```

---

## Configuration

Copy `.env.example` to `.env`:

```env
PISWITCH_PORT=3106
PISWITCH_BACKEND=atem # atem | pi | mock
PISWITCH_ATEM_HOST=192.168.1.20
PISWITCH_ATEM_PORT=9910
```

---

## Development & Testing

```bash
# Run unit tests
npm test

# Build TypeScript
npm run build

# Start dev server with watch
npm run dev
```
