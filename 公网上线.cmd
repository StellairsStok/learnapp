@echo off
chcp 65001 >nul
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d %~dp0
echo ============================================
echo  Stellairs 公网上线(临时通道)
echo  保持本窗口开着,网站就在线;关掉即下线。
echo ============================================
echo.
echo [1/2] 启动 Stellairs 服务...
start "Stellairs-Server" /min cmd /c "npx tsx server/index.ts"
timeout /t 6 /nobreak >nul
echo [2/2] 建立公网通道...
echo      下方出现 https://xxx.trycloudflare.com 即为本次网址(每次重启会变)
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8787
