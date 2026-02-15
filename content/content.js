const GROUP_NONE = -1;
const UPDATE_DEBOUNCE_MS = 100;

let state = {
  settings: null,
  tabs: [],
  groups: [],
  windowState: "normal"
};

let rootEl;
let rowsEl;
let searchRowEl;
let searchEl;
let newTabEl;
let hideBarEl;
let hintEl;
let handleEl;
let contextMenuEl;
let searchToggleEl;
let utilityRackEl;
let focusedTabId = null;
let searchValue = "";
let hideTimer = null;
let renderTimer = null;
let contextTabId = null;
let manuallyHidden = false;
let pageOffsetApplied = false;
let originalHtmlPaddingTop = "";
let originalHtmlPaddingBottom = "";
let draggingTabId = null;
let searchExpanded = false;

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function safeText(input) {
  if (!input) return "";
  return String(input);
}

function faviconURL(url, size) {
  if (!url) return "";
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", String(size));
    return u.toString();
  } catch (_error) {
    return "";
  }
}

function ensureUI() {
  if (rootEl) return;
  const existing = document.getElementById("ctb-root");
  if (existing) {
    rootEl = existing;
    rowsEl = existing.querySelector(".ctb-rows");
    searchRowEl = existing.querySelector(".ctb-search-row");
    searchEl = existing.querySelector(".ctb-search");
    newTabEl = existing.querySelector(".ctb-new-tab");
    hideBarEl = existing.querySelector(".ctb-hide-bar");
    hintEl = existing.querySelector(".ctb-hint");
    handleEl = existing.querySelector(".ctb-handle");
    searchToggleEl = existing.querySelector(".ctb-search-toggle");
    utilityRackEl = existing.querySelector(".ctb-row-utility");
    contextMenuEl = existing.querySelector(".ctb-context");
    return;
  }
  rootEl = document.createElement("div");
  rootEl.id = "ctb-root";
  rootEl.dataset.hidden = "false";

  const shell = document.createElement("div");
  shell.className = "ctb-shell";

  utilityRackEl = document.createElement("div");
  utilityRackEl.className = "ctb-row-utility";

  searchToggleEl = document.createElement("button");
  searchToggleEl.className = "ctb-button ctb-search-toggle";
  searchToggleEl.type = "button";
  searchToggleEl.textContent = "⌕";
  searchToggleEl.title = "Show/hide search";
  searchToggleEl.setAttribute("aria-label", "Show or hide search");
  searchToggleEl.addEventListener("click", () => {
    searchExpanded = !searchExpanded;
    if (!searchExpanded) {
      searchEl.blur();
      searchEl.value = "";
      searchValue = "";
    }
    scheduleRender();
    if (searchExpanded) {
      requestAnimationFrame(() => searchEl.focus());
    }
  });
  utilityRackEl.appendChild(searchToggleEl);

  newTabEl = document.createElement("button");
  newTabEl.className = "ctb-button ctb-new-tab";
  newTabEl.textContent = "New Tab";
  newTabEl.addEventListener("click", async () => {
    await sendMessage({ type: "NEW_TAB" });
  });
  newTabEl.setAttribute("aria-label", "Create new tab");
  utilityRackEl.appendChild(newTabEl);

  hideBarEl = document.createElement("button");
  hideBarEl.className = "ctb-button ctb-hide-bar";
  hideBarEl.textContent = "Hide";
  hideBarEl.title = "Hide MegaTabs (Alt+Shift+M to toggle)";
  hideBarEl.addEventListener("click", () => {
    manuallyHidden = true;
    rootEl.dataset.hidden = "true";
  });
  utilityRackEl.appendChild(hideBarEl);

  hintEl = document.createElement("span");
  hintEl.className = "ctb-hint";
  hintEl.textContent = "Alt+Shift+M";
  utilityRackEl.appendChild(hintEl);

  searchRowEl = document.createElement("div");
  searchRowEl.className = "ctb-search-row";
  searchRowEl.hidden = true;

  searchEl = document.createElement("input");
  searchEl.className = "ctb-search";
  searchEl.placeholder = "Filter tabs by title or URL...";
  searchEl.type = "text";
  searchEl.addEventListener(
    "input",
    debounce((event) => {
      searchValue = event.target.value.trim().toLowerCase();
      scheduleRender();
    }, 120)
  );
  searchEl.setAttribute("aria-label", "Filter tabs");
  searchRowEl.appendChild(searchEl);

  rowsEl = document.createElement("div");
  rowsEl.className = "ctb-rows";

  handleEl = document.createElement("button");
  handleEl.className = "ctb-handle";
  handleEl.type = "button";
  handleEl.textContent = "Show MegaTabs";
  handleEl.addEventListener("click", () => {
    manuallyHidden = false;
    rootEl.dataset.hidden = "false";
    requestHideWithDelay();
  });

  contextMenuEl = document.createElement("div");
  contextMenuEl.className = "ctb-context";
  contextMenuEl.addEventListener("click", onContextMenuClick);

  shell.appendChild(searchRowEl);
  shell.appendChild(rowsEl);
  rootEl.appendChild(shell);
  rootEl.appendChild(handleEl);
  rootEl.appendChild(contextMenuEl);
  document.documentElement.appendChild(rootEl);

  document.addEventListener("click", () => hideContextMenu(), true);
  document.addEventListener("keydown", handleGlobalKeydown, true);
  document.addEventListener("mousemove", onMouseMoveForAutohide, { passive: true });
}

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderTimer = null;
    render();
  }, UPDATE_DEBOUNCE_MS);
}

