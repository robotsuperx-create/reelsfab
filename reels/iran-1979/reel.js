import * as THREE from "./lib/three.module.min.js";

const W = 1080, H = 1920;
const gsap = window.gsap;
gsap.registerPlugin(window.DrawSVGPlugin, window.CustomEase);
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = {
  out3: k => 1 - Math.pow(1 - k, 3),
  inOut: k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  in2: k => k * k,
  outBack: k => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
};
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* --------------------------------------------------------------- narration timing (seconds) */
const T = {
  y1: 0.45, y5: 2.62, fall: 4.25, throne: 4.74, made: 5.2, wash: 5.79,
  l1: 6.72, world: 8.69, punish: 9.18, iran: 9.88,
  l2: 10.89, forty: 10.99, siege: 12.1, sanc: 12.66, war: 14.46,
  l3: 16.75, yet: 16.85, not: 18.72, broke: 18.99,
  l4: 19.97, missiles: 20.62, hands: 21.39, reach: 22.27, space: 23.06,
  l5: 24.19, story: 24.29, besieged: 26.02, but: 27.55, stood: 28.69,
  end: 30.6,
};
window.DURATION = T.end;

/* --------------------------------------------------------------- data */
const topo = await fetch("lib/countries-50m.json").then(r => r.json());
const countries = window.topojson.feature(topo, topo.objects.countries).features;
const iran = countries.find(f => f.id === "364");

function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
const [shahBg, shahCut, flagImg] = await Promise.all([loadImg("shah_bg.jpg"), loadImg("shah_cut.png"), loadImg("flag.png")]);
await document.fonts.ready;
await Promise.all(["900 100px Cairo", "700 100px Cairo", "700 100px Kufi"].map(f => document.fonts.load(f, "عرش 1979")));

/* --------------------------------------------------------------- three.js: globe, arcs, satellite, flag */
const renderer = new THREE.WebGLRenderer({ canvas: $("gl"), antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setClearColor(0x030406, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, W / H, 0.05, 200);
scene.add(new THREE.AmbientLight(0x8090b0, 0.35));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(4, 3, 5);
scene.add(sun);
const rim = new THREE.DirectionalLight(0x5f8cff, 1.2);
rim.position.set(-5, 1, -3);
scene.add(rim);

// Equirectangular world texture: dark land, faint borders, Iran in gold.
function worldTextures() {
  const tw = 4096, th = 2048;
  const map = document.createElement("canvas"); map.width = tw; map.height = th;
  const emi = document.createElement("canvas"); emi.width = tw; emi.height = th;
  const m = map.getContext("2d"), e = emi.getContext("2d");
  const og = m.createLinearGradient(0, 0, 0, th);
  og.addColorStop(0, "#05080e"); og.addColorStop(0.5, "#070b14"); og.addColorStop(1, "#05080e");
  m.fillStyle = og; m.fillRect(0, 0, tw, th);
  // graticule
  m.strokeStyle = "rgba(120,140,170,.10)"; m.lineWidth = 2;
  for (let lon = -180; lon <= 180; lon += 15) { const x = ((lon + 180) / 360) * tw; m.beginPath(); m.moveTo(x, 0); m.lineTo(x, th); m.stroke(); }
  for (let lat = -75; lat <= 75; lat += 15) { const y = ((90 - lat) / 180) * th; m.beginPath(); m.moveTo(0, y); m.lineTo(tw, y); m.stroke(); }
  e.fillStyle = "#000"; e.fillRect(0, 0, tw, th);
  const P = ([lon, lat]) => [((lon + 180) / 360) * tw, ((90 - lat) / 180) * th];
  const trace = (ctx, geom) => {
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    ctx.beginPath();
    for (const poly of polys) for (const ring of poly) {
      let prev = null;
      ring.forEach((c, i) => {
        const [x, y] = P(c);
        if (i === 0 || (prev && Math.abs(x - prev[0]) > tw / 2)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prev = [x, y];
      });
    }
  };
  for (const f of countries) {
    if (!f.geometry) continue;
    trace(m, f.geometry);
    m.fillStyle = f === iran ? "#d4af37" : "#161c27"; m.fill();
    m.strokeStyle = f === iran ? "#ffe9a3" : "rgba(150,165,190,.28)"; m.lineWidth = f === iran ? 3 : 1.4; m.stroke();
  }
  trace(e, iran.geometry); e.fillStyle = "#d4af37"; e.fill(); e.strokeStyle = "#fff0b0"; e.lineWidth = 6; e.stroke();
  const a = new THREE.CanvasTexture(map), b = new THREE.CanvasTexture(emi);
  a.colorSpace = THREE.SRGBColorSpace; b.colorSpace = THREE.SRGBColorSpace;
  a.anisotropy = b.anisotropy = 8;
  return [a, b];
}
const [worldMap, worldEmi] = worldTextures();
const tilt = new THREE.Group();
const globe = new THREE.Group();
tilt.add(globe);
scene.add(tilt);
const R = 1;
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(R, 128, 96),
  new THREE.MeshStandardMaterial({ map: worldMap, emissiveMap: worldEmi, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.25, roughness: 0.85, metalness: 0.05 }),
);
globe.add(earth);
// Fresnel atmosphere.
const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.07, 96, 64),
  new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
    uniforms: { c: { value: new THREE.Color(0x4f86ff) }, k: { value: 1 } },
    vertexShader: "varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 p = modelViewMatrix*vec4(position,1.); vP = p.xyz; gl_Position = projectionMatrix*p; }",
    fragmentShader: "uniform vec3 c; uniform float k; varying vec3 vN; varying vec3 vP; void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(-vP), vN)), 0., 1.), 2.2); gl_FragColor = vec4(c*f*1.6*k, f*k); }",
  }),
);
tilt.add(atmo);
// Stars.
{
  const r = rng(7), n = 3500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, d = 60 + r() * 40, s = Math.sqrt(1 - u * u);
    pos.set([d * s * Math.cos(th), d * u, d * s * Math.sin(th)], i * 3);
    const w = 0.6 + r() * 0.4; col.set([w, w * (0.9 + r() * 0.1), w * (0.85 + r() * 0.15)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  var stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  scene.add(stars);
}
const ll = (lat, lon, r = R) => {
  const phi = ((lon + 180) * Math.PI) / 180, th = ((90 - lat) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(th), r * Math.cos(th), r * Math.sin(phi) * Math.sin(th));
};
const IRAN = [32.4, 53.7];
const ip = ll(IRAN[0], IRAN[1]);
const faceY = -Math.atan2(ip.x, ip.z);
const faceX = Math.asin(ip.y / R);

// Gold beacon over Iran.
const beacon = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.028, 64), new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
beacon.position.copy(ll(IRAN[0], IRAN[1], R * 1.003));
beacon.lookAt(new THREE.Vector3(0, 0, 0));
globe.add(beacon);
const pulses = [0, 1, 2].map(() => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.075, 96), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.position.copy(ll(IRAN[0], IRAN[1], R * 1.004));
  m.lookAt(new THREE.Vector3(0, 0, 0));
  globe.add(m);
  return m;
});

