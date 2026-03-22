@echo off
setlocal

set BUILD_DIR=cpp-backend\build
set TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake

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
