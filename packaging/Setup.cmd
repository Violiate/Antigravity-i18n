@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0app\packaging\Setup.ps1"
if errorlevel 1 pause
