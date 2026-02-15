# MegaTabs Privacy Policy

## Summary

MegaTabs does not collect, sell, or transmit personal data to external servers.

## Data Access

MegaTabs uses Chrome extension APIs to read tab and tab-group metadata needed to render the overlay:

- tab title
- tab URL
- favicon URL
- tab/group state (active, pinned, grouped, collapsed, etc.)

This data is used locally in the browser to render UI and handle tab actions.

## Data Storage

MegaTabs stores user preferences in `chrome.storage.sync` (or equivalent Chrome extension storage).
Examples:

- sizing settings
- theme colors
- row count / tabs per row
- visibility and behavior toggles

No browsing content or settings are sent to any external service.

## Network Usage

MegaTabs does not call third-party APIs.
It only uses Chrome internal APIs (for example `_favicon`) for local favicon rendering.

## Contact

If you publish MegaTabs, replace this section with your support contact.
