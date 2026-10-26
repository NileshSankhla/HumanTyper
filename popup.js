const essay = document.getElementById("essay");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const statusText = document.getElementById("statusText");
const speedSelect = document.getElementById("speed");
const customSpeedGroup = document.getElementById("customSpeedGroup");
const customSpeedInput = document.getElementById("customSpeed");
const timingMode = document.getElementById("timingMode");
const durationGroup = document.getElementById("durationGroup");
const durationInput = document.getElementById("duration");
const progressText = document.getElementById("progressText");
const timeText = document.getElementById("timeText");
const currentSpeedText = document.getElementById("currentSpeedText");
const messageText = document.getElementById("messageText");
let statePoll;
let currentState = { status: "ready", paused: false };

essay.addEventListener("input", () => {
  document.getElementById("charCount").innerText =
    `Characters: ${essay.value.length}`;
});

speedSelect.addEventListener("change", async () => {
  customSpeedGroup.hidden = speedSelect.value !== "custom";
  if (
    speedSelect.value === "custom" ||
    !["countdown", "typing", "paused"].includes(currentState.status)
  ) {
    return;
  }
  try {
    const tab = await getActiveTab();
    const response = await sendToTabWithInjection(tab.id, {
      type: "setSpeed",
      wpm: Number(speedSelect.value),
    });
    if (!response.ok) {
      throw new Error(response.error || "Could not change typing speed.");
    }
    renderState(response.state);
  } catch (error) {
    renderError(error);
  }
});

customSpeedInput.addEventListener("change", updateCustomSpeed);

async function updateCustomSpeed() {
  const wpm = Number(customSpeedInput.value);
  if (!Number.isFinite(wpm) || wpm < 1 || wpm > 1000) {
    showMessage("Custom WPM must be a number from 1 to 1000.");
    return;
  }

  if (!["countdown", "typing", "paused"].includes(currentState.status)) {
    return;
  }

  try {
    const tab = await getActiveTab();
    const response = await sendToTabWithInjection(tab.id, {
      type: "setSpeed",
      wpm,
    });
    if (!response.ok) {
      throw new Error(response.error || "Could not change typing speed.");
    }
    renderState(response.state);
  } catch (error) {
    renderError(error);
  }
}

timingMode.addEventListener("change", () => {
  durationGroup.hidden = timingMode.value !== "duration";
});

startBtn.addEventListener("click", async () => {
  if (!essay.value) {
    showMessage("Please paste your essay first.");
    return;
  }
  if (
    timingMode.value === "duration" &&
    (!Number.isFinite(Number(durationInput.value)) ||
      Number(durationInput.value) <= 0)
  ) {
    showMessage("Enter a custom completion time greater than zero.");
    return;
  }

  try {
    const tab = await getActiveTab();
    const response = await sendToTabWithInjection(tab.id, {
      type: "start",
      text: essay.value,
      wpm: getSelectedWpm(),
      mode: document.getElementById("humanMode").value,
      timingMode: timingMode.value,
      durationSeconds: Number(durationInput.value),
    });
    if (!response.ok) {
      throw new Error(response.error || "Could not start typing.");
    }
    renderState(response.state);
  } catch (error) {
    renderError(error);
  }
});

pauseBtn.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    const current = await sendToTabWithInjection(tab.id, { type: "getState" });
    const response = await sendToTabWithInjection(tab.id, {
      type: "pause",
      paused: !current.state.paused,
    });
    if (!response.ok) {
      throw new Error(response.error || "Could not change pause state.");
    }
    renderState(response.state);
  } catch (error) {
    renderError(error);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    const tab = await getActiveTab();
    const response = await sendToTabWithInjection(tab.id, { type: "stop" });
    if (!response.ok) {
      throw new Error(response.error || "Could not stop typing.");
    }
    renderState(response.state);
  } catch (error) {
    renderError(error);
  }
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  if (!isScriptableUrl(tab.url)) {
    throw new Error(
      "This Edge page cannot be scripted. Open a normal website with a text field.",
    );
  }
  return tab;
}

function isScriptableUrl(url) {
  return Boolean(url && /^(https?|file):\/\//i.test(url));
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response || { ok: false, error: "No response from tab." });
    });
  });
}

