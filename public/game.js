// game.js — Emoji Blaster solo mode, standalone (no Construct 3)

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const input = document.getElementById("type-input");
const dualInputRow = document.getElementById("dual-input-row");
const inputA = document.getElementById("type-input-a");
const inputB = document.getElementById("type-input-b");
const scoreEl = document.getElementById("score-value");
const livesEl = document.getElementById("lives-value");
const levelSelect = document.getElementById("level-select");
const gameOverScreen = document.getElementById("game-over");
const finalScoreEl = document.getElementById("final-score");
const restartBtn = document.getElementById("restart-btn");
const levelButtons = document.querySelectorAll(".level-btn");

const correctSound = new Audio("sounds/correct_sound.webm");
const missSound = new Audio("sounds/miss_sound.webm");

// Synthesized low-end "boom" layered under missSound on base-destroy impacts.
// Swap this out for a real explosion asset later if you have one — just
// replace playBoom() with `new Audio("sounds/explosion.webm").play()`.
let audioCtx = null;
function playBoom() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.28);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.32);

    // A short burst of noise on top for "crunch"
    const bufferSize = audioCtx.sampleRate * 0.15;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.3, now);
    noise.connect(noiseGain).connect(audioCtx.destination);
    noise.start(now);
  } catch (e) { /* audio not available — fail silently */ }
}

function playDing() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) { /* audio not available — fail silently */ }
}

function playBuzz() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(120, now);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (e) { /* audio not available — fail silently */ }
}

const MAX_LIVES = 3;
const RETRY_LIMIT = 25; // Level 3 safeguard: re-roll if a pair shares no keyword
const BARRIER_HEIGHT = 34;
const LEVEL2_REQUIRED = 2; // how many distinct correct keywords Level 2 needs

let state = {
  level: 1,
  score: 0,
  lives: MAX_LIVES,
  fallSpeed: 0.85,       // px/frame at 600px reference height — quicker than the original tuning, but still typeable
  emojiSize: 64,
  falling: [],
  targetKeywords: [],
  foundKeywords: [],     // Level 2: keywords already correctly typed this round
  running: false,
  barriers: [],          // { alive: bool, x, w }
  shake: 0,              // remaining screen-shake frames
  particles: [],         // explosion debris
};

function resizeCanvas() {
  const wrap = document.getElementById("game-wrap");
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  layoutBarriers();
}
window.addEventListener("resize", resizeCanvas);

function layoutBarriers() {
  const count = MAX_LIVES;
  const w = canvas.width / count;
  const existing = state.barriers;
  state.barriers = [];
  for (let i = 0; i < count; i++) {
    state.barriers.push({
      alive: existing[i] ? existing[i].alive : true,
      x: i * w,
      w,
    });
  }
}

function randInt(n) { return Math.floor(Math.random() * n); }
function randChoice(arr) { return arr[randInt(arr.length)]; }

function spawnRound() {
  state.falling = [];
  state.targetKeywords = [];
  state.foundKeywords = [];
  input.value = "";
  resetDualInputs();
  if (state.level === 2) inputA.focus(); else input.focus();

  if (state.level === 1) {
    const entry = randChoice(EMOJI_DATA);
    state.falling.push(makeFaller(entry.emoji, canvas.width * 0.5));
    state.targetKeywords = entry.keywords; // any of its keywords counts as correct
  } else if (state.level === 2) {
    const entry = randChoice(EMOJI_DATA);
    state.falling.push(makeFaller(entry.emoji, canvas.width * 0.5));
    state.targetKeywords = entry.keywords; // any two distinct valid keywords clear the round
  } else {
    let a, b, shared = [];
    for (let i = 0; i < RETRY_LIMIT && shared.length === 0; i++) {
      a = randChoice(EMOJI_DATA);
      b = randChoice(EMOJI_DATA);
      if (a === b) continue;
      shared = sharedKeywords(a, b);
    }
    if (shared.length === 0) {
      a = EMOJI_DATA[0]; b = EMOJI_DATA[1];
      shared = sharedKeywords(a, b);
    }
    state.falling.push(makeFaller(a.emoji, canvas.width * 0.35));
    state.falling.push(makeFaller(b.emoji, canvas.width * 0.65));
    state.targetKeywords = shared;
  }
}

function makeFaller(emoji, x) {
  return { emoji, x, y: -state.emojiSize };
}

function updateScoreHUD() {
  scoreEl.textContent = state.score;
}

function spawnExplosion(x, y) {
  const PARTICLE_COUNT = 18;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    state.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 30 + Math.random() * 15,
      maxLife: 45,
      size: 3 + Math.random() * 4,
    });
  }
  state.shake = 12;
}

function destroyBarrierAt(faller) {
  const hit = state.barriers.find(b => b.alive && faller.x >= b.x && faller.x < b.x + b.w)
    || state.barriers.find(b => b.alive);
  if (hit) hit.alive = false;
  spawnExplosion(faller.x, canvas.height - BARRIER_HEIGHT / 2);

  missSound.currentTime = 0;
  missSound.play().catch(() => {});
  playBoom();

  state.lives = state.barriers.filter(b => b.alive).length;
  livesEl.textContent = state.lives;
}

function handleMiss(faller) {
  destroyBarrierAt(faller);
  if (state.lives <= 0) {
    endGame();
  } else {
    spawnRound();
  }
}

function handleCorrect() {
  correctSound.currentTime = 0;
  correctSound.play().catch(() => {});
  playDing();
  state.score += state.level;
  updateScoreHUD();
  spawnRound();
}

