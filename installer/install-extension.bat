@echo off
chcp 949 >nul
title 가디언즈 Chrome 확장 설치 도우미
set EXT=%~dp0extension
set FOUND=
for %%B in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do if exist %%B set FOUND=%%~B
if "%FOUND%"=="" (
  for %%B in ("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do if exist %%B set FOUND=%%~B
  set PAGE=edge://extensions
) else (
  set PAGE=chrome://extensions
)
if "%FOUND%"=="" (
  echo  Chrome 또는 Edge를 찾지 못했습니다. 브라우저를 설치한 뒤 다시 실행하세요.
  pause
  exit /b
)
start "" "%FOUND%" "%PAGE%"
start "" explorer.exe "%EXT%"
cscript //nologo "%~dp0ext-guide.vbs"
