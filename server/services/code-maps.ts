/**
 * Animated maps for the motion kit: the geometry is computed here (world-atlas borders, d3-geo projections) and the
 * page only draws and animates paths — no map library or data download in the recorder, identical frames every time.
 *
 * A map scene starts wide (the region around the focus) and zooms onto the focus countries; highlighted countries
 * fill with the accent, routes draw as great-circle arcs, pins and labels pop in. Morocco is drawn whole (with its
 * Sahara, no inner border) unless the storyboard asks for "sahara": "separate".
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { geoArea, geoBounds, geoCentroid, geoGraticule10, geoMercator, geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import countries from "i18n-iso-countries";
import { feature, merge } from "topojson-client";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import type { SbMap } from "../../shared/code-craft/storyboard";

const require = createRequire(import.meta.url);
countries.registerLocale(require("i18n-iso-countries/langs/ar.json"));
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));
countries.registerLocale(require("i18n-iso-countries/langs/fr.json"));

type Topo = { type: "Topology"; objects: { countries: { type: "GeometryCollection"; geometries: { id?: string; properties: { name: string } }[] } }; arcs: number[][][] };
const topoCache = new Map<string, Topo>();
function topology(res: "50m" | "110m"): Topo {
  let t = topoCache.get(res);
  if (!t) {
    t = JSON.parse(readFileSync(require.resolve(`world-atlas/countries-${res}.json`), "utf8")) as Topo;
    topoCache.set(res, t);
  }
  return t;
}

type Country = Feature<Polygon | MultiPolygon, { name: string; id: string }>;
const featureCache = new Map<string, Country[]>();

/** Countries with ids normalised (some disputed areas have none) and Morocco merged with its Sahara by default. */
function countriesOf(res: "50m" | "110m", sahara: "merged" | "separate"): Country[] {
  const key = `${res}|${sahara}`;
  const hit = featureCache.get(key);
  if (hit) return hit;
  const topo = topology(res);
  const fc = feature(topo as never, topo.objects.countries as never) as unknown as FeatureCollection<Polygon | MultiPolygon, { name: string }>;
  let list: Country[] = fc.features.map((f: Feature<Polygon | MultiPolygon, { name: string }>, i: number) => ({ ...f, properties: { name: f.properties.name, id: String(topo.objects.countries.geometries[i].id ?? f.properties.name) } }));
  if (sahara === "merged") {
    const geoms = topo.objects.countries.geometries.filter(g => g.id === "504" || g.id === "732");
    if (geoms.length === 2) {
      const whole = merge(topo as never, geoms as never) as MultiPolygon;
      list = list.filter(f => f.properties.id !== "732").map(f => (f.properties.id === "504" ? { ...f, geometry: whole } : f));
    }
  }
  featureCache.set(key, list);
  return list;
}

/** "MA", "MAR", "504", "Morocco", "المغرب" → numeric id (as world-atlas uses), or the English name for id-less areas. */
export function countryId(v: string, list: Country[]): string | null {
  const s = v.trim();
  if (!s) return null;
  let a2: string | undefined;
  if (/^[A-Za-z]{2}$/.test(s)) a2 = s.toUpperCase();
  else if (/^[A-Za-z]{3}$/.test(s)) a2 = countries.alpha3ToAlpha2(s.toUpperCase());
  else if (/^\d{3}$/.test(s)) return list.some(f => f.properties.id === s) ? s : null;
  else a2 = countries.getAlpha2Code(s, /[؀-ۿ]/.test(s) ? "ar" : "en") || countries.getAlpha2Code(s, "fr");
  if (a2 === "EH") a2 = list.some(f => f.properties.id === "732") ? "EH" : "MA";
  const num = a2 ? countries.alpha2ToNumeric(a2) : undefined;
  if (num && list.some(f => f.properties.id === num)) return num;
  const byName = list.find(f => f.properties.name.toLowerCase() === s.toLowerCase());
  return byName ? byName.properties.id : null;
}

function nameOf(id: string, lang: string, list: Country[]) {
  const a2 = /^\d{3}$/.test(id) ? countries.numericToAlpha2(id) : undefined;
  const l = ["ar", "fr", "en"].includes(lang) ? lang : "en";
  const n = a2 ? countries.getName(a2, l) : undefined;
  return n || list.find(f => f.properties.id === id)?.properties.name || id;
}

/** A country's largest polygon (France without Guiana and Réunion, the US without Alaska's islands…). */
function mainBody(f: Country): Polygon | Country {
  if (f.geometry.type === "Polygon") return f;
  let best: Polygon | null = null;
  let area = -1;
  for (const coords of f.geometry.coordinates) {
    const p: Polygon = { type: "Polygon", coordinates: coords };
    const a = geoArea(p);
    if (a > area) { area = a; best = p; }
  }
  return best ?? f;
}
/** Centroid of the main body (so France is labelled in France, not between it and Guiana). */
function mainPoint(f: Country): [number, number] {
  return geoCentroid(mainBody(f) as never) as [number, number];
}

/** "26.57,56.25" (latitude, longitude) → [lon, lat]. */
function latLon(v: string): [number, number] | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

