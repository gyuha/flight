export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Basis {
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
}

export type Team = 0 | 1; // 0 = Blue (Player), 1 = Red (Enemy)
export type CameraMode = 'chase' | 'cockpit' | 'overhead';
export type GameMode = 'dogfight' | 'practice' | 'boss';
export type WorldId =
  | 'home-waters'
  | 'storm-front'
  | 'iron-strait'
  | 'red-canyon'
  | 'frost-fjords'
  | 'black-rock';

export type ScreenState =
  | 'splash'
  | 'menu'
  | 'play-setup'
  | 'hangar'
  | 'settings'
  | 'playing'
  | 'paused'
  | 'match-over';

export interface JetModelDef {
  id: string;
  name: string;
  role: string;
  speedMul: number;
  turnMul: number;
  hullMul: number;
  price: number;
  voxels: VoxelCell[];
}

export interface VoxelCell {
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
  emissive?: boolean;
}

export interface FlameStyle {
  id: number;
  name: string;
  colors: [number, number, number][];
  trailColor: [number, number, number];
}

export interface PaintScheme {
  id: string;
  name: string;
  primary: [number, number, number];
  secondary: [number, number, number];
  accent: [number, number, number];
  canopy: [number, number, number];
}

export interface WorldDef {
  id: WorldId;
  name: string;
  subtitle: string;
  seed: number;
  skyTop: [number, number, number];
  skyHorizon: [number, number, number];
  fogColor: [number, number, number];
  waterDeep: [number, number, number];
  waterShallow: [number, number, number];
  sunDir: Vec3;
  sunColor: [number, number, number];
  cloudColor: [number, number, number];
  cloudShadow: [number, number, number];
  rain: number;
  lightning: boolean;
  swatches: string[];
}

export interface WorldData {
  def: WorldDef;
  size: number;
  height: Float32Array;
  heightTex: Uint8Array;
  colorTex: Uint8Array;
  carrierPos: Vec3;
  carrierHeading: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  z: number;
  age: number;
  maxAge: number;
}

export interface JetEntity {
  id: number;
  name: string;
  team: Team;
  isPlayer: boolean;
  modelIndex: number;
  paintIndex: number;
  flameStyle: number;
  pos: Vec3;
  vel: Vec3;
  basis: Basis;
  speed: number;
  throttle: number;
  boost: number;
  boosting: boolean;
  braking: boolean;
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  hp: number;
  maxHp: number;
  ammo: number;
  maxAmmo: number;
  ammoReload: number;
  missiles: number;
  maxMissiles: number;
  missileReload: number;
  fireCooldown: number;
  missileCooldown: number;
  flareCooldown: number;
  dodgeTimer: number;
  dodgeDir: number;
  counterWindow: number;
  stallWarn: number;
  stalling: boolean;
  onCarrier: boolean;
  catapultCharge: number;
  gearDown: number;
  alive: boolean;
  respawnTimer: number;
  invulnTimer: number;
  shieldTimer: number;
  shieldCooldown: number;
  turretTimer: number;
  turretCooldown: number;
  turretFireCd: number;
  lockTargetId: number | null;
  lockProgress: number;
  kills: number;
  deaths: number;
  wingTrailL: TrailPoint[];
  wingTrailR: TrailPoint[];
  aiState?: {
    targetId: number | null;
    decisionTimer: number;
    evadeTimer: number;
    evadeRoll: number;
    orbitAngle: number;
    preferredAlt: number;
  };
}

export interface BulletEntity {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  team: Team;
  ownerId: number;
  life: number;
  maxLife: number;
}

export interface MissileEntity {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  team: Team;
  ownerId: number;
  targetId: number | null;
  age: number;
  maxLife: number;
  damage: number;
  smokeTimer: number;
}

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: [number, number, number];
  size: number;
  age: number;
  maxAge: number;
  emissive: boolean;
}

export interface BossPart {
  id: string;
  label: string;
  offset: Vec3;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  fireCooldown: number;
}

export interface BossEntity {
  active: boolean;
  pos: Vec3;
  heading: number;
  speed: number;
  parts: BossPart[];
  alive: boolean;
}

export interface KillFeedItem {
  text: string;
  color: string;
  age: number;
}

export interface InputState {
  pitchUp: boolean;
  pitchDown: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  yawLeft: boolean;
  yawRight: boolean;
  boost: boolean;
  brake: boolean;
  fireGun: boolean;
  fireMissile: boolean;
  flare: boolean;
  mouseX: number; // -1..1
  mouseY: number; // -1..1
  mouseActive: boolean;
}

export interface SettingsState {
  mouseFlight: boolean;
  invertPitch: boolean;
  soundVolume: number;
  pixelScale: number; // 1 = sharp (420px), 2 = ultra retro (320px), 0 = high (520px)
  showFps: boolean;
}

export interface ProgressionState {
  level: number;
  xp: number;
  credits: number;
  selectedModel: number;
  selectedPaint: number;
  selectedFlame: number;
  unlockedModels: number[];
  upgrades: {
    engine: number;
    hull: number;
    weapons: number;
  };
}

export interface MatchState {
  mode: GameMode;
  worldId: WorldId;
  timeLeft: number;
  scoreBlue: number;
  scoreRed: number;
  killTarget: number;
  winner: Team | 'draw' | null;
  killFeed: KillFeedItem[];
  bannerText: string;
  bannerSub: string;
  bannerTimer: number;
  hitMarkerTimer: number;
  hitMarkerKill: boolean;
  damageFlash: number;
  lightningFlash: number;
  cameraMode: CameraMode;
  showTutorial: boolean;
  showIntel: boolean;
  elapsed: number;
}
