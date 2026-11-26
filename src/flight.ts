import {
  add,
  basisFromHeading,
  basisToLocal,
  clamp,
  dot,
  len,
  lerp,
  localToWorld,
  normalize,
  rotateBasis,
  scale,
  torusDelta,
  wrapCoord,
} from './math';
import { JET_MODELS } from './models';
import { TUNE } from './tune';
import type {
  BossEntity,
  BulletEntity,
  GameMode,
  InputState,
  JetEntity,
  MatchState,
  MissileEntity,
  Particle,
  ProgressionState,
  SettingsState,
  Team,
  Vec3,
  WorldData,
} from './types';
import { getWorldSpan, sampleTerrainHeight } from './worlds';

export interface SoundCallbacks {
  onCannon: () => void;
  onMissile: () => void;
  onExplosion: (near: boolean) => void;
  onHit: (kill: boolean) => void;
  onFlare: () => void;
  onAbility: () => void;
  onLockTick: (locked: boolean) => void;
  onWarning: () => void;
  onLaunch: () => void;
}

const CALLSIGNS_BLUE = ['VIPER', 'FALCON', 'NOVA', 'TALON', 'KESTREL', 'ECHO', 'SABER', 'BOLT'];
const CALLSIGNS_RED = ['REAPER', 'HYDRA', 'COBRA', 'MANTIS', 'VULTURE', 'RAVEN', 'SPECTER', 'SCORCH'];

export class Simulation {
  public world: WorldData;
  public jets: JetEntity[] = [];
  public bullets: BulletEntity[] = [];
  public missiles: MissileEntity[] = [];
  public particles: Particle[] = [];
  public boss: BossEntity;
  public match: MatchState;

  private nextMissileId = 1;
  private lockBeepTimer = 0;
  private warningBeepTimer = 0;
  private trailTimer = 0;
  private lightningTimer = 7;

  constructor(world: WorldData, mode: GameMode, prog: ProgressionState) {
    this.world = world;
    this.match = {
      mode,
      worldId: world.def.id,
      timeLeft: mode === 'practice' ? 9999 : TUNE.MATCH_SECONDS,
      scoreBlue: 0,
      scoreRed: 0,
      killTarget: mode === 'boss' ? 1 : TUNE.KILL_TARGET,
      winner: null,
      killFeed: [],
      bannerText: 'TAKE OFF',
      bannerSub: 'HOLD SHIFT',
      bannerTimer: 99,
      hitMarkerTimer: 0,
      hitMarkerKill: false,
      damageFlash: 0,
      lightningFlash: 0,
      cameraMode: 'chase',
      showTutorial: false,
      showIntel: false,
      elapsed: 0,
    };

    this.boss = this.createBoss(mode === 'boss');
    this.spawnAllJets(mode, prog);
  }

  public getPlayer(): JetEntity {
    return this.jets[0];
  }

  private createBoss(active: boolean): BossEntity {
    const span = getWorldSpan(this.world);
    return {
      active,
      alive: active,
      pos: { x: span * 0.5, y: 240, z: wrapCoord(span * 0.5 + 1150, span) },
      heading: Math.PI * 0.5,
      speed: 44,
      parts: [
        { id: 'eng-l', label: 'PORT ENGINE', offset: { x: -42, y: 0, z: -20 }, hp: 18, maxHp: 18, destroyed: false, fireCooldown: 1.2 },
        { id: 'eng-r', label: 'STARBOARD ENGINE', offset: { x: 42, y: 0, z: -20 }, hp: 18, maxHp: 18, destroyed: false, fireCooldown: 1.5 },
        { id: 'tur-f', label: 'BOW TURRET', offset: { x: 0, y: 12, z: 34 }, hp: 15, maxHp: 15, destroyed: false, fireCooldown: 0.9 },
        { id: 'core', label: 'REACTOR CORE', offset: { x: 0, y: 14, z: 0 }, hp: 25, maxHp: 25, destroyed: false, fireCooldown: 2.0 },
      ],
    };
  }

  private spawnAllJets(mode: GameMode, prog: ProgressionState): void {
    this.jets = [];
    const span = getWorldSpan(this.world);
    const cp = this.world.carrierPos;

    // Player jet on aircraft carrier deck!
    const playerModel = JET_MODELS[prog.selectedModel % JET_MODELS.length];
    const hullBonus = 1 + prog.upgrades.hull * 0.12;
    const playerMaxHp = Math.round(TUNE.PLAYER_MAX_HP * playerModel.hullMul * hullBonus);

    this.jets.push({
      id: 0,
      name: 'YOU',
      team: 0,
      isPlayer: true,
      modelIndex: prog.selectedModel,
      paintIndex: prog.selectedPaint,
      flameStyle: prog.selectedFlame,
      pos: { x: cp.x, y: cp.y + 5.2, z: cp.z - 42 },
      vel: { x: 0, y: 0, z: 0 },
      basis: basisFromHeading(0, 0),
      speed: 0,
      throttle: 0,
      boost: 1,
      boosting: false,
      braking: false,
      rollRate: 0,
      pitchRate: 0,
      yawRate: 0,
      hp: playerMaxHp,
      maxHp: playerMaxHp,
      ammo: TUNE.GUN_MAX_AMMO + prog.upgrades.weapons * 40,
      maxAmmo: TUNE.GUN_MAX_AMMO + prog.upgrades.weapons * 40,
      ammoReload: 0,
      missiles: TUNE.MISSILE_MAX + Math.floor(prog.upgrades.weapons / 2),
      maxMissiles: TUNE.MISSILE_MAX + Math.floor(prog.upgrades.weapons / 2),
      missileReload: 0,
      fireCooldown: 0,
      missileCooldown: 0,
      flareCooldown: 0,
      dodgeTimer: 0,
      dodgeDir: 1,
      counterWindow: 0,
      stallWarn: 0,
      stalling: false,
      onCarrier: true,
      catapultCharge: 0,
      gearDown: 1,
      alive: true,
      respawnTimer: 0,
      invulnTimer: 3,
      shieldTimer: 0,
      shieldCooldown: 0,
      turretTimer: 0,
      turretCooldown: 0,
      turretFireCd: 0,
      lockTargetId: null,
      lockProgress: 0,
      kills: 0,
      deaths: 0,
      wingTrailL: [],
      wingTrailR: [],
    });

    const allyCount = mode === 'practice' ? 3 : TUNE.TEAM_SIZE - 1;
    const enemyCount = mode === 'practice' ? 4 : mode === 'boss' ? 5 : TUNE.TEAM_SIZE;

    let id = 1;
    for (let i = 0; i < allyCount; i++) {
      this.jets.push(this.createAIJet(id++, CALLSIGNS_BLUE[(i + 1) % CALLSIGNS_BLUE.length], 0, span, i));
    }
    for (let i = 0; i < enemyCount; i++) {
      this.jets.push(this.createAIJet(id++, CALLSIGNS_RED[i % CALLSIGNS_RED.length], 1, span, i));
    }
  }

