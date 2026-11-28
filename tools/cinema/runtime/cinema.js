/**
 * Cinema runtime: plays a compiled plan (/plan.json) frame-exactly. Every visual is a pure function of time, so the
 * recorder can seek to any frame (window.renderAt(t)) and get the same picture every time.
 *
 * Shots (one background at a time): globe · photo · assemble · launch · flag · dark
 * Texts on top: slam · show · kicker · counter · stamp · caption (+ strike)
 * Finish: bloom + chromatic aberration on the 3D, film grain, dust, light leaks, vignette, camera shake.
 */
import * as THREE from "three";
import { BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";

const plan = await fetch("/plan.json").then(r => r.json());
const W = plan.w, H = plan.h, U = Math.min(W, H) / 1080, VERT = H > W;
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  out3: k => 1 - Math.pow(1 - clamp(k), 3),
  out5: k => 1 - Math.pow(1 - clamp(k), 5),
  in2: k => clamp(k) * clamp(k),
  inOut: k => { k = clamp(k); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
  slam: k => { k = clamp(k); return k < 0.6 ? 1 - Math.pow(1 - k / 0.6, 3) * 1.0 + 0.03 * Math.sin((k / 0.6) * Math.PI) : 1 + 0.03 * Math.sin(Math.PI) * (1 - k); },
};
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const stage = $("stage");
document.documentElement.lang = plan.lang || "ar";
document.documentElement.dir = /^(ar|fa|ur|he)/.test(plan.lang || "ar") ? "rtl" : "ltr";
stage.style.width = W + "px";
stage.style.height = H + "px";
document.body.style.width = W + "px";
document.body.style.height = H + "px";
for (const id of ["gl", "fx", "grain"]) { const c = $(id); c.style.width = W + "px"; c.style.height = H + "px"; }
$("gl").width = W; $("gl").height = H;
$("fx").width = W; $("fx").height = H;
$("grain").width = Math.round(W / 2); $("grain").height = Math.round(H / 2);
const leakColor = plan.grade === "cold" ? "120,170,255" : "255,170,60";
$("leak").style.background = `radial-gradient(45% 30% at 85% 15%,rgba(${leakColor},.55),rgba(0,0,0,0) 70%),radial-gradient(40% 25% at 10% 90%,rgba(212,175,55,.35),rgba(0,0,0,0) 70%)`;

/* ------------------------------------------------------------------ data */
const topo = await fetch("/lib/countries-50m.json").then(r => r.json());
// Morocco is drawn whole, with its Sahara (one country, one shape).
const geoms = topo.objects.countries.geometries;
const sahara = geoms.filter(g => g.id === "504" || g.id === "732");
const countries = window.topojson.feature(topo, { type: "GeometryCollection", geometries: geoms.filter(g => g.id !== "504" && g.id !== "732") }).features;
if (sahara.length === 2) countries.push({ type: "Feature", id: "504", properties: { name: "Morocco" }, geometry: window.topojson.merge(topo, sahara) });
const byId = id => countries.find(f => String(f.id) === String(id).padStart(3, "0"));
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image " + src)); i.src = src; });
await document.fonts.ready;
await Promise.all(["900 100px Cairo", "700 100px Cairo", "700 100px Kufi"].map(f => document.fonts.load(f, "عرش 1979")));

/* ------------------------------------------------------------------ three.js scene */
const renderer = new THREE.WebGLRenderer({ canvas: $("gl"), antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x030406, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VERT ? 34 : 22, W / H, 0.05, 200);
scene.add(new THREE.AmbientLight(0x8090b0, 0.35));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(4, 3, 5);
scene.add(sun);
const rimLight = new THREE.DirectionalLight(0x5f8cff, 1.2);
rimLight.position.set(-5, 1, -3);
scene.add(rimLight);
const composer = new EffectComposer(renderer, { multisampling: 4 });
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ intensity: 0.95, luminanceThreshold: 0.5, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
const chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0009, 0.0007), radialModulation: true, modulationOffset: 0.35 });
composer.addPass(new EffectPass(camera, bloom, chroma));

const P = ([lon, lat], tw, th) => [((lon + 180) / 360) * tw, ((90 - lat) / 180) * th];
function traceGeo(ctx, geom, tw, th) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  ctx.beginPath();
  for (const poly of polys) for (const ring of poly) {
    let prev = null;
    ring.forEach((c, i) => {
      const [x, y] = P(c, tw, th);
      if (i === 0 || (prev && Math.abs(x - prev[0]) > tw / 2)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      prev = [x, y];
    });
  }
}
const texCache = new Map();
function globeTextures(focusId, highlight) {
  const key = `${focusId}|${(highlight || []).map(h => h.id + h.color).join(",")}`;
  if (texCache.has(key)) return texCache.get(key);
  const tw = 4096, th = 2048;
  const map = document.createElement("canvas"); map.width = tw; map.height = th;
  const emi = document.createElement("canvas"); emi.width = tw; emi.height = th;
  const m = map.getContext("2d"), e = emi.getContext("2d");
  const og = m.createLinearGradient(0, 0, 0, th);
  og.addColorStop(0, "#05080e"); og.addColorStop(0.5, "#070b14"); og.addColorStop(1, "#05080e");
  m.fillStyle = og; m.fillRect(0, 0, tw, th);
  m.strokeStyle = "rgba(120,140,170,.10)"; m.lineWidth = 2;
  for (let lon = -180; lon <= 180; lon += 15) { const x = ((lon + 180) / 360) * tw; m.beginPath(); m.moveTo(x, 0); m.lineTo(x, th); m.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const y = ((90 - lat) / 180) * th; m.beginPath(); m.moveTo(0, y); m.lineTo(tw, y); m.stroke(); }
  e.fillStyle = "#000"; e.fillRect(0, 0, tw, th);
  const colorOf = f => {
    if (focusId && String(f.id) === String(focusId).padStart(3, "0")) return "#d4af37";
    const h = (highlight || []).find(x => String(f.id) === String(x.id).padStart(3, "0"));
    return h ? (h.color === "red" ? "#b3261e" : h.color === "blue" ? "#2b5cb8" : h.color === "green" ? "#2f8a4c" : "#d4af37") : null;
  };
  for (const f of countries) {
    if (!f.geometry) continue;
    const c = colorOf(f);
    traceGeo(m, f.geometry, tw, th);
    m.fillStyle = c ?? "#161c27"; m.fill();
    m.strokeStyle = c ? "rgba(255,240,190,.9)" : "rgba(150,165,190,.28)"; m.lineWidth = c ? 3 : 1.4; m.stroke();
    if (c) { traceGeo(e, f.geometry, tw, th); e.fillStyle = c; e.fill(); e.strokeStyle = "#fff0b0"; e.lineWidth = 6; e.stroke(); }
  }
  const a = new THREE.CanvasTexture(map), b = new THREE.CanvasTexture(emi);
  a.colorSpace = b.colorSpace = THREE.SRGBColorSpace;
  a.anisotropy = b.anisotropy = 8;
  texCache.set(key, [a, b]);
  return [a, b];
}
const R = 1;
const tilt = new THREE.Group();
const globe = new THREE.Group();
tilt.add(globe);
scene.add(tilt);
const earthMat = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.3, roughness: 0.85, metalness: 0.05 });
const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), earthMat);
globe.add(earth);
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.07, 96, 64),
  new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    uniforms: { c: { value: new THREE.Color(0x4f86ff) } },
    vertexShader: "varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 p = modelViewMatrix*vec4(position,1.); vP = p.xyz; gl_Position = projectionMatrix*p; }",
    fragmentShader: "uniform vec3 c; varying vec3 vN; varying vec3 vP; void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(-vP), vN)), 0., 1.), 2.2); gl_FragColor = vec4(c*f*1.4, f); }",
  }),
);
tilt.add(atmo);
const starGeo = new THREE.BufferGeometry();
{
  const r = rng(7), n = 3500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, d = 60 + r() * 40, s = Math.sqrt(1 - u * u);
    pos.set([d * s * Math.cos(th), d * u, d * s * Math.sin(th)], i * 3);
    const w = 0.6 + r() * 0.4; col.set([w, w * (0.9 + r() * 0.1), w * (0.85 + r() * 0.15)], i * 3);
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
scene.add(stars);
const ll = (lat, lon, r = R) => {
  const phi = ((lon + 180) * Math.PI) / 180, th = ((90 - lat) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(th), r * Math.cos(th), r * Math.sin(phi) * Math.sin(th));
};
const ringMat = color => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
const beacon = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.028, 64), ringMat(0xffd76a));
globe.add(beacon);
const pulses = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 96), ringMat(0xff2a2a)); globe.add(m); return m; });
const sat = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.9, roughness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.35, emissive: 0x2a1d00 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1b3a8c, metalness: 0.6, roughness: 0.25, emissive: 0x0a1a44 });
  sat.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), gold));
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.002, 0.05), panel); p1.position.x = 0.11; sat.add(p1);
  const p2 = p1.clone(); p2.position.x = -0.11; sat.add(p2);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.02, 24, 1, true), metal); dish.position.z = 0.05; dish.rotation.x = -Math.PI / 2; sat.add(dish);
  sat.scale.setScalar(2.4);
}
const orbit = new THREE.Group();
orbit.add(sat);
orbit.rotation.set(-0.55, 0, 0.3);
scene.add(orbit);
const trailPts = new Float32Array(120 * 3);
const trail = new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(trailPts, 3)), new THREE.LineBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }));
orbit.add(trail);
const flagGeo = new THREE.PlaneGeometry(3.5, 2.0, 120, 70);
const flagBase = flagGeo.attributes.position.array.slice();
const flagMat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75, metalness: 0 });
const flagMesh = new THREE.Mesh(flagGeo, flagMat);
scene.add(flagMesh);

