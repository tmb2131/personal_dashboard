"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  net,
  screen,
  session,
  shell,
  nativeTheme,
  powerMonitor,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_URL = "https://personal-dashboard-five-sable.vercel.app";

// Google rejects OAuth from anything it can spot as an embedded browser. Two
// separate signals have to line up: the UA string, and the Sec-CH-UA client
// hints. Electron's hints advertise `Chromium` with no `Google Chrome` brand,
// which is enough to fail the check even when the UA string looks clean.
const CHROME_VERSION = process.versions.chrome;
const CHROME_MAJOR = CHROME_VERSION.split(".")[0];

app.userAgentFallback =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  `(KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`;

const CLIENT_HINTS = {
  "Sec-CH-UA":
    `"Google Chrome";v="${CHROME_MAJOR}", "Chromium";v="${CHROME_MAJOR}", ` +
    '"Not?A_Brand";v="24"',
  "Sec-CH-UA-Full-Version-List":
    `"Google Chrome";v="${CHROME_VERSION}", "Chromium";v="${CHROME_VERSION}", ` +
    '"Not?A_Brand";v="24.0.0.0"',
  "Sec-CH-UA-Mobile": "?0",
  "Sec-CH-UA-Platform": '"macOS"',
};

function applyClientHints() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: { ...details.requestHeaders, ...CLIENT_HINTS },
    });
  });
}

// Google sign-in redirects through these; everything else opens in the real
// browser rather than hijacking the dashboard window.
const AUTH_HOSTS = new Set([
  "accounts.google.com",
  "accounts.youtube.com",
  "oauth2.googleapis.com",
]);

// The web app polls on its own, but a laptop that slept for hours comes back
// showing stale data — reload if the page has been sitting untouched.
const STALE_AFTER_MS = 10 * 60 * 1000;

let mainWindow = null;
let appOrigin = null;
let lastLoadedAt = 0;
let quitting = false;

function userFile(name) {
  return path.join(app.getPath("userData"), name);
}

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    // Losing window position or config is not worth crashing over.
  }
}

/**
 * Where to point the window. `DASHBOARD_URL=http://localhost:3000 npm start`
 * covers local development; otherwise it comes from a config file that is
 * written on first run so it can be edited without a rebuild.
 */
function dashboardUrl() {
  if (process.env.DASHBOARD_URL) {
    return process.env.DASHBOARD_URL.replace(/\/+$/, "");
  }
  const file = userFile("config.json");
  const existed = fs.existsSync(file);
  const config = readJson(file, { url: DEFAULT_URL, desktopToken: "" });
  if (!existed) writeJson(file, config);
  return String(config.url || DEFAULT_URL).replace(/\/+$/, "");
}

/**
 * Shared secret that stands in for Google sign-in. Must equal DESKTOP_TOKEN on
 * the server. Kept in the user-data config file rather than the repo.
 */
function desktopToken() {
  if (process.env.DESKTOP_TOKEN) return process.env.DESKTOP_TOKEN;
  const config = readJson(userFile("config.json"), { desktopToken: "" });
  return String(config.desktopToken || "");
}

function isInternal(target) {
  try {
    const url = new URL(target);
    if (url.protocol === "file:") return true;
    if (url.origin === appOrigin) return true;
    return AUTH_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function openExternally(target) {
  if (/^https?:$/.test(new URL(target).protocol)) {
    shell.openExternal(target);
  }
}

/** Restore the last window position, unless that display is gone. */
function restoredBounds() {
  const fallback = { width: 1180, height: 860 };
  const saved = readJson(userFile("window-state.json"), null);
  if (!saved || typeof saved.x !== "number" || typeof saved.y !== "number") {
    return fallback;
  }
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      saved.x < area.x + area.width &&
      saved.x + saved.width > area.x &&
      saved.y < area.y + area.height &&
      saved.y + saved.height > area.y
    );
  });
  return visible ? saved : fallback;
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  if (mainWindow.isFullScreen()) return;
  writeJson(userFile("window-state.json"), mainWindow.getNormalBounds());
}

