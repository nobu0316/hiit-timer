const phaseLabel = document.getElementById("phaseLabel");
const timeLeft = document.getElementById("timeLeft");
const setInfo = document.getElementById("setInfo");
const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const resetButton = document.getElementById("resetButton");
const soundToggle = document.getElementById("soundToggle");
const wakeLockStatus = document.getElementById("wakeLockStatus");

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

let timerId = null;
let phase = "idle";
let currentSet = 0;
let totalSets = 0;
let secondsLeft = 0;
let paused = false;
let audioContext = null;
let wakeLock = null;
let wakeLockRequestId = 0;

function getSettings() {
  return {
    work: clampNumber(inputs.work.value, 1, 3600),
    rest: clampNumber(inputs.rest.value, 0, 3600),
    sets: clampNumber(inputs.sets.value, 1, 99),
    countdown: clampNumber(inputs.countdown.value, 0, 300)
  };
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
}

function startTimer() {
  resetTimer();

  const settings = normalizeInputs();
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
  const settings = getSettings();

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
  clearTimer();
  releaseWakeLock();
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

render();