/* ------------------------------------------------------------------ shots: build */
const shots = plan.shots.map((s, i) => ({ ...s, i }));
for (const s of shots) {
  if (s.type === "globe") {
    const f = s.focus;
    const p = ll(f.lat, f.lon);
    s.faceY = -Math.atan2(p.x, p.z);
    s.faceX = Math.asin(p.y / R);
    s.tex = globeTextures(f.id, s.highlight);
    s.pos = p;
    s.arcObjs = (s.arcs || []).map((a, k) => {
      const A = ll(a.lat, a.lon), B = p.clone();
      const pts = [];
      for (let q = 0; q <= 80; q++) { const kk = q / 80; const v = A.clone().lerp(B, kk).normalize(); pts.push(v.multiplyScalar(R * (1 + 0.32 * Math.sin(Math.PI * kk) * (0.6 + 0.4 * (A.distanceTo(B) / 2))))); }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 160, 0.0055, 8, false);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: a.color === "gold" ? 0xffcc55 : 0xff3326, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd0c0, transparent: true, blending: THREE.AdditiveBlending }));
      mesh.visible = head.visible = false;
      globe.add(mesh, head);
      return { mesh, head, curve, count: geo.index.count, delay: k * 0.17 };
    });
  }
  if (s.type === "photo") {
    const box = document.createElement("div");
    box.className = "photo";
    const tint = { sepia: "grayscale(1) sepia(.55) brightness(.5) blur(7px)", bw: "grayscale(1) contrast(1.2) brightness(.45) blur(6px)", gold: "grayscale(.6) sepia(.8) saturate(1.3) brightness(.5) blur(7px)", red: "grayscale(1) brightness(.42) blur(6px)", cold: "grayscale(.7) brightness(.45) hue-rotate(180deg) saturate(.6) blur(6px)", none: "brightness(.6) blur(5px)" }[s.tint || "sepia"];
    const tintCut = { sepia: "grayscale(.85) sepia(.4) contrast(1.18) brightness(.98)", bw: "grayscale(1) contrast(1.25)", gold: "grayscale(.5) sepia(.6) saturate(1.25) contrast(1.12)", red: "grayscale(1) contrast(1.25) brightness(.9)", cold: "grayscale(.6) contrast(1.15)", none: "contrast(1.08)" }[s.tint || "sepia"];
    const bg = document.createElement("img"); bg.src = s.img; bg.style.filter = s.cut ? tint : tint.replace(/blur\([^)]*\)/, ""); bg.style.objectPosition = `50% ${(s.focusY ?? 0.35) * 100}%`;
    box.appendChild(bg);
    s.bgEl = bg;
    if (s.cut) { const c = document.createElement("img"); c.src = s.cut; c.style.filter = tintCut; c.style.objectPosition = `50% ${(s.focusY ?? 0.35) * 100}%`; box.appendChild(c); s.cutEl = c; }
    const shade = document.createElement("div");
    shade.className = "shade";
    shade.style.background = (s.tint === "red" ? "linear-gradient(180deg,rgba(90,0,0,.55),rgba(10,0,0,.2) 45%,rgba(0,0,0,.88))," : "") + "radial-gradient(75% 60% at 50% 40%,rgba(0,0,0,0),rgba(5,4,2,.78) 100%),linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,0) 30%,rgba(0,0,0,0) 58%,rgba(0,0,0,.85))";
    box.appendChild(shade);
    $("photos").appendChild(box);
    s.box = box;
    if (s.cracksAt != null || s.shatterAt != null) {
      const r = rng(42 + s.i), cx = W / 2, cy = H * (s.focusY ?? 0.38);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "cracks"); svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      let html = "";
      for (let k = 0; k < 16; k++) {
        let a = (k / 16) * Math.PI * 2 + r() * 0.3, x = cx, y = cy, d = `M${cx} ${cy}`;
        const len = (500 + r() * 900) * U;
        for (let q = 0; q < 14; q++) { a += (r() - 0.5) * 0.5; x += Math.cos(a) * (len / 14); y += Math.sin(a) * (len / 14); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
        html += `<path d="${d}" fill="none" stroke="rgba(255,248,225,.92)" stroke-width="${((2 + r() * 3) * U).toFixed(1)}" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(255,220,140,.8))"/>`;
      }
      svg.innerHTML = html;
      $("photos").appendChild(svg);
      s.cracks = svg;
      s.crackPaths = [...svg.querySelectorAll("path")].map(p => { const L = p.getTotalLength(); p.style.strokeDasharray = `${L}`; p.style.strokeDashoffset = `${L}`; return { p, L }; });
    }
  }
  if (s.type === "assemble") {
    const f = byId(s.country.id);
    const path = new Path2D();
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const lat0 = s.country.lat ?? 30;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const proj = ([lon, lat]) => [lon * Math.cos((lat0 * Math.PI) / 180), -lat];
    // Keep the main body only (largest polygon by bbox) so far islands do not shrink the shape.
    const areas = polys.map(poly => { let a = 0; const ring = poly[0]; for (let q = 0; q < ring.length - 1; q++) a += ring[q][0] * ring[q + 1][1] - ring[q + 1][0] * ring[q][1]; return Math.abs(a); });
    const maxA = Math.max(...areas);
    const keep = polys.filter((_, q) => areas[q] > maxA * 0.08);
    for (const poly of keep) for (const ring of poly) for (const c of ring) { const [x, y] = proj(c); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const fit = Math.min((W * (VERT ? 0.8 : 0.5)) / (maxX - minX), (H * 0.42) / (maxY - minY));
    const ox = W / 2 - ((minX + maxX) / 2) * fit, oy = H * 0.47 - ((minY + maxY) / 2) * fit;
    for (const poly of keep) for (const ring of poly) ring.forEach((c, q) => { const [x, y] = proj(c); q ? path.lineTo(x * fit + ox, y * fit + oy) : path.moveTo(x * fit + ox, y * fit + oy); });
    path.closePath();
    s.path = path;
    s.box = { x: minX * fit + ox, y: minY * fit + oy, w: (maxX - minX) * fit, h: (maxY - minY) * fit };
    const r = rng(5 + s.i), probe = document.createElement("canvas").getContext("2d");
    s.pieces = [];
    let guard = 0;
    while (s.pieces.length < 520 && guard++ < 40000) {
      const x = s.box.x + r() * s.box.w, y = s.box.y + r() * s.box.h;
      if (!probe.isPointInPath(path, x, y)) continue;
      const a = r() * Math.PI * 2, d = (900 + r() * 900) * U;
      s.pieces.push({ x, y, sx: W / 2 + Math.cos(a) * d, sy: H * 0.47 + Math.sin(a) * d, rot: (r() - 0.5) * 12, size: (10 + r() * 16) * U * (VERT ? 1 : 0.8), delay: r() * 0.35, hue: r() });
    }
  }

  if (s.type === "newspaper") {
    const el = document.createElement("div");
    el.className = "paper";
    const pw = W * (VERT ? 0.86 : 0.5);
    el.style.width = pw + "px";
    el.style.fontSize = pw / 22 + "px";
    el.style.direction = plan.lang === "ar" ? "rtl" : "ltr";
    const esc = v => String(v ?? "").replace(/[<>&]/g, "");
    const cols = n => Array.from({ length: n }, (_, k) => `<i style="width:${60 + ((k * 37 + s.i * 11) % 40)}%"></i>`).join("");
    el.innerHTML = `<div class="mast" style="font-size:2.3em">${esc(s.masthead || (plan.lang === "ar" ? "الصحيفة" : "THE DAILY"))}</div>
      <div class="dateline" style="font-size:.8em"><span>${esc(s.date || "")}</span><span>${plan.lang === "ar" ? "عدد خاص" : "SPECIAL EDITION"}</span></div>
      <div class="head" style="font-size:${(s.headline || "").length > 26 ? 2.1 : 2.8}em">${esc(s.headline)}<span class="mark"></span></div>
      ${s.sub ? `<div class="sub" style="font-size:1.05em">${esc(s.sub)}</div>` : ""}
      <div class="cols"><div class="col">${s.img ? `<img src="${s.img}" alt="">` : ""}${cols(s.img ? 5 : 12)}</div><div class="col">${cols(14)}</div>${VERT ? "" : `<div class="col">${cols(14)}</div>`}</div>`;
    $("cards").appendChild(el);
    s.el = el;
    s.mark = el.querySelector(".mark");
  }
  if (s.type === "document") {
    const el = document.createElement("div");
    el.className = "doc";
    const pw = W * (VERT ? 0.84 : 0.46);
    el.style.width = pw + "px";
    el.style.fontSize = pw / 20 + "px";
    el.style.direction = plan.lang === "ar" ? "rtl" : "ltr";
    const esc = v => String(v ?? "").replace(/[<>&]/g, "");
    el.innerHTML = `<div class="dh"><span>${esc(s.title || (plan.lang === "ar" ? "وثيقة" : "DOCUMENT"))}</span><span>${esc(s.date || "")}</span></div>` +
      (s.lines || []).map(l => `<div class="ln"><span class="tx">${esc(l)}</span><span class="bar"></span></div>`).join("") +
      (s.stamp ? `<div class="seal" style="font-size:2.2em">${esc(s.stamp)}</div>` : "");
    $("cards").appendChild(el);
    s.el = el;
    s.lns = [...el.querySelectorAll(".ln")].map(l => ({ l, tx: l.querySelector(".tx"), bar: l.querySelector(".bar") }));
    s.seal = el.querySelector(".seal");
  }
  if (s.type === "timeline") {
    const el = document.createElement("div");
    el.className = "tl";
    const evs = (s.events || []).slice(0, 6);
    const n = Math.max(1, evs.length);
    const line = document.createElement("div");
    line.className = "line";
    el.appendChild(line);
    s.items = evs.map((ev, k) => {
      const d = document.createElement("div");
      d.className = "ev";
      d.style.fontSize = 52 * U + "px";
      const esc = v => String(v ?? "").replace(/[<>&]/g, "");
      d.innerHTML = `<div class="dot"></div><div class="date" style="font-size:1.25em">${esc(ev.date)}</div><div class="lab" style="font-size:.9em">${esc(ev.label)}</div>`;
      if (VERT) {
        const y = H * (0.22 + (0.56 * k) / Math.max(1, n - 1 || 1));
        d.style.top = y - 40 * U + "px";
        if (plan.lang === "ar") { d.style.right = W * 0.18 + "px"; d.style.textAlign = "right"; d.querySelector(".dot").style.right = -W * 0.07 - 12 * U + "px"; }
        else { d.style.left = W * 0.18 + "px"; d.querySelector(".dot").style.left = -W * 0.07 - 12 * U + "px"; }
        d.querySelector(".dot").style.top = 26 * U + "px";
      } else {
        const x = W * (0.12 + (0.76 * (plan.lang === "ar" ? n - 1 - k : k)) / Math.max(1, n - 1 || 1));
        d.style.left = x - 160 * U + "px";
        d.style.width = 320 * U + "px";
        d.style.textAlign = "center";
        d.style.top = H * 0.5 - 30 * U + "px";
        const dot = d.querySelector(".dot"); dot.style.left = 160 * U - 12 * U + "px"; dot.style.top = -40 * U + "px";
        d.querySelector(".date").style.marginTop = 10 * U + "px";
      }
      el.appendChild(d);
      return { d, at: ev.at };
    });
    if (VERT) { line.style.width = 6 * U + "px"; line.style.top = H * 0.2 + "px"; line.style[plan.lang === "ar" ? "right" : "left"] = W * 0.11 + "px"; line.style.height = "0px"; s.lineMax = H * 0.6; }
    else { line.style.height = 6 * U + "px"; line.style.top = H * 0.5 - 52 * U + "px"; line.style.left = W * 0.1 + "px"; line.style.width = "0px"; s.lineMax = W * 0.8; }
    s.line = line;
    $("cards").appendChild(el);
    s.el = el;
  }
  if (s.type === "flag") {
    const img = await loadImg(s.flag);
    const c = document.createElement("canvas"); c.width = 2100; c.height = 1200;
    c.getContext("2d").drawImage(img, 0, 0, 2100, 1200);
    s.tex = new THREE.CanvasTexture(c);
    s.tex.colorSpace = THREE.SRGBColorSpace;
    s.tex.anisotropy = 8;
  }
}
// Shards: built after the photo images have loaded (they carry the portrait as it looks when it breaks).
await Promise.all(shots.filter(s => s.type === "photo").flatMap(s => [s.bgEl, s.cutEl].filter(Boolean).map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })))));
for (const s of shots.filter(s => s.type === "photo" && s.shatterAt != null)) {
  const shot = document.createElement("canvas"); shot.width = W; shot.height = H;
  const g = shot.getContext("2d");
  const fy = s.focusY ?? 0.35;
  const cover = (img, scale) => { const k = Math.max(W / img.naturalWidth, H / img.naturalHeight) * scale; const w = img.naturalWidth * k, h = img.naturalHeight * k; return [W / 2 - w / 2, (H - h) * fy, w, h]; };
  g.fillStyle = "#050403"; g.fillRect(0, 0, W, H);
  const k = photoScale(s, s.shatterAt);
  g.filter = s.bgEl.style.filter; g.drawImage(s.bgEl, ...cover(s.bgEl, k.bg));
  if (s.cutEl) { g.filter = s.cutEl.style.filter; g.drawImage(s.cutEl, ...cover(s.cutEl, k.cut)); }
  g.filter = "none";
  const v = g.createRadialGradient(W / 2, H * 0.4, 200 * U, W / 2, H * 0.45, 1100 * U);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(5,4,2,.78)");
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  const url = shot.toDataURL("image/jpeg", 0.92);
  const box = document.createElement("div"); box.className = "shards"; $("photos").appendChild(box);
  s.shardBox = box;
  s.shards = [];
  const r = rng(11 + s.i), cols = VERT ? 7 : 12, rows = VERT ? 12 : 7, pts = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const edge = i === 0 || j === 0 || i === cols || j === rows;
    pts.push([(i / cols) * W + (edge ? 0 : (r() - 0.5) * 110 * U), (j / rows) * H + (edge ? 0 : (r() - 0.5) * 110 * U)]);
  }
  const Pt = (i, j) => pts[j * (cols + 1) + i];
  const cy0 = H * (s.focusY ?? 0.38);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const tris = (i + j) % 2 ? [[Pt(i, j), Pt(i + 1, j), Pt(i + 1, j + 1)], [Pt(i, j), Pt(i + 1, j + 1), Pt(i, j + 1)]] : [[Pt(i, j), Pt(i + 1, j), Pt(i, j + 1)], [Pt(i + 1, j), Pt(i + 1, j + 1), Pt(i, j + 1)]];
    for (const tri of tris) {
      const el = document.createElement("div");
      el.className = "shard";
      el.style.backgroundImage = `url(${url})`;
      el.style.clipPath = `polygon(${tri.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",")})`;
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      el.style.transformOrigin = `${cx}px ${cy}px`;
      box.appendChild(el);
      const dx = cx - W / 2, dy = cy - cy0, dist = Math.hypot(dx, dy) + 1;
      s.shards.push({ el, dx: dx / dist, dy: dy / dist, push: (260 + r() * 380) * U, fall: (1900 + r() * 500) * U * (H / 1920), rot: (r() - 0.5) * 260, rotX: (r() - 0.5) * 160, sc: 0.85 + r() * 0.3, delay: (dist / 1800) * 0.12, dur: 1.55 + r() * 0.4, fade: 1.3 + r() * 0.4, jx: (r() - 0.5) * 120 * U });
    }
  }
}
function photoScale(s, t) {
  const k = clamp((t - s.start) / Math.max(0.5, s.end - s.start));
  const m = s.motion || "out";
  if (m === "in") return { bg: lerp(1.12, 1.24, k), cut: lerp(1.04, 1.16, k), x: 0, y: 0, cy: lerp(0, -20, k) };
  if (m === "left") return { bg: 1.22, cut: 1.12, x: lerp(40, -40, k) * U, y: 0, cy: 0 };
  if (m === "right") return { bg: 1.22, cut: 1.12, x: lerp(-40, 40, k) * U, y: 0, cy: 0 };
  return { bg: lerp(1.3, 1.18, k), cut: lerp(1.16, 1.06, k), x: 0, y: 0, cy: lerp(40, 0, k) * U };
}

