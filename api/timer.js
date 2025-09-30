diff --git a/package.json b/package.json
index 0000000..1111111 100644
--- a/package.json
+++ b/package.json
@@ -1,9 +1,14 @@
 {
   "name": "email-countdown-vercel",
   "version": "1.0.0",
   "private": true,
   "type": "commonjs",
   "dependencies": {
-    "@napi-rs/canvas": "^0.1.77",
-    "dayjs": "^1.11.12"
+    "@napi-rs/canvas": "^0.1.77",
+    "dayjs": "^1.11.12"
   }
 }
diff --git a/api/timer.js b/api/timer.js
new file mode 100644
index 0000000..2222222
--- /dev/null
+++ b/api/timer.js
@@ -0,0 +1,297 @@
+// Serverless PNG countdown for email (Klaviyo embeddable)
+// Endpoint: /api/timer
+// Query params:
+//   end            ISO UTC end, e.g. 2025-09-01T00:00:00Z
+//   end_local      Local end, e.g. "2025-09-01 00:00" or "2025-09-01T00:00"
+//   tz             IANA timezone, e.g. "Asia/Karachi" (required with end_local)
+//   start          ISO UTC start; combine with ttl_* for evergreen
+//   ttl_days / ttl_hours / ttl_minutes / ttl_seconds
+//   w,h            width/height (px) default 600x140
+//   scale          1 or 2 (retina)
+//   bg,fg,box,label hex colors (no '#'): e.g. bg=0B0B0B&fg=FFFFFF
+//   style          "plain" (default) or "boxed"
+//   show_labels    true|false (default true)
+//   delim          delimiter between units (default ":")
+//   expiredText    text when expired (default "00:00:00:00")
+//   fontFamily     CSS font stack
+//   padDays        min digits for days (default 2)
+
+const { createCanvas } = require('@napi-rs/canvas');
+const dayjs = require('dayjs');
+const duration = require('dayjs/plugin/duration');
+const utc = require('dayjs/plugin/utc');
+const timezone = require('dayjs/plugin/timezone');
+const customParseFormat = require('dayjs/plugin/customParseFormat');
+
+dayjs.extend(duration);
+dayjs.extend(utc);
+dayjs.extend(timezone);
+dayjs.extend(customParseFormat);
+
+const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
+const toInt = (v, d = 0) => {
+  const n = parseInt(v, 10);
+  return Number.isFinite(n) ? n : d;
+};
+
+module.exports = async (req, res) => {
+  try {
+    const q = req.query;
+
+    // ----- Rendering options -----
+    const width  = clamp(toInt(q.w, 600), 200, 1600);
+    const height = clamp(toInt(q.h, 140), 80,  400);
+    const scale  = clamp(toInt(q.scale, 1), 1,  2);
+
+    const bg     = `#${(q.bg || '0B0B0B').replace('#','')}`;
+    const fg     = `#${(q.fg || 'FFFFFF').replace('#','')}`;
+    const boxCol = `#${(q.box || '1F1F1F').replace('#','')}`;
+    const labCol = `#${(q.label || 'BBBBBB').replace('#','')}`;
+
+    const style        = (q.style || 'plain').toLowerCase();
+    const showLabels   = String(q.show_labels || 'true').toLowerCase() !== 'false';
+    const delim        = (q.delim || ':').slice(0, 3);
+    const expiredText  = (q.expiredText || '00:00:00:00').toString().slice(0, 32);
+    const fontFamily   = (q.fontFamily || 'system-ui, -apple-system, Segoe UI, Arial, Helvetica, sans-serif');
+    const padDays      = clamp(toInt(q.padDays, 2), 1, 4);
+
+    // ----- Compute end time (UTC) -----
+    let endUtc;
+    if (q.end) {
+      // ISO UTC form
+      endUtc = dayjs.utc(q.end);
+    } else if (q.end_local && q.tz) {
+      // Strictly parse "YYYY-MM-DD HH:mm" OR "YYYY-MM-DDTHH:mm"
+      const raw = String(q.end_local);
+      const withT = raw.includes('T') ? raw : raw.replace(' ', 'T');
+      let parsed = dayjs(withT, ['YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm'], true);
+      if (!parsed.isValid()) {
+        // fallback: allow a looser parse if format mismatched
+        parsed = dayjs(withT);
+      }
+      // Apply timezone without shifting clock time, then convert to UTC
+      // (Day.js Timezone: .tz(zone, true) keeps local wall-clock) 
+      const inTz = parsed.tz(q.tz, true);
+      endUtc = inTz.utc();
+    } else if (q.start && (q.ttl_days || q.ttl_hours || q.ttl_minutes || q.ttl_seconds)) {
+      let d = dayjs.utc(q.start);
+      d = d.add(toInt(q.ttl_days), 'day')
+           .add(toInt(q.ttl_hours), 'hour')
+           .add(toInt(q.ttl_minutes), 'minute')
+           .add(toInt(q.ttl_seconds), 'second');
+      endUtc = d;
+    } else {
+      endUtc = dayjs.utc().add(24, 'hour');
+    }
+
+    if (!endUtc || !endUtc.isValid()) {
+      res.status(400).send('Invalid end time');
+      return;
+    }
+
+    const now = dayjs.utc();
+    let ms = endUtc.diff(now);
+    if (ms < 0) ms = 0;
+
+    // ----- Logging + Debug JSON -----
+    console.log(JSON.stringify({
+      q,
+      nowUtc: now.toISOString(),
+      endUtc: endUtc.toISOString(),
+      diffMs: ms
+    }));
+    if (q.debug === '1') {
+      res.setHeader('Content-Type', 'application/json');
+      res.status(200).end(JSON.stringify({
+        ok: true,
+        query: q,
+        nowUtc: now.toISOString(),
+        endUtc: endUtc.toISOString(),
+        diffMs: ms
+      }));
+      return;
+    }
+
+    // ----- Build label strings -----
+    const d = dayjs.duration(ms);
+    const days  = String(Math.floor(d.asDays())).padStart(padDays, '0');
+    const hours = String(d.hours()).padStart(2, '0');
+    const mins  = String(d.minutes()).padStart(2, '0');
+    const secs  = String(d.seconds()).padStart(2, '0');
+    const groups = ms === 0 ? expiredText.split(delim) : [days, hours, mins, secs];
+    const labels = ['DAYS', 'HOURS', 'MINUTES', 'SECONDS'];
+    const showUnitLabels = showLabels && ms > 0;
+
+    // ----- Canvas -----
+    const W = width * scale;
+    const H = height * scale;
+    const canvas = createCanvas(W, H);
+    const ctx = canvas.getContext('2d');
+    ctx.fillStyle = bg;
+    ctx.fillRect(0, 0, W, H);
+
+    // Layout
+    const topPad = Math.floor(0.18 * H);
+    const bottomPad = Math.floor(showUnitLabels ? 0.28 * H : 0.18 * H);
+    const contentH = H - topPad - bottomPad;
+
+    // Prepare parts
+    const parts = [];
+    for (let i = 0; i < groups.length; i++) {
+      parts.push({ type: 'num', text: groups[i] });
+      if (i < groups.length - 1) parts.push({ type: 'delim', text: delim });
+    }
+
+    // Fit font size
+    let fontSize = Math.floor(contentH * 0.9);
+    ctx.textBaseline = 'middle';
+    ctx.textAlign = 'center';
+    const maxWidth = Math.floor(W * 0.92);
+    let low = 12, high = fontSize;
+    while (low <= high) {
+      const mid = Math.floor((low + high) / 2);
+      ctx.font = `600 ${mid}px ${fontFamily}`;
+      let wTotal = 0;
+      for (const p of parts) {
+        const m = ctx.measureText(p.text);
+        wTotal += m.width + (p.type === 'delim' ? mid * 0.1 : mid * 0.25);
+      }
+      if (wTotal <= maxWidth) { fontSize = mid; low = mid + 1; } else { high = mid - 1; }
+    }
+
+    // Draw digits
+    const midY = topPad + contentH / 2;
+    ctx.font = `600 ${fontSize}px ${fontFamily}`;
+    let total = 0;
+    for (const p of parts) {
+      const m = ctx.measureText(p.text);
+      total += m.width + (p.type === 'delim' ? fontSize * 0.1 : fontSize * 0.25);
+    }
+    let x = (W - total) / 2;
+    for (const p of parts) {
+      const m = ctx.measureText(p.text);
+      const blockW = m.width;
+      if (style === 'boxed' && p.type === 'num' && ms > 0) {
+        const padX = Math.floor(fontSize * 0.22);
+        const padY = Math.floor(fontSize * 0.30);
+        ctx.fillStyle = boxCol;
+        const boxX = x - padX / 2;
+        const boxY = midY - (fontSize / 2) - padY / 2;
+        const boxW = blockW + padX;
+        const boxH = fontSize + padY;
+        const r = Math.min(boxH, boxW) * 0.12;
+        roundedRect(ctx, boxX, boxY, boxW, boxH, r);
+        ctx.fill();
+        ctx.fillStyle = fg;
+      } else {
+        ctx.fillStyle = fg;
+      }
+      ctx.fillText(p.text, x + blockW / 2, midY);
+      x += blockW + (p.type === 'delim' ? fontSize * 0.1 : fontSize * 0.25);
+    }
+
+    // Unit labels
+    if (showUnitLabels) {
+      ctx.fillStyle = labCol;
+      const labelSize = Math.max(12 * scale, Math.floor(fontSize * 0.26));
+      ctx.font = `600 ${labelSize}px ${fontFamily}`;
+      x = (W - total) / 2;
+      let gi = 0;
+      for (const p of parts) {
+        const m = ctx.measureText(p.text);
+        const blockW = m.width;
+        if (p.type === 'num') {
+          const text = labels[gi] || '';
+          ctx.fillText(text, x + blockW / 2, H - Math.floor(labelSize * 0.9));
+          gi++;
+        }
+        x += blockW + (p.type === 'delim' ? fontSize * 0.1 : fontSize * 0.25);
+      }
+    }
+
+    // On-image debug overlay
+    if (q.overlay === '1') {
+      ctx.font = `600 ${Math.max(10 * scale, Math.floor(H * 0.08))}px ${fontFamily}`;
+      ctx.fillStyle = '#FF00FF';
+      ctx.textAlign = 'left';
+      ctx.textBaseline = 'top';
+      const overlayText = `now=${now.toISOString()}\nend=${endUtc.toISOString()}\nms=${ms}`;
+      const lines = overlayText.split('\n');
+      let oy = Math.floor(H * 0.04);
+      for (const line of lines) {
+        ctx.fillText(line, Math.floor(W * 0.04), oy);
+        oy += Math.floor(H * 0.1);
+      }
+    }
+
+    // Response headers
+    res.setHeader('Content-Type', 'image/png');
+    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, private');
+    res.setHeader('Pragma', 'no-cache');
+    res.setHeader('Expires', '0');
+
+    const png = await canvas.encode('png');
+    res.status(200).end(png);
+  } catch (e) {
+    try {
+      const c = createCanvas(1, 1);
+      const png = await c.encode('png');
+      res.setHeader('Content-Type', 'image/png');
+      res.status(200).end(png);
+    } catch {
+      res.status(500).end();
+    }
+  }
+};
+
+function roundedRect(ctx, x, y, w, h, r) {
+  ctx.beginPath();
+  ctx.moveTo(x + r, y);
+  ctx.arcTo(x + w, y, x + w, y + h, r);
+  ctx.arcTo(x + w, y + h, x, y + h, r);
+  ctx.arcTo(x, y + h, x, y, r);
+  ctx.arcTo(x, y, x + w, y, r);
+  ctx.closePath();
+}
diff --git a/vercel.json b/vercel.json
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/vercel.json
@@ -0,0 +1,10 @@
+{
+  "$schema": "https://openapi.vercel.sh/vercel.json",
+  "functions": {
+    "api/timer.js": {
+      "memory": 1024,
+      "maxDuration": 10
+    }
+  }
+}
