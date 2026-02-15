const DEFAULTS = {
  enabled: true,
  position: "bottom",
  layoutMode: "overlay",
  barHeightPercent: 12,
  tabMinWidth: 120,
  tabMaxWidth: 250,
  rowCount: 1,
  tabsPerRow: 12,
  iconSize: 28,
  labelFontSize: 13,
  padding: 8,
  showCloseButton: true,
  showNewTabButton: true,
  showSearchBar: true,
  showGroups: true,
  theme: "dark",
  backgroundColor: "#1e1e1e",
  textColor: "#e6e6e6",
  activeTabHighlight: "#333333",
  whenToShow: "always",
  autoHide: false,
  autoHideDelayMs: 2000,
  activationEdgePx: 5,
  pinnedIconOnly: false
};

const NUMERIC_FIELDS = new Set([
  "barHeightPercent",
  "tabMinWidth",
  "tabMaxWidth",
  "rowCount",
  "tabsPerRow",
  "iconSize",
  "labelFontSize",
  "padding",
  "autoHideDelayMs",
  "activationEdgePx"
]);

const CHECKBOX_FIELDS = new Set([
  "enabled",
  "showCloseButton",
  "showNewTabButton",
  "showSearchBar",
  "showGroups",
  "autoHide",
  "pinnedIconOnly"
]);
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

const NUMERIC_LIMITS = {
  barHeightPercent: [6, 30],
  tabMinWidth: [56, 500],
  tabMaxWidth: [80, 800],
  rowCount: [1, 6],
  tabsPerRow: [1, 50],
  iconSize: [12, 64],
  labelFontSize: [10, 24],
  padding: [2, 24],
  autoHideDelayMs: [300, 10000],
  activationEdgePx: [1, 100]
};

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function byId(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  byId("status").textContent = text;
  if (!text) return;
  setTimeout(() => {
    if (byId("status").textContent === text) {
      byId("status").textContent = "";
    }
  }, 1800);
}

function applyThemePresetIfNeeded(formValues) {
  if (formValues.theme === "dark") {
    formValues.backgroundColor = "#1e1e1e";
    formValues.textColor = "#e6e6e6";
    formValues.activeTabHighlight = "#333333";
  } else if (formValues.theme === "light") {
    formValues.backgroundColor = "#f2f2f2";
    formValues.textColor = "#1a1a1a";
    formValues.activeTabHighlight = "#dcdcdc";
  }
  return formValues;
}

function normalizeSettings(values) {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (CHECKBOX_FIELDS.has(key)) {
      out[key] = Boolean(values[key]);
      continue;
    }
    if (NUMERIC_FIELDS.has(key)) {
      const [min, max] = NUMERIC_LIMITS[key];
      out[key] = clamp(values[key], min, max, DEFAULTS[key]);
      continue;
    }
    out[key] = typeof values[key] === "string" ? values[key] : DEFAULTS[key];
  }

  if (!["top", "bottom"].includes(out.position)) out.position = DEFAULTS.position;
  if (!["overlay", "push"].includes(out.layoutMode)) out.layoutMode = DEFAULTS.layoutMode;
  if (!["always", "fullscreen", "maximized"].includes(out.whenToShow)) out.whenToShow = DEFAULTS.whenToShow;
  if (!["dark", "light", "custom"].includes(out.theme)) out.theme = DEFAULTS.theme;
  if (!HEX_COLOR_RE.test(out.backgroundColor)) out.backgroundColor = DEFAULTS.backgroundColor;
  if (!HEX_COLOR_RE.test(out.textColor)) out.textColor = DEFAULTS.textColor;
  if (!HEX_COLOR_RE.test(out.activeTabHighlight)) out.activeTabHighlight = DEFAULTS.activeTabHighlight;
  out.tabMaxWidth = Math.max(out.tabMinWidth, out.tabMaxWidth);

  return out;
}

function readForm() {
  const data = {};
  for (const key of Object.keys(DEFAULTS)) {
    const el = byId(key);
    if (!el) continue;
    if (CHECKBOX_FIELDS.has(key)) {
      data[key] = Boolean(el.checked);
    } else if (NUMERIC_FIELDS.has(key)) {
      data[key] = Number(el.value);
    } else {
      data[key] = el.value;
    }
  }
  return normalizeSettings(applyThemePresetIfNeeded(data));
}

function writeForm(values) {
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const el = byId(key);
    if (!el) continue;
    const value = typeof values[key] === "undefined" ? fallback : values[key];
    if (CHECKBOX_FIELDS.has(key)) {
      el.checked = Boolean(value);
    } else {
      el.value = String(value);
    }
  }
}

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  writeForm(normalizeSettings(settings));
}

async function save() {
  const payload = readForm();
  await chrome.storage.sync.set(payload);
  writeForm(payload);
  setStatus("Saved.");
}

async function reset() {
  await chrome.storage.sync.set({ ...DEFAULTS });
  writeForm(DEFAULTS);
  setStatus("Defaults restored.");
}

byId("saveBtn").addEventListener("click", save);
byId("resetBtn").addEventListener("click", reset);
byId("theme").addEventListener("change", () => {
  const values = readForm();
  writeForm(values);
});

load();
