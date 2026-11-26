import './style.css';
import { StormAudio } from './audio';
import { Simulation, type SoundCallbacks } from './flight';
import { StormHud } from './hud';
import { add, clamp, lerp, localToWorld, normalize, scale } from './math';
import { JET_MODELS } from './models';
import { buildLookBasis, StormRenderer, type CameraState } from './renderer';
import type {
  CameraMode,
  GameMode,
  InputState,
  ProgressionState,
  ScreenState,
  SettingsState,
  WorldId,
} from './types';
import { StormUI } from './ui';
import { generateWorld } from './worlds';

const STORAGE_PROG_KEY = 'storm_prog_v1';
const STORAGE_SET_KEY = 'storm_settings_v1';

function loadProgression(): ProgressionState {
  try {
    const raw = localStorage.getItem(STORAGE_PROG_KEY);
    if (raw) return JSON.parse(raw) as ProgressionState;
  } catch {
    // ignore
  }
  return {
    level: 1,
    xp: 0,
    credits: 150,
    selectedModel: 0,
    selectedPaint: 0,
    selectedFlame: 0,
    unlockedModels: [0],
    upgrades: { engine: 0, hull: 0, weapons: 0 },
  };
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_SET_KEY);
    if (raw) return JSON.parse(raw) as SettingsState;
  } catch {
    // ignore
  }
  return {
    mouseFlight: false,
    invertPitch: false,
    soundVolume: 0.6,
    pixelScale: 1,
    showFps: false,
  };
}

class StormGame {
  private renderer: StormRenderer;
  private hud: StormHud;
  private audio = new StormAudio();
  private ui: StormUI;

  private prog: ProgressionState = loadProgression();
  private settings: SettingsState = loadSettings();
  private screen: ScreenState = 'splash';
  private sim: Simulation;
  private lastRewards?: { credits: number; xp: number; kills: number };

  private input: InputState = {
    pitchUp: false,
    pitchDown: false,
    rollLeft: false,
    rollRight: false,
    yawLeft: false,
    yawRight: false,
    boost: false,
    brake: false,
    fireGun: false,
    fireMissile: false,
    flare: false,
    mouseX: 0,
    mouseY: 0,
    mouseActive: false,
  };

  private cam: CameraState = {
    pos: { x: 1536, y: 120, z: 1500 },
    basis: buildLookBasis({ x: 0, y: 100, z: 0 }, { x: 0, y: 100, z: 100 }),
    fovY: (64 * Math.PI) / 180,
    near: 1.5,
    far: 2600,
  };

  private lastTime = performance.now();
  private elapsed = 0;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private currentFps = 60;

  private soundCallbacks: SoundCallbacks = {
    onCannon: () => this.audio.playCannon(),
    onMissile: () => this.audio.playMissile(),
    onExplosion: (near) => this.audio.playExplosion(near),
    onHit: (kill) => this.audio.playHit(kill),
    onFlare: () => this.audio.playFlare(),
    onAbility: () => this.audio.playAbility(),
    onLockTick: (locked) => this.audio.playLockTick(locked),
    onWarning: () => this.audio.playWarning(),
    onLaunch: () => this.audio.playLaunch(),
  };

