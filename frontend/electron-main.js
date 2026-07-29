const { app, BrowserWindow } = require('electron')
const path = require('path')
const http = require('http')
const { spawn, spawnSync, exec } = require('child_process')
const fs = require('fs')

let backendProcess = null
let frontendProcess = null
let mainWindow = null

const isPackaged = app.isPackaged

// --- Path resolution ---------------------------------------------------
// In dev (npm run electron-dev / electron .) this always runs straight out
// of this project's own frontend/ folder, which for this project lives at
// Desktop/BİP - that assumption only holds for dev.
//
// In a packaged install (the NSIS setup.exe produced by `npm run dist`), the
// app runs from wherever the user installed it (typically Program Files) and
// there is no Desktop/BİP folder on a fresh machine. Instead, the backend
// source and the pre-built Next.js "standalone" server are bundled directly
// into the installer via electron-builder's "extraResources" (see
// package.json's "build" config) and land under process.resourcesPath.
let BACKEND_SOURCE_DIR
let FRONTEND_DIR

if (isPackaged) {
  BACKEND_SOURCE_DIR = path.join(process.resourcesPath, 'backend')
  FRONTEND_DIR = path.join(process.resourcesPath, 'frontend-standalone')
} else {
  const desktopDir = app.getPath('desktop')
  let WORKSPACE_DIR = path.join(desktopDir, 'BİP')
  if (!fs.existsSync(WORKSPACE_DIR)) {
    WORKSPACE_DIR = path.join(desktopDir, 'BIP')
  }
  BACKEND_SOURCE_DIR = path.join(WORKSPACE_DIR, 'backend')
  FRONTEND_DIR = path.join(WORKSPACE_DIR, 'frontend')
}

// The backend writes a SQLite file (./bip_dev.db) relative to its process's
// working directory (see backend/app/db/session.py) and, in dev, imports its
// own bundled venv - both assume a writable folder right next to the code.
// Once installed, the bundled "backend" resources folder is normally
// read-only, so in packaged mode the backend actually runs with its cwd
// pointed at a per-user, always-writable data folder instead of the
// (read-only) install directory. The bundled app/ source stays importable
// via the PYTHONPATH set below. Bonus: the database and the Python venv then
// live outside the versioned install folder, so they survive app
// updates/reinstalls instead of being wiped with every new version.
const BACKEND_RUN_DIR = isPackaged
  ? ensureDir(path.join(app.getPath('userData'), 'backend-data'))
  : BACKEND_SOURCE_DIR

const VENV_DIR = isPackaged
  ? path.join(app.getPath('userData'), 'backend-venv')
  : path.join(BACKEND_SOURCE_DIR, 'venv')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

function venvPythonPath() {
  return path.join(VENV_DIR, 'Scripts', 'python.exe')
}

// Loading screen shown immediately while the Python backend and Next.js
// frontend finish booting in the background (and, on a packaged app's very
// first launch, while the one-time Python environment setup below runs).
// Parameterized so the boot sequence can update the message as it moves
// through stages instead of showing one static line the whole time - a
// silent multi-minute wait on first launch (venv creation + pip install)
// previously looked identical to a frozen/broken app.
function loadingHtml(title, subtitle) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#18181b;color:#e4e4e7;font-family:'Segoe UI',sans-serif;">
  <div style="text-align:center;max-width:340px;">
    <div style="width:36px;height:36px;border:3px solid #3f3f46;border-top-color:#10b981;border-radius:50%;margin:0 auto 16px;animation:spin 0.8s linear infinite;"></div>
    <div style="font-size:13px;color:#a1a1aa;">${title}</div>
    <div style="font-size:11px;color:#71717a;margin-top:6px;">${subtitle}</div>
  </div>
  <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
</body>
</html>
`)}`
}

function errorHtml(title, subtitle) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#18181b;color:#e4e4e7;font-family:'Segoe UI',sans-serif;">
  <div style="text-align:center;max-width:380px;padding:0 24px;">
    <div style="font-size:28px;margin-bottom:12px;">⚠️</div>
    <div style="font-size:14px;font-weight:600;color:#f87171;">${title}</div>
    <div style="font-size:12px;color:#a1a1aa;margin-top:8px;line-height:1.6;">${subtitle}</div>
  </div>
</body>
</html>
`)}`
}

const LOADING_HTML = loadingHtml(
  'Piraziz Yatırım Terminali başlatılıyor...',
  'İlk çalıştırmada kurulum birkaç dakika sürebilir'
)