/** POST a form to the app and return the parsed JSON body, if any. */
function postForm(url, fields) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(fields).toString();
    // useSessionCookies is what makes this share the window's cookie jar, in
    // both directions — without it the CSRF cookie never goes out and the
    // session cookie that comes back is dropped.
    const request = net.request({
      method: "POST",
      url,
      session: session.defaultSession,
      useSessionCookies: true,
    });
    request.setHeader("Content-Type", "application/x-www-form-urlencoded");
    request.on("response", (response) => {
      let text = "";
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () => resolve({ status: response.statusCode, text }));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      session: session.defaultSession,
      useSessionCookies: true,
    });
    request.on("response", (response) => {
      let text = "";
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

/**
 * Exchange the desktop token for an ordinary Auth.js session cookie. Google
 * blocks its own OAuth inside an embedded browser, so the app never shows a
 * sign-in screen — it authenticates itself before the first page load.
 * Cookies land in the shared session jar, so the window is signed in.
 */
async function signInWithDesktopToken() {
  const token = desktopToken();
  if (!token) {
    console.warn("desktop sign-in: no desktopToken in config.json");
    return false;
  }

  try {
    const { csrfToken } = await getJson(`${appOrigin}/api/auth/csrf`);
    if (!csrfToken) return false;

    const { status } = await postForm(`${appOrigin}/api/auth/callback/desktop`, {
      csrfToken,
      token,
      callbackUrl: appOrigin,
      json: "true",
    });
    if (status >= 400) {
      console.warn(`desktop sign-in: server returned ${status}`);
      return false;
    }

    const cookies = await session.defaultSession.cookies.get({ url: appOrigin });
    const signedIn = cookies.some((c) => c.name.includes("session-token"));
    if (!signedIn) {
      console.warn("desktop sign-in: rejected — does DESKTOP_TOKEN match?");
    }
    return signedIn;
  } catch (error) {
    console.warn(`desktop sign-in: ${error.message}`);
    return false;
  }
}

async function loadDashboard() {
  const url = dashboardUrl();
  appOrigin = new URL(url).origin;

  const cookies = await session.defaultSession.cookies
    .get({ url: appOrigin })
    .catch(() => []);
  if (!cookies.some((cookie) => cookie.name.includes("session-token"))) {
    await signInWithDesktopToken();
  }

  mainWindow.loadURL(url);
}

function showOfflinePage() {
  mainWindow.loadFile(path.join(__dirname, "offline.html"), {
    query: { url: dashboardUrl() },
  });
}

function reloadIfStale() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (Date.now() - lastLoadedAt < STALE_AFTER_MS) return;
  mainWindow.webContents.reload();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...restoredBounds(),
    minWidth: 720,
    minHeight: 560,
    title: "Personal Dashboard",
    show: false,
    // Matches --bg in globals.css, so there is no white flash before paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1a1814" : "#f5f1e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  for (const event of ["resize", "move"]) {
    mainWindow.on(event, saveBounds);
  }

  // Keep the app running when the window is closed — Cmd+Q is the real quit.
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    saveBounds();
    mainWindow.hide();
  });

  mainWindow.on("show", reloadIfStale);
  mainWindow.on("focus", reloadIfStale);

  const contents = mainWindow.webContents;

  contents.on("did-finish-load", () => {
    lastLoadedAt = Date.now();
  });

  contents.on("will-navigate", (event, target) => {
    if (isInternal(target)) return;
    event.preventDefault();
    openExternally(target);
  });

  contents.setWindowOpenHandler(({ url }) => {
    // Links the app opens in a new tab belong in the browser; in-app
    // destinations load in place so we never end up with a stray window.
    if (isInternal(url)) {
      contents.loadURL(url);
    } else {
      openExternally(url);
    }
    return { action: "deny" };
  });

  contents.on("did-fail-load", (_event, errorCode, _desc, _url, isMainFrame) => {
    // -3 is ERR_ABORTED, which fires on ordinary redirects and cancellations.
    if (!isMainFrame || errorCode === -3) return;
    showOfflinePage();
  });

  openDashboard();
}

/** Fire-and-forget wrapper: a failed load falls back to the offline page. */
function openDashboard() {
  loadDashboard().catch(() => showOfflinePage());
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Dashboard",
          accelerator: "CmdOrCtrl+Shift+H",
          click: openDashboard,
        },
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One window is the whole app; a second instance should just surface it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    applyClientHints();
    buildMenu();
    createWindow();
    powerMonitor.on("resume", reloadIfStale);

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      } else {
        mainWindow.show();
      }
    });
  });

  app.on("before-quit", () => {
    quitting = true;
    saveBounds();
  });

  // Closing the window hides it, so the app deliberately outlives its window.
  app.on("window-all-closed", () => {});
}
