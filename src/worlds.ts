import { clamp, lerp, normalize, tileFbm, tileNoise2D, tileRidge, wrapCoord } from './math';
import { TUNE } from './tune';
import type { WorldData, WorldDef, WorldId } from './types';

export const WORLDS: WorldDef[] = [
  {
    id: 'home-waters',
    name: 'Home Waters',
    subtitle: 'Tropical archipelago, limestone cliffs & volcanic peak',
    seed: 101,
    skyTop: [0.24, 0.54, 0.86],
    skyHorizon: [0.68, 0.84, 0.95],
    fogColor: [0.64, 0.8, 0.93],
    waterDeep: [0.06, 0.3, 0.58],
    waterShallow: [0.1, 0.55, 0.68],
    sunDir: normalize({ x: 0.45, y: 0.68, z: 0.57 }),
    sunColor: [1.0, 0.96, 0.86],
    cloudColor: [0.92, 0.95, 0.98],
    cloudShadow: [0.56, 0.64, 0.76],
    rain: 0,
    lightning: false,
    swatches: ['#155a9c', '#2ca88e', '#2d7a36', '#8d887a'],
  },
  {
    id: 'red-canyon',
    name: 'Red Canyon',
    subtitle: 'Terracotta mesas, desert spires & canyon river',
    seed: 207,
    skyTop: [0.24, 0.47, 0.78],
    skyHorizon: [0.85, 0.73, 0.6],
    fogColor: [0.8, 0.67, 0.55],
    waterDeep: [0.1, 0.52, 0.62],
    waterShallow: [0.22, 0.68, 0.72],
    sunDir: normalize({ x: -0.52, y: 0.62, z: 0.58 }),
    sunColor: [1.0, 0.88, 0.72],
    cloudColor: [0.96, 0.9, 0.84],
    cloudShadow: [0.66, 0.58, 0.56],
    rain: 0,
    lightning: false,
    swatches: ['#b85426', '#d4823b', '#439c9e', '#6f3218'],
  },
  {
    id: 'storm-front',
    name: 'Storm Front',
    subtitle: 'Squall line, rain sheets & jagged basalt islands',
    seed: 313,
    skyTop: [0.11, 0.16, 0.24],
    skyHorizon: [0.3, 0.37, 0.46],
    fogColor: [0.28, 0.35, 0.44],
    waterDeep: [0.05, 0.14, 0.24],
    waterShallow: [0.1, 0.25, 0.34],
    sunDir: normalize({ x: 0.3, y: 0.45, z: -0.84 }),
    sunColor: [0.76, 0.84, 0.96],
    cloudColor: [0.44, 0.5, 0.58],
    cloudShadow: [0.18, 0.22, 0.3],
    rain: 1.0,
    lightning: true,
    swatches: ['#1d293b', '#3a4c63', '#273a42', '#647687'],
  },
  {
    id: 'iron-strait',
    name: 'Iron Strait',
    subtitle: 'Fortified maritime channel & steep concrete bluffs',
    seed: 419,
    skyTop: [0.26, 0.38, 0.52],
    skyHorizon: [0.68, 0.72, 0.74],
    fogColor: [0.62, 0.67, 0.7],
    waterDeep: [0.08, 0.22, 0.32],
    waterShallow: [0.16, 0.34, 0.42],
    sunDir: normalize({ x: 0.6, y: 0.55, z: 0.58 }),
    sunColor: [0.98, 0.92, 0.84],
    cloudColor: [0.82, 0.84, 0.86],
    cloudShadow: [0.46, 0.5, 0.56],
    rain: 0.25,
    lightning: false,
    swatches: ['#2b3e4f', '#6b7075', '#8f5838', '#44594a'],
  },
  {
    id: 'frost-fjords',
    name: 'Frost Fjords',
    subtitle: 'Glacial peaks, icy channels & crisp arctic air',
    seed: 523,
    skyTop: [0.22, 0.44, 0.72],
    skyHorizon: [0.78, 0.89, 0.97],
    fogColor: [0.75, 0.86, 0.95],
    waterDeep: [0.07, 0.22, 0.42],
    waterShallow: [0.22, 0.48, 0.66],
    sunDir: normalize({ x: -0.4, y: 0.52, z: 0.75 }),
    sunColor: [0.95, 0.97, 1.0],
    cloudColor: [0.95, 0.98, 1.0],
    cloudShadow: [0.62, 0.72, 0.84],
    rain: 0,
    lightning: false,
    swatches: ['#dcebf7', '#7fa1bf', '#264f78', '#425b6e'],
  },
  {
    id: 'black-rock',
    name: 'Black Rock',
    subtitle: 'Obsidian caldera, magma fissures & ash sky',
    seed: 641,
    skyTop: [0.14, 0.1, 0.16],
    skyHorizon: [0.46, 0.22, 0.16],
    fogColor: [0.38, 0.2, 0.17],
    waterDeep: [0.08, 0.09, 0.14],
    waterShallow: [0.2, 0.14, 0.16],
    sunDir: normalize({ x: 0.35, y: 0.4, z: 0.85 }),
    sunColor: [1.0, 0.62, 0.35],
    cloudColor: [0.48, 0.32, 0.3],
    cloudShadow: [0.18, 0.12, 0.15],
    rain: 0,
    lightning: true,
    swatches: ['#201d24', '#4d3a3a', '#e8521a', '#ff9b30'],
  },
];