/**
 * First-launch-only setup for a packaged install: creates a private Python
 * virtual environment under the app's per-user data folder and installs the
 * bundled backend's requirements.txt into it. Skipped entirely once that
 * venv already exists (every subsequent launch), and skipped entirely in dev
 * mode (where the project's own hand-created venv is used as-is, matching
 * this project's existing local workflow).
 *
 * This step still requires a Python 3 installation to already be present on
 * the target Windows machine (found via the "py" launcher, falling back to
 * "python" on PATH) - it does not bundle a Python interpreter itself. That
 * remains a one-time prerequisite for anyone installing this app fresh.
 */
function ensurePythonEnv() {
  if (!isPackaged) return true

  if (!fs.existsSync(venvPythonPath())) {
    console.log('First launch detected - setting up Python environment at', VENV_DIR)

    const pythonLaunchers = [
      { cmd: 'py', args: ['-3'] },
      { cmd: 'python', args: [] },
    ]

    let created = false
    for (const launcher of pythonLaunchers) {
      try {
        const result = spawnSync(launcher.cmd, [...launcher.args, '-m', 'venv', VENV_DIR], {
          shell: true,
          windowsHide: true,
        })
        if (result.status === 0 && fs.existsSync(venvPythonPath())) {
          created = true
          break
        }
      } catch (e) {
        // Try the next launcher candidate.
      }
    }

    if (!created) {
      console.error(
        'Could not create a Python virtual environment. Please install Python 3 ' +
        '(python.org) and make sure it is available on PATH, then restart the app.'
      )
      return false
    }
  }

  // Runs on every launch, not just when the venv is first created - an
  // existing install's venv is from whatever version of requirements.txt
  // was bundled at THAT install time, and ensurePythonEnv used to only
  // check "does the venv folder exist", never "does it actually satisfy
  // the CURRENT bundled requirements.txt". An app update that adds a new
  // dependency (this version added slowapi/pyotp/qrcode for rate limiting
  // and 2FA) would leave an existing install's venv without it, so the
  // backend process would import-error and exit immediately - silently,
  // since its stdio is intentionally suppressed - and the app would sit on
  // "Sunucuya bağlanılamadı" with no indication why. Confirmed locally:
  // this exact build's own dev-machine venv (created before this version's
  // requirements.txt changes) was missing all three new packages. pip
  // install against an already-satisfied requirements.txt is fast (a
  // couple seconds), so paying that cost on every launch is worth the
  // correctness guarantee.
  const pipInstall = spawnSync(
    venvPythonPath(),
    ['-m', 'pip', 'install', '-r', path.join(BACKEND_SOURCE_DIR, 'requirements.txt')],
    { cwd: BACKEND_RUN_DIR, shell: true, windowsHide: true }
  )
  if (pipInstall.status !== 0) {
    console.error('Failed to install backend Python dependencies:', pipInstall.stderr?.toString())
    return false
  }

  console.log('Python environment ready.')
  return true
}

function startBackend() {
  const pythonExe = isPackaged ? venvPythonPath() : path.join(VENV_DIR, 'Scripts', 'python.exe')
  if (!fs.existsSync(pythonExe)) {
    console.error('Could not find Python interpreter at:', pythonExe)
    return
  }

  console.log('Auto-starting Python backend in background (cwd:', BACKEND_RUN_DIR, ')')
  backendProcess = spawn(pythonExe, [
    '-m', 'uvicorn', 'app.main:app',
    '--host', '127.0.0.1',
    '--port', '8000',
  ], {
    cwd: BACKEND_RUN_DIR,
    env: { ...process.env, PYTHONPATH: BACKEND_SOURCE_DIR },
    shell: true,
    stdio: 'ignore',
    // Prevents the brief black cmd.exe console flash on launch (Windows-only
    // quirk of shell:true spawns) - this was the "0.5 saniyelik log ekranı".
    windowsHide: true,
  })
}

