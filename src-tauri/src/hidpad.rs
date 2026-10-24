//! Native PlayStation controllers over HID: DualShock 3 (USB), DualShock 4 and
//! DualSense (USB or Bluetooth). Read straight from the device, so no driver
//! or Steam layer is needed, and the motion sensors come along too (used to
//! move the sparkles).
//!
//! A watcher thread looks for controllers every 2 s; each one found gets a
//! reader thread. The latest state is kept here (the browser's controller loop
//! reads it) and sent to the app as "xmb-hid" events when something changes.

#![cfg_attr(not(windows), allow(dead_code))]

use crate::gamepad::*;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const SONY_VID: u16 = 0x054C;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind { Ds3, Ds4, DualSense }

pub fn kind_of(vid: u16, pid: u16) -> Option<Kind> {
    if vid != SONY_VID { return None; }
    match pid {
        0x0268 => Some(Kind::Ds3),
        0x05C4 | 0x09CC | 0x0BA0 => Some(Kind::Ds4),
        0x0CE6 | 0x0DF2 => Some(Kind::DualSense),
        _ => None,
    }
}

/// One reading: buttons (gamepad.rs B_* bits), sticks -1..1, gyroscope in
/// degrees per second (pitch, yaw, roll; None for the DualShock 3) and the
/// accelerometer in g.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct HidState {
    pub buttons: u32,
    pub lx: f32, pub ly: f32, pub rx: f32, pub ry: f32,
    pub l2: f32, pub r2: f32,
    pub gyro: Option<[f32; 3]>,
    pub accel: Option<[f32; 3]>,
}

const B_PS: u32 = 1 << 16;

fn stick(v: u8) -> f32 { ((v as f32 - 128.0) / 127.0).clamp(-1.0, 1.0) }
fn i16le(b: &[u8], o: usize) -> f32 { i16::from_le_bytes([b[o], b[o + 1]]) as f32 }
fn hat(v: u8) -> u32 {
    match v & 0x0F {
        0 => B_UP, 1 => B_UP | B_RIGHT, 2 => B_RIGHT, 3 => B_RIGHT | B_DOWN,
        4 => B_DOWN, 5 => B_DOWN | B_LEFT, 6 => B_LEFT, 7 => B_LEFT | B_UP, _ => 0,
    }
}