function shouldShowByMode() {
  const mode = state.settings?.whenToShow || "always";
  if (mode === "always") return true;
  if (mode === "fullscreen") return state.windowState === "fullscreen";
  if (mode === "maximized") return state.windowState === "maximized";
  return true;
}

function applyShellSettings() {
  const settings = state.settings;
  rootEl.dataset.position = settings.position || "top";

  const shell = rootEl.querySelector(".ctb-shell");
  const rowCount = Math.max(1, Number(settings.rowCount || 1));
  const controlsVisible = settings.showSearchBar || settings.showNewTabButton;
  const dynamicVh = Math.max(6, Number(settings.barHeightPercent || 12)) + (rowCount - 1) * 4;
  const minPx = (controlsVisible ? 34 : 10) + rowCount * 44 + 14;
  shell.style.height = `${dynamicVh}vh`;
  shell.style.maxHeight = `${Math.max(260, minPx + 40)}px`;
  shell.style.minHeight = `${minPx}px`;
  shell.style.background = settings.backgroundColor || "#1e1e1e";
  shell.style.color = settings.textColor || "#e6e6e6";

  rootEl.style.setProperty("--ctb-bg", settings.backgroundColor || "#1e1e1e");
  rootEl.style.setProperty("--ctb-text", settings.textColor || "#e6e6e6");
  rootEl.style.setProperty("--ctb-active", settings.activeTabHighlight || "#333333");
  rootEl.style.setProperty("--ctb-scrollbar-thumb", settings.activeTabHighlight || "rgba(255,255,255,0.28)");
  rootEl.style.setProperty("--ctb-scrollbar-track", "rgba(255,255,255,0.08)");

  searchToggleEl.style.display = settings.showSearchBar ? "" : "none";
  newTabEl.style.display = settings.showNewTabButton ? "" : "none";
  hideBarEl.style.display = "";
  hintEl.style.display = "";
  if (!settings.showSearchBar) {
    searchExpanded = false;
  }
  searchRowEl.hidden = !(settings.showSearchBar && searchExpanded);
}