function startFrontend() {
  if (isPackaged) {
    // The bundled Next.js "standalone" server (see next.config.ts +
    // package.json's extraResources) is just a plain Node script. Rather than
    // requiring a separate system-wide Node.js install, it's run through
    // Electron's own embedded Node runtime via ELECTRON_RUN_AS_NODE - the
    // standard trick for executing a bundled Node script from inside an
    // Electron app.
    const serverJs = path.join(FRONTEND_DIR, 'server.js')
    if (!fs.existsSync(serverJs)) {
      console.error('Could not find bundled frontend server at:', serverJs)
      return
    }
    console.log('Auto-starting bundled Next.js server from:', FRONTEND_DIR)
    frontendProcess = spawn(process.execPath, [serverJs], {
      cwd: FRONTEND_DIR,
      env: { ...process.env, PORT: '3000', HOSTNAME: '127.0.0.1', ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    })
  } else {
    if (!fs.existsSync(FRONTEND_DIR)) {
      console.error('Could not find frontend directory at:', FRONTEND_DIR)
      return
    }
    console.log('Auto-starting Next.js frontend in background from:', FRONTEND_DIR)
    frontendProcess = spawn('npx', [
      'next', 'start',
      '-p', '3000',
    ], {
      cwd: FRONTEND_DIR,
      shell: true,
      stdio: 'ignore',
      windowsHide: true,
    })
  }
}

/** Poll a local HTTP port until it responds (or timeout), then resolve. */
function waitForServer(port, timeoutMs = 120000, intervalMs = 500) {
  return new Promise((resolve) => {
    const start = Date.now()
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, timeout: 1500 }, (res) => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          resolve(false)
        } else {
          setTimeout(tryOnce, intervalMs)
        }
      })
      req.on('timeout', () => {
        req.destroy()
        if (Date.now() - start > timeoutMs) {
          resolve(false)
        } else {
          setTimeout(tryOnce, intervalMs)
        }
      })
    }
    tryOnce()
  })
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Piraziz Yatırım Terminali",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#18181b',
    show: false
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadURL(LOADING_HTML)
  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });

  boot()
}

/**
 * Full startup sequence, staged so the loading screen always reflects what's
 * actually happening instead of one static message. This used to navigate
 * to the real app as soon as the *frontend* was reachable regardless of
 * whether the backend ever came up - on a packaged app's first launch,
 * venv creation + `pip install` can easily take longer than the old 120s
 * cap, so the app would silently show Trade/Portfolio/etc. as broken (empty
 * data, failed fetches) with no indication that the backend was still
 * installing in the background. Now the app only ever navigates to the
 * real UI once the backend has actually answered a request, and shows an
 * explicit Turkish error screen instead of a silently-broken app if setup
 * fails outright or the backend never comes up.
 */
async function boot() {
  startFrontend()

  mainWindow.loadURL(loadingHtml(
    'Python ortamı hazırlanıyor...',
    'İlk çalıştırmada bu birkaç dakika sürebilir, lütfen bekleyin.'
  ))

  const pythonReady = ensurePythonEnv()
  if (!pythonReady) {
    mainWindow.loadURL(errorHtml(
      'Python ortamı kurulamadı',
      'Bilgisayarınızda Python 3 kurulu ve PATH\'e ekli olmalı (python.org adresinden indirebilirsiniz). ' +
      'Kurduktan sonra uygulamayı yeniden başlatın.'
    ))
    return
  }

  mainWindow.loadURL(loadingHtml(
    'Sunucular başlatılıyor...',
    'Bu birkaç saniye sürebilir.'
  ))
  startBackend()

  // Frontend is a plain bundled Node server - if it's not up within a
  // minute something is genuinely wrong (missing files), not just slow.
  // Backend gets a much longer allowance since first-run pip install is the
  // one step whose duration depends on the user's own machine/network.
  const [frontendUp, backendUp] = await Promise.all([
    waitForServer(3000, 60000),
    waitForServer(8000, 600000),
  ])

  if (!frontendUp) {
    mainWindow.loadURL(errorHtml(
      'Uygulama başlatılamadı',
      'Arayüz sunucusu yanıt vermedi. Uygulamayı kapatıp tekrar deneyin; sorun devam ederse yeniden kurun.'
    ))
    return
  }
  if (!backendUp) {
    mainWindow.loadURL(errorHtml(
      'Sunucuya bağlanılamadı',
      'Arka uç servisi 10 dakika içinde başlamadı. İnternet bağlantınızı kontrol edip uygulamayı yeniden başlatın. ' +
      'Sorun devam ederse Python kurulumunuzu kontrol edin.'
    ))
    return
  }

  mainWindow.loadURL('http://localhost:3000')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up processes on quit to prevent orphaned server instances
app.on('will-quit', () => {
  if (backendProcess) {
    try {
      exec(`taskkill /pid ${backendProcess.pid} /T /F`)
    } catch (e) {}
  }
  if (frontendProcess) {
    try {
      exec(`taskkill /pid ${frontendProcess.pid} /T /F`)
    } catch (e) {}
  }
})
