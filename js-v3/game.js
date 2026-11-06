import {
  START_LIVES,
  COIN_SCORE,
  STOMP_SCORE,
  INVULN_MS,
  RESPAWN_BLINK_MS,
  MAX_AIR_JUMPS,
} from "/js-v3/constants.js";
import { createLevel } from "/js-v3/level.js";
import {
  createPlayer,
  updatePlayer,
  createEnemy,
  updateEnemy,
  createCoin,
  updateCoin,
} from "/js-v3/entities.js";
import { aabbOverlap, snapPlayerToGround } from "/js-v3/physics.js";
import {
  computeCamera,
  drawWorld,
  drawCoin,
  drawEnemy,
  drawPlayer,
  drawMenuBackdrop,
} from "/js-v3/render.js";
import {
  loadUsername,
  saveUsername,
  loadUnlockedMax,
  saveUnlockedMax,
} from "/js-v3/storage.js";

export const STATE = {
  MENU: "menu",
  PLAYING: "playing",
  WON: "won",
  GAME_OVER: "game_over",
};

const COIN_NOTICE =
  "¡Atención! Aún te faltan monedas. Recógelas todas y vuelve a la meta.";

export function coinsCollected(game) {
  return (game.coins || []).filter((c) => c.collected).length;
}

export function coinsTotal(game) {
  return (game.coins || []).length;
}

function unlockNext(game) {
  const next = Math.min(4, (game.levelId || 1) + 1);
  if (next > game.unlockedMax) {
    game.unlockedMax = next;
    saveUnlockedMax(next);
  }
}

export function createGame() {
  return {
    state: STATE.MENU,
    levelId: null,
    username: loadUsername(),
    unlockedMax: loadUnlockedMax(),
    level: null,
    player: null,
    enemies: [],
    coins: [],
    lives: START_LIVES,
    score: 0,
    cameraX: 0,
    cameraY: 0,
    invulnMs: 0,
    blinkTimer: 0,
    jumpWasDown: false,
    time: 0,
    notice: "",
    flagNoticeShown: false,
  };
}

export function startLevel(game, levelId, username) {
  const name = (username ?? game.username ?? "").trim().slice(0, 16);
  saveUsername(name);

  const level = createLevel(levelId);
  const player = createPlayer(level.spawn);
  snapPlayerToGround(player, level.platforms);

  game.state = STATE.PLAYING;
  game.levelId = level.id;
  game.username = name;
  game.level = level;
  game.player = player;
  game.enemies = level.enemies.map(createEnemy);
  game.coins = level.coins.map((c) => createCoin(c.x, c.y));
  game.lives = START_LIVES;
  game.score = 0;
  game.cameraX = 0;
  game.cameraY = 0;
  game.invulnMs = 0;
  game.blinkTimer = 0;
  game.jumpWasDown = false;
  game.time = 0;
  game.notice = "";
  game.flagNoticeShown = false;
}

export function resetGame(game) {
  if (!game.levelId) return;
  startLevel(game, game.levelId, game.username);
}

export function returnToMenu(game) {
  if (game.state === STATE.WON) unlockNext(game);
  game.state = STATE.MENU;
  game.levelId = null;
  game.level = null;
  game.player = null;
  game.enemies = [];
  game.coins = [];
  game.jumpWasDown = false;
  game.notice = "";
  game.flagNoticeShown = false;
}

function respawnPlayer(game) {
  const { spawn } = game.level;
  game.player.x = spawn.x;
  game.player.y = spawn.y;
  game.player.vx = 0;
  game.player.vy = 0;
  game.player.grounded = false;
  game.player.airJumpsLeft = MAX_AIR_JUMPS;
  snapPlayerToGround(game.player, game.level.platforms);
  game.invulnMs = INVULN_MS;
}

function loseLife(game) {
  game.lives -= 1;
  if (game.lives <= 0) {
    game.state = STATE.GAME_OVER;
    return;
  }
  respawnPlayer(game);
}

function handleEnemyCollisions(game) {
  const { player } = game;
  if (game.invulnMs > 0) return;

  for (const enemy of game.enemies) {
    if (!enemy.alive) continue;
    if (!aabbOverlap(player, enemy)) continue;

    const playerFeet = player.y + player.h;
    const stomp =
      player.vy > 0 && playerFeet - enemy.y < 18 && player.x + player.w > enemy.x + 6;

    if (stomp) {
      enemy.alive = false;
      game.score += STOMP_SCORE;
      player.vy = -380;
    } else {
      loseLife(game);
      return;
    }
  }
}