  private createAIJet(id: number, name: string, team: Team, span: number, slot: number): JetEntity {
    const angle = (slot / 8) * Math.PI * 2 + (team === 1 ? Math.PI : 0);
    const radius = team === 0 ? 450 + slot * 65 : 1150 + slot * 75;
    const px = wrapCoord(this.world.carrierPos.x + Math.sin(angle) * radius, span);
    const pz = wrapCoord(this.world.carrierPos.z + Math.cos(angle) * radius, span);
    const ground = sampleTerrainHeight(this.world, px, pz);
    const py = Math.max(ground + 95, 130 + (slot % 4) * 35);
    const heading = team === 0 ? 0 : Math.PI;
    const basis = basisFromHeading(heading, 0);

    return {
      id,
      name,
      team,
      isPlayer: false,
      modelIndex: slot % JET_MODELS.length,
      paintIndex: team === 0 ? 1 : 2,
      flameStyle: team === 0 ? 1 : 0,
      pos: { x: px, y: py, z: pz },
      vel: scale(basis.fwd, TUNE.CRUISE_SPEED),
      basis,
      speed: TUNE.CRUISE_SPEED,
      throttle: 0.65,
      boost: 1,
      boosting: false,
      braking: false,
      rollRate: 0,
      pitchRate: 0,
      yawRate: 0,
      hp: TUNE.AI_MAX_HP,
      maxHp: TUNE.AI_MAX_HP,
      ammo: TUNE.GUN_MAX_AMMO,
      maxAmmo: TUNE.GUN_MAX_AMMO,
      ammoReload: 0,
      missiles: 4,
      maxMissiles: 4,
      missileReload: 0,
      fireCooldown: Math.random() * 0.5,
      missileCooldown: 3 + Math.random() * 4,
      flareCooldown: 0,
      dodgeTimer: 0,
      dodgeDir: 1,
      counterWindow: 0,
      stallWarn: 0,
      stalling: false,
      onCarrier: false,
      catapultCharge: 0,
      gearDown: 0,
      alive: true,
      respawnTimer: 0,
      invulnTimer: 1.5,
      shieldTimer: 0,
      shieldCooldown: 0,
      turretTimer: 0,
      turretCooldown: 0,
      turretFireCd: 0,
      lockTargetId: null,
      lockProgress: 0,
      kills: 0,
      deaths: 0,
      wingTrailL: [],
      wingTrailR: [],
      aiState: {
        targetId: null,
        decisionTimer: Math.random() * 1.2,
        evadeTimer: 0,
        evadeRoll: 1,
        orbitAngle: Math.random() * Math.PI * 2,
        preferredAlt: 120 + (slot % 4) * 42,
      },
    };
  }

  public activateShield(snd: SoundCallbacks): void {
    const p = this.getPlayer();
    if (!p.alive || p.shieldCooldown > 0) return;
    p.shieldTimer = TUNE.SHIELD_DURATION;
    p.shieldCooldown = TUNE.SHIELD_COOLDOWN;
    this.showBanner('SHIELD ACTIVE', 'ENERGY BARRIER ONLINE', 1.8);
    snd.onAbility();
  }

  public activateTurret(snd: SoundCallbacks): void {
    const p = this.getPlayer();
    if (!p.alive || p.turretCooldown > 0) return;
    p.turretTimer = TUNE.TURRET_DURATION;
    p.turretCooldown = TUNE.TURRET_COOLDOWN;
    this.showBanner('AUTO-TURRET', 'TRACKING NEARBY HOSTILES', 1.8);
    snd.onAbility();
  }

  public showBanner(text: string, sub: string, duration = 2.0): void {
    this.match.bannerText = text;
    this.match.bannerSub = sub;
    this.match.bannerTimer = duration;
  }

  public addKillFeed(text: string, color: string): void {
    this.match.killFeed.unshift({ text, color, age: 0 });
    if (this.match.killFeed.length > 5) this.match.killFeed.pop();
  }

  public hasIncomingMissile(jetId: number): boolean {
    for (const m of this.missiles) {
      if (m.targetId === jetId) return true;
    }
    return false;
  }

