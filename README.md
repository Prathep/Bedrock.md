# Bedrock Launcher (Offline / Privacy-Focused)

Bedrock is an independent, offline-first **Electron Main Process bootstrap layer** for running desktop markdown knowledge vaults. It manages application lifecycle, privileged custom URI schemes, native system integrations, and securely launches the primary application package (`bedrock.asar` or `obsidian.asar`).

This version is rebranded as **Bedrock** and customized to **remove all telemetry, auto-updater calls, and connections to Obsidian servers, sites, and repositories**, while **leaving Obsidian community plugin and theme URLs intact** so you can install and manage community plugins.

---

## Table of Contents

- [Architectural Overview](#architectural-overview)
- [Modifications & Network Privacy](#modifications--network-privacy)
- [Application Data & Directory Paths](#application-data--directory-paths)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation & Dependency Setup](#installation--dependency-setup)
- [Running in Development Mode](#running-in-development-mode)
- [Building & Packaging](#building--packaging)
- [Deploying to an Obsidian Installation](#deploying-to-an-obsidian-installation)
- [Project Structure](#project-structure)
- [Troubleshooting & Logs](#troubleshooting--logs)

---

## Architectural Overview

The desktop client consists of two distinct layers:

1. **`app.asar` (This Repository - Bedrock Launcher)**:
   - The Electron main process entry point (`main.js`).
   - Configures the application identity as `Bedrock`.
   - Responsible for application bootstrapping, registering privileged URL protocols (`app://`), configuring `@electron/remote`, loading native modules (`btime`, `get-fonts`), and verifying/loading the app package.
2. **`bedrock.asar` (or `obsidian.asar`)**:
   - The compiled UI application (vault manager, markdown editor, workspace layout, canvas, graph view, etc.).
   - Loaded dynamically by `main.js` from the application bundle (`APP_PATH`) or user data directory. Supports both `bedrock.asar` and legacy `obsidian.asar`.

---

## Modifications & Network Privacy

The following changes ensure zero outbound connections to official Obsidian servers while preserving community plugin installation:

1. **Telemetry & Tracking Removed**:
   - Removed device tracking ID generation.
   - Removed hardware/OS and version ping to `releases.obsidian.md`.
2. **Auto-Updater Disabled**:
   - Removed GitHub desktop release queries (`desktop-releases.json`).
   - Removed direct updater queries against `releases.obsidian.md`.
   - Removed the hourly background update timer and auto-download routines.
   - Handled internal update events (`check-start` / `check-end`) as clean no-ops to prevent UI hangs.
3. **Session-Level Request Blocking**:
   - Intercepts outbound HTTP/HTTPS requests at the Electron `session.webRequest` level.
   - **Blocked**:
     - Any requests to `obsidian.md` and all subdomains (`releases.obsidian.md`, `sync.obsidian.md`, `publish.obsidian.md`, `help.obsidian.md`, `forum.obsidian.md`, etc.).
     - Non-plugin repository requests under `github.com/obsidianmd/` and `raw.githubusercontent.com/obsidianmd/` (such as `desktop-releases.json`).
   - **Allowed (Obsidian Plugin Exception)**:
     - Community plugin directory & stats: `community-plugins.json`, `community-plugin-stats.json`.
     - Community theme directory & stats: `community-css-themes.json`, `community-theme-stats.json`.
     - Community plugin downloads directly from individual author repositories on GitHub.
   - **Internal Schemes**:
     - Local Electron protocols (`app://`, `file://`) remain completely unrestricted.

---

## Application Data & Directory Paths

With the application renamed to **Bedrock**, user data, configurations, and logs are located at:

- **Windows**:
  ```
  %APPDATA%\Bedrock\
  ```
  *(e.g., `C:\Users\<Username>\AppData\Roaming\Bedrock\`)*
- **Linux**:
  ```
  ~/.config/Bedrock/
  ```
- **macOS**:
  ```
  ~/Library/Application Support/Bedrock/
  ```

### Log File
Bedrock writes main process logs to:
- **Windows**: `%APPDATA%\Bedrock\bedrock.log`
- **Linux**: `~/.config/Bedrock/bedrock.log`
- **macOS**: `~/Library/Application Support/Bedrock/bedrock.log`

---

## Tech Stack

- **Runtime Environment**: [Node.js](https://nodejs.org/) (v20+ / v24+)
- **Application Framework**: [Electron](https://www.electronjs.org/)
- **IPC & Remote Management**: `@electron/remote`
- **Native Node.js Addons (C++ / Objective-C)**:
  - `btime`: C++ native addon utilizing `node-addon-api` to read and modify file birthtime (creation date) on Windows and macOS.
  - `get-fonts`: Native addon to query system-installed fonts across Windows, macOS, and Linux.
- **Archive Format**: Electron ASAR (`@electron/asar` / `asar`)

---

## Prerequisites

- **Node.js** (v18.x, v20.x, or v24.x recommended)
- **npm** (bundled with Node.js)
- **Electron** (installed locally or via `npx electron`)
- An existing copy of `bedrock.asar` or `obsidian.asar`

---

## Installation & Dependency Setup

1. Clone or navigate to the project directory:
   ```bash
   cd F:\Git\app
   ```

2. Install runtime dependencies:
   ```bash
   npm install
   ```

> **Note on Native Addons**: If you need to rebuild the native C++ modules (`btime` and `get-fonts`) for your specific Electron ABI version, run:
> ```bash
> npx @electron/rebuild
> ```

---

## Running in Development Mode

To launch Bedrock in development mode:

1. **Obtain the Core ASAR**:
   Place a copy of `bedrock.asar` (or `obsidian.asar`) in the project root directory alongside `main.js`:
   ```
   F:\Git\app\
   ├── main.js
   ├── package.json
   ├── bedrock.asar (or obsidian.asar)    <-- Place here
   └── node_modules\...
   ```

2. **Start the Electron Application**:
   ```bash
   npm start
   ```
   or directly with `electron`:
   ```bash
   npx electron .
   ```

3. **Development Flags**:
   - To inspect the Node process with Chrome DevTools:
     ```bash
     npx electron --inspect=9229 .
     ```
   - To enable verbose logging:
     ```bash
     npx electron --enable-logging .
     ```

---

## Building & Packaging

To compile this project into an `app.asar` archive:

1. Ensure `@electron/asar` is available:
   ```bash
   npm install --save-dev @electron/asar
   ```
   *(or use `npx asar`)*

2. Build the `app.asar` file:
   ```bash
   npx asar pack . app.asar --unpack-dir "node_modules/{btime,get-fonts}"
   ```
   or using the script defined in `package.json`:
   ```bash
   npm run pack
   ```

---

## Deploying to an Obsidian Installation

You can use Bedrock in place of the default launcher in an existing installation:

### 1. Locate Installation Resources Directory
- **Windows**:
  ```
  %LOCALAPPDATA%\Programs\obsidian\resources\
  ```
- **macOS**:
  ```
  /Applications/Obsidian.app/Contents/Resources/
  ```
- **Linux**:
  ```
  /opt/Obsidian/resources/
  ```

### 2. Backup the Original
Before applying changes, make a backup of the original `app.asar`:
```bash
cp resources/app.asar resources/app.asar.backup
```

### 3. Apply Bedrock
Choose either method:

#### Method A: Packed ASAR
Copy your newly built `app.asar` into the `resources` directory:
```bash
copy app.asar "%LOCALAPPDATA%\Programs\obsidian\resources\app.asar"
```

#### Method B: Unpacked Folder
Electron automatically prioritizes a folder named `app` over `app.asar`:
1. Copy or link this repository folder directly into the `resources` directory as `resources/app`:
   ```
   resources/
   ├── app/             <-- This folder (main.js, package.json, node_modules)
   ├── app.asar         <-- (Ignored by Electron if app/ is present)
   └── obsidian.asar    <-- (Core application package, or bedrock.asar)
   ```
2. Launch the application.

---

## Project Structure

```
F:\Git\app\
├── main.js             # Electron main process entry point, Bedrock identity & security filters
├── package.json        # Bedrock package metadata, scripts, and dependencies
├── README.md           # Project documentation and developer guide
└── node_modules\
    ├── @electron/      # Remote IPC main handler
    ├── btime/          # Native file birthtime addon
    └── get-fonts/      # Native system font enumeration addon
```

---

## Troubleshooting & Logs

- **Log File**: Bedrock writes main process logs to:
  - **Windows**: `%APPDATA%\Bedrock\bedrock.log`
  - **Linux**: `~/.config/Bedrock/bedrock.log`
  - **macOS**: `~/Library/Application Support/Bedrock/bedrock.log`
- **Verifying Blocked Connections**: Inspect `bedrock.log` to see blocked requests:
  ```
  Blocked request to external server/site: <url>
  ```
- **Community Plugins**: Open settings and browse Community Plugins; Bedrock leaves Obsidian plugin and theme registries and GitHub repositories open, so downloading and updating plugins works without connecting to Obsidian sync/telemetry/servers.
