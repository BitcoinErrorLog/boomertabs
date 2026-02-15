const GROUP_NONE = -1;
const UPDATE_DEBOUNCE_MS = 100;

let state = {
  settings: null,
  tabs: [],
  groups: [],
  windowState: "normal",
  zoomFactor: 1
};

let rootEl;
let rowsEl;
let searchRowEl;
let searchEl;
let newTabEl;
let hideBarEl;
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
let draggingFromRow = null;
let draggingGroupTabIds = null;
let searchExpanded = false;

function setLocalGroupCollapsed(groupId, collapsed) {
  const nextGroups = (state.groups || []).map((group) =>
    group.id === groupId ? { ...group, collapsed: Boolean(collapsed) } : group
  );
  state = {
    ...state,
    groups: nextGroups
  };
  scheduleRender();
}

async function toggleGroupCollapsed(groupId, currentCollapsed) {
  const nextCollapsed = !Boolean(currentCollapsed);
  setLocalGroupCollapsed(groupId, nextCollapsed);
  const response = await sendMessage({
    type: "SET_GROUP_COLLAPSED",
    groupId,
    collapsed: nextCollapsed
  });
  if (!response?.ok) {
    // Revert optimistic local update if background write fails.
    setLocalGroupCollapsed(groupId, currentCollapsed);
  }
}

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

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isSafeFaviconSource(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "chrome-extension:" ||
      parsed.protocol === "data:" ||
      parsed.protocol === "chrome:"
    );
  } catch (_error) {
    return false;
  }
}

function canUsePageUrlForFavicon(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local")) return false;
    if (isPrivateIpv4(host)) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

function faviconURL(url, size) {
  if (!canUsePageUrlForFavicon(url)) return "";
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", String(size));
    return u.toString();
  } catch (_error) {
    return "";
  }
}

