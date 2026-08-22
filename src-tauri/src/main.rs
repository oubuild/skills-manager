// 隐藏 Windows 控制台窗口（GUI 子系统），否则运行时会附带一个终端黑框
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    skills_manager::run();
}
