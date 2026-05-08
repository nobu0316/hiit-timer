const phaseLabel = document.getElementById("phaseLabel");
const timeLeft = document.getElementById("timeLeft");
const setInfo = document.getElementById("setInfo");
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const resetButton = document.getElementById("resetButton");
const soundToggle = document.getElementById("soundToggle");
const wakeLockStatus = document.getElementById("wakeLockStatus");
const clearHistoryButton = document.getElementById("clearHistoryButton");
const latestDateStat = document.getElementById("latestDateStat");
const daysSinceStat = document.getElementById("daysSinceStat");
const monthlyCountStat = document.getElementById("monthlyCountStat");
const monthlyTargetStats = document.getElementById("monthlyTargetStats");
const targetButtons = Array.from(document.querySelectorAll(".target-button"));
const historyList = document.getElementById("historyList");
const emptyHistory = document.getElementById("emptyHistory");

const inputs = {
  work: document.getElementById("workInput"),
  rest: document.getElementById("restInput"),
  sets: document.getElementById("setsInput"),
  countdown: document.getElementById("countdownInput")
};

const PHASES = {
  idle: "待機中",
  countdown: "開始前",
  work: "運動中",
  rest: "休憩中",
  complete: "完了"
};

const HISTORY_STORAGE_KEY = "hiitTimerHistory";
const TARGET_STORAGE_KEY = "hiitTimerLastTarget";
const TARGET_OPTIONS = ["全身", "脚", "腹筋", "胸・腕", "背中", "体幹", "有酸素寄り", "その他"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let timerId = null;
let phase = "idle";
let currentSet = 0;
let totalSets = 0;
let secondsLeft = 0;
let paused = false;
let audioContext = null;
let wakeLock = null;
let wakeLockRequestId = 0;
let activeSessionSettings = null;
let history = loadHistory();
let selectedBodyPart = loadSelectedTarget();
let lastTargetPointerTime = 0;

function getSettings() {
  return {
    work: clampNumber(inputs.work.value, 1, 3600),
    rest: clampNumber(inputs.rest.value, 0, 3600),
    sets: clampNumber(inputs.sets.value, 1, 99),
    countdown: clampNumber(inputs.countdown.value, 0, 300),
    target: selectedBodyPart
  };
}

function loadSelectedTarget() {
  const savedTarget = localStorage.getItem(TARGET_STORAGE_KEY);

  return TARGET_OPTIONS.includes(savedTarget) ? savedTarget : TARGET_OPTIONS[0];
}

function selectTarget(target) {
  if (!TARGET_OPTIONS.includes(target) || isTimerRunning()) {
    return;
  }

  selectedBodyPart = target;
  localStorage.setItem(TARGET_STORAGE_KEY, selectedBodyPart);
  renderTargetButtons();
}

function renderTargetButtons() {
  targetButtons.forEach((button) => {
    const isSelected = button.dataset.target === selectedBodyPart;

    button.classList.toggle("is-selected", isSelected);
    button.classList.toggle("selected", isSelected);
    button.classList.toggle("active", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function handleTargetButtonPress(event) {
  const button = event.currentTarget;

  if (button.disabled || isTimerRunning()) {
    return;
  }

  if (event.type === "pointerdown") {
    lastTargetPointerTime = Date.now();
    event.preventDefault();
  } else if (Date.now() - lastTargetPointerTime < 500) {
    return;
  }

  selectTarget(button.dataset.target);
}

function clampNumber(value, min, max) {
  const number = Number.parseInt(value, 10);

  if (Number.isNaN(number)) {
    return min;
  }

  return Math.min(Math.max(number, min), max);
}

function normalizeInputs() {
  const settings = getSettings();

  inputs.work.value = settings.work;
  inputs.rest.value = settings.rest;
  inputs.sets.value = settings.sets;
  inputs.countdown.value = settings.countdown;

  return settings;
}

function formatSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTotalSeconds(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function render() {
  phaseLabel.textContent = PHASES[phase];
  timeLeft.textContent = formatSeconds(secondsLeft);
  setInfo.textContent = `セット ${currentSet} / ${totalSets}`;
  pauseButton.textContent = paused ? "再開" : "一時停止";
  pauseButton.disabled = phase === "idle" || phase === "complete";
  startButton.disabled = phase !== "idle" && phase !== "complete";

  document.body.classList.remove("is-countdown", "is-work", "is-rest", "is-complete");

  if (phase !== "idle") {
    document.body.classList.add(`is-${phase}`);
  }
}

function setInputsDisabled(disabled) {
  Object.values(inputs).forEach((input) => {
    input.disabled = disabled;
  });
  targetButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function startTimer() {
  resetTimer();

  const settings = normalizeInputs();
  localStorage.setItem(TARGET_STORAGE_KEY, settings.target);
  activeSessionSettings = settings;
  totalSets = settings.sets;
  currentSet = settings.countdown > 0 ? 0 : 1;
  secondsLeft = settings.countdown > 0 ? settings.countdown : settings.work;
  phase = settings.countdown > 0 ? "countdown" : "work";
  paused = false;

  setInputsDisabled(true);
  render();
  requestWakeLock();
  playPhaseSound();
  timerId = window.setInterval(tick, 1000);
}

function tick() {
  if (paused) {
    return;
  }

  if (secondsLeft > 1) {
    secondsLeft -= 1;
    render();

    if (phase === "countdown") {
      playPhaseSound();
    }

    return;
  }

  moveToNextPhase();
}

function moveToNextPhase() {
  const settings = activeSessionSettings || getSettings();

  if (phase === "countdown") {
    phase = "work";
    currentSet = 1;
    secondsLeft = settings.work;
    render();
    playPhaseSound();
  } else if (phase === "work") {
    if (currentSet >= totalSets) {
      completeTimer();
      return;
    }

    if (settings.rest === 0) {
      currentSet += 1;
      phase = "work";
      secondsLeft = settings.work;
      render();
      playPhaseSound();
    } else {
      phase = "rest";
      secondsLeft = settings.rest;
      render();
      playPhaseSound();
    }
  } else if (phase === "rest") {
    currentSet += 1;
    phase = "work";
    secondsLeft = settings.work;
    render();
    playPhaseSound();
  }
}

function togglePause() {
  if (phase === "idle" || phase === "complete") {
    return;
  }

  paused = !paused;
  render();
}

function completeTimer() {
  const completedSettings = activeSessionSettings || getSettings();

  clearTimer();
  releaseWakeLock();
  saveCompletedWorkout(completedSettings);
  activeSessionSettings = null;
  phase = "complete";
  secondsLeft = 0;
  paused = false;
  setInputsDisabled(false);
  render();
  playPhaseSound();
}

function resetTimer() {
  clearTimer();
  releaseWakeLock();
  activeSessionSettings = null;
  phase = "idle";
  currentSet = 0;
  totalSets = 0;
  secondsLeft = 0;
  paused = false;
  setInputsDisabled(false);
  render();
}

function clearTimer() {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function isTimerRunning() {
  return phase === "countdown" || phase === "work" || phase === "rest";
}

function loadHistory() {
  try {
    const savedHistory = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");

    if (!Array.isArray(savedHistory)) {
      return [];
    }

    return savedHistory
      .filter((entry) => entry && entry.completedAt && entry.work && Number.isInteger(entry.sets))
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  } catch (error) {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function saveCompletedWorkout(settings) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    completedAt: new Date().toISOString(),
    target: settings.target,
    work: settings.work,
    rest: settings.rest,
    sets: settings.sets,
    total: (settings.work + settings.rest) * settings.sets
  };

  history = [entry, ...history];
  saveHistory();
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = "";

  history.forEach((entry) => {
    const item = document.createElement("li");
    item.className = "history-item";

    const text = document.createElement("span");
    const target = entry.target || TARGET_OPTIONS[0];
    text.textContent = `${formatDateTime(entry.completedAt)}　${target}　${entry.work}秒/${entry.rest}秒 × ${entry.sets}セット　合計${formatTotalSeconds(entry.total)}`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-history-button";
    deleteButton.dataset.id = entry.id;
    deleteButton.textContent = "削除";
    deleteButton.setAttribute("aria-label", `${formatDateTime(entry.completedAt)}の実績を削除`);

    item.append(text, deleteButton);
    historyList.append(item);
  });

  emptyHistory.hidden = history.length > 0;
  clearHistoryButton.disabled = history.length === 0;
  renderStats();
}

function renderStats() {
  if (history.length === 0) {
    latestDateStat.textContent = "-";
    daysSinceStat.textContent = "-";
    monthlyCountStat.textContent = "0回";
    monthlyTargetStats.innerHTML = "";
    return;
  }

  const latestDate = new Date(history[0].completedAt);
  const previousDate = history[1] ? new Date(history[1].completedAt) : null;
  const now = new Date();
  const monthlyEntries = history.filter((entry) => {
    const completedAt = new Date(entry.completedAt);

    return completedAt.getFullYear() === now.getFullYear()
      && completedAt.getMonth() === now.getMonth();
  });

  latestDateStat.textContent = formatDateTime(latestDate);
  daysSinceStat.textContent = previousDate ? formatDaysSince(previousDate, latestDate) : "-";
  monthlyCountStat.textContent = `${monthlyEntries.length}回`;
  renderMonthlyTargetStats(monthlyEntries);
}

function renderMonthlyTargetStats(monthlyEntries) {
  monthlyTargetStats.innerHTML = "";

  const counts = monthlyEntries.reduce((result, entry) => {
    const target = TARGET_OPTIONS.includes(entry.target) ? entry.target : TARGET_OPTIONS[0];

    result[target] = (result[target] || 0) + 1;
    return result;
  }, {});

  TARGET_OPTIONS.forEach((target) => {
    if (!counts[target]) {
      return;
    }

    const item = document.createElement("span");
    item.className = "target-stat";
    item.textContent = `${target}: ${counts[target]}回`;
    monthlyTargetStats.append(item);
  });
}

function formatDaysSince(previousDate, latestDate) {
  const previousDay = new Date(previousDate.getFullYear(), previousDate.getMonth(), previousDate.getDate());
  const latestDay = new Date(latestDate.getFullYear(), latestDate.getMonth(), latestDate.getDate());
  const days = Math.round((latestDay - previousDay) / MS_PER_DAY);

  if (days === 0) {
    return "同日";
  }

  return `${days}日ぶり`;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    showWakeLockWarning();
    return;
  }

  if (wakeLock || document.visibilityState !== "visible") {
    return;
  }

  const requestId = ++wakeLockRequestId;

  try {
    const requestedWakeLock = await navigator.wakeLock.request("screen");

    if (requestId !== wakeLockRequestId || !isTimerRunning()) {
      await requestedWakeLock.release();
      return;
    }

    wakeLock = requestedWakeLock;
    wakeLock.addEventListener("release", () => {
      if (wakeLock === requestedWakeLock) {
        wakeLock = null;
      }
    });
    hideWakeLockWarning();
  } catch (error) {
    showWakeLockWarning();
  }
}

async function releaseWakeLock() {
  wakeLockRequestId += 1;

  if (!wakeLock) {
    return;
  }

  const currentWakeLock = wakeLock;
  wakeLock = null;

  try {
    await currentWakeLock.release();
  } catch (error) {
    // The browser may already have released the lock.
  }
}

function showWakeLockWarning() {
  wakeLockStatus.hidden = false;
}

function hideWakeLockWarning() {
  wakeLockStatus.hidden = true;
}

function playPhaseSound() {
  if (phase === "countdown" && secondsLeft <= 3 && secondsLeft >= 1) {
    playPattern([{ frequency: 980, duration: 0.1 }]);
  } else if (phase === "work") {
    playPattern([
      { frequency: 1120, duration: 0.38 },
      { frequency: 1120, duration: 0.38 }
    ]);
  } else if (phase === "rest") {
    playPattern([
      { frequency: 420, duration: 0.14 },
      { frequency: 420, duration: 0.14 }
    ]);
  } else if (phase === "complete") {
    playPattern([
      { frequency: 1040, duration: 0.28 },
      { frequency: 520, duration: 0.28 },
      { frequency: 1040, duration: 0.36 }
    ]);
  }
}

function playPattern(beeps) {
  if (!soundToggle.checked) {
    return;
  }

  const context = getAudioContext();

  if (!context) {
    return;
  }

  let startOffset = 0;

  beeps.forEach((beep) => {
    playTone(context, beep.frequency, beep.duration, startOffset);
    startOffset += beep.duration + 0.12;
  });
}

function playTone(context, frequency, duration, startOffset) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startTime = context.currentTime + startOffset;
  const endTime = startTime + duration;

  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.22, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, endTime);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startTime);
  oscillator.stop(endTime);
}

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume();
  }

  return audioContext;
}

startButton.addEventListener("click", startTimer);
pauseButton.addEventListener("click", togglePause);
resetButton.addEventListener("click", resetTimer);
targetButtons.forEach((button) => {
  button.addEventListener("pointerdown", handleTargetButtonPress);
  button.addEventListener("click", handleTargetButtonPress);
});
clearHistoryButton.addEventListener("click", () => {
  history = [];
  saveHistory();
  renderHistory();
});

historyList.addEventListener("click", (event) => {
  const deleteButton = event.target.closest(".delete-history-button");

  if (!deleteButton) {
    return;
  }

  history = history.filter((entry) => entry.id !== deleteButton.dataset.id);
  saveHistory();
  renderHistory();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isTimerRunning()) {
    requestWakeLock();
  }
});

Object.values(inputs).forEach((input) => {
  input.addEventListener("change", () => {
    normalizeInputs();
  });
});

renderTargetButtons();
render();
renderHistory();
