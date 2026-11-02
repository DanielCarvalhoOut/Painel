@echo off
rem Painel: central do estudio. Sobe o servidor (que liga o PullCut se preciso) e abre o navegador.
cd /d "%~dp0"
start "Painel - servidor" /min node server.mjs
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:4700
