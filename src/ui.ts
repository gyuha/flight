import { FLAME_STYLES, JET_MODELS, PAINT_SCHEMES } from './models';
import { TIPS } from './tune';
import type {
  GameMode,
  MatchState,
  ProgressionState,
  ScreenState,
  SettingsState,
  WorldId,
} from './types';
import { WORLDS } from './worlds';

export interface UiActions {
  onEnterMenu: () => void;
  onStartMatch: (mode: GameMode, worldId: WorldId) => void;
  onSetScreen: (screen: ScreenState) => void;
  onResume: () => void;
  onQuitToMenu: () => void;
  onUpdateSettings: (patch: Partial<SettingsState>) => void;
  onSelectJet: (modelIdx: number) => void;
  onBuyJet: (modelIdx: number) => void;
  onSelectPaint: (paintIdx: number) => void;
  onSelectFlame: (flameIdx: number) => void;
  onBuyUpgrade: (key: 'engine' | 'hull' | 'weapons') => void;
  onPlayClick: () => void;
}

export class StormUI {
  private selectedMode: GameMode = 'dogfight';
  private selectedWorld: WorldId = 'home-waters';
  private tipIndex = Math.floor(Math.random() * TIPS.length);

  constructor(private root: HTMLElement, private actions: UiActions) {}

  public render(
    screen: ScreenState,
    prog: ProgressionState,
    settings: SettingsState,
    match?: MatchState,
    lastRewards?: { credits: number; xp: number; kills: number }
  ): void {
    this.root.innerHTML = '';

    if (screen === 'playing') {
      return;
    }

    if (screen === 'splash') {
      this.renderSplash();
      return;
    }

    if (screen === 'menu') {
      this.renderMainMenu(prog);
      return;
    }

    if (screen === 'play-setup') {
      this.renderPlaySetup(prog);
      return;
    }

    if (screen === 'hangar') {
      this.renderHangar(prog);
      return;
    }

    if (screen === 'settings') {
      this.renderSettings(settings);
      return;
    }

    if (screen === 'paused') {
      this.renderPaused();
      return;
    }

    if (screen === 'match-over' && match) {
      this.renderMatchOver(match, lastRewards);
    }
  }

