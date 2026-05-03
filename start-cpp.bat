@echo off
setlocal

chcp 65001>nul

set BUILD_DIR=cpp-backend\build
set TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake
set POWERSHELL_EXE=C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe

if "%APP_ENV%"=="" set APP_ENV=development
if /I "%APP_ENV%"=="production" (
  if "%LOG_LEVEL%"=="" set LOG_LEVEL=INFO
) else (
  if "%LOG_LEVEL%"=="" set LOG_LEVEL=DEBUG
)
if "%LOG_DIR%"=="" set LOG_DIR=%CD%\logs\backend
if "%LOG_FILE_BASENAME%"=="" set LOG_FILE_BASENAME=exam-online-cpp
if "%LOG_MAX_FILES%"=="" set LOG_MAX_FILES=10

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist data\user\users.json (
  powershell -ExecutionPolicy Bypass -File cpp-backend/tools/migrate_user_baseline.ps1 -BaseDir .
  if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)
if not exist data\user\roles.json (
  powershell -ExecutionPolicy Bypass -File cpp-backend/tools/migrate_user_baseline.ps1 -BaseDir .
  if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)

echo [start-cpp] APP_ENV=%APP_ENV%
echo [start-cpp] LOG_LEVEL=%LOG_LEVEL%
echo [start-cpp] LOG_DIR=%LOG_DIR%

if exist "%BUILD_DIR%\Release\exam_online_cpp.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -File cpp-backend/tools/stop_running_backend.ps1 -ExePath "%BUILD_DIR%\Release\exam_online_cpp.exe"
  if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)

if exist "%BUILD_DIR%\CMakeCache.txt" (
  cmake -S cpp-backend -B "%BUILD_DIR%" -DZ_VCPKG_POWERSHELL_PATH:FILEPATH="%POWERSHELL_EXE%" -DZ_VCPKG_PWSH_PATH:FILEPATH="%POWERSHELL_EXE%"
) else (
  cmake -S cpp-backend -B "%BUILD_DIR%" -DCMAKE_TOOLCHAIN_FILE="%TOOLCHAIN_FILE%" -DZ_VCPKG_POWERSHELL_PATH:FILEPATH="%POWERSHELL_EXE%" -DZ_VCPKG_PWSH_PATH:FILEPATH="%POWERSHELL_EXE%"
)
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

cmake --build "%BUILD_DIR%" --config Release
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

if exist "%BUILD_DIR%\Release\exam_online_cpp.exe" (
  "%BUILD_DIR%\Release\exam_online_cpp.exe"
  exit /b %ERRORLEVEL%
)

if exist "%BUILD_DIR%\exam_online_cpp.exe" (
  "%BUILD_DIR%\exam_online_cpp.exe"
  exit /b %ERRORLEVEL%
)

echo [start-cpp] backend executable not found
exit /b 1