  public step(
    dt: number,
    input: InputState,
    settings: SettingsState,
    prog: ProgressionState,
    snd: SoundCallbacks,
    isMenuDemo = false
  ): { matchEnded: boolean; creditsEarned: number; xpEarned: number } {
    const cdt = Math.min(dt, 0.05);
    this.match.elapsed += cdt;

    // Decay HUD timers
    if (this.match.hitMarkerTimer > 0) this.match.hitMarkerTimer = Math.max(0, this.match.hitMarkerTimer - cdt);
    if (this.match.damageFlash > 0) this.match.damageFlash = Math.max(0, this.match.damageFlash - cdt * 2.2);
    if (this.match.lightningFlash > 0) this.match.lightningFlash = Math.max(0, this.match.lightningFlash - cdt * 3.5);
    if (!this.getPlayer().onCarrier && this.match.bannerTimer > 0) {
      this.match.bannerTimer = Math.max(0, this.match.bannerTimer - cdt);
    }

    for (let i = this.match.killFeed.length - 1; i >= 0; i--) {
      this.match.killFeed[i].age += cdt;
      if (this.match.killFeed[i].age > 6.0) this.match.killFeed.splice(i, 1);
    }

    // Weather lightning
    if (this.world.def.lightning) {
      this.lightningTimer -= cdt;
      if (this.lightningTimer <= 0) {
        this.match.lightningFlash = 0.75;
        this.lightningTimer = 5 + Math.random() * 10;
      }
    }

    // Match countdown
    if (!isMenuDemo && this.match.mode !== 'practice' && this.match.winner === null) {
      this.match.timeLeft = Math.max(0, this.match.timeLeft - cdt);
      if (this.match.timeLeft <= 0) {
        this.match.winner =
          this.match.scoreBlue > this.match.scoreRed
            ? 0
            : this.match.scoreRed > this.match.scoreBlue
            ? 1
            : 'draw';
        return this.finishRewards();
      }
    }

    // Update jets
    this.trailTimer += cdt;
    const emitTrail = this.trailTimer >= 0.02;
    if (emitTrail) this.trailTimer = 0;

    for (const jet of this.jets) {
      if (!jet.alive) {
        jet.respawnTimer -= cdt;
        if (jet.respawnTimer <= 0) {
          this.respawnJet(jet);
        }
        continue;
      }
      if (jet.isPlayer && !isMenuDemo) {
        this.updatePlayerJet(jet, cdt, input, settings, prog, snd);
      } else {
        this.updateAIJet(jet, cdt, snd);
      }
      this.updateJetTrails(jet, cdt, emitTrail);
    }

    // Update Leviathan boss
    if (this.boss.active && this.boss.alive) {
      this.updateBoss(cdt);
    }

    // Update bullets, missiles, particles
    this.updateBullets(cdt, snd);
    this.updateMissiles(cdt, snd);
    this.updateParticles(cdt);

    // Check victory conditions
    if (!isMenuDemo && this.match.winner === null) {
      if (this.match.mode === 'dogfight') {
        if (this.match.scoreBlue >= this.match.killTarget) {
          this.match.winner = 0;
          return this.finishRewards();
        }
        if (this.match.scoreRed >= this.match.killTarget) {
          this.match.winner = 1;
          return this.finishRewards();
        }
      } else if (this.match.mode === 'boss' && !this.boss.alive) {
        this.match.winner = 0;
        return this.finishRewards();
      }
    }

    return { matchEnded: false, creditsEarned: 0, xpEarned: 0 };
  }

  private finishRewards(): { matchEnded: boolean; creditsEarned: number; xpEarned: number } {
    const p = this.getPlayer();
    const won = this.match.winner === 0;
    const credits = (won ? 220 : 90) + p.kills * 45;
    const xp = (won ? 180 : 75) + p.kills * 35;
    return { matchEnded: true, creditsEarned: credits, xpEarned: xp };
  }

