(() => {
  const STORAGE_KEY = "gym-rest-seconds";
  const DEFAULT_SECONDS = 90;

  const clockEl = document.getElementById("clock");
  const statusEl = document.getElementById("status");
  const hintEl = document.getElementById("hint");
  const ringEl = document.getElementById("ring");
  const setEl = document.getElementById("set-number");
  const toggleEl = document.getElementById("toggle");
  const skipEl = document.getElementById("skip");
  const presets = [...document.querySelectorAll(".preset")];

  const state = {
    durationMs: loadDuration() * 1000,
    remainingMs: loadDuration() * 1000,
    running: false,
    deadline: 0,
    setNumber: 1,
    finished: false,
    raf: 0,
    wakeLock: null,
  };

  function loadDuration() {
    const raw = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(raw) && raw >= 5 ? raw : DEFAULT_SECONDS;
  }

  function saveDuration(seconds) {
    localStorage.setItem(STORAGE_KEY, String(seconds));
  }

  function format(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function setDuration(seconds, { restart = false } = {}) {
    const next = Math.max(5, Math.min(30 * 60, Math.round(seconds)));
    state.durationMs = next * 1000;
    saveDuration(next);
    if (!state.running || restart) {
      state.remainingMs = state.durationMs;
      state.finished = false;
      if (state.running) {
        state.deadline = Date.now() + state.remainingMs;
      }
    }
    markPreset(next);
    render();
  }

  function markPreset(seconds) {
    presets.forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.seconds) === seconds);
    });
  }

  function render() {
    const progress =
      state.durationMs === 0
        ? 0
        : Math.max(0, Math.min(100, (state.remainingMs / state.durationMs) * 100));
    ringEl.style.setProperty("--progress", `${progress}%`);
    clockEl.textContent = format(state.remainingMs);
    setEl.textContent = String(state.setNumber);

    ringEl.classList.toggle("is-urgent", state.running && state.remainingMs <= 10_000);
    ringEl.classList.toggle("is-done", state.finished);

    if (state.finished) {
      statusEl.textContent = "Час підходу";
      hintEl.textContent = "Можна працювати";
      toggleEl.textContent = "Ще раз";
      toggleEl.classList.remove("is-pause");
      skipEl.disabled = true;
      return;
    }

    if (state.running) {
      statusEl.textContent = "Відпочинок";
      hintEl.textContent = "Екран не засинає, поки йде таймер";
      toggleEl.textContent = "Пауза";
      toggleEl.classList.add("is-pause");
      skipEl.disabled = false;
      return;
    }

    statusEl.textContent = "Готовий";
    hintEl.textContent = "Натисни старт після підходу";
    toggleEl.textContent = "Старт";
    toggleEl.classList.remove("is-pause");
    skipEl.disabled = state.remainingMs === state.durationMs;
  }

  function tick() {
    if (!state.running) return;
    state.remainingMs = Math.max(0, state.deadline - Date.now());
    render();
    if (state.remainingMs <= 0) {
      finish();
      return;
    }
    state.raf = requestAnimationFrame(tick);
  }

  async function keepAwake(on) {
    try {
      if (on) {
        state.wakeLock = await navigator.wakeLock?.request("screen");
      } else {
        await state.wakeLock?.release();
        state.wakeLock = null;
      }
    } catch {
      /* wake lock is optional */
    }
  }

  function beep() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [0, 0.22, 0.48].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = i === 2 ? 880 : 698;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t = now + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }

  function finish() {
    state.running = false;
    state.finished = true;
    state.remainingMs = 0;
    cancelAnimationFrame(state.raf);
    keepAwake(false);
    beep();
    navigator.vibrate?.([180, 70, 180, 70, 320]);
    state.setNumber += 1;
    render();
  }

  function start() {
    if (state.finished || state.remainingMs <= 0) {
      state.remainingMs = state.durationMs;
      state.finished = false;
    }
    state.running = true;
    state.deadline = Date.now() + state.remainingMs;
    keepAwake(true);
    tick();
  }

  function pause() {
    state.running = false;
    cancelAnimationFrame(state.raf);
    state.remainingMs = Math.max(0, state.deadline - Date.now());
    keepAwake(false);
    render();
  }

  function skip() {
    state.remainingMs = 0;
    finish();
  }

  function nudge(deltaSeconds) {
    const current = Math.ceil(state.remainingMs / 1000);
    const next = Math.max(5, current + deltaSeconds);
    if (state.running) {
      state.remainingMs = next * 1000;
      state.deadline = Date.now() + state.remainingMs;
      state.durationMs = Math.max(state.durationMs, state.remainingMs);
      saveDuration(Math.round(state.durationMs / 1000));
      render();
      return;
    }
    setDuration(next);
  }

  toggleEl.addEventListener("click", () => {
    if (state.running) pause();
    else start();
  });
  skipEl.addEventListener("click", skip);
  document.getElementById("plus-15").addEventListener("click", () => nudge(15));
  document.getElementById("minus-15").addEventListener("click", () => nudge(-15));
  document.getElementById("reset-sets").addEventListener("click", () => {
    state.setNumber = 1;
    render();
  });
  presets.forEach((btn) => {
    btn.addEventListener("click", () => {
      setDuration(Number(btn.dataset.seconds), { restart: true });
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.running) {
      keepAwake(true);
    }
  });

  markPreset(Math.round(state.durationMs / 1000));
  render();
})();
