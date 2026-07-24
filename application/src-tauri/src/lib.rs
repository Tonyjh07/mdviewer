use std::path::Path;
use serde::Serialize;

#[derive(Serialize)]
struct FileData {
    content: String,
    name: String,
    path: String,
}

#[derive(Serialize)]
struct FolderFile {
    name: String,
    rel_path: String,
    full_path: String,
}

#[derive(Serialize)]
struct FolderData {
    folder_path: String,
    files: Vec<FolderFile>,
}

/// 读取命令行传入的 .md 文件（文件关联 / 右键打开方式）
#[tauri::command]
fn get_initial_file() -> Result<Option<FileData>, String> {
    let args: Vec<String> = std::env::args().collect();
    for arg in args.iter().skip(1) {
        let p = Path::new(arg);
        match p.extension().and_then(|e| e.to_str()) {
            Some("md") | Some("markdown") | Some("mdown") => {
                let content = std::fs::read_to_string(arg).map_err(|e| e.to_string())?;
                let name = p.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                return Ok(Some(FileData { content, name, path: arg.clone() }));
            }
            _ => {}
        }
    }
    Ok(None)
}

/// 根据路径读取 .md 文件内容（会话恢复时使用）
#[tauri::command]
fn read_file(path: String) -> Result<FileData, String> {
    let p = Path::new(&path);
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let name = p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(FileData { content, name, path: path.clone() })
}

/// 扫描文件夹，返回其中所有 .md 文件（最多 2000 个，深度 ≤10）
#[tauri::command]
fn scan_folder(path: String) -> Result<FolderData, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("路径不是文件夹".into());
    }
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(&path)
        .max_depth(10)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".md") || name.ends_with(".markdown") || name.ends_with(".mdown") {
                let full_path = entry.path().to_string_lossy().to_string();
                let rel_path = full_path
                    .strip_prefix(&format!("{}\\", path))
                    .or_else(|| full_path.strip_prefix(&format!("{}/", path)))
                    .unwrap_or(&full_path)
                    .to_string()
                    .replace('\\', "/");
                files.push(FolderFile { name, rel_path, full_path });
                if files.len() >= 2000 { break; }
            }
        }
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(FolderData { folder_path: path, files })
}

/// 判断路径是否为目录（拖放时使用）
#[tauri::command]
fn is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            read_file,
            scan_folder,
            is_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
