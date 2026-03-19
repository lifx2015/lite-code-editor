use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;
use tauri::Manager;

static LAUNCH_FILE_PROCESSED: AtomicBool = AtomicBool::new(false);
static LAUNCH_FILE_PATH: Mutex<Option<String>> = Mutex::new(None);

// 保存时间戳记录（用于过滤自身保存引起的文件变化事件）
static LAST_SAVE_TIMES: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

// 文件监听器状态
struct WatcherState {
    watcher: RecommendedWatcher,
    watched_paths: HashSet<String>,
}

static FILE_WATCHER: Mutex<Option<WatcherState>> = Mutex::new(None);

// 获取缓存目录路径
fn get_cache_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let cache_dir = app_data_dir.join("unsaved_cache");

    // 确保目录存在
    if !cache_dir.exists() {
        fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    }

    Ok(cache_dir)
}

#[derive(serde::Serialize)]
struct ExternalPluginDescriptor {
    path: String,
    config: serde_json::Value,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 获取插件目录列表
#[tauri::command]
fn get_plugin_dirs(app: tauri::AppHandle) -> Vec<String> {
    let mut dirs = Vec::new();

    // 1. 可执行文件所在目录的 plugins 文件夹
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let plugin_dir = exe_dir.join("plugins");
            let path_str = plugin_dir.to_string_lossy().to_string();
            println!("[Rust] Exe plugin dir: {}", path_str);
            dirs.push(path_str);
        }
    }

    // 2. 资源目录的 plugins 文件夹
    if let Ok(resource_dir) = app.path().resource_dir() {
        let plugin_dir = resource_dir.join("plugins");
        let path_str = plugin_dir.to_string_lossy().to_string();
        println!("[Rust] Resource plugin dir: {}", path_str);
        dirs.push(path_str);
    }

    // 3. 用户数据目录的 plugins 文件夹
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let plugin_dir = app_data_dir.join("plugins");
        let path_str = plugin_dir.to_string_lossy().to_string();
        println!("[Rust] AppData plugin dir: {}", path_str);
        dirs.push(path_str);
    }

    println!("[Rust] Total plugin dirs: {:?}", dirs);
    dirs
}

#[tauri::command]
fn list_external_plugins(app: tauri::AppHandle) -> Vec<ExternalPluginDescriptor> {
    let mut plugins = Vec::new();

    for plugin_dir in get_plugin_dirs(app) {
        let dir_path = Path::new(&plugin_dir);
        let entries = match fs::read_dir(dir_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let plugin_path = entry.path();
            if !plugin_path.is_dir() {
                continue;
            }

            let config_path = plugin_path.join("plugin.json");
            let config_content = match fs::read_to_string(&config_path) {
                Ok(content) => content,
                Err(_) => continue,
            };

            let config = match serde_json::from_str::<serde_json::Value>(&config_content) {
                Ok(config) => config,
                Err(_) => continue,
            };

            plugins.push(ExternalPluginDescriptor {
                path: plugin_path.to_string_lossy().to_string(),
                config,
            });
        }
    }

    plugins
}

