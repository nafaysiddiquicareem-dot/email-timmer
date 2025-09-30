// Serverless PNG countdown for email (Klaviyo embeddable)
// Endpoint: /api/timer
// Query params:
//   - end            ISO UTC end (e.g., 2025-09-01T00:00:00Z)
//   - end_local      Local end (e.g., "2025-09-01 00:00")
//   - tz             IANA timezone (e.g., "Asia/Karachi") used with end_local
//   - start          ISO UTC start; combine with ttl_* for evergreen
//   - ttl_days / ttl_hours / ttl_minutes / ttl_seconds
//   - w,h            width/height px (default 600x140; min 200x80; max 1600x400)
//   - scale          1 or 2 (retina render). Default 1
//   - bg,fg,box,label  hex colors without '#': 0B0B0B, FFFFFF, etc.
//   - style          "plain" (default) or "boxed"
//   - show_labels    true|false (default true)
//   - delim          delimiter between units (default ":")
//   - expiredText    text when expired (default "00:00:00:00")
//   - fontFamily     CSS font stack (default system stack)
//   - padDays        min digits for days (default 2)

const { createCanvas } = require('@napi-rs/canvas');
const dayjs = require('dayjs');
const duration = require('dayjs/plugin/duration');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(duration);
dayjs.extend(utc);
dayjs.extend(timezone);

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const toInt = (v, d = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

module.exports = async (req, res) => {
  try {
    const q = req.query;

    const width  = clamp(toInt(q.w, 600), 200, 1600);
    const height = clamp(toInt(q.h, 140), 80,  400);
    const scale  = clamp(toInt(q.scale, 1), 1,  2);

    const bg     = `#${(q.bg || '0B0B0B').replace('#','')}`;
    const fg     = `#${(q.fg || 'FFFFFF').replace('#','')}`;
    const boxCol = `#${(q.box || '1F1F1F').replace('#','')}`;
    const labCol = `#${(q.label || 'BBBBBB').replace('#','')}`;

    const style        = (q.style || 'plain').toLowerCase();
    const showLabels   = String(q.show_labels || 'true').toLowerCase() !== 'false';
    const delim        = (q.delim || ':').slice(0, 3);
    const expiredText  = (q.expiredText || '00:00:00:00').toString().slice(0, 32);
    const fontFamily   = (q.fontFamily || 'system-ui, -apple-system, Segoe UI, Arial, Helvetica, sans-serif');
    const padDays      = clamp(toInt(q.padDays, 2), 1, 4);

    // --- Compute end time (UTC) ---
    let endUtc;
    if (q.end) {
      endUtc = dayjs.utc(q.end);
    } else if (q.end_local) {
      const tz = q.tz || 'UTC';
      // Interpret end_local in the provided timezone, then convert to UTC:
      // dayjs.tz('YYYY-MM-DD HH:mm', 'Asia/Karachi').utc()
      endUtc = dayjs.tz(q.end_local, tz).utc();
    } else if (q.start && (q.ttl_days || q.ttl_hours || q.ttl_minutes || q.ttl_seconds)) {
      let d = dayjs.utc(q.start);
      d = d.add(toInt(q.ttl_days), 'day')
           .add(toInt(q.ttl_hours), 'hour')
           .add(toInt(q.ttl_minutes), 'minute')
           .add(toInt(q.ttl_seconds), 'second');
      endUtc = d;
    } else {
      // Default: 24h from now
      endUtc = dayjs.utc().add(24, 'hour');
    }

    if (!endUtc.isValid()) {
      res.status(400).send('Invalid end time');
      return;
    }

    const now = dayjs.utc();
    let ms = endUtc.diff(now);
    if (ms < 0) ms = 0;

    const d = dayjs.duration(ms);
    const days  = String(Math.floor(d.asDays())).padStart(padDays, '0');
    const hours = String(d.hours()).padStart(2, '0');
    const mins  = String(d.minutes()).padStart(2, '0');
    const secs  = String(d.seconds()).padStart(2, '0');

    // --- Render PNG ---
    const W = width * scale;
    const H = height * scale;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // BG
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Compose text parts
    const groups = ms === 0 ? expiredText.split(delim) : [days, hours, mins, secs];
    const labels = ['DAYS', 'HOURS', 'MINUTES', 'SECONDS'];
    const showUnitLabels = showLabels && ms > 0;

    // Layout
    const topPad = Math.floor(0.18 * H);
    const bottomPad = Math.floor(showUnitLabels ? 0.28 * H : 0.18 * H);
    const contentH = H - topPad - bottomPad;

    // Fit font
    let fontSize = Math.floor(contentH * 0.9);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const parts = [];
    for (let i = 0; i < groups.length; i++) {
      parts.push({ type: 'num', text: groups[i] });
      if (i < groups.length - 1) parts.push({ type: 'delim', text: delim });
    }
    const maxWidth = Math.floor(W * 0.92);
    let low = 12, high = fontSize;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      ctx.font = `600 ${mid}px ${fontFamily}`;
      let wTotal = 0;
      for (const p of parts) {
        const m = ctx.measureText(p.text);
        wTotal += m.width + (p.type === 'delim' ? mid * 0.1 : mid * 0.25);
      }
      if (wTotal <= maxWidth) { fontSize = mid; low = mid + 1; } else { high = mid - 1; }
    }

    // Draw
    const midY = topPad + contentH / 2;
    ctx.font = `600 ${fontSize}px ${fontFamily}`;

    // Total width
    let total = 0;
    for (const p of parts) {
      const m = ctx.measureText(p.text);
      total += m.width + (p.type === 'delim' ? fontSize * 0.1 : fontSize * 0.25);
    }
    let x = (W - total) / 2;

    for (const p of parts) {
      const m = ctx.measureText(p.text);
      const blockW = m.width;

      if (style === 'boxed' && p.type === 'num' && ms > 0) {
        const padX = Math.floor(fontSize * 0.22);
        const padY = Math.floor(fontSize * 0.30);
        ctx.fillStyle = boxCol;
        const boxX = x - padX / 2;
        const boxY = midY - (fontSize / 2) - padY / 2;
        const boxW = blockW + padX;
        const boxH = fontSize + padY;
        const r = Math.min(boxH, boxW) * 0.12;
        roundedRect(ctx, boxX, boxY, boxW, boxH, r);
        ctx.fill();
        ctx.fillStyle = fg;
      } else {
        ctx.fillStyle = fg;
      }

      ctx.fillText(p.text, x + blockW / 2, midY);
      x += blockW + (p.type === 'delim' ? fontSize * 0.1 : fontSize * 0.25);
    }

    // Unit labels
    if (showUnitLabels) {
      ctx.fillStyle = labCol;
      const labelSize = Math.max(12 * scale, Math.floor(fontSize * 0.26));
      ctx.font = `600 ${labelSize}px ${fontFamily}`;

      x = (W - total) / 2;
      let gi = 0;
      for (const p of parts) {
        const m = ctx.measureText(p.text);
        const blockW = m.width;
        if (p.type === 'num') {
          const text = labels[gi] || '';
          ctx.fillText(text, x + blockW / 2, H - Math.floor(labelSize * 0.9));
          gi++;
        }
        x += blockW + (p.type === 'delim' ? fontSize * 0.1 : fontSize * 0.25);
      }
    }

    // HTTP headers to minimize caching
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const png = await canvas.encode('png');
    res.status(200).end(png);
  } catch (e) {
    // Safe 1x1 PNG fallback on errors
    const c = createCanvas(1, 1);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 1, 1);
    res.setHeader('Content-Type', 'image/png');
    const png = await c.encode('png');
    res.status(200).end(png);
  }
};

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}