  constructor() {
    const glCanvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
    const hudCanvas = document.getElementById('hud-canvas') as HTMLCanvasElement;
    const uiLayer = document.getElementById('ui-layer') as HTMLElement;

    this.renderer = new StormRenderer(glCanvas);
    this.hud = new StormHud(hudCanvas);
    this.audio.setVolume(this.settings.soundVolume);

    // Menu flyover demo runs live over Red Canyon (just like STORM's iconic menu!)
    this.sim = new Simulation(generateWorld('red-canyon'), 'practice', this.prog);
    this.setupMenuDemoFlight();

    this.ui = new StormUI(uiLayer, {
      onEnterMenu: () => {
        this.audio.unlock();
        this.setScreen('menu');
      },
      onStartMatch: (mode, worldId) => this.startMatch(mode, worldId),
      onSetScreen: (scr) => this.setScreen(scr),
      onResume: () => this.setScreen('playing'),
      onQuitToMenu: () => {
        this.sim = new Simulation(generateWorld('red-canyon'), 'practice', this.prog);
        this.setupMenuDemoFlight();
        this.setScreen('menu');
      },
      onUpdateSettings: (patch) => {
        this.settings = { ...this.settings, ...patch };
        localStorage.setItem(STORAGE_SET_KEY, JSON.stringify(this.settings));
        this.audio.setVolume(this.settings.soundVolume);
        this.handleResize();
        this.renderUI();
      },
      onSelectJet: (modelIdx) => {
        this.prog.selectedModel = modelIdx;
        this.saveProg();
        this.renderUI();
      },
      onBuyJet: (modelIdx) => {
        const price = JET_MODELS[modelIdx].price;
        if (this.prog.credits >= price && !this.prog.unlockedModels.includes(modelIdx)) {
          this.prog.credits -= price;
          this.prog.unlockedModels.push(modelIdx);
          this.prog.selectedModel = modelIdx;
          this.saveProg();
          this.renderUI();
        }
      },
      onSelectPaint: (paintIdx) => {
        this.prog.selectedPaint = paintIdx;
        this.saveProg();
        this.renderUI();
      },
      onSelectFlame: (flameIdx) => {
        this.prog.selectedFlame = flameIdx;
        this.saveProg();
        this.renderUI();
      },
      onBuyUpgrade: (key) => {
        const lvl = this.prog.upgrades[key];
        const cost = 150 * (lvl + 1);
        if (lvl < 5 && this.prog.credits >= cost) {
          this.prog.credits -= cost;
          this.prog.upgrades[key] = lvl + 1;
          this.saveProg();
          this.renderUI();
        }
      },
      onPlayClick: () => {
        this.audio.unlock();
        this.audio.playUiClick();
      },
    });

    this.bindEvents();
    this.handleResize();
    this.renderUI();
    requestAnimationFrame((t) => this.loop(t));
  }

  private setupMenuDemoFlight(): void {
    const p = this.sim.getPlayer();
    p.onCarrier = false;
    p.gearDown = 0;
    p.pos.y = 140;
    p.speed = 165;
    p.aiState = {
      targetId: null,
      decisionTimer: 0,
      evadeTimer: 0,
      evadeRoll: 1,
      orbitAngle: 0.4,
      preferredAlt: 135,
    };
  }

  private saveProg(): void {
    localStorage.setItem(STORAGE_PROG_KEY, JSON.stringify(this.prog));
  }

  private setScreen(scr: ScreenState): void {
    this.screen = scr;
    if (scr !== 'playing') {
      this.hud.clear();
      this.audio.updateEngine(false, 0, false);
    }
    this.renderUI();
  }

  private renderUI(): void {
    this.ui.render(this.screen, this.prog, this.settings, this.sim.match, this.lastRewards);
  }

  private startMatch(mode: GameMode, worldId: WorldId): void {
    this.audio.unlock();
    const world = generateWorld(worldId);
    this.sim = new Simulation(world, mode, this.prog);
    const p = this.sim.getPlayer();
    this.cam.pos = { x: p.pos.x, y: p.pos.y + 8, z: p.pos.z - 28 };
    this.cam.basis = buildLookBasis(this.cam.pos, add(p.pos, { x: 0, y: 2, z: 30 }));
    this.setScreen('playing');
  }

