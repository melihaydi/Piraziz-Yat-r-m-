@echo off
title BIST Intelligence Platform (BIP) - Launcher
cls

echo ====================================================================
echo             BIST INTELLIGENCE PLATFORM (BIP) DEVELOPMENT
echo ====================================================================
echo.

:: 1. Check Python Virtual Environment in Backend
if not exist "backend\venv" (
    echo [INFO] Python sanal ortami bulunamadi. Olusturuluyor...
    python -m venv backend\venv
    if errorlevel 1 (
        echo [ERROR] Python sanal ortami olusturulamadi. Lutfen Python'in sistem yolunda -PATH- oldugundan emin olun.
        pause
        exit /b 1
    )
    echo [INFO] Python paketleri yukleniyor...
    backend\venv\Scripts\pip install --upgrade pip
    backend\venv\Scripts\pip install -r backend\requirements.txt
) else (
    echo [OK] Backend Python sanal ortami mevcut.
)

:: 2. Check Node.js Dependencies in Frontend
if not exist "frontend\node_modules" (
    echo [INFO] Frontend node_modules bulunamadi. Bagimliliklar yukleniyor...
    cd frontend
    call npm install
    cd ..
) else (
    echo [OK] Frontend npm bagimliliklari mevcut.
)

echo.
echo [LAUNCH] Servisler baslatiliyor...
echo.

:: 3. Start Backend in a separate window
echo [INFO] Backend sunucusu yeni pencerede baslatiliyor -Port 8000-...
start "BIP Backend Server (FastAPI)" cmd /k "cd backend && venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

:: 4. Start Frontend in the current window
echo [INFO] Frontend sunucusu baslatiliyor -Port 3000-...
cd frontend
call npm run dev

pause
