use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::Emitter;
use tauri::Manager;

static LAUNCH_FILE_PROCESSED: AtomicBool = AtomicBool::new(false);
static LAUNCH_FILE_PATH: Mutex<Option<String>> = Mutex::new(None);
static SAVE_LOCK: Mutex<()> = Mutex::new(());

// 每个被监听文件的"已知内容"快照。
// 文件监听器收到变化事件时，会读取磁盘内容并与快照比对：
// 内容一致说明是我们自己保存引起的（或无关的元数据变化），忽略；
// 内容不一致才是真正的外部修改。
// 相比"保存后 500ms 内忽略"的时间窗口方案，这不会因为事件回调
// 早于记录时间戳（竞态）而误报。
static FILE_BASELINES: Mutex<Option<HashMap<String, Vec<u8>>>> = Mutex::new(None);

// 路径归一化：统一分隔符，Windows 下忽略大小写，保证前后端事件能匹配
fn normalize_path_key(path: &str) -> String {
    let absolute = std::path::absolute(path).unwrap_or_else(|_| PathBuf::from(path));
    let unified = absolute.to_string_lossy().to_string();
    if cfg!(windows) {
        unified.replace('/', "\\").to_lowercase()
    } else {
        unified
    }
}

fn set_file_baseline(path: &str, content: Vec<u8>) {
    if let Ok(mut guard) = FILE_BASELINES.lock() {
        if guard.is_none() {
            *guard = Some(HashMap::new());
        }
        if let Some(ref mut map) = *guard {
            map.insert(normalize_path_key(path), content);
        }
    }
}

fn get_file_baseline(path: &str) -> Option<Vec<u8>> {
    FILE_BASELINES
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().and_then(|map| map.get(&normalize_path_key(path)).cloned()))
}

fn clear_file_baseline(path: &str) {
    if let Ok(mut guard) = FILE_BASELINES.lock() {
        if let Some(ref mut map) = *guard {
            map.remove(&normalize_path_key(path));
        }
    }
}

// 读取文件内容，短暂重试以避开其它程序写入时产生的临时占用
fn read_file_with_retry(path: &str) -> Option<Vec<u8>> {
    for attempt in 0..5 {
        match fs::read(path) {
            Ok(content) => return Some(content),
            Err(_) if attempt < 4 => std::thread::sleep(std::time::Duration::from_millis(30)),
            Err(_) => return None,
        }
    }
    None
}

// 文件监听器状态
struct WatcherState {
    watcher: RecommendedWatcher,
    watched_paths: HashSet<String>,
}

static FILE_WATCHER: Mutex<Option<WatcherState>> = Mutex::new(None);

// 外部插件目录监听器（用于插件热重载）
static PLUGIN_WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);

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

    // 0. 开发模式：源码仓库根的 plugins 目录（src-tauri 的上一级）
    #[cfg(debug_assertions)]
    {
        let dev_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("plugins");
        if let Ok(canonical) = dev_dir.canonicalize() {
            let path_str = canonical.to_string_lossy().to_string();
            println!("[Rust] Dev plugin dir: {}", path_str);
            dirs.push(path_str);
        }
    }

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

    deduplicate_plugin_dirs(dirs)
}

fn deduplicate_plugin_dirs(dirs: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    dirs.into_iter().map(|dir| {
        Path::new(&dir).canonicalize().map(|p| p.to_string_lossy().to_string()).unwrap_or(dir)
    }).filter(|dir| seen.insert(normalize_path_key(dir))).collect()
}

#[tauri::command]
fn list_external_plugins(app: tauri::AppHandle) -> Vec<ExternalPluginDescriptor> {
    scan_plugin_dirs(get_plugin_dirs(app))
}

fn validate_plugin_manifest(config: &serde_json::Value) -> Result<(), String> {
    let meta = config.get("meta").and_then(serde_json::Value::as_object).ok_or("Missing plugin meta object")?;
    for key in ["id", "name", "version"] {
        if !meta.get(key).and_then(serde_json::Value::as_str).is_some_and(|value| !value.trim().is_empty()) {
            return Err(format!("Missing plugin meta.{} string", key));
        }
    }
    for key in ["main", "style"] {
        if let Some(value) = config.get(key) {
            let name = value.as_str().ok_or_else(|| format!("Invalid plugin {}", key))?;
            if name.is_empty() || name.contains(['\\', ':']) || !Path::new(name).components().all(|part| matches!(part, std::path::Component::Normal(_))) {
                return Err(format!("Plugin {} must be a relative file path", key));
            }
        }
    }
    let directives = meta.get("directives").and_then(serde_json::Value::as_array).ok_or("Missing directives array")?;
    let mut names = HashSet::new();
    for directive in directives {
        let name = directive.get("name").and_then(serde_json::Value::as_str).ok_or("Invalid directive name")?;
        if name.is_empty() || !names.insert(name) {
            return Err("Empty or duplicate directive name".into());
        }
        if let Some(params) = directive.get("params") {
            let params = params.as_array().ok_or("Invalid directive params array")?;
            let mut param_names = HashSet::new();
            for param in params {
                let name = param.get("name").and_then(serde_json::Value::as_str).ok_or("Invalid parameter name")?;
                if name.is_empty() || !param_names.insert(name)
                    || !param.get("type").and_then(serde_json::Value::as_str).is_some_and(|value| !value.is_empty())
                    || param.get("required").is_some_and(|value| !value.is_boolean()) {
                    return Err("Invalid parameter definition".into());
                }
            }
        }
        if directive.get("examples").is_some_and(|value| !value.as_array().is_some_and(|items| items.iter().all(serde_json::Value::is_string))) {
            return Err("Invalid directive examples array".into());
        }
    }
    Ok(())
}

