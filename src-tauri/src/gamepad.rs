//! Native controller reading for while the Internet Browser is up.
//!
//! When LibreWolf is the foreground window, the webview's Gamepad API stops
//! receiving input, so the browser session reads the controller itself:
//!   * XInput (Xbox pads, DS4Windows / DsHidMini in XInput mode, Steam Input…),
//!     loaded dynamically (xinput1_4 → xinput1_3 → xinput9_1_0);
//!   * otherwise the WinMM joystick API (DirectInput-class HID pads such as a
//!     DualShock 4 / DualSense on plain Windows drivers).
//! Both work while another program has focus.
//!
//!   * DualShock 3 / 4 and DualSense read natively over HID (hidpad.rs) come
//!     first when one is connected.
//!
//! The result is one normalized state with PlayStation-named buttons.

#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct PadState {
    pub buttons: u32,
    /// sticks in -1..1, +x right, +y DOWN (screen direction)
    pub lx: f32,
    pub ly: f32,
    pub rx: f32,
    pub ry: f32,
}

pub const B_CROSS: u32 = 1 << 0;
pub const B_CIRCLE: u32 = 1 << 1;
pub const B_SQUARE: u32 = 1 << 2;
pub const B_TRIANGLE: u32 = 1 << 3;
pub const B_L1: u32 = 1 << 4;
pub const B_R1: u32 = 1 << 5;
pub const B_L2: u32 = 1 << 6;
pub const B_R2: u32 = 1 << 7;
pub const B_SELECT: u32 = 1 << 8;
pub const B_START: u32 = 1 << 9;
pub const B_UP: u32 = 1 << 10;
pub const B_DOWN: u32 = 1 << 11;
pub const B_LEFT: u32 = 1 << 12;
pub const B_RIGHT: u32 = 1 << 13;
pub const B_L3: u32 = 1 << 14;
pub const B_R3: u32 = 1 << 15;

#[cfg(windows)]
pub use imp::Reader;

#[cfg(not(windows))]
pub struct Reader;
#[cfg(not(windows))]
impl Reader {
    pub fn new() -> Self { Reader }
    pub fn poll(&mut self) -> Option<PadState> { None }
}

#[cfg(windows)]
#[allow(non_snake_case, clippy::upper_case_acronyms)]
mod imp {
    use super::*;
    use std::time::{Duration, Instant};

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct XINPUT_GAMEPAD { wButtons: u16, bLeftTrigger: u8, bRightTrigger: u8,
                            sThumbLX: i16, sThumbLY: i16, sThumbRX: i16, sThumbRY: i16 }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct XINPUT_STATE { dwPacketNumber: u32, Gamepad: XINPUT_GAMEPAD }
    type XInputGetStateFn = unsafe extern "system" fn(u32, *mut XINPUT_STATE) -> u32;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct JOYINFOEX { dwSize: u32, dwFlags: u32, dwXpos: u32, dwYpos: u32, dwZpos: u32, dwRpos: u32,
                       dwUpos: u32, dwVpos: u32, dwButtons: u32, dwButtonNumber: u32, dwPOV: u32,
                       dwReserved1: u32, dwReserved2: u32 }
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct JOYCAPSW { wMid: u16, wPid: u16, szPname: [u16; 32],
                      wXmin: u32, wXmax: u32, wYmin: u32, wYmax: u32, wZmin: u32, wZmax: u32,
                      wNumButtons: u32, wPeriodMin: u32, wPeriodMax: u32,
                      wRmin: u32, wRmax: u32, wUmin: u32, wUmax: u32, wVmin: u32, wVmax: u32,
                      wCaps: u32, wMaxAxes: u32, wNumAxes: u32, wMaxButtons: u32,
                      szRegKey: [u16; 32], szOEMVxD: [u16; 260] }