  private updatePlayerJet(
    jet: JetEntity,
    dt: number,
    input: InputState,
    settings: SettingsState,
    prog: ProgressionState,
    snd: SoundCallbacks
  ): void {
    const span = getWorldSpan(this.world);
    const model = JET_MODELS[jet.modelIndex % JET_MODELS.length];
    const engineMul = 1 + prog.upgrades.engine * 0.06;

    // Carrier catapult launch sequence!
    if (jet.onCarrier) {
      this.match.bannerText = 'TAKE OFF';
      this.match.bannerSub = 'HOLD SHIFT';
      this.match.bannerTimer = 1;
      if (input.boost) {
        jet.catapultCharge = Math.min(1, jet.catapultCharge + dt / TUNE.CAT_CHARGE_TIME);
        jet.boosting = true;
        jet.speed = jet.catapultCharge * TUNE.CAT_LAUNCH_SPEED;
        jet.pos.z = wrapCoord(jet.pos.z + jet.speed * dt, span);
        if (jet.catapultCharge >= 1) {
          jet.onCarrier = false;
          jet.speed = TUNE.CAT_LAUNCH_SPEED;
          jet.basis = basisFromHeading(0, 0.22);
          this.showBanner('AIRBORNE', 'ENGAGE HOSTILES', 1.6);
          snd.onLaunch();
        }
      } else {
        jet.catapultCharge = Math.max(0, jet.catapultCharge - dt * 1.5);
        jet.boosting = false;
        jet.speed = Math.max(0, jet.speed - 120 * dt);
      }
      jet.vel = scale(jet.basis.fwd, jet.speed);
      return;
    }

    // Retract gear after launch
    if (jet.gearDown > 0) {
      jet.gearDown = Math.max(0, jet.gearDown - dt / TUNE.GEAR_UP_TIME);
    }

    // Cooldowns
    if (jet.invulnTimer > 0) jet.invulnTimer = Math.max(0, jet.invulnTimer - dt);
    if (jet.fireCooldown > 0) jet.fireCooldown -= dt;
    if (jet.missileCooldown > 0) jet.missileCooldown -= dt;
    if (jet.flareCooldown > 0) jet.flareCooldown = Math.max(0, jet.flareCooldown - dt);
    if (jet.counterWindow > 0) jet.counterWindow = Math.max(0, jet.counterWindow - dt);
    if (jet.shieldTimer > 0) jet.shieldTimer = Math.max(0, jet.shieldTimer - dt);
    if (jet.shieldCooldown > 0) jet.shieldCooldown = Math.max(0, jet.shieldCooldown - dt);
    if (jet.turretTimer > 0) jet.turretTimer = Math.max(0, jet.turretTimer - dt);
    if (jet.turretCooldown > 0) jet.turretCooldown = Math.max(0, jet.turretCooldown - dt);

    // Ammo & Missile auto-reload
    if (jet.ammo <= 0) {
      jet.ammoReload += dt;
      if (jet.ammoReload >= TUNE.GUN_RELOAD_TIME) {
        jet.ammo = jet.maxAmmo;
        jet.ammoReload = 0;
      }
    }
    if (jet.missiles < jet.maxMissiles) {
      jet.missileReload += dt;
      if (jet.missileReload >= TUNE.MISSILE_RELOAD_TIME) {
        jet.missiles++;
        jet.missileReload = 0;
      }
    }

    // Flares / Snap-Roll Dodge
    if (input.flare && jet.flareCooldown <= 0) {
      jet.flareCooldown = TUNE.FLARE_COOLDOWN;
      jet.dodgeTimer = TUNE.DODGE_DURATION;
      jet.dodgeDir = input.rollLeft ? -1 : 1;
      snd.onFlare();
      // Break all incoming missile locks on player!
      let evaded = false;
      for (const m of this.missiles) {
        if (m.targetId === jet.id) {
          m.targetId = null;
          evaded = true;
        }
      }
      if (evaded) {
        jet.counterWindow = TUNE.COUNTER_WINDOW;
        this.showBanner('EVADED!', 'COUNTER WINDOW OPEN', 1.5);
      }
      // Emit bright decoy flares
      for (let i = 0; i < 6; i++) {
        this.particles.push({
          x: jet.pos.x,
          y: jet.pos.y - 2,
          z: jet.pos.z,
          vx: jet.vel.x * 0.25 + (Math.random() - 0.5) * 45,
          vy: -18 - Math.random() * 14,
          vz: jet.vel.z * 0.25 + (Math.random() - 0.5) * 45,
          color: [255, 240, 175],
          size: 2.2,
          age: 0,
          maxAge: 1.4,
          emissive: true,
        });
      }
    }

    // Flight control inputs
    let rollCmd = (input.rollRight ? 1 : 0) - (input.rollLeft ? 1 : 0);
    let pitchCmd = (input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0);
    if (settings.invertPitch) pitchCmd = -pitchCmd;
    const yawCmd = (input.yawRight ? 1 : 0) - (input.yawLeft ? 1 : 0);

    if (settings.mouseFlight && input.mouseActive) {
      rollCmd = clamp(rollCmd + input.mouseX * 1.25, -1, 1);
      const mp = settings.invertPitch ? input.mouseY : -input.mouseY;
      pitchCmd = clamp(pitchCmd + mp * 1.15, -1, 1);
    }

    if (jet.dodgeTimer > 0) {
      jet.dodgeTimer = Math.max(0, jet.dodgeTimer - dt);
      rollCmd = jet.dodgeDir * 2.2;
    }

    // Smooth angular rates (boost reduces turn rate slightly — "Boost to close in, ease off to turn tighter")
    const turnAgility = model.turnMul * (jet.boosting ? 0.78 : jet.braking ? 1.22 : 1.0);
    const targetRoll = rollCmd * TUNE.ROLL_RATE * turnAgility;
    const targetPitch = pitchCmd * TUNE.PITCH_RATE * turnAgility;
    const targetYaw = yawCmd * TUNE.YAW_RATE;

    jet.rollRate = lerp(jet.rollRate, targetRoll, clamp(dt / TUNE.ROLL_IN, 0, 1));
    jet.pitchRate = lerp(jet.pitchRate, targetPitch, clamp(dt / TUNE.PITCH_IN, 0, 1));
    jet.yawRate = lerp(jet.yawRate, targetYaw, clamp(dt * 8, 0, 1));

    jet.basis = rotateBasis(jet.basis, jet.pitchRate * dt, jet.yawRate * dt, -jet.rollRate * dt);

    // Boost & Airbrake thrust model
    jet.boosting = input.boost && jet.boost > 0.04;
    jet.braking = input.brake && !jet.boosting;

    const topSpeed = TUNE.TOP_SPEED * model.speedMul * engineMul;
    const cruiseSpeed = TUNE.CRUISE_SPEED * model.speedMul * engineMul;

    if (jet.boosting) {
      jet.boost = Math.max(0, jet.boost - TUNE.BOOST_DRAIN * dt);
      jet.speed = Math.min(topSpeed, jet.speed + TUNE.BOOST_ACCEL * dt);
    } else {
      jet.boost = Math.min(1, jet.boost + TUNE.BOOST_REGEN * dt);
      if (jet.braking) {
        jet.speed = Math.max(TUNE.MIN_SPEED, jet.speed - TUNE.BRAKE_DECEL * dt);
      } else {
        jet.speed = lerp(jet.speed, cruiseSpeed, dt * 1.15);
      }
    }

    // Gravity dive acceleration & climb drag + high-G turn drag
    jet.speed -= jet.basis.fwd.y * TUNE.GRAVITY * dt;
    jet.speed -= Math.abs(jet.pitchRate) * TUNE.TURN_DRAG * 0.25 * dt;
    jet.speed = clamp(jet.speed, TUNE.MIN_SPEED * 0.75, topSpeed * 1.08);

    // Stall check
    jet.stalling = jet.speed < TUNE.STALL_SPEED;
    if (jet.stalling) {
      jet.pos.y -= 24 * dt;
      if (this.match.bannerTimer <= 0.1) {
        this.showBanner('TOO SLOW', 'ACCELERATE AND PULL UP', 0.5);
      }
    }

    // Integrate position on toroidal arena
    jet.vel = scale(jet.basis.fwd, jet.speed);
    jet.pos.x = wrapCoord(jet.pos.x + jet.vel.x * dt, span);
    jet.pos.y = clamp(jet.pos.y + jet.vel.y * dt, -2, 680);
    jet.pos.z = wrapCoord(jet.pos.z + jet.vel.z * dt, span);

    // Terrain / Ocean collision
    const terrainH = sampleTerrainHeight(this.world, jet.pos.x, jet.pos.z);
    if (jet.pos.y < Math.max(terrainH + 3.5, 3.5)) {
      if (jet.shieldTimer > 0) {
        // Shield bounces you safely up!
        jet.pos.y = Math.max(terrainH + 14, 14);
        jet.basis = rotateBasis(jet.basis, 0.35, 0, 0);
      } else {
        this.destroyJet(jet, null, snd);
        return;
      }
    }

    // Missile lock-on acquisition
    this.updatePlayerLock(jet, dt, snd);

    // Incoming missile alarm
    if (this.hasIncomingMissile(jet.id)) {
      this.warningBeepTimer -= dt;
      if (this.warningBeepTimer <= 0) {
        this.warningBeepTimer = 0.28;
        snd.onWarning();
      }
    }

    // Vulcan Cannon
    if (input.fireGun && jet.ammo > 0 && jet.fireCooldown <= 0) {
      this.fireCannon(jet, snd);
    }

    // Homing Missile
    if (input.fireMissile && jet.missiles > 0 && jet.missileCooldown <= 0) {
      this.fireMissile(jet, jet.lockProgress >= 1 ? jet.lockTargetId : null, snd);
    }

    // Auto-Turret ability
    if (jet.turretTimer > 0) {
      jet.turretFireCd -= dt;
      if (jet.turretFireCd <= 0) {
        const nearest = this.findNearestHostile(jet, 950);
        if (nearest) {
          jet.turretFireCd = 0.14;
          const d = normalize(torusDelta(jet.pos, nearest.pos, span));
          this.bullets.push({
            x: jet.pos.x,
            y: jet.pos.y + 3,
            z: jet.pos.z,
            vx: d.x * TUNE.GUN_SPEED,
            vy: d.y * TUNE.GUN_SPEED,
            vz: d.z * TUNE.GUN_SPEED,
            team: jet.team,
            ownerId: jet.id,
            life: 0,
            maxLife: 0.9,
          });
        }
      }
    }
  }

