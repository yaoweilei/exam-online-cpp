@echo off
setlocal

chcp 65001>nul

set BUILD_DIR=backend\build
set TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake
set POWERSHELL_EXE=C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe

if "%APP_ENV%"=="" set APP_ENV=development
if /I "%APP_ENV%"=="production" (
  if "%LOG_LEVEL%"=="" set LOG_LEVEL=INFO
  if "%BUILD_CONFIG%"=="" set BUILD_CONFIG=Release
) else (
  if "%LOG_LEVEL%"=="" set LOG_LEVEL=DEBUG
  if "%THREADS%"=="" set THREADS=1
  if "%BUILD_CONFIG%"=="" set BUILD_CONFIG=MinSizeRel
)
if "%LOG_DIR%"=="" set LOG_DIR=%CD%\logs\backend
if "%LOG_FILE_BASENAME%"=="" (
  if /I "%APP_ENV%"=="production" (
    set LOG_FILE_BASENAME=exam-online-cpp
  ) else (
    set LOG_FILE_BASENAME=exam-online-cpp-%BUILD_CONFIG%
  )
)
if "%LOG_MAX_FILES%"=="" set LOG_MAX_FILES=10

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist data\user\users.json (
  powershell -ExecutionPolicy Bypass -File backend/tools/migrate_user_baseline.ps1 -BaseDir .
  if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)
if not exist data\user\roles.json (
  powershell -ExecutionPolicy Bypass -File backend/tools/migrate_user_baseline.ps1 -BaseDir .
  if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)

echo [start-cpp] APP_ENV=%APP_ENV%
echo [start-cpp] LOG_LEVEL=%LOG_LEVEL%
echo [start-cpp] THREADS=%THREADS%
echo [start-cpp] BUILD_CONFIG=%BUILD_CONFIG%
echo [start-cpp] LOG_DIR=%LOG_DIR%
echo [start-cpp] LOG_FILE_BASENAME=%LOG_FILE_BASENAME%

if exist "%BUILD_DIR%\%BUILD_CONFIG%\exam_online_cpp.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -File backend/tools/stop_running_backend.ps1 -ExePath "%BUILD_DIR%\%BUILD_CONFIG%\exam_online_cpp.exe"
  if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)

if exist "%BUILD_DIR%\CMakeCache.txt" (
  cmake -S backend -B "%BUILD_DIR%" -DZ_VCPKG_POWERSHELL_PATH:FILEPATH="%POWERSHELL_EXE%" -DZ_VCPKG_PWSH_PATH:FILEPATH="%POWERSHELL_EXE%"
) else (
  cmake -S backend -B "%BUILD_DIR%" -DCMAKE_TOOLCHAIN_FILE="%TOOLCHAIN_FILE%" -DZ_VCPKG_POWERSHELL_PATH:FILEPATH="%POWERSHELL_EXE%" -DZ_VCPKG_PWSH_PATH:FILEPATH="%POWERSHELL_EXE%"
)
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

cmake --build "%BUILD_DIR%" --config "%BUILD_CONFIG%"
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

if exist "%BUILD_DIR%\%BUILD_CONFIG%\exam_online_cpp.exe" goto RUN_CONFIG
if exist "%BUILD_DIR%\exam_online_cpp.exe" goto RUN_DEFAULT

echo [start-cpp] backend executable not found
exit /b 1

:RUN_CONFIG
"%BUILD_DIR%\%BUILD_CONFIG%\exam_online_cpp.exe"
set BACKEND_EXIT=%ERRORLEVEL%
echo [start-cpp] backend exited with code %BACKEND_EXIT%
exit /b %BACKEND_EXIT%

:RUN_DEFAULT
"%BUILD_DIR%\exam_online_cpp.exe"
set BACKEND_EXIT=%ERRORLEVEL%
echo [start-cpp] backend exited with code %BACKEND_EXIT%
exit /b %BACKEND_EXIT%