// Arcs from the countries that besieged Iran.
const SOURCES = [[38.9, -77.0], [45.4, -75.7], [51.5, -0.1], [48.9, 2.35], [52.5, 13.4], [31.8, 35.2], [41.9, 12.5], [35.7, 139.7], [-35.3, 149.1]];
const arcs = SOURCES.map(([lat, lon], i) => {
  const a = ll(lat, lon), b = ip.clone();
  const pts = [];
  for (let s = 0; s <= 80; s++) {
    const k = s / 80;
    const v = a.clone().lerp(b, k).normalize();
    pts.push(v.multiplyScalar(R * (1 + 0.32 * Math.sin(Math.PI * k) * (0.6 + 0.4 * (a.distanceTo(b) / 2)))));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.TubeGeometry(curve, 160, 0.0055, 8, false);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3326, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  geo.setDrawRange(0, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb0a0, transparent: true, blending: THREE.AdditiveBlending }));
  head.visible = false;
  globe.add(mesh, head);
  return { mesh, head, curve, count: geo.index.count, delay: i * 0.17 };
});

// Satellite.
const sat = new THREE.Group();
{
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.9, roughness: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.35, emissive: 0x2a1d00 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1b3a8c, metalness: 0.6, roughness: 0.25, emissive: 0x0a1a44 });
  sat.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), gold));
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.002, 0.05), panel); p1.position.x = 0.11; sat.add(p1);
  const p2 = p1.clone(); p2.position.x = -0.11; sat.add(p2);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.02, 24, 1, true), metal); dish.position.z = 0.05; dish.rotation.x = -Math.PI / 2; sat.add(dish);
}
sat.scale.setScalar(2.4);
const orbit = new THREE.Group();
orbit.add(sat);
orbit.rotation.set(-0.55, 0, 0.3);
scene.add(orbit);
const trailPts = new Float32Array(120 * 3);
const trail = new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(trailPts, 3)), new THREE.LineBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }));
orbit.add(trail);

// Waving flag.
const flagTex = new THREE.Texture(flagImg);
flagTex.colorSpace = THREE.SRGBColorSpace;
flagTex.anisotropy = 8;
flagTex.needsUpdate = true;
const flagGeo = new THREE.PlaneGeometry(3.5, 2.0, 120, 70);
const flagBase = flagGeo.attributes.position.array.slice();
const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.75, metalness: 0.0 }));
flag.visible = false;
scene.add(flag);
function waveFlag(t) {
  const p = flagGeo.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) {
    const x = flagBase[i], y = flagBase[i + 1];
    const k = (x + 1.75) / 3.5;
    p[i + 2] = (Math.sin(x * 2.6 - t * 3.1 + y * 0.6) * 0.11 + Math.sin(x * 5.3 - t * 4.7) * 0.025 + Math.sin(y * 3 - t * 2.2) * 0.03) * (0.25 + k);
  }
  flagGeo.attributes.position.needsUpdate = true;
  flagGeo.computeVertexNormals();
}

