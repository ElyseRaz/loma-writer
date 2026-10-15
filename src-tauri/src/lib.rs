use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use tauri::ipc::{InvokeBody, Request, Response};

/// Only document formats Loma Writer handles may be touched by the file commands, even though
/// the path itself always comes from a native dialog or the recent-files list.
const ALLOWED_EXTENSIONS: [&str; 8] = ["docx", "doc", "odt", "loma", "html", "htm", "txt", "md"];
const MAX_READ_BYTES: u64 = 128 * 1024 * 1024;
const CONVERSION_TIMEOUT: Duration = Duration::from_secs(120);

fn check_extension(path: &str) -> Result<(), String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(format!("{path}: type de fichier non pris en charge"))
    }
}

/// Writes next to the target then renames, so a crash, a full disk or a failed write never
/// truncates or destroys the existing document.
fn write_atomic(path: &str, contents: &[u8]) -> Result<(), String> {
    let tmp = format!("{path}.loma-tmp");
    fs::write(&tmp, contents).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{path}: {e}")
    })?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("{path}: {e}")
    })
}

fn read_checked(path: &str) -> Result<Vec<u8>, String> {
    check_extension(path)?;
    let size = fs::metadata(path).map_err(|e| format!("{path}: {e}"))?.len();
    if size > MAX_READ_BYTES {
        return Err(format!("{path}: fichier trop volumineux"));
    }
    fs::read(path).map_err(|e| format!("{path}: {e}"))
}

/// Reads a UTF-8 document file.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let bytes = read_checked(&path)?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{path}: le fichier n'est pas en UTF-8"))?;
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

/// Writes a UTF-8 document file.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    check_extension(&path)?;
    write_atomic(&path, contents.as_bytes())
}

/// Reads a binary document (DOCX, DOC, ODT…) and returns the raw bytes to the webview.
#[tauri::command]
fn read_binary_file(path: String) -> Result<Response, String> {
    Ok(Response::new(read_checked(&path)?))
}

/// Writes a binary document. The path travels in the `path` header (percent-encoded), the bytes in the raw body.
#[tauri::command]
fn write_binary_file(request: Request<'_>) -> Result<(), String> {
    let path = header(&request, "path")?;
    check_extension(&path)?;
    match request.body() {
        InvokeBody::Raw(bytes) => write_atomic(&path, bytes),
        _ => Err("corps de requête invalide".into()),
    }
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("en-tête « {name} » manquant"))?;
    percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------------------------
// Local LibreOffice bridge (used for the legacy binary .doc format). Nothing leaves the machine.
// ---------------------------------------------------------------------------------------------

fn find_soffice() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join("soffice"));
            candidates.push(dir.join("libreoffice"));
        }
    }
    candidates.push("/usr/lib/libreoffice/program/soffice".into());
    candidates.push("/opt/libreoffice/program/soffice".into());
    candidates.into_iter().find(|p| p.is_file())
}

/// Returns the LibreOffice executable path when it is installed.
#[tauri::command]
fn libreoffice_path() -> Option<String> {
    find_soffice().map(|p| p.to_string_lossy().into_owned())
}

fn filter_for(ext: &str) -> Result<&'static str, String> {
    match ext {
        "doc" => Ok("doc:MS Word 97"),
        "docx" => Ok("docx:MS Word 2007 XML"),
        other => Err(format!("conversion vers « {other} » non prise en charge")),
    }
}

fn convert_blocking(bytes: &[u8], from: &str, to: &str) -> Result<Vec<u8>, String> {
    let soffice = find_soffice().ok_or_else(|| "LIBREOFFICE_MISSING".to_string())?;
    filter_for(from)?;
    let target_filter = filter_for(to)?;

    // Private temp directory (and private LibreOffice profile, so a running instance cannot interfere).
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("loma-convert-{}-{nanos}", std::process::id()));
    let out_dir = dir.join("out");
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let result = (|| {
        let input = dir.join(format!("document.{from}"));
        fs::write(&input, bytes).map_err(|e| e.to_string())?;
        let mut child = Command::new(&soffice)
            .arg(format!("-env:UserInstallation=file://{}", dir.join("profile").display()))
            .args(["--headless", "--norestore", "--nolockcheck", "--convert-to", target_filter, "--outdir"])
            .arg(&out_dir)
            .arg(&input)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("lancement de LibreOffice impossible : {e}"))?;
        let started = Instant::now();
        loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(status) if status.success() => break,
                Some(status) => return Err(format!("LibreOffice a échoué ({status})")),
                None if started.elapsed() > CONVERSION_TIMEOUT => {
                    let _ = child.kill();
                    return Err("LibreOffice n'a pas répondu à temps".into());
                }
                None => std::thread::sleep(Duration::from_millis(100)),
            }
        }
        fs::read(out_dir.join(format!("document.{to}"))).map_err(|_| "la conversion n'a produit aucun fichier".to_string())
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