  private updatePlayerLock(jet: JetEntity, dt: number, snd: SoundCallbacks): void {
    const span = getWorldSpan(this.world);
    let bestId: number | null = null;
    let bestScore = -1;

    for (const other of this.jets) {
      if (!other.alive || other.team === jet.team) continue;
      const d = torusDelta(jet.pos, other.pos, span);
      const dist = len(d);
      if (dist > TUNE.LOCK_RANGE || dist < 30) continue;
      const dir = scale(d, 1 / dist);
      const align = dot(jet.basis.fwd, dir);
      if (align < 1 - TUNE.LOCK_FOV) continue;
      const score = align * 2 - dist / TUNE.LOCK_RANGE;
      if (score > bestScore) {
        bestScore = score;
        bestId = other.id;
      }
    }

    // Also allow locking onto Boss (id = -1)
    if (bestId === null && this.boss.active && this.boss.alive) {
      const d = torusDelta(jet.pos, this.boss.pos, span);
      const dist = len(d);
      if (dist < TUNE.LOCK_RANGE * 1.25 && dist > 40) {
        const align = dot(jet.basis.fwd, scale(d, 1 / dist));
        if (align > 1 - TUNE.LOCK_FOV * 1.2) {
          bestId = -1;
        }
      }
    }

    if (bestId !== null && bestId === jet.lockTargetId) {
      jet.lockProgress = Math.min(1, jet.lockProgress + dt / TUNE.LOCK_TIME);
      this.lockBeepTimer -= dt;
      if (this.lockBeepTimer <= 0) {
        const locked = jet.lockProgress >= 1;
        this.lockBeepTimer = locked ? 0.14 : 0.3;
        snd.onLockTick(locked);
      }
    } else {
      jet.lockTargetId = bestId;
      jet.lockProgress = 0;
      this.lockBeepTimer = 0.05;
    }
  }

  private updateAIJet(jet: JetEntity, dt: number, snd: SoundCallbacks): void {
    const span = getWorldSpan(this.world);
    const ai = jet.aiState!;
    if (jet.invulnTimer > 0) jet.invulnTimer = Math.max(0, jet.invulnTimer - dt);
    if (jet.fireCooldown > 0) jet.fireCooldown -= dt;
    if (jet.missileCooldown > 0) jet.missileCooldown -= dt;

    ai.decisionTimer -= dt;
    if (ai.decisionTimer <= 0) {
      ai.decisionTimer = 0.8 + Math.random() * 0.8;
      const target = this.findNearestHostile(jet, 2600);
      ai.targetId = target ? target.id : null;
    }

    // Compute desired direction: pursue target or orbit arena center
    let desiredDir: Vec3;
    let targetDist = 9999;
    let targetJet: JetEntity | null = null;
    if (ai.targetId !== null) {
      const t = this.jets.find((j) => j.id === ai.targetId && j.alive);
      if (t) {
        targetJet = t;
        const delta = torusDelta(jet.pos, t.pos, span);
        targetDist = len(delta);
        desiredDir = normalize(delta);
      } else {
        ai.orbitAngle += dt * 0.35;
        desiredDir = normalize({ x: Math.cos(ai.orbitAngle), y: 0, z: Math.sin(ai.orbitAngle) });
      }
    } else {
      ai.orbitAngle += dt * 0.35;
      desiredDir = normalize({ x: Math.cos(ai.orbitAngle), y: 0, z: Math.sin(ai.orbitAngle) });
    }

    // Terrain avoidance override!
    const aheadX = wrapCoord(jet.pos.x + jet.basis.fwd.x * 160, span);
    const aheadZ = wrapCoord(jet.pos.z + jet.basis.fwd.z * 160, span);
    const groundAhead = Math.max(
      sampleTerrainHeight(this.world, jet.pos.x, jet.pos.z),
      sampleTerrainHeight(this.world, aheadX, aheadZ)
    );
    if (jet.pos.y < groundAhead + 55) {
      desiredDir = normalize({ x: desiredDir.x, y: 0.72, z: desiredDir.z });
    } else if (jet.pos.y > 420) {
      desiredDir = normalize({ x: desiredDir.x, y: -0.45, z: desiredDir.z });
    }

    // Convert desired direction into local space to compute pitch & roll
    const local = basisToLocal(jet.basis, desiredDir);
    const rollCmd = clamp(local.x * 2.2, -1, 1);
    const pitchCmd = clamp(local.y * 2.4, -1, 1);
    const yawCmd = clamp(local.x * 0.7, -1, 1);

    jet.basis = rotateBasis(
      jet.basis,
      pitchCmd * TUNE.PITCH_RATE * 0.85 * dt,
      yawCmd * TUNE.YAW_RATE * dt,
      -rollCmd * TUNE.ROLL_RATE * 0.85 * dt
    );

    jet.boosting = targetDist > 650 && targetDist < 1600;
    const targetSpd = jet.boosting ? TUNE.TOP_SPEED * 0.88 : TUNE.CRUISE_SPEED * 0.96;
    jet.speed = lerp(jet.speed, targetSpd, dt * 1.4);
    jet.vel = scale(jet.basis.fwd, jet.speed);
    jet.pos.x = wrapCoord(jet.pos.x + jet.vel.x * dt, span);
    jet.pos.y = clamp(jet.pos.y + jet.vel.y * dt, groundAhead + 18, 520);
    jet.pos.z = wrapCoord(jet.pos.z + jet.vel.z * dt, span);

    // AI weapons firing
    if (targetJet && targetDist < 680 && local.z > 0.94 && jet.fireCooldown <= 0) {
      this.fireCannon(jet, snd);
      jet.fireCooldown = 0.18 + Math.random() * 0.14;
    }
    if (targetJet && targetDist < 1100 && targetDist > 260 && local.z > 0.96 && jet.missileCooldown <= 0) {
      this.fireMissile(jet, targetJet.id, snd);
      jet.missileCooldown = 7 + Math.random() * 6;
    }
  }

