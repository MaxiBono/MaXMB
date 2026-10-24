//! Screenshots (R3 on a controller, F12 by default on the keyboard).
//!
//! The whole app window is captured from the screen itself, so whatever is on
//! top of it — including the Internet Browser's LibreWolf window — is in the
//! picture. Saved as PNG in Photos/Screenshots under the name the app passes
//! ("Screenshot - 10⧸03⧸2026 10∶23∶05 PM", following the user's date/time
//! formats; look-alike characters stand in for "/" and ":").

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[tauri::command(async)]
pub fn take_screenshot(app: AppHandle, name: String) -> Result<String, String> {
    let clean: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '-' } else { c })
        .collect();
    let clean = clean.trim().trim_end_matches('.').to_string();
    let base = if clean.is_empty() { "Screenshot".to_string() } else { clean };
    // Photos/Screenshots: the folder exists only once a screenshot is taken, so
    // "By Album" shows a "Screenshots" folder only when there are screenshots
    let dir = crate::active_photos_dir(&app).join("Screenshots");
    std::fs::create_dir_all(&dir).map_err(|e| format!("folder: {e}"))?;
    let mut path: PathBuf = dir.join(format!("{base}.png"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} ({n}).png"));
        n += 1;
    }
    let w = app.get_webview_window("main").ok_or("no window")?;
    let (width, height, rgb) = capture(&w)?;
    let file = std::fs::File::create(&path).map_err(|e| format!("save: {e}"))?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    let mut wr = enc.write_header().map_err(|e| format!("png: {e}"))?;
    wr.write_image_data(&rgb).map_err(|e| format!("png: {e}"))?;
    Ok(path.display().to_string())
}

/// The screen as it is now (the browser window included), as a picture the
/// app shows behind its on-screen keyboard while the browser window steps
/// aside, so the keyboard looks like it's in front of the page. Returns the
/// file's path.
#[tauri::command(async)]
pub fn browser_snapshot(app: AppHandle) -> Result<String, String> {
    let w = app.get_webview_window("main").ok_or("no window")?;
    let (width, height, rgb) = capture(&w)?;
    let path = crate::paths::temp_dir(&app).join("browser_snapshot.png");
    let file = std::fs::File::create(&path).map_err(|e| format!("save: {e}"))?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    let mut wr = enc.write_header().map_err(|e| format!("png: {e}"))?;
    wr.write_image_data(&rgb).map_err(|e| format!("png: {e}"))?;
    Ok(path.display().to_string())
}

#[cfg(not(windows))]
fn capture(_w: &tauri::WebviewWindow) -> Result<(u32, u32, Vec<u8>), String> {
    Err("screenshots are only supported on Windows".into())
}

#[cfg(windows)]
fn capture(w: &tauri::WebviewWindow) -> Result<(u32, u32, Vec<u8>), String> {
    let h = w.hwnd().map_err(|e| e.to_string())?.0 as isize;
    win::grab(h).ok_or_else(|| "screen capture failed".to_string())
}

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use core::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct RECT { left: i32, top: i32, right: i32, bottom: i32 }
    #[repr(C)]
    #[derive(Default)]
    struct POINT { x: i32, y: i32 }
    #[repr(C)]
    struct BITMAPINFOHEADER { size: u32, width: i32, height: i32, planes: u16, bit_count: u16, compression: u32,
        size_image: u32, xppm: i32, yppm: i32, clr_used: u32, clr_important: u32 }
    #[repr(C)]
    struct BITMAPINFO { header: BITMAPINFOHEADER, colors: [u32; 3] }
    const SRCCOPY: u32 = 0x00CC_0020;
    const CAPTUREBLT: u32 = 0x4000_0000;
    #[link(name = "user32")]
    extern "system" {
        fn GetClientRect(h: isize, r: *mut RECT) -> i32;
        fn ClientToScreen(h: isize, p: *mut POINT) -> i32;
        fn GetDC(h: isize) -> isize;
        fn ReleaseDC(h: isize, dc: isize) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(dc: isize) -> isize;
        fn CreateCompatibleBitmap(dc: isize, w: i32, h: i32) -> isize;
        fn SelectObject(dc: isize, o: isize) -> isize;
        fn BitBlt(d: isize, x: i32, y: i32, w: i32, h: i32, s: isize, sx: i32, sy: i32, rop: u32) -> i32;
        fn GetDIBits(dc: isize, bm: isize, start: u32, lines: u32, bits: *mut c_void, bi: *mut BITMAPINFO, usage: u32) -> i32;
        fn DeleteObject(o: isize) -> i32;
        fn DeleteDC(dc: isize) -> i32;
    }
    /// The window's client area, as it appears on screen (top-level windows over it included).
    pub fn grab(hwnd: isize) -> Option<(u32, u32, Vec<u8>)> {
        unsafe {
            let mut r = RECT::default();
            if GetClientRect(hwnd, &mut r) == 0 { return None; }
            let (w, h) = (r.right - r.left, r.bottom - r.top);
            if w <= 0 || h <= 0 { return None; }
            let mut p = POINT::default();
            ClientToScreen(hwnd, &mut p);
            let screen = GetDC(0);
            let mem = CreateCompatibleDC(screen);
            let bmp = CreateCompatibleBitmap(screen, w, h);
            let old = SelectObject(mem, bmp);
            let ok = BitBlt(mem, 0, 0, w, h, screen, p.x, p.y, SRCCOPY | CAPTUREBLT) != 0;
            SelectObject(mem, old);
            let mut bi = BITMAPINFO {
                header: BITMAPINFOHEADER { size: std::mem::size_of::<BITMAPINFOHEADER>() as u32, width: w, height: -h,
                    planes: 1, bit_count: 32, compression: 0, size_image: 0, xppm: 0, yppm: 0, clr_used: 0, clr_important: 0 },
                colors: [0; 3],
            };
            let mut bgra = vec![0u8; (w * h * 4) as usize];
            let lines = if ok { GetDIBits(mem, bmp, 0, h as u32, bgra.as_mut_ptr() as *mut c_void, &mut bi, 0) } else { 0 };
            DeleteObject(bmp);
            DeleteDC(mem);
            ReleaseDC(0, screen);
            if lines == 0 { return None; }
            let mut rgb = Vec::with_capacity((w * h * 3) as usize);
            for px in bgra.chunks_exact(4) { rgb.extend_from_slice(&[px[2], px[1], px[0]]); }
            Some((w as u32, h as u32, rgb))
        }
    }
}
