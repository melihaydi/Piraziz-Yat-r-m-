const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn, exec } = require('child_process')
const fs = require('fs')

let backendProcess = null
let frontendProcess = null

// Dynamically locate the Desktop folder and BIP/BİP project directory (Request 1!)
const desktopDir = app.getPath('desktop')
let WORKSPACE_DIR = path.join(desktopDir, 'BİP')
if (!fs.existsSync(WORKSPACE_DIR)) {
  WORKSPACE_DIR = path.join(desktopDir, 'BIP')
}

const BACKEND_DIR = path.join(WORKSPACE_DIR, 'backend')
const FRONTEND_DIR = path.join(WORKSPACE_DIR, 'frontend')

function startServers() {
  // 1. Start Python FastAPI backend in the background
  const pythonPath = path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe')
  if (fs.existsSync(pythonPath)) {
    console.log('Auto-starting Python backend in background from:', BACKEND_DIR)
    backendProcess = spawn(pythonPath, [
      '-m', 'uvicorn', 'app.main:app', 
      '--host', '127.0.0.1', 
      '--port', '8000'
    ], {
      cwd: BACKEND_DIR,
      shell: true,
      stdio: 'ignore'
    })
  } else {
    console.error('Could not find Python interpreter at:', pythonPath)
  }

  // 2. Start Next.js frontend production server in the background
  if (fs.existsSync(FRONTEND_DIR)) {
    console.log('Auto-starting Next.js frontend in background from:', FRONTEND_DIR)
    frontendProcess = spawn('npx', [
      'next', 'start', 
      '-p', '3000'
    ], {
      cwd: FRONTEND_DIR,
      shell: true,
      stdio: 'ignore'
    })
  } else {
    console.error('Could not find frontend directory at:', FRONTEND_DIR)
  }
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Piraziz Yatırım Terminali",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#18181b'
  })
  
  win.setMenuBarVisibility(false)
  
  // Wait 4 seconds for servers to bind to ports before loading URL
  setTimeout(() => {
    win.loadURL('http://localhost:3000')
  }, 4000)

  win.on('page-title-updated', (e) => {
    e.preventDefault();
  });
}

app.whenReady().then(() => {
  startServers()
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
