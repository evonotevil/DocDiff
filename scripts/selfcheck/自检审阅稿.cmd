@echo off
chcp 65001 >nul
rem DocDiff 审阅稿 · 本机自检（Windows）。用已安装的 DocDiff 自带的运行环境，不需要另装任何东西，不联网。
cd /d "%~dp0"
set "APP=%LOCALAPPDATA%\Programs\DocDiff\DocDiff.exe"
if not exist "%APP%" set "APP=%ProgramFiles%\DocDiff\DocDiff.exe"
if not exist "%APP%" ( echo 没找到 DocDiff，请先安装 DocDiff 1.8 测试版。 & pause & exit /b 1 )
set "DIR=%~1"
if "%DIR%"=="" (
  echo 把放合同的总文件夹拖进这个窗口，然后按回车：
  echo （总文件夹里每个子文件夹放一组：原稿和对方改稿两份 .docx）
  set /p "DIR="
)
set "DIR=%DIR:"=%"
set ELECTRON_RUN_AS_NODE=1
"%APP%" "%~dp0review-selfcheck.cjs" "%DIR%"
echo.
pause
