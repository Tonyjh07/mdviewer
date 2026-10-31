use std::path::{Component, Path, PathBuf};
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

// ---- 跨文件链接（相对 / 绝对路径）解析 ----

/// 十六进制字符转数值
fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// 百分号解码：%20 -> 空格，%E4%B8%AD -> 中（UTF-8 多字节）
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex_val(b[i + 1]), hex_val(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 去掉 file:// 协议前缀，还原为本地路径
fn strip_file_scheme(s: &str) -> String {
    if let Some(rest) = s.strip_prefix("file://") {
        // file:///C:/x -> C:/x ；file:///home/u -> /home/u
        if let Some(drive) = rest.strip_prefix('/') {
            let bytes = drive.as_bytes();
            if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
                return drive.to_string();
            }
        }
        return rest.to_string();
    }
    s.to_string()
}

/// 是否"看起来像"绝对路径（跨平台一致：盘符前缀或根斜杠）
fn is_abs_like(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'/' {
        return true;
    }
    s.starts_with('/')
}

/// 词法规范化：消解 . 与 ..，不访问文件系统。
/// 注意：`..` 只回退普通段，不会吃掉盘符或根目录。
fn normalize_lexically(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                // 只有当末段是普通目录时才回退，否则（C:/.. 之类）保持原样
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 解析 Markdown 文档中的文件路径链接，返回规范化后的绝对路径。
///
/// - `base`：当前文档的绝对路径（相对链接以它所在目录为基准）
/// - `link`：文档中书写的链接（相对或绝对，可能带 URL 编码）
#[tauri::command]
fn resolve_doc_path(base: String, link: String) -> Result<String, String> {
    let decoded = percent_decode(link.trim());
    let raw = strip_file_scheme(&decoded).replace('\\', "/");
    if raw.is_empty() {
        return Err("空链接".into());
    }
    let target = Path::new(&raw);
    let base = Path::new(base.trim());
    if base.as_os_str().is_empty() {
        // 没有基准文档时只接受绝对路径
        if !target.is_absolute() && !is_abs_like(&raw) {
            return Err("无法确定该相对链接的基准目录".into());
        }
        return Ok(normalize_lexically(target).to_string_lossy().to_string());
    }
    // Path::join 已能正确处理三种情形：
    //   绝对路径替换整个结果、带盘符的路径替换、Windows 的 /foo 继承 base 的盘符
    let dir = base.parent().unwrap_or(base);
    let joined = dir.join(target);
    Ok(normalize_lexically(&joined).to_string_lossy().to_string())
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
            resolve_doc_path,
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

    // ---- 跨文件链接路径解析 ----

    #[test]
    fn percent_decode_handles_spaces_and_utf8() {
        assert_eq!(percent_decode("my%20file.md"), "my file.md");
        assert_eq!(percent_decode("%E4%B8%AD%E6%96%87.md"), "中文.md");
        assert_eq!(percent_decode("plain.md"), "plain.md");
        // 非法的转义保持原样，不 panic
        assert_eq!(percent_decode("100%off.md"), "100%off.md");
        assert_eq!(percent_decode("a%zzb"), "a%zzb");
    }

    #[test]
    fn strip_file_scheme_recovers_drive_letters() {
        assert_eq!(strip_file_scheme("file:///C:/x/b.md"), "C:/x/b.md");
        assert_eq!(strip_file_scheme("file:///home/u/b.md"), "/home/u/b.md");
        assert_eq!(strip_file_scheme("normal.md"), "normal.md");
    }

    #[test]
    fn abs_like_detects_drive_and_root() {
        assert!(is_abs_like("C:/docs"));
        assert!(is_abs_like("/abs/docs"));
        assert!(!is_abs_like("docs/b.md"));
        assert!(!is_abs_like("./b.md"));
    }

    #[test]
    fn resolve_doc_path_joins_relative_against_current_doc_dir() {
        let base = if cfg!(windows) { r"C:\notes\guide.md" } else { "/notes/guide.md" };
        let out = resolve_doc_path(base.into(), "sub/other.md".into()).unwrap();
        let expect = if cfg!(windows) { r"C:\notes\sub\other.md" } else { "/notes/sub/other.md" };
        assert_eq!(PathBuf::from(out), PathBuf::from(expect));
    }

    #[test]
    fn resolve_doc_path_resolves_dot_dot_segments() {
        let base = if cfg!(windows) { r"C:\notes\a\guide.md" } else { "/notes/a/guide.md" };
        let out = resolve_doc_path(base.into(), "../other.md".into()).unwrap();
        let expect = if cfg!(windows) { r"C:\notes\other.md" } else { "/notes/other.md" };
        assert_eq!(PathBuf::from(out), PathBuf::from(expect));
    }

    #[test]
    fn resolve_doc_path_keeps_absolute_target_intact() {
        let base = if cfg!(windows) { r"C:\notes\guide.md" } else { "/notes/guide.md" };
        let target = if cfg!(windows) { r"D:\elsewhere\other.md" } else { "/elsewhere/other.md" };
        let out = resolve_doc_path(base.into(), target.into()).unwrap();
        assert_eq!(PathBuf::from(out), PathBuf::from(target));
    }

    #[test]
    fn resolve_doc_path_decodes_percent_escapes() {
        let base = if cfg!(windows) { r"C:\notes\guide.md" } else { "/notes/guide.md" };
        let out = resolve_doc_path(base.into(), "my%20doc.md".into()).unwrap();
        let expect = if cfg!(windows) { r"C:\notes\my doc.md" } else { "/notes/my doc.md" };
        assert_eq!(PathBuf::from(out), PathBuf::from(expect));
    }

    #[test]
    fn resolve_doc_path_rejects_empty_link() {
        assert!(resolve_doc_path("guide.md".into(), "   ".into()).is_err());
    }
}