  private updateBoss(dt: number): void {
    const span = getWorldSpan(this.world);
    this.boss.heading += dt * 0.08;
    this.boss.pos.x = wrapCoord(this.boss.pos.x + Math.sin(this.boss.heading) * this.boss.speed * dt, span);
    this.boss.pos.z = wrapCoord(this.boss.pos.z + Math.cos(this.boss.heading) * this.boss.speed * dt, span);
    const g = sampleTerrainHeight(this.world, this.boss.pos.x, this.boss.pos.z);
    this.boss.pos.y = lerp(this.boss.pos.y, Math.max(220, g + 115), dt);

    const player = this.getPlayer();
    for (const part of this.boss.parts) {
      if (part.destroyed) continue;
      part.fireCooldown -= dt;
      if (part.fireCooldown <= 0 && player.alive) {
        const d = torusDelta(this.boss.pos, player.pos, span);
        const dist = len(d);
        if (dist < 1100) {
          part.fireCooldown = 1.4 + Math.random() * 1.2;
          const dir = normalize(d);
          this.bullets.push({
            x: this.boss.pos.x,
            y: this.boss.pos.y,
            z: this.boss.pos.z,
            vx: dir.x * 580,
            vy: dir.y * 580,
            vz: dir.z * 580,
            team: 1,
            ownerId: -1,
            life: 0,
            maxLife: 1.8,
          });
        }
      }
    }
  }

  private fireCannon(jet: JetEntity, snd: SoundCallbacks): void {
    jet.fireCooldown = 1 / TUNE.GUN_RATE;
    if (jet.isPlayer) {
      jet.ammo = Math.max(0, jet.ammo - 1);
      snd.onCannon();
    }

    const span = getWorldSpan(this.world);
    let aimDir = jet.basis.fwd;

    // Gentle auto-aim assist for player within GUN_ASSIST_ANGLE
    if (jet.isPlayer) {
      let bestAlign = Math.cos(TUNE.GUN_ASSIST_ANGLE);
      for (const other of this.jets) {
        if (!other.alive || other.team === jet.team) continue;
        const d = torusDelta(jet.pos, other.pos, span);
        const dist = len(d);
        if (dist > 950) continue;
        const t = dist / TUNE.GUN_SPEED;
        const lead = { x: d.x + other.vel.x * t, y: d.y + other.vel.y * t, z: d.z + other.vel.z * t };
        const dir = normalize(lead);
        const a = dot(jet.basis.fwd, dir);
        if (a > bestAlign) {
          bestAlign = a;
          aimDir = dir;
        }
      }
    }

    const side = (jet.ammo % 2 === 0 ? 1 : -1) * 2.2;
    const muzzle = add(jet.pos, localToWorld(jet.basis, { x: side, y: -0.6, z: 6.5 }));
    this.bullets.push({
      x: muzzle.x,
      y: muzzle.y,
      z: muzzle.z,
      vx: aimDir.x * TUNE.GUN_SPEED + jet.vel.x * 0.2,
      vy: aimDir.y * TUNE.GUN_SPEED + jet.vel.y * 0.2,
      vz: aimDir.z * TUNE.GUN_SPEED + jet.vel.z * 0.2,
      team: jet.team,
      ownerId: jet.id,
      life: 0,
      maxLife: TUNE.GUN_LIFE,
    });
  }

  private fireMissile(jet: JetEntity, targetId: number | null, snd: SoundCallbacks): void {
    jet.missileCooldown = 0.55;
    if (jet.isPlayer) {
      jet.missiles = Math.max(0, jet.missiles - 1);
      snd.onMissile();
    }
    const launchPos = add(jet.pos, localToWorld(jet.basis, { x: (jet.missiles % 2 === 0 ? 3.5 : -3.5), y: -1.5, z: 2 }));
    const initSpeed = Math.max(jet.speed + 90, 260);
    this.missiles.push({
      id: this.nextMissileId++,
      x: launchPos.x,
      y: launchPos.y,
      z: launchPos.z,
      vx: jet.basis.fwd.x * initSpeed,
      vy: jet.basis.fwd.y * initSpeed - 8,
      vz: jet.basis.fwd.z * initSpeed,
      team: jet.team,
      ownerId: jet.id,
      targetId,
      age: 0,
      maxLife: TUNE.MISSILE_LIFE,
      damage: jet.counterWindow > 0 ? TUNE.MISSILE_DAMAGE * 1.8 : TUNE.MISSILE_DAMAGE,
      smokeTimer: 0,
    });
  }