function groupTabs(tabs, groupsById) {
  if (!state.settings.showGroups) {
    return [{ groupId: GROUP_NONE, title: "Tabs", color: "grey", collapsed: false, tabs }];
  }

  const grouped = new Map();
  grouped.set(GROUP_NONE, {
    groupId: GROUP_NONE,
    title: "Ungrouped",
    color: "grey",
    collapsed: false,
    tabs: []
  });

  for (const tab of tabs) {
    const id = typeof tab.groupId === "number" ? tab.groupId : GROUP_NONE;
    if (!grouped.has(id)) {
      const group = groupsById.get(id);
      grouped.set(id, {
        groupId: id,
        title: group?.title || "Group",
        color: group?.color || "grey",
        collapsed: Boolean(group?.collapsed),
        tabs: []
      });
    }
    grouped.get(id).tabs.push(tab);
  }

  return [...grouped.values()].filter((entry) => entry.tabs.length > 0);
}

function sortTabs(rawTabs) {
  const tabs = [...rawTabs];
  tabs.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.index - b.index;
  });
  return tabs;
}

function tabMatchesSearch(tab) {
  if (!searchValue) return true;
  const haystack = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
  return haystack.includes(searchValue);
}

function render() {
  ensureUI();
  if (!state.settings || !state.settings.enabled || !shouldShowByMode()) {
    rootEl.style.display = "none";
    clearPageOffset();
    return;
  }
  rootEl.style.display = "block";

  applyShellSettings();
  hideContextMenu();
  clearDropMarkers();

  const groupsById = new Map((state.groups || []).map((g) => [g.id, g]));
  const sortedTabs = sortTabs(state.tabs || []).filter(tabMatchesSearch);
  const rowCount = Math.max(1, Number(state.settings.rowCount || 1));
  const tabsPerRow = Math.max(4, Number(state.settings.tabsPerRow || 12));
  const rows = distributeTabsIntoRows(sortedTabs, rowCount, tabsPerRow);

  rowsEl.textContent = "";
  if (sortedTabs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ctb-empty";
    empty.textContent = "No tabs match your filter.";
    rowsEl.appendChild(empty);
    return;
  }

  for (let i = 0; i < rowCount; i += 1) {
    const rowScroll = document.createElement("div");
    rowScroll.className = "ctb-row-scroll";
    rowScroll.dataset.row = String(i + 1);
    rowScroll.addEventListener(
      "wheel",
      (event) => {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (delta === 0) return;
        rowScroll.scrollLeft += delta;
        event.preventDefault();
      },
      { passive: false }
    );

    const rowTabs = rows[i] || [];
    if (rowTabs.length === 0) continue;

    const rowGroups = groupTabs(rowTabs, groupsById);
    for (const group of rowGroups) {
      const groupEl = document.createElement("div");
      groupEl.className = "ctb-group";
      const useFullGroupHeader = state.settings.showGroups && rowCount === 1;

      if (useFullGroupHeader) {
        const header = document.createElement("div");
        header.className = "ctb-group-header";
        header.style.borderLeft = `4px solid ${groupColor(group.color)}`;
        header.style.paddingLeft = "6px";

        const title = document.createElement("span");
        title.textContent = group.groupId === GROUP_NONE ? "Ungrouped" : group.title || "Group";
        header.appendChild(title);

        if (group.groupId !== GROUP_NONE) {
          const count = document.createElement("span");
          count.textContent = `(${group.tabs.length})`;
          header.appendChild(count);

          const toggle = document.createElement("button");
          toggle.className = "ctb-group-toggle";
          toggle.textContent = group.collapsed ? "Expand" : "Collapse";
          toggle.addEventListener("click", async () => {
            await sendMessage({
              type: "SET_GROUP_COLLAPSED",
              groupId: group.groupId,
              collapsed: !group.collapsed
            });
          });
          header.appendChild(toggle);
        }
        groupEl.appendChild(header);
      }

      const groupTabsEl = document.createElement("div");
      groupTabsEl.className = "ctb-group-tabs";
      groupTabsEl.style.borderLeft = state.settings.showGroups ? `3px solid ${groupColor(group.color)}` : "none";
      groupTabsEl.style.paddingLeft = state.settings.showGroups ? "6px" : "0";

      const collapseBySetting = state.settings.collapseGroups && group.groupId !== GROUP_NONE;
      const isCollapsed = collapseBySetting ? group.collapsed : false;
      const visibleTabs = isCollapsed ? group.tabs.filter((tab) => tab.active).slice(0, 1) : group.tabs;

      // Compact group UX for multi-row mode: a light chip instead of repeated full headers.
      if (state.settings.showGroups && !useFullGroupHeader) {
        const chip = document.createElement("span");
        chip.className = "ctb-group-chip";
        const label = group.groupId === GROUP_NONE ? "Ungrouped" : group.title || "Group";
        chip.textContent = `${label} (${group.tabs.length})`;
        if (group.groupId !== GROUP_NONE) {
          const toggle = document.createElement("button");
          toggle.className = "ctb-group-toggle";
          toggle.textContent = group.collapsed ? "Expand" : "Collapse";
          toggle.addEventListener("click", async () => {
            await sendMessage({
              type: "SET_GROUP_COLLAPSED",
              groupId: group.groupId,
              collapsed: !group.collapsed
            });
          });
          chip.appendChild(toggle);
        }
        groupTabsEl.appendChild(chip);
      }

      for (const tab of visibleTabs) {
        groupTabsEl.appendChild(renderTab(tab));
      }
      groupEl.appendChild(groupTabsEl);
      rowScroll.appendChild(groupEl);
    }
    if (i === 0) {
      rowScroll.appendChild(utilityRackEl);
    }
    rowsEl.appendChild(rowScroll);
  }

  if (manuallyHidden) {
    rootEl.dataset.hidden = "true";
    clearPageOffset();
  } else if (state.settings.autoHide) {
    requestHideWithDelay();
    applyPageOffsetIfNeeded();
  } else {
    rootEl.dataset.hidden = "false";
    applyPageOffsetIfNeeded();
  }
}