/* ------------------------------------------------------------------ texts: build and lay out */
const POS = VERT ? { top: 0.11, upper: 0.24, center: 0.44, lower: 0.64, bottom: 0.78 } : { top: 0.1, upper: 0.24, center: 0.42, lower: 0.62, bottom: 0.76 };
const SIZE = { xl: 230, l: 170, m: 118, s: 84, xs: 60 };
const texts = plan.texts.map((t, i) => ({ ...t, i }));
for (const t of texts) {
  const el = document.createElement("div");
  el.className = `t ${t.style === "kicker" ? "kicker" : t.style === "stamp" ? "stamp big" : t.style === "caption" ? "caption" : "big"} ${t.style === "kicker" || t.style === "caption" ? "" : t.color || "white"}`;
  const inner = document.createElement("span");
  inner.className = "in";
  inner.textContent = t.style === "counter" ? `${t.prefix ?? ""}${t.from ?? 0}${t.suffix ?? ""}` : t.text;
  el.appendChild(inner);
  if (t.strikeAt != null) { const st = document.createElement("div"); st.className = "strike"; inner.appendChild(st); t.strikeEl = st; }
  if (/^[\d\s.,%$+\-:]+$/.test(t.style === "counter" ? String(t.to) : t.text)) el.style.direction = "ltr";
  const base = (t.style === "kicker" ? 50 : t.style === "caption" ? 58 : t.style === "stamp" ? 104 : SIZE[t.size || "l"]) * U;
  el.style.fontSize = base + "px";
  $("texts").appendChild(el);
  t.el = el; t.inner = inner;
  // Fit the width.
  const room = W - 2 * (VERT ? 70 : 140) * U;
  if (t.style === "counter") inner.textContent = `${t.prefix ?? ""}${t.to}${t.suffix ?? ""}`;
  const w = inner.getBoundingClientRect().width;
  if (w > room) el.style.fontSize = (base * room) / w + "px";
  if (t.style === "counter") inner.textContent = `${t.prefix ?? ""}${t.from ?? 0}${t.suffix ?? ""}`;
  t.h = inner.getBoundingClientRect().height;
}
// Stack texts that share a position and overlap in time.
for (const t of texts) {
  const above = texts.filter(o => o !== t && o.i < t.i && (o.pos || "center") === (t.pos || "center") && o.at < (t.until ?? 1e9) && (o.until ?? 1e9) > t.at);
  const offset = above.reduce((a, o) => a + o.h * 0.92 + 14 * U, 0);
  t.top = H * POS[t.pos || "center"] + offset;
  t.el.style.top = t.top + "px";
  t.rot = t.style === "stamp" ? [-4, 3, -2, 2][t.i % 4] : 0;
}