/// Parse an input report (report id in byte 0, as Windows returns it).
pub fn parse(kind: Kind, r: &[u8]) -> Option<HidState> {
    match kind {
        Kind::Ds3 => {
            if r.len() < 49 || r[0] != 0x01 { return None; }
            let (a, b) = (r[2], r[3]);
            let mut s = HidState::default();
            let map = [(a, 0x01, B_SELECT), (a, 0x02, B_L3), (a, 0x04, B_R3), (a, 0x08, B_START),
                       (a, 0x10, B_UP), (a, 0x20, B_RIGHT), (a, 0x40, B_DOWN), (a, 0x80, B_LEFT),
                       (b, 0x01, B_L2), (b, 0x02, B_R2), (b, 0x04, B_L1), (b, 0x08, B_R1),
                       (b, 0x10, B_TRIANGLE), (b, 0x20, B_CIRCLE), (b, 0x40, B_CROSS), (b, 0x80, B_SQUARE)];
            for (byte, m, bit) in map { if byte & m != 0 { s.buttons |= bit; } }
            if r[4] & 0x01 != 0 { s.buttons |= B_PS; }
            s.lx = stick(r[6]); s.ly = stick(r[7]); s.rx = stick(r[8]); s.ry = stick(r[9]);
            s.l2 = r[18] as f32 / 255.0; s.r2 = r[19] as f32 / 255.0;
            // accelerometer: big-endian 10-bit values centred on 512 (~113 per g)
            let be = |o: usize| ((u16::from_be_bytes([r[o], r[o + 1]]) as f32) - 512.0) / 113.0;
            s.accel = Some([-be(41), be(45), be(43)]);
            Some(s)
        }
        Kind::Ds4 => {
            // USB 0x01 (full report), Bluetooth 0x11 (2 extra bytes in front)
            let base = match r.first()? { 0x01 => 1, 0x11 => 3, _ => return None };
            let d = r.get(base..)?;
            if d.len() < 9 { return None; }
            let mut s = HidState::default();
            s.lx = stick(d[0]); s.ly = stick(d[1]); s.rx = stick(d[2]); s.ry = stick(d[3]);
            s.buttons |= hat(d[4]);
            let map = [(d[4], 0x10, B_SQUARE), (d[4], 0x20, B_CROSS), (d[4], 0x40, B_CIRCLE), (d[4], 0x80, B_TRIANGLE),
                       (d[5], 0x01, B_L1), (d[5], 0x02, B_R1), (d[5], 0x04, B_L2), (d[5], 0x08, B_R2),
                       (d[5], 0x10, B_SELECT), (d[5], 0x20, B_START), (d[5], 0x40, B_L3), (d[5], 0x80, B_R3),
                       (d[6], 0x01, B_PS)];
            for (byte, m, bit) in map { if byte & m != 0 { s.buttons |= bit; } }
            s.l2 = d[7] as f32 / 255.0; s.r2 = d[8] as f32 / 255.0;
            // motion (the short Bluetooth report 0x01 has none)
            if d.len() >= 24 && !(r[0] == 0x01 && r.len() < 32) {
                s.gyro = Some([i16le(d, 12) / 16.4, i16le(d, 14) / 16.4, i16le(d, 16) / 16.4]);
                s.accel = Some([i16le(d, 18) / 8192.0, i16le(d, 20) / 8192.0, i16le(d, 22) / 8192.0]);
            }
            Some(s)
        }
        Kind::DualSense => {
            // USB 0x01, Bluetooth 0x31 (1 extra byte in front)
            let base = match r.first()? { 0x01 => 1, 0x31 => 2, _ => return None };
            let d = r.get(base..)?;
            if d.len() < 10 { return None; }
            let mut s = HidState::default();
            s.lx = stick(d[0]); s.ly = stick(d[1]); s.rx = stick(d[2]); s.ry = stick(d[3]);
            s.l2 = d[4] as f32 / 255.0; s.r2 = d[5] as f32 / 255.0;
            s.buttons |= hat(d[7]);
            let map = [(d[7], 0x10, B_SQUARE), (d[7], 0x20, B_CROSS), (d[7], 0x40, B_CIRCLE), (d[7], 0x80, B_TRIANGLE),
                       (d[8], 0x01, B_L1), (d[8], 0x02, B_R1), (d[8], 0x04, B_L2), (d[8], 0x08, B_R2),
                       (d[8], 0x10, B_SELECT), (d[8], 0x20, B_START), (d[8], 0x40, B_L3), (d[8], 0x80, B_R3),
                       (d[9], 0x01, B_PS)];
            for (byte, m, bit) in map { if byte & m != 0 { s.buttons |= bit; } }
            if d.len() >= 27 {
                s.gyro = Some([i16le(d, 15) / 16.4, i16le(d, 17) / 16.4, i16le(d, 19) / 16.4]);
                s.accel = Some([i16le(d, 21) / 8192.0, i16le(d, 23) / 8192.0, i16le(d, 25) / 8192.0]);
            }
            Some(s)
        }
    }
}

static LATEST: Mutex<Option<(HidState, Instant)>> = Mutex::new(None);

fn store(s: HidState) {
    if let Ok(mut l) = LATEST.lock() { *l = Some((s, Instant::now())); }
}

/// The newest reading, if a controller reported in the last 300 ms.
pub fn latest() -> Option<HidState> {
    let l = LATEST.lock().ok()?;
    let (s, t) = (*l)?;
    if t.elapsed() < Duration::from_millis(300) { Some(s) } else { None }
}

