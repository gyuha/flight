import type { Basis, Vec3 } from './types';

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  if (l < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function wrapCoord(v: number, span: number): number {
  return ((v % span) + span) % span;
}

export function wrapDelta(d: number, span: number): number {
  const half = span * 0.5;
  let r = d % span;
  if (r > half) r -= span;
  if (r < -half) r += span;
  return r;
}

export function torusDelta(from: Vec3, to: Vec3, span: number): Vec3 {
  return {
    x: wrapDelta(to.x - from.x, span),
    y: to.y - from.y,
    z: wrapDelta(to.z - from.z, span),
  };
}

export function basisFromHeading(heading: number, pitch = 0): Basis {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const fwd = normalize({
    x: Math.sin(heading) * cp,
    y: sp,
    z: Math.cos(heading) * cp,
  });
  const worldUp = { x: 0, y: 1, z: 0 };
  const right = normalize(cross(worldUp, fwd));
  const up = normalize(cross(fwd, right));
  return { right, up, fwd };
}

export function rotateVecAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const d = dot(axis, v);
  const cr = cross(axis, v);
  return {
    x: v.x * c + cr.x * s + axis.x * d * (1 - c),
    y: v.y * c + cr.y * s + axis.y * d * (1 - c),
    z: v.z * c + cr.z * s + axis.z * d * (1 - c),
  };
}

export function orthonormalizeBasis(b: Basis): Basis {
  const fwd = normalize(b.fwd);
  const right = normalize(cross(b.up, fwd));
  const up = normalize(cross(fwd, right));
  return { right, up, fwd };
}

export function rotateBasis(b: Basis, pitch: number, yaw: number, roll: number): Basis {
  let { right, up, fwd } = b;
  if (Math.abs(roll) > 1e-6) {
    right = rotateVecAroundAxis(right, fwd, roll);
    up = rotateVecAroundAxis(up, fwd, roll);
  }
  if (Math.abs(pitch) > 1e-6) {
    fwd = rotateVecAroundAxis(fwd, right, pitch);
    up = rotateVecAroundAxis(up, right, pitch);
  }
  if (Math.abs(yaw) > 1e-6) {
    fwd = rotateVecAroundAxis(fwd, up, yaw);
    right = rotateVecAroundAxis(right, up, yaw);
  }
  return orthonormalizeBasis({ right, up, fwd });
}

export function basisToLocal(b: Basis, worldVec: Vec3): Vec3 {
  return {
    x: dot(worldVec, b.right),
    y: dot(worldVec, b.up),
    z: dot(worldVec, b.fwd),
  };
}

export function localToWorld(b: Basis, local: Vec3): Vec3 {
  return {
    x: b.right.x * local.x + b.up.x * local.y + b.fwd.x * local.z,
    y: b.right.y * local.x + b.up.y * local.y + b.fwd.y * local.z,
    z: b.right.z * local.x + b.up.z * local.y + b.fwd.z * local.z,
  };
}

// Deterministic tileable 2D hash & FBM noise for toroidal 1024x1024 worlds
function hash2(ix: number, iy: number, period: number, seed: number): number {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function tileNoise2D(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, freq, seed);
  const b = hash2(ix + 1, iy, freq, seed);
  const c = hash2(ix, iy + 1, freq, seed);
  const d = hash2(ix + 1, iy + 1, freq, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

export function tileFbm(
  u: number,
  v: number,
  baseFreq: number,
  octaves: number,
  seed: number
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let i = 0; i < octaves; i++) {
    sum += tileNoise2D(u, v, freq, seed + i * 97) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function tileRidge(
  u: number,
  v: number,
  baseFreq: number,
  octaves: number,
  seed: number
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let i = 0; i < octaves; i++) {
    const n = tileNoise2D(u, v, freq, seed + i * 131);
    const r = 1 - Math.abs(n * 2 - 1);
    sum += r * r * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
