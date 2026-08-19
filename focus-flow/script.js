const DURATIONS = { focus: 25 * 60, short: 5 * 60, long: 15 * 60 };
const RING_CIRCUMFERENCE = 2 * Math.PI * 100;
const STORAGE_KEY = 'focusflow.v1';

const els = {
  modeTabs: document.querySelectorAll('.mode-tab'),
  ring: document.getElementById('ring-progress'),
  timeDisplay: document.getElementById('time-display'),
  activeTask: document.getElementById('active-task'),
  startBtn: document.getElementById('start-btn'),
  resetBtn: document.getElementById('reset-btn'),
  skipBtn: document.getElementById('skip-btn'),
  sessionDots: document.getElementById('session-dots'),
  taskForm: document.getElementById('task-form'),
  taskInput: document.getElementById('task-input'),
  taskList: document.getElementById('task-list'),
  todaySessions: document.getElementById('today-sessions'),
  totalSessions: document.getElementById('total-sessions'),
  streakCount: document.getElementById('streak-count'),
  celebrate: document.getElementById('celebrate'),
};

els.ring.style.strokeDasharray = RING_CIRCUMFERENCE;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const defaults = {
    tasks: [],
    activeTaskId: null,
    totalSessions: 0,
    sessionsByDate: {},
    streak: 0,
    lastActiveDate: null,
    focusRoundInCycle: 0,
  };
  if (!raw) return defaults;
  try {
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

let mode = 'focus';
let secondsLeft = DURATIONS.focus;
let running = false;
let tickHandle = null;

function updateStreakDisplay() {
  els.streakCount.textContent = state.streak;
}

function recordSessionCompletion() {
  const today = todayStr();
  state.totalSessions += 1;
  state.sessionsByDate[today] = (state.sessionsByDate[today] || 0) + 1;

  if (state.lastActiveDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (state.lastActiveDate === yesterday) {
      state.streak += 1;
    } else {
      state.streak = 1;
    }
    state.lastActiveDate = today;
  }

  saveState();
  renderStats();
  updateStreakDisplay();
}

function renderStats() {
  const today = todayStr();
  els.todaySessions.textContent = state.sessionsByDate[today] || 0;
  els.totalSessions.textContent = state.totalSessions;
}

function renderSessionDots() {
  els.sessionDots.innerHTML = '';
  const filled = state.focusRoundInCycle % 4;
  for (let i = 0; i < 4; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i < filled ? ' filled' : '');
    els.sessionDots.appendChild(dot);
  }
}

function formatTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function updateRing() {
  const total = DURATIONS[mode];
  const frac = secondsLeft / total;
  els.ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - frac);
}

function updateDisplay() {
  els.timeDisplay.textContent = formatTime(secondsLeft);
  updateRing();
  document.title = running ? `${formatTime(secondsLeft)} · Focus Flow` : 'Focus Flow';
}

function setMode(newMode, resetTimer = true) {
  mode = newMode;
  els.modeTabs.forEach(tab => tab.classList.toggle('active', tab.dataset.mode === newMode));
  const colorVar = newMode === 'focus' ? '--focus' : newMode === 'short' ? '--short' : '--long';
  els.ring.style.stroke = getComputedStyle(document.documentElement).getPropertyValue(colorVar);
  if (resetTimer) {
    pause();
    secondsLeft = DURATIONS[newMode];
    updateDisplay();
  }
}

function tick() {
  secondsLeft -= 1;
  updateDisplay();
  if (secondsLeft <= 0) {
    completeSession();
  }
}

function start() {
  if (running) return;
  running = true;
  els.startBtn.textContent = 'Pause';
  tickHandle = setInterval(tick, 1000);
}

function pause() {
  running = false;
  els.startBtn.textContent = 'Start';
  clearInterval(tickHandle);
}

function reset() {
  pause();
  secondsLeft = DURATIONS[mode];
  updateDisplay();
}

function completeSession() {
  pause();

  if (mode === 'focus') {
    recordSessionCompletion();
    state.focusRoundInCycle += 1;
    if (state.activeTaskId) {
      const task = state.tasks.find(t => t.id === state.activeTaskId);
      if (task) task.pomos = (task.pomos || 0) + 1;
    }
    saveState();
    renderTasks();
    renderSessionDots();
    celebrate();
    playDing();
    const nextMode = state.focusRoundInCycle % 4 === 0 ? 'long' : 'short';
    setMode(nextMode);
  } else {
    playDing();
    setMode('focus');
  }
}

function skip() {
  pause();
  if (mode === 'focus') {
    const nextMode = state.focusRoundInCycle % 4 === 3 ? 'long' : 'short';
    setMode(nextMode);
  } else {
    setMode('focus');
  }
}

function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // audio not available, skip silently
  }
}

function celebrate() {
  const colors = ['#ff6b57', '#4fd1c5', '#7c9dff', '#4fd17f', '#ffd166'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.width = piece.style.height = 6 + Math.random() * 6 + 'px';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    piece.style.animationDelay = Math.random() * 0.3 + 's';
    els.celebrate.appendChild(piece);
    setTimeout(() => piece.remove(), 3500);
  }
}

function renderTasks() {
  els.taskList.innerHTML = '';
  if (state.tasks.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'Add a task to focus on';
    els.taskList.appendChild(hint);
  }
  state.tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.done ? ' done' : '') + (task.id === state.activeTaskId ? ' selected' : '');

    const check = document.createElement('div');
    check.className = 'task-check';
    check.textContent = task.done ? '✓' : '';
    check.addEventListener('click', (e) => {
      e.stopPropagation();
      task.done = !task.done;
      saveState();
      renderTasks();
    });

    const text = document.createElement('span');
    text.className = 'task-text';
    text.textContent = task.text;

    const pomos = document.createElement('span');
    pomos.className = 'task-pomos';
    pomos.textContent = task.pomos ? `🍅 ${task.pomos}` : '';

    const del = document.createElement('button');
    del.className = 'task-del';
    del.textContent = '✕';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.tasks = state.tasks.filter(t => t.id !== task.id);
      if (state.activeTaskId === task.id) state.activeTaskId = null;
      saveState();
      renderTasks();
      updateActiveTaskLabel();
    });

    li.addEventListener('click', () => {
      state.activeTaskId = task.id;
      saveState();
      renderTasks();
      updateActiveTaskLabel();
    });

    li.append(check, text, pomos, del);
    els.taskList.appendChild(li);
  });
}

function updateActiveTaskLabel() {
  const task = state.tasks.find(t => t.id === state.activeTaskId);
  els.activeTask.textContent = task ? `Working on: ${task.text}` : 'No task selected';
}

els.modeTabs.forEach(tab => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
});

els.startBtn.addEventListener('click', () => (running ? pause() : start()));
els.resetBtn.addEventListener('click', reset);
els.skipBtn.addEventListener('click', skip);

els.taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.taskInput.value.trim();
  if (!text) return;
  const task = { id: Date.now().toString(), text, done: false, pomos: 0 };
  state.tasks.push(task);
  state.activeTaskId = task.id;
  saveState();
  els.taskInput.value = '';
  renderTasks();
  updateActiveTaskLabel();
});

setMode('focus', false);
secondsLeft = DURATIONS.focus;
updateDisplay();
renderTasks();
renderStats();
renderSessionDots();
updateStreakDisplay();
updateActiveTaskLabel();
