const DEFAULT_SETTINGS = {
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
  collapseGroups: false,
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

const REFRESH_DEBOUNCE_MS = 120;
const refreshTimers = new Map();
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const COLLAPSED_GROUPS_KEY = "ctbCollapsedGroupsByWindow";

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asBool(value, fallback) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function asString(value, fallback) {
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function asColor(value, fallback) {
  if (typeof value === "string" && HEX_COLOR_RE.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

function normalizeSettings(stored) {
  return {
    enabled: asBool(stored.enabled, DEFAULT_SETTINGS.enabled),
    position: ["top", "bottom"].includes(stored.position) ? stored.position : DEFAULT_SETTINGS.position,
    layoutMode: ["overlay", "push"].includes(stored.layoutMode) ? stored.layoutMode : DEFAULT_SETTINGS.layoutMode,
    barHeightPercent: clampNumber(stored.barHeightPercent, 6, 30, DEFAULT_SETTINGS.barHeightPercent),
    tabMinWidth: clampNumber(stored.tabMinWidth, 56, 500, DEFAULT_SETTINGS.tabMinWidth),
    tabMaxWidth: clampNumber(stored.tabMaxWidth, 80, 800, DEFAULT_SETTINGS.tabMaxWidth),
    rowCount: clampNumber(stored.rowCount, 1, 6, DEFAULT_SETTINGS.rowCount),
    tabsPerRow: clampNumber(stored.tabsPerRow, 1, 50, DEFAULT_SETTINGS.tabsPerRow),
    iconSize: clampNumber(stored.iconSize, 12, 64, DEFAULT_SETTINGS.iconSize),
    labelFontSize: clampNumber(stored.labelFontSize, 10, 24, DEFAULT_SETTINGS.labelFontSize),
    padding: clampNumber(stored.padding, 2, 24, DEFAULT_SETTINGS.padding),
    showCloseButton: asBool(stored.showCloseButton, DEFAULT_SETTINGS.showCloseButton),
    showNewTabButton: asBool(stored.showNewTabButton, DEFAULT_SETTINGS.showNewTabButton),
    showSearchBar: asBool(stored.showSearchBar, DEFAULT_SETTINGS.showSearchBar),
    showGroups: asBool(stored.showGroups, DEFAULT_SETTINGS.showGroups),
    collapseGroups: asBool(stored.collapseGroups, DEFAULT_SETTINGS.collapseGroups),
    theme: ["dark", "light", "custom"].includes(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme,
    backgroundColor: asColor(stored.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
    textColor: asColor(stored.textColor, DEFAULT_SETTINGS.textColor),
    activeTabHighlight: asColor(stored.activeTabHighlight, DEFAULT_SETTINGS.activeTabHighlight),
    whenToShow: ["always", "fullscreen", "maximized"].includes(stored.whenToShow)
      ? stored.whenToShow
      : DEFAULT_SETTINGS.whenToShow,
    autoHide: asBool(stored.autoHide, DEFAULT_SETTINGS.autoHide),
    autoHideDelayMs: clampNumber(stored.autoHideDelayMs, 300, 10000, DEFAULT_SETTINGS.autoHideDelayMs),
    activationEdgePx: clampNumber(stored.activationEdgePx, 1, 100, DEFAULT_SETTINGS.activationEdgePx),
    pinnedIconOnly: asBool(stored.pinnedIconOnly, DEFAULT_SETTINGS.pinnedIconOnly)
  };
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return normalizeSettings(stored);
}

async function getCollapsedGroupsState() {
  const stored = await chrome.storage.local.get(COLLAPSED_GROUPS_KEY);
  const value = stored?.[COLLAPSED_GROUPS_KEY];
  if (!value || typeof value !== "object") return {};
  return value;
}

function normalizeCollapsedMap(map) {
  if (!map || typeof map !== "object") return {};
  const out = {};
  for (const [groupId, collapsed] of Object.entries(map)) {
    if (!Number.isInteger(Number(groupId))) continue;
    out[groupId] = Boolean(collapsed);
  }
  return out;
}

async function getWindowCollapsedMap(windowId) {
  const state = await getCollapsedGroupsState();
  return normalizeCollapsedMap(state[String(windowId)]);
}

async function setWindowGroupCollapsed(windowId, groupId, collapsed) {
  const state = await getCollapsedGroupsState();
  const windowKey = String(windowId);
  const map = normalizeCollapsedMap(state[windowKey]);
  map[String(groupId)] = Boolean(collapsed);
  state[windowKey] = map;
  await chrome.storage.local.set({ [COLLAPSED_GROUPS_KEY]: state });
}

async function pruneWindowCollapsedMap(windowId, validGroupIds) {
  const state = await getCollapsedGroupsState();
  const windowKey = String(windowId);
  const map = normalizeCollapsedMap(state[windowKey]);
  const valid = new Set(validGroupIds.map((id) => String(id)));
  let changed = false;
  for (const key of Object.keys(map)) {
    if (!valid.has(key)) {
      delete map[key];
      changed = true;
    }
  }
  if (!changed) return;
  if (Object.keys(map).length === 0) {
    delete state[windowKey];
  } else {
    state[windowKey] = map;
  }
  await chrome.storage.local.set({ [COLLAPSED_GROUPS_KEY]: state });
}

function safeTitle(tab) {
  if (tab.title && tab.title.trim().length > 0) return tab.title;
  if (tab.pendingUrl) return tab.pendingUrl;
  if (tab.url) return tab.url;
  return "Untitled";
}

async function getWindowState(windowId) {
  try {
    const hasWindows = await chrome.permissions.contains({ permissions: ["windows"] });
    if (!hasWindows) return "normal";
    const win = await chrome.windows.get(windowId);
    return win.state || "normal";
  } catch (_error) {
    return "normal";
  }
}

async function getTabZoom(tabId) {
  if (!assertTabId(tabId)) return 1;
  try {
    const zoom = await chrome.tabs.getZoom(tabId);
    if (!Number.isFinite(zoom) || zoom <= 0) return 1;
    return zoom;
  } catch (_error) {
    return 1;
  }
}

async function buildWindowState(windowId) {
  const [tabs, groups, settings, windowState, collapsedMap] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
    getSettings(),
    getWindowState(windowId),
    getWindowCollapsedMap(windowId)
  ]);

  const groupById = new Map(groups.map((g) => [g.id, g]));

  const payloadTabs = tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: safeTitle(tab),
    url: tab.url || tab.pendingUrl || "",
    pendingUrl: tab.pendingUrl || "",
    favIconUrl: tab.favIconUrl || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    status: tab.status || "unloaded",
    audible: Boolean(tab.audible),
    muted: Boolean(tab.mutedInfo?.muted),
    groupId: typeof tab.groupId === "number" ? tab.groupId : chrome.tabGroups.TAB_GROUP_ID_NONE
  }));

  await pruneWindowCollapsedMap(
    windowId,
    groups.map((group) => group.id)
  );

  const payloadGroups = groups.map((group) => ({
    id: group.id,
    title: group.title || "",
    color: group.color || "grey",
    collapsed: Boolean(collapsedMap[String(group.id)])
  }));

  return {
    settings,
    windowState,
    tabs: payloadTabs,
    groups: payloadGroups,
    hasGroups: groupById.size > 0
  };
}

async function broadcastWindowState(windowId) {
  if (!windowId || windowId < 0) return;
  try {
    const state = await buildWindowState(windowId);
    const windowTabs = await chrome.tabs.query({ windowId });

    await Promise.all(
      windowTabs.map(async (tab) => {
        if (!tab.id) return;
        try {
          const zoomFactor = await getTabZoom(tab.id);
          await chrome.tabs.sendMessage(tab.id, {
            type: "STATE_UPDATE",
            payload: { ...state, zoomFactor }
          });
        } catch (_error) {
          // Not all tabs run our content script (e.g. restricted pages).
        }
      })
    );
  } catch (_error) {
    // Window can disappear during async updates.
  }
}

function scheduleBroadcast(windowId) {
  if (!windowId || windowId < 0) return;
  const existing = refreshTimers.get(windowId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    refreshTimers.delete(windowId);
    await broadcastWindowState(windowId);
  }, REFRESH_DEBOUNCE_MS);

  refreshTimers.set(windowId, timer);
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const next = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof current[key] === "undefined") {
      next[key] = value;
    }
  }
  if (Object.keys(next).length > 0) {
    await chrome.storage.sync.set(next);
  }
  const merged = { ...DEFAULT_SETTINGS, ...current, ...next };
  await chrome.storage.sync.set(normalizeSettings(merged));
});

