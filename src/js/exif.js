// A small EXIF reader for the Photo Viewer's Display panel (JPEG APP1 /
// TIFF). Returns the raw tags the panel shows, or {} when there are none.

const TAGS = {
  0x010f: "make", 0x0110: "model", 0x0132: "dateTime", 0x8769: "exifIfd",
  0x829a: "exposureTime", 0x829d: "fNumber", 0x8822: "exposureProgram", 0x8827: "iso",
  0x9000: "exifVersion", 0x9003: "dateOriginal", 0x9204: "exposureBias", 0x9205: "maxAperture",
  0x9207: "meteringMode", 0x9209: "flash", 0x920a: "focalLength", 0xa001: "colorSpace", 0xa403: "whiteBalance",
};
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readTiff(dv, base) {
  const le = dv.getUint16(base) === 0x4949;
  const u16 = (o) => dv.getUint16(base + o, le), u32 = (o) => dv.getUint32(base + o, le), i32 = (o) => dv.getInt32(base + o, le);
  if (u16(2) !== 42) return {};
  const out = {};
  const ifd = (off, depth) => {
    if (depth > 2 || off <= 0 || base + off + 2 > dv.byteLength) return;
    const n = u16(off);
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      if (base + e + 12 > dv.byteLength) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const name = TAGS[tag]; if (!name) continue;
      const size = (SIZES[type] || 1) * count;
      const vo = size > 4 ? u32(e + 8) : e + 8;
      if (base + vo + size > dv.byteLength) continue;
      let v;
      if (type === 2) { v = ""; for (let i = 0; i < count; i++) { const c = dv.getUint8(base + vo + i); if (!c) break; v += String.fromCharCode(c); } v = v.trim(); }
      else if (type === 3) v = u16(vo);
      else if (type === 4) v = u32(vo);
      else if (type === 5) v = u32(vo + 4) ? u32(vo) / u32(vo + 4) : 0;
      else if (type === 10) v = i32(vo + 4) ? i32(vo) / i32(vo + 4) : 0;
      else if (type === 7) { v = ""; for (let i = 0; i < Math.min(count, 4); i++) v += String.fromCharCode(dv.getUint8(base + vo + i)); }
      else v = dv.getUint8(base + vo);
      if (name === "exifIfd") ifd(v, depth + 1); else out[name] = v;
    }
  };
  ifd(u32(4), 0);
  return out;
}

export async function readExif(url) {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xffd8) return {};            // only JPEGs carry it
    let o = 2;
    while (o + 4 < dv.byteLength) {
      const m = dv.getUint16(o), len = dv.getUint16(o + 2);
      if (m === 0xffe1 && dv.getUint32(o + 4) === 0x45786966) return readTiff(dv, o + 10);
      if ((m & 0xff00) !== 0xff00 || m === 0xffda) break;
      o += 2 + len;
    }
  } catch (e) {}
  return {};
}

const PROGRAMS = ["Unknown", "Manual", "Normal Program", "Aperture Priority", "Shutter Priority", "Creative Program", "Action Program", "Portrait Mode", "Landscape Mode"];
const METERING = { 0: "Unknown", 1: "Average", 2: "Center Weighted Average", 3: "Spot", 4: "Multi-Spot", 5: "Pattern", 6: "Partial" };
const num = (v, d = 1) => Number(v.toFixed(d)).toString();

// the panel's rows: [label, value] ("–" when the picture doesn't say)
export function exifRows(t, { width, height, dateText }) {
  const dash = "–";
  const has = (k) => t[k] !== undefined && t[k] !== "";
  return [
    ["Date taken", dateText || dash],
    ["Manufacturer name", has("make") ? t.make : ""],
    ["Model name", has("model") ? t.model : ""],
    ["Image size", width && height ? `${width} x ${height}` : dash],
    ["MaxApertureValue", has("maxAperture") ? `F${num(Math.pow(2, t.maxAperture / 2))}` : dash],
    ["Lens focal length", has("focalLength") ? `${num(t.focalLength)} mm` : dash],
    ["Shutter speed", has("exposureTime") ? (t.exposureTime >= 1 ? `${num(t.exposureTime)} s` : `1/${Math.round(1 / t.exposureTime)} s`) : dash],
    ["F number", has("fNumber") ? `F${num(t.fNumber)}` : dash],
    ["Exposure correction value", has("exposureBias") ? `${t.exposureBias > 0 ? "+" : ""}${num(t.exposureBias)} EV` : dash],
    ["Exposure program", has("exposureProgram") ? (PROGRAMS[t.exposureProgram] || "Unknown") : "Unknown"],
    ["MeteringMode", has("meteringMode") ? (METERING[t.meteringMode] || "Other") : "Unknown"],
    ["ISO", has("iso") ? String(t.iso) : dash],
    ["White balance mode", has("whiteBalance") ? (t.whiteBalance === 1 ? "Manual" : "Auto") : "Unknown"],
    ["Flash", has("flash") ? (t.flash & 1 ? "Fired" : "Did Not Fire") : dash],
    ["Color space", has("colorSpace") ? (t.colorSpace === 1 ? "sRGB" : "Uncalibrated") : "Unknown"],
    ["Exif version", has("exifVersion") && /^\d{4}$/.test(t.exifVersion) ? `${+t.exifVersion.slice(0, 2)}.${t.exifVersion.slice(2)}` : dash],
  ];
}

// "2012:05:02 14:26:57" → Date
export function exifDate(t) {
  const s = t.dateOriginal || t.dateTime;
  const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