    const JOY_RETURNALL: u32 = 0x0000_00FF;
    const JOYERR_NOERROR: u32 = 0;

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryW(name: *const u16) -> isize;
        fn GetProcAddress(m: isize, name: *const u8) -> *const core::ffi::c_void;
    }
    #[link(name = "winmm")]
    extern "system" {
        fn joyGetNumDevs() -> u32;
        fn joyGetPosEx(id: u32, info: *mut JOYINFOEX) -> u32;
        fn joyGetDevCapsW(id: usize, caps: *mut JOYCAPSW, cb: u32) -> u32;
    }

    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() }

    fn load_xinput() -> Option<XInputGetStateFn> {
        for dll in ["xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"] {
            let w = wide(dll);
            let m = unsafe { LoadLibraryW(w.as_ptr()) };
            if m == 0 { continue; }
            let p = unsafe { GetProcAddress(m, b"XInputGetState\0".as_ptr()) };
            if !p.is_null() {
                return Some(unsafe { std::mem::transmute::<*const core::ffi::c_void, XInputGetStateFn>(p) });
            }
        }
        None
    }

    struct Joy { id: u32, sony: bool, caps: JOYCAPSW }

    pub struct Reader {
        xinput: Option<XInputGetStateFn>,
        xslot: Option<u32>,
        next_xscan: Instant,
        joy: Option<Joy>,
        next_jscan: Instant,
    }

    fn norm(v: u32, lo: u32, hi: u32) -> f32 {
        if hi <= lo { return 0.0; }
        let t = (v.saturating_sub(lo)) as f32 / (hi - lo) as f32;
        (t * 2.0 - 1.0).clamp(-1.0, 1.0)
    }
    fn thumb(v: i16) -> f32 { (v as f32 / 32767.0).clamp(-1.0, 1.0) }

    impl Reader {
        pub fn new() -> Self {
            let now = Instant::now();
            Reader { xinput: load_xinput(), xslot: None, next_xscan: now, joy: None, next_jscan: now }
        }

        fn read_x(&mut self, slot: u32) -> Option<PadState> {
            let f = self.xinput?;
            let mut s = XINPUT_STATE::default();
            if unsafe { f(slot, &mut s) } != 0 { return None; }
            let g = s.Gamepad;
            let w = g.wButtons as u32;
            let mut b = 0u32;
            let map = [(0x1000, B_CROSS), (0x2000, B_CIRCLE), (0x4000, B_SQUARE), (0x8000, B_TRIANGLE),
                       (0x0100, B_L1), (0x0200, B_R1), (0x0020, B_SELECT), (0x0010, B_START),
                       (0x0001, B_UP), (0x0002, B_DOWN), (0x0004, B_LEFT), (0x0008, B_RIGHT),
                       (0x0040, B_L3), (0x0080, B_R3)];
            for (m, bit) in map { if w & m != 0 { b |= bit; } }
            if g.bLeftTrigger > 60 { b |= B_L2; }
            if g.bRightTrigger > 60 { b |= B_R2; }
            Some(PadState { buttons: b, lx: thumb(g.sThumbLX), ly: -thumb(g.sThumbLY),
                            rx: thumb(g.sThumbRX), ry: -thumb(g.sThumbRY) })
        }

        fn scan_joy(&mut self) {
            let n = unsafe { joyGetNumDevs() }.min(16);
            for id in 0..n {
                let mut info = JOYINFOEX { dwSize: std::mem::size_of::<JOYINFOEX>() as u32, dwFlags: JOY_RETURNALL, ..Default::default() };
                if unsafe { joyGetPosEx(id, &mut info) } != JOYERR_NOERROR { continue; }
                let mut caps: JOYCAPSW = unsafe { std::mem::zeroed() };
                if unsafe { joyGetDevCapsW(id as usize, &mut caps, std::mem::size_of::<JOYCAPSW>() as u32) } != JOYERR_NOERROR { continue; }
                self.joy = Some(Joy { id, sony: caps.wMid == 0x054C, caps });
                return;
            }
        }

        fn read_joy(&mut self) -> Option<PadState> {
            let j = self.joy.as_ref()?;
            let mut i = JOYINFOEX { dwSize: std::mem::size_of::<JOYINFOEX>() as u32, dwFlags: JOY_RETURNALL, ..Default::default() };
            if unsafe { joyGetPosEx(j.id, &mut i) } != JOYERR_NOERROR { return None; }
            let c = &j.caps;
            let btn = |n: u32| i.dwButtons & (1 << n) != 0;
            let mut b = 0u32;
            let order: [u32; 10] = if j.sony {
                // DualShock 4 / DualSense HID order: □ ✕ ○ △ L1 R1 L2 R2 Share Options
                [B_SQUARE, B_CROSS, B_CIRCLE, B_TRIANGLE, B_L1, B_R1, B_L2, B_R2, B_SELECT, B_START]
            } else {
                [B_CROSS, B_CIRCLE, B_SQUARE, B_TRIANGLE, B_L1, B_R1, B_L2, B_R2, B_SELECT, B_START]
            };
            for (n, bit) in order.iter().enumerate() { if btn(n as u32) { b |= bit; } }
            if btn(10) { b |= B_L3; }
            if btn(11) { b |= B_R3; }
            if i.dwPOV != 0xFFFF && i.dwPOV <= 36000 {
                let p = i.dwPOV;
                if p >= 31500 || p <= 4500 { b |= B_UP; }
                if (4500..=13500).contains(&p) { b |= B_RIGHT; }
                if (13500..=22500).contains(&p) { b |= B_DOWN; }
                if (22500..=31500).contains(&p) { b |= B_LEFT; }
            }
            Some(PadState { buttons: b,
                lx: norm(i.dwXpos, c.wXmin, c.wXmax), ly: norm(i.dwYpos, c.wYmin, c.wYmax),
                rx: norm(i.dwZpos, c.wZmin, c.wZmax), ry: norm(i.dwRpos, c.wRmin, c.wRmax) })
        }

        /// Current state of the first connected controller (None = no pad).
        pub fn poll(&mut self) -> Option<PadState> {
            let now = Instant::now();
            // a PlayStation controller read natively over HID (hidpad.rs)
            if let Some(st) = crate::hidpad::latest_pad() { return Some(st); }
            // XInput first (a pad seen by XInput is also listed by WinMM)
            if self.xinput.is_some() {
                if let Some(s) = self.xslot {
                    if let Some(st) = self.read_x(s) { return Some(st); }
                    self.xslot = None;
                }
                if now >= self.next_xscan {
                    self.next_xscan = now + Duration::from_millis(1000);
                    for s in 0..4 {
                        if let Some(st) = self.read_x(s) { self.xslot = Some(s); return Some(st); }
                    }
                }
            }
            if self.joy.is_some() {
                if let Some(st) = self.read_joy() { return Some(st); }
                self.joy = None;
            }
            if now >= self.next_jscan {
                self.next_jscan = now + Duration::from_millis(1500);
                self.scan_joy();
                return self.read_joy();
            }
            None
        }
    }
}