function makeIcon(name) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ctb-icon-svg", `ctb-icon-${name}`);

  if (name === "search") {
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", "11");
    circle.setAttribute("cy", "11");
    circle.setAttribute("r", "6.5");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    circle.setAttribute("stroke-width", "2.2");
    svg.appendChild(circle);

    const handle = document.createElementNS(ns, "line");
    handle.setAttribute("x1", "16");
    handle.setAttribute("y1", "16");
    handle.setAttribute("x2", "20");
    handle.setAttribute("y2", "20");
    handle.setAttribute("stroke", "currentColor");
    handle.setAttribute("stroke-width", "2.2");
    handle.setAttribute("stroke-linecap", "round");
    svg.appendChild(handle);
    return svg;
  }

  if (name === "add") {
    const v = document.createElementNS(ns, "line");
    v.setAttribute("x1", "12");
    v.setAttribute("y1", "6");
    v.setAttribute("x2", "12");
    v.setAttribute("y2", "18");
    v.setAttribute("stroke", "currentColor");
    v.setAttribute("stroke-width", "2.4");
    v.setAttribute("stroke-linecap", "round");
    svg.appendChild(v);

    const h = document.createElementNS(ns, "line");
    h.setAttribute("x1", "6");
    h.setAttribute("y1", "12");
    h.setAttribute("x2", "18");
    h.setAttribute("y2", "12");
    h.setAttribute("stroke", "currentColor");
    h.setAttribute("stroke-width", "2.4");
    h.setAttribute("stroke-linecap", "round");
    svg.appendChild(h);
    return svg;
  }

  const p1 = document.createElementNS(ns, "path");
  p1.setAttribute("d", "M7 10l5 5 5-5");
  p1.setAttribute("fill", "none");
  p1.setAttribute("stroke", "currentColor");
  p1.setAttribute("stroke-width", "2.4");
  p1.setAttribute("stroke-linecap", "round");
  p1.setAttribute("stroke-linejoin", "round");
  svg.appendChild(p1);
  return svg;
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
  searchToggleEl.className = "ctb-button ctb-search-toggle ctb-icon-btn";
  searchToggleEl.type = "button";
  searchToggleEl.appendChild(makeIcon("search"));
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
  newTabEl.className = "ctb-button ctb-new-tab ctb-icon-btn";
  newTabEl.appendChild(makeIcon("add"));
  newTabEl.addEventListener("click", async () => {
    await sendMessage({ type: "NEW_TAB" });
  });
  newTabEl.setAttribute("aria-label", "New tab");
  newTabEl.title = "New tab";
  utilityRackEl.appendChild(newTabEl);

  hideBarEl = document.createElement("button");
  hideBarEl.className = "ctb-button ctb-hide-bar ctb-icon-btn";
  hideBarEl.appendChild(makeIcon("hide"));
  hideBarEl.title = "Hide BoomerTabs (Alt+Shift+B to toggle)";
  hideBarEl.addEventListener("click", () => {
    manuallyHidden = true;
    rootEl.dataset.hidden = "true";
  });
  utilityRackEl.appendChild(hideBarEl);

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
  handleEl.textContent = "Show BoomerTabs";
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
  const zoomFactor = Math.max(0.25, Number(state.zoomFactor || 1));
  const zoomInverse = 1 / zoomFactor;

  const shell = rootEl.querySelector(".ctb-shell");
  const rowCount = Math.max(1, Number(settings.rowCount || 1));
  const baseVh = Math.max(6, Number(settings.barHeightPercent || 12)) + (rowCount - 1) * 4;
  const searchRowPx = settings.showSearchBar && searchExpanded ? 40 : 0;
  const minPx = rowCount * 46 + searchRowPx + 14;
  const neededVh = (minPx / Math.max(window.innerHeight, 1)) * 100 + 1.5;
  const maxVh = Math.min(95, Math.max(baseVh, neededVh));
  // Keep bar tight to content; cap overall height instead of forcing fixed height.
  shell.style.height = "auto";
  shell.style.maxHeight = `${maxVh}vh`;
  shell.style.minHeight = `${minPx}px`;
  shell.style.overflowY = "auto";
  shell.style.overflowX = "hidden";
  shell.style.background = settings.backgroundColor || "#1e1e1e";
  shell.style.color = settings.textColor || "#e6e6e6";

  rootEl.style.setProperty("--ctb-bg", settings.backgroundColor || "#1e1e1e");
  rootEl.style.setProperty("--ctb-text", settings.textColor || "#e6e6e6");
  rootEl.style.setProperty("--ctb-active", settings.activeTabHighlight || "#333333");
  rootEl.style.setProperty("--ctb-scrollbar-thumb", settings.activeTabHighlight || "rgba(255,255,255,0.28)");
  rootEl.style.setProperty("--ctb-scrollbar-track", "rgba(255,255,255,0.08)");
  rootEl.style.setProperty("--ctb-zoom-factor", String(zoomFactor));
  rootEl.style.setProperty("--ctb-zoom-inverse", String(zoomInverse));

  searchToggleEl.style.display = settings.showSearchBar ? "" : "none";
  newTabEl.style.display = settings.showNewTabButton ? "" : "none";
  hideBarEl.style.display = "";
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
  const sortedAllTabs = sortTabs(state.tabs || []);
  const sortedTabs = sortedAllTabs.filter(tabMatchesSearch);
  const rowCount = Math.max(1, Number(state.settings.rowCount || 1));
  const tabsPerRow = Math.max(1, Number(state.settings.tabsPerRow || 12));
  const rowPlan = buildRowPlan(sortedTabs, rowCount, tabsPerRow);
  const rowPlanAll = buildRowPlan(sortedAllTabs, rowCount, tabsPerRow);

  rowsEl.textContent = "";
  if (sortedTabs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ctb-empty";
    empty.textContent = "No tabs match your filter.";
    rowsEl.appendChild(empty);
    return;
  }

  const canDragGroups = !searchValue;
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

    const rowTabs = rowPlan.rows[i] || [];
    rowScroll.addEventListener("dragover", (event) => {
      if (draggingTabId == null && draggingGroupTabIds == null) return;
      event.preventDefault();
      event.stopPropagation();
      rowScroll.classList.add("ctb-row-drop-target");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });
    rowScroll.addEventListener("dragleave", () => {
      rowScroll.classList.remove("ctb-row-drop-target");
    });
    rowScroll.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      rowScroll.classList.remove("ctb-row-drop-target");
      if (draggingTabId != null) {
        await moveDraggedTabToRow(
          draggingTabId,
          i,
          rowPlanAll.rowStarts,
          rowPlanAll.rowLengths,
          sortedAllTabs
        );
      } else if (draggingGroupTabIds && draggingGroupTabIds.length > 0) {
        await moveDraggedGroupToRow(
          draggingGroupTabIds,
          i,
          rowPlanAll.rowStarts,
          rowPlanAll.rowLengths,
          sortedAllTabs
        );
      }
      clearDropMarkers();
    });
    if (rowTabs.length === 0) {
      const rowEmpty = document.createElement("div");
      rowEmpty.className = "ctb-row-empty";
      rowEmpty.textContent = "Drop tabs here";
      rowScroll.appendChild(rowEmpty);
      if (i === 0) {
        rowScroll.appendChild(utilityRackEl);
      }
      rowsEl.appendChild(rowScroll);
      continue;
    }

    const rowGroups = groupTabs(rowTabs, groupsById);
    for (const group of rowGroups) {
      const groupEl = document.createElement("div");
      groupEl.className = "ctb-group";
      if (group.groupId !== GROUP_NONE && canDragGroups) {
        groupEl.dataset.groupId = String(group.groupId);
      }
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
            await toggleGroupCollapsed(group.groupId, group.collapsed);
          });
          header.appendChild(toggle);
          if (canDragGroups) {
            header.setAttribute("draggable", "true");
            header.title = `${header.title ? `${header.title} ` : ""}Drag to move group`;
            header.addEventListener("dragstart", (event) => {
              draggingGroupTabIds = group.tabs.map((tab) => tab.id);
              groupEl.classList.add("ctb-group-dragging");
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", `group:${group.groupId}`);
              }
            });
            header.addEventListener("dragend", () => {
              draggingGroupTabIds = null;
              clearDropMarkers();
              groupEl.classList.remove("ctb-group-dragging");
            });
          }
        }
        groupEl.appendChild(header);
      }

      const groupTabsEl = document.createElement("div");
      groupTabsEl.className = "ctb-group-tabs";
      groupTabsEl.style.borderLeft = state.settings.showGroups ? `3px solid ${groupColor(group.color)}` : "none";
      groupTabsEl.style.paddingLeft = state.settings.showGroups ? "6px" : "0";

      const isCollapsed = group.groupId !== GROUP_NONE ? group.collapsed : false;
      const visibleTabs = isCollapsed ? group.tabs.filter((tab) => tab.active).slice(0, 1) : group.tabs;

      // Compact group UX for multi-row mode: single colored button with chevron affordance.
      if (state.settings.showGroups && !useFullGroupHeader) {
        if (group.groupId !== GROUP_NONE) {
          const chip = document.createElement("button");
          chip.className = "ctb-group-chip";
          chip.type = "button";
          chip.style.setProperty("--ctb-group-color", groupColor(group.color));
          chip.title = group.collapsed ? "Expand group" : "Collapse group";
          chip.setAttribute("aria-label", chip.title);
          chip.addEventListener("click", async () => {
            await toggleGroupCollapsed(group.groupId, group.collapsed);
          });
          if (canDragGroups) {
            chip.setAttribute("draggable", "true");
            chip.title = `${chip.title} - drag to move group`;
            chip.addEventListener("dragstart", (event) => {
              draggingGroupTabIds = group.tabs.map((tab) => tab.id);
              groupEl.classList.add("ctb-group-dragging");
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", `group:${group.groupId}`);
              }
            });
            chip.addEventListener("dragend", () => {
              draggingGroupTabIds = null;
              clearDropMarkers();
              groupEl.classList.remove("ctb-group-dragging");
            });
          }

          const label = document.createElement("span");
          label.className = "ctb-group-chip-label";
          label.textContent = `${group.title || "Group"} (${group.tabs.length})`;
          chip.appendChild(label);

          const chevron = document.createElement("span");
          chevron.className = "ctb-group-chip-chevron";
          chevron.textContent = ">";
          chip.appendChild(chevron);

          groupTabsEl.appendChild(chip);
        }
      }

      for (const tab of visibleTabs) {
        groupTabsEl.appendChild(renderTab(tab, i));
      }

      groupEl.addEventListener("dragover", (event) => {
        if (!draggingGroupTabIds || draggingGroupTabIds.length === 0) return;
        if (group.groupId === GROUP_NONE) return;
        const thisGroupTabIds = new Set(group.tabs.map((tab) => tab.id));
        const sameGroup = draggingGroupTabIds.every((id) => thisGroupTabIds.has(id));
        if (sameGroup) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = groupEl.getBoundingClientRect();
        const placeAfter = event.clientX > rect.left + rect.width / 2;
        groupEl.classList.remove("ctb-group-drop-before", "ctb-group-drop-after");
        groupEl.classList.add(placeAfter ? "ctb-group-drop-after" : "ctb-group-drop-before");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      });
      groupEl.addEventListener("dragleave", () => {
        groupEl.classList.remove("ctb-group-drop-before", "ctb-group-drop-after");
      });
      groupEl.addEventListener("drop", async (event) => {
        if (!draggingGroupTabIds || draggingGroupTabIds.length === 0) return;
        if (group.groupId === GROUP_NONE) return;
        const thisGroupTabIds = new Set(group.tabs.map((tab) => tab.id));
        const sameGroup = draggingGroupTabIds.every((id) => thisGroupTabIds.has(id));
        if (sameGroup) return;
        event.preventDefault();
        event.stopPropagation();
        const ordered = sortTabs(state.tabs || []);
        const targetPositions = ordered
          .map((tab, index) => ({ tab, index }))
          .filter(({ tab }) => thisGroupTabIds.has(tab.id))
          .map(({ index }) => index);
        if (targetPositions.length === 0) return;
        const rect = groupEl.getBoundingClientRect();
        const placeAfter = event.clientX > rect.left + rect.width / 2;
        const targetPos = placeAfter
          ? Math.max(...targetPositions) + 1
          : Math.min(...targetPositions);
        await moveGroupToOrderedPosition(draggingGroupTabIds, targetPos, ordered);
        clearDropMarkers();
      });
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

