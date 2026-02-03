# PRD — Gorka Copilot Overlay (Unreal-first, Engine-Agnostic Core)

## 0) Summary
Gorka Copilot Overlay is a lightweight desktop overlay assistant for game developers. It provides instant, contextual help while building games—starting with Unreal Engine 5. The MVP uses **structured context from an Unreal connector (logs/errors)** plus **on-demand screenshots** (hotkey) to produce accurate, actionable fixes and guidance via an AI model.

**MVP goal:** Ship a reliable Unreal-focused assistant that solves “I’m stuck” moments in under 60 seconds, without continuous screen streaming.

---

## 1) Goals & Non-Goals

### Goals (MVP)
- Provide fast, high-quality help for common Unreal dev blockers:
  - Packaging failures
  - Compile errors (C++/Blueprint-related output)
  - Runtime errors shown in logs
  - Common workflow questions (best practices, “how do I do X?”)
- Deliver a polished overlay UI that:
  - Is always-on-top
  - Minimally invasive
  - Supports hotkeys and quick capture
- Integrate with Unreal Engine via a connector plugin that streams structured context to the app.
- Support on-demand screenshot capture (full screen / window / region) as optional context for AI.

### Non-Goals (MVP)
- Full “auto-fix” (editing Blueprints automatically) beyond small, safe “guided apply” actions.
- Continuous live screen streaming/video analysis.
- Deep multi-engine support (Unity/Godot/Blender connectors). (Architecture should allow it later.)
- Project file uploads to cloud by default (keep privacy posture conservative).

---

## 2) Target Users & Use Cases

### Primary User (MVP)
- Unreal Engine 5 developers (solo devs, hobbyists, indie teams)
- Users who frequently hit blockers and want immediate guidance

### Top Use Cases
1. **Packaging failure**
   - User builds for Windows/Mac and it fails
   - Copilot reads packaging log errors and suggests exact fixes
2. **Compile / Blueprint error**
   - User sees compile errors or warnings
   - Copilot explains root cause and steps to fix
3. **“How do I do X?”**
   - User asks “How do I make interaction system / save system / etc.?”
   - Copilot returns an actionable plan and optional code/snippet
4. **UI/Editor confusion**
   - User screenshots an Unreal panel issue
   - Copilot provides UI-specific click paths and guidance

---

## 3) Product Principles
- **On-demand capture** > always-on capture (cost, privacy, simplicity)
- **Structured context first** (logs/errors/metadata) > pixels-only guessing
- **Fast feedback loop**
  - “Ask → Answer” should feel near-instant
- **Actionable outputs**
  - Always provide steps, not vague advice
- **Trust & safety**
  - Never apply destructive changes without preview/confirmation

---

## 4) MVP Scope — Features

## 4.1 Desktop Overlay App (Core)
### Overlay UI
- Always-on-top small panel
- Modes:
  - Collapsed: small icon/handle
  - Expanded: chat + context chips
- Drag to reposition
- Resizable (small → medium)
- “Pin” toggle (always on top)
- Optional: “click-through background” except the panel itself

### Core Controls
- Input box: “What are you trying to do?”
- Buttons:
  - **Ask** (send text + current context)
  - **Capture** (attach screenshot: full/window/region)
  - **Connect** status (Unreal connector status)
- Streaming output area (answer renders as it arrives)

### Hotkeys (Configurable)
- Toggle overlay show/hide
- Capture full screen
- Capture window
- Capture region (snipping mode)
- “Ask with current context” (no screenshot)

### Context Chips (Visible)
- Engine: Unreal (MVP)
- Connection status: Connected / Disconnected
- Last context time: “Updated 10s ago”
- Optional: Project name, UE version (if available)

### History & Local Storage
- Store last N sessions (e.g., 100)
- Each session stores:
  - user prompt
  - model response
  - attached context snapshot
  - attached screenshot (optional; local only)
- Export:
  - “Copy response”
  - “Copy markdown report”

---

## 4.2 Screen Capture (On-demand)
### Capture Modes
- Full screen screenshot
- Window screenshot (choose from available windows)
- Region capture
  - Snipping UI: transparent fullscreen overlay where user drags rectangle
  - Crop from captured screen image

### Permissions
- macOS: handle Screen Recording permission prompts
- Windows: standard desktop capture APIs via Electron

### Privacy Defaults
- **No continuous capture**
- Screenshot is captured only on explicit user action

---

## 4.3 Unreal Engine Connector (MVP Plugin)
### Responsibilities
- Stream structured context to the desktop app over localhost WebSocket.
- Provide:
  - Output log lines
  - Error blocks (compile/build/packaging)
  - Basic project metadata

### Data to Send (MVP)
- Project info:
  - project_name
  - engine_version
  - platform (editor platform)
- Log stream:
  - timestamp
  - category
  - verbosity
  - message
- Error event:
  - error_type: `packaging | compile | runtime | blueprint | unknown`
  - raw_block: relevant multi-line block (stack traces, etc.)
  - file_paths (if parsed)
  - asset_paths (if parsed)
- Snapshot event:
  - last_200_log_lines (configurable)
  - last_error_event

### Connection
- WebSocket to `ws://127.0.0.1:<port>`
- App listens on port (configurable)
- Plugin reconnects if app restarts

### Unreal Compatibility
- UE5.3+ minimum (configurable)
- Must not significantly impact performance

---

## 4.4 AI Assistant Layer
### Inputs (Text-only default)
- User prompt
- Unreal context snapshot:
  - last logs
  - last error block
  - project metadata