fn scan_plugin_dirs(dirs: Vec<String>) -> Vec<ExternalPluginDescriptor> {
    let mut plugins = Vec::new();
    let mut seen_paths = HashSet::new();

    for plugin_dir in deduplicate_plugin_dirs(dirs) {
        let dir_path = Path::new(&plugin_dir);
        let entries = match fs::read_dir(dir_path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        let mut paths: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
        paths.sort();
        for plugin_path in paths {
            let plugin_path = match plugin_path.canonicalize() {
                Ok(path) if path.is_dir() => path,
                _ => continue,
            };
            if !seen_paths.insert(normalize_path_key(&plugin_path.to_string_lossy())) {
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

            if let Err(error) = validate_plugin_manifest(&config) {
                eprintln!("Skipping plugin {}: {}", plugin_path.display(), error);
                continue;
            }
            let main = config.get("main").and_then(serde_json::Value::as_str).unwrap_or("index.html");
            if !plugin_path.join(main).canonicalize().is_ok_and(|path| path.starts_with(&plugin_path) && path.is_file()) {
                continue;
            }
            plugins.push(ExternalPluginDescriptor {
                path: plugin_path.to_string_lossy().to_string(),
                config,
            });
        }
    }

    plugins.sort_by(|a, b| a.path.cmp(&b.path));
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
    file_size: u64,
    line_count: u64,
    is_large_file: bool,
    is_binary: bool,
    revision: String,
    bom: bool,
    had_decode_errors: bool,
}

const LARGE_FILE_THRESHOLD: u64 = 2 * 1024 * 1024;
const HUGE_FILE_THRESHOLD: u64 = 10 * 1024 * 1024;

fn is_binary_data(bytes: &[u8]) -> bool {
    let check_len = std::cmp::min(bytes.len(), 8192);
    let sample = &bytes[..check_len];
    let control_chars = sample.iter().filter(|&&b| b < 0x20 && b != b'\n' && b != b'\r' && b != b'\t').count();
    control_chars as f64 / check_len as f64 > 0.01
}

struct DecodedText {
    content: String,
    encoding: &'static encoding_rs::Encoding,
    bom: bool,
    had_decode_errors: bool,
}

fn detect_and_decode(bytes: &[u8], encoding_hint: Option<&str>) -> Result<DecodedText, String> {
    let (encoding, skip) = if let Some(detected) = encoding_rs::Encoding::for_bom(bytes) {
        detected
    } else if let Some(hint) = encoding_hint {
        (encoding_rs::Encoding::for_label(hint.as_bytes())
            .ok_or_else(|| format!("Unknown encoding: {}", hint))?, 0)
    } else {
        let mut detector = chardetng::EncodingDetector::new();
        detector.feed(bytes, true);
        (detector.guess(None, true), 0)
    };
    let (content, had_decode_errors) = encoding.decode_without_bom_handling(&bytes[skip..]);
    Ok(DecodedText {
        content: content.into_owned(),
        encoding,
        bom: skip != 0,
        had_decode_errors,
    })
}

fn encode_text(content: &str, label: &str, bom: bool) -> Result<Vec<u8>, String> {
    let encoding = encoding_rs::Encoding::for_label(label.as_bytes())
        .ok_or_else(|| format!("Unknown encoding: {}", label))?;
    let mut bytes = Vec::new();
    if encoding == encoding_rs::UTF_16LE || encoding == encoding_rs::UTF_16BE {
        let little_endian = encoding == encoding_rs::UTF_16LE;
        if bom {
            bytes.extend_from_slice(if little_endian { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
        }
        for unit in content.encode_utf16() {
            bytes.extend_from_slice(&if little_endian { unit.to_le_bytes() } else { unit.to_be_bytes() });
        }
    } else if encoding == encoding_rs::UTF_8 {
        if bom {
            bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        bytes.extend_from_slice(content.as_bytes());
    } else {
        if bom {
            return Err(format!("A BOM is not supported for {}", encoding.name()));
        }
        let (encoded, _, unmappable) = encoding.encode(content);
        if unmappable {
            return Err(format!("Content contains characters not representable in {}", encoding.name()));
        }
        bytes.extend_from_slice(&encoded);
    }
    Ok(bytes)
}

fn revision_of(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn read_destination(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err("Destination must be a regular file, not a directory or symbolic link".into());
        }
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot inspect destination: {}", e)),
    }
    fs::read(path).map(Some).map_err(|e| format!("Cannot read destination: {}", e))
}

fn check_revision(current: Option<&[u8]>, expected: Option<&str>) -> Result<(), String> {
    match (current, expected) {
        (None, None) => Ok(()),
        (Some(bytes), Some(revision)) if revision_of(bytes) == revision => Ok(()),
        _ => Err("Save conflict: destination exists without confirmation, changed, or was deleted. Reload or save elsewhere.".into()),
    }
}

fn atomic_write_checked<F>(path: &Path, bytes: &[u8], replace: bool, before_commit: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Cannot create temporary save file: {}", e))?;
    temporary.write_all(bytes).map_err(|e| format!("Cannot write temporary save file: {}", e))?;
    if replace {
        let metadata = fs::symlink_metadata(path).map_err(|e| format!("Cannot inspect destination: {}", e))?;
        if !metadata.file_type().is_file() || metadata.permissions().readonly() {
            return Err("Destination is not a writable regular file".into());
        }
        temporary.as_file().set_permissions(metadata.permissions())
            .map_err(|e| format!("Cannot preserve destination permissions: {}", e))?;
    }
    temporary.as_file().sync_all().map_err(|e| format!("Cannot sync temporary save file: {}", e))?;
    before_commit()?;
    if replace {
        temporary.persist(path).map_err(|e| format!("Cannot atomically replace destination: {}", e.error))?;
    } else {
        temporary.persist_noclobber(path).map_err(|e| format!("Cannot create destination without overwriting: {}", e.error))?;
    }
    #[cfg(unix)]
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[tauri::command]
fn get_file_revision(path: String) -> Result<Option<String>, String> {
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    Ok(read_destination(Path::new(&path))?.as_deref().map(revision_of))
}

#[tauri::command]
fn load_file(path: String, encoding: Option<String>) -> Result<FileContent, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let file_size = bytes.len() as u64;
    let is_large_file = file_size > LARGE_FILE_THRESHOLD;
    let decoded = detect_and_decode(&bytes, encoding.as_deref())?;
    let encoding_name = decoded.encoding.name().to_string();
    let content = decoded.content;

    // UTF-16 等多字节编码会有大量 0x00 字节，跳过二进制检测
    let is_binary = if encoding_name.contains("UTF-16") || encoding_name.contains("UTF-32") {
        false
    } else {
        is_binary_data(&bytes)
    };

    let line_count = content.lines().count() as u64;

    Ok(FileContent {
        content,
        encoding: encoding_name,
        file_size,
        line_count,
        is_large_file,
        is_binary,
        revision: revision_of(&bytes),
        bom: decoded.bom,
        had_decode_errors: decoded.had_decode_errors,
    })
}

#[tauri::command]
fn load_file_full(path: String, encoding: Option<String>) -> Result<FileContent, String> {
    load_file(path, encoding)
}

#[derive(serde::Serialize)]
struct HexDumpResult {
    hex_rows: Vec<HexRow>,
    total_bytes: u64,
    offset: u64,
    loaded_bytes: u64,
    has_more: bool,
}

#[derive(serde::Serialize)]
struct HexRow {
    offset: String,
    hex_values: Vec<String>,
    ascii: String,
}

const HEX_ROW_SIZE: usize = 16;
const HEX_MAX_ROWS: usize = 4096;

#[tauri::command]
fn load_binary_hex(path: String, offset: u64, row_count: Option<usize>) -> Result<HexDumpResult, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let total_bytes = metadata.len();

    let max_rows = row_count.unwrap_or(HEX_MAX_ROWS);
    let read_size = (max_rows * HEX_ROW_SIZE) as u64;
    let read_start = offset;
    let read_end = std::cmp::min(read_start + read_size, total_bytes);

    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(read_start)).map_err(|e| e.to_string())?;

    let bytes_to_read = (read_end - read_start) as usize;
    let mut buffer = vec![0u8; bytes_to_read];
    file.read_exact(&mut buffer).map_err(|e| e.to_string())?;

    let mut hex_rows = Vec::new();
    let chunks = buffer.chunks(HEX_ROW_SIZE);
    for (i, chunk) in chunks.enumerate() {
        let row_offset = read_start + (i * HEX_ROW_SIZE) as u64;
        let hex_values: Vec<String> = chunk.iter().map(|b| format!("{:02X}", b)).collect();
        let ascii: String = chunk.iter().map(|&b| {
            if b >= 0x20 && b <= 0x7E { b as char } else { '.' }
        }).collect();
        hex_rows.push(HexRow {
            offset: format!("{:08X}", row_offset),
            hex_values,
            ascii,
        });
    }

    let loaded_bytes = buffer.len() as u64;
    let has_more = read_end < total_bytes;

    Ok(HexDumpResult {
        hex_rows,
        total_bytes,
        offset: read_start,
        loaded_bytes,
        has_more,
    })
}

#[derive(serde::Serialize)]
struct BinarySearchResult {
    offsets: Vec<String>,
    total_matches: u64,
}

#[tauri::command]
fn search_binary_pattern(path: String, pattern_hex: String, max_results: Option<u64>) -> Result<BinarySearchResult, String> {
    let pattern_bytes: Vec<u8> = (0..pattern_hex.len())
        .step_by(2)
        .filter_map(|i| pattern_hex.get(i..i+2).and_then(|s| u8::from_str_radix(s, 16).ok()))
        .collect();

    if pattern_bytes.is_empty() {
        return Err("Invalid hex pattern".to_string());
    }

    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let max = max_results.unwrap_or(1000);
    let mut offsets = Vec::new();

    for i in 0..=bytes.len().saturating_sub(pattern_bytes.len()) {
        if offsets.len() as u64 >= max { break; }
        if bytes[i..].starts_with(&pattern_bytes) {
            offsets.push(format!("{:08X}", i));
        }
    }

    Ok(BinarySearchResult {
        total_matches: offsets.len() as u64,
        offsets,
    })
}

#[derive(serde::Serialize)]
struct FileMetadata {
    file_size: u64,
    line_count: u64,
    is_large_file: bool,
    is_huge_file: bool,
    is_binary: bool,
}

#[tauri::command]
fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let file_size = metadata.len();

    let is_binary = if file_size > 0 && file_size < 100 * 1024 * 1024 {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let decoded = detect_and_decode(&bytes, None)?;
        let encoding_name = decoded.encoding.name();
        if encoding_name.contains("UTF-16") || encoding_name.contains("UTF-32") {
            false
        } else {
            is_binary_data(&bytes)
        }
    } else if file_size >= 100 * 1024 * 1024 {
        let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
        use std::io::Read;
        let mut sample = vec![0u8; 8192];
        let n = file.read(&mut sample).map_err(|e| e.to_string())?;
        let decoded = detect_and_decode(&sample[..n], None)?;
        let encoding_name = decoded.encoding.name();
        if encoding_name.contains("UTF-16") || encoding_name.contains("UTF-32") {
            false
        } else {
            is_binary_data(&sample[..n])
        }
    } else {
        false
    };

    Ok(FileMetadata {
        file_size,
        line_count: 0,
        is_large_file: file_size > LARGE_FILE_THRESHOLD,
        is_huge_file: file_size > HUGE_FILE_THRESHOLD,
        is_binary,
    })
}

#[derive(serde::Serialize)]
struct ChunkResult {
    content: String,
    start_line: u64,
    end_line: u64,
    total_lines: u64,
    has_more: bool,
    encoding: String,
    revision: String,
    bom: bool,
    had_decode_errors: bool,
}

#[tauri::command]
fn load_file_chunk(path: String, start_line: u64, line_count: u64, encoding: Option<String>) -> Result<ChunkResult, String> {
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let decoded = detect_and_decode(&bytes, encoding.as_deref())?;

    let all_lines: Vec<&str> = decoded.content.lines().collect();
    let total_lines = all_lines.len() as u64;

    let end_line = std::cmp::min(start_line.saturating_add(line_count), total_lines);
    let start_idx = start_line as usize;
    let end_idx = end_line as usize;

    let chunk = if start_idx < all_lines.len() {
        all_lines[start_idx..end_idx.min(all_lines.len())].join("\n")
    } else {
        String::new()
    };

    Ok(ChunkResult {
        content: chunk,
        start_line,
        end_line,
        total_lines,
        has_more: end_line < total_lines,
        encoding: decoded.encoding.name().into(),
        revision: revision_of(&bytes),
        bom: decoded.bom,
        had_decode_errors: decoded.had_decode_errors,
    })
}

#[tauri::command]
fn save_file(
    path: String,
    content: String,
    encoding: Option<String>,
    expected_revision: Option<String>,
    bom: Option<bool>,
) -> Result<String, String> {
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    let destination = Path::new(&path);
    let current = read_destination(destination)?;
    check_revision(current.as_deref(), expected_revision.as_deref())?;
    let bom = bom.unwrap_or_else(|| current.as_deref()
        .and_then(encoding_rs::Encoding::for_bom).is_some());
    let bytes = encode_text(&content, encoding.as_deref().unwrap_or("UTF-8"), bom)?;
    atomic_write_checked(destination, &bytes, current.is_some(), || {
        let latest = read_destination(destination)?;
        check_revision(latest.as_deref(), expected_revision.as_deref())
    })?;
    let revision = revision_of(&bytes);
    set_file_baseline(&path, bytes);
    Ok(revision)
}

#[tauri::command]
fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    check_revision(read_destination(Path::new(&path))?.as_deref(), None)?;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    atomic_write_checked(Path::new(&path), &data, false, || Ok(()))?;
    set_file_baseline(&path, data);
    Ok(())
}

