# Tank Battle

A multiplayer 2D real-time online game: team-based tank battles played in rounds.

![game video](./.github/assets/video/game.gif?raw=true)

- **Server**: Node.js + Express + `ws`, authoritative Rapier 2D physics (~120 Hz), binary snapshots at 30 packets/sec.
- **Client**: PixiJS, snapshot interpolation, client-side prediction, procedural textures, spatial audio (Howler).
- **Gameplay**: two teams, hitscan bullets and bombs, bots, votes, chat, statistics.

## Quick start

```bash
git clone https://github.com/lgick/tank-battle.git
cd tank-battle
npm install
npm run dev
```

Development requires local HTTPS certificates (mkcert) — see [docs/en/getting-started.md](docs/en/getting-started.md).

## Documentation

Full documentation lives in [docs/en/](docs/en/README.md):

- [Local setup](docs/en/getting-started.md)
- [Architecture](docs/en/architecture.md)
- [Gameplay](docs/en/gameplay.md)
- [Server modules](docs/en/server.md) · [Client modules](docs/en/client.md)
- [Network protocol (WebSocket)](docs/en/network.md)
- [Configuration](docs/en/configuration.md)
- [Extending the game (maps, weapons, sounds)](docs/en/extending.md)
- [Server deployment](docs/en/deployment.md)

[Русская версия](docs/ru/README.md)

## Interface

![interface](./.github/assets/images/face.png?raw=true)

## ❤️ Supporting the Project

If you find this project useful and want to support its development, starring the project on GitHub
is a great way to show your appreciation!

Donations are also welcome via Bitcoin. Every contribution helps sustain the project and is greatly
appreciated.

| Currency | Address                                      | QR Code                                                                                                                                            |
| :------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BTC**  | `bc1q0fnakv2jean57p3rjqzhq826jklygpj6gc7evu` | <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=bc1q0fnakv2jean57p3rjqzhq826jklygpj6gc7evu" alt="BTC QR Code" width="120"> |