- Optional: user-selected “mode” (Packaging / Blueprint / Performance / General)

### Inputs (Vision optional)
- Everything above +
- screenshot image (png/jpg), possibly with:
  - active window title (if available)
  - capture type: full/window/region

### Output Format Requirements
- Always return:
  - **Diagnosis** (1–3 bullet points)
  - **Fix Steps** (numbered steps)
  - **If still broken** (next debugging steps)
  - **Copy/Paste** (only if needed; keep minimal)
- Prefer Unreal-specific terminology and editor click paths.
- Avoid generic “try reinstall” advice unless truly relevant.

### Model Routing
- Text-only by default
- Vision only when screenshot attached

### Cost Controls
- Summarize logs before sending if too large:
  - truncate or compress with a local summarizer step
- Max context window rules:
  - last 200 lines OR last 25KB of text
  - always include last error block

---

## 5) Future (Post-MVP) Modules (Not in MVP)
### Guided Apply (Safe Automation)
- Apply .ini changes with preview
- Generate utility widget / plugin scaffold
- Run “diagnostic scripts” via Unreal Remote Control / Python

### Asset Pack → Prototype Generator (Module)
- One-click template generation (single genre first)
- Level layout generation + UI + objective loop

### Steam Page Converter (Module)
- Web-based generator:
  - tags, copy, capsule checklist, trailer script/shot list

### Multi-Engine Support
- Add connectors for:
  - Unity (Editor package reading Console/build logs)
  - Godot (editor plugin, output logs)
  - Blender (addon via Python)

---

## 6) User Flows

### Flow A — Packaging Fix
1. User builds package in Unreal → fails
2. Unreal connector sends error block + logs
3. User opens overlay → clicks **Ask**
4. Copilot returns:
   - diagnosis + fix steps
   - copy/paste snippets if needed
5. User retries packaging

### Flow B — Screenshot Assist
1. User sees weird editor UI issue
2. Hotkey **Capture Region**
3. Overlay attaches screenshot → user asks question
4. Copilot answers with click-by-click guidance

### Flow C — Disconnected Mode
1. Unreal not running or plugin not installed
2. Overlay still works:
   - user can paste logs manually
   - screenshot assist still works
3. UI shows “Unreal: Disconnected”

---

## 7) UX Requirements
- Overlay must not steal focus unnecessarily
- Must be movable and resizable
- Provide clear “connected to Unreal” indicator
- Provide “copy answer” and “copy fix steps” buttons
- Provide “report mode” output in markdown

---

## 8) Technical Requirements

### Desktop App
- Electron + TypeScript
- UI: React + Tailwind
- IPC between main process and renderer
- WebSocket server (localhost) for connectors
- Screenshot capture using Electron desktopCapturer
- Persistent storage:
  - SQLite or local JSON (MVP can start with JSON)

### Unreal Plugin
- C++ plugin
- WebSocket client
- Hooks into Unreal logging pipeline
- Basic parsing of packaging/compile errors
- Config file:
  - server host/port
  - log buffer size
  - enable/disable streaming

### Security/Privacy
- All connector traffic remains localhost
- Default: do not upload screenshots/logs unless user asks (Ask button)
- Provide “Clear history” button
- Provide “Disable screenshot capture” toggle

---

## 9) Telemetry (Optional, MVP-lite)
- Local-only counters (no remote analytics by default):
  - number of asks
  - number of screenshot assists
  - most common error categories
- If remote telemetry is desired later:
  - explicit opt-in
  - anonymized

---

## 10) Acceptance Criteria (MVP)
- Overlay launches on macOS and Windows
- Overlay can be toggled by hotkey
- Overlay always-on-top and draggable
- Screenshot capture works (full/window/region) and attaches to request
- Unreal plugin connects automatically and streams logs/errors
- “Packaging failure” demo works end-to-end:
  - plugin sends error block
  - overlay asks model
  - returns fix steps that are relevant to the error text
- History stores last 100 interactions locally
- App remains responsive during streaming responses

---

## 11) Milestones
### Milestone 1 — Overlay Skeleton
- Electron app runs
- overlay always-on-top
- hotkeys work
- basic chat UI

### Milestone 2 — Screenshot Capture
- full/window capture
- region capture snipping UI
- attach image to request

### Milestone 3 — Unreal Connector
- plugin connects via WebSocket
- streams logs
- sends error block snapshots

### Milestone 4 — AI Integration
- text-only help works using logs/errors
- vision mode works with screenshot
- stable output formatting (diagnosis + steps + next debug)

### Milestone 5 — MVP Polish
- settings page (hotkeys, privacy toggles)
- history + export
- installer builds for macOS + Windows

---

## 12) Prompting Spec (System Instructions for the Assistant)
Use a system prompt like:

- You are an expert Unreal Engine technical assistant.
- You receive:
  - user intent
  - Unreal log excerpts
  - error blocks
  - optional screenshot
- Output must include:
  - Diagnosis (bullets)
  - Fix Steps (numbered)
  - If still broken (next debug checks)
  - Minimal code snippets only when necessary
- Never suggest destructive actions without warning.
- Prefer Unreal best practices (interfaces over frequent casts, avoid tick abuse, etc.)

---

## 13) Connector Event Schema (Unified, for Future Engines)
All connectors send JSON events like:

### Event: project_info
```json
{
  "type": "project_info",
  "engine": "unreal",
  "project_name": "MyProject",
  "engine_version": "5.4.1",
  "platform": "macOS",
  "timestamp": 1730000000
}