function buildRowPlan(tabs, rowCount, tabsPerRow) {
  const rows = Array.from({ length: rowCount }, () => []);
  const rowLengths = computeRowLengths(tabs.length, rowCount, tabsPerRow);
  const rowStarts = [];

  let start = 0;
  for (let i = 0; i < rowCount; i += 1) {
    rowStarts.push(start);
    const len = rowLengths[i] || 0;
    if (len > 0) {
      rows[i] = tabs.slice(start, start + len);
    }
    start += len;
  }

  return { rows, rowStarts, rowLengths };
}

function computeRowLengths(totalTabs, rowCount, tabsPerRow) {
  const lengths = Array.from({ length: rowCount }, () => 0);
  if (totalTabs <= 0) return lengths;

  const capacity = rowCount * tabsPerRow;
  if (totalTabs <= capacity) {
    // Fill rows as evenly as possible while honoring max tabs per row.
    let remaining = totalTabs;
    for (let i = 0; i < rowCount; i += 1) {
      if (remaining <= 0) break;
      const rowsLeft = rowCount - i;
      const ideal = Math.ceil(remaining / rowsLeft);
      const take = Math.min(tabsPerRow, ideal);
      lengths[i] = take;
      remaining -= take;
    }
    return lengths;
  }

  // Overflow mode: fill earlier rows to configured cap; last row holds remainder.
  let remaining = totalTabs;
  for (let i = 0; i < rowCount; i += 1) {
    const take = i === rowCount - 1 ? remaining : Math.min(tabsPerRow, remaining);
    lengths[i] = take;
    remaining -= take;
  }
  return lengths;
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

function renderTab(tab, rowIndex) {
  const tabEl = document.createElement("div");
  tabEl.className = "ctb-tab";
  tabEl.dataset.tabId = String(tab.id);
  tabEl.dataset.row = String(rowIndex);
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

  const effectiveMinW = tab.pinned ? Math.max(56, minW) : Math.max(120, minW);
  tabEl.style.minWidth = `${effectiveMinW}px`;
  tabEl.style.maxWidth = `${Math.max(effectiveMinW + 20, maxW)}px`;
  tabEl.style.padding = `${Math.max(2, pad)}px`;
  tabEl.style.fontSize = `${Math.max(10, labelSize)}px`;

  const icon = document.createElement("img");
  icon.className = "ctb-tab-icon";
  icon.style.width = `${Math.max(16, iconSize)}px`;
  icon.style.height = `${Math.max(16, iconSize)}px`;
  icon.alt = "";
  const iconFallback = chrome.runtime.getURL("assets/icons/icon16.png");
  const safeFavIcon = isSafeFaviconSource(tab.favIconUrl) ? tab.favIconUrl : "";
  icon.src = safeFavIcon || faviconURL(tab.url, Math.max(20, iconSize)) || iconFallback;
  icon.onerror = () => {
    if (icon.src !== iconFallback) {
      icon.src = iconFallback;
    }
  };
  tabEl.appendChild(icon);

  const pinnedIconOnly = state.settings.pinnedIconOnly && tab.pinned;
  if (!pinnedIconOnly) {
    const label = document.createElement("span");
    label.className = "ctb-tab-label";
    const titleText = safeText(tab.title) || safeText(tab.url) || "Tab";
    label.textContent = titleText;
    label.title = `${titleText}\n${safeText(tab.url)}`;
    tabEl.appendChild(label);
  }

  const metadata = document.createElement("span");
  metadata.className = "ctb-tab-metadata";
  if (tab.muted) metadata.textContent = "🔇";
  else if (tab.audible) metadata.textContent = "🔊";
  else if (tab.status === "loading") metadata.textContent = "…";
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
    draggingGroupTabIds = null;
    draggingTabId = tab.id;
    draggingFromRow = Number(tabEl.dataset.row);
    tabEl.classList.add("ctb-dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(tab.id));
    }
  });

  tabEl.addEventListener("dragover", (event) => {
    if (draggingTabId == null || draggingTabId === tab.id) return;
    event.preventDefault();
    const targetRow = Number(tabEl.dataset.row);
    const isCrossRow = Number.isFinite(draggingFromRow) && draggingFromRow !== targetRow;
    const rect = tabEl.getBoundingClientRect();
    const middleStart = rect.left + rect.width * 0.25;
    const middleEnd = rect.left + rect.width * 0.75;
    const centerIntent = event.clientX >= middleStart && event.clientX <= middleEnd;
    if (!(isCrossRow && centerIntent)) {
      event.stopPropagation();
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (isCrossRow && centerIntent) {
      // In cross-row drags, center hover means "move into row", not "insert before/after this tab".
      clearDropMarkers();
      return;
    }
    clearDropMarkers();
    const placeAfter = event.clientX > rect.left + rect.width / 2;
    tabEl.classList.add(placeAfter ? "ctb-drop-after" : "ctb-drop-before");
  });

  tabEl.addEventListener("dragleave", () => {
    tabEl.classList.remove("ctb-drop-before", "ctb-drop-after");
  });

  tabEl.addEventListener("drop", async (event) => {
    if (draggingTabId == null || draggingTabId === tab.id) {
      event.preventDefault();
      event.stopPropagation();
      clearDropMarkers();
      return;
    }
    const targetRow = Number(tabEl.dataset.row);
    const rect = tabEl.getBoundingClientRect();
    const isCrossRow = Number.isFinite(draggingFromRow) && draggingFromRow !== targetRow;
    const middleStart = rect.left + rect.width * 0.25;
    const middleEnd = rect.left + rect.width * 0.75;
    const centerIntent = event.clientX >= middleStart && event.clientX <= middleEnd;
    if (isCrossRow && centerIntent) {
      // Let row-level drop handler process this as a row move.
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const placeAfter = event.clientX > rect.left + rect.width / 2;
    await moveDraggedTabToTarget(draggingTabId, tab.id, placeAfter);
    clearDropMarkers();
  });

  tabEl.addEventListener("dragend", () => {
    draggingTabId = null;
    draggingFromRow = null;
    draggingGroupTabIds = null;
    clearDropMarkers();
    tabEl.classList.remove("ctb-dragging");
  });

  return tabEl;
}

function clearDropMarkers() {
  const marked = rootEl?.querySelectorAll(
    ".ctb-drop-before, .ctb-drop-after, .ctb-dragging, .ctb-group-drop-before, .ctb-group-drop-after, .ctb-group-dragging"
  );
  if (!marked) return;
  for (const el of marked) {
    el.classList.remove(
      "ctb-drop-before",
      "ctb-drop-after",
      "ctb-dragging",
      "ctb-group-drop-before",
      "ctb-group-drop-after",
      "ctb-group-dragging"
    );
  }
  const rowMarked = rootEl?.querySelectorAll(".ctb-row-drop-target");
  if (rowMarked) {
    for (const el of rowMarked) {
      el.classList.remove("ctb-row-drop-target");
    }
  }
}

async function moveDraggedTabToTarget(sourceTabId, targetTabId, placeAfter) {
  const ordered = sortTabs(state.tabs || []);
  const targetPos = ordered.findIndex((t) => t.id === targetTabId);
  if (targetPos < 0) return;
  const desiredPos = targetPos + (placeAfter ? 1 : 0);
  await moveTabToOrderedPosition(sourceTabId, desiredPos, ordered);
}

async function moveDraggedTabToRow(sourceTabId, rowIndex, rowStarts, rowLengths, sortedTabs) {
  if (!Array.isArray(sortedTabs) || sortedTabs.length === 0) return;
  if (rowIndex < 0 || rowIndex >= rowStarts.length) return;
  const desiredPos = Number(rowStarts[rowIndex] || 0) + Number(rowLengths[rowIndex] || 0);
  await moveTabToOrderedPosition(sourceTabId, desiredPos, sortedTabs);
}

async function moveDraggedGroupToRow(sourceTabIds, rowIndex, rowStarts, rowLengths, sortedTabs) {
  if (!Array.isArray(sortedTabs) || sortedTabs.length === 0) return;
  if (!Array.isArray(sourceTabIds) || sourceTabIds.length === 0) return;
  if (rowIndex < 0 || rowIndex >= rowStarts.length) return;
  const desiredPos = Number(rowStarts[rowIndex] || 0) + Number(rowLengths[rowIndex] || 0);
  await moveGroupToOrderedPosition(sourceTabIds, desiredPos, sortedTabs);
}

async function moveTabToOrderedPosition(sourceTabId, desiredPosInFullOrder, orderedTabs) {
  const sourcePos = orderedTabs.findIndex((t) => t.id === sourceTabId);
  if (sourcePos < 0) return;
  const source = orderedTabs[sourcePos];

  const fullMax = orderedTabs.length;
  const boundedFullPos = Math.max(0, Math.min(fullMax, Number(desiredPosInFullOrder)));
  let desiredPosWithoutSource =
    boundedFullPos - (sourcePos < boundedFullPos ? 1 : 0);

  const withoutSource = orderedTabs.filter((t) => t.id !== sourceTabId);
  const pinnedCount = withoutSource.reduce((acc, tab) => acc + (tab.pinned ? 1 : 0), 0);
  if (source.pinned) {
    desiredPosWithoutSource = Math.min(desiredPosWithoutSource, pinnedCount);
  } else {
    desiredPosWithoutSource = Math.max(desiredPosWithoutSource, pinnedCount);
  }
  desiredPosWithoutSource = Math.max(0, Math.min(withoutSource.length, desiredPosWithoutSource));

  let targetIndex = -1;
  if (desiredPosWithoutSource < withoutSource.length) {
    targetIndex = withoutSource[desiredPosWithoutSource].index;
    if (source.index < targetIndex) {
      targetIndex -= 1;
    }
  }

  if (targetIndex === source.index) return;
  await sendMessage({ type: "MOVE_TAB", tabId: source.id, index: targetIndex });
  focusedTabId = source.id;
}

async function moveGroupToOrderedPosition(sourceTabIds, desiredPosInFullOrder, orderedTabs) {
  const sourceIdSet = new Set(sourceTabIds);
  const sourceTabs = orderedTabs.filter((tab) => sourceIdSet.has(tab.id));
  if (sourceTabs.length === 0) return;

  const sourcePinned = Boolean(sourceTabs[0].pinned);
  const orderedSourceTabs = sourceTabs.filter((tab) => tab.pinned === sourcePinned);
  if (orderedSourceTabs.length === 0) return;
  const orderedSourceIds = orderedSourceTabs.map((tab) => tab.id);
  const effectiveSourceSet = new Set(orderedSourceIds);
  const withoutSource = orderedTabs.filter((tab) => !effectiveSourceSet.has(tab.id));

  const fullMax = orderedTabs.length;
  const boundedFullPos = Math.max(0, Math.min(fullMax, Number(desiredPosInFullOrder)));
  const sourceBeforeTarget = orderedTabs.reduce(
    (count, tab, index) => count + (index < boundedFullPos && effectiveSourceSet.has(tab.id) ? 1 : 0),
    0
  );
  let desiredPosWithoutSource = boundedFullPos - sourceBeforeTarget;

  const pinnedCount = withoutSource.reduce((acc, tab) => acc + (tab.pinned ? 1 : 0), 0);
  if (sourcePinned) {
    desiredPosWithoutSource = Math.min(desiredPosWithoutSource, pinnedCount);
  } else {
    desiredPosWithoutSource = Math.max(desiredPosWithoutSource, pinnedCount);
  }
  desiredPosWithoutSource = Math.max(0, Math.min(withoutSource.length, desiredPosWithoutSource));

  let targetIndex = -1;
  if (desiredPosWithoutSource < withoutSource.length) {
    targetIndex = withoutSource[desiredPosWithoutSource].index;
  }

  await sendMessage({ type: "MOVE_TABS_BLOCK", tabIds: orderedSourceIds, index: targetIndex });
  focusedTabId = orderedSourceIds[0];
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
  if (event.altKey && event.shiftKey && event.key.toLowerCase() === "b") {
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