/* --------------------------------------------------------------- state driven by the GSAP master timeline */
const S = {
  gl: 1, globe: 1, camZ: 16, rotY: faceY - 1.6, rotX: 0.25, camY: 0, iranGlow: 0.1, beacon: 0, atmo: 1,
  arcs: 0, pulse: 0, sat: 0, satA: 0, flag: 0, flagZ: 4.6, stars: 1, shake: 0,
};
const master = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
CustomEase.create("slam", "M0,0 C0.08,0.9 0.12,1.06 0.22,1.02 0.36,0.98 0.5,1 1,1");

const show = (id, at, o = {}) => master.fromTo($(id), { opacity: 0, y: o.y ?? 50, scale: o.scale ?? 0.94, filter: "blur(18px)" }, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: o.d ?? 0.6, ease: o.ease ?? "power3.out" }, at);
const slam = (id, at, o = {}) => master.fromTo($(id), { opacity: 0, scale: o.from ?? 1.9, filter: "blur(10px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: o.d ?? 0.32, ease: "slam" }, at);
const hide = (id, at, d = 0.35) => master.to($(id), { opacity: 0, y: -30, filter: "blur(14px)", duration: d, ease: "power2.in" }, at);
const shake = (at, amp = 22, d = 0.45) => {
  const r = rng(Math.round(at * 1000));
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const f = 1 - i / steps;
    master.to($("stage"), { x: (r() - 0.5) * 2 * amp * f, y: (r() - 0.5) * 2 * amp * f, rotation: (r() - 0.5) * 0.8 * f, duration: d / steps, ease: "none" }, at + (i * d) / steps);
  }
  master.to($("stage"), { x: 0, y: 0, rotation: 0, duration: 0.05 }, at + d);
};
const flash = (at, k = 0.9, d = 0.5) => master.fromTo($("flash"), { opacity: k }, { opacity: 0, duration: d, ease: "power2.out", immediateRender: false }, at);

// S1 — the globe dives to Iran, the year rolls to 1979.
master.to(S, { camZ: 3.3, rotY: faceY, rotX: faceX, duration: 3.5, ease: "power2.inOut" }, 0);
master.to(S, { iranGlow: 1.25, beacon: 1, duration: 1.4, ease: "power2.out" }, 1.6);
show("k1979", 0.55, { d: 0.7 });
const yr = { v: 1900 };
master.fromTo($("y1979"), { opacity: 0, scale: 0.8, filter: "blur(20px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.7 }, T.y1);
master.to(yr, { v: 1979, duration: T.y5 + 0.35 - T.y1, ease: "power3.out", onUpdate: () => { $("y1979").textContent = String(Math.round(yr.v)); } }, T.y1);
master.to($("y1979"), { scale: 1.06, duration: 0.6, ease: "power2.out" }, T.y5 + 0.3);
hide("k1979", 3.35); hide("y1979", 3.35);
flash(3.62, 0.85, 0.45);
master.set(S, { gl: 0 }, 3.62);

// S2 — the throne: parallax portrait, cracks, shatter.
master.set($("photo"), { opacity: 1 }, 3.62);
master.fromTo($("pbg"), { xPercent: -50, yPercent: -50, scale: 1.3 }, { scale: 1.18, duration: T.throne - 3.62, ease: "none" }, 3.62);
master.fromTo($("pcut"), { xPercent: -50, yPercent: -50, scale: 1.16, y: 40 }, { scale: 1.06, y: 0, duration: T.throne - 3.62, ease: "none" }, 3.62);
slam("sFell", T.fall);
shake(T.fall, 14, 0.35);
master.fromTo($("cracks"), { opacity: 0 }, { opacity: 1, duration: 0.05 }, T.fall);
slam("sThrone", T.throne, { from: 2.2 });
master.set($("photo"), { opacity: 0 }, T.throne);
master.set($("cracks"), { opacity: 0 }, T.throne);
flash(T.throne, 0.6, 0.35);
shake(T.throne, 26, 0.55);
show("sMade", T.made, { d: 0.45 });
slam("sWash", T.wash, { from: 1.6 });
["sFell", "sThrone", "sMade", "sWash"].forEach(id => hide(id, 6.45, 0.3));

// S3 — the world against Iran: arcs converge.
master.set(S, { gl: 1, camZ: 4.6, rotY: faceY + 0.55, rotX: faceX - 0.15, iranGlow: 0.9, beacon: 0.6 }, 6.6);
master.fromTo($("flash"), { opacity: 0.35 }, { opacity: 0, duration: 0.4, immediateRender: false }, 6.6);
master.to(S, { camZ: 3.9, rotY: faceY + 0.15, rotX: faceX, duration: 4.2, ease: "power1.inOut" }, 6.6);
master.to(S, { arcs: 1, duration: 2.6, ease: "power2.inOut" }, 7.0);
slam("wWorld", T.world, { from: 1.5 });
master.to(S, { pulse: 1, duration: 1.6, ease: "none" }, T.punish);
show("wPunish", T.punish, { d: 0.5 });
master.to(S, { iranGlow: 1.6, duration: 0.3 }, T.iran);
shake(T.iran, 10, 0.3);
hide("wWorld", 10.55); hide("wPunish", 10.55);
master.to(S, { gl: 0, duration: 0.25, ease: "power1.in" }, 10.65);

// S4 — forty years: counter and stamps over the revolution crowd.
master.fromTo($("rev"), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 10.8);
master.fromTo($("rev").querySelector("img"), { xPercent: -50, yPercent: -50, scale: 1.08 }, { xPercent: -50, yPercent: -50, scale: 1.22, duration: 6, ease: "none" }, 10.8);
const forty = { v: 0 };
master.fromTo($("n40"), { opacity: 0, scale: 0.7, filter: "blur(16px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.5 }, T.forty);
master.to(forty, { v: 40, duration: 0.9, ease: "power2.out", onUpdate: () => { $("n40").textContent = String(Math.round(forty.v)); } }, T.forty);
show("n40l", T.forty + 0.4, { d: 0.5 });
[["st1", T.siege, -4], ["st2", T.sanc, 3], ["st3", T.war, -2]].forEach(([id, at, rot]) => {
  master.fromTo($(id), { opacity: 0, xPercent: -50, scale: 2.6, rotation: rot * 3 }, { opacity: 1, xPercent: -50, scale: 1, rotation: rot, duration: 0.24, ease: "power4.in" }, at - 0.12);
  shake(at + 0.1, 24, 0.4);
});
["n40", "n40l", "st1", "st2", "st3"].forEach(id => hide(id, 16.2, 0.35));
master.to($("rev"), { opacity: 0, duration: 0.5 }, 16.2);

// S5 — "and yet… it did not break": the pieces come back as Iran.
show("yet", T.yet, { d: 0.8, y: 20 });
master.to($("yet"), { opacity: 0.45, duration: 0.6 }, 18.2);
const S5 = { gather: 0, fill: 0 };
master.to(S5, { gather: 1, duration: 1.55, ease: "power3.inOut" }, 17.15);
master.to(S5, { fill: 1, duration: 0.5, ease: "power2.out" }, T.not);
slam("notBroke", T.broke - 0.12, { from: 2.1, d: 0.36 });
master.fromTo($("gflash"), { opacity: 1 }, { opacity: 0, duration: 0.9, immediateRender: false }, T.broke);
shake(T.broke, 18, 0.45);
["yet", "notBroke"].forEach(id => hide(id, 19.75, 0.3));
master.to(S5, { gather: 1.15, fill: 0, duration: 0.3, ease: "power2.in" }, 19.75);

// S6 — missiles, then space.
const S6 = { k: 0, sky: 0, on: 0 };
master.set(S6, { on: 1 }, 19.95);
master.to(S6, { k: 1, duration: 2.15, ease: "power2.in" }, 20.25);
master.to(S6, { sky: 1, duration: 2.3, ease: "power1.inOut" }, 20.2);
show("mMade", T.l4 + 0.1, { d: 0.5 });
slam("mHands", T.hands, { from: 1.8 });
shake(20.35, 9, 1.6);
hide("mMade", 22.05); hide("mHands", 22.05);
master.set(S6, { on: 0 }, 22.45);
flash(22.4, 0.55, 0.4);
master.set(S, { gl: 1, globe: 1, camZ: 4.9, rotY: faceY + 0.9, rotX: faceX - 0.25, iranGlow: 1.1, beacon: 0.8, arcs: 0, pulse: 0, sat: 1, satA: -0.6 }, 22.4);
master.to(S, { rotY: faceY + 0.25, camZ: 4.3, satA: 2.4, duration: 1.75, ease: "none" }, 22.4);
show("mSpace", T.space, { d: 0.55 });
hide("mSpace", 24.0, 0.25);

// S7 — the flag: not a besieged state, a state that stood.
master.set(S, { gl: 1, globe: 0, sat: 0, flag: 1, stars: 0.25 }, 24.15);
master.fromTo(S, { flagZ: 3.4 }, { flagZ: 2.55, duration: 6.4, ease: "none", immediateRender: false }, 24.15);
master.fromTo($("flash"), { opacity: 0.4 }, { opacity: 0, duration: 0.5, immediateRender: false }, 24.15);
show("fNot", T.story, { d: 0.6 });
show("fBes", T.besieged - 0.05, { d: 0.5 });
master.fromTo($("strike"), { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.inOut" }, 26.75);
master.to($("fBes"), { opacity: 0.55, duration: 0.4 }, 27.1);
show("fBut", T.but, { d: 0.5 });
slam("fStood", T.stood - 0.1, { from: 2.4, d: 0.38 });
master.fromTo($("gflash"), { opacity: 0.9 }, { opacity: 0, duration: 1.1, immediateRender: false }, T.stood);
shake(T.stood, 16, 0.45);
master.fromTo($("tag"), { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6 }, 29.35);
master.to($("leak"), { opacity: 0.45, duration: 2, ease: "sine.inOut" }, 27.5);
master.to({}, { duration: 0.01 }, T.end - 0.01);

/* --------------------------------------------------------------- cracks + shards (built once) */
{
  const r = rng(42);
  const cx = 540, cy = 760;
  const svg = $("cracks");
  let html = "";
  for (let i = 0; i < 16; i++) {
    let a = (i / 16) * Math.PI * 2 + r() * 0.3, x = cx, y = cy, d = `M${cx} ${cy}`;
    const len = 500 + r() * 900;
    for (let s = 0; s < 14; s++) { a += (r() - 0.5) * 0.5; x += Math.cos(a) * (len / 14); y += Math.sin(a) * (len / 14); d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
    html += `<path d="${d}" fill="none" stroke="rgba(255,248,225,.92)" stroke-width="${(2 + r() * 3).toFixed(1)}" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(255,220,140,.8))"/>`;
  }
  svg.innerHTML = html;
  master.fromTo(svg.querySelectorAll("path"), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.3, stagger: 0.012, ease: "power2.out" }, T.fall);
}
// The portrait as it looks at the shatter moment, painted once into a canvas.
const portrait = document.createElement("canvas");
portrait.width = W; portrait.height = H;
{
  const g = portrait.getContext("2d");
  const cover = (img, scale, oy = 0) => {
    const k = Math.max(W / img.width, H / img.height) * scale;
    const w = img.width * k, h = img.height * k;
    return [W / 2 - w / 2, H * 0.42 - h * 0.42 + oy, w, h];
  };
  g.fillStyle = "#050403"; g.fillRect(0, 0, W, H);
  g.filter = "grayscale(1) sepia(.55) brightness(.5) blur(7px)";
  g.drawImage(shahBg, ...cover(shahBg, 1.18));
  g.filter = "grayscale(.85) sepia(.4) contrast(1.18) brightness(.98)";
  g.drawImage(shahCut, ...cover(shahCut, 1.06));
  g.filter = "none";
  const v = g.createRadialGradient(W / 2, H * 0.4, 200, W / 2, H * 0.45, 1100);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(5,4,2,.78)");
  g.fillStyle = v; g.fillRect(0, 0, W, H);
}
const portraitUrl = portrait.toDataURL("image/jpeg", 0.92);
{
  const r = rng(11), cols = 7, rows = 12, pts = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const edge = i === 0 || j === 0 || i === cols || j === rows;
    pts.push([(i / cols) * W + (edge ? 0 : (r() - 0.5) * 110), (j / rows) * H + (edge ? 0 : (r() - 0.5) * 110)]);
  }
  const box = $("shards");
  const P = (i, j) => pts[j * (cols + 1) + i];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const tris = (i + j) % 2 ? [[P(i, j), P(i + 1, j), P(i + 1, j + 1)], [P(i, j), P(i + 1, j + 1), P(i, j + 1)]] : [[P(i, j), P(i + 1, j), P(i, j + 1)], [P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]];
    for (const tri of tris) {
      const el = document.createElement("div");
      el.className = "shard";
      el.style.backgroundImage = `url(${portraitUrl})`;
      el.style.clipPath = `polygon(${tri.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",")})`;
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      el.style.transformOrigin = `${cx}px ${cy}px`;
      el.style.opacity = "0";
      box.appendChild(el);
      const dx = cx - 540, dy = cy - 760, dist = Math.hypot(dx, dy) + 1;
      const push = 260 + r() * 380;
      const delay = (dist / 1800) * 0.12;
      master.set(el, { opacity: 1 }, T.throne);
      master.to(el, { x: (dx / dist) * push + (r() - 0.5) * 120, y: (dy / dist) * push * 0.6 + 1900 + r() * 500, rotation: (r() - 0.5) * 260, rotationX: (r() - 0.5) * 160, scale: 0.85 + r() * 0.3, duration: 1.55 + r() * 0.4, ease: "power2.in" }, T.throne + delay);
      master.to(el, { opacity: 0, duration: 0.4 }, T.throne + 1.3 + r() * 0.4);
    }
  }
}

/* --------------------------------------------------------------- 2D effects canvas: dust, Iran gathering, missile */
const fx = $("fx").getContext("2d");
const iranPath = new Path2D();
let iranBox;
{
  const polys = iran.geometry.type === "Polygon" ? [iran.geometry.coordinates] : iran.geometry.coordinates;
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const proj = ([lon, lat]) => [lon * Math.cos((32 * Math.PI) / 180), -lat];
  for (const poly of polys) for (const ring of poly) for (const c of ring) { const [x, y] = proj(c); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const s = 860 / (maxX - minX), ox = 540 - ((minX + maxX) / 2) * s, oy = 900 - ((minY + maxY) / 2) * s;
  for (const poly of polys) for (const ring of poly) ring.forEach((c, i) => { const [x, y] = proj(c); const X = x * s + ox, Y = y * s + oy; i ? iranPath.lineTo(X, Y) : iranPath.moveTo(X, Y); });
  iranPath.closePath();
  iranBox = { x: minX * s + ox, y: minY * s + oy, w: (maxX - minX) * s, h: (maxY - minY) * s };
}
const pieces = [];
{
  const r = rng(5);
  const probe = document.createElement("canvas").getContext("2d");
  while (pieces.length < 520) {
    const x = iranBox.x + r() * iranBox.w, y = iranBox.y + r() * iranBox.h;
    if (!probe.isPointInPath(iranPath, x, y)) continue;
    const a = r() * Math.PI * 2, d = 900 + r() * 900;
    pieces.push({ x, y, sx: 540 + Math.cos(a) * d, sy: 900 + Math.sin(a) * d, rot: (r() - 0.5) * 12, size: 10 + r() * 16, delay: r() * 0.35, hue: r() });
  }
}
const dust = (() => { const r = rng(3); return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H, z: 0.3 + r() * 0.7, ph: r() * 6.28 })); })();

function missileAt(k) {
  // Position of the missile tail along its climb (k: 0 → 1).
  const y = lerp(2150, -520, k);
  const x = 600 - 120 * k + Math.sin(k * 3) * 14;
  return [x, y];
}
function drawFx(t) {
  fx.clearRect(0, 0, W, H);
  // Dust motes, always there, faint.
  fx.save();
  for (const d of dust) {
    const x = (d.x + t * 14 * d.z) % W, y = (d.y - t * 22 * d.z + H) % H;
    const a = 0.12 + 0.1 * Math.sin(t * 1.3 + d.ph);
    fx.fillStyle = `rgba(255,230,170,${a * d.z})`;
    fx.beginPath(); fx.arc(x, y, 1.2 + d.z * 2.2, 0, 6.283); fx.fill();
  }
  fx.restore();
  // S5: shards gather into Iran.
  const g = S5.gather;
  if (t > 17 && t < 20.2) {
    fx.save();
    for (const p of pieces) {
      const k = clamp((g - p.delay * 0.6) / (1 - p.delay * 0.6));
      const e = ease.out3(k);
      const x = lerp(p.sx, p.x, e), y = lerp(p.sy, p.y, e);
      fx.translate(x, y); fx.rotate(p.rot * (1 - e));
      const lum = 55 + p.hue * 25;
      fx.fillStyle = `hsla(45,72%,${lum}%,${0.25 + 0.75 * e})`;
      const s = p.size * (1.6 - 0.6 * e);
      fx.beginPath(); fx.moveTo(0, -s); fx.lineTo(s * 0.9, s * 0.6); fx.lineTo(-s * 0.9, s * 0.6); fx.closePath(); fx.fill();
      fx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (S5.fill > 0) {
      const gr = fx.createLinearGradient(0, iranBox.y, 0, iranBox.y + iranBox.h);
      gr.addColorStop(0, "#fff0b8"); gr.addColorStop(0.45, "#e2bd4f"); gr.addColorStop(1, "#8f6d17");
      fx.globalAlpha = S5.fill;
      fx.shadowColor = "rgba(255,210,100,.85)"; fx.shadowBlur = 80;
      fx.fillStyle = gr; fx.fill(iranPath);
      fx.shadowBlur = 0;
      fx.lineWidth = 5; fx.strokeStyle = "#fff4cc"; fx.stroke(iranPath);
      // light sweep
      const sx = lerp(iranBox.x - 300, iranBox.x + iranBox.w + 300, clamp((t - T.not) / 0.9));
      const sw = fx.createLinearGradient(sx - 140, 0, sx + 140, 0);
      sw.addColorStop(0, "rgba(255,255,255,0)"); sw.addColorStop(0.5, "rgba(255,255,255,.75)"); sw.addColorStop(1, "rgba(255,255,255,0)");
      fx.save(); fx.clip(iranPath); fx.fillStyle = sw; fx.fillRect(iranBox.x - 400, iranBox.y, iranBox.w + 800, iranBox.h); fx.restore();
      fx.globalAlpha = 1;
    }
    fx.restore();
  }
  // S6: sky, smoke, missile.
  if (S6.on) {
    const sky = fx.createLinearGradient(0, 0, 0, H);
    const s = S6.sky;
    sky.addColorStop(0, `rgb(${lerp(10, 2, s)},${lerp(18, 3, s)},${lerp(36, 8, s)})`);
    sky.addColorStop(0.7, `rgb(${lerp(36, 4, s)},${lerp(40, 6, s)},${lerp(58, 14, s)})`);
    sky.addColorStop(1, `rgb(${lerp(120, 8, s)},${lerp(70, 8, s)},${lerp(40, 16, s)})`);
    fx.fillStyle = sky; fx.fillRect(0, 0, W, H);
    // stars appear as we climb
    const r = rng(99);
    for (let i = 0; i < 220; i++) {
      const x = r() * W, y = (r() * H + s * 900) % H, a = r() * s;
      fx.fillStyle = `rgba(255,255,255,${a * 0.9})`; fx.fillRect(x, y, 2, 2);
    }
    // ground silhouette and launch glow
    const gy = 1920 + s * 1400;
    fx.fillStyle = "#020203";
    fx.beginPath(); fx.moveTo(0, gy - 120); for (let x = 0; x <= W; x += 60) fx.lineTo(x, gy - 120 - Math.abs(Math.sin(x * 0.013)) * 70); fx.lineTo(W, H + 2000); fx.lineTo(0, H + 2000); fx.fill();
    const k = S6.k;
    const launch = 20.25;
    // smoke: particles emitted along the path, each moves and grows with its own age
    const n = 220;
    for (let i = 0; i < n; i++) {
      const te = launch + (i / n) * 2.15;
      if (te > t) break;
      const ke = ease.in2(clamp((te - launch) / 2.15));
      const [ex, ey] = missileAt(ke);
      const age = t - te;
      const rr = rng(1000 + i);
      const x = ex + (rr() - 0.5) * 30 + (rr() - 0.5) * 120 * age;
      const y = ey + 150 + 40 * age + rr() * 30;
      const rad = 24 + 120 * age * (0.6 + rr() * 0.6);
      const a = 0.42 * Math.exp(-age * 0.75);
      const sg = fx.createRadialGradient(x, y, 0, x, y, rad);
      const c = 190 + rr() * 50;
      sg.addColorStop(0, `rgba(${c},${c - 8},${c - 20},${a})`); sg.addColorStop(1, `rgba(${c},${c},${c},0)`);
      fx.fillStyle = sg; fx.beginPath(); fx.arc(x, y, rad, 0, 6.283); fx.fill();
    }
    if (t >= launch - 0.3) {
      const kk = t < launch ? 0 : k;
      const [mx, my] = missileAt(kk);
      fx.save();
      fx.translate(mx, my);
      fx.rotate(-0.045 - kk * 0.05);
      fx.scale(1.45, 1.45);
      // flame
      const fl = 1 + 0.18 * Math.sin(t * 61) + 0.12 * Math.sin(t * 37);
      const fg = fx.createRadialGradient(0, 120, 0, 0, 150, 230 * fl);
      fg.addColorStop(0, "rgba(255,255,230,1)"); fg.addColorStop(0.25, "rgba(255,210,90,.95)"); fg.addColorStop(0.6, "rgba(255,110,20,.55)"); fg.addColorStop(1, "rgba(255,60,0,0)");
      fx.fillStyle = fg; fx.beginPath(); fx.ellipse(0, 175, 46 * fl, 200 * fl, 0, 0, 6.283); fx.fill();
      // body
      const bg = fx.createLinearGradient(-34, 0, 34, 0);
      bg.addColorStop(0, "#3a3f47"); bg.addColorStop(0.35, "#e9ecef"); bg.addColorStop(0.6, "#b9bec6"); bg.addColorStop(1, "#2a2e34");
      fx.fillStyle = bg;
      fx.beginPath(); fx.moveTo(-32, 110); fx.lineTo(-32, -250); fx.quadraticCurveTo(-30, -360, 0, -430); fx.quadraticCurveTo(30, -360, 32, -250); fx.lineTo(32, 110); fx.closePath(); fx.fill();
      fx.fillStyle = "#1d2127";
      fx.beginPath(); fx.moveTo(-32, 30); fx.lineTo(-74, 112); fx.lineTo(-32, 100); fx.closePath(); fx.fill();
      fx.beginPath(); fx.moveTo(32, 30); fx.lineTo(74, 112); fx.lineTo(32, 100); fx.closePath(); fx.fill();
      fx.fillStyle = "#d4af37"; fx.fillRect(-32, -250, 64, 14); fx.fillRect(-32, -60, 64, 8);
      fx.restore();
      // launch glow on the ground
      const lg = fx.createRadialGradient(600, gy - 140, 0, 600, gy - 140, 700);
      lg.addColorStop(0, `rgba(255,170,60,${0.55 * (1 - s)})`); lg.addColorStop(1, "rgba(255,120,20,0)");
      fx.fillStyle = lg; fx.fillRect(0, 0, W, H);
    }
  }
  // S7: embers rising over the flag.
  if (t > 24.1) {
    const r = rng(77);
    for (let i = 0; i < 90; i++) {
      const sp = 60 + r() * 140, x0 = r() * W, ph = r() * 30;
      const y = H - (((t - 24.1) * sp + ph * 60) % (H + 200)) + 100;
      const x = x0 + Math.sin(t * 1.4 + i) * 30;
      const a = 0.35 + 0.4 * r();
      fx.fillStyle = `rgba(255,${180 + r() * 60},90,${a})`;
      fx.beginPath(); fx.arc(x, y, 1.5 + r() * 3, 0, 6.283); fx.fill();
    }
    const dark = fx.createLinearGradient(0, 0, 0, H);
    dark.addColorStop(0, "rgba(0,0,0,.72)"); dark.addColorStop(0.32, "rgba(0,0,0,.25)"); dark.addColorStop(0.55, "rgba(0,0,0,.25)"); dark.addColorStop(0.78, "rgba(0,0,0,.75)"); dark.addColorStop(1, "rgba(0,0,0,.9)");
    fx.fillStyle = dark; fx.fillRect(0, 0, W, H);
  }
}

/* --------------------------------------------------------------- film grain */
const grain = $("grain").getContext("2d");
const gimg = grain.createImageData(540, 960);
function drawGrain(frame) {
  const r = rng(frame * 7919 + 1), d = gimg.data;
  for (let i = 0; i < d.length; i += 4) { const v = (r() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  grain.putImageData(gimg, 0, 0);
}

/* --------------------------------------------------------------- 3D frame */
function draw3d(t) {
  $("gl").style.opacity = String(S.gl);
  if (S.gl <= 0.001) return;
  const showGlobe = S.globe > 0.5 && !S.flag;
  earth.visible = atmo.visible = showGlobe;
  globe.visible = showGlobe;
  stars.material.opacity = 0.9 * S.stars;
  tilt.rotation.x = S.rotX;
  globe.rotation.y = S.rotY;
  earth.material.emissiveIntensity = 0.25 + S.iranGlow * (0.75 + 0.25 * Math.sin(t * 4));
  beacon.material.opacity = S.beacon * (0.6 + 0.4 * Math.sin(t * 5));
  const bs = 1 + ((t * 0.9) % 1) * 2.5;
  beacon.scale.setScalar(bs);
  beacon.material.opacity *= 1 - ((t * 0.9) % 1);
  pulses.forEach((m, i) => {
    const ph = (S.pulse * 2.2 + i * 0.33) % 1;
    m.visible = S.pulse > 0 && S.pulse < 1 && showGlobe;
    m.scale.setScalar(0.4 + ph * 3.2);
    m.material.opacity = (1 - ph) * 0.9;
  });
  for (const a of arcs) {
    const k = clamp((S.arcs * (1 + arcs.length * 0.17 / 2.6) - a.delay / 2.6) / 1);
    const e = ease.inOut(k);
    a.mesh.visible = e > 0 && showGlobe;
    a.mesh.geometry.setDrawRange(0, Math.floor(e * a.count / 3) * 3);
    a.head.visible = e > 0 && e < 0.999 && showGlobe;
    if (a.head.visible) a.head.position.copy(a.curve.getPoint(e));
  }
  sat.visible = trail.visible = S.sat > 0.5;
  if (sat.visible) {
    const ang = S.satA, rr = 1.24;
    sat.position.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
    sat.rotation.set(0.3, -ang + Math.PI / 2, 0.2);
    const tp = trail.geometry.attributes.position.array;
    for (let i = 0; i < 120; i++) { const a2 = ang - i * 0.012; tp.set([Math.cos(a2) * rr, 0, Math.sin(a2) * rr], i * 3); }
    trail.geometry.attributes.position.needsUpdate = true;
  }
  flag.visible = !!S.flag;
  if (flag.visible) {
    waveFlag(t);
    camera.position.set(0, 0, S.flagZ);
    flag.rotation.set(-0.08, 0.32, -0.06);
    flag.position.set(0.15, 0.15, 0);
    flag.scale.setScalar(1.35);
    sun.intensity = 2.6;
  } else {
    camera.position.set(0, S.camY, S.camZ);
  }
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

/* --------------------------------------------------------------- the one entry point the recorder calls */
window.renderAt = t => {
  master.seek(t, false);
  draw3d(t);
  drawFx(t);
  drawGrain(Math.round(t * 30));
  return true;
};
window.renderAt(0);
window.READY = true;