function distributeTabsIntoRows(tabs, rowCount, tabsPerRow) {
  const rows = Array.from({ length: rowCount }, () => []);
  if (tabs.length === 0) return rows;
  let nextRow = 0;
  for (const tab of tabs) {
    let placed = false;
    for (let step = 0; step < rowCount; step += 1) {
      const idx = (nextRow + step) % rowCount;
      if (rows[idx].length < tabsPerRow) {
        rows[idx].push(tab);
        nextRow = (idx + 1) % rowCount;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // All rows reached tabsPerRow target: keep balancing by shortest row.
      let target = 0;
      for (let i = 1; i < rowCount; i += 1) {
        if (rows[i].length < rows[target].length) target = i;
      }
      rows[target].push(tab);
      nextRow = (target + 1) % rowCount;
    }
  }
  return rows;
}

function groupColor(color) {
  const colors = {
    grey: "#9ea4a9",
    blue: "#3c9cff",
    red: "#d45050",
    yellow: "#d4b04f",
    green: "#4aaa62",
    pink: "#d55aa2",
    purple: "#8659d9",
    cyan: "#3db3b3",
    orange: "#d17f3f"
  };
  return colors[color] || colors.grey;
}

function renderTab(tab) {
  const tabEl = document.createElement("div");
  tabEl.className = "ctb-tab";
  tabEl.dataset.tabId = String(tab.id);
  tabEl.setAttribute("role", "button");
  tabEl.setAttribute("tabindex", "0");

  if (tab.active) tabEl.classList.add("ctb-active");
  if (tab.id === focusedTabId) tabEl.classList.add("ctb-focused");
  tabEl.setAttribute("draggable", "true");

  const minW = Number(state.settings.tabMinWidth || 120);
  const maxW = Number(state.settings.tabMaxWidth || 250);
  const pad = Number(state.settings.padding || 8);
  const iconSize = Number(state.settings.iconSize || 24);
  const labelSize = Number(state.settings.labelFontSize || 13);

  tabEl.style.minWidth = `${Math.max(56, minW)}px`;
  tabEl.style.maxWidth = `${Math.max(minW, maxW)}px`;
  tabEl.style.padding = `${Math.max(2, pad)}px`;
  tabEl.style.fontSize = `${Math.max(10, labelSize)}px`;

  const icon = document.createElement("img");
  icon.className = "ctb-tab-icon";
  icon.style.width = `${Math.max(12, iconSize)}px`;
  icon.style.height = `${Math.max(12, iconSize)}px`;
  icon.alt = "";
  icon.src = tab.favIconUrl || faviconURL(tab.url, Math.max(16, iconSize));
  icon.onerror = () => {
    icon.src = faviconURL(tab.url, Math.max(16, iconSize));
  };
  tabEl.appendChild(icon);

  const pinnedIconOnly = state.settings.pinnedIconOnly && tab.pinned;
  if (!pinnedIconOnly) {
    const label = document.createElement("span");
    label.className = "ctb-tab-label";
    label.textContent = safeText(tab.title);
    label.title = `${safeText(tab.title)}\n${safeText(tab.url)}`;
    tabEl.appendChild(label);
  }

  const metadata = document.createElement("span");
  metadata.className = "ctb-tab-metadata";
  if (tab.muted) metadata.textContent = "Muted";
  else if (tab.audible) metadata.textContent = "Audio";
  else if (tab.status === "loading") metadata.textContent = "Loading";
  if (metadata.textContent) tabEl.appendChild(metadata);

  if (state.settings.showCloseButton) {
    const closeBtn = document.createElement("button");
    closeBtn.className = "ctb-tab-close";
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.title = "Close tab";
    closeBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await sendMessage({ type: "CLOSE_TAB", tabId: tab.id });
    });
    tabEl.appendChild(closeBtn);
  }

  tabEl.addEventListener("click", async () => {
    focusedTabId = tab.id;
    await sendMessage({ type: "ACTIVATE_TAB", tabId: tab.id });
  });
  tabEl.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusedTabId = tab.id;
      await sendMessage({ type: "ACTIVATE_TAB", tabId: tab.id });
    }
  });

  tabEl.addEventListener("auxclick", async (event) => {
    if (event.button !== 1) return;
    await sendMessage({ type: "CLOSE_TAB", tabId: tab.id });
  });

  tabEl.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, tab.id);
  });

  tabEl.addEventListener("dragstart", (event) => {
    draggingTabId = tab.id;
    tabEl.classList.add("ctb-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(tab.id));
    }
  });

  tabEl.addEventListener("dragover", (event) => {
    if (draggingTabId == null || draggingTabId === tab.id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    clearDropMarkers();
    const rect = tabEl.getBoundingClientRect();
    const placeAfter = event.clientX > rect.left + rect.width / 2;
    tabEl.classList.add(placeAfter ? "ctb-drop-after" : "ctb-drop-before");
  });

  tabEl.addEventListener("dragleave", () => {
    tabEl.classList.remove("ctb-drop-before", "ctb-drop-after");
  });

  tabEl.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (draggingTabId == null || draggingTabId === tab.id) {
      clearDropMarkers();
      return;
    }
    const rect = tabEl.getBoundingClientRect();
    const placeAfter = event.clientX > rect.left + rect.width / 2;
    await moveDraggedTabToTarget(draggingTabId, tab.id, placeAfter);
    clearDropMarkers();
  });

  tabEl.addEventListener("dragend", () => {
    draggingTabId = null;
    clearDropMarkers();
    tabEl.classList.remove("ctb-dragging");
  });

  return tabEl;
}

