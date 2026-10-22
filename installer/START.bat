@echo off
chcp 949 >nul
title 가디언즈 웹 품질 검사 v6.20
cd /d "%~dp0"

set NODE_EXE=%~dp0runtime\node.exe
set PLAYWRIGHT_BROWSERS_PATH=%~dp0chromium
set PLAYWRIGHT_CHROMIUM_SANDBOX=false

if not exist "%NODE_EXE%" goto NONODE

echo.
echo  ==========================================
echo   가디언즈 웹 품질 검사 v6.20
echo  ==========================================
echo.

set CHROMIUM_READY=0
for /d %%D in ("%~dp0chromium\chromium_headless_shell-*") do set CHROMIUM_READY=1
for /d %%D in ("%~dp0chromium\chromium-*") do set CHROMIUM_READY=1
if "%CHROMIUM_READY%"=="1" goto RUN

if not exist "%~dp0chromium.zip" goto DOWNLOAD
echo  [준비] 검사용 브라우저를 설치하는 중입니다. (1회, 약 20초)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~dp0chromium.zip' -DestinationPath '%~dp0' -Force"
if errorlevel 1 goto DOWNLOAD
del /q "%~dp0chromium.zip" >nul 2>&1
echo  [완료] 브라우저 준비됨
echo.
goto RUN

:DOWNLOAD
echo  [안내] 검사용 브라우저(Chromium)가 없어 내려받습니다. (약 110MB, 1회)
echo         인터넷이 필요합니다. 이 창을 닫지 마세요.
echo.
"%NODE_EXE%" "%~dp0node_modules\playwright\cli.js" install chromium
if errorlevel 1 goto CHROMIUM_FAIL
echo  [완료] 브라우저 준비됨
echo.

:RUN
echo  잠시 후 브라우저가 자동으로 열립니다.  주소: http://localhost:3000
echo  이 창을 닫으면 도구가 종료됩니다. (예약 검사도 함께 멈춥니다)
echo  종료: 이 창에서 Ctrl+C  또는  STOP.bat 실행
echo.
if not "%1"=="--no-browser" start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"
"%NODE_EXE%" --max-old-space-size=512 "%~dp0server.cjs"
echo.
echo  서버가 종료되었습니다.
pause
goto END

:NONODE
echo  [오류] runtime\node.exe 를 찾을 수 없습니다. 설치 파일이 손상되었을 수 있습니다.
pause
goto END

:CHROMIUM_FAIL
echo  [오류] 브라우저 설치에 실패했습니다. 인터넷 연결을 확인하고 다시 실행하세요.
pause

:END