  private updateBullets(dt: number, snd: SoundCallbacks): void {
    const span = getWorldSpan(this.world);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life += dt;
      if (b.life >= b.maxLife) {
        this.bullets.splice(i, 1);
        continue;
      }
      b.x = wrapCoord(b.x + b.vx * dt, span);
      b.y += b.vy * dt;
      b.z = wrapCoord(b.z + b.vz * dt, span);

      if (b.y < sampleTerrainHeight(this.world, b.x, b.z)) {
        this.bullets.splice(i, 1);
        continue;
      }

      let hit = false;
      for (const jet of this.jets) {
        if (!jet.alive || jet.team === b.team) continue;
        const d = torusDelta(b, jet.pos, span);
        if (d.x * d.x + d.y * d.y + d.z * d.z < 14 * 14) {
          this.damageJet(jet, TUNE.GUN_DAMAGE, b.ownerId, snd);
          hit = true;
          break;
        }
      }
      if (!hit && this.boss.active && this.boss.alive && b.team === 0) {
        hit = this.checkBossHit(b, TUNE.GUN_DAMAGE, snd);
      }
      if (hit) this.bullets.splice(i, 1);
    }
  }

  private updateMissiles(dt: number, snd: SoundCallbacks): void {
    const span = getWorldSpan(this.world);
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      m.age += dt;
      if (m.age >= m.maxLife) {
        this.missiles.splice(i, 1);
        continue;
      }

      // Guidance toward locked target
      let targetPos: Vec3 | null = null;
      if (m.targetId === -1 && this.boss.active && this.boss.alive) {
        targetPos = this.boss.pos;
      } else if (m.targetId !== null) {
        const tj = this.jets.find((j) => j.id === m.targetId && j.alive);
        if (tj) targetPos = tj.pos;
      }

      let velDir = normalize({ x: m.vx, y: m.vy, z: m.vz });
      if (targetPos && m.age > 0.14) {
        const desired = normalize(torusDelta(m, targetPos, span));
        velDir = normalize({
          x: lerp(velDir.x, desired.x, clamp(dt * TUNE.MISSILE_TURN, 0, 1)),
          y: lerp(velDir.y, desired.y, clamp(dt * TUNE.MISSILE_TURN, 0, 1)),
          z: lerp(velDir.z, desired.z, clamp(dt * TUNE.MISSILE_TURN, 0, 1)),
        });
      }

      const spd = lerp(len({ x: m.vx, y: m.vy, z: m.vz }), TUNE.MISSILE_SPEED, dt * 3);
      m.vx = velDir.x * spd;
      m.vy = velDir.y * spd;
      m.vz = velDir.z * spd;
      m.x = wrapCoord(m.x + m.vx * dt, span);
      m.y += m.vy * dt;
      m.z = wrapCoord(m.z + m.vz * dt, span);

      // Smoke trail
      m.smokeTimer += dt;
      if (m.smokeTimer >= 0.03) {
        m.smokeTimer = 0;
        this.particles.push({
          x: m.x,
          y: m.y,
          z: m.z,
          vx: (Math.random() - 0.5) * 6,
          vy: (Math.random() - 0.5) * 6,
          vz: (Math.random() - 0.5) * 6,
          color: [220, 226, 236],
          size: 1.9,
          age: 0,
          maxAge: 0.75,
          emissive: false,
        });
      }

      if (m.y < sampleTerrainHeight(this.world, m.x, m.z)) {
        this.spawnExplosion(m, 12, snd, false);
        this.missiles.splice(i, 1);
        continue;
      }

      let hit = false;
      for (const jet of this.jets) {
        if (!jet.alive || jet.team === m.team) continue;
        const d = torusDelta(m, jet.pos, span);
        if (d.x * d.x + d.y * d.y + d.z * d.z < 18 * 18) {
          this.damageJet(jet, m.damage, m.ownerId, snd);
          this.spawnExplosion(m, 16, snd, jet.isPlayer || m.ownerId === 0);
          hit = true;
          break;
        }
      }
      if (!hit && this.boss.active && this.boss.alive && m.team === 0) {
        hit = this.checkBossHit(m, m.damage, snd);
        if (hit) this.spawnExplosion(m, 18, snd, true);
      }
      if (hit) this.missiles.splice(i, 1);
    }
  }

  private checkBossHit(pos: Vec3, damage: number, snd: SoundCallbacks): boolean {
    const span = getWorldSpan(this.world);
    const ch = Math.cos(this.boss.heading);
    const sh = Math.sin(this.boss.heading);

    for (const part of this.boss.parts) {
      if (part.destroyed) continue;
      const rx = part.offset.x * ch + part.offset.z * sh;
      const rz = -part.offset.x * sh + part.offset.z * ch;
      const partWorld = {
        x: wrapCoord(this.boss.pos.x + rx, span),
        y: this.boss.pos.y + part.offset.y,
        z: wrapCoord(this.boss.pos.z + rz, span),
      };
      const d = torusDelta(pos, partWorld, span);
      if (d.x * d.x + d.y * d.y + d.z * d.z < 36 * 36) {
        part.hp -= damage;
        this.match.hitMarkerTimer = 0.2;
        this.match.hitMarkerKill = part.hp <= 0;
        snd.onHit(part.hp <= 0);
        if (part.hp <= 0) {
          part.destroyed = true;
          this.spawnExplosion(partWorld, 32, snd, true);
          this.addKillFeed(`YOU DESTROYED ${part.label}`, '#ff9b30');
          this.showBanner(`${part.label} DESTROYED`, 'KEEP PRESSING THE ATTACK', 2.0);
          if (this.boss.parts.every((pt) => pt.destroyed)) {
            this.boss.alive = false;
            this.match.scoreBlue = 1;
            this.spawnExplosion(this.boss.pos, 55, snd, true);
            this.showBanner('LEVIATHAN DOWN!', 'MISSION ACCOMPLISHED', 3.0);
          }
        }
        return true;
      }
    }
    return false;
  }

  private damageJet(target: JetEntity, damage: number, attackerId: number, snd: SoundCallbacks): void {
    if (target.invulnTimer > 0) return;
    if (target.shieldTimer > 0) {
      // Shield absorbs damage
      this.spawnExplosion(target.pos, 6, snd, false);
      return;
    }

    target.hp -= damage;
    if (target.isPlayer) {
      this.match.damageFlash = 0.65;
    }
    if (attackerId === 0) {
      this.match.hitMarkerTimer = 0.18;
      this.match.hitMarkerKill = target.hp <= 0;
      snd.onHit(target.hp <= 0);
    }

    if (target.hp <= 0) {
      const attacker = this.jets.find((j) => j.id === attackerId) ?? null;
      this.destroyJet(target, attacker, snd);
    }
  }

  private destroyJet(target: JetEntity, attacker: JetEntity | null, snd: SoundCallbacks): void {
    target.alive = false;
    target.deaths++;
    target.respawnTimer = TUNE.RESPAWN_TIME;
    target.wingTrailL.length = 0;
    target.wingTrailR.length = 0;

    this.spawnExplosion(target.pos, 28, snd, target.isPlayer || attacker?.isPlayer === true);

    if (this.match.mode === 'dogfight') {
      if (target.team === 1) this.match.scoreBlue++;
      else this.match.scoreRed++;
    }

    if (attacker) {
      attacker.kills++;
      const color = attacker.team === 0 ? '#58d5ff' : '#ff6b57';
      this.addKillFeed(`${attacker.name} ✈ ${target.name}`, color);
      if (attacker.isPlayer) {
        this.showBanner(`SPLASH ${target.name}`, '+45 CREDITS', 1.6);
      }
    } else if (target.isPlayer) {
      this.addKillFeed('YOU CRASHED', '#ff6b57');
      this.showBanner('AIRCRAFT LOST', 'RESPAWNING...', 2.2);
    }
  }

  private respawnJet(jet: JetEntity): void {
    const span = getWorldSpan(this.world);
    jet.alive = true;
    jet.hp = jet.maxHp;
    jet.ammo = jet.maxAmmo;
    jet.missiles = jet.maxMissiles;
    jet.boost = 1;
    jet.invulnTimer = 2.5;
    jet.onCarrier = false;
    jet.gearDown = 0;

    const angle = Math.random() * Math.PI * 2;
    const dist = jet.team === 0 ? 520 : 1200;
    jet.pos.x = wrapCoord(this.world.carrierPos.x + Math.sin(angle) * dist, span);
    jet.pos.z = wrapCoord(this.world.carrierPos.z + Math.cos(angle) * dist, span);
    const g = sampleTerrainHeight(this.world, jet.pos.x, jet.pos.z);
    jet.pos.y = Math.max(g + 120, 175);
    jet.basis = basisFromHeading(jet.team === 0 ? 0 : Math.PI, 0);
    jet.speed = TUNE.CRUISE_SPEED;
    jet.vel = scale(jet.basis.fwd, jet.speed);
  }

  private spawnExplosion(pos: Vec3, count: number, snd: SoundCallbacks, near: boolean): void {
    snd.onExplosion(near);
    const palette: [number, number, number][] = [
      [255, 250, 210],
      [255, 196, 72],
      [246, 102, 28],
      [182, 46, 26],
      [74, 78, 88],
    ];
    for (let i = 0; i < count; i++) {
      const col = palette[Math.floor(Math.random() * palette.length)];
      const spd = 25 + Math.random() * 115;
      const th = Math.random() * Math.PI * 2;
      const ph = (Math.random() - 0.5) * Math.PI;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        z: pos.z,
        vx: Math.cos(th) * Math.cos(ph) * spd,
        vy: Math.sin(ph) * spd + 10,
        vz: Math.sin(th) * Math.cos(ph) * spd,
        color: col,
        size: 2.5 + Math.random() * 3.8,
        age: 0,
        maxAge: 0.45 + Math.random() * 0.65,
        emissive: col[0] > 120,
      });
    }
  }

  private updateParticles(dt: number): void {
    const span = getWorldSpan(this.world);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x = wrapCoord(p.x + p.vx * dt, span);
      p.y += p.vy * dt;
      p.z = wrapCoord(p.z + p.vz * dt, span);
      p.vx *= 1 - dt * 1.2;
      p.vy *= 1 - dt * 1.2;
      p.vz *= 1 - dt * 1.2;
    }
  }

  private updateJetTrails(jet: JetEntity, dt: number, emit: boolean): void {
    const updateList = (list: typeof jet.wingTrailL) => {
      for (let i = list.length - 1; i >= 0; i--) {
        list[i].age += dt;
        if (list[i].age >= list[i].maxAge) list.splice(i, 1);
      }
    };
    updateList(jet.wingTrailL);
    updateList(jet.wingTrailR);

    if (emit && !jet.onCarrier && jet.speed > 115) {
      const span = getWorldSpan(this.world);
      const lTip = add(jet.pos, localToWorld(jet.basis, { x: -7.5, y: 0, z: -2.8 }));
      const rTip = add(jet.pos, localToWorld(jet.basis, { x: 7.5, y: 0, z: -2.8 }));
      const maxAge = jet.boosting ? 0.95 : 0.55;
      jet.wingTrailL.push({ x: wrapCoord(lTip.x, span), y: lTip.y, z: wrapCoord(lTip.z, span), age: 0, maxAge });
      jet.wingTrailR.push({ x: wrapCoord(rTip.x, span), y: rTip.y, z: wrapCoord(rTip.z, span), age: 0, maxAge });
      if (jet.wingTrailL.length > 18) jet.wingTrailL.shift();
      if (jet.wingTrailR.length > 18) jet.wingTrailR.shift();
    }
  }

  private findNearestHostile(jet: JetEntity, maxRange: number): JetEntity | null {
    const span = getWorldSpan(this.world);
    let best: JetEntity | null = null;
    let bestDist = maxRange;
    for (const other of this.jets) {
      if (!other.alive || other.team === jet.team) continue;
      const d = len(torusDelta(jet.pos, other.pos, span));
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }
}
