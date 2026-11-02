@echo off
rem Login do Colab CLI (uma vez só). Abre um link: entre com a conta do Colab Pro, copie o código e cole aqui.
rem O token fica no WSL em ~/.config/colab-cli/token.json. Depois o Painel usa sozinho.
echo Login do Colab CLI - use a mesma conta do Colab Pro e do Drive do PC.
echo.
rem Caminho desta pasta visto de dentro do WSL (qualquer disco).
for /f "delims=" %%p in ('wsl -d Ubuntu -- wslpath -a "%~dp0."') do set "AQUI=%%p"
wsl -d Ubuntu -- bash "%AQUI%/bin/colab" usage
echo.
pause
