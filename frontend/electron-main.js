const { app, BrowserWindow } = require('electron')
const path = require('path')
const { spawn, exec } = require('child_process')

let backendProcess = null

function startBackend() {
  // Locate the backend directory relative to this script's directory
  const backendDir = path.join(__dirname, '../backend')
  const pythonPath = path.join(backendDir, 'venv', 'Scripts', 'python.exe')
  
  console.log('Starting Python backend automatically in background:', pythonPath)
  
  // Spawn uvicorn server in background completely hidden
  backendProcess = spawn(pythonPath, [
    '-m', 'uvicorn', 'app.main:app', 
    '--host', '127.0.0.1', 
    '--port', '8000'
  ], {
    cwd: backendDir,
    shell: true,
    stdio: 'ignore' // hides console output and runs completely in background
  })

  backendProcess.on('error', (err) => {
    console.error('Failed to auto-start Python backend:', err)
  })
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
  
  // Hide default menu bar
  win.setMenuBarVisibility(false)
  
  // Load local Next.js dev server (or change to Netlify URL for production!)
  win.loadURL('http://localhost:3000')

  win.on('page-title-updated', (e) => {
    e.preventDefault();
  });
}

app.whenReady().then(() => {
  // Start backend server automatically on startup
  startBackend()
  
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

// Clean up: Ensure python backend process is fully terminated when the Electron app quits
app.on('will-quit', () => {
  if (backendProcess) {
    console.log('Terminating Python backend process...')
    try {
      // Force kill the process tree on Windows to prevent orphaned python processes
      exec(`taskkill /pid ${backendProcess.pid} /T /F`)
    } catch (e) {
      console.error('Failed to terminate backend process:', e)
    }
  }
})
