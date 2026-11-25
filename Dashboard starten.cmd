@echo off
rem Start het Icares Dashboard (lokale ontwikkelversie)
cd /d "%~dp0"
call npx electron-vite preview