  private handleResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.resize(w, h, this.settings.pixelScale);
    this.hud.resize(w, h);
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.handleResize());

    window.addEventListener('keydown', (e) => {
      if (this.screen === 'splash') {
        this.audio.unlock();
        this.audio.playUiClick();
        this.setScreen('menu');
        return;
      }

      if (e.code === 'Escape') {
        if (this.screen === 'playing') {
          this.setScreen('paused');
        } else if (this.screen === 'paused') {
          this.setScreen('playing');
        } else if (this.screen !== 'menu') {
          this.setScreen('menu');
        }
        return;
      }

      if (this.screen === 'menu' && e.code === 'Enter') {
        this.audio.unlock();
        this.audio.playUiClick();
        this.setScreen('play-setup');
        return;
      }

      if (this.screen !== 'playing') return;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.input.pitchDown = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.input.pitchUp = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.input.rollLeft = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.input.rollRight = true;
          break;
        case 'KeyQ':
          this.input.yawLeft = true;
          break;
        case 'KeyE':
          this.input.yawRight = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.input.boost = true;
          break;
        case 'KeyX':
          this.input.brake = true;
          break;
        case 'KeyC':
          this.input.fireGun = true;
          break;
        case 'KeyM':
        case 'KeyR':
          this.input.fireMissile = true;
          break;
        case 'KeyF':
          this.input.flare = true;
          break;
        case 'Space':
          if (!e.repeat) this.cycleCamera();
          break;
        case 'Digit1':
          if (!e.repeat) this.sim.activateShield(this.soundCallbacks);
          break;
        case 'Digit2':
          if (!e.repeat) this.sim.activateTurret(this.soundCallbacks);
          break;
        case 'KeyT':
          if (!e.repeat) {
            this.sim.match.showTutorial = !this.sim.match.showTutorial;
            this.sim.match.showIntel = false;
          }
          break;
        case 'KeyI':
          if (!e.repeat) {
            this.sim.match.showIntel = !this.sim.match.showIntel;
            this.sim.match.showTutorial = false;
          }
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.input.pitchDown = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          this.input.pitchUp = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          this.input.rollLeft = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          this.input.rollRight = false;
          break;
        case 'KeyQ':
          this.input.yawLeft = false;
          break;
        case 'KeyE':
          this.input.yawRight = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.input.boost = false;
          break;
        case 'KeyX':
          this.input.brake = false;
          break;
        case 'KeyC':
          this.input.fireGun = false;
          break;
        case 'KeyM':
        case 'KeyR':
          this.input.fireMissile = false;
          break;
        case 'KeyF':
          this.input.flare = false;
          break;
      }
    });

    window.addEventListener('mousemove', (e) => {
      this.input.mouseX = clamp((e.clientX / Math.max(1, window.innerWidth)) * 2 - 1, -1, 1);
      this.input.mouseY = clamp((e.clientY / Math.max(1, window.innerHeight)) * 2 - 1, -1, 1);
      this.input.mouseActive = true;
    });

    window.addEventListener('mousedown', (e) => {
      if (this.screen !== 'playing') return;
      this.audio.unlock();
      if (e.button === 0) this.input.fireGun = true;
      if (e.button === 2) this.input.fireMissile = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.fireGun = false;
      if (e.button === 2) this.input.fireMissile = false;
    });

    window.addEventListener('contextmenu', (e) => {
      if (this.screen === 'playing') e.preventDefault();
    });
  }

  private cycleCamera(): void {
    const order: CameraMode[] = ['chase', 'cockpit', 'overhead'];
    const idx = order.indexOf(this.sim.match.cameraMode);
    this.sim.match.cameraMode = order[(idx + 1) % order.length];
    this.audio.playUiHover();
  }

  private updateCamera(dt: number, isDemo: boolean): void {
    const p = this.sim.getPlayer();
    const mode = isDemo ? 'chase' : this.sim.match.cameraMode;

    if (mode === 'cockpit') {
      const eye = add(p.pos, localToWorld(p.basis, { x: 0, y: 2.1, z: 3.4 }));
      this.cam.pos = eye;
      this.cam.basis = p.basis;
      this.cam.fovY = lerp(this.cam.fovY, ((p.boosting ? 76 : 66) * Math.PI) / 180, clamp(dt * 6, 0, 1));
      return;
    }

    if (mode === 'overhead') {
      const targetPos = { x: p.pos.x - p.basis.fwd.x * 48, y: p.pos.y + 150, z: p.pos.z - p.basis.fwd.z * 48 };
      this.cam.pos = {
        x: lerp(this.cam.pos.x, targetPos.x, clamp(dt * 8, 0, 1)),
        y: lerp(this.cam.pos.y, targetPos.y, clamp(dt * 8, 0, 1)),
        z: lerp(this.cam.pos.z, targetPos.z, clamp(dt * 8, 0, 1)),
      };
      this.cam.basis = buildLookBasis(this.cam.pos, add(p.pos, scale(p.basis.fwd, 32)), p.basis.fwd);
      this.cam.fovY = (58 * Math.PI) / 180;
      return;
    }

    // Chase Camera (dynamic FOV & smooth chase lag)
    const backDist = p.onCarrier ? 23 : p.boosting ? 28 : 24;
    const upDist = p.onCarrier ? 6.5 : 6.2;
    const desiredPos = add(p.pos, localToWorld(p.basis, { x: 0, y: upDist, z: -backDist }));
    const lookTarget = add(p.pos, localToWorld(p.basis, { x: 0, y: 1.5, z: 42 }));

    const follow = p.onCarrier ? 1 : clamp(dt * 11, 0, 1);
    this.cam.pos = {
      x: lerp(this.cam.pos.x, desiredPos.x, follow),
      y: lerp(this.cam.pos.y, desiredPos.y, follow),
      z: lerp(this.cam.pos.z, desiredPos.z, follow),
    };
    const desiredBasis = buildLookBasis(this.cam.pos, lookTarget, p.basis.up);
    this.cam.basis = {
      right: normalize({
        x: lerp(this.cam.basis.right.x, desiredBasis.right.x, clamp(dt * 10, 0, 1)),
        y: lerp(this.cam.basis.right.y, desiredBasis.right.y, clamp(dt * 10, 0, 1)),
        z: lerp(this.cam.basis.right.z, desiredBasis.right.z, clamp(dt * 10, 0, 1)),
      }),
      up: normalize({
        x: lerp(this.cam.basis.up.x, desiredBasis.up.x, clamp(dt * 10, 0, 1)),
        y: lerp(this.cam.basis.up.y, desiredBasis.up.y, clamp(dt * 10, 0, 1)),
        z: lerp(this.cam.basis.up.z, desiredBasis.up.z, clamp(dt * 10, 0, 1)),
      }),
      fwd: normalize({
        x: lerp(this.cam.basis.fwd.x, desiredBasis.fwd.x, clamp(dt * 10, 0, 1)),
        y: lerp(this.cam.basis.fwd.y, desiredBasis.fwd.y, clamp(dt * 10, 0, 1)),
        z: lerp(this.cam.basis.fwd.z, desiredBasis.fwd.z, clamp(dt * 10, 0, 1)),
      }),
    };
    const targetFov = ((p.boosting ? 76 : 64) * Math.PI) / 180;
    this.cam.fovY = lerp(this.cam.fovY, targetFov, clamp(dt * 5, 0, 1));
  }

  private loop(now: number): void {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.elapsed += dt;

    this.fpsFrames++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }

    const isDemo = this.screen !== 'playing' && this.screen !== 'paused' && this.screen !== 'match-over';

    if (this.screen === 'playing' || isDemo) {
      const outcome = this.sim.step(dt, this.input, this.settings, this.prog, this.soundCallbacks, isDemo);
      if (outcome.matchEnded && this.screen === 'playing') {
        this.prog.credits += outcome.creditsEarned;
        this.prog.xp += outcome.xpEarned;
        while (this.prog.xp >= this.prog.level * 250) {
          this.prog.xp -= this.prog.level * 250;
          this.prog.level++;
        }
        this.saveProg();
        this.lastRewards = {
          credits: outcome.creditsEarned,
          xp: outcome.xpEarned,
          kills: this.sim.getPlayer().kills,
        };
        this.setScreen('match-over');
      }

      this.updateCamera(dt, isDemo);

      const p = this.sim.getPlayer();
      this.audio.updateEngine(
        this.screen === 'playing' && p.alive,
        clamp(p.speed / 255, 0, 1),
        p.boosting
      );
    }

    this.renderer.render(
      this.sim.world,
      this.cam,
      isDemo ? 'chase' : this.sim.match.cameraMode,
      this.sim.jets,
      this.sim.bullets,
      this.sim.missiles,
      this.sim.particles,
      this.sim.boss,
      this.elapsed,
      this.sim.match.damageFlash,
      this.sim.match.lightningFlash
    );

    if (this.screen === 'playing') {
      this.hud.render(this.sim, this.renderer, this.cam, this.settings, this.currentFps, this.elapsed);
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}

new StormGame();
