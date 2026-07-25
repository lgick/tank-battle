# Tank Battle Documentation

A multiplayer 2D real-time online game: an authoritative server (Node.js, Rapier 2D), a PixiJS client, and WebSocket exchange with binary snapshots.

## Sections

| Page | About |
| --- | --- |
| [getting-started.md](getting-started.md) | Local setup: installation, HTTPS certificates, running, tests, local multiplayer |
| [architecture.md](architecture.md) | Overall architecture: server/client/shared, the game loop, the connection lifecycle, key invariants |
| [gameplay.md](gameplay.md) | Gameplay: rounds, teams, statistics, votes, chat commands, controls, weapons, bots, kicks |
| [server.md](server.md) | Server modules: the VIMP facade, managers, Rapier physics, meta modules, infrastructure, bots |
| [client.md](client.md) | Client modules: MVC components, interpolation, prediction, projectile spawning, rendering, sound |
| [network.md](network.md) | Server–client synchronization: WebSocket ports, the binary snapshot frame (v3), data formats, RTT |
| [configuration.md](configuration.md) | Configuration: `.env` variables, all `src/config/` files, `src/data/` data |
| [extending.md](extending.md) | Extending: a new map, weapon, sound, client entity |
| [deployment.md](deployment.md) | Deployment: VPS preparation, adding/removing servers, CI/CD |

## Where to start

- **I want to run it locally** → [getting-started.md](getting-started.md)
- **I want to understand how it all works** → [architecture.md](architecture.md), then [server.md](server.md) / [client.md](client.md) / [network.md](network.md)
- **I want to run my own server** → [deployment.md](deployment.md)
- **I want to add a map/weapon** → [extending.md](extending.md)

> The documentation is maintained alongside the code: when functionality changes, the corresponding page is updated in the same change (the rule is stated in [CLAUDE.md](../../CLAUDE.md)).