#[tauri::command]
fn read_external_plugin_file(
    app: tauri::AppHandle,
    plugin_path: String,
    file_name: String,
) -> Result<String, String> {
    if file_name.contains("..") || Path::new(&file_name).is_absolute() {
        return Err("Invalid plugin file name".to_string());
    }

    let plugin_path_buf = Path::new(&plugin_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;

    let mut allowed = false;
    for dir in get_plugin_dirs(app) {
        let canonical_dir = match Path::new(&dir).canonicalize() {
            Ok(dir) => dir,
            Err(_) => continue,
        };

        if plugin_path_buf.starts_with(canonical_dir) {
            allowed = true;
            break;
        }
    }

    if !allowed {
        return Err("Plugin path is not in allowed directories".to_string());
    }

    let target_file = plugin_path_buf
        .join(&file_name)
        .canonicalize()
        .map_err(|e| e.to_string())?;

    if !target_file.starts_with(&plugin_path_buf) {
        return Err("Invalid plugin file path".to_string());
    }

    fs::read_to_string(target_file).map_err(|e| e.to_string())
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

    // 记录保存时间，用于过滤自身保存引起的文件变化事件
    if let Ok(mut times) = LAST_SAVE_TIMES.lock() {
        if times.is_none() {
            *times = Some(HashMap::new());
        }
        if let Some(ref mut map) = *times {
            map.insert(path.clone(), Instant::now());
        }
    }

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

/// 开始监听指定文件的变化
#[tauri::command]
fn watch_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut state = FILE_WATCHER.lock().map_err(|e| e.to_string())?;

    // 如果监听器不存在，创建一个新的
    if state.is_none() {
        let app_handle = app.clone();
        let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                // 只处理修改事件
                if event.kind.is_modify() || event.kind.is_remove() {
                    if let Some(path) = event.paths.first() {
                        let path_str = path.to_string_lossy().to_string();

                        // 检查是否是自身保存引起的修改（500ms内的保存忽略）
                        if event.kind.is_modify() {
                            let is_self_save = if let Ok(times) = LAST_SAVE_TIMES.lock() {
                                if let Some(ref map) = *times {
                                    if let Some(last_save) = map.get(&path_str) {
                                        last_save.elapsed().as_millis() < 500
                                    } else {
                                        false
                                    }
                                } else {
                                    false
                                }
                            } else {
                                false
                            };

                            if is_self_save {
                                return; // 忽略自身保存引起的修改
                            }
                        }

                        let change_type = if event.kind.is_remove() {
                            "deleted"
                        } else {
                            "modified"
                        };
                        let _ = app_handle.emit("file-changed", serde_json::json!({
                            "path": path_str,
                            "changeType": change_type
                        }));
                    }
                }
            }
        }).map_err(|e| e.to_string())?;

        *state = Some(WatcherState {
            watcher,
            watched_paths: HashSet::new(),
        });
    }

    // 添加文件到监听列表
    if let Some(ref mut ws) = *state {
        if !ws.watched_paths.contains(&path) {
            ws.watcher.watch(Path::new(&path), RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
            ws.watched_paths.insert(path.clone());
        }
    }

    Ok(())
}

/// 停止监听指定文件
#[tauri::command]
fn unwatch_file(path: String) -> Result<(), String> {
    let mut state = FILE_WATCHER.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut ws) = *state {
        if ws.watched_paths.remove(&path) {
            let _ = ws.watcher.unwatch(Path::new(&path));
        }
    }

    Ok(())
}

// ========== 缓存文件管理 ==========

#[derive(serde::Serialize, serde::Deserialize)]
struct CacheFileInfo {
    id: String,
    title: String,
    content: String,
    language: String,
}

/// 保存缓存文件（用于未保存的新文件）
#[tauri::command]
fn save_cache_file(app: tauri::AppHandle, id: String, title: String, content: String, language: String) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;
    let cache_file = cache_dir.join(format!("{}.json", id));

    let info = CacheFileInfo {
        id,
        title,
        content,
        language,
    };

    let json = serde_json::to_string_pretty(&info)
        .map_err(|e| format!("Failed to serialize cache: {}", e))?;

    fs::write(&cache_file, json)
        .map_err(|e| format!("Failed to write cache file: {}", e))?;

    Ok(())
}

/// 删除缓存文件
#[tauri::command]
fn delete_cache_file(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;
    let cache_file = cache_dir.join(format!("{}.json", id));

    if cache_file.exists() {
        fs::remove_file(&cache_file)
            .map_err(|e| format!("Failed to delete cache file: {}", e))?;
    }

    Ok(())
}

/// 获取所有缓存文件
#[tauri::command]
fn get_all_cache_files(app: tauri::AppHandle) -> Result<Vec<CacheFileInfo>, String> {
    let cache_dir = get_cache_dir(&app)?;
    let mut files = Vec::new();

    if !cache_dir.exists() {
        return Ok(files);
    }

    let entries = fs::read_dir(&cache_dir)
        .map_err(|e| format!("Failed to read cache dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(info) = serde_json::from_str::<CacheFileInfo>(&content) {
                    files.push(info);
                }
            }
        }
    }

    Ok(files)
}

/// 清除所有缓存文件
#[tauri::command]
fn clear_all_cache_files(app: tauri::AppHandle) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;

    if cache_dir.exists() {
        fs::remove_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to clear cache dir: {}", e))?;
        // 重新创建空目录
        fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to recreate cache dir: {}", e))?;
    }

    Ok(())
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
        .plugin(tauri_plugin_fs::init())
        // 单实例插件：当用户用此应用打开文件时，如果已有实例运行，会发送事件
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 获取主窗口并显示/聚焦
            if let Some(window) = app.get_webview_window("main") {
                // 先取消最小化状态
                let _ = window.unminimize();
                // 显示窗口
                let _ = window.show();
                // 将窗口置顶
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
            take_launch_file_path,
            watch_file,
            unwatch_file,
            get_plugin_dirs,
            list_external_plugins,
            read_external_plugin_file,
            save_cache_file,
            delete_cache_file,
            get_all_cache_files,
            clear_all_cache_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