/// 复制文件到目标路径，自动创建缺失的父目录（供拖拽图片落盘使用，避免大文件走 IPC）
#[tauri::command]
fn copy_file(src: String, dest: String) -> Result<(), String> {
    let bytes = fs::read(&src).map_err(|e| e.to_string())?;
    save_binary_file(dest, bytes)
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
fn process_file_event(event: &Event, watched_paths: &HashSet<String>) -> Vec<(String, &'static str)> {
    let mut changes = Vec::new();
    if !(event.kind.is_modify() || event.kind.is_remove() || event.kind.is_create()) {
        return changes;
    }
    for path in &event.paths {
        let path = path.to_string_lossy().to_string();
        if !watched_paths.iter().any(|p| normalize_path_key(p) == normalize_path_key(&path)) {
            continue;
        }
        match read_file_with_retry(&path) {
            Some(current) => {
                if get_file_baseline(&path).as_deref() == Some(current.as_slice()) {
                    continue;
                }
                set_file_baseline(&path, current);
                changes.push((path, "modified"));
            }
            None if matches!(fs::symlink_metadata(&path), Err(e) if e.kind() == io::ErrorKind::NotFound) => {
                clear_file_baseline(&path);
                changes.push((path, "deleted"));
            }
            None => changes.push((path, "modified")),
        }
    }
    changes
}

#[tauri::command]
fn watch_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let _save_guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = std::path::absolute(&path).map_err(|e| e.to_string())?;
    let path = path.to_string_lossy().to_string();
    let mut state = FILE_WATCHER.lock().map_err(|e| e.to_string())?;

    // 如果监听器不存在，创建一个新的
    if state.is_none() {
        let app_handle = app.clone();
        let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if event.kind.is_modify() || event.kind.is_remove() || event.kind.is_create() {
                    let Ok(_save_guard) = SAVE_LOCK.lock() else { return; };
                    let watched_paths = FILE_WATCHER.lock().ok().and_then(|state| {
                        state.as_ref().map(|ws| ws.watched_paths.clone())
                    }).unwrap_or_default();
                    for (path, change_type) in process_file_event(&event, &watched_paths) {
                        let _ = app_handle.emit("file-changed", serde_json::json!({
                            "path": path,
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
            let parent = Path::new(&path).parent().ok_or("File has no parent directory")?;
            if !ws.watched_paths.iter().any(|p| Path::new(p).parent() == Some(parent)) {
                ws.watcher.watch(parent, RecursiveMode::NonRecursive)
                    .map_err(|e| e.to_string())?;
            }
            ws.watched_paths.insert(path.clone());
            // 记录当前磁盘内容作为基线，避免打开文件后自身的读取/元数据变化被误报
            if let Some(content) = read_file_with_retry(&path) {
                set_file_baseline(&path, content);
            }
        }
    }

    Ok(())
}

/// 停止监听指定文件
#[tauri::command]
fn unwatch_file(path: String) -> Result<(), String> {
    let _save_guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut state = FILE_WATCHER.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut ws) = *state {
        let registered = ws.watched_paths.iter()
            .find(|p| normalize_path_key(p) == normalize_path_key(&path)).cloned();
        if let Some(registered) = registered {
            ws.watched_paths.remove(&registered);
            if let Some(parent) = Path::new(&registered).parent() {
                if !ws.watched_paths.iter().any(|p| Path::new(p).parent() == Some(parent)) {
                    let _ = ws.watcher.unwatch(parent);
                }
            }
            clear_file_baseline(&registered);
        }
    }

    Ok(())
}

/// 监听外部插件目录，文件变化时向前端发送 external-plugin-changed 事件
#[tauri::command]
fn watch_plugin_dirs(app: tauri::AppHandle) -> Result<(), String> {
    let mut guard = PLUGIN_WATCHER.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let user_plugins = app.path().app_data_dir().map_err(|e| e.to_string())?.join("plugins");
    fs::create_dir_all(&user_plugins).map_err(|e| format!("Cannot create user plugins directory: {}", e))?;
    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            if event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove() {
                let paths: Vec<String> = event
                    .paths
                    .iter()
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                let change_type = if event.kind.is_create() {
                    "created"
                } else if event.kind.is_remove() {
                    "removed"
                } else {
                    "modified"
                };
                let _ = app_handle.emit(
                    "external-plugin-changed",
                    serde_json::json!({ "paths": paths, "changeType": change_type }),
                );
            }
        }
    })
    .map_err(|e| e.to_string())?;

    let mut watched = 0;
    for dir in get_plugin_dirs(app.clone()) {
        let path = Path::new(&dir);
        if path.is_dir() {
            match watcher.watch(path, RecursiveMode::Recursive) {
                Ok(_) => {
                    watched += 1;
                    println!("[Rust] Watching plugin dir: {}", dir);
                }
                Err(e) => return Err(format!("Failed to watch plugin dir {}: {}", dir, e)),
            }
        }
    }
    println!("[Rust] Plugin watcher started on {} dir(s)", watched);

    *guard = Some(watcher);
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

fn cache_file_path(cache_dir: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 128 {
        return Err("Invalid cache id length".into());
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Invalid cache id characters".into());
    }
    if id.split(['-', '_']).any(|segment| {
        let lower = segment.to_ascii_lowercase();
        lower == "con" || lower == "prn" || lower == "aux" || lower == "nul"
            || (lower.len() == 4
                && (lower.starts_with("com") || lower.starts_with("lpt"))
                && lower.as_bytes()[3].is_ascii_digit())
    }) {
        return Err("Invalid cache id: reserved device name".into());
    }
    Ok(cache_dir.join(format!("{}.json", id)))
}

fn write_cache_file(cache_dir: &Path, info: &CacheFileInfo) -> Result<(), String> {
    let cache_file = cache_file_path(cache_dir, &info.id)?;
    let json = serde_json::to_string_pretty(info)
        .map_err(|e| format!("Failed to serialize cache: {}", e))?;
    fs::create_dir_all(cache_dir).map_err(|e| format!("Failed to create cache dir: {}", e))?;
    atomic_write_checked(&cache_file, json.as_bytes(), cache_file.exists(), || Ok(()))
}

fn delete_cache(cache_dir: &Path, id: &str) -> Result<(), String> {
    let cache_file = cache_file_path(cache_dir, id)?;
    match fs::remove_file(&cache_file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to delete cache file: {}", e)),
    }
}

fn list_cache_files(cache_dir: &Path) -> Result<Vec<CacheFileInfo>, String> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(cache_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(files),
        Err(e) => return Err(format!("Failed to read cache dir: {}", e)),
    };
    let mut paths: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    for path in paths {
        if path.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(info) = serde_json::from_str::<CacheFileInfo>(&content) {
                    if cache_file_path(cache_dir, &info.id).is_ok_and(|expected| expected == path) {
                        files.push(info);
                    }
                }
            }
        }
    }
    Ok(files)
}

