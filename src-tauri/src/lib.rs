use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

static LAUNCH_FILE_PROCESSED: AtomicBool = AtomicBool::new(false);
static LAUNCH_FILE_PATH: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(serde::Serialize)]
struct FileContent {
    content: String,
    encoding: String,
}

#[tauri::command]
fn load_file(path: String) -> Result<FileContent, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;

    // Detect encoding
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(&bytes, true);
    let encoding = detector.guess(None, true);

    let (cow, _, _had_errors) = encoding.decode(&bytes);

    Ok(FileContent {
        content: cow.into_owned(),
        encoding: encoding.name().to_string(),
    })
}

#[tauri::command]
fn save_file(path: String, content: String, encoding: Option<String>) -> Result<(), String> {
    let encoding_label = encoding.as_deref().unwrap_or("UTF-8");
    let encoding = encoding_rs::Encoding::for_label(encoding_label.as_bytes())
        .ok_or_else(|| format!("Unknown encoding: {}", encoding_label))?;

    let (cow, _, unmappable) = encoding.encode(&content);

    if unmappable {
        return Err("Content contains characters not representable in target encoding".to_string());
    }

    fs::write(&path, cow).map_err(|e| e.to_string())?;
    Ok(())
}

/// 获取启动时通过命令行参数传入的文件路径（仅返回一次）
#[tauri::command]
fn take_launch_file_path() -> Option<String> {
    // 确保只返回一次
    if LAUNCH_FILE_PROCESSED.swap(true, Ordering::SeqCst) {
        return None;
    }
    LAUNCH_FILE_PATH.lock().unwrap().take()
}

/// 从命令行参数中提取文件路径
fn extract_file_path_from_args() -> Option<String> {
    std::env::args_os().skip(1).find_map(|arg| {
        let path = arg.to_string_lossy().to_string();
        // 排除 Tauri 内部参数
        if path.starts_with('-') || path.starts_with("tauri://") {
            None
        } else {
            // 检查是否是有效文件路径
            let pb = std::path::Path::new(&path);
            if pb.exists() && pb.is_file() {
                Some(path)
            } else {
                None
            }
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 在应用启动前提取命令行参数中的文件路径
    if let Some(file_path) = extract_file_path_from_args() {
        *LAUNCH_FILE_PATH.lock().unwrap() = Some(file_path);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // 单实例插件：当用户用此应用打开文件时，如果已有实例运行，会发送事件
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 获取主窗口并显示/聚焦
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            // args 包含命令行参数，第一个是 exe 路径，第二个开始是文件路径
            if let Some(file_path) = args.into_iter().skip(1).find(|arg| {
                let path = std::path::Path::new(arg);
                path.exists() && path.is_file()
            }) {
                // 发送事件给前端打开文件
                let _ = app.emit("open-file", file_path);
            }
        }))
        .invoke_handler(tauri::generate_handler![
            greet,
            load_file,
            save_file,
            take_launch_file_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