/// As the browser loop's PadState.
pub fn latest_pad() -> Option<PadState> {
    latest().map(|s| PadState { buttons: s.buttons, lx: s.lx, ly: s.ly, rx: s.rx, ry: s.ry })
}

#[cfg(not(windows))]
pub fn start(_app: tauri::AppHandle) {}

#[cfg(windows)]
pub fn start(app: tauri::AppHandle) {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex as M};
    use tauri::Emitter;
    let open: Arc<M<HashSet<String>>> = Arc::new(M::new(HashSet::new()));
    std::thread::spawn(move || loop {
        for (path, kind) in win::enumerate() {
            {
                let mut o = open.lock().unwrap();
                if o.contains(&path) { continue; }
                o.insert(path.clone());
            }
            let open2 = open.clone();
            let app2 = app.clone();
            std::thread::spawn(move || {
                if let Some(dev) = win::Device::open(&path, kind) {
                    let mut last_emit = Instant::now() - Duration::from_secs(1);
                    let mut last = HidState { buttons: u32::MAX, ..Default::default() };
                    while let Some(rep) = dev.read() {
                        let Some(s) = parse(kind, &rep) else { continue };
                        store(s);
                        // while a game runs the app ignores the controller: send nothing
                        if crate::focus::in_game() { continue; }
                        // only what changed is sent (a button at once; sticks / motion
                        // at most ~30 times a second), plus a sign of life every 200 ms
                        let moved = (s.lx - last.lx).abs() > 0.02 || (s.ly - last.ly).abs() > 0.02
                            || (s.rx - last.rx).abs() > 0.02 || (s.ry - last.ry).abs() > 0.02
                            || (s.l2 - last.l2).abs() > 0.02 || (s.r2 - last.r2).abs() > 0.02
                            || s.gyro.map(|g| g.iter().any(|v| v.abs() > 3.0)).unwrap_or(false);
                        let el = last_emit.elapsed();
                        if s.buttons != last.buttons || (moved && el >= Duration::from_millis(33)) || el >= Duration::from_millis(200) {
                            last = s;
                            last_emit = Instant::now();
                            let _ = app2.emit("xmb-hid", s);
                        }
                    }
                }
                open2.lock().unwrap().remove(&path);
            });
        }
        std::thread::sleep(Duration::from_secs(2));
    });
}

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod win {
    use super::{kind_of, Kind};
    use core::ffi::c_void;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct GUID { d1: u32, d2: u16, d3: u16, d4: [u8; 8] }
    #[repr(C)]
    struct SP_DEVICE_INTERFACE_DATA { cb: u32, guid: GUID, flags: u32, reserved: usize }
    #[repr(C)]
    #[derive(Default)]
    struct HIDD_ATTRIBUTES { size: u32, vid: u16, pid: u16, ver: u16 }
    #[repr(C)]
    #[derive(Default)]
    struct HIDP_CAPS { usage: u16, usage_page: u16, input_len: u16, output_len: u16, feature_len: u16, rest: [u16; 17] }

    const DIGCF_PRESENT: u32 = 0x2;
    const DIGCF_DEVICEINTERFACE: u32 = 0x10;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const FILE_SHARE_RW: u32 = 0x1 | 0x2;
    const OPEN_EXISTING: u32 = 3;
    const INVALID: isize = -1;

    #[link(name = "hid")]
    extern "system" {
        fn HidD_GetHidGuid(g: *mut GUID);
        fn HidD_GetAttributes(h: isize, a: *mut HIDD_ATTRIBUTES) -> u8;
        fn HidD_GetPreparsedData(h: isize, p: *mut isize) -> u8;
        fn HidD_FreePreparsedData(p: isize) -> u8;
        fn HidP_GetCaps(p: isize, c: *mut HIDP_CAPS) -> i32;
        fn HidD_GetFeature(h: isize, buf: *mut c_void, len: u32) -> u8;
        fn HidD_SetFeature(h: isize, buf: *const c_void, len: u32) -> u8;
    }
    #[link(name = "setupapi")]
    extern "system" {
        fn SetupDiGetClassDevsW(g: *const GUID, e: *const u16, w: isize, f: u32) -> isize;
        fn SetupDiEnumDeviceInterfaces(s: isize, d: *const c_void, g: *const GUID, i: u32, o: *mut SP_DEVICE_INTERFACE_DATA) -> i32;
        fn SetupDiGetDeviceInterfaceDetailW(s: isize, d: *const SP_DEVICE_INTERFACE_DATA, o: *mut c_void, n: u32, req: *mut u32, info: *mut c_void) -> i32;
        fn SetupDiDestroyDeviceInfoList(s: isize) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(p: *const u16, acc: u32, share: u32, sec: *const c_void, disp: u32, flags: u32, tmpl: isize) -> isize;
        fn ReadFile(h: isize, buf: *mut c_void, n: u32, read: *mut u32, ov: *mut c_void) -> i32;
        fn CloseHandle(h: isize) -> i32;
    }

    fn open_path(path: &[u16], access: u32) -> isize {
        unsafe { CreateFileW(path.as_ptr(), access, FILE_SHARE_RW, std::ptr::null(), OPEN_EXISTING, 0, 0) }
    }

    /// Every Sony controller's HID device path.
    pub fn enumerate() -> Vec<(String, Kind)> {
        let mut out = Vec::new();
        unsafe {
            let mut g = GUID::default();
            HidD_GetHidGuid(&mut g);
            let set = SetupDiGetClassDevsW(&g, std::ptr::null(), 0, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if set == INVALID { return out; }
            let mut i = 0;
            loop {
                let mut d = SP_DEVICE_INTERFACE_DATA { cb: std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32, guid: GUID::default(), flags: 0, reserved: 0 };
                if SetupDiEnumDeviceInterfaces(set, std::ptr::null(), &g, i, &mut d) == 0 { break; }
                i += 1;
                let mut need = 0u32;
                SetupDiGetDeviceInterfaceDetailW(set, &d, std::ptr::null_mut(), 0, &mut need, std::ptr::null_mut());
                if need < 8 { continue; }
                let mut buf = vec![0u8; need as usize + 8];
                // SP_DEVICE_INTERFACE_DETAIL_DATA_W.cbSize: 8 on 64-bit, 6 on 32-bit
                let cb: u32 = if std::mem::size_of::<usize>() == 8 { 8 } else { 6 };
                buf[..4].copy_from_slice(&cb.to_le_bytes());
                if SetupDiGetDeviceInterfaceDetailW(set, &d, buf.as_mut_ptr() as *mut c_void, need, &mut need, std::ptr::null_mut()) == 0 { continue; }
                let wide: Vec<u16> = buf[4..].chunks(2).map(|c| u16::from_le_bytes([c[0], c.get(1).copied().unwrap_or(0)])).collect();
                let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
                let path = String::from_utf16_lossy(&wide[..end]);
                let pw: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
                let h = open_path(&pw, 0);   // attribute query needs no access rights
                if h == INVALID { continue; }
                let mut a = HIDD_ATTRIBUTES { size: std::mem::size_of::<HIDD_ATTRIBUTES>() as u32, ..Default::default() };
                let ok = HidD_GetAttributes(h, &mut a) != 0;
                CloseHandle(h);
                if !ok { continue; }
                if let Some(k) = kind_of(a.vid, a.pid) { out.push((path, k)); }
            }
            SetupDiDestroyDeviceInfoList(set);
        }
        out
    }

    pub struct Device { h: isize, len: usize }
    impl Device {
        pub fn open(path: &str, kind: Kind) -> Option<Device> {
            let pw: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
            let h = open_path(&pw, GENERIC_READ | GENERIC_WRITE);
            if h == INVALID { return None; }
            let mut len = 64usize;
            unsafe {
                let mut pp: isize = 0;
                if HidD_GetPreparsedData(h, &mut pp) != 0 {
                    let mut caps = HIDP_CAPS::default();
                    if HidP_GetCaps(pp, &mut caps) >= 0 && caps.input_len > 0 { len = caps.input_len as usize; }
                    HidD_FreePreparsedData(pp);
                }
                match kind {
                    // DualShock 3: reading feature report 0xF2 makes it start
                    // sending input; 0xF4 does the same on some setups
                    Kind::Ds3 => {
                        let mut f = [0u8; 64]; f[0] = 0xF2;
                        HidD_GetFeature(h, f.as_mut_ptr() as *mut c_void, 18);
                        let en = [0xF4u8, 0x42, 0x0C, 0x00, 0x00];
                        HidD_SetFeature(h, en.as_ptr() as *const c_void, en.len() as u32);
                    }
                    // DualShock 4 / DualSense over Bluetooth: reading the
                    // calibration report switches to the full report (motion)
                    Kind::Ds4 | Kind::DualSense => {
                        let mut f = [0u8; 80]; f[0] = 0x05;
                        HidD_GetFeature(h, f.as_mut_ptr() as *mut c_void, if kind == Kind::Ds4 { 41 } else { 41 });
                        let mut f2 = [0u8; 80]; f2[0] = 0x02;
                        HidD_GetFeature(h, f2.as_mut_ptr() as *mut c_void, 37);
                    }
                }
            }
            Some(Device { h, len: len.max(10) })
        }
        /// Blocks until the next input report; None once the controller is gone.
        pub fn read(&self) -> Option<Vec<u8>> {
            let mut buf = vec![0u8; self.len];
            let mut n = 0u32;
            let ok = unsafe { ReadFile(self.h, buf.as_mut_ptr() as *mut c_void, self.len as u32, &mut n, std::ptr::null_mut()) };
            if ok == 0 || n == 0 { return None; }
            buf.truncate(n as usize);
            Some(buf)
        }
    }
    impl Drop for Device {
        fn drop(&mut self) { unsafe { CloseHandle(self.h); } }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ds4_usb_report() {
        let mut r = vec![0u8; 64];
        r[0] = 0x01; r[1] = 128; r[2] = 0; r[3] = 255; r[4] = 128;
        r[5] = 0x20 | 0x02;      // cross + hat right
        r[6] = 0x20;             // options
        r[7] = 0x01;             // PS
        r[13..15].copy_from_slice(&(164i16).to_le_bytes()); // 10 deg/s pitch
        let s = parse(Kind::Ds4, &r).unwrap();
        assert!(s.buttons & B_CROSS != 0 && s.buttons & B_RIGHT != 0 && s.buttons & B_START != 0);
        assert!(s.ly < -0.99 && s.rx > 0.99);
        assert!((s.gyro.unwrap()[0] - 10.0).abs() < 0.1);
    }

    #[test]
    fn dualsense_bt_report() {
        let mut r = vec![0u8; 78];
        r[0] = 0x31; r[1] = 0;
        let d = 2;
        r[d + 7] = 0x08 | 0x80;  // hat none + triangle
        r[d + 8] = 0x01;         // L1
        let s = parse(Kind::DualSense, &r).unwrap();
        assert_eq!(s.buttons & (B_UP | B_DOWN | B_LEFT | B_RIGHT), 0);
        assert!(s.buttons & B_TRIANGLE != 0 && s.buttons & B_L1 != 0);
        assert!(s.gyro.is_some());
    }

    #[test]
    fn ds3_report() {
        let mut r = vec![0u8; 49];
        r[0] = 0x01; r[2] = 0x08 | 0x10; r[3] = 0x40;
        for o in [41, 43, 45, 47] { r[o..o + 2].copy_from_slice(&512u16.to_be_bytes()); }
        let s = parse(Kind::Ds3, &r).unwrap();
        assert!(s.buttons & B_START != 0 && s.buttons & B_UP != 0 && s.buttons & B_CROSS != 0);
        assert!(s.gyro.is_none() && s.accel.unwrap()[0].abs() < 0.01);
    }
}
