# Kode Glass

Kode Glass is a Chrome extension for visual accessibility diagnostics. It runs automated checks against the active page, opens the results in a Chrome side panel, and can draw page overlays so QA teams can inspect issues in context.

The extension combines `axe-core` and `IBM Equal Access` checks, groups duplicate findings, summarizes document structure, and generates a Markdown-ready accessibility report.

## Features

- Chrome Manifest V3 extension with a side panel UI.
- Angular and Taiga UI interface for analysis controls, filters, and reports.
- Automated accessibility scans with `axe-core` and `IBM Equal Access`.
- `WCAG A`, `AA`, `AAA`, and `best-practice` audit scopes.
- Visual page overlays for errors, landmarks, and focus path inspection.
- Reader and inspect preview modes with optional speech synthesis.
- Severity and source filters for critical, warning, and informational findings.
- Page structure summaries for headings and landmarks.
- Markdown report generation with engine status, violations, headings, and landmarks.

## Requirements

- Node.js `>=20.19.0`
- npm
- Google Chrome or another Chromium browser that supports Manifest V3 side panels

## Getting Started

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

The production extension bundle is written to `dist/`.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the generated `dist/` folder.
5. Open a normal `http` or `https` page.
6. Click the Kode Glass extension action to open the side panel.
7. Select an audit scope and run **Analyze page**.

Chrome blocks extension scripts on some internal pages, browser stores, and restricted URLs. Use a regular web page when testing scans.

## Development

Run a watched development build:

```bash
npm run dev
```

After a watched rebuild, reload the extension from `chrome://extensions` and refresh the target tab before testing changes.

Run TypeScript checks:

```bash
npm run typecheck
```

Create a production build:

```bash
npm run build
```

## Project Structure

```text
public/
    manifest.json          Chrome extension manifest and static assets
src/background/          Service worker for side panel and tab coordination
src/content-script/      Page integration, overlays, reader mode, scan messages
src/shared/              Report types, filters, and accessibility engines
src/side-panel/          Angular side panel app and styles
```

Key bundles are configured in `webpack.config.js`:

- `background.js` handles extension events, tab state, script injection, and side panel hydration.
- `content-script.js` owns page overlays, reader mode, and runtime messages.
- `analysis-runner.js` exposes the page analysis function used by the content script.
- `side-panel.html`, `side-panel.js`, and `side-panel.css` power the Angular UI.

## How It Works

1. The user clicks the extension action on a tab.
2. The background service worker enables and opens the side panel for that tab.
3. The content script is injected if it is not already available.
4. When analysis is requested, the analyzer bundle runs page checks with the selected audit settings.
5. Results are normalized, deduplicated, and sent to the side panel.
6. The side panel displays grouped findings, structure data, engine status, and a Markdown report.
7. Overlay settings are sent back to the content script so issues, landmarks, and focus details can be shown directly on the page.

## Notes

- `IBM Equal Access` is skipped for `WCAG A-only` scans.
- Analysis times out after 30 seconds in the side panel if a page blocks extension scripts or the scan is too expensive.
- The extension currently uses the `activeTab`, `sidePanel`, `scripting`, and `tabs` permissions.
