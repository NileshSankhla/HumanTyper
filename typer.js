(() => {
  if (window.__humanTyperInstalled) {
    return;
  }

  window.__humanTyperInstalled = true;

  const state = {
    status: "ready",
    paused: false,
    stopped: false,
    wpm: 65,
    mode: "high",
    timingMode: "speed",
    targetDurationMs: 0,
    deadline: 0,
    pausedAt: 0,
    totalCharacters: 0,
    completedCharacters: 0,
    startedAt: 0,
    errorMessage: "",
  };

  let runId = 0;

  function handleMessage(message, _sender, sendResponse) {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === "start") {
      if (typeof message.text !== "string" || message.text.length === 0) {
        sendResponse({ ok: false, error: "No text was supplied." });
        return false;
      }

      if (!Number.isFinite(message.wpm) || message.wpm <= 0) {
        sendResponse({ ok: false, error: "The typing speed is invalid." });
        return false;
      }
      if (!findEditableElement()) {
        sendResponse({
          ok: false,
          error: "Click inside the essay editor before starting.",
        });
        return false;
      }

      state.wpm = message.wpm;
      state.mode = message.mode;
      state.timingMode = message.timingMode === "duration" ? "duration" : "speed";
      if (
        state.timingMode === "duration" &&
        (!Number.isFinite(message.durationSeconds) || message.durationSeconds <= 0)
      ) {
        sendResponse({ ok: false, error: "The custom completion time is invalid." });
        return false;
      }
      state.targetDurationMs =
        state.timingMode === "duration" ? message.durationSeconds * 1000 : 0;
      state.totalCharacters = [...message.text].length;
      state.completedCharacters = 0;
      state.startedAt = 0;
      state.deadline = 0;
      state.errorMessage = "";
      state.paused = false;
      state.stopped = false;
      state.status = "countdown";
      const currentRun = ++runId;

      sendResponse({ ok: true, state: snapshot() });
      void typeText(message.text, currentRun);
      return false;
    }

    if (message.type === "pause") {
      state.paused = Boolean(message.paused);
      if (state.timingMode === "duration") {
        if (state.paused) {
          state.pausedAt = Date.now();
        } else if (state.pausedAt) {
          state.deadline += Date.now() - state.pausedAt;
          state.pausedAt = 0;
        }
      }
      if (state.status === "typing" || state.status === "paused") {
        state.status = state.paused ? "paused" : "typing";
      }
      sendResponse({ ok: true, state: snapshot() });
      return false;
    }

    if (message.type === "setSpeed") {
      if (!Number.isFinite(message.wpm) || message.wpm <= 0) {
        sendResponse({ ok: false, error: "The typing speed is invalid." });
        return false;
      }
      state.wpm = message.wpm;
      sendResponse({ ok: true, state: snapshot() });
      return false;
    }

    if (message.type === "stop") {
      state.stopped = true;
      state.paused = false;
      state.status = "stopped";
      ++runId;
      sendResponse({ ok: true, state: snapshot() });
      return false;
    }

    if (message.type === "getState") {
      sendResponse({ ok: true, state: snapshot() });
      return false;
    }

    return false;
  }

  chrome.runtime.onMessage.addListener(handleMessage);
  window.__humanTyperMessage = (message) =>
    new Promise((resolve) => {
      handleMessage(message, null, resolve);
    });

  function snapshot() {
    return {
      status: state.status,
      paused: state.paused,
      stopped: state.stopped,
      errorMessage: state.errorMessage,
      wpm: state.wpm,
      timingMode: state.timingMode,
      targetDurationSeconds: state.targetDurationMs / 1000,
      totalCharacters: state.totalCharacters,
      completedCharacters: state.completedCharacters,
      remainingCharacters: Math.max(
        0,
        state.totalCharacters - state.completedCharacters,
      ),
      elapsedSeconds: state.startedAt
        ? Math.max(0, Math.round((Date.now() - state.startedAt) / 1000))
        : 0,
      remainingSeconds: estimateRemainingSeconds(),
      currentWpm: estimateCurrentWpm(),
      editable: Boolean(findEditableElement()),
    };
  }

  async function typeText(text, currentRun) {
    await delay(3000);

    if (!isCurrentRun(currentRun)) {
      return;
    }

    const element = findEditableElement();
    if (!isEditable(element)) {
      state.status = "error";
      state.errorMessage =
        "Click inside the target text box before the countdown ends.";
      return;
    }

    state.startedAt = Date.now();
    state.deadline = state.targetDurationMs
      ? state.startedAt + state.targetDurationMs
      : 0;
    state.status = "typing";
    for (const char of text) {
      if (!isCurrentRun(currentRun)) {
        return;
      }

      while (state.paused && isCurrentRun(currentRun)) {
        await delay(100);
      }

      if (!isCurrentRun(currentRun)) {
        return;
      }

      if (
        state.timingMode !== "duration" &&
        state.mode === "high" &&
        /[a-z]/i.test(char) &&
        Math.random() < 0.015
      ) {
        insertText(element, randomLetter());
        await delay(
          state.timingMode === "duration"
            ? adaptiveCharacterDelay() * 0.8
            : characterDelay(0.8),
        );
        deleteLastCharacter(element);
        await delay(
          state.timingMode === "duration"
            ? adaptiveCharacterDelay() * 1.2
            : characterDelay(1.2),
        );
      }

      insertText(element, char);

      state.completedCharacters += 1;

      if (state.timingMode === "duration") {
        await waitUntil(
          state.startedAt +
            (state.completedCharacters / state.totalCharacters) *
              state.targetDurationMs,
        );
        continue;
      }

      let currentDelay = characterDelay();
      if (state.mode !== "none") {
        currentDelay *= 1 + (Math.random() * 0.7 - 0.35);
        if ([".", "?", "!", ";"].includes(char)) {
          currentDelay += 500 + Math.random() * 500;
        } else if ([",", "-", "\n"].includes(char)) {
          currentDelay += 200 + Math.random() * 300;
        }
      }
      await delay(currentDelay);
    }

    if (isCurrentRun(currentRun)) {
      state.status = "complete";
    }
  }

  function characterDelay(multiplier = 1) {
    return (60000 / state.wpm / 5) * multiplier;
  }

  function adaptiveCharacterDelay() {
    const remaining = Math.max(
      1,
      state.totalCharacters - state.completedCharacters,
    );
    const remainingMs = Math.max(0, state.deadline - Date.now());
    return remainingMs / remaining;
  }

  async function waitUntil(timestamp) {
    const remainingMs = timestamp - Date.now();
    if (remainingMs > 0) {
      await delay(remainingMs);
    }
  }

  function estimateRemainingSeconds() {
    if (
      !state.wpm ||
      state.status === "complete" ||
      state.status === "stopped"
    ) {
      return 0;
    }
    if (state.timingMode === "duration") {
      return Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    }
    return Math.ceil(((state.totalCharacters - state.completedCharacters) * 12) / state.wpm);
  }

  function estimateCurrentWpm() {
    if (state.timingMode === "duration" && state.deadline) {
      if (state.status === "complete" && state.startedAt) {
        const elapsedMs = Math.max(1, Date.now() - state.startedAt);
        return Math.round((state.totalCharacters * 12000) / elapsedMs);
      }
      const delay = adaptiveCharacterDelay();
      return Math.round(12000 / delay);
    }
    return state.wpm;
  }

  function isCurrentRun(currentRun) {
    return currentRun === runId && !state.stopped;
  }

  function isEditable(element) {
    const tagName = element?.tagName?.toLowerCase();
    const inputType =
      tagName === "input" ? (element.type || "").toLowerCase() : "";
    return (
      element &&
        (tagName === "input" ||
          tagName === "textarea" ||
          element.isContentEditable) &&
        inputType !== "button" &&
        inputType !== "checkbox" &&
        inputType !== "file" &&
        inputType !== "hidden" &&
        inputType !== "image" &&
        inputType !== "radio" &&
        inputType !== "range" &&
        inputType !== "reset" &&
        inputType !== "submit"
    );
  }

  function findEditableElement() {
    const active = document.activeElement;
    if (isEditable(active)) {
      return active;
    }

    if (active?.tagName?.toLowerCase() === "iframe") {
      try {
        const frameActive = active.contentDocument?.activeElement;
        if (isEditable(frameActive)) {
          return frameActive;
        }
        const frameEditable = active.contentDocument?.querySelector(
          '[contenteditable="true"], [contenteditable=""], textarea',
        );
        if (isEditable(frameEditable)) {
          return frameEditable;
        }
      } catch {
        return null;
      }
    }

    const editable = document.querySelector(
      '[contenteditable="true"], [contenteditable=""], textarea',
    );
    return isEditable(editable) ? editable : null;
  }

  function insertText(element, text) {
    if (element.isContentEditable) {
      const ownerDocument = element.ownerDocument;
      ownerDocument.execCommand("insertText", false, text);
      dispatchInput(element);
      return;
    }

    const prototype = Object.getPrototypeOf(element);
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (valueSetter) {
      valueSetter.call(element, element.value + text);
    } else {
      element.value += text;
    }
    dispatchInput(element);
  }

  function deleteLastCharacter(element) {
    if (element.isContentEditable) {
      const ownerDocument = element.ownerDocument;
      ownerDocument.execCommand("delete", false);
      dispatchInput(element);
      return;
    }

    const prototype = Object.getPrototypeOf(element);
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    const value = element.value.slice(0, -1);
    if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
    dispatchInput(element);
  }

  function dispatchInput(element) {
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function randomLetter() {
    return "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
})();
