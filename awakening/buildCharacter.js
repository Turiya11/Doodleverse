import * as THREE from 'three';
import { isNeon, neonMaterial, markGlow } from '../vfx/neon.js';

// Turns finished strokes (canvas-local, z = 0) into a 2.5D character.
//
// Each stroke is classified first:
// - a closed, non-self-intersecting loop becomes a filled, bevelled extrusion;
// - anything else (an arm, a smile, a scribble) becomes a puffy tube. Filling an open stroke would
//   join its ends with a straight edge, and Earcut does not throw on self-intersecting outlines,
//   it silently produces broken triangles, so those can't be fixed with try/catch.
// Shapes drawn inside other shapes (eyes inside a face) sit on their parent's front face instead of
// z-fighting with it, so the character keeps its features.

const SAMPLE_SPACING = 0.004;   // resample strokes every 4mm
const MIN_LENGTH = 0.003;
const MIN_FILL_AREA = 0.0001;   // 1cm²; smaller loops are dots, drawn as tubes
const CLOSE_GAP = 0.015;        // ends this close (or within 20% of the stroke's size) count as closed
const FEATURE_DEPTH = 0.004;
const RIM_RADIUS = 0.0035;
const LIMB_RADIUS = 0.006;
const FILL_TINT = 0.35;         // body fills are a lighter tint so the outline still reads

const capGeometries = new Map();

export function buildCharacter(strokes) {
    const pieces = strokes.map(analyse).filter(Boolean);
    const fills = pieces.filter((p) => p.fill).sort((a, b) => a.area - b.area); // smallest first

    // Parent = the smallest larger fill that contains this piece.
    for (const p of pieces) {
        const probe = p.fill ? p.poly[0] : p.poly[Math.floor(p.poly.length / 2)];
        p.parent = fills.find((f) => f !== p && (!p.fill || f.area > p.area) && pointInPolygon(probe, f.poly)) ?? null;
    }

    const group = new THREE.Group();
    // Largest first so every parent's front face is known before its children are placed.
    for (const p of [...fills].reverse()) group.add(...buildFill(p));
    for (const p of pieces) if (!p.fill) group.add(...buildLine(p));
    group.traverse((o) => { o.castShadow = true; });
    markGlow(group);

    const box = new THREE.Box2();
    for (const p of pieces) box.expandByPoint(p.box.min).expandByPoint(p.box.max);
    return { group, center: box.getCenter(new THREE.Vector2()) };
}

function analyse(stroke) {
    const length = stroke.curve.getLength();
    if (length < MIN_LENGTH) return null;

    const n = THREE.MathUtils.clamp(Math.round(length / SAMPLE_SPACING), 16, 240);
    const poly = stroke.curve.getSpacedPoints(n).map((p) => new THREE.Vector2(p.x, p.y));
    const box = new THREE.Box2().setFromPoints(poly);
    const size = box.getSize(new THREE.Vector2());
    const minDim = Math.min(size.x, size.y);

    const gap = poly[0].distanceTo(poly[poly.length - 1]);
    const closed = gap < Math.max(CLOSE_GAP, 0.2 * size.length());
    if (closed && gap < 1e-4) poly.pop(); // drawn exactly back onto its start
    const area = Math.abs(THREE.ShapeUtils.area(poly));
    const fill = closed && area > MIN_FILL_AREA && !selfIntersects(poly);

    return { stroke, poly, box, minDim, area, fill, parent: null, front: 0 };
}

function material(color, tint = 0) {
    const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), tint);
    if (isNeon(color)) return neonMaterial(c); // neon ink keeps glowing on the character
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.05 });
}

function buildFill(p) {
    const isBody = !p.parent;
    // Sized relative to the shape: a fixed 1cm bevel would swallow a 1cm eye.
    const depth = isBody ? THREE.MathUtils.clamp(0.3 * p.minDim, 0.012, 0.05) : FEATURE_DEPTH;
    const bevel = Math.min(isBody ? 0.006 : 0.002, 0.12 * p.minDim);

    const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(p.poly), {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
    });
    const mesh = new THREE.Mesh(geometry, material(p.stroke.color, isBody ? FILL_TINT : 0));

    // Bodies straddle the canvas plane; features sit on their parent's front face.
    mesh.position.z = isBody ? -depth / 2 : p.parent.front;
    p.front = mesh.position.z + depth + bevel;

    if (!isBody) return [mesh];
    // Keep the drawn outline as a puffy rim around the front face.
    const rim = tube(p.stroke.curve, RIM_RADIUS, p.stroke.color, true);
    rim.position.z = p.front;
    return [mesh, rim];
}

function buildLine(p) {
    const radius = p.parent ? RIM_RADIUS : LIMB_RADIUS;
    const mesh = tube(p.stroke.curve, radius, p.stroke.color, false);
    mesh.position.z = p.parent ? p.parent.front + radius * 0.5 : 0;
    return [mesh];
}

function tube(curve, radius, color, closedLoop) {
    const mat = material(color);
    const segments = THREE.MathUtils.clamp(Math.round(curve.getLength() / 0.002), 8, 1000);
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 10, false), mat));
    if (!closedLoop) {
        let cap = capGeometries.get(radius);
        if (!cap) capGeometries.set(radius, (cap = new THREE.SphereGeometry(radius, 12, 8)));
        for (const t of [0, 1]) {
            const end = new THREE.Mesh(cap, mat);
            end.position.copy(curve.getPoint(t));
            group.add(end);
        }
    }
    return group;
}

function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

function selfIntersects(poly) {
    const n = poly.length;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    for (let i = 0; i < n; i++) {
        const a1 = poly[i];
        const a2 = poly[(i + 1) % n];
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
            const b1 = poly[j];
            const b2 = poly[(j + 1) % n];
            if (cross(a1, a2, b1) * cross(a1, a2, b2) < 0 && cross(b1, b2, a1) * cross(b1, b2, a2) < 0) return true;
        }
    }
    return false;
}

// Frees geometries and materials, keeping the shared end-cap spheres.
export function disposeCharacter(group) {
    const shared = new Set(capGeometries.values());
    group.traverse((o) => {
        if (!o.isMesh) return;
        if (!shared.has(o.geometry)) o.geometry.dispose();
        o.material.dispose();
    });
}
