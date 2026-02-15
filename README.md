# BoomerTabs

BoomerTabs is a Chrome extension that adds a customizable tab overlay with larger, easier-to-read tab tiles.

## Features

- Large tab tiles with configurable:
  - tab width
  - row count
  - tabs per row
  - icon size
  - label size
  - padding
- Group-aware rendering with group color indicators
- Optional collapsed-group behavior
- Pinned tabs first, with optional icon-only pinned mode
- Search/filter by title or URL
- Search toggle icon that shows/hides a dedicated search row
- Drag-and-drop tab reorder on tab tiles (within pinned/unpinned sections)
- Multi-row layout where each row is horizontally scrollable
  - wheel scrolling maps to horizontal scroll
  - trackpad side gestures work via native overflow scrolling
  - scrollbar UI is hidden to preserve vertical space
- Auto-hide with edge activation
- One-click hide button and hotkey toggle (`Alt+Shift+B`)
- Top or bottom placement
- Layout mode:
  - `overlay` (default behavior over page)
  - `push` (adds page padding so content stays below/above the bar)
- Keyboard navigation (Left/Right, Enter, Delete) scoped to overlay interaction
- Context menu actions (activate, close, pin/unpin, group/ungroup, close others)
- Popup quick controls for enable/disable, position, layout mode, rows, tabs-per-row, and groups

## Privacy

BoomerTabs does not send browsing data to any external servers.
All state is handled locally in Chrome APIs and extension storage.

## Install (Developer Mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`boomertabs`)

## Configure

Open extension options from:

- Extension popup -> **Open BoomerTabs settings**
- Or right click extension icon -> **Options**

## Notes

- Chrome extensions cannot modify Chrome's native tab strip.
  BoomerTabs renders a separate overlay bar on top of webpage content only.
  It cannot draw over Chrome's own native tab bar/address bar area.
- Default placement is footer (`bottom`) for less interference with page headers.
- Restricted pages (e.g. `chrome://*`) will not display the overlay.
