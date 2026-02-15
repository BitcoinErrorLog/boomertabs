const enabledToggle = document.getElementById("enabledToggle");
const positionSelect = document.getElementById("positionSelect");
const layoutSelect = document.getElementById("layoutSelect");
const rowsInput = document.getElementById("rowsInput");
const tabsPerRowInput = document.getElementById("tabsPerRowInput");
const groupsToggle = document.getElementById("groupsToggle");
const openSettings = document.getElementById("openSettings");

const DEFAULTS = {
  enabled: true,
  position: "bottom",
  layoutMode: "overlay",
  rowCount: 1,
  tabsPerRow: 12,
  showGroups: true
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  enabledToggle.checked = Boolean(settings.enabled);
  positionSelect.value = settings.position || DEFAULTS.position;
  layoutSelect.value = settings.layoutMode || DEFAULTS.layoutMode;
  rowsInput.value = String(clamp(settings.rowCount, 1, 6, DEFAULTS.rowCount));
  tabsPerRowInput.value = String(clamp(settings.tabsPerRow, 1, 50, DEFAULTS.tabsPerRow));
  groupsToggle.checked = Boolean(settings.showGroups);
}

enabledToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: enabledToggle.checked });
});

positionSelect.addEventListener("change", async () => {
  await chrome.storage.sync.set({ position: positionSelect.value });
});

layoutSelect.addEventListener("change", async () => {
  await chrome.storage.sync.set({ layoutMode: layoutSelect.value });
});

rowsInput.addEventListener("change", async () => {
  const value = clamp(rowsInput.value, 1, 6, DEFAULTS.rowCount);
  rowsInput.value = String(value);
  await chrome.storage.sync.set({ rowCount: value });
});

tabsPerRowInput.addEventListener("change", async () => {
  const value = clamp(tabsPerRowInput.value, 1, 50, DEFAULTS.tabsPerRow);
  tabsPerRowInput.value = String(value);
  await chrome.storage.sync.set({ tabsPerRow: value });
});

groupsToggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ showGroups: groupsToggle.checked });
});

openSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

load();