async function executeInEditableFrame(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["typer.js"],
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (command) => window.__humanTyperMessage?.(command),
    args: [message],
  });
  const response = results
    .map((result) => result.result)
    .find(
      (result) =>
        result?.ok &&
        (message.type === "start"
          ? result.state?.editable
          : message.type === "stop"
            ? result.state?.status === "stopped"
            : ["countdown", "typing", "paused"].includes(result.state?.status)),
    );
  if (!response) {
    throw new Error(
      "No editable text area was found. Click inside the essay editor and try again.",
    );
  }
  return response;
}

async function sendToTabWithInjection(tabId, message) {
  let lastError;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await executeInEditableFrame(tabId, message);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw lastError || new Error("The page did not accept the extension connection.");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function restoreState() {
  try {
    const tab = await getActiveTab();
    const response = await sendToTabWithInjection(tab.id, { type: "getState" });
    if (response.ok) {
      renderState(response.state);
    }
  } catch {
    renderState({ status: "ready", paused: false });
  }
}

function renderState(state) {
  currentState = state;
  showMessage(state.errorMessage || "");
  const active = ["countdown", "typing", "paused"].includes(state.status);
  startBtn.style.display = active ? "none" : "inline-block";
  pauseBtn.style.display = active ? "inline-block" : "none";
  stopBtn.style.display = active ? "inline-block" : "none";
  pauseBtn.innerText = state.paused ? "▶ Resume" : "⏸ Pause";
  const labels = {
    countdown: "Countdown...",
    typing: "Typing...",
    paused: "Paused",
    complete: "Complete",
    stopped: "Stopped",
    error: "Error",
    ready: "Ready",
  };
  statusText.innerText = `Status: ${labels[state.status] || "Ready"}`;
  const total = state.totalCharacters || 0;
  const completed = state.completedCharacters || 0;
  const progress = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  progressText.innerText = `Progress: ${progress}% (${completed}/${total})`;
  timeText.innerText =
    state.remainingSeconds > 0
      ? `Remaining: ${formatDuration(state.remainingSeconds)}`
      : "Remaining: --";
  currentSpeedText.innerText = state.currentWpm
    ? `Current: ${state.currentWpm} WPM`
    : "Current: -- WPM";
  if (state.wpm) {
    if ([...speedSelect.options].some((option) => option.value === String(state.wpm))) {
      speedSelect.value = String(state.wpm);
      customSpeedGroup.hidden = true;
    } else {
      speedSelect.value = "custom";
      customSpeedInput.value = String(state.wpm);
      customSpeedGroup.hidden = false;
    }
  }

  if (state.timingMode) {
    timingMode.value = state.timingMode;
    durationGroup.hidden = state.timingMode !== "duration";
  }
  if (active) {
    startStatePolling();
  } else {
    stopStatePolling();
  }
}

function getSelectedWpm() {
  const wpm =
    speedSelect.value === "custom"
      ? Number(customSpeedInput.value)
      : Number(speedSelect.value);
  if (!Number.isFinite(wpm) || wpm < 1 || wpm > 1000) {
    throw new Error("WPM must be a number from 1 to 1000.");
  }
  return wpm;
}

function startStatePolling() {
  if (statePoll) {
    return;
  }
  statePoll = setInterval(async () => {
    try {
      const tab = await getActiveTab();
      const response = await sendToTab(tab.id, { type: "getState" });
      if (response.ok) {
        renderState(response.state);
      }
    } catch {
      stopStatePolling();
    }
  }, 500);
}

function stopStatePolling() {
  clearInterval(statePoll);
  statePoll = undefined;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

function renderError(error) {
  renderState({ status: "error", paused: false });
  const message =
    error.message.includes("Receiving end does not exist") ||
    error.message.includes("Could not establish connection")
      ? "The target page connection was reset. Reload the target webpage and try again."
      : error.message;
  showMessage(
    `Unable to control this page: ${message} Edge blocks extensions on some ` +
      "pages, including edge:// pages, the Microsoft Add-ons store, and " +
      "browser settings.",
  );
}

function showMessage(message) {
  messageText.textContent = message;
  messageText.style.display = message ? "block" : "none";
}

restoreState();
