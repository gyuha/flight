// Flight & combat tuning parameters modeled after STORM: First Lightning
export const TUNE = {
  // World scale
  WORLD_SIZE: 1024,
  WORLD_SCALE: 6.0, // world units per heightmap cell -> 6144x6144 toroidal arena
  MAX_TERRAIN_H: 260,
  WATER_LEVEL: 0,

  // Flight speed & thrust
  CRUISE_SPEED: 145,
  TOP_SPEED: 255,
  MIN_SPEED: 62,
  STALL_SPEED: 74,
  ACCEL_RATE: 82,
  BOOST_ACCEL: 145,
  BRAKE_DECEL: 115,
  GRAVITY: 26,
  TURN_DRAG: 16,

  // Angular rates (rad/s)
  ROLL_RATE: 3.1,
  PITCH_RATE: 1.95,
  YAW_RATE: 0.68,
  ROLL_IN: 0.08,
  PITCH_IN: 0.1,

  // Boost & abilities
  BOOST_DRAIN: 0.34,
  BOOST_REGEN: 0.18,
  SHIELD_DURATION: 6.0,
  SHIELD_COOLDOWN: 18.0,
  TURRET_DURATION: 12.0,
  TURRET_COOLDOWN: 20.0,

  // Carrier catapult launch
  CAT_CHARGE_TIME: 1.15,
  CAT_LAUNCH_SPEED: 165,
  GEAR_UP_TIME: 1.3,

  // Weapons
  GUN_SPEED: 920,
  GUN_LIFE: 1.15,
  GUN_RATE: 16, // shots/sec
  GUN_MAX_AMMO: 300,
  GUN_RELOAD_TIME: 2.6,
  GUN_DAMAGE: 1.0,
  GUN_ASSIST_ANGLE: 0.09, // radians

  MISSILE_SPEED: 430,
  MISSILE_TURN: 3.6,
  MISSILE_LIFE: 5.0,
  MISSILE_MAX: 6,
  MISSILE_RELOAD_TIME: 3.5,
  MISSILE_DAMAGE: 4.5,
  LOCK_RANGE: 1700,
  LOCK_FOV: 0.28, // cos threshold -> ~16 deg cone
  LOCK_TIME: 0.8,

  // Dodge / Flare
  FLARE_COOLDOWN: 4.5,
  DODGE_DURATION: 0.65,
  COUNTER_WINDOW: 1.2,

  // Health & Respawn
  PLAYER_MAX_HP: 10,
  AI_MAX_HP: 6,
  RESPAWN_TIME: 3.2,

  // Match rules
  MATCH_SECONDS: 240,
  KILL_TARGET: 25,
  TEAM_SIZE: 8,
} as const;

export const TIPS = [
  'Boost to close in, ease off to turn tighter',
  'Pull back and roll to turn hard',
  'Hold your fire until the lock turns green',
  'Flares (F) break an incoming missile lock',
  'Press Space to cycle Chase, Cockpit, and Overhead views',
  'Fly low in the canyons to shake a pursuer',
  'Activate Shield [1] or Auto-Turret [2] during heavy dogfights',
  'The Leviathan falls part by part — destroy its engines and turrets',
];
