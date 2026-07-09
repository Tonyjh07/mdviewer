use std::path::Path;
use serde::Serialize;

#[derive(Serialize)]
struct FileData {
    content: String,
    name: String,
    path: String,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_initial_file, read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