/* ------------------------------------------------------------------ shake + flashes from events */
const shakes = [];
for (const t of texts) if (t.style === "slam" || t.style === "stamp") shakes.push({ at: t.at + (t.style === "stamp" ? 0.1 : 0.04), amp: (t.style === "stamp" ? 24 : 14) * U, d: 0.42 });
for (const s of shots) {
  if (s.shatterAt != null) shakes.push({ at: s.shatterAt, amp: 26 * U, d: 0.55 });
  if (s.cracksAt != null) shakes.push({ at: s.cracksAt, amp: 12 * U, d: 0.35 });
  if (s.pulseAt != null) shakes.push({ at: s.pulseAt + 0.7, amp: 8 * U, d: 0.3 });
  if (s.type === "document" && s.stampAt != null) shakes.push({ at: s.stampAt + 0.12, amp: 18 * U, d: 0.4 });
  if (s.type === "launch") shakes.push({ at: s.start + 0.4, amp: 9 * U, d: Math.min(2, s.end - s.start - 0.4) });
}
function shakeAt(t) {
  let x = 0, y = 0, r = 0;
  for (const s of shakes) {
    const e = t - s.at;
    if (e < 0 || e > s.d) continue;
    const f = 1 - e / s.d, ph = e * 38 + s.at * 13;
    x += Math.sin(ph * 1.3) * s.amp * f; y += Math.cos(ph * 1.7) * s.amp * f; r += Math.sin(ph) * 0.4 * f;
  }
  return [x, y, r];
}