function clearDropMarkers() {
  const marked = rootEl?.querySelectorAll(".ctb-drop-before, .ctb-drop-after, .ctb-dragging");
  if (!marked) return;
  for (const el of marked) {
    el.classList.remove("ctb-drop-before", "ctb-drop-after", "ctb-dragging");
  }
}

async function moveDraggedTabToTarget(sourceTabId, targetTabId, placeAfter) {
  const source = state.tabs.find((t) => t.id === sourceTabId);
  const target = state.tabs.find((t) => t.id === targetTabId);
  if (!source || !target) return;
  // Keep reorder predictable inside same pinned/regular section.
  if (source.pinned !== target.pinned) return;

  let targetIndex = target.index + (placeAfter ? 1 : 0);
  if (source.index < targetIndex) {
    targetIndex -= 1;
  }
  if (targetIndex === source.index) return;
  await sendMessage({ type: "MOVE_TAB", tabId: source.id, index: targetIndex });
  focusedTabId = source.id;
}

function showContextMenu(x, y, tabId) {
  contextTabId = tabId;
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  contextMenuEl.textContent = "";
  const items = [
    { id: "activate", label: "Activate tab" },
    { id: "close", label: "Close tab" },
    { id: tab.pinned ? "unpin" : "pin", label: tab.pinned ? "Unpin tab" : "Pin tab" },
    { id: "closeOthers", label: "Close other tabs" }
  ];

  if (tab.groupId !== GROUP_NONE) {
    items.push({ id: "ungroup", label: "Ungroup tab" });
  } else {
    items.push({ id: "group", label: "Add to new group" });
  }

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.action = item.id;
    btn.textContent = item.label;
    contextMenuEl.appendChild(btn);
  }

  const menuWidth = 180;
  const menuHeight = 180;
  const nextX = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, x));
  const nextY = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, y));
  contextMenuEl.style.left = `${nextX}px`;
  contextMenuEl.style.top = `${nextY}px`;
  contextMenuEl.style.display = "flex";
}

