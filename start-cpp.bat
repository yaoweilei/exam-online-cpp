@echo off
setlocal

set BUILD_DIR=cpp-backend\build
set TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake

if "%APP_ENV%"=="" set APP_ENV=development
if "%LOG_LEVEL%"=="" set LOG_LEVEL=DEBUG
if "%LOG_DIR%"=="" set LOG_DIR=%CD%\logs\backend
if "%LOG_FILE_BASENAME%"=="" set LOG_FILE_BASENAME=exam-online-cpp
if "%LOG_MAX_FILES%"=="" set LOG_MAX_FILES=10

if not exist %BUILD_DIR% (
  cmake -S cpp-backend -B %BUILD_DIR% -DCMAKE_TOOLCHAIN_FILE=%TOOLCHAIN_FILE%
  if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
)

cmake --build %BUILD_DIR% --config Release
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

%BUILD_DIR%\Release\exam_online_cpp.exe
if %ERRORLEVEL% NEQ 0 (
  %BUILD_DIR%\exam_online_cpp.exe
)