/// 保存缓存文件（用于未保存的新文件）
#[tauri::command]
fn save_cache_file(app: tauri::AppHandle, id: String, title: String, content: String, language: String) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;
    let info = CacheFileInfo { id, title, content, language };
    write_cache_file(&cache_dir, &info)
}

/// 删除缓存文件
#[tauri::command]
fn delete_cache_file(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let cache_dir = get_cache_dir(&app)?;
    delete_cache(&cache_dir, &id)
}

/// 获取所有缓存文件
#[tauri::command]
fn get_all_cache_files(app: tauri::AppHandle) -> Result<Vec<CacheFileInfo>, String> {
    let cache_dir = get_cache_dir(&app)?;
    list_cache_files(&cache_dir)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoding_roundtrips_preserve_endian_and_bom() {
        for encoding in ["UTF-8", "UTF-16LE", "UTF-16BE"] {
            for bom in [false, true] {
                let text = "Hello 世界\r\n𝄞\u{feff}";
                let bytes = encode_text(text, encoding, bom).unwrap();
                let decoded = detect_and_decode(&bytes, Some(encoding)).unwrap();
                assert_eq!(decoded.content, text);
                assert_eq!(decoded.encoding.name(), encoding);
                assert_eq!(decoded.bom, bom);
                assert!(!decoded.had_decode_errors);
                assert_eq!(encode_text(&decoded.content, decoded.encoding.name(), decoded.bom).unwrap(), bytes);
            }
        }
        assert_eq!(encode_text("A", "UTF-16BE", false).unwrap(), [0, 65]);
        assert_eq!(encode_text("A", "UTF-16LE", false).unwrap(), [65, 0]);
        assert_eq!(encode_text("A", "UTF-8", true).unwrap(), [239, 187, 191, 65]);
    }

    #[test]
    fn bom_overrides_hint_and_lossy_decoding_is_flagged() {
        let bytes = encode_text("abc", "UTF-16BE", true).unwrap();
        let decoded = detect_and_decode(&bytes, Some("UTF-8")).unwrap();
        assert_eq!(decoded.encoding, encoding_rs::UTF_16BE);
        assert_eq!(decoded.content, "abc");
        for (bytes, encoding) in [(&b"\xFF"[..], "UTF-8"), (&b"\x00"[..], "UTF-16LE"), (&b"\xD8\x00"[..], "UTF-16BE")] {
            assert!(detect_and_decode(bytes, Some(encoding)).unwrap().had_decode_errors);
        }
        assert!(detect_and_decode(b"hello", Some("invalid-encoding")).is_err());
        assert!(encode_text("世界", "windows-1252", false).is_err());
        assert!(encode_text("abc", "windows-1252", true).is_err());
        let bytes = encode_text("café", "windows-1252", false).unwrap();
        assert_eq!(bytes, b"caf\xE9");
        assert_eq!(detect_and_decode(&bytes, Some("windows-1252")).unwrap().content, "café");
    }

    #[test]
    fn revision_is_sha256_of_raw_bytes() {
        assert_eq!(revision_of(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_ne!(revision_of(b"abc"), revision_of(b"\xEF\xBB\xBFabc"));
    }

    #[test]
    fn save_conflicts_ignore_mutable_watcher_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt").to_string_lossy().to_string();
        assert_eq!(get_file_revision(path.clone()).unwrap(), None);
        let first = save_file(path.clone(), "first".into(), None, None, None).unwrap();
        assert_eq!(first, revision_of(b"first"));
        assert!(save_file(path.clone(), "bad".into(), None, None, None).is_err());
        fs::write(&path, b"external").unwrap();
        set_file_baseline(&path, b"external".to_vec());
        assert!(save_file(path.clone(), "bad".into(), None, Some(first), None).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
        let current = get_file_revision(path.clone()).unwrap().unwrap();
        let next = save_file(path.clone(), "next".into(), None, Some(current), None).unwrap();
        assert_eq!(next, revision_of(b"next"));
        fs::remove_file(&path).unwrap();
        assert!(save_file(path.clone(), "bad".into(), None, Some(next), None).is_err());
        assert!(!Path::new(&path).exists());
        clear_file_baseline(&path);
    }

    #[test]
    fn load_save_preserves_bom_and_failed_encoding_keeps_original() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt").to_string_lossy().to_string();
        let original = encode_text("hello", "UTF-16LE", true).unwrap();
        fs::write(&path, &original).unwrap();
        let loaded = load_file_full(path.clone(), None).unwrap();
        assert_eq!(loaded.encoding, "UTF-16LE");
        assert!(loaded.bom);
        assert!(!loaded.is_binary);
        assert_eq!(loaded.revision, revision_of(&original));
        assert!(save_file(path.clone(), "世界".into(), Some("windows-1252".into()), Some(loaded.revision.clone()), Some(false)).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        save_file(path.clone(), loaded.content, Some(loaded.encoding), Some(loaded.revision), None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::write(&path, b"\xEF\xBB\xBF\xFF\x00").unwrap();
        let loaded = load_file(path.clone(), None).unwrap();
        assert!(loaded.had_decode_errors);
        assert!(loaded.is_binary);
        let hex = load_binary_hex(path.clone(), 0, Some(1)).unwrap();
        assert_eq!(hex.loaded_bytes, 5);
        clear_file_baseline(&path);
    }

    #[test]
    fn failed_atomic_write_retains_original_and_cleans_temporary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let result = atomic_write_checked(&path, b"replacement", true, || Err("injected precommit failure".into()));
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(atomic_write_checked(&path, b"replacement", false, || Ok(())).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn atomic_write_rechecks_revision_after_staging() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        fs::write(&path, b"original").unwrap();
        let expected = revision_of(b"original");
        let result = atomic_write_checked(&path, b"replacement", true, || {
            fs::write(&path, b"external").unwrap();
            check_revision(read_destination(&path)?.as_deref(), Some(&expected))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
    }

    #[test]
    fn concurrent_saves_with_same_revision_have_one_winner() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt").to_string_lossy().to_string();
        fs::write(&path, b"original").unwrap();
        let threads: Vec<_> = ["first", "second"].into_iter().map(|content| {
            let path = path.clone();
            std::thread::spawn(move || save_file(path, content.into(), None, Some(revision_of(b"original")), None))
        }).collect();
        let successes = threads.into_iter().filter_map(|thread| thread.join().unwrap().ok()).count();
        assert_eq!(successes, 1);
        clear_file_baseline(&path);
    }

    #[test]
    fn cache_ids_are_validated_and_writes_are_contained() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path().to_path_buf();
        assert!(cache_file_path(&cache_dir, "../evil").is_err());
        assert!(cache_file_path(&cache_dir, "sub\\dir").is_err());
        assert!(cache_file_path(&cache_dir, "CON").is_err());
        assert!(cache_file_path(&cache_dir, "com1").is_err());
        assert!(cache_file_path(&cache_dir, "tab-aux-x").is_err());
        assert!(cache_file_path(&cache_dir, "tab-1-abc").is_ok());
        assert!(cache_file_path(&cache_dir, "").is_err());
        assert!(cache_file_path(&cache_dir, &"x".repeat(129)).is_err());
        let target = cache_dir.join("target.json");
        fs::write(&target, b"cached").unwrap();
        assert!(delete_cache(&cache_dir, "../target").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"cached");
        delete_cache(&cache_dir, "target").unwrap();
        assert!(!target.exists());
        let info = CacheFileInfo { id: "tab-1".into(), title: "t".into(), content: "c".into(), language: "md".into() };
        write_cache_file(&cache_dir, &info).unwrap();
        assert!(write_cache_file(&cache_dir, &CacheFileInfo { id: "../escape".into(), title: String::new(), content: String::new(), language: String::new() }).is_err());
        let listed = list_cache_files(&cache_dir).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "tab-1");
        assert!(list_cache_files(&cache_dir).is_ok());
    }

    #[test]
    fn plugin_scan_is_sorted_deduplicated_and_isolates_bad_manifests() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for name in ["plugins-a", "plugins-b"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        let manifest = |id: &str, main: &str| serde_json::json!({
            "meta": { "id": id, "name": id, "version": "1.0.0", "directives": [{ "name": "d", "params": [{ "name": "p", "type": "string" }] }] },
            "main": main
        });
        fs::create_dir_all(root.join("plugins-a/legit")).unwrap();
        fs::write(root.join("plugins-a/legit/plugin.json"), manifest("dup", "index.html").to_string()).unwrap();
        fs::write(root.join("plugins-a/legit/index.html"), "<html></html>").unwrap();
        fs::create_dir_all(root.join("plugins-b/dup-again")).unwrap();
        fs::write(root.join("plugins-b/dup-again/plugin.json"), manifest("dup", "index.html").to_string()).unwrap();
        fs::write(root.join("plugins-b/dup-again/index.html"), "<html></html>").unwrap();
        fs::create_dir_all(root.join("plugins-b/invalid")).unwrap();
        fs::write(root.join("plugins-b/invalid/plugin.json"), serde_json::json!({ "meta": { "id": "bad" } }).to_string()).unwrap();
        fs::create_dir_all(root.join("plugins-b/escaping")).unwrap();
        fs::write(root.join("plugins-b/escaping/plugin.json"), manifest("escape", "../outside.html").to_string()).unwrap();
        fs::write(root.join("plugins-b/outside.html"), "<html></html>").unwrap();
        fs::create_dir_all(root.join("plugins-b/missing-main")).unwrap();
        fs::write(root.join("plugins-b/missing-main/plugin.json"), manifest("missing", "index.html").to_string()).unwrap();
        let a = root.join("plugins-a").to_string_lossy().to_string();
        let b = root.join("plugins-b").to_string_lossy().to_string();
        let a_dup = format!("{}{}", a, std::path::MAIN_SEPARATOR);
        let plugins = scan_plugin_dirs(vec![b.clone(), a.clone(), a_dup]);
        assert_eq!(plugins.len(), 2);
        assert!(plugins[0].path.ends_with("plugins-a\\legit") || plugins[0].path.ends_with("plugins-a/legit"));
        assert!(plugins[1].path.ends_with("plugins-b\\dup-again") || plugins[1].path.ends_with("plugins-b/dup-again"));
        assert_eq!(plugins[0].config["meta"]["id"], "dup");
        assert!(plugins.iter().all(|p| p.config["meta"]["version"].as_str().is_some()));
        assert!(validate_plugin_manifest(&serde_json::json!({ "meta": { "id": "x", "name": "n", "version": "1", "directives": [] }, "main": "../outside.html" })).is_err());
    }

    #[test]
    fn parent_watcher_survives_atomic_replace_and_reports_rename_delete() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file.txt");
        let path_str = path.to_string_lossy().to_string();
        fs::write(&path, b"original").unwrap();
        set_file_baseline(&path_str, b"original".to_vec());
        let watched = HashSet::from([path_str.clone()]);
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event: Result<Event, notify::Error>| {
            if let Ok(event) = event {
                let _guard = SAVE_LOCK.lock().unwrap();
                for change in process_file_event(&event, &watched) {
                    let _ = tx.send(change);
                }
            }
        }).unwrap();
        watcher.watch(dir.path(), RecursiveMode::NonRecursive).unwrap();
        let revision = save_file(path_str.clone(), "saved".into(), None, Some(revision_of(b"original")), None).unwrap();
        assert_eq!(revision, revision_of(b"saved"));
        assert!(rx.recv_timeout(std::time::Duration::from_millis(300)).is_err());
        fs::write(&path, b"external").unwrap();
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), (path_str.clone(), "modified"));
        fs::rename(&path, dir.path().join("renamed.txt")).unwrap();
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), (path_str.clone(), "deleted"));
        fs::write(&path, b"recreated").unwrap();
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), (path_str.clone(), "modified"));
        fs::remove_file(&path).unwrap();
        assert_eq!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), (path_str.clone(), "deleted"));
        drop(watcher);
        clear_file_baseline(&path_str);
    }
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
            load_file_full,
            get_file_revision,
            load_file_chunk,
            load_binary_hex,
            search_binary_pattern,
            get_file_metadata,
            save_file,
            save_binary_file,
            copy_file,
            take_launch_file_path,
            watch_file,
            unwatch_file,
            watch_plugin_dirs,
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