function hideContextMenu() {
  if (!contextMenuEl) return;
  contextMenuEl.style.display = "none";
  contextTabId = null;
}

async function onContextMenuClick(event) {
  const action = event.target?.dataset?.action;
  if (!action || contextTabId == null) return;
  const tab = state.tabs.find((t) => t.id === contextTabId);
  if (!tab) return;

  if (action === "activate") {
    await sendMessage({ type: "ACTIVATE_TAB", tabId: tab.id });
  } else if (action === "close") {
    await sendMessage({ type: "CLOSE_TAB", tabId: tab.id });
  } else if (action === "pin" || action === "unpin") {
    await sendMessage({ type: "PIN_TAB", tabId: tab.id, pinned: action === "pin" });
  } else if (action === "ungroup") {
    await sendMessage({ type: "UNGROUP_TAB", tabId: tab.id });
  } else if (action === "group") {
    await sendMessage({ type: "GROUP_TAB", tabId: tab.id });
  } else if (action === "closeOthers") {
    const tabIds = state.tabs
      .filter((t) => t.id !== tab.id && !t.pinned)
      .map((t) => t.id);
    for (const id of tabIds) {
      await sendMessage({ type: "CLOSE_TAB", tabId: id });
    }
  }

  hideContextMenu();
}

function requestHideWithDelay() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    rootEl.dataset.hidden = "true";
    clearPageOffset();
  }, Number(state.settings.autoHideDelayMs || 2000));
}

function onMouseMoveForAutohide(event) {
  if (!state.settings?.autoHide || !rootEl || rootEl.style.display === "none") return;
  const edge = Number(state.settings.activationEdgePx || 5);
  const nearTop = event.clientY <= edge;
  const nearBottom = event.clientY >= window.innerHeight - edge;
  const targetNearEdge = state.settings.position === "bottom" ? nearBottom : nearTop;

  if (targetNearEdge || rootEl.matches(":hover")) {
    rootEl.dataset.hidden = "false";
    applyPageOffsetIfNeeded();
    requestHideWithDelay();
  }
}

