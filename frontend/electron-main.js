const { app, BrowserWindow } = require('electron')
const path = require('path')
const http = require('http')
const { spawn, exec } = require('child_process')
const fs = require('fs')

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
// there is no Desktop/BİP folder on a fresh machine. Instead, the pre-built
// Next.js "standalone" server is bundled directly into the installer via
// electron-builder's "extraResources" (see package.json's "build" config)
// and lands under process.resourcesPath.
let FRONTEND_DIR

if (isPackaged) {
  FRONTEND_DIR = path.join(process.resourcesPath, 'frontend-standalone')
} else {
  const desktopDir = app.getPath('desktop')
  let WORKSPACE_DIR = path.join(desktopDir, 'BİP')
  if (!fs.existsSync(WORKSPACE_DIR)) {
    WORKSPACE_DIR = path.join(desktopDir, 'BIP')
  }
  FRONTEND_DIR = path.join(WORKSPACE_DIR, 'frontend')
}

// Loading screen shown immediately while the bundled Next.js frontend finishes
// booting in the background.
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
  'BIP Terminal başlatılıyor...',
  'Bu birkaç saniye sürebilir.'
)

function startFrontend() {
  if (isPackaged) {
    // The bundled Next.js "standalone" server (see next.config.ts +
    // package.json's extraResources) is just a plain Node script, already
    // built with NEXT_PUBLIC_API_URL pointing at the hosted production
    // backend (see .env.local) - it needs no local backend process or
    // Python at all. Rather than requiring a separate system-wide Node.js
    // install, it's run through Electron's own embedded Node runtime via
    // ELECTRON_RUN_AS_NODE - the standard trick for executing a bundled
    // Node script from inside an Electron app.
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
function waitForServer(port, timeoutMs = 60000, intervalMs = 500) {
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
    title: "BIP Terminal",
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
 * Startup sequence: the app talks straight to the hosted production
 * backend (baked in as NEXT_PUBLIC_API_URL at build time), so the only
 * thing that needs to come up locally is the bundled Next.js frontend
 * server. No Python, no local backend process, no first-launch setup.
 */
async function boot() {
  startFrontend()

  const frontendUp = await waitForServer(3000, 60000)

  if (!frontendUp) {
    mainWindow.loadURL(errorHtml(
      'Uygulama başlatılamadı',
      'Arayüz sunucusu yanıt vermedi. Uygulamayı kapatıp tekrar deneyin; sorun devam ederse yeniden kurun.'
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
  if (frontendProcess) {
    try {
      exec(`taskkill /pid ${frontendProcess.pid} /T /F`)
    } catch (e) {}
  }
})