function checkInput(value) {
  // Single input box — used for Levels 1 and 3 only. Level 2 uses the
  // two dual-input boxes below instead.
  if (state.level === 2) return false;
  const guess = value.trim().toLowerCase();
  if (!guess) return false;
  const hit = state.targetKeywords.some(k => k.toLowerCase() === guess);
  if (hit) {
    input.value = "";
    handleCorrect();
    return true;
  }
  return false;
}

input.addEventListener("input", () => checkInput(input.value));
input.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const guess = input.value.trim().toLowerCase();
  if (!guess) return;
  const result = checkInput(input.value);
  if (result === false) playBuzz();
});

function checkDualInput(el) {
  if (state.level !== 2 || el.disabled) return false;
  const guess = el.value.trim().toLowerCase();
  if (!guess) return false;

  const match = state.targetKeywords.find(
    k => k.toLowerCase() === guess && !state.foundKeywords.includes(k)
  );
  if (!match) return false;

  state.foundKeywords.push(match);
  el.value = "";
  el.disabled = true;
  el.classList.add("solved");

  correctSound.currentTime = 0;
  correctSound.play().catch(() => {});
  playDing();

  if (state.foundKeywords.length >= LEVEL2_REQUIRED) {
    handleCorrect(); // two distinct keywords found — round clear
    return true;
  }

  // one box just locked — move focus to whichever box is still open
  const other = el === inputA ? inputB : inputA;
  if (!other.disabled) other.focus();
  return "partial";
}

function resetDualInputs() {
  [inputA, inputB].forEach(el => {
    el.value = "";
    el.disabled = false;
    el.classList.remove("solved");
  });
}

[inputA, inputB].forEach(el => {
  el.addEventListener("input", () => checkDualInput(el));
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || el.disabled) return;
    const guess = el.value.trim().toLowerCase();
    if (!guess) return;
    const stillValid = state.targetKeywords.some(
      k => k.toLowerCase() === guess && !state.foundKeywords.includes(k)
    );
    if (!stillValid) playBuzz();
  });
});

function drawBarriers() {
  for (const b of state.barriers) {
    if (!b.alive) continue;
    const padding = 10;
    const baseW = b.w - padding * 2;
    const x = b.x + padding;
    const y = canvas.height - BARRIER_HEIGHT;

    ctx.fillStyle = "#00A896";
    // wide pedestal
    ctx.fillRect(x, y + 18, baseW, BARRIER_HEIGHT - 18);
    // narrower turret block on top
    ctx.fillRect(x + baseW * 0.22, y + 4, baseW * 0.56, 18);
    // small peak
    ctx.fillRect(x + baseW * 0.4, y, baseW * 0.2, 8);

    // dark outline for definition
    ctx.strokeStyle = "#10403a";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y + 18, baseW, BARRIER_HEIGHT - 18);
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const alpha = Math.max(p.life / p.maxLife, 0);
    ctx.fillStyle = `rgba(255, 107, 107, ${alpha})`;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
}

function updateParticles() {
  state.particles = state.particles.filter(p => p.life > 0);
  for (const p of state.particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.25; // gravity
    p.life -= 1;
  }
}

function tick() {
  if (!state.running) return;

  ctx.save();
  if (state.shake > 0) {
    const dx = (Math.random() - 0.5) * state.shake;
    const dy = (Math.random() - 0.5) * state.shake;
    ctx.translate(dx, dy);
    state.shake -= 1;
  }

  ctx.clearRect(-20, -20, canvas.width + 40, canvas.height + 40);

  drawBarriers();

  let landed = null;
  for (const f of state.falling) {
    f.y += state.fallSpeed * (canvas.height / 600);
    ctx.font = `${state.emojiSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(f.emoji, f.x, f.y);
    if (f.y + state.emojiSize / 2 > canvas.height - BARRIER_HEIGHT) landed = f;
  }

  // Safety net: if the player already typed a correct answer this exact
  // frame, honor it instead of treating simultaneous impact as a miss.
  if (landed) {
    if (state.level === 2) {
      checkDualInput(inputA);
      checkDualInput(inputB);
      if (state.foundKeywords.length >= LEVEL2_REQUIRED) landed = null;
    } else {
      const result = checkInput(input.value);
      if (result === true) landed = null;
    }
  }

  updateParticles();
  drawParticles();

  ctx.restore();

  if (landed) {
    handleMiss(landed);
  }

  if (state.running) requestAnimationFrame(tick);
}

function startLevel(level) {
  state.level = level;
  state.score = 0;
  state.lives = MAX_LIVES;
  state.particles = [];
  state.shake = 0;
  state.running = true;
  updateScoreHUD();
  resizeCanvas();
  state.barriers.forEach(b => b.alive = true);
  livesEl.textContent = MAX_LIVES;
  levelSelect.classList.add("hidden");
  gameOverScreen.classList.add("hidden");

  if (level === 2) {
    input.classList.add("hidden");
    dualInputRow.classList.remove("hidden");
  } else {
    input.classList.remove("hidden");
    dualInputRow.classList.add("hidden");
  }

  spawnRound();
  requestAnimationFrame(tick);
}

function endGame() {
  state.running = false;
  finalScoreEl.textContent = state.score;
  gameOverScreen.classList.remove("hidden");
}

levelButtons.forEach(btn => {
  btn.addEventListener("click", () => startLevel(Number(btn.dataset.level)));
});

restartBtn.addEventListener("click", () => {
  gameOverScreen.classList.add("hidden");
  levelSelect.classList.remove("hidden");
});

resizeCanvas();
