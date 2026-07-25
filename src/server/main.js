import fs from 'fs';
import http from 'http';
import https from 'https';
import express from 'express';
import config from '../lib/config.js';
import ViteExpress from 'vite-express';

config.set('auth', (await import('../config/auth.js')).default);
config.set('server', (await import('../config/server.js')).default);
config.set('wsports', (await import('../config/wsports.js')).default);
config.set('game', (await import('../config/game.js')).default);
config.set('client', (await import('../config/client.js')).default);

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

// если продакшн
if (isProduction) {
  // если не указан домен
  if (!env.TANK_BATTLE_DOMAIN) {
    console.error(`
      ERROR: TANK_BATTLE_DOMAIN must be set in the .env file for production.
    `);
    process.exit(1);
  }

  config.set('server:domain', env.TANK_BATTLE_DOMAIN);

  // порт для Node.js приложения
  if (env.TANK_BATTLE_PORT) {
    config.set('server:port', Number(env.TANK_BATTLE_PORT));
  }

  // максимальное количество игроков
  if (env.TANK_BATTLE_PLAYERS) {
    config.set('game:maxPlayers', Number(env.TANK_BATTLE_PLAYERS));
  }

  // стартовая карта
  if (env.TANK_BATTLE_MAP && config.get('game:maps')[env.TANK_BATTLE_MAP]) {
    config.set('game:currentMap', env.TANK_BATTLE_MAP);
  }

  // время раунда
  if (env.TANK_BATTLE_ROUND_TIME) {
    config.set('game:timers:roundTime', Number(env.TANK_BATTLE_ROUND_TIME));
  }

  // время карты
  if (env.TANK_BATTLE_MAP_TIME) {
    config.set('game:timers:mapTime', Number(env.TANK_BATTLE_MAP_TIME));
  }

  // "огонь по своим" (friendly fire)
  if (env.TANK_BATTLE_FRIENDLY_FIRE) {
    config.set('game:parts:friendlyFire', env.TANK_BATTLE_FRIENDLY_FIRE === 'true');
  }

  // если задан режим разработки
} else {
  config.set('server:oneConnection', false);
  config.set('game:isDevMode', true);
}

console.info('------------------------------------------');
console.info('Server Settings:');
console.info(`-> Domain: ${config.get('server:domain')}`);
console.info(`-> Port: ${config.get('server:port')}`);
console.info(`-> Player limit: ${config.get('game:maxPlayers')}`);
console.info(`-> Current map: ${config.get('game:currentMap')}`);
console.info(`-> Round time: ${config.get('game:timers:roundTime')}`);
console.info(`-> Map time: ${config.get('game:timers:mapTime')}`);
console.info(`-> Friendly fire: ${config.get('game:parts:friendlyFire')}`);
console.info('------------------------------------------');

// время ожидания vote-модуля
config.set(
  'client:modules:vote:params:time',
  config.get('game:timers:voteTime'),
);

// данные для client-side prediction
// (реплика движения своего танка и визуального спавна его снарядов)
config.set('client:prediction', {
  timeStep: config.get('game:timers:timeStep'),
  playerKeys: config.get('game:playerKeys'),
  models: config.get('game:parts:models'),
  weapons: config.get('game:parts:weapons'),
});

// EXPRESS
const app = express();
let server;

const port = config.get('server:port');

// в продакшене обычный HTTP сервер, Nginx будет обрабатывать HTTPS
// для разработки HTTPS сервер с локальными сертификатами
if (isProduction) {
  server = http.createServer(app);
} else {
  try {
    const options = {
      key: fs.readFileSync(config.get('server:httpsOptions:key')),
      cert: fs.readFileSync(config.get('server:httpsOptions:cert')),
    };

    server = https.createServer(options, app);
  } catch (err) {
    console.error(`
      Error creating HTTPS server: ${err.message}.
      Ensure that the paths to the certificate and
      key files in config/server.js are correct and the files exist.

      For local development, creating certificates with mkcert:

      brew install mkcert
      brew install nss
      mkcert -install
      mkdir .certs && cd .certs
      mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 ::1
    `);

    process.exit(1);
  }
}

// для продакшена localhost, чтобы сервер не был доступен извне напрямую
const host = isProduction ? '0.0.0.0' : undefined;

server.listen(port, host, () => {
  const protocol = isProduction ? 'http:' : 'https:';
  const displayHost = host || 'localhost';

  console.info(`
    Server is running for ${env.NODE_ENV || 'development'} mode.
    Listening on ${protocol}//${displayHost}:${port}
  `);
});

const socket = (await import('./socket/index.js')).default;
socket(server);

ViteExpress.bind(app, server);