/* ------------------------------------------------------------------ per-frame */
const fx = $("fx").getContext("2d");
const dust = (() => { const r = rng(3); return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, z: 0.3 + r() * 0.7, ph: r() * 6.28 })); })();
const grain = $("grain").getContext("2d");
const gimg = grain.createImageData($("grain").width, $("grain").height);

function drawGrain(frame) {
  const r = rng(frame * 7919 + 1), d = gimg.data;
  for (let i = 0; i < d.length; i += 4) { const v = (r() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  grain.putImageData(gimg, 0, 0);
}
function setText(t, now) {
  const el = t.el;
  const at = t.at, until = t.until ?? plan.duration + 1;
  if (now < at - 0.01 || now > until + 0.45) { el.style.visibility = "hidden"; return; }
  el.style.visibility = "visible";
  let op = 1, y = 0, sc = 1, blur = 0, rot = t.rot;
  const e = now - at;
  if (t.style === "slam") { const k = clamp(e / 0.32); sc = lerp(1.9, 1, E.out5(k)); op = clamp(k * 2.2); blur = (1 - k) * 10; }
  else if (t.style === "stamp") { const k = clamp(e / 0.24); sc = lerp(2.6, 1, E.in2(k)); op = clamp(k * 3); rot = t.rot * (1 + 2 * (1 - k)); }
  else { const k = clamp(e / (t.style === "caption" ? 0.25 : 0.55)); y = (1 - E.out3(k)) * 50 * U; sc = lerp(0.94, 1, E.out3(k)); op = E.out3(k); blur = (1 - E.out3(k)) * 18; }
  if (t.style === "counter") {
    const k = E.out3(clamp(e / Math.min(1.1, Math.max(0.4, until - at - 0.2))));
    const v = lerp(Number(t.from ?? 0), Number(t.to), k);
    const dec = String(t.to).includes(".") ? String(t.to).split(".")[1].length : 0;
    t.inner.firstChild.nodeValue = `${t.prefix ?? ""}${v.toFixed(dec)}${t.suffix ?? ""}`;
  }
  if (t.strikeEl) {
    const k = E.inOut(clamp((now - t.strikeAt) / 0.45));
    t.strikeEl.style.transform = `scaleX(${k})`;
    if (now > t.strikeAt + 0.35) op *= lerp(1, 0.55, clamp((now - t.strikeAt - 0.35) / 0.4));
  }
  if (now > until) { const k = clamp((now - until) / 0.35); op *= 1 - E.in2(k); y -= 30 * U * k; blur += 14 * k; }
  el.style.opacity = op.toFixed(3);
  el.style.transform = `translateY(${y.toFixed(1)}px) scale(${sc.toFixed(4)}) rotate(${rot.toFixed(2)}deg)`;
  el.style.filter = blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : "none";
}
function drawGlobe(s, t) {
  const lt = t - s.start, dur = s.end - s.start;
  if (earthMat.map !== s.tex[0]) { [earthMat.map, earthMat.emissiveMap] = s.tex; earthMat.needsUpdate = true; }
  earth.visible = atmo.visible = globe.visible = stars.visible = true;
  flagMesh.visible = false;
  let camZ, rotY, rotX;
  if (s.dive) {
    const k = E.inOut(lt / Math.min(3.3, dur * 0.9));
    camZ = lerp(16, VERT ? 3.3 : 5.2, k); rotY = lerp(s.faceY - 1.6, s.faceY, k); rotX = lerp(0.25, s.faceX, k);
  } else {
    const k = clamp(lt / dur);
    camZ = lerp(VERT ? 4.6 : 6.4, VERT ? 3.9 : 5.6, E.inOut(k)); rotY = lerp(s.faceY + 0.55, s.faceY + 0.15, E.inOut(k)); rotX = lerp(s.faceX - 0.15, s.faceX, E.inOut(k));
  }
  tilt.rotation.x = rotX; globe.rotation.y = rotY;
  camera.position.set(0, 0, camZ); camera.lookAt(0, 0, 0);
  const glow = s.dive ? lerp(0.1, 1.25, clamp((lt - 1.6) / 1.4)) : 1;
  earthMat.emissiveIntensity = 0.25 + glow * (0.75 + 0.25 * Math.sin(t * 4));
  beacon.position.copy(s.pos.clone().multiplyScalar(1.003)); beacon.lookAt(0, 0, 0);
  const ph = (t * 0.9) % 1;
  beacon.scale.setScalar(1 + ph * 2.5);
  beacon.material.opacity = glow * (0.6 + 0.4 * Math.sin(t * 5)) * (1 - ph);
  pulses.forEach((m, i) => {
    m.position.copy(s.pos.clone().multiplyScalar(1.004)); m.lookAt(0, 0, 0);
    const pk = s.pulseAt == null ? -1 : (t - s.pulseAt) / 1.6;
    m.visible = pk >= 0 && pk < 1;
    const q = (pk * 2.2 + i * 0.33) % 1;
    m.scale.setScalar(0.4 + q * 3.2); m.material.opacity = (1 - q) * 0.9;
  });
  for (const other of shots) if (other.arcObjs && other !== s) for (const a of other.arcObjs) a.mesh.visible = a.head.visible = false;
  for (const a of s.arcObjs) {
    const prog = s.arcsAt == null ? 0 : clamp((t - s.arcsAt) / 2.6);
    const k = clamp(prog * (1 + (s.arcObjs.length * 0.17) / 2.6) - a.delay / 2.6);
    const e = E.inOut(k);
    a.mesh.visible = e > 0; a.mesh.geometry.setDrawRange(0, Math.floor((e * a.count) / 3) * 3);
    a.head.visible = e > 0 && e < 0.999; if (a.head.visible) a.head.position.copy(a.curve.getPoint(e));
  }
  sat.visible = trail.visible = !!s.satellite;
  if (s.satellite) {
    const ang = -0.6 + lt * 1.6, rr = 1.24;
    sat.position.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
    sat.rotation.set(0.3, -ang + Math.PI / 2, 0.2);
    for (let i = 0; i < 120; i++) { const a2 = ang - i * 0.012; trailPts.set([Math.cos(a2) * rr, 0, Math.sin(a2) * rr], i * 3); }
    trail.geometry.attributes.position.needsUpdate = true;
  }
  stars.material.opacity = 0.9;
  composer.render();
}
function drawFlag(s, t) {
  const lt = t - s.start, dur = s.end - s.start;
  earth.visible = atmo.visible = globe.visible = sat.visible = trail.visible = false;
  stars.visible = true; stars.material.opacity = 0.25;
  flagMesh.visible = true;
  if (flagMat.map !== s.tex) { flagMat.map = s.tex; flagMat.needsUpdate = true; }
  const p = flagGeo.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const x = flagBase[i], y = flagBase[i + 1], k = (x + 1.75) / 3.5;
    p[i + 2] = (Math.sin(x * 2.6 - t * 3.1 + y * 0.6) * 0.11 + Math.sin(x * 5.3 - t * 4.7) * 0.025 + Math.sin(y * 3 - t * 2.2) * 0.03) * (0.25 + k);
  }
  flagGeo.attributes.position.needsUpdate = true;
  flagGeo.computeVertexNormals();
  camera.position.set(0, 0, lerp(VERT ? 3.4 : 4.4, VERT ? 2.55 : 3.6, clamp(lt / dur)));
  camera.lookAt(0, 0, 0);
  flagMesh.rotation.set(-0.08, 0.32, -0.06);
  flagMesh.position.set(0.15, 0.15, 0);
  flagMesh.scale.setScalar(VERT ? 1.35 : 1.1);
  composer.render();
}
function drawPhoto(s, t) {
  s.box.style.visibility = "visible";
  const broken = s.shatterAt != null && t >= s.shatterAt;
  const k = photoScale(s, broken ? s.shatterAt : t);
  const fy = (s.focusY ?? 0.35) * 100;
  s.bgEl.style.transformOrigin = `50% ${fy}%`;
  s.bgEl.style.transform = `translate(${k.x * 0.5}px,0) scale(${k.bg})`;
  if (s.cutEl) { s.cutEl.style.transformOrigin = `50% ${fy}%`; s.cutEl.style.transform = `translate(${k.x}px,${k.cy}px) scale(${k.cut})`; }
  s.box.style.visibility = broken ? "hidden" : "visible";
  if (s.cracks) {
    const on = s.cracksAt != null && t >= s.cracksAt && !broken;
    s.cracks.style.visibility = on ? "visible" : "hidden";
    if (on) s.crackPaths.forEach(({ p, L }, i) => { const q = E.out3((t - s.cracksAt - i * 0.012) / 0.3); p.style.strokeDashoffset = `${L * (1 - q)}`; });
  }
  if (s.shardBox) {
    s.shardBox.style.visibility = broken ? "visible" : "hidden";
    if (broken) for (const d of s.shards) {
      const e = Math.max(0, t - s.shatterAt - d.delay), q = E.in2(clamp(e / d.dur));
      const op = 1 - clamp((t - s.shatterAt - d.fade) / 0.4);
      d.el.style.opacity = op.toFixed(3);
      d.el.style.transform = `translate(${(d.dx * d.push * q + d.jx * q).toFixed(1)}px,${(d.dy * d.push * 0.6 * q + d.fall * q).toFixed(1)}px) rotate(${(d.rot * q).toFixed(1)}deg) rotateX(${(d.rotX * q).toFixed(1)}deg) scale(${lerp(1, d.sc, q).toFixed(3)})`;
    }
  }
}
function hidePhoto(s) {
  s.box.style.visibility = "hidden";
  if (s.cracks) s.cracks.style.visibility = "hidden";
  if (s.shardBox) s.shardBox.style.visibility = "hidden";
}
function drawAssemble(s, t) {
  const g = clamp((t - s.start - 0.25) / Math.max(0.6, (s.fillAt ?? s.end - 0.6) - s.start - 0.25));
  fx.save();
  for (const p of s.pieces) {
    const k = clamp((E.inOut(g) - p.delay * 0.6) / (1 - p.delay * 0.6)), e = E.out3(k);
    const x = lerp(p.sx, p.x, e), y = lerp(p.sy, p.y, e);
    fx.setTransform(1, 0, 0, 1, x, y); fx.rotate(p.rot * (1 - e));
    fx.fillStyle = `hsla(45,72%,${55 + p.hue * 25}%,${0.25 + 0.75 * e})`;
    const z = p.size * (1.6 - 0.6 * e);
    fx.beginPath(); fx.moveTo(0, -z); fx.lineTo(z * 0.9, z * 0.6); fx.lineTo(-z * 0.9, z * 0.6); fx.closePath(); fx.fill();
  }
  fx.setTransform(1, 0, 0, 1, 0, 0);
  const fill = s.fillAt == null ? 0 : E.out3((t - s.fillAt) / 0.5);
  if (fill > 0) {
    const gr = fx.createLinearGradient(0, s.box.y, 0, s.box.y + s.box.h);
    gr.addColorStop(0, "#fff0b8"); gr.addColorStop(0.45, "#e2bd4f"); gr.addColorStop(1, "#8f6d17");
    fx.globalAlpha = fill; fx.shadowColor = "rgba(255,210,100,.85)"; fx.shadowBlur = 80 * U;
    fx.fillStyle = gr; fx.fill(s.path); fx.shadowBlur = 0;
    fx.lineWidth = 5 * U; fx.strokeStyle = "#fff4cc"; fx.stroke(s.path);
    const sx = lerp(s.box.x - 300 * U, s.box.x + s.box.w + 300 * U, clamp((t - s.fillAt) / 0.9));
    const sw = fx.createLinearGradient(sx - 140 * U, 0, sx + 140 * U, 0);
    sw.addColorStop(0, "rgba(255,255,255,0)"); sw.addColorStop(0.5, "rgba(255,255,255,.75)"); sw.addColorStop(1, "rgba(255,255,255,0)");
    fx.save(); fx.clip(s.path); fx.fillStyle = sw; fx.fillRect(s.box.x - 400 * U, s.box.y, s.box.w + 800 * U, s.box.h); fx.restore();
    fx.globalAlpha = 1;
  }
  fx.restore();
}
function drawLaunch(s, t) {
  const dur = s.end - s.start, launch = s.start + 0.3, climb = Math.max(1, dur - 0.5);
  const sk = clamp((t - s.start - 0.2) / (climb + 0.1));
  const k = E.in2(clamp((t - launch) / climb));
  const sky = fx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, `rgb(${lerp(10, 2, sk)},${lerp(18, 3, sk)},${lerp(36, 8, sk)})`);
  sky.addColorStop(0.7, `rgb(${lerp(36, 4, sk)},${lerp(40, 6, sk)},${lerp(58, 14, sk)})`);
  sky.addColorStop(1, `rgb(${lerp(120, 8, sk)},${lerp(70, 8, sk)},${lerp(40, 16, sk)})`);
  fx.fillStyle = sky; fx.fillRect(0, 0, W, H);
  const r = rng(99);
  for (let i = 0; i < 220; i++) { const x = r() * W, y = (r() * H + sk * 900 * U) % H, a = r() * sk; fx.fillStyle = `rgba(255,255,255,${a * 0.9})`; fx.fillRect(x, y, 2 * U, 2 * U); }
  const gy = H + sk * 1400 * U;
  fx.fillStyle = "#020203";
  fx.beginPath(); fx.moveTo(0, gy - 120 * U); for (let x = 0; x <= W; x += 60) fx.lineTo(x, gy - 120 * U - Math.abs(Math.sin(x * 0.013)) * 70 * U); fx.lineTo(W, H + 4000); fx.lineTo(0, H + 4000); fx.fill();
  const at = kk => [W * 0.55 - 120 * U * kk + Math.sin(kk * 3) * 14 * U, lerp(H + 230 * U, -520 * U, kk)];
  const n = 220;
  for (let i = 0; i < n; i++) {
    const te = launch + (i / n) * climb;
    if (te > t) break;
    const [ex, ey] = at(E.in2(clamp((te - launch) / climb)));
    const age = t - te, rr = rng(1000 + i);
    const x = ex + (rr() - 0.5) * 30 * U + (rr() - 0.5) * 120 * U * age, y = ey + 210 * U + 40 * U * age + rr() * 30 * U;
    const rad = (24 + 120 * age * (0.6 + rr() * 0.6)) * U, a = 0.42 * Math.exp(-age * 0.75), c = 190 + rr() * 50;
    const sg = fx.createRadialGradient(x, y, 0, x, y, rad);
    sg.addColorStop(0, `rgba(${c},${c - 8},${c - 20},${a})`); sg.addColorStop(1, `rgba(${c},${c},${c},0)`);
    fx.fillStyle = sg; fx.beginPath(); fx.arc(x, y, rad, 0, 6.283); fx.fill();
  }
  const [mx, my] = at(t < launch ? 0 : k);
  fx.save(); fx.translate(mx, my); fx.rotate(-0.045 - k * 0.05); fx.scale(1.45 * U, 1.45 * U);
  const fl = 1 + 0.18 * Math.sin(t * 61) + 0.12 * Math.sin(t * 37);
  const fg = fx.createRadialGradient(0, 120, 0, 0, 150, 230 * fl);
  fg.addColorStop(0, "rgba(255,255,230,1)"); fg.addColorStop(0.25, "rgba(255,210,90,.95)"); fg.addColorStop(0.6, "rgba(255,110,20,.55)"); fg.addColorStop(1, "rgba(255,60,0,0)");
  fx.fillStyle = fg; fx.beginPath(); fx.ellipse(0, 175, 46 * fl, 200 * fl, 0, 0, 6.283); fx.fill();
  const bg = fx.createLinearGradient(-34, 0, 34, 0);
  bg.addColorStop(0, "#3a3f47"); bg.addColorStop(0.35, "#e9ecef"); bg.addColorStop(0.6, "#b9bec6"); bg.addColorStop(1, "#2a2e34");
  fx.fillStyle = bg;
  fx.beginPath(); fx.moveTo(-32, 110); fx.lineTo(-32, -250); fx.quadraticCurveTo(-30, -360, 0, -430); fx.quadraticCurveTo(30, -360, 32, -250); fx.lineTo(32, 110); fx.closePath(); fx.fill();
  fx.fillStyle = "#1d2127";
  fx.beginPath(); fx.moveTo(-32, 30); fx.lineTo(-74, 112); fx.lineTo(-32, 100); fx.closePath(); fx.fill();
  fx.beginPath(); fx.moveTo(32, 30); fx.lineTo(74, 112); fx.lineTo(32, 100); fx.closePath(); fx.fill();
  fx.fillStyle = "#d4af37"; fx.fillRect(-32, -250, 64, 14); fx.fillRect(-32, -60, 64, 8);
  fx.restore();
  const lg = fx.createRadialGradient(W * 0.55, gy - 140 * U, 0, W * 0.55, gy - 140 * U, 700 * U);
  lg.addColorStop(0, `rgba(255,170,60,${0.55 * (1 - sk)})`); lg.addColorStop(1, "rgba(255,120,20,0)");
  fx.fillStyle = lg; fx.fillRect(0, 0, W, H);
}

