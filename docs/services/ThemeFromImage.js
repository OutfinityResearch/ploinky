// Simple palette extractor from a reference image using Canvas.
// Sets CSS variables: --accent, --accent-2, --bg-dim, --text-on-bg
// Usage: initThemeFromImage('./example.png')

function quantizeColor(r, g, b, levels = 16) {
  const step = Math.floor(256 / levels);
  const qr = Math.min(levels - 1, Math.floor(r / step));
  const qg = Math.min(levels - 1, Math.floor(g / step));
  const qb = Math.min(levels - 1, Math.floor(b / step));
  return (qr << 8) | (qg << 4) | qb; // compact key
}

function keyToRgb(key, levels = 16) {
  const step = Math.floor(256 / levels);
  const r = (key >> 8) & 0xF;
  const g = (key >> 4) & 0xF;
  const b = key & 0xF;
  const to255 = (q) => Math.max(0, Math.min(255, q * step + step / 2));
  return [to255(r), to255(g), to255(b)];
}

function relativeLuminance([r, g, b]) {
  const srgb = [r, g, b].map(v => v / 255);
  const lin = srgb.map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function rgb(arr) { return `rgb(${arr[0]|0}, ${arr[1]|0}, ${arr[2]|0})`; }

export default async function initThemeFromImage(src = './example.png') {
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const loaded = new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
    });
    img.src = src;
    await loaded;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = 64; // downscale for speed
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const hist = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 16) continue; // skip transparent
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // ignore near-white/near-black extremes to avoid bias
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max > 245 && min > 220) continue; // near-white
      if (max < 25 && min < 25) continue; // near-black
      const key = quantizeColor(r, g, b, 16);
      hist.set(key, (hist.get(key) || 0) + 1);
    }

    const entries = Array.from(hist.entries()).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) throw new Error('No colors');

    // pick top colors with contrast spread
    const primary = keyToRgb(entries[0][0]);
    let secondary = primary;
    for (let i = 1; i < entries.length; i++) {
      const candidate = keyToRgb(entries[i][0]);
      const lumDiff = Math.abs(relativeLuminance(primary) - relativeLuminance(candidate));
      if (lumDiff > 0.1) { secondary = candidate; break; }
    }

    const bgDim = [primary, secondary].map(c => c.reduce((a,v)=>a+v,0)/3).reduce((a,v)=>Math.min(a,v));
    const textOnBg = relativeLuminance(primary) > 0.55 ? '0,0,0' : '255,255,255';

    const root = document.documentElement;
    root.style.setProperty('--accent', rgb(primary));
    root.style.setProperty('--accent-2', rgb(secondary));
    root.style.setProperty('--bg-dim', `rgba(0,0,0,0.35)`);
    root.style.setProperty('--text-on-bg', `rgb(${textOnBg})`);
  } catch (e) {
    // Fallback palette
    const root = document.documentElement;
    root.style.setProperty('--accent', '#667eea');
    root.style.setProperty('--accent-2', '#764ba2');
    root.style.setProperty('--bg-dim', 'rgba(0,0,0,0.35)');
    root.style.setProperty('--text-on-bg', '#ffffff');
  }
}