  private renderSplash(): void {
    const el = document.createElement('div');
    el.className = 'screen-overlay splash';
    el.innerHTML = `
      <div></div>
      <div class="logo-block">
        <div class="logo-swoosh"></div>
        <div class="logo-title">STORM</div>
        <div class="logo-sub">FIRST LIGHTNING</div>
        <div class="press-any" id="btn-splash-start">PRESS ANY KEY</div>
      </div>
      <div class="tip-box">
        <strong>TIP</strong>
        ${TIPS[this.tipIndex]}
      </div>
    `;
    el.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onEnterMenu();
    });
    this.root.appendChild(el);
  }

  private renderMainMenu(prog: ProgressionState): void {
    const el = document.createElement('div');
    el.className = 'screen-overlay';
    el.innerHTML = `
      <div class="px-panel top-badge">
        <span class="rank">▲ LVL ${prog.level}</span>
        <span>|</span>
        <span class="cash">$ ${prog.credits}</span>
      </div>
      <div class="logo-block">
        <div class="logo-swoosh"></div>
        <div class="logo-title">STORM</div>
        <div class="logo-sub">FIRST LIGHTNING</div>
      </div>
      <div class="menu-bar">
        <div class="menu-buttons">
          <button class="px-btn primary" id="btn-play">SORTIE / PLAY</button>
          <button class="px-btn" id="btn-practice">QUICK PRACTICE</button>
          <button class="px-btn" id="btn-hangar">HANGAR</button>
          <button class="px-btn" id="btn-settings">SETTINGS</button>
        </div>
        <div class="menu-hint">
          <span class="keycap">ENTER</span> SELECT &nbsp;
          <span class="keycap">SPACE</span> CAMERA &nbsp;
          <span class="keycap">SHIFT</span> BOOST
        </div>
      </div>
    `;

    el.querySelector('#btn-play')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onSetScreen('play-setup');
    });
    el.querySelector('#btn-practice')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onStartMatch('practice', 'home-waters');
    });
    el.querySelector('#btn-hangar')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onSetScreen('hangar');
    });
    el.querySelector('#btn-settings')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onSetScreen('settings');
    });

    this.root.appendChild(el);
  }

  private renderPlaySetup(prog: ProgressionState): void {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';

    const modes: { id: GameMode; title: string; desc: string }[] = [
      { id: 'dogfight', title: '8V8 DOGFIGHT', desc: 'Squadron aerial combat to 25 kills' },
      { id: 'boss', title: 'LEVIATHAN RAID', desc: 'Destroy the giant flying dreadnought part by part' },
      { id: 'practice', title: 'FREE PRACTICE', desc: 'Carrier takeoff & skirmish with light resistance' },
    ];

    el.innerHTML = `
      <div class="px-panel modal-card">
        <div class="modal-header">
          <h2>MISSION BRIEFING</h2>
          <span style="font-size:12px;color:var(--accent-gold)">LVL ${prog.level} | $ ${prog.credits}</span>
        </div>

        <div>
          <div style="font-size:11px;letter-spacing:0.15em;color:var(--text-muted);margin-bottom:8px;">GAME MODE</div>
          <div class="grid-cards" id="mode-grid"></div>
        </div>

        <div>
          <div style="font-size:11px;letter-spacing:0.15em;color:var(--text-muted);margin-bottom:8px;">THEATER OF OPERATIONS</div>
          <div class="grid-cards" id="world-grid"></div>
        </div>

        <div class="row-actions">
          <button class="px-btn" id="btn-back">BACK</button>
          <button class="px-btn primary" id="btn-launch">LAUNCH SORTIE</button>
        </div>
      </div>
    `;

    const modeGrid = el.querySelector('#mode-grid')!;
    for (const m of modes) {
      const btn = document.createElement('button');
      btn.className = `select-card ${this.selectedMode === m.id ? 'active' : ''}`;
      btn.innerHTML = `<div class="card-title">${m.title}</div><div class="card-desc">${m.desc}</div>`;
      btn.addEventListener('click', () => {
        this.actions.onPlayClick();
        this.selectedMode = m.id;
        this.renderPlaySetup(prog);
      });
      modeGrid.appendChild(btn);
    }

    const worldGrid = el.querySelector('#world-grid')!;
    for (const w of WORLDS) {
      const btn = document.createElement('button');
      btn.className = `select-card ${this.selectedWorld === w.id ? 'active' : ''}`;
      const swatches = w.swatches.map((s) => `<span class="swatch" style="background:${s}"></span>`).join('');
      btn.innerHTML = `
        <div class="card-title">${w.name.toUpperCase()}</div>
        <div class="card-desc">${w.subtitle}</div>
        <div class="swatch-row">${swatches}</div>
      `;
      btn.addEventListener('click', () => {
        this.actions.onPlayClick();
        this.selectedWorld = w.id;
        this.renderPlaySetup(prog);
      });
      worldGrid.appendChild(btn);
    }

    el.querySelector('#btn-back')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onSetScreen('menu');
    });
    el.querySelector('#btn-launch')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onStartMatch(this.selectedMode, this.selectedWorld);
    });

    this.root.innerHTML = '';
    this.root.appendChild(el);
  }

  private renderHangar(prog: ProgressionState): void {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';

    el.innerHTML = `
      <div class="px-panel modal-card">
        <div class="modal-header">
          <h2>CARRIER HANGAR</h2>
          <span style="font-size:13px;color:var(--accent-gold);font-weight:800;">$ ${prog.credits}</span>
        </div>

        <div>
          <div style="font-size:11px;letter-spacing:0.15em;color:var(--text-muted);margin-bottom:8px;">AIRFRAME</div>
          <div class="grid-cards" id="jet-grid"></div>
        </div>

        <div>
          <div style="font-size:11px;letter-spacing:0.15em;color:var(--text-muted);margin-bottom:8px;">PAINT & AFTERBURNER</div>
          <div class="menu-buttons" style="justify-content:flex-start;gap:8px;margin-bottom:8px;" id="paint-row"></div>
          <div class="menu-buttons" style="justify-content:flex-start;gap:8px;" id="flame-row"></div>
        </div>

        <div>
          <div style="font-size:11px;letter-spacing:0.15em;color:var(--text-muted);margin-bottom:8px;">UPGRADES ($150 EACH)</div>
          <div class="grid-cards" id="upgrade-grid"></div>
        </div>

        <div class="row-actions">
          <button class="px-btn primary" id="btn-back">DONE</button>
        </div>
      </div>
    `;

    const jetGrid = el.querySelector('#jet-grid')!;
    JET_MODELS.forEach((jet, idx) => {
      const unlocked = prog.unlockedModels.includes(idx);
      const active = prog.selectedModel === idx;
      const btn = document.createElement('button');
      btn.className = `select-card ${active ? 'active' : ''}`;
      btn.innerHTML = `
        <div class="card-title">
          <span>${jet.name}</span>
          <span style="color:${unlocked ? 'var(--accent-green)' : 'var(--accent-gold)'}">
            ${active ? 'EQUIPPED' : unlocked ? 'OWNED' : `$${jet.price}`}
          </span>
        </div>
        <div class="card-desc">${jet.role}</div>
        <div style="font-size:10px;color:var(--text-muted)">
          SPD ${Math.round(jet.speedMul * 100)} | TRN ${Math.round(jet.turnMul * 100)} | HULL ${Math.round(jet.hullMul * 100)}
        </div>
      `;
      btn.addEventListener('click', () => {
        this.actions.onPlayClick();
        if (unlocked) this.actions.onSelectJet(idx);
        else this.actions.onBuyJet(idx);
      });
      jetGrid.appendChild(btn);
    });

    const paintRow = el.querySelector('#paint-row')!;
    PAINT_SCHEMES.forEach((p, idx) => {
      const btn = document.createElement('button');
      btn.className = `px-btn small ${prog.selectedPaint === idx ? 'primary' : ''}`;
      btn.textContent = p.name;
      btn.addEventListener('click', () => {
        this.actions.onPlayClick();
        this.actions.onSelectPaint(idx);
      });
      paintRow.appendChild(btn);
    });

    const flameRow = el.querySelector('#flame-row')!;
    FLAME_STYLES.forEach((f, idx) => {
      const btn = document.createElement('button');
      btn.className = `px-btn small ${prog.selectedFlame === idx ? 'primary' : ''}`;
      btn.textContent = f.name;
      btn.addEventListener('click', () => {
        this.actions.onPlayClick();
        this.actions.onSelectFlame(idx);
      });
      flameRow.appendChild(btn);
    });

    const upgGrid = el.querySelector('#upgrade-grid')!;
    const upgs: { key: 'engine' | 'hull' | 'weapons'; label: string; desc: string }[] = [
      { key: 'engine', label: 'ENGINE', desc: '+6% Top & Cruise Speed' },
      { key: 'hull', label: 'ARMOR', desc: '+12% Hull Integrity' },
      { key: 'weapons', label: 'ORDNANCE', desc: '+40 Ammo & Extra Missiles' },
    ];
    for (const u of upgs) {
      const lvl = prog.upgrades[u.key];
      const cost = 150 * (lvl + 1);
      const btn = document.createElement('button');
      btn.className = 'select-card';
      btn.innerHTML = `
        <div class="card-title"><span>${u.label} LV.${lvl}/5</span><span style="color:var(--accent-gold)">${lvl >= 5 ? 'MAX' : `$${cost}`}</span></div>
        <div class="card-desc">${u.desc}</div>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${lvl * 20}%"></div></div>
      `;
      btn.addEventListener('click', () => {
        if (lvl < 5) {
          this.actions.onPlayClick();
          this.actions.onBuyUpgrade(u.key);
        }
      });
      upgGrid.appendChild(btn);
    }

    el.querySelector('#btn-back')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onSetScreen('menu');
    });

    this.root.appendChild(el);
  }

  private renderSettings(settings: SettingsState): void {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    const resLabels = ['HIGH (520p)', 'CRISP (420p)', 'RETRO (320p)'];

    el.innerHTML = `
      <div class="px-panel modal-card">
        <div class="modal-header">
          <h2>SETTINGS</h2>
        </div>

        <div class="setting-row">
          <span>MOUSE FLIGHT STEERING</span>
          <button class="px-btn small ${settings.mouseFlight ? 'primary' : ''}" id="set-mouse">${settings.mouseFlight ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>INVERT PITCH</span>
          <button class="px-btn small ${settings.invertPitch ? 'primary' : ''}" id="set-invert">${settings.invertPitch ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>PIXEL RESOLUTION</span>
          <button class="px-btn small" id="set-res">${resLabels[settings.pixelScale] ?? resLabels[1]}</button>
        </div>
        <div class="setting-row">
          <span>SHOW FPS COUNTER</span>
          <button class="px-btn small ${settings.showFps ? 'primary' : ''}" id="set-fps">${settings.showFps ? 'ON' : 'OFF'}</button>
        </div>
        <div class="setting-row">
          <span>AUDIO VOLUME (${Math.round(settings.soundVolume * 100)}%)</span>
          <input type="range" min="0" max="100" value="${Math.round(settings.soundVolume * 100)}" id="set-vol" style="width:160px;accent-color:#ff7a18;pointer-events:auto;" />
        </div>

        <div class="controls-grid">
          <div class="control-item"><span>Pitch / Roll</span><strong>WASD / Arrows</strong></div>
          <div class="control-item"><span>Boost / Launch</span><strong>Shift</strong></div>
          <div class="control-item"><span>Airbrake</span><strong>X</strong></div>
          <div class="control-item"><span>Cannon</span><strong>C / Left Click</strong></div>
          <div class="control-item"><span>Missile</span><strong>M / Right Click</strong></div>
          <div class="control-item"><span>Flares / Dodge</span><strong>F</strong></div>
          <div class="control-item"><span>Camera View</span><strong>Space</strong></div>
          <div class="control-item"><span>Shield / Turret</span><strong>1 / 2</strong></div>
        </div>

        <div class="row-actions">
          <button class="px-btn primary" id="btn-back">SAVE & BACK</button>
        </div>
      </div>
    `;

    el.querySelector('#set-mouse')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onUpdateSettings({ mouseFlight: !settings.mouseFlight });
    });
    el.querySelector('#set-invert')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onUpdateSettings({ invertPitch: !settings.invertPitch });
    });
    el.querySelector('#set-res')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onUpdateSettings({ pixelScale: (settings.pixelScale + 1) % 3 });
    });
    el.querySelector('#set-fps')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onUpdateSettings({ showFps: !settings.showFps });
    });
    el.querySelector('#set-vol')!.addEventListener('input', (ev) => {
      const val = Number((ev.target as HTMLInputElement).value) / 100;
      this.actions.onUpdateSettings({ soundVolume: val });
    });
    el.querySelector('#btn-back')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onSetScreen('menu');
    });

    this.root.appendChild(el);
  }

  private renderPaused(): void {
    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `
      <div class="px-panel modal-card" style="max-width:400px;text-align:center;">
        <div class="modal-header" style="justify-content:center;">
          <h2>PAUSED</h2>
        </div>
        <button class="px-btn primary" id="btn-resume">RESUME SORTIE</button>
        <button class="px-btn" id="btn-quit">RETURN TO MENU</button>
      </div>
    `;
    el.querySelector('#btn-resume')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onResume();
    });
    el.querySelector('#btn-quit')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onQuitToMenu();
    });
    this.root.appendChild(el);
  }

  private renderMatchOver(
    match: MatchState,
    rewards?: { credits: number; xp: number; kills: number }
  ): void {
    const won = match.winner === 0;
    const draw = match.winner === 'draw';
    const title = draw ? 'STALEMATE' : won ? 'VICTORY' : 'DEFEAT';
    const color = draw ? '#ffd060' : won ? '#58f080' : '#ff5a45';

    const el = document.createElement('div');
    el.className = 'modal-backdrop';
    el.innerHTML = `
      <div class="px-panel modal-card" style="max-width:460px;text-align:center;">
        <h2 style="font-size:32px;letter-spacing:0.2em;color:${color}">${title}</h2>
        <div style="font-size:14px;color:var(--text-muted);">
          BLUE ${match.scoreBlue} — ${match.scoreRed} RED
        </div>
        <div class="px-panel" style="padding:14px;display:flex;justify-content:space-around;">
          <div><div style="font-size:11px;color:var(--text-muted)">KILLS</div><strong style="font-size:20px">${rewards?.kills ?? 0}</strong></div>
          <div><div style="font-size:11px;color:var(--text-muted)">CREDITS</div><strong style="font-size:20px;color:var(--accent-gold)">+$${rewards?.credits ?? 0}</strong></div>
          <div><div style="font-size:11px;color:var(--text-muted)">XP</div><strong style="font-size:20px;color:var(--accent-cyan)">+${rewards?.xp ?? 0}</strong></div>
        </div>
        <div class="row-actions" style="justify-content:center;">
          <button class="px-btn" id="btn-menu">MAIN MENU</button>
          <button class="px-btn primary" id="btn-again">FLY AGAIN</button>
        </div>
      </div>
    `;
    el.querySelector('#btn-menu')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onQuitToMenu();
    });
    el.querySelector('#btn-again')!.addEventListener('click', () => {
      this.actions.onPlayClick();
      this.actions.onStartMatch(match.mode, match.worldId);
    });
    this.root.appendChild(el);
  }
}
