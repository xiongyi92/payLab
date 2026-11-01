@echo off
chcp 65001 >nul
setlocal EnableExtensions
title PayLab 支付全链路教学系统
cd /d "%~dp0"

if /I "%~1"=="--no-browser" set "PAYLAB_NO_BROWSER=1"

echo.
echo   PayLab · 支付全链路教学系统
echo   ========================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1"
set "BOOT_CODE=%ERRORLEVEL%"
if "%BOOT_CODE%"=="2" goto paylab_already_running
if not "%BOOT_CODE%"=="0" (
  echo.
  echo   [启动失败] 请根据上面的提示处理后重试。
  echo.
  pause
  exit /b 1
)

set "NODE_EXE=node"
if exist "%~dp0.runtime\node\node.exe" set "NODE_EXE=%~dp0.runtime\node\node.exe"
if exist "%~dp0.runtime\node-exec.txt" set /p NODE_EXE=<"%~dp0.runtime\node-exec.txt"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

set "PORT=5178"
if exist "%~dp0.runtime\port.txt" set /p PORT=<"%~dp0.runtime\port.txt"

if not defined PAYLAB_NO_BROWSER (
  start "" /b cmd /c "%SystemRoot%\System32\ping.exe -n 3 127.0.0.1 >nul && explorer http://localhost:%PORT%"
)

echo.
echo   浏览器地址: http://localhost:%PORT%
echo   停止服务:   Ctrl+C 或关闭本窗口
echo.
echo   ----------------------------------------
echo.

"%NODE_EXE%" server\server.js
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo   [服务退出] 退出码 %EXITCODE%
  echo   请查看上面的错误信息。
) else (
  echo   服务已停止。
)
echo.
pause
exit /b %EXITCODE%

:paylab_already_running
set "PORT=5178"
if exist "%~dp0.runtime\port.txt" set /p PORT=<"%~dp0.runtime\port.txt"

echo.
echo   浏览器地址: http://localhost:%PORT%
echo   关闭本窗口不会停止已在运行的服务。
echo.

if not defined PAYLAB_NO_BROWSER (
  start "" /b cmd /c "%SystemRoot%\System32\ping.exe -n 2 127.0.0.1 >nul && explorer http://localhost:%PORT%"
)

"%SystemRoot%\System32\ping.exe" -n 4 127.0.0.1 >nul
exit /b 0