function applyPageOffsetIfNeeded() {
  if (!rootEl || !state.settings) return;
  if (rootEl.dataset.hidden === "true") {
    clearPageOffset();
    return;
  }
  if (state.settings.layoutMode !== "push") {
    clearPageOffset();
    return;
  }

  const shell = rootEl.querySelector(".ctb-shell");
  if (!shell) return;
  const rect = shell.getBoundingClientRect();
  const offsetPx = Math.max(0, Math.ceil(rect.height));
  const html = document.documentElement;

  if (!pageOffsetApplied) {
    originalHtmlPaddingTop = html.style.paddingTop || "";
    originalHtmlPaddingBottom = html.style.paddingBottom || "";
  }

  if (state.settings.position === "top") {
    html.style.paddingTop = `${offsetPx}px`;
    html.style.paddingBottom = originalHtmlPaddingBottom;
  } else {
    html.style.paddingBottom = `${offsetPx}px`;
    html.style.paddingTop = originalHtmlPaddingTop;
  }
  pageOffsetApplied = true;
}

function clearPageOffset() {
  if (!pageOffsetApplied) return;
  const html = document.documentElement;
  html.style.paddingTop = originalHtmlPaddingTop;
  html.style.paddingBottom = originalHtmlPaddingBottom;
  pageOffsetApplied = false;
}

function handleGlobalKeydown(event) {
  if (!state.settings?.enabled) return;
  if (!rootEl || rootEl.style.display === "none") return;
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === "m") {
    manuallyHidden = !manuallyHidden;
    if (manuallyHidden) {
      rootEl.dataset.hidden = "true";
      clearPageOffset();
    } else {
      rootEl.dataset.hidden = "false";
      applyPageOffsetIfNeeded();
      requestHideWithDelay();
    }
    event.preventDefault();
    return;
  }
  if (event.key === "Escape") {
    hideContextMenu();
    return;
  }
  if (event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA")) return;
  // Keep tab navigation keys scoped to active overlay interaction.
  const insideOverlay = rootEl.contains(event.target);
  const overlayHovered = rootEl.matches(":hover");
  if (!insideOverlay && !overlayHovered) return;
  if (!["ArrowLeft", "ArrowRight", "Enter", "Delete"].includes(event.key)) return;
  if (state.tabs.length === 0) return;

  const sortedTabs = sortTabs(state.tabs).filter(tabMatchesSearch);
  if (sortedTabs.length === 0) return;
  const currentId = focusedTabId ?? sortedTabs.find((t) => t.active)?.id ?? sortedTabs[0].id;
  let index = sortedTabs.findIndex((t) => t.id === currentId);
  if (index < 0) index = 0;

  if (event.key === "ArrowLeft") {
    focusedTabId = sortedTabs[Math.max(0, index - 1)].id;
    scheduleRender();
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowRight") {
    focusedTabId = sortedTabs[Math.min(sortedTabs.length - 1, index + 1)].id;
    scheduleRender();
    event.preventDefault();
    return;
  }
  if (event.key === "Enter") {
    sendMessage({ type: "ACTIVATE_TAB", tabId: focusedTabId || currentId });
    event.preventDefault();
    return;
  }
  if (event.key === "Delete") {
    sendMessage({ type: "CLOSE_TAB", tabId: focusedTabId || currentId });
    event.preventDefault();
  }
}

async function sendMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response;
  } catch (_error) {
    return { ok: false };
  }
}

async function hydrateFromBackground() {
  const result = await sendMessage({ type: "GET_STATE" });
  if (!result?.ok || !result.payload) return;
  state = {
    ...state,
    ...result.payload
  };
  scheduleRender();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "STATE_UPDATE" || !message.payload) return;
  state = {
    ...state,
    ...message.payload
  };
  scheduleRender();
});

ensureUI();
hydrateFromBackground();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    hydrateFromBackground();
  } else {
    clearPageOffset();
  }
});
window.addEventListener("resize", () => {
  applyPageOffsetIfNeeded();
});
window.addEventListener("beforeunload", () => {
  clearPageOffset();
});
