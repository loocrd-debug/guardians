@echo off
chcp 949 >nul
title 가디언즈 종료
taskkill /f /im node.exe /fi "WINDOWTITLE eq 가디언즈*" >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
echo  가디언즈 웹 품질 검사를 종료했습니다.
timeout /t 2 >nul