const worldCache = new Map<WorldId, WorldData>();

export function getWorldDef(id: WorldId): WorldDef {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

export function generateWorld(id: WorldId): WorldData {
  const cached = worldCache.get(id);
  if (cached) return cached;

  const def = getWorldDef(id);
  const size = 512; // 512x512 toroidal grid — super fast generation (<60ms) & crisp voxel look
  const height = new Float32Array(size * size);
  const heightTex = new Uint8Array(size * size);
  const colorTex = new Uint8Array(size * size * 4);

  const seed = def.seed;

  for (let iy = 0; iy < size; iy++) {
    const v = iy / size;
    for (let ix = 0; ix < size; ix++) {
      const u = ix / size;
      const idx = iy * size + ix;

      // Keep a clean open-water channel around center (0.5, 0.5) & along +Z takeoff corridor
      const du = u - 0.5;
      const dv = v - 0.5;
      const centerDist = Math.hypot(du * 1.15, dv > 0 ? dv * 0.55 : dv * 1.15);
      const launchClear = clamp((centerDist - 0.12) / 0.09, 0, 1);

      let h = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      const nBase = tileFbm(u, v, 4, 4, seed);
      const nDetail = tileFbm(u, v, 16, 3, seed + 55);
      const nRidge = tileRidge(u, v, 4, 4, seed + 211);
      const micro = tileNoise2D(u, v, 64, seed + 333);

      if (id === 'home-waters') {
        // Tropical archipelago with stepped cliffs, green jungle, sandy beaches, volcano peak
        let land = (nBase - 0.44) * 2.2 * launchClear;
        // Add one iconic volcanic peak near (0.28, 0.72)
        const vDist = Math.hypot(u - 0.28, v - 0.72);
        const volcano = Math.max(0, 1 - vDist * 6.5);
        land += volcano * volcano * 1.15;

        if (land > 0) {
          // Stepped plateau cliffs
          const cliff = Math.pow(clamp(land, 0, 1.3), 0.78);
          h = cliff * 0.62 + nDetail * 0.08;
          if (volcano > 0.35) h += volcano * 0.28;
          h = clamp(h, 0.01, 0.99);

          if (h > 0.72) {
            // Misty volcano snow/ash cap
            r = 216; g = 228; b = 236;
          } else if (h < 0.045) {
            // Sandy beach
            r = 212; g = 194; b = 146;
          } else if (nDetail > 0.42 && h > 0.14) {
            // Lush tropical canopy
            r = 34 + micro * 24;
            g = 112 + micro * 42;
            b = 38 + micro * 18;
          } else {
            // Limestone cliff rock
            r = 128 + micro * 26;
            g = 122 + micro * 22;
            b = 108 + micro * 18;
          }
        }
      } else if (id === 'red-canyon') {
        // Terracotta mesas, canyon river, dramatic spires
        const riverBand = Math.abs(Math.sin(u * Math.PI * 2) * 0.14 + (v - 0.5));
        const riverCut = clamp((riverBand - 0.045) / 0.07, 0, 1);
        const raw = (nBase * 0.65 + nRidge * 0.45 - 0.26) * riverCut * (0.25 + 0.75 * launchClear);
        if (raw > 0) {
          // Mesa terracing
          const terrace = Math.floor(raw * 6) / 6;
          h = clamp(lerp(raw, terrace, 0.52) * 0.92 + nDetail * 0.06, 0.01, 0.98);
          const strata = Math.sin(h * 38 + nDetail * 4) * 0.5 + 0.5;
          r = lerp(152, 208, strata) + (micro - 0.5) * 18;
          g = lerp(66, 118, strata) + (micro - 0.5) * 14;
          b = lerp(36, 54, strata) + (micro - 0.5) * 10;
          // Sparse desert scrub on mesa tops
          if (micro > 0.78 && h > 0.18) {
            r = 92; g = 114; b = 52;
          }
        }
      } else if (id === 'storm-front') {
        // Sharp jagged dark sea stacks and stormy islands
        const land = (nRidge * 0.7 + nBase * 0.45 - 0.52) * 2.1 * launchClear;
        if (land > 0) {
          h = clamp(Math.pow(land, 1.15) * 0.85 + nDetail * 0.08, 0.01, 0.98);
          r = 56 + h * 40 + micro * 16;
          g = 64 + h * 42 + micro * 16;
          b = 72 + h * 46 + micro * 18;
          if (h > 0.12 && h < 0.32 && nDetail > 0.52) {
            r = 46; g = 74; b = 58;
          }
        }
      } else if (id === 'iron-strait') {
        // Two massive fortified shores flanking a central strait
        const straitDist = Math.abs(u - 0.5);
        const shoreMask = clamp((straitDist - 0.11) / 0.12, 0, 1);
        const land = (shoreMask * (0.55 + nBase * 0.65) - 0.25) * (0.2 + 0.8 * launchClear);
        if (land > 0) {
          const terrace = Math.floor(land * 5) / 5;
          h = clamp(lerp(land, terrace, 0.6) * 0.78 + nDetail * 0.05, 0.01, 0.96);
          if (micro > 0.74 && h > 0.2) {
            // Rust / industrial structures
            r = 148; g = 88; b = 56;
          } else {
            r = 96 + micro * 24;
            g = 104 + micro * 24;
            b = 108 + micro * 22;
          }
        }
      } else if (id === 'frost-fjords') {
        // Deep glacial fjords & snowy alpine peaks
        const land = (nRidge * 0.65 + nBase * 0.5 - 0.44) * 2.1 * launchClear;
        if (land > 0) {
          h = clamp(Math.pow(land, 1.05) * 0.92 + nDetail * 0.06, 0.01, 0.99);
          if (h > 0.24 || micro > 0.55) {
            r = 216 + micro * 26;
            g = 228 + micro * 22;
            b = 240 + micro * 14;
          } else {
            r = 74 + micro * 22;
            g = 94 + micro * 24;
            b = 114 + micro * 24;
          }
        }
      } else {
        // black-rock: obsidian peaks + glowing lava veins
        const land = (nRidge * 0.75 + nBase * 0.4 - 0.47) * 2.2 * launchClear;
        if (land > 0) {
          h = clamp(Math.pow(land, 1.1) * 0.92 + nDetail * 0.06, 0.01, 0.99);
          const lavaCrack = Math.abs(nDetail - 0.5);
          if (lavaCrack < 0.038 && h > 0.08 && h < 0.55) {
            r = 255; g = 112 + micro * 90; b = 24;
          } else {
            r = 34 + micro * 22 + h * 18;
            g = 32 + micro * 18 + h * 14;
            b = 38 + micro * 20 + h * 16;
          }
        }
      }

      height[idx] = h * TUNE.MAX_TERRAIN_H;
      heightTex[idx] = Math.round(clamp(h, 0, 1) * 255);
      const ci = idx * 4;
      colorTex[ci] = clamp(Math.round(r), 0, 255);
      colorTex[ci + 1] = clamp(Math.round(g), 0, 255);
      colorTex[ci + 2] = clamp(Math.round(b), 0, 255);
      colorTex[ci + 3] = h > 0 ? 255 : 0;
    }
  }

  const worldSpan = size * TUNE.WORLD_SCALE;
  const data: WorldData = {
    def,
    size,
    height,
    heightTex,
    colorTex,
    carrierPos: { x: worldSpan * 0.5, y: 12, z: worldSpan * 0.5 },
    carrierHeading: 0,
  };
  worldCache.set(id, data);
  return data;
}

export function getWorldSpan(world: WorldData): number {
  return world.size * TUNE.WORLD_SCALE;
}

export function sampleTerrainHeight(world: WorldData, wx: number, wz: number): number {
  const span = getWorldSpan(world);
  const fx = (wrapCoord(wx, span) / span) * world.size;
  const fz = (wrapCoord(wz, span) / span) * world.size;
  const ix = Math.floor(fx) % world.size;
  const iz = Math.floor(fz) % world.size;
  const ix1 = (ix + 1) % world.size;
  const iz1 = (iz + 1) % world.size;
  const tx = fx - Math.floor(fx);
  const tz = fz - Math.floor(fz);

  const s = world.size;
  const h00 = world.height[iz * s + ix];
  const h10 = world.height[iz * s + ix1];
  const h01 = world.height[iz1 * s + ix];
  const h11 = world.height[iz1 * s + ix1];

  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}
