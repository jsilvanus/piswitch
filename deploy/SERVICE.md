# systemd user unit

`piswitch.service` runs piswitch as a systemd user service.

Expected layout (relative to the service user's home, `%h`):

- app checkout (built, with `dist/`): `~/apps/piswitch`
- environment file: `~/apps/piswitch.env` (all settings and secrets live here, never in git)
- Node.js: `~/.local/bin/node`

Install:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/piswitch.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now piswitch
loginctl enable-linger "$USER"   # once, so it runs without a login session
```

Status and logs: `systemctl --user status piswitch`, `journalctl --user -u piswitch -f`.