function assertTabId(tabId) {
  return Number.isInteger(tabId) && tabId > 0;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const senderTab = sender.tab;
    const senderWindowId = senderTab?.windowId;

    if (message?.type === "GET_STATE") {
      let windowId = senderWindowId;
      if (!windowId) {
        try {
          windowId = (await chrome.windows.getCurrent()).id;
        } catch {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          windowId = tab?.windowId;
        }
      }
      if (!windowId) {
        sendResponse({ ok: false, error: "Could not determine window." });
        return;
      }
      const payload = await buildWindowState(windowId);
      payload.zoomFactor = await getTabZoom(senderTab?.id);
      sendResponse({ ok: true, payload });
      return;
    }

    if (message?.type === "ACTIVATE_TAB") {
      if (!assertTabId(message.tabId)) throw new Error("Invalid tab id.");
      await chrome.tabs.update(message.tabId, { active: true });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "CLOSE_TAB") {
      if (!assertTabId(message.tabId)) throw new Error("Invalid tab id.");
      await chrome.tabs.remove(message.tabId);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "NEW_TAB") {
      let targetWindowId = senderWindowId;
      if (!targetWindowId) {
        try {
          targetWindowId = (await chrome.windows.getCurrent()).id;
        } catch {
          const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          targetWindowId = tab?.windowId;
        }
      }
      await chrome.tabs.create(targetWindowId ? { windowId: targetWindowId, active: true } : { active: true });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "PIN_TAB") {
      if (!assertTabId(message.tabId)) throw new Error("Invalid tab id.");
      await chrome.tabs.update(message.tabId, { pinned: Boolean(message.pinned) });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "MOVE_TAB") {
      if (!assertTabId(message.tabId)) throw new Error("Invalid tab id.");
      if (!Number.isInteger(message.index) || message.index < -1) throw new Error("Invalid target index.");
      await chrome.tabs.move(message.tabId, { index: message.index });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "MOVE_TABS_BLOCK") {
      if (!Array.isArray(message.tabIds) || message.tabIds.length === 0) {
        throw new Error("Invalid tab ids.");
      }
      const tabIds = message.tabIds.filter((id) => assertTabId(id));
      if (tabIds.length === 0) throw new Error("Invalid tab ids.");
      if (!Number.isInteger(message.index) || message.index < -1) throw new Error("Invalid target index.");
      await chrome.tabs.move(tabIds, { index: message.index });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "GROUP_TAB") {
      if (!assertTabId(message.tabId)) throw new Error("Invalid tab id.");
      const options = { tabIds: [message.tabId] };
      if (typeof message.groupId === "number") {
        options.groupId = message.groupId;
      }
      await chrome.tabs.group(options);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "UNGROUP_TAB") {
      if (!assertTabId(message.tabId)) throw new Error("Invalid tab id.");
      await chrome.tabs.ungroup([message.tabId]);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === "SET_GROUP_COLLAPSED") {
      if (!Number.isInteger(message.groupId)) throw new Error("Invalid group id.");
      if (!senderWindowId) throw new Error("Could not determine sender window.");
      await setWindowGroupCollapsed(senderWindowId, message.groupId, Boolean(message.collapsed));
      scheduleBroadcast(senderWindowId);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message type." });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error?.message || error) });
  });

  return true;
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => scheduleBroadcast(tab.windowId)).catch(() => {});
});

