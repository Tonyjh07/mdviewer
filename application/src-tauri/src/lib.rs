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

// ---- 图片读取（Markdown 相对路径图片） ----

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// 极简 base64 编码，避免为一张图片引入额外依赖
fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_CHARS[((n >> 18) & 63) as usize] as char);
        out.push(B64_CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(B64_CHARS[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64_CHARS[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "tif" | "tiff" => "image/tiff",
        _ => "application/octet-stream",
    }
}

/// 读取 Markdown 文档里的相对路径图片，返回 data URL。
/// base 为 md 文件所在目录，rel 为文档中的原始相对路径。
#[tauri::command]
fn read_image(base: String, rel: String) -> Result<String, String> {
    let base_path = Path::new(&base);
    let dir = if base_path.is_dir() {
        base_path.to_path_buf()
    } else {
        base_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| base_path.to_path_buf())
    };
    let target = dir.join(rel.trim_start_matches('/'));

    let meta = std::fs::metadata(&target).map_err(|e| format!("{}: {}", target.display(), e))?;
    if !meta.is_file() {
        return Err(format!("{} 不是文件", target.display()));
    }
    if meta.len() > 64 * 1024 * 1024 {
        return Err("图片超过 64MB".into());
    }
    let data = std::fs::read(&target).map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", image_mime(&target), base64_encode(&data)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_scoped_storage::init())
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            read_file,
            scan_folder,
            is_dir,
            read_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_reference_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn mime_is_guessed_from_extension() {
        assert_eq!(image_mime(Path::new("a/b/pic.PNG")), "image/png");
        assert_eq!(image_mime(Path::new("pic.jpeg")), "image/jpeg");
        assert_eq!(image_mime(Path::new("pic.svg")), "image/svg+xml");
        assert_eq!(image_mime(Path::new("weird.xyz")), "application/octet-stream");
    }

    #[test]
    fn read_image_joins_relative_path_against_markdown_dir() {
        let dir = std::env::temp_dir().join("mdviewer_read_image_test");
        let assets = dir.join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        let file = assets.join("pic.png");
        std::fs::write(&file, [0x89u8, b'P', b'N', b'G']).unwrap();

        // base 传 md 所在目录
        let url = read_image(dir.to_string_lossy().to_string(), "assets/pic.png".into()).unwrap();
        assert_eq!(url, "data:image/png;base64,iVBORw==");

        // base 传 md 文件本身时取父目录
        let md_path = dir.join("doc.md");
        std::fs::write(&md_path, "# hi").unwrap();
        let url2 = read_image(md_path.to_string_lossy().to_string(), "assets/pic.png".into()).unwrap();
        assert_eq!(url2, url);

        // 不存在的图片返回错误而不是 panic
        assert!(read_image(dir.to_string_lossy().to_string(), "assets/none.png".into()).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
