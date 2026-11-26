import type { FlameStyle, JetModelDef, PaintScheme, VoxelCell } from './types';

export const FLAME_STYLES: FlameStyle[] = [
  {
    id: 0,
    name: 'Afterburner',
    colors: [
      [255, 252, 224],
      [255, 210, 96],
      [255, 130, 32],
      [210, 58, 22],
    ],
    trailColor: [230, 240, 252],
  },
  {
    id: 1,
    name: 'Plasma Blue',
    colors: [
      [245, 255, 255],
      [140, 220, 255],
      [64, 150, 255],
      [36, 78, 210],
    ],
    trailColor: [170, 224, 255],
  },
  {
    id: 2,
    name: 'Emerald Pulse',
    colors: [
      [240, 255, 216],
      [120, 245, 100],
      [38, 198, 70],
      [18, 118, 56],
    ],
    trailColor: [180, 255, 195],
  },
  {
    id: 3,
    name: 'Void Violet',
    colors: [
      [252, 228, 255],
      [212, 138, 255],
      [158, 72, 240],
      [82, 42, 160],
    ],
    trailColor: [215, 178, 255],
  },
  {
    id: 4,
    name: 'Solar Gold',
    colors: [
      [255, 255, 232],
      [255, 236, 130],
      [248, 186, 48],
      [188, 110, 24],
    ],
    trailColor: [255, 236, 168],
  },
];

export const PAINT_SCHEMES: PaintScheme[] = [
  {
    id: 'lightning',
    name: 'First Lightning',
    primary: [44, 48, 58],
    secondary: [78, 86, 100],
    accent: [242, 104, 28],
    canopy: [98, 218, 226],
  },
  {
    id: 'cobalt',
    name: 'Sea Falcon',
    primary: [48, 82, 136],
    secondary: [108, 144, 188],
    accent: [245, 206, 68],
    canopy: [120, 240, 255],
  },
  {
    id: 'crimson',
    name: 'Red Baron',
    primary: [164, 38, 42],
    secondary: [68, 34, 40],
    accent: [248, 220, 124],
    canopy: [120, 220, 240],
  },
  {
    id: 'arctic',
    name: 'Frost Ghost',
    primary: [212, 222, 234],
    secondary: [130, 150, 176],
    accent: [46, 156, 242],
    canopy: [62, 92, 138],
  },
  {
    id: 'viper',
    name: 'Jungle Viper',
    primary: [58, 96, 62],
    secondary: [92, 118, 74],
    accent: [242, 168, 44],
    canopy: [124, 234, 218],
  },
];

