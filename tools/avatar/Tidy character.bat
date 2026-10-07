@echo off
rem Drag an exported character (.fbx or .glb) onto this file. It finds
rem Blender, tidies the character for Dingba, and writes <name>-tidy.glb
rem next to the original. Nothing to type.
setlocal
if "%~1"=="" (
  echo Drag your exported character file onto this icon.
  pause
  exit /b 1
)
set "BLENDER="
for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender*") do set "BLENDER=%%D\blender.exe"
if exist "%LocalAppData%\Programs\Blender Foundation\" for /d %%D in ("%LocalAppData%\Programs\Blender Foundation\Blender*") do set "BLENDER=%%D\blender.exe"
where blender >nul 2>nul && set "BLENDER=blender"
if "%BLENDER%"=="" (
  echo Blender was not found. Install it from blender.org, then try again.
  pause
  exit /b 1
)
"%BLENDER%" -b -P "%~dp0prepare-character.py" -- --in "%~1" --out "%~dpn1-tidy.glb"
echo.
echo Done. Your tidy file is: %~dpn1-tidy.glb
echo Now drag it onto dingba.ai/studio to check it.
pause
