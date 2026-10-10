(() => {
  const STORAGE_KEY = "youtubeFocusSettings";
  const defaults = { enabled: true, cardSize: "comfortable" };
  const enabledInput = document.getElementById("enabled");
  const cardSizeInput = document.getElementById("card-size");
  const commentsButton = document.getElementById("open-comments");
  const status = document.getElementById("status");

  function showStatus(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function normalizeSettings(value) {
    return {
      enabled: typeof value?.enabled === "boolean" ? value.enabled : defaults.enabled,
      cardSize: ["compact", "comfortable", "large"].includes(value?.cardSize)
        ? value.cardSize
        : defaults.cardSize
    };
  }

  async function saveSettings() {
    const settings = {
      enabled: enabledInput.checked,
      cardSize: cardSizeInput.value
    };
    try {
      await browser.storage.local.set({ [STORAGE_KEY]: settings });
      showStatus("Settings saved.");
    } catch (error) {
      showStatus(`Could not save settings: ${error.message || error}`, "error");
    }
  }

  async function loadSettings() {
    try {
      const stored = await browser.storage.local.get(STORAGE_KEY);
      const settings = normalizeSettings(stored[STORAGE_KEY]);
      enabledInput.checked = settings.enabled;
      cardSizeInput.value = settings.cardSize;
      showStatus("Settings are ready.");
    } catch (error) {
      enabledInput.checked = defaults.enabled;
      cardSizeInput.value = defaults.cardSize;
      showStatus(`Could not load settings: ${error.message || error}`, "error");
    }
  }

  async function refreshPageStatus() {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) return;
      const pageStatus = await browser.tabs.sendMessage(tab.id, { type: "youtube-focus:get-status" });
      if (pageStatus && typeof pageStatus.active === "boolean") {
        const state = pageStatus.active ? "Focus layout is active" : "Focus layout is turned off";
        showStatus(pageStatus.commentsOpen ? `${state} · comments are open.` : `${state}.`);
      }
    } catch {
      // A YouTube tab may be loading or may have been opened before this add-on.
      // The settings remain available, and the user can refresh the page.
    }
  }

  async function openComments() {
    commentsButton.disabled = true;
    showStatus("Checking this tab…");
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/www\.youtube\.com\/watch(?:\?|$)/.test(tab.url || "")) {
        showStatus("Open a YouTube video first to show its comments.");
        return;
      }
      const result = await browser.tabs.sendMessage(tab.id, { type: "youtube-focus:open-comments" });
      if (result?.ok === false) {
        showStatus(result.message || "Comments could not be opened on this video.", "error");
      } else {
        showStatus("Comments opened for this video.");
      }
    } catch (error) {
      showStatus("Open a YouTube video and try again. The page may still be loading.", "error");
    } finally {
      commentsButton.disabled = false;
    }
  }

  enabledInput.addEventListener("change", saveSettings);
  cardSizeInput.addEventListener("change", saveSettings);
  commentsButton.addEventListener("click", openComments);
  loadSettings();
  refreshPageStatus();
})();