// Build symmetric voxel fighter jets (local space: +Z forward, +Y up, +X right)
function buildJetVoxels(
  variant: 'lightning' | 'raptor' | 'berkut' | 'striker',
  scheme: PaintScheme
): VoxelCell[] {
  const cells: VoxelCell[] = [];
  const p = scheme.primary;
  const s = scheme.secondary;
  const a = scheme.accent;
  const c = scheme.canopy;
  const dark: [number, number, number] = [28, 30, 38];

  const put = (x: number, y: number, z: number, color: [number, number, number], emissive = false) => {
    cells.push({ x, y, z, color, emissive });
  };
  const sym = (x: number, y: number, z: number, color: [number, number, number], emissive = false) => {
    put(x, y, z, color, emissive);
    if (x !== 0) put(-x, y, z, color, emissive);
  };

  // Fuselage core (-5 .. +6 along Z)
  for (let z = -5; z <= 5; z++) {
    sym(0, 0, z, z > 3 ? s : p);
    if (z >= -4 && z <= 3) sym(1, 0, z, p);
    if (z >= -4 && z <= 1) sym(0, 1, z, s);
  }
  // Sharp nose cone
  put(0, 0, 6, a);
  put(0, 0, 7, s);

  // Canopy glass
  put(0, 1, 2, c);
  put(0, 1, 3, c);
  put(0, 2, 2, c);

  // Twin engine nacelles at rear
  sym(1, 0, -5, dark);
  sym(1, 0, -6, dark);

  if (variant === 'lightning') {
    // Classic swept delta + twin canted orange-tipped tails (STORM cover jet!)
    for (let x = 2; x <= 6; x++) {
      const zBack = -3 - Math.floor((x - 2) * 0.4);
      const zFront = 2 - Math.floor((x - 1) * 0.85);
      for (let z = zBack; z <= zFront; z++) {
        sym(x, 0, z, x >= 5 ? a : p);
      }
    }
    // Wingtip pods
    sym(7, 0, -3, a);
    sym(7, 0, -2, a);
    // Twin canted vertical stabilizers
    sym(2, 1, -4, p);
    sym(2, 2, -5, a);
    sym(3, 3, -5, a);
    // Rear elevators
    sym(2, 0, -5, s);
    sym(3, 0, -5, s);
  } else if (variant === 'raptor') {
    // Broad stealth diamond wings
    for (let x = 2; x <= 6; x++) {
      const zFront = 3 - Math.floor(x * 0.7);
      const zBack = -4 + Math.floor((x - 2) * 0.35);
      for (let z = zBack; z <= zFront; z++) {
        sym(x, 0, z, z === zFront ? s : p);
      }
    }
    sym(2, 1, -4, s);
    sym(2, 2, -5, p);
    sym(3, 2, -5, a);
    sym(3, 0, -5, a);
  } else if (variant === 'berkut') {
    // Forward-swept wings!
    for (let x = 2; x <= 6; x++) {
      const zFront = -1 + Math.floor((x - 1) * 0.75);
      const zBack = -3 + Math.floor((x - 2) * 0.55);
      for (let z = zBack; z <= zFront; z++) {
        sym(x, 0, z, x >= 5 ? a : p);
      }
    }
    // Canards
    sym(2, 0, 3, a);
    sym(3, 0, 3, s);
    // Twin tails
    sym(2, 1, -4, p);
    sym(2, 2, -5, a);
  } else {
    // Striker: wide straight wings + heavy twin boom tail
    for (let x = 2; x <= 7; x++) {
      sym(x, 0, 0, p);
      sym(x, 0, -1, p);
      sym(x, 0, -2, x >= 6 ? a : s);
    }
    sym(3, 1, -5, p);
    sym(3, 2, -5, a);
    sym(2, 0, -5, s);
    sym(3, 0, -5, s);
  }

  return cells;
}

export const JET_MODELS: JetModelDef[] = [
  {
    id: 'lightning',
    name: 'F-19 LIGHTNING',
    role: 'Balanced Multirole',
    speedMul: 1.0,
    turnMul: 1.0,
    hullMul: 1.0,
    price: 0,
    voxels: buildJetVoxels('lightning', PAINT_SCHEMES[0]),
  },
  {
    id: 'raptor',
    name: 'X-22 PHANTOM',
    role: 'High-Speed Interceptor',
    speedMul: 1.12,
    turnMul: 0.96,
    hullMul: 0.95,
    price: 350,
    voxels: buildJetVoxels('raptor', PAINT_SCHEMES[1]),
  },
  {
    id: 'berkut',
    name: 'S-47 BERKUT',
    role: 'Super-Maneuverable',
    speedMul: 0.98,
    turnMul: 1.16,
    hullMul: 0.95,
    price: 600,
    voxels: buildJetVoxels('berkut', PAINT_SCHEMES[2]),
  },
  {
    id: 'striker',
    name: 'A-12 STRIKER',
    role: 'Heavy Gunship',
    speedMul: 0.92,
    turnMul: 0.94,
    hullMul: 1.35,
    price: 850,
    voxels: buildJetVoxels('striker', PAINT_SCHEMES[4]),
  },
];

const paintedJetCache = new Map<string, VoxelCell[]>();

