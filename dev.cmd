@echo off
rem Stellairs 开发启动脚本:确保 Node 在 PATH 中(预览进程的环境可能早于 Node 安装)
set "PATH=C:\Program Files\nodejs;%PATH%"
call npm run dev