/// Converts a document between .doc and .docx with a local headless LibreOffice.
/// Headers: `from` and `to` (extensions). Body: the raw source bytes.
#[tauri::command]
async fn convert_document(request: Request<'_>) -> Result<Response, String> {
    let from = header(&request, "from")?;
    let to = header(&request, "to")?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        _ => return Err("corps de requête invalide".into()),
    };
    let out = tauri::async_runtime::spawn_blocking(move || convert_blocking(&bytes, &from, &to))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Response::new(out))
}

/// Opens the native print dialog (which also offers "Print to File" for PDF).
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// Family names of the fonts installed on the system (fontconfig), sorted and without duplicates.
fn parse_font_families(output: &str) -> Vec<String> {
    let mut names: Vec<String> = output
        .lines()
        .filter_map(|l| l.split(',').next())
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty() && !n.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
}

#[tauri::command]
fn list_fonts() -> Vec<String> {
    std::process::Command::new("fc-list")
        .args([":", "family"])
        .output()
        .map(|o| parse_font_families(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // The window has no decorations: give it the application icon explicitly (taskbar, Alt+Tab).
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                let _ = window.set_icon(tauri::include_image!("icons/icon.png"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            read_binary_file,
            write_binary_file,
            libreoffice_path,
            convert_document,
            print_page,
            list_fonts
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("loma-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn font_families_are_first_names_sorted_and_unique() {
        let out = "Inter,Inter Black\nArial\nInter\n.Hidden\nzeta,Zeta Light\n\nArial\n";
        assert_eq!(parse_font_families(out), vec!["Arial", "Inter", "zeta"]);
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = temp("replace");
        let file = dir.join("a.docx");
        write_atomic(file.to_str().unwrap(), b"old").unwrap();
        write_atomic(file.to_str().unwrap(), b"new").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"new");
        assert!(!dir.join("a.docx.loma-tmp").exists());
    }

    #[test]
    fn failed_write_keeps_existing_document() {
        let dir = temp("fail");
        let file = dir.join("keep.odt");
        fs::write(&file, b"precious").unwrap();
        // The temp sibling cannot be created: a directory already occupies its name.
        fs::create_dir(dir.join("keep.odt.loma-tmp")).unwrap();
        assert!(write_atomic(file.to_str().unwrap(), b"broken").is_err());
        assert_eq!(fs::read(&file).unwrap(), b"precious");
    }

    #[test]
    fn rejects_unknown_extensions_and_accepts_documents() {
        assert!(check_extension("/etc/passwd").is_err());
        assert!(check_extension("/tmp/x.exe").is_err());
        for ok in ["a.DOCX", "a.doc", "a.odt", "a.loma", "a.html", "a.txt", "a.md"] {
            assert!(check_extension(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn legacy_doc_round_trip_through_libreoffice_when_installed() {
        if find_soffice().is_none() {
            eprintln!("LibreOffice absent : test ignoré");
            return;
        }
        // A tiny valid .docx is produced by LibreOffice itself from plain text.
        let dir = temp("convert");
        let txt = dir.join("in.txt");
        fs::write(&txt, "Bonjour").unwrap();
        let soffice = find_soffice().unwrap();
        let status = Command::new(soffice)
            .arg(format!("-env:UserInstallation=file://{}", dir.join("p").display()))
            .args(["--headless", "--convert-to", "docx", "--outdir"])
            .arg(&dir)
            .arg(&txt)
            .status()
            .unwrap();
        assert!(status.success());
        let docx = fs::read(dir.join("in.docx")).unwrap();
        let doc = convert_blocking(&docx, "docx", "doc").unwrap();
        assert_eq!(&doc[..4], &[0xD0, 0xCF, 0x11, 0xE0], "OLE2 header expected");
        let back = convert_blocking(&doc, "doc", "docx").unwrap();
        assert_eq!(&back[..2], b"PK");
    }

    #[test]
    fn missing_input_is_an_error_not_a_panic() {
        assert!(convert_blocking(b"x", "pdf", "doc").is_err());
    }
}
