/*
 * Overlay runtime: draws a compiled overlay plan (#plan) on a transparent page, as a pure function of time.
 * The renderer's virtual clock drives requestAnimationFrame, so every frame is exact and repeatable.
 * Elements: captions (word-synced) · punch lines (slam / show / highlight / kicker / stamp / typewriter, strike)
 * · counters · icons (stroke drawn) · lists · lower thirds · chapters · photo cards · flash · progress bar.
 */
(() => {
  const P = JSON.parse(document.getElementById("plan").textContent);
  const ICONS = JSON.parse(document.getElementById("icons").textContent);
  const W = P.w, H = P.h, U = Math.min(W, H) / 1080, VERT = H > W;
  const ACC = P.accent;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const E = {
    out3: k => 1 - Math.pow(1 - clamp(k), 3),
    out5: k => 1 - Math.pow(1 - clamp(k), 5),
    in2: k => clamp(k) * clamp(k),
    back: k => { k = clamp(k); const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
    inOut: k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
  };
  const COLORS = { accent: ACC, white: "#FFFFFF", red: "#FF3B30", yellow: "#FFD21F", green: "#22C55E", blue: "#3B82F6" };
  const col = c => COLORS[c] || ACC;
  const darkOn = hex => { const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6; };
  const isRtl = s => /[֐-ࣿ]/.test(s || "");
  document.documentElement.dir = P.rtl ? "rtl" : "ltr";

  const css = document.createElement("style");
  css.textContent = `
html,body{margin:0;padding:0;background:transparent!important;width:${W}px;height:${H}px;overflow:hidden}
#ov{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;font-family:Cairo,"Noto Kufi Arabic","Segoe UI",Tahoma,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
#ov *{box-sizing:border-box}
.el{position:absolute;visibility:hidden;will-change:transform,opacity}
.row{left:0;right:0;display:flex;justify-content:center;padding:0 6%}
.sh{text-shadow:0 ${3 * U}px 0 rgba(0,0,0,.45),0 ${6 * U}px ${22 * U}px rgba(0,0,0,.75),0 0 ${2 * U}px rgba(0,0,0,.9)}
.pn{font-weight:900;line-height:1.15;text-align:center;white-space:nowrap;position:relative;display:inline-block}
.pn .w{display:inline-block;white-space:pre}
.pn .em{color:var(--acc)}
.hl{color:#111;text-shadow:none;padding:${8 * U}px ${26 * U}px ${14 * U}px;position:relative;z-index:0}
.hl .bar{position:absolute;inset:0;background:var(--acc);border-radius:${10 * U}px;z-index:-1;box-shadow:0 ${10 * U}px ${30 * U}px rgba(0,0,0,.35)}
.hl .em{color:#fff;background:#111;border-radius:${8 * U}px;padding:0 ${10 * U}px}
.kk{font-family:"Reem Kufi",Cairo,sans-serif;font-weight:700;letter-spacing:.01em}
.kk:before,.kk:after{content:"";display:inline-block;width:1.4em;height:${5 * U}px;background:currentColor;vertical-align:middle;margin:0 .45em;opacity:.85;border-radius:${3 * U}px}
.st{border:${7 * U}px solid currentColor;border-radius:${12 * U}px;padding:${2 * U}px ${28 * U}px ${10 * U}px;background:rgba(10,0,0,.35);text-shadow:none}
.strike{position:absolute;left:-3%;right:-3%;top:52%;height:${10 * U}px;background:#FF3B30;border-radius:${5 * U}px;box-shadow:0 0 ${12 * U}px rgba(255,59,48,.7);transform-origin:${P.rtl ? "100%" : "0%"} 50%}
.caret{display:inline-block;width:${6 * U}px;height:.9em;background:var(--acc);vertical-align:middle;margin:0 ${4 * U}px}
.cap{left:0;right:0;text-align:center;padding:0 7%}
.cap .ln{display:inline-block;font-weight:900;line-height:1.25;white-space:normal}
.cap .cw{display:inline-block;margin:0 .14em;transform-origin:50% 60%}
.cap.box .ln{background:rgba(8,8,12,.72);border-radius:${16 * U}px;padding:${8 * U}px ${22 * U}px ${14 * U}px;box-shadow:0 ${8 * U}px ${26 * U}px rgba(0,0,0,.35)}
.cap.clean .ln{font-weight:700}
.ctr{text-align:center}
.ctr .num{font-weight:900;line-height:1;font-variant-numeric:tabular-nums;direction:ltr;display:inline-block}
.ctr .lab{font-weight:700;margin-top:${10 * U}px;opacity:.95}
.ic{display:flex;align-items:center;gap:${22 * U}px}
.badge{border-radius:50%;display:grid;place-items:center;position:relative;flex:none}
.badge:after{content:"";position:absolute;inset:-${10 * U}px;border-radius:50%;border:${4 * U}px solid var(--acc);opacity:var(--ring,0);transform:scale(var(--rs,1))}
.badge svg{overflow:visible}
.pill{font-weight:900;padding:${10 * U}px ${28 * U}px ${14 * U}px;border-radius:${999}px;background:rgba(10,10,14,.78);white-space:nowrap;box-shadow:0 ${8 * U}px ${24 * U}px rgba(0,0,0,.35)}
.lst{background:rgba(10,10,14,.74);border-radius:${26 * U}px;padding:${26 * U}px ${34 * U}px;box-shadow:0 ${16 * U}px ${44 * U}px rgba(0,0,0,.4);border:${2 * U}px solid rgba(255,255,255,.08)}
.lst .tt{font-family:"Reem Kufi",Cairo,sans-serif;font-weight:700;color:var(--acc);margin-bottom:${12 * U}px}
.lst .it{display:flex;align-items:center;gap:${18 * U}px;font-weight:800;margin:${10 * U}px 0;white-space:nowrap}
.lst .ck{width:1.25em;height:1.25em;border-radius:50%;background:var(--acc);display:grid;place-items:center;flex:none}
.l3{display:flex;align-items:stretch}
.l3 .acc{width:${12 * U}px;background:var(--acc);border-radius:${4 * U}px}
.l3 .pan{background:rgba(10,10,14,.82);padding:${14 * U}px ${30 * U}px ${18 * U}px;overflow:hidden;white-space:nowrap}
.l3 .nm{font-weight:900;line-height:1.15}
.l3 .rl{font-weight:700;color:var(--acc);line-height:1.2}
.chp{left:0;right:0;text-align:center;padding:${40 * U}px 0}
.chp .bgd{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.62) 18%,rgba(0,0,0,.62) 82%,rgba(0,0,0,0))}
.chp .no{position:relative;font-family:"Reem Kufi",Cairo,sans-serif;font-weight:700;color:var(--acc);line-height:1}
.chp .ln2{position:relative;height:${5 * U}px;background:var(--acc);margin:${16 * U}px auto;border-radius:${3 * U}px}
.chp .ti{position:relative;font-weight:900;line-height:1.2}
.ph{background:#f6f3ec;padding:${14 * U}px ${14 * U}px ${18 * U}px;box-shadow:0 ${22 * U}px ${60 * U}px rgba(0,0,0,.55);border-radius:${6 * U}px}
.ph .im{overflow:hidden;position:relative;background:#222}
.ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ph .cp{color:#151515;font-weight:800;text-align:center;margin-top:${12 * U}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#flash{position:absolute;inset:0;background:#fff;opacity:0;z-index:6}
.el{z-index:3}
.dec{position:absolute;inset:0;visibility:hidden;z-index:1;pointer-events:none}
svg.dec path{fill:none;stroke-linecap:round}
.qt{left:0;right:0;text-align:center;z-index:2}
.qt .bgq{position:absolute;left:0;right:0;top:-40%;bottom:-40%;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.62) 30%,rgba(0,0,0,.62) 70%,rgba(0,0,0,0))}
.qt .orn{position:relative;margin:0 auto ${18 * U}px;height:${3 * U}px;background:linear-gradient(90deg,transparent,var(--acc),transparent)}
.qt .tx{position:relative;font-family:Amiri,Cairo,serif;font-weight:700;line-height:1.45;padding:0 8%;white-space:normal}
.qt .tx .qw{display:inline-block;white-space:pre}
.qt .tx .em{color:var(--acc)}
.qt .au{position:relative;font-weight:700;color:var(--acc);margin-top:${18 * U}px;opacity:.9}
#prog{position:absolute;left:0;top:0;height:${7 * U}px;background:var(--acc);box-shadow:0 0 ${12 * U}px var(--acc)}
`;
  document.head.appendChild(css);
  const ov = document.getElementById("ov");
  ov.style.setProperty("--acc", ACC);
  const mk = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; (parent || ov).appendChild(e); return e; };
  const svgIcon = (name, size, stroke, width) => {
    const body = ICONS[name] || ICONS.sparkles || "";
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  };
  const prepDraw = root => [...root.querySelectorAll("path,line,polyline,polygon,circle,rect,ellipse")].map(p => { p.setAttribute("pathLength", "1"); p.style.strokeDasharray = "1"; p.style.strokeDashoffset = "1"; return p; });
  // Shrinks a line that is too wide for the frame, then lets it wrap if it still does not fit.
  const toFit = [];
  const fit = (el, maxW) => { toFit.push([el, maxW]); };
  const doFit = (el, maxW) => {
    const w = el.scrollWidth;
    if (w <= maxW) return;
    const k = Math.max(0.62, maxW / w);
    el.style.fontSize = parseFloat(el.style.fontSize) * k + "px";
    if (el.scrollWidth > maxW) { el.style.whiteSpace = "normal"; el.style.maxWidth = maxW + "px"; }
  };
  const enterExit = (it, t, inDur = 0.28, outDur = 0.24) => ({ a: clamp((t - it.start) / inDur), b: clamp((it.end - t) / outDur), life: clamp((t - it.start) / Math.max(0.1, it.end - it.start)) });
  const place = (el, y) => { el.style.top = y * H + "px"; };

  /* ---------------- build */
  const SIZE = VERT ? { xl: 160, l: 124, m: 94, s: 70 } : { xl: 124, l: 96, m: 74, s: 56 };
  const items = P.items.map(it => ({ ...it }));
  for (const it of items) {
    if (it.type === "punch") {
      const row = mk("div", "el row", ov); place(row, it.y);
      const c = col(it.color);
      const fs = SIZE[it.size || "l"] * U;
      let cls = "pn sh";
      if (it.style === "highlight") cls = "pn hl";
      if (it.style === "kicker") cls = "pn kk sh";
      if (it.style === "stamp") cls = "pn st";
      const box = mk("div", cls, row);
      box.style.fontSize = (it.style === "kicker" ? Math.max(fs * 0.72, 66 * U) : fs) + "px";
      box.style.color = it.style === "highlight" ? "#111" : c;
      box.dir = isRtl(it.text) ? "rtl" : "ltr";
      if (it.style === "highlight") { it.bar = mk("div", "bar", box); it.bar.style.background = c === "#FFFFFF" ? "#fff" : c; }
      const words = it.text.split(/\s+/).filter(Boolean);
      it.words = words.map((w, i) => { const s = mk("span", "w" + (it.emphasis && it.emphasis.split(/\s+/).some(e => w.replace(/[.,!?؟،]/g, "") === e.replace(/[.,!?؟،]/g, "")) ? " em" : ""), box, w + (i < words.length - 1 ? " " : "")); return s; });
      if (it.style === "typewriter") { it.full = it.text; it.caret = mk("span", "caret", box); }
      if (it.strike != null) { it.strikeEl = mk("div", "strike", box); }
      fit(box, W * 0.88);
      it.row = row; it.box = box;
    }
    if (it.type === "counter") {
      const row = mk("div", "el row", ov); place(row, it.y);
      const box = mk("div", "ctr sh", row);
      it.num = mk("div", "num", box); it.num.style.fontSize = (VERT ? 150 : 120) * U + "px"; it.num.style.color = col(it.color);
      if (it.label) { it.lab = mk("div", "lab", box, it.label); it.lab.style.fontSize = (VERT ? 60 : 50) * U + "px"; }
      it.row = row; it.box = box;
    }
    if (it.type === "icon") {
      const row = mk("div", "el row", ov); place(row, it.y);
      row.style.justifyContent = it.side === "left" ? "flex-start" : it.side === "right" ? "flex-end" : "center";
      const box = mk("div", "ic", row); box.dir = "ltr";
      if (it.side === "right") box.style.flexDirection = "row-reverse";
      const d = (VERT ? 190 : 140) * U;
      const c = col(it.color);
      const badge = mk("div", "badge", box);
      badge.style.cssText = `width:${d}px;height:${d}px;background:radial-gradient(circle at 35% 30%,#ffffff40,transparent 60%),${c};box-shadow:0 ${12 * U}px ${36 * U}px rgba(0,0,0,.45),0 0 ${40 * U}px ${c}66`;
      badge.innerHTML = svgIcon(it.icon, d * 0.52, darkOn(c) ? "#111" : "#fff", 2.3);
      it.paths = prepDraw(badge);
      if (it.label) { it.pill = mk("div", "pill sh", box, it.label); it.pill.style.fontSize = (VERT ? 64 : 50) * U + "px"; it.pill.dir = isRtl(it.label) ? "rtl" : "ltr"; }
      it.row = row; it.box = box; it.badge = badge;
    }
    if (it.type === "emoji" && it.lottie && window.lottie) {
      const row = mk("div", "el row", ov); place(row, it.y);
      row.style.justifyContent = it.side === "left" ? "flex-start" : it.side === "right" ? "flex-end" : "center";
      const box = mk("div", "ic", row); box.dir = "ltr";
      if (it.side === "right") box.style.flexDirection = "row-reverse";
      const d = ({ m: 200, l: 270, xl: 380 }[it.size || "l"] || 270) * U * (VERT ? 1 : 0.8);
      const holder = mk("div", "emo", box); holder.style.cssText = `width:${d}px;height:${d}px;filter:drop-shadow(0 ${14 * U}px ${26 * U}px rgba(0,0,0,.45))`;
      it.anim = window.lottie.loadAnimation({ container: holder, renderer: "svg", loop: false, autoplay: false, animationData: it.lottie, rendererSettings: { preserveAspectRatio: "xMidYMid meet" } });
      it.frames = Math.max(1, (it.lottie.op || 60) - (it.lottie.ip || 0));
      it.fr = it.lottie.fr || 30;
      if (it.label) { it.pill = mk("div", "pill sh", box, it.label); it.pill.style.fontSize = (VERT ? 64 : 50) * U + "px"; it.pill.dir = isRtl(it.label) ? "rtl" : "ltr"; }
      it.row = row; it.box = box; it.badge = holder;
    }
    if (it.type === "list") {
      const row = mk("div", "el row", ov); place(row, it.y);
      const box = mk("div", "lst", row); box.dir = isRtl((it.title || "") + it.items.map(x => x.text).join(" ")) ? "rtl" : "ltr";
      box.style.fontSize = (VERT ? 58 : 48) * U + "px";
      box.style.minWidth = W * (VERT ? 0.7 : 0.42) + "px";
      if (it.title) { const tt = mk("div", "tt", box, it.title); tt.style.fontSize = (VERT ? 46 : 40) * U + "px"; }
      it.rows = it.items.map(x => { const r = mk("div", "it", box); const ck = mk("div", "ck", r); ck.innerHTML = svgIcon("check", (VERT ? 40 : 34) * U, darkOn(ACC) ? "#111" : "#fff", 3.2); mk("div", "", r, x.text); return { r, paths: prepDraw(ck) }; });
      it.row = row; it.box = box;
    }
    if (it.type === "lower3") {
      const el = mk("div", "el l3", ov); place(el, it.y);
      el.style[P.rtl ? "right" : "left"] = W * 0.06 + "px";
      el.dir = P.rtl ? "rtl" : "ltr";
      it.acc = mk("div", "acc", el);
      it.pan = mk("div", "pan", el);
      const nm = mk("div", "nm sh", it.pan, it.name); nm.style.fontSize = (VERT ? 68 : 58) * U + "px";
      if (it.role) { const rl = mk("div", "rl", it.pan, it.role); rl.style.fontSize = (VERT ? 44 : 38) * U + "px"; }
      it.el = el;
    }
    if (it.type === "chapter") {
      const el = mk("div", "el chp", ov); place(el, it.y);
      mk("div", "bgd", el);
      if (it.num) { it.no = mk("div", "no", el, it.num); it.no.style.fontSize = (VERT ? 120 : 100) * U + "px"; }
      it.ln = mk("div", "ln2", el);
      it.ti = mk("div", "ti sh", el, it.title); it.ti.style.fontSize = (VERT ? 78 : 66) * U + "px";
      it.el = el;
    }
    if (it.type === "photo" && it.src) {
      const row = mk("div", "el row", ov); place(row, it.y);
      row.style.justifyContent = it.side === "left" ? "flex-start" : it.side === "right" ? "flex-end" : "center";
      const card = mk("div", "ph", row);
      const pw = W * (VERT ? 0.5 : 0.28);
      card.style.width = pw + "px";
      const im = mk("div", "im", card); im.style.height = pw * 0.78 + "px";
      const img = mk("img", "", im); img.src = it.src;
      if (it.caption) { const cp = mk("div", "cp", card, it.caption); cp.style.fontSize = (VERT ? 38 : 32) * U + "px"; cp.dir = isRtl(it.caption) ? "rtl" : "ltr"; }
      it.row = row; it.card = card; it.img = img;
      it.tilt = (it.side === "right" ? 1 : -1) * 3.5;
    }
  }
  // Decor: light leaks, particles, cracks, and the closing quote.
  const GLOW = { warm: ["255,150,60", "255,90,40"], gold: ["255,200,90", "230,160,40"], red: ["255,60,60", "200,20,40"], cold: ["90,160,255", "60,90,220"], pink: ["255,110,170", "255,70,120"] };
  for (const it of items) {
    if (it.type === "glow") { it.el = mk("div", "dec", ov); it.cols = GLOW[it.color] || GLOW.warm; }
    if (it.type === "particles") {
      const c = mk("canvas", "dec", ov); c.width = W; c.height = H; it.el = c; it.g = c.getContext("2d");
      let seed = 7 + Math.round(it.start * 100);
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const n = { hearts: 26, bokeh: 34, sparks: 60, dust: 70, snow: 80 }[it.kind] || 40;
      it.ps = Array.from({ length: n }, () => ({ x: r(), y: r(), z: 0.35 + r() * 0.65, ph: r() * 6.28, sp: 0.5 + r(), hue: r() }));
    }
    if (it.type === "crack") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "dec"); svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      let seed = 42 + Math.round(it.start * 10);
      const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const cx = it.x * W, cy = it.y * H;
      let html = "";
      for (let k = 0; k < 15; k++) {
        let a = (k / 15) * Math.PI * 2 + r() * 0.35, x = cx, y = cy, d = `M${cx.toFixed(1)} ${cy.toFixed(1)}`;
        const len = (420 + r() * 900) * U;
        for (let q = 0; q < 12; q++) { a += (r() - 0.5) * 0.55; x += Math.cos(a) * (len / 12); y += Math.sin(a) * (len / 12); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
        html += `<path d="${d}" stroke="rgba(255,255,255,.92)" stroke-width="${((2 + r() * 3.5) * U).toFixed(1)}" style="filter:drop-shadow(0 0 ${6 * U}px rgba(255,255,255,.7))"/>`;
        if (r() > 0.4) { const bx = cx + (x - cx) * (0.3 + r() * 0.4), by = cy + (y - cy) * (0.3 + r() * 0.4); html += `<path d="M${bx.toFixed(1)} ${by.toFixed(1)} l${((r() - 0.5) * 260 * U).toFixed(1)} ${((r() - 0.5) * 260 * U).toFixed(1)}" stroke="rgba(255,255,255,.75)" stroke-width="${(1.5 * U).toFixed(1)}"/>`; }
      }
      html += `<circle cx="${cx}" cy="${cy}" r="${26 * U}" fill="rgba(255,255,255,.85)" style="filter:blur(${10 * U}px)"/>`;
      svg.innerHTML = html;
      ov.appendChild(svg);
      it.el = svg;
      it.paths = [...svg.querySelectorAll("path")].map(p => { p.setAttribute("pathLength", "1"); p.style.strokeDasharray = "1"; p.style.strokeDashoffset = "1"; return p; });
      it.dot = svg.querySelector("circle");
    }
    if (it.type === "quote") {
      const el = mk("div", "el qt", ov); place(el, it.y);
      mk("div", "bgq", el);
      it.orn = mk("div", "orn", el);
      const tx = mk("div", "tx sh", el); tx.dir = isRtl(it.text) ? "rtl" : "ltr";
      tx.style.fontSize = (VERT ? 92 : 72) * U + "px";
      const ws = it.text.split(/\s+/).filter(Boolean);
      const em = (it.emphasis || "").split(/\s+/).filter(Boolean).map(e => e.replace(/[.,!?؟،]/g, ""));
      it.ws = ws.map((w, i) => mk("span", "qw" + (em.includes(w.replace(/[.,!?؟،]/g, "")) ? " em" : ""), tx, w + (i < ws.length - 1 ? " " : "")));
      if (it.author) { const au = mk("div", "au", el, it.author); au.style.fontSize = (VERT ? 44 : 38) * U + "px"; it.au = au; }
      it.el = el;
    }
  }
  // Captions.
  let cap = null;
  if (P.captions) {
    cap = { ...P.captions, el: mk("div", "el cap " + P.captions.style, ov) };
    place(cap.el, P.captions.y);
    cap.el.style.transform = "translateY(-50%)";
    cap.ln = mk("div", "ln sh", cap.el);
    cap.ln.style.fontSize = (VERT ? 96 : 66) * U + "px";
    cap.cur = -1;
  }
  const flash = mk("div", "", ov); flash.id = "flash";
  const prog = P.progress ? mk("div", "", ov) : null; if (prog) prog.id = "prog";

  /* ---------------- draw */
  function drawPunch(it, t) {
    const { a, b, life } = enterExit(it, t, it.style === "typewriter" ? 0.1 : 0.3, 0.24);
    const out = E.in2(1 - b);
    let tr = "", op = Math.min(1, a * 3) * (1 - out), filt = "none";
    const drift = 1 + 0.035 * life;
    if (it.style === "slam") { const k = E.out5(a); tr = `scale(${(lerp(1.65, 1, k) * drift).toFixed(4)})`; filt = a < 1 ? `blur(${((1 - k) * 10 * U).toFixed(2)}px)` : "none"; }
    else if (it.style === "stamp") { const k = E.out5(a); tr = `rotate(${lerp(-14, -5, k).toFixed(2)}deg) scale(${(lerp(2.3, 1, k) * drift).toFixed(4)})`; }
    else if (it.style === "kicker") { const k = E.out3(a); tr = `translateY(${((1 - k) * 30 * U).toFixed(1)}px)`; }
    else if (it.style === "highlight") {
      const k = E.out3((t - it.start) / 0.32);
      it.bar.style.transformOrigin = it.box.dir === "rtl" ? "100% 50%" : "0% 50%";
      it.bar.style.transform = `scaleX(${k.toFixed(4)})`;
      const reveal = clamp((t - it.start - 0.05) / 0.3);
      it.box.style.clipPath = it.box.dir === "rtl" ? `inset(-20% 0 -20% ${((1 - reveal) * 100).toFixed(2)}%)` : `inset(-20% ${((1 - reveal) * 100).toFixed(2)}% -20% 0)`;
      tr = `scale(${(lerp(0.94, 1, E.out3(a)) * drift).toFixed(4)})`;
      op = 1 - out;
    } else if (it.style === "show") {
      const n = it.words.length;
      it.words.forEach((w, i) => { const k = E.out3((t - it.start - i * 0.07) / 0.32); w.style.opacity = k.toFixed(3); w.style.transform = `translateY(${((1 - k) * 0.45).toFixed(3)}em)`; });
      tr = `scale(${drift.toFixed(4)})`;
      op = 1 - out;
      void n;
    } else if (it.style === "typewriter") {
      const chars = [...it.full];
      const n = Math.round(clamp((t - it.start) / Math.max(0.3, Math.min(1.6, chars.length * 0.045))) * chars.length);
      let left = n;
      it.words.forEach(w => { const full = w.dataset.full ?? (w.dataset.full = w.textContent); const take = Math.max(0, Math.min(full.length, left)); w.textContent = full.slice(0, take); left -= full.length; });
      it.caret.style.opacity = n < chars.length || Math.floor(t * 2.2) % 2 === 0 ? "1" : "0";
      op = 1 - out;
    }
    if (it.strikeEl) {
      const k = it.strike != null ? E.out3((t - it.strike) / 0.25) : 0;
      it.strikeEl.style.transform = `scaleX(${k.toFixed(4)})`;
      if (k > 0) it.box.style.opacity = "1";
    }
    it.box.style.transform = tr || "none";
    it.box.style.filter = filt;
    it.row.style.opacity = op.toFixed(3);
    it.row.style.transform = `translateY(-50%) translateY(${(-out * 24 * U).toFixed(1)}px)`;
  }
  function fmt(v, d) { return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function drawCounter(it, t) {
    const { a, b } = enterExit(it, t);
    const k = E.out3((t - it.start - 0.1) / Math.max(0.5, Math.min(1.4, it.end - it.start - 0.4)));
    it.num.textContent = `${it.prefix || ""}${fmt(lerp(it.from || 0, it.to, k), it.decimals || 0)}${it.suffix || ""}`;
    const pop = k >= 1 ? 1 + 0.08 * Math.max(0, 1 - (t - it.start - 0.1 - Math.min(1.4, it.end - it.start - 0.4)) / 0.25) : 1;
    it.num.style.transform = `scale(${pop.toFixed(4)})`;
    it.box.style.transform = `scale(${lerp(0.8, 1, E.back(a)).toFixed(4)})`;
    it.row.style.opacity = (Math.min(1, a * 3) * b).toFixed(3);
    it.row.style.transform = "translateY(-50%)";
  }
  function drawIcon(it, t) {
    const { a, b } = enterExit(it, t, 0.4, 0.22);
    const s = E.back(a) * lerp(0.6, 1, b);
    it.badge.style.transform = `scale(${s.toFixed(4)}) translateY(${(Math.sin((t - it.start) * 2.4) * 5 * U).toFixed(2)}px)`;
    const dk = clamp((t - it.start - 0.15) / 0.5);
    it.paths.forEach(p => { p.style.strokeDashoffset = (1 - E.out3(dk)).toFixed(4); });
    const ring = clamp((t - it.start - 0.1) / 0.6);
    it.badge.style.setProperty("--ring", ((1 - ring) * 0.9).toFixed(3));
    it.badge.style.setProperty("--rs", (1 + ring * 0.5).toFixed(3));
    if (it.pill) { const k = E.out3((t - it.start - 0.2) / 0.35); it.pill.style.opacity = (k * b).toFixed(3); it.pill.style.transform = `translateX(${((1 - k) * (it.side === "right" ? 40 : -40) * U).toFixed(1)}px)`; }
    it.row.style.opacity = Math.min(1, a * 4 * b).toFixed(3);
    it.row.style.transform = "translateY(-50%)";
  }
  function drawEmoji(it, t) {
    const { a, b } = enterExit(it, t, 0.45, 0.25);
    it.badge.style.transform = `scale(${(E.back(a) * lerp(0.5, 1, b)).toFixed(4)}) rotate(${((1 - E.out3(a)) * -12).toFixed(2)}deg)`;
    const f = ((t - it.start) * it.fr) % it.frames;
    try { it.anim.goToAndStop(f + (it.lottie.ip || 0), true); } catch (e) { /* not ready yet */ }
    if (it.pill) { const k = E.out3((t - it.start - 0.2) / 0.35); it.pill.style.opacity = (k * b).toFixed(3); it.pill.style.transform = `translateX(${((1 - k) * (it.side === "right" ? 40 : -40) * U).toFixed(1)}px)`; }
    it.row.style.opacity = Math.min(1, a * 4 * b).toFixed(3);
    it.row.style.transform = "translateY(-50%)";
  }
  function drawList(it, t) {
    const { a, b } = enterExit(it, t, 0.35, 0.25);
    it.box.style.transform = `translateY(${((1 - E.out3(a)) * 40 * U).toFixed(1)}px) scale(${lerp(0.96, 1, E.out3(a)).toFixed(4)})`;
    it.rows.forEach((r, i) => {
      const k = E.out3((t - it.times[i]) / 0.3);
      r.r.style.opacity = k.toFixed(3);
      r.r.style.transform = `translateX(${((1 - k) * (P.rtl ? -36 : 36) * U).toFixed(1)}px)`;
      const dk = E.out3((t - it.times[i] - 0.1) / 0.3);
      r.paths.forEach(p => { p.style.strokeDashoffset = (1 - dk).toFixed(4); });
    });
    it.row.style.opacity = (Math.min(1, a * 3) * b).toFixed(3);
    it.row.style.transform = "translateY(-50%)";
  }
  function drawLower3(it, t) {
    const { a, b } = enterExit(it, t, 0.6, 0.35);
    const g = E.out3(a / 0.4), w = E.out5((a - 0.25) / 0.75);
    it.acc.style.transform = `scaleY(${g.toFixed(4)})`;
    const wOut = E.in2(1 - b);
    it.pan.style.clipPath = P.rtl ? `inset(0 0 0 ${((1 - w + wOut) * 100).toFixed(2)}%)` : `inset(0 ${((1 - w + wOut) * 100).toFixed(2)}% 0 0)`;
    it.el.style.opacity = Math.min(1, b * 2).toFixed(3);
    it.el.style.transform = "translateY(-50%)";
  }
  function drawChapter(it, t) {
    const { a, b } = enterExit(it, t, 0.7, 0.3);
    if (it.no) { const k = E.out5(a / 0.6); it.no.style.opacity = k.toFixed(3); it.no.style.transform = `scale(${lerp(1.6, 1, k).toFixed(4)})`; it.no.style.filter = k < 1 ? `blur(${((1 - k) * 8 * U).toFixed(1)}px)` : "none"; }
    it.ln.style.width = `${(E.inOut((a - 0.2) / 0.6) * 24).toFixed(2)}%`;
    const k2 = E.out3((a - 0.35) / 0.65);
    it.ti.style.opacity = k2.toFixed(3); it.ti.style.transform = `translateY(${((1 - k2) * 26 * U).toFixed(1)}px)`;
    it.el.style.opacity = (Math.min(1, a * 4) * b).toFixed(3);
    it.el.style.transform = "translateY(-50%)";
  }
  function drawPhoto(it, t) {
    const { a, b, life } = enterExit(it, t, 0.45, 0.35);
    const k = E.out5(a), o = E.in2(1 - b);
    const dir = it.side === "left" ? -1 : it.side === "right" ? 1 : 0;
    const dx = (dir || 0) * W * 0.6 * (1 - k + o), dy = dir ? 0 : H * 0.25 * (1 - k + o);
    it.card.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) rotate(${(it.tilt + (1 - k) * it.tilt * 2).toFixed(2)}deg)`;
    it.img.style.transform = `scale(${lerp(1.04, 1.14, life).toFixed(4)})`;
    it.row.style.opacity = Math.min(1, a * 3).toFixed(3);
    it.row.style.transform = "translateY(-50%)";
  }
  function drawGlow(it, t) {
    const { a, b, life } = enterExit(it, t, 0.6, 0.6);
    const k = E.inOut(a) * E.inOut(b);
    const x1 = lerp(-10, 70, life), x2 = lerp(110, 40, life), [c1, c2] = it.cols;
    it.el.style.background = `radial-gradient(55% 40% at ${x1.toFixed(1)}% 18%,rgba(${c1},.55),rgba(${c1},0) 70%),radial-gradient(50% 45% at ${x2.toFixed(1)}% 88%,rgba(${c2},.38),rgba(${c2},0) 70%),linear-gradient(180deg,rgba(${c1},.10),rgba(${c2},.06))`;
    it.el.style.opacity = (k * 0.85).toFixed(3);
  }
  function heart(g, x, y, s) {
    g.beginPath(); g.moveTo(x, y + s * 0.3);
    g.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
    g.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
    g.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
    g.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3); g.fill();
  }
  function drawParticles(it, t) {
    const { a, b } = enterExit(it, t, 0.5, 0.5);
    const env = E.inOut(a) * E.inOut(b), g = it.g, e = t - it.start;
    g.clearRect(0, 0, W, H);
    for (const p of it.ps) {
      let x = p.x * W, y = p.y * H, al = env;
      if (it.kind === "hearts") {
        y = ((p.y * H - e * 120 * U * p.sp * p.z) % (H + 200) + H + 200) % (H + 200) - 100; x += Math.sin(e * 1.6 + p.ph) * 40 * U;
        g.fillStyle = `rgba(255,${Math.round(60 + p.hue * 80)},${Math.round(110 + p.hue * 60)},${(0.55 * al * p.z).toFixed(3)})`;
        heart(g, x, y, (26 + 30 * p.z) * U);
      } else if (it.kind === "bokeh") {
        x += Math.sin(e * 0.4 + p.ph) * 60 * U; y += Math.cos(e * 0.3 + p.ph) * 40 * U - e * 18 * U * p.z;
        const rad = (30 + 70 * p.z) * U, gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(255,${Math.round(190 + p.hue * 50)},${Math.round(120 + p.hue * 60)},${(0.32 * al * p.z).toFixed(3)})`); gr.addColorStop(1, "rgba(255,200,140,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
      } else if (it.kind === "sparks") {
        y = ((p.y * H - e * 260 * U * p.sp) % H + H) % H; x += Math.sin(e * 3 + p.ph) * 20 * U;
        g.fillStyle = `rgba(255,${Math.round(190 + p.hue * 50)},90,${(0.8 * al * (0.5 + 0.5 * Math.sin(e * 9 + p.ph))).toFixed(3)})`;
        g.beginPath(); g.arc(x, y, (2 + 3 * p.z) * U, 0, 6.283); g.fill();
      } else if (it.kind === "snow") {
        y = ((p.y * H + e * 90 * U * p.sp) % H + H) % H; x += Math.sin(e + p.ph) * 30 * U;
        g.fillStyle = `rgba(255,255,255,${(0.7 * al * p.z).toFixed(3)})`; g.beginPath(); g.arc(x, y, (2 + 4 * p.z) * U, 0, 6.283); g.fill();
      } else {
        x += Math.sin(e * 0.3 + p.ph) * 50 * U; y += Math.cos(e * 0.25 + p.ph) * 50 * U;
        g.fillStyle = `rgba(255,240,210,${(0.35 * al * p.z).toFixed(3)})`; g.beginPath(); g.arc(x, y, (1.2 + 2 * p.z) * U, 0, 6.283); g.fill();
      }
    }
  }
  function drawCrack(it, t) {
    const e = t - it.start, out = clamp((it.end - t) / 0.35);
    it.paths.forEach((p, i) => { p.style.strokeDashoffset = (1 - E.out3((e - i * 0.008) / 0.22)).toFixed(4); });
    it.dot.style.opacity = (Math.max(0, 1 - e / 0.4)).toFixed(3);
    it.el.style.opacity = out.toFixed(3);
  }
  function drawQuote(it, t) {
    const { a, b } = enterExit(it, t, 0.5, 0.45);
    it.el.style.opacity = (E.inOut(a) * E.inOut(b)).toFixed(3);
    it.el.style.transform = "translateY(-50%)";
    it.orn.style.width = `${(E.inOut((t - it.start) / 0.8) * 46).toFixed(2)}%`;
    const per = Math.min(0.16, Math.max(0.07, (it.end - it.start - 1.2) / Math.max(1, it.ws.length)));
    it.ws.forEach((w, i) => { const k = E.out3((t - it.start - 0.25 - i * per) / 0.45); w.style.opacity = k.toFixed(3); w.style.transform = `translateY(${((1 - k) * 0.35).toFixed(3)}em)`; w.style.filter = k < 1 ? `blur(${((1 - k) * 6 * U).toFixed(1)}px)` : "none"; });
    if (it.au) it.au.style.opacity = E.out3((t - it.start - 0.4 - it.ws.length * per) / 0.4).toFixed(3);
  }
  function drawCaptions(t) {
    const i = cap.chunks.findIndex(c => t >= c.s && t < c.e);
    if (i < 0) { cap.el.style.visibility = "hidden"; return; }
    const c = cap.chunks[i];
    if (cap.cur !== i) {
      cap.cur = i;
      cap.ln.innerHTML = "";
      cap.ln.dir = isRtl(c.words.map(w => w.w).join(" ")) ? "rtl" : "ltr";
      cap.spans = c.words.map(w => mk("span", "cw", cap.ln, w.w));
    }
    cap.el.style.visibility = "visible";
    const k = E.out3((t - c.s) / 0.12);
    cap.ln.style.transform = `scale(${lerp(0.88, 1, k).toFixed(4)})`;
    cap.ln.style.opacity = Math.min(1, k * 2).toFixed(3);
    c.words.forEach((w, j) => {
      const sp = cap.spans[j];
      const on = t >= w.s && t < (c.words[j + 1] ? c.words[j + 1].s : c.e);
      const said = t >= w.s;
      if (cap.style === "clean") { sp.style.color = "#fff"; return; }
      if (cap.style === "karaoke") { sp.style.color = said ? ACC : "#fff"; return; }
      if (cap.style === "reveal") { const q = E.out3((t - w.s) / 0.18); sp.style.color = "#fff"; sp.style.opacity = q.toFixed(3); sp.style.transform = `translateY(${((1 - q) * 0.25).toFixed(3)}em)`; return; }
      sp.style.color = on ? ACC : "#fff";
      const p = on ? E.out3((t - w.s) / 0.1) : 0;
      sp.style.transform = `scale(${(1 + 0.1 * p).toFixed(4)})`;
    });
  }

  window.renderAt = t => {
    for (const it of items) {
      const live = t >= it.start && t < it.end;
      const el = it.row || it.el;
      if (el) el.style.visibility = live ? "visible" : "hidden";
      if (!live) continue;
      if (it.type === "punch") drawPunch(it, t);
      else if (it.type === "counter") drawCounter(it, t);
      else if (it.type === "icon") drawIcon(it, t);
      else if (it.type === "emoji" && it.anim) drawEmoji(it, t);
      else if (it.type === "list") drawList(it, t);
      else if (it.type === "lower3") drawLower3(it, t);
      else if (it.type === "chapter") drawChapter(it, t);
      else if (it.type === "photo" && it.card) drawPhoto(it, t);
      else if (it.type === "glow") drawGlow(it, t);
      else if (it.type === "particles") drawParticles(it, t);
      else if (it.type === "crack") drawCrack(it, t);
      else if (it.type === "quote") drawQuote(it, t);
    }
    let fl = 0;
    for (const it of items) if (it.type === "flash" && t >= it.start && t < it.start + 0.3) fl = Math.max(fl, 0.75 * (1 - (t - it.start) / 0.3));
    flash.style.opacity = fl.toFixed(3);
    if (cap) {
      // A chapter card takes the screen: the captions step aside for it.
      const chapter = items.some(it => (it.type === "chapter" || it.type === "quote") && t >= it.start && t < it.end);
      if (chapter) cap.el.style.visibility = "hidden"; else drawCaptions(t);
    }
    if (prog) prog.style.width = `${(clamp(t / P.duration) * 100).toFixed(3)}%`;
  };
  window.DURATION = P.duration;
  const tick = () => { window.renderAt(performance.now() / 1000); requestAnimationFrame(tick); };
  // Widths are measured once the real fonts are in.
  const start = () => { for (const [el, w] of toFit) doFit(el, w); window.renderAt(0); requestAnimationFrame(tick); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start, start); else start();
})();