function handleCoins(game) {
  for (const coin of game.coins) {
    if (coin.collected) continue;
    const box = { x: coin.x - coin.r, y: coin.y - coin.r, w: coin.r * 2, h: coin.r * 2 };
    if (aabbOverlap(game.player, box)) {
      coin.collected = true;
      game.score += COIN_SCORE;
      if (coinsCollected(game) === coinsTotal(game)) game.notice = "";
    }
  }
}

function handleFlag(game) {
  const flag = game.level.flag;
  const hitBox = { x: flag.x, y: flag.y, w: flag.w + 30, h: flag.h };
  const overlapping = aabbOverlap(game.player, hitBox);
  const remaining = coinsTotal(game) - coinsCollected(game);

  if (!overlapping) {
    game.flagNoticeShown = false;
    return;
  }

  if (remaining > 0) {
    if (!game.flagNoticeShown) {
      game.flagNoticeShown = true;
      game.notice = COIN_NOTICE;
    }
    return;
  }

  game.notice = "";
  game.state = STATE.WON;
  unlockNext(game);
}

export function updateGame(game, input, dt) {
  game.time += dt;

  if (game.state === STATE.MENU) return;

  if (game.state !== STATE.PLAYING) {
    if (input.restart()) resetGame(game);
    return;
  }

  if (input.restart()) {
    resetGame(game);
    return;
  }

  const jumpDown = input.jumpPressed();
  const jumpEdge = jumpDown && !game.jumpWasDown;
  game.jumpWasDown = jumpDown;

  updatePlayer(game.player, input, dt, game.level.platforms, jumpEdge);

  if (game.player.x < 0) {
    game.player.x = 0;
    game.player.vx = 0;
  }

  const cam = computeCamera(
    game.player.x,
    game.player.y,
    game.player.h,
    game.level.worldWidth
  );
  game.cameraX = cam.cameraX;
  game.cameraY = cam.cameraY;

  const killY = game.level.killY;
  if (game.player.y > killY) {
    loseLife(game);
    return;
  }

  for (const enemy of game.enemies) {
    updateEnemy(enemy, dt, game.level.platforms);
  }
  for (const coin of game.coins) {
    updateCoin(coin, dt);
  }

  handleEnemyCollisions(game);
  if (game.state !== STATE.PLAYING) return;

  handleCoins(game);
  handleFlag(game);

  if (game.invulnMs > 0) {
    game.invulnMs -= dt * 1000;
    game.blinkTimer += dt * 1000;
  }
}

export function drawGame(ctx, game) {
  if (!game.level || !game.player) {
    drawMenuBackdrop(ctx);
    return;
  }

  drawWorld(ctx, game.level, game.cameraX, game.cameraY, game.time);

  for (const coin of game.coins) {
    drawCoin(ctx, coin, game.cameraX, game.cameraY);
  }
  for (const enemy of game.enemies) {
    drawEnemy(ctx, enemy, game.cameraX, game.cameraY, game.level.theme);
  }

  const blinkVisible =
    game.invulnMs <= 0 ||
    Math.floor(game.blinkTimer / RESPAWN_BLINK_MS) % 2 === 0;
  drawPlayer(ctx, game.player, game.cameraX, game.cameraY, blinkVisible, game.time);
}

export function updateHud(game, livesEl, scoreEl, nameEl, coinsEl, noticeEl) {
  livesEl.textContent = `Vidas: ${Math.max(0, game.lives)}`;
  scoreEl.textContent = `Puntos: ${game.score}`;
  if (nameEl) nameEl.textContent = game.username || "Jugador";
  if (coinsEl) coinsEl.textContent = `Monedas: ${coinsCollected(game)}/${coinsTotal(game)}`;
  if (noticeEl) {
    const text = game.notice || "";
    noticeEl.textContent = text;
    noticeEl.classList.toggle("hidden", !text);
  }
}

export function updateOverlay(game, overlay, titleEl) {
  if (game.state === STATE.WON) {
    overlay.classList.remove("hidden");
    titleEl.textContent = `${game.username || "Jugador"} — ¡Nivel completado! Puntos: ${game.score}`;
  } else if (game.state === STATE.GAME_OVER) {
    overlay.classList.remove("hidden");
    titleEl.textContent = `${game.username || "Jugador"} — Fin de la partida`;
  } else {
    overlay.classList.add("hidden");
  }
}
