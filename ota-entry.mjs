// OTA 前端入口：打包为 static/ota.js（浏览器无法解析裸模块名 @tauri-apps/*）
export { check } from '@tauri-apps/plugin-updater';
export { relaunch } from '@tauri-apps/plugin-process';