export function getJetVoxels(modelIndex: number, paintIndex: number): VoxelCell[] {
  const mIdx = ((modelIndex % JET_MODELS.length) + JET_MODELS.length) % JET_MODELS.length;
  const pIdx = ((paintIndex % PAINT_SCHEMES.length) + PAINT_SCHEMES.length) % PAINT_SCHEMES.length;
  const key = `${mIdx}:${pIdx}`;
  const cached = paintedJetCache.get(key);
  if (cached) return cached;
  const variant = JET_MODELS[mIdx].id as 'lightning' | 'raptor' | 'berkut' | 'striker';
  const voxels = buildJetVoxels(variant, PAINT_SCHEMES[pIdx]);
  paintedJetCache.set(key, voxels);
  return voxels;
}

// Build aircraft carrier voxel deck for launch & scenic landmark
let carrierVoxelsCache: VoxelCell[] | null = null;
export function getCarrierVoxels(): VoxelCell[] {
  if (carrierVoxelsCache) return carrierVoxelsCache;
  const cells: VoxelCell[] = [];
  const deck: [number, number, number] = [84, 90, 100];
  const lineW: [number, number, number] = [235, 238, 242];
  const lineY: [number, number, number] = [242, 204, 58];
  const hull: [number, number, number] = [56, 62, 74];
  const tower: [number, number, number] = [132, 140, 152];

  // Deck: X in [-7..7], Z in [-22..22] (each voxel scaled by 4.5 world units!)
  for (let z = -22; z <= 22; z++) {
    const halfW = z > 17 ? 5 : z < -18 ? 6 : 7;
    for (let x = -halfW; x <= halfW; x++) {
      let col = deck;
      if (x === 0 && z % 3 !== 0) col = lineW;
      else if (Math.abs(x) === halfW - 1 && z % 2 === 0) col = lineY;
      else if (z === -14 && Math.abs(x) <= 3) col = lineW;
      cells.push({ x, y: 0, z, color: col });
      if (Math.abs(x) === halfW || z === 22 || z === -22) {
        cells.push({ x, y: -1, z, color: hull });
        cells.push({ x, y: -2, z, color: hull });
      }
    }
  }

  // Island / conning tower on starboard (+X) side
  for (let z = -8; z <= 3; z++) {
    for (let x = 5; x <= 7; x++) {
      for (let y = 1; y <= 5; y++) {
        const isWindow = y === 4 && z >= -5 && z <= 1 && x === 5;
        cells.push({ x, y, z, color: isWindow ? [36, 48, 66] : tower });
      }
    }
  }
  // Radar mast
  for (let y = 6; y <= 9; y++) {
    cells.push({ x: 6, y, z: -2, color: [180, 188, 198] });
  }
  cells.push({ x: 5, y: 9, z: -2, color: [240, 96, 36], emissive: true });

  carrierVoxelsCache = cells;
  return cells;
}

// Build Leviathan Boss voxel body (giant armored flying carrier)
let bossVoxelsCache: VoxelCell[] | null = null;
export function getBossVoxels(): VoxelCell[] {
  if (bossVoxelsCache) return bossVoxelsCache;
  const cells: VoxelCell[] = [];
  const dark: [number, number, number] = [42, 46, 56];
  const steel: [number, number, number] = [84, 92, 108];
  const red: [number, number, number] = [215, 52, 42];
  const glow: [number, number, number] = [255, 148, 36];

  for (let z = -10; z <= 10; z++) {
    const hw = Math.max(2, 12 - Math.floor(Math.abs(z) * 0.9));
    for (let x = -hw; x <= hw; x++) {
      const col = Math.abs(x) === hw ? red : (x + z) % 2 === 0 ? dark : steel;
      cells.push({ x, y: 0, z, color: col });
      if (Math.abs(x) < hw - 2 && Math.abs(z) < 6) {
        cells.push({ x, y: 1, z, color: steel });
      }
    }
  }
  // Central reactor core
  cells.push({ x: 0, y: 2, z: 0, color: glow, emissive: true });
  cells.push({ x: 1, y: 2, z: 0, color: glow, emissive: true });
  cells.push({ x: -1, y: 2, z: 0, color: glow, emissive: true });
  bossVoxelsCache = cells;
  return cells;
}
