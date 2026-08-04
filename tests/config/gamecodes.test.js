import { describe, it, expect } from 'vitest';
import { GAME_CODES } from '../../src/config/gamecodes.js';
import client from '../../src/config/client.js';

describe('GAME_CODES', () => {
  it('индексы совпадают с позициями сообщений в client.js -> gameInform.list', () => {
    const { list } = client.gameInform;

    expect(list[GAME_CODES.winnerTeam[0]]).toBe('{0} WINS!');
    expect(list[GAME_CODES.roundStart[0]]).toBe('ROUND START!');
    expect(list[GAME_CODES.gameOver[0]]).toBe('GAME OVER!');
  });
});
