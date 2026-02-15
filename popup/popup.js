const enabledToggle = document.getElementById("enabledToggle");
const openSettings = document.getElementById("openSettings");

async function load() {
  const settings = await chrome.storage.sync.get({ enabled: true });
  enabledToggle.checked = Boolean(settings.enabled);
}

enabledToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

openSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

load();