function drawNewspaper(s, t) {
  const lt = t - s.start, dur = s.end - s.start;
  s.el.style.visibility = "visible";
  const k = E.out5(lt / 0.9);
  const push = lerp(1, 1.12, E.inOut(clamp((lt - 0.9) / Math.max(0.5, dur - 0.9))));
  const rot = lerp(-700, -2.5, k), sc = lerp(0.08, 1, k) * push;
  s.el.style.transform = `translate(-50%,-50%) translateY(${(lerp(0, -0.06, E.inOut(clamp(lt / dur))) * H).toFixed(1)}px) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
  s.el.style.opacity = String(clamp(lt / 0.25));
  if (s.mark) s.mark.style.transform = `scaleX(${s.highlightAt == null ? 0 : E.inOut((t - s.highlightAt) / 0.5).toFixed(3)})`;
}
function drawDocument(s, t) {
  const lt = t - s.start, dur = s.end - s.start;
  s.el.style.visibility = "visible";
  const k = E.out3(lt / 0.7);
  s.el.style.transform = `translate(-50%,-50%) translateY(${((1 - k) * H * 0.6 + lerp(0, -0.04, clamp(lt / dur)) * H).toFixed(1)}px) rotate(${lerp(8, -1.5, k).toFixed(2)}deg) scale(${lerp(1, 1.08, E.inOut(clamp(lt / dur))).toFixed(4)})`;
  const per = Math.max(0.35, Math.min(1.1, ((s.stampAt ?? s.end - 0.8) - s.start - 0.6) / Math.max(1, s.lns.length)));
  s.lns.forEach((x, i) => {
    const q = clamp((lt - 0.6 - i * per) / (per * 0.9));
    x.l.style.clipPath = plan.lang === "ar" ? `inset(0 0 0 ${(100 - q * 100).toFixed(1)}%)` : `inset(0 ${(100 - q * 100).toFixed(1)}% 0 0)`;
    const r = s.redact && s.redact.includes(i) && s.redactAt != null ? E.inOut((t - s.redactAt - i * 0.08) / 0.4) : 0;
    x.bar.style.transform = `scaleX(${r.toFixed(3)})`;
  });
  if (s.seal) {
    const q = s.stampAt == null ? 0 : clamp((t - s.stampAt) / 0.22);
    s.seal.style.opacity = String(q > 0 ? clamp(q * 3) : 0);
    s.seal.style.transform = `translate(-50%,0) rotate(-12deg) scale(${lerp(2.6, 1, E.in2(q)).toFixed(3)})`;
  }
}
function drawTimeline(s, t) {
  s.el.style.visibility = "visible";
  let reach = 0;
  s.items.forEach((it, k) => {
    const q = E.out3((t - it.at) / 0.5);
    it.d.style.opacity = q.toFixed(3);
    it.d.style.transform = `translateY(${((1 - q) * 30 * U).toFixed(1)}px)`;
    if (t >= it.at) reach = (k + 1) / Math.max(1, s.items.length);
    if (t >= it.at - 0.4 && t < it.at) reach = Math.max(reach, (k + (t - it.at + 0.4) / 0.4) / Math.max(1, s.items.length));
  });
  const len = s.lineMax * Math.min(1, reach + 0.02);
  if (VERT) s.line.style.height = len + "px"; else s.line.style.width = len + "px";
}
function hideCard(s) { if (s.el) s.el.style.visibility = "hidden"; }
function drawDark(s, t) {
  const g = fx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.7);
  g.addColorStop(0, s.tint === "red" ? "rgba(60,6,6,1)" : "rgba(22,18,10,1)"); g.addColorStop(1, "rgba(3,4,6,1)");
  fx.fillStyle = g; fx.fillRect(0, 0, W, H);
}

window.DURATION = plan.duration;
window.renderAt = now => {
  const active = shots.find(s => now >= s.start && now < s.end) ?? shots[shots.length - 1];
  fx.clearRect(0, 0, W, H);
  for (const s of shots) if (s.type === "photo" && s !== active) hidePhoto(s);
  for (const s of shots) if ((s.type === "newspaper" || s.type === "document" || s.type === "timeline") && s !== active) hideCard(s);
  const gl = active.type === "globe" || active.type === "flag";
  $("gl").style.visibility = gl ? "visible" : "hidden";
  if (active.type === "globe") drawGlobe(active, now);
  if (active.type === "flag") drawFlag(active, now);
  if (active.type === "photo") drawPhoto(active, now);
  if (active.type === "dark") drawDark(active, now);
  if (active.type === "launch") drawLaunch(active, now);
  if (active.type === "assemble") { drawDark({ tint: "none" }, now); drawAssemble(active, now); }
  if (active.type === "newspaper" || active.type === "document" || active.type === "timeline") {
    drawDark({ tint: active.tint || "none" }, now);
    if (active.type === "newspaper") drawNewspaper(active, now);
    if (active.type === "document") drawDocument(active, now);
    if (active.type === "timeline") drawTimeline(active, now);
  }
  if (active.type === "flag") {
    const dark = fx.createLinearGradient(0, 0, 0, H);
    dark.addColorStop(0, "rgba(0,0,0,.72)"); dark.addColorStop(0.32, "rgba(0,0,0,.25)"); dark.addColorStop(0.55, "rgba(0,0,0,.25)"); dark.addColorStop(0.78, "rgba(0,0,0,.75)"); dark.addColorStop(1, "rgba(0,0,0,.9)");
    fx.fillStyle = dark; fx.fillRect(0, 0, W, H);
  }
  // Dust in the light, embers on the finale.
  for (const d of dust) {
    const x = (d.x + now * 14 * d.z) % W, y = (d.y - now * 22 * d.z + H) % H;
    fx.fillStyle = `rgba(255,230,170,${(0.12 + 0.1 * Math.sin(now * 1.3 + d.ph)) * d.z})`;
    fx.beginPath(); fx.arc(x, y, (1.2 + d.z * 2.2) * U, 0, 6.283); fx.fill();
  }
  if (active.type === "flag") {
    const r = rng(77);
    for (let i = 0; i < 90; i++) {
      const sp = 60 + r() * 140, x0 = r() * W, ph = r() * 30;
      const y = H - (((now - active.start) * sp * U + ph * 60) % (H + 200)) + 100, x = x0 + Math.sin(now * 1.4 + i) * 30 * U;
      fx.fillStyle = `rgba(255,${180 + r() * 60},90,${0.35 + 0.4 * r()})`;
      fx.beginPath(); fx.arc(x, y, (1.5 + r() * 3) * U, 0, 6.283); fx.fill();
    }
  }
  for (const t of texts) setText(t, now);
  // Transitions.
  let flash = 0, dip = 0, gflash = 0;
  for (const s of shots) {
    const e = now - s.start;
    if (s.i === 0) continue;
    if (s.transition === "flash" && e >= 0 && e < 0.45) flash = Math.max(flash, 0.85 * Math.pow(1 - e / 0.45, 2));
    if ((s.transition ?? "fade") === "fade" && e > -0.18 && e < 0.3) dip = Math.max(dip, e < 0 ? 1 + e / 0.18 : 1 - e / 0.3);
  }
  for (const s of shots) if (s.shatterAt != null) { const e = now - s.shatterAt; if (e >= 0 && e < 0.35) flash = Math.max(flash, 0.6 * (1 - e / 0.35)); }
  for (const s of shots) if (s.fillAt != null) { const e = now - s.fillAt; if (e >= 0 && e < 0.9) gflash = Math.max(gflash, 1 - e / 0.9); }
  for (const t of texts) if (t.flash && now >= t.at && now < t.at + 1.1) gflash = Math.max(gflash, 0.9 * (1 - (now - t.at) / 1.1));
  const fadeIn = clamp(now / 0.35), fadeOut = clamp((plan.duration - now) / 0.5);
  $("flash").style.opacity = flash.toFixed(3);
  $("gflash").style.opacity = gflash.toFixed(3);
  $("dip").style.opacity = Math.max(dip, 1 - Math.min(fadeIn, fadeOut)).toFixed(3);
  $("leak").style.opacity = (0.16 + 0.1 * Math.sin(now * 0.5)).toFixed(3);
  const [sx, sy, sr] = shakeAt(now);
  stage.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) rotate(${sr.toFixed(3)}deg)`;
  drawGrain(Math.round(now * 30));
  return true;
};
window.renderAt(0);
window.READY = true;
