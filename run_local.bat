@echo off
setlocal enabledelayedexpansion

set "IMAGE_NAME=finite-element-analysis-dev"
set "CONTAINER_NAME=finite-element-analysis-dev"
set "PORT=8087"

echo Building dev image %IMAGE_NAME%...
docker build -t %IMAGE_NAME% -f Dockerfile.dev .
if errorlevel 1 goto :fail

echo Removing any existing container %CONTAINER_NAME%...
for /f %%i in ('docker ps -aq -f "name=^%CONTAINER_NAME%$"') do docker rm -f %%i

echo Starting container with live reload on port %PORT%...
docker run -d --name %CONTAINER_NAME% -p %PORT%:5173 -v "%CD%:/app" -v /app/node_modules -v /app/src/mesher/wasm %IMAGE_NAME%
if errorlevel 1 goto :fail

echo App is running at http://localhost:%PORT%
start http://localhost:%PORT%

echo Press any key to stop and remove the container...
pause >nul
docker stop %CONTAINER_NAME% >nul
docker rm %CONTAINER_NAME% >nul
echo Stopped.
pause
exit /b 0

:fail
echo [ERROR] The last step failed; see the output above.
pause
exit /b 1