chrome.tabs.onCreated.addListener((tab) => scheduleBroadcast(tab.windowId));
chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => scheduleBroadcast(removeInfo.windowId));
chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => scheduleBroadcast(tab.windowId));
chrome.tabs.onMoved.addListener((_tabId, moveInfo) => scheduleBroadcast(moveInfo.windowId));
chrome.tabs.onAttached.addListener((_tabId, attachInfo) => scheduleBroadcast(attachInfo.newWindowId));
chrome.tabs.onDetached.addListener((_tabId, detachInfo) => scheduleBroadcast(detachInfo.oldWindowId));
chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  if (!assertTabId(zoomChangeInfo.tabId)) return;
  chrome.tabs
    .get(zoomChangeInfo.tabId)
    .then((tab) => scheduleBroadcast(tab.windowId))
    .catch(() => {});
});

chrome.tabGroups.onCreated.addListener((group) => scheduleBroadcast(group.windowId));
chrome.tabGroups.onUpdated.addListener((group) => scheduleBroadcast(group.windowId));
chrome.tabGroups.onRemoved.addListener((group) => scheduleBroadcast(group.windowId));

async function broadcastAllWindows() {
  try {
    const windows = await chrome.windows.getAll({ populate: false });
    windows.forEach((win) => scheduleBroadcast(win.id));
  } catch {
    const tabs = await chrome.tabs.query({});
    const ids = [...new Set(tabs.map((t) => t.windowId).filter(Boolean))];
    ids.forEach((id) => scheduleBroadcast(id));
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;
  if (Object.keys(changes).length === 0) return;
  broadcastAllWindows();
});

chrome.windows.onFocusChanged.addListener(() => broadcastAllWindows());

chrome.windows.onBoundsChanged.addListener((win) => {
  if (win?.id) scheduleBroadcast(win.id);
});