export type MapGeo = {
  /** Stage size the paths are drawn for. */
  w: number;
  h: number;
  world: boolean;
  grat: string;
  land: string;
  /** Highlighted countries: path, name, label position (null = no label), and whether it is a focus country. */
  hi: { id: string; d: string; name: string; at: [number, number]; lb: [number, number] | null; focus: boolean }[];
  /** Zoom: the focus point (wide-frame coords) travels to `to` on screen while the scale goes 1 → k. */
  zoom: { f: [number, number]; to: [number, number]; k: number };
  routes: { d: string; a: [number, number]; b: [number, number] }[];
  pins: { at: [number, number]; label: string; lb: [number, number] }[];
  dark: boolean;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Geometry for one map scene, in stage pixels. `place` is where the scene's text sits, so the focus lands on the
 * other side of the frame.
 */
export function mapGeometry(spec: SbMap, opts: { width: number; height: number; lang: string; place?: string; dark: boolean }): MapGeo | null {
  const W = opts.width, H = opts.height;
  const sahara = spec.sahara === "separate" ? "separate" : "merged";
  const detailed = countriesOf("50m", sahara);
  const ids = (xs: string[] | undefined) => [...new Set((xs ?? []).map(x => countryId(x, detailed)).filter((x): x is string => !!x))];
  const focus = ids(spec.focus);
  const highlight = [...new Set([...focus, ...ids(spec.highlight)])];
  const routes = (spec.routes ?? []).map(r => [countryId(r[0], detailed), countryId(r[1], detailed)] as const).filter((r): r is readonly [string, string] => !!r[0] && !!r[1] && r[0] !== r[1]);
  // Pins: a country (code or name) or an exact place written "lat,lon" (a strait, a city, a base…).
  const pinSpecs = (spec.pins ?? []).map(p => ({ id: countryId(p.at, detailed), pt: latLon(p.at), label: p.label })).filter(p => p.id || p.pt);
  const byId = new Map(detailed.map(f => [f.properties.id, f]));
  const anchor = [...focus, ...routes.flat(), ...pinSpecs.map(p => p.id).filter((x): x is string => !!x)];
  const points = pinSpecs.map(p => p.pt).filter((x): x is [number, number] => !!x);
  const world = spec.world === true || (!anchor.length && !points.length);

  // Bounds of what must be seen, then a wider frame to zoom from.
  const pts: [number, number][] = [];
  for (const id of new Set(anchor)) {
    const f = byId.get(id);
    if (!f) continue;
    const [[x0, y0], [x1, y1]] = geoBounds(mainBody(f) as never);
    // Countries spanning the antimeridian (Russia, Fiji…) would report the whole world: use their main body.
    if (x1 < x0 || x1 - x0 > 180) { const c = mainPoint(f); pts.push([c[0] - 20, c[1] - 10], [c[0] + 20, c[1] + 10]); }
    else pts.push([x0, y0], [x1, y1]);
  }
  // A place pin keeps some context around it (a strait with both shores, a city with its region).
  for (const [lon, lat] of points) pts.push([lon - 4, lat - 2.5], [lon + 4, lat + 2.5]);
  const lon0 = Math.min(...pts.map(p => p[0])), lon1 = Math.max(...pts.map(p => p[0]));
  const lat0 = Math.min(...pts.map(p => p[1])), lat1 = Math.max(...pts.map(p => p[1]));
  const span = lon1 - lon0, latSpan = lat1 - lat0;
  const useWorld = world || span > 110 || latSpan > 70;
  // Detailed borders when the final frame is close (a country or two), light ones for wide regions.
  const list = countriesOf(useWorld || span > 18 ? "110m" : "50m", sahara);
  const u = Math.min(W, H) / 1080;
  const vertical = H > W;

  let projection: GeoProjection;
  let zoom: MapGeo["zoom"];
  const placeY = opts.place?.startsWith("top") ? 0.6 : opts.place?.startsWith("bottom") ? 0.4 : 0.52;
  if (useWorld) {
    // The whole world, wider than a vertical frame (the Pacific is cropped), centred on what the scene points at.
    const mw = vertical ? W * 1.5 : W * 0.94;
    projection = geoNaturalEarth1().fitWidth(mw, { type: "Sphere" } as never);
    const [tx, ty] = projection.translate();
    const mapH = geoPath(projection).bounds({ type: "Sphere" } as never)[1][1];
    const xs = [...[...new Set(anchor)].map(id => byId.get(id)).filter((f): f is Country => !!f).map(mainPoint), ...points].map(c => projection(c)?.[0]).filter((x): x is number => x !== undefined);
    const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : mw / 2;
    const shift = Math.max(W - mw, Math.min(0, W / 2 - mid)) + (vertical ? 0 : (W - mw) / 2);
    projection.translate([tx + shift, ty + H * placeY - mapH / 2]);
    zoom = { f: [round1(W / 2), round1(H * placeY)], to: [round1(W / 2), round1(H * placeY)], k: 1.06 };
  } else {
    // Wide frame: the focus box grown ~2.6× (never less than ~36° of longitude), clamped away from the poles.
    const cx = (lon0 + lon1) / 2, cy = (lat0 + lat1) / 2;
    const hw = Math.max(18, span * 1.3), hh = Math.max(10, latSpan * 1.3);
    const wide = { type: "MultiPoint", coordinates: [[cx - hw, Math.max(-75, cy - hh)], [cx + hw, Math.min(78, cy + hh)]] };
    projection = geoMercator().fitExtent([[0, 0], [W, H]], wide as never);
    const box = { type: "MultiPoint", coordinates: [[lon0, lat0], [lon1, lat1]] };
    const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(box as never);
    const availW = W * (vertical ? 0.74 : 0.46), availH = H * (vertical ? 0.4 : 0.6);
    const k = Math.max(1.15, Math.min(14, Math.min(availW / Math.max(1, x1 - x0), availH / Math.max(1, y1 - y0))));
    zoom = { f: [round1((x0 + x1) / 2), round1((y0 + y1) / 2)], to: [round1(W / 2), round1(H * placeY)], k: +k.toFixed(3) };
  }
  projection.clipExtent([[-W * 0.06, -H * 0.06], [W * 1.06, H * 1.06]]);
  // Whole pixels are enough unless the camera zooms in a lot.
  const path = geoPath(projection).digits(zoom.k > 2.5 ? 1 : 0);
  const hiSet = new Set(highlight);
  const others: FeatureCollection<Geometry> = { type: "FeatureCollection", features: list.filter(f => !hiSet.has(f.properties.id)) };
  const project = (c: [number, number]) => { const p = projection(c); return p ? ([round1(p[0]), round1(p[1])] as [number, number]) : null; };
  // Where a wide-frame point lands on screen once the zoom is done.
  const final = (p: [number, number]): [number, number] => [round1((p[0] - zoom.f[0]) * zoom.k + zoom.to[0]), round1((p[1] - zoom.f[1]) * zoom.k + zoom.to[1])];
  const focusSet = new Set(focus);
  const hiFeatures = highlight.map(id => list.find(f => f.properties.id === id) ?? byId.get(id)).filter((f): f is Country => !!f);
  const hi = hiFeatures.map(f => {
    const c = project(mainPoint(f));
    return { id: f.properties.id, d: path(f) ?? "", name: nameOf(f.properties.id, opts.lang, list), at: c ? final(c) : zoom.to, focus: focusSet.has(f.properties.id) };
  }).filter(h => h.d);
  // Routes: a curved flight path between the two countries (reads better than a flat great circle).
  const outRoutes = routes.slice(0, 6).map(([a, b]) => {
    const pa = project(mainPoint(byId.get(a)!)), pb = project(mainPoint(byId.get(b)!));
    if (!pa || !pb) return { d: "", a: zoom.to, b: zoom.to };
    const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dist = Math.hypot(dx, dy) || 1;
    const bend = 0.22 * dist;
    // Bend upward (towards the top of the frame) whichever way the route goes.
    let nx = -dy / dist, ny = dx / dist;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const c: [number, number] = [round1((pa[0] + pb[0]) / 2 + nx * bend), round1((pa[1] + pb[1]) / 2 + ny * bend)];
    return { d: `M${pa[0]},${pa[1]}Q${c[0]},${c[1]} ${pb[0]},${pb[1]}`, a: final(pa), b: final(pb) };
  }).filter(r => r.d);
  const pins = pinSpecs.slice(0, 6).map(p => {
    const c = project(p.pt ?? mainPoint(byId.get(p.id!)!));
    return { at: c ? final(c) : zoom.to, label: (p.label ?? "").slice(0, 40) || (p.id ? nameOf(p.id, opts.lang, list) : "") };
  });
  // Labels: pins' labels sit above their pin, countries' on their centre; overlapping ones are pushed apart.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const fit = (x: number, y: number, text: string) => {
    const w = (text.length * 0.56 * 40 + 44) * u, h = 66 * u;
    const clash = (yy: number) => placed.some(b => Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.y - yy) < (b.h + h) / 2);
    let yy = y;
    for (const dy of [0, h + 6 * u, -(h + 6 * u), 2 * (h + 6 * u), -2 * (h + 6 * u)]) { if (!clash(y + dy)) { yy = y + dy; break; } }
    const cx = Math.max(w / 2 + 12 * u, Math.min(W - w / 2 - 12 * u, x));
    placed.push({ x: cx, y: yy, w, h });
    return [round1(cx), round1(yy)] as [number, number];
  };
  const pinOut = pins.map(p => ({ ...p, lb: fit(p.at[0], p.at[1] - 56 * u, p.label) }));
  const hiOut = hi.map(h => ({ ...h, lb: spec.labels === false || pins.some(p => Math.hypot(p.at[0] - h.at[0], p.at[1] - h.at[1]) < 8) ? null : fit(h.at[0], h.at[1], h.name) }));
  return {
    w: W,
    h: H,
    world: useWorld,
    grat: path(geoGraticule10()) ?? "",
    land: path(others) ?? "",
    hi: hiOut,
    zoom,
    routes: outRoutes,
    pins: pinOut,
    dark: opts.dark,
  };
}
