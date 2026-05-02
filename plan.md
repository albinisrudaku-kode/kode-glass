# kode-glass: Accessibility Audit Chrome Extension

> A diagnostic X-ray tool for QA teams to audit screen reader compatibility through visual accessibility overlays.

---

## 🎯 Project Vision

**kode-glass** is a diagnostic "X-ray" Chrome Extension designed for QA teams. It uses proven accessibility engines to translate page accessibility data into visual overlays, allowing professionals to audit screen reader compatibility manually without requiring audio feedback.

**Core Purpose:** Bridge the gap between what is visually rendered and what is programmatically communicated to assistive technology.

---

## 🏗️ Technical Architecture

### Core Components

| Component | Role | Key Responsibility |
| --------- | ---- | ------------------ |
| **Angular Frontend (Side Panel)** | Control Center | Persistent, non-intrusive workspace via `chrome.sidePanel` API |
| **Content Script (The Lens)** | Page Lens | Runs accessibility engines, gathers spatial data, and manages SVG overlays |
| **Background Service Worker** | Hub | State management, cross-tab communication, off-main-thread calculations |

### Accessibility Engine Layer

The extension does not reimplement accessibility rules from scratch. It wraps established open-source engines and normalizes their results into a shared kode-glass report format.

- **axe-core**
  - Primary in-browser accessibility engine
  - WCAG and ARIA rule coverage
  - Produces violation metadata and target selectors

- **Playwright**
  - Used for internal validation and later workflow automation
  - Helps verify focus order, screenshots, and extension behavior

### Visual-Semantic Diff

kode-glass adds visual diagnostics on top of engine results:

- **Spatial Mapping**
  - Uses `getBoundingClientRect()` and Intersection Observers
  - Links visual elements to Accessibility Tree nodes

- **Violation Mapping**
  - Maps engine findings to visible page elements
  - Highlights buttons, links, inputs, headings, and landmarks with issue context

- **Semantic Mismatch**
  - Detects visual intent without semantic correspondence
  - Example: Hamburger icon without role/label

---

## 📦 Key Functional Modules

### Module 1: Live Visual Subtitles

**Purpose:** Real-time accessibility feedback during interaction

- **Speech Bubbles**
  - Tooltips on hover/keyboard focus
  - Display: Name, Role, State

- **Severity Coding**
  - 🔴 **Red:** Critical (element is silent/ignored)
  - 🟡 **Yellow:** Warning (vague names like "click here" or "link_123")
  - 🟢 **Green:** Validated (properly labeled and semantic)

### Module 2: Tab-Path & Focus Tracker

**Purpose:** Reveal page reading order and focus flow

- **Breadcrumb Trail**
  - Persistent SVG line connecting tab sequence
  - Shows visual representation of screen reader path

- **Focus Trap Alerts**
  - Visual indicators for modals/interactive elements
  - Detects when focus cannot return to main page flow

### Module 3: Structural Inspector

**Purpose:** Validate semantic structure

- **Landmark Overlay**
  - Color-coded regions: Header, Nav, Main, Footer
  - Ensures logical semantic structure

- **Heading Hierarchy**
  - Visual map of H1–H6 tags
  - Verifies sequential heading levels without code inspection

---

## 🎨 Angular Interface (Side Panel)

Built with **Angular v20+ Signals** and **Taiga UI** for high-performance reactive updates and accessible UI primitives.

### Reactive State

```typescript
activeNode        // Details of current focused element
violationLog      // Running list of accessibility errors
```

### QA Tooling

- **Layer Toggles**
  - One-click switches for overlays:
    - Show Landmarks
    - Show Focus Path
    - Highlight All Errors

- **Report Generator**
  - Screenshots with overlays
  - Auto-generates Markdown bug reports for Jira/GitHub

---

## 🔒 Security & Isolation

- **Shadow DOM Encapsulation**
  - All overlays injected in Shadow Root
  - Prevents host website CSS interference

- **CSP Compliance**
  - Manifest V3 security protocols
  - No external scripts executed on host page

- **Session Integrity**
  - Maintains user login/session state
  - Enables testing of authenticated dashboards and private environments

---

## 🚀 Implementation & Success Metrics

### Tech Stack

- **Frontend:** Angular v20+, Taiga UI
- **Accessibility Engine:** axe-core
- **Testing:** Playwright (extension workflow and accessibility validation)
- **Extension:** Manifest V3

### Success Criteria

| Target | Metric |
| ------ | ------ |
| **Accuracy** | 100% detection of "Silent Icons" and "Focus Traps" |
| **Speed** | Complete analysis within 60 seconds of page load |
| **Impact** | 50% reduction in accessibility bug reporting time |
| **Automation** | Auto-screenshot + metadata collection |

---

## 📋 Next Steps

- [x] Setup Angular project structure + Chrome Extension scaffolding
- [x] Implement Content Script engine runner
- [x] Integrate axe-core and normalize reports
- [x] Create Side Panel UI with Signals state management
- [x] Develop SVG overlay system
- [x] Integrate report generation
- [ ] End-to-end validation with test sites
