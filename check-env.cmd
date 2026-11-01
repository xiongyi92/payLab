@echo off
chcp 65001 >nul
setlocal EnableExtensions
title PayLab 环境检查
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1" -CheckOnly
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo   提示：双击 start.cmd 可启动服务并打开浏览器。
) else (
  echo   请根据上面的提示解决，或直接双击 start.cmd 自动安装便携版 Node.js。
)
echo.
pause
exit /b %CODE%
