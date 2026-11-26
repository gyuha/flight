import { drawCockpitOverlay } from './cockpit';
import type { Simulation } from './flight';
import { clamp, torusDelta } from './math';
import type { CameraState, StormRenderer } from './renderer';
import { TUNE } from './tune';
import type { SettingsState } from './types';
import { getWorldSpan } from './worlds';

export class StormHud {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');
    this.ctx = ctx;
  }

  public resize(viewW: number, viewH: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(viewW * dpr));
    this.canvas.height = Math.max(1, Math.floor(viewH * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  public render(
    sim: Simulation,
    renderer: StormRenderer,
    cam: CameraState,
    settings: SettingsState,
    fps: number,
    time: number
  ): void {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    const player = sim.getPlayer();
    const match = sim.match;

    // 1. Cockpit overlay when in cockpit view
    if (match.cameraMode === 'cockpit') {
      drawCockpitOverlay(ctx, w, h, sim, time);
    }

    // 2. 3D Projected Target Diamonds, Lock-on Ring, Boss Parts, Offscreen Chevrons
    this.drawTargets(ctx, sim, renderer, cam, w, h, time);

    // 3. Center Crosshair & Hit Marker (Chase & Overhead)
    if (match.cameraMode !== 'cockpit' && player.alive && !player.onCarrier) {
      this.drawCrosshair(ctx, w * 0.5, h * 0.48, match.hitMarkerTimer, match.hitMarkerKill);
    }

    // 4. Top-Left Radar Minimap
    this.drawMinimap(ctx, sim, 16, 16, 112);

    // 5. Top-Center Scoreboard & Callout Banners
    this.drawTopScoreAndBanners(ctx, sim, w, time);

    // 6. Top-Right Kill Feed & FPS
    this.drawKillFeed(ctx, sim, w, settings.showFps ? fps : 0);

    // 7. Bottom-Left Telemetry Panel (STALL, SPD, ALT, BOOST, AMMO, MSL, HULL)
    this.drawTelemetry(ctx, sim, 16, h - 142);

    // 8. Bottom-Center Ability Cards ([1] SHIELD, [2] TURRET)
    this.drawAbilities(ctx, sim, w * 0.5, h - 66);

    // 9. Bottom-Right Control Hints
    this.drawHints(ctx, w - 16, h - 16, match.cameraMode);

    // 10. Optional Tutorial / Intel Overlays
    if (match.showTutorial) {
      this.drawTutorialBox(ctx, w, h);
    } else if (match.showIntel) {
      this.drawIntelBox(ctx, sim, w, h);
    }
  }

  private drawTargets(
    ctx: CanvasRenderingContext2D,
    sim: Simulation,
    renderer: StormRenderer,
    cam: CameraState,
    w: number,
    h: number,
    time: number
  ): void {
    const player = sim.getPlayer();
    const span = getWorldSpan(sim.world);

    for (const jet of sim.jets) {
      if (!jet.alive || jet.isPlayer) continue;
      const proj = renderer.projectToScreen(jet.pos, cam, span, w, h);
      const isEnemy = jet.team !== player.team;
      const isLockedTarget = player.lockTargetId === jet.id;

      if (proj.inFront && proj.x > 20 && proj.x < w - 20 && proj.y > 20 && proj.y < h - 20) {
        if (!isEnemy && proj.dist > 1400) continue;

        const size = isEnemy ? 13 : 9;
        ctx.save();
        ctx.strokeStyle = isLockedTarget
          ? player.lockProgress >= 1
            ? '#58f080'
            : '#ffd060'
          : isEnemy
          ? '#ff5a45'
          : '#58d5ff';
        ctx.lineWidth = isLockedTarget ? 2.5 : 1.5;

        // Diamond target bracket
        ctx.beginPath();
        ctx.moveTo(proj.x, proj.y - size);
        ctx.lineTo(proj.x + size, proj.y);
        ctx.lineTo(proj.x, proj.y + size);
        ctx.lineTo(proj.x - size, proj.y);
        ctx.closePath();
        ctx.stroke();

        // Lock-on contracting ring
        if (isLockedTarget) {
          const r = 34 - player.lockProgress * 18;
          ctx.beginPath();
          ctx.arc(proj.x, proj.y, r, 0, Math.PI * 2 * player.lockProgress);
          ctx.stroke();
          if (player.lockProgress >= 1) {
            ctx.fillStyle = '#58f080';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('LOCKED [M]', proj.x, proj.y - size - 8);
          }
        }

        // Distance & Name label for enemies
        if (isEnemy) {
          ctx.fillStyle = '#f5efe2';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${jet.name} ${Math.round(proj.dist)}m`, proj.x, proj.y + size + 12);

          // Lead pip when close enough for cannon
          if (proj.dist < 900) {
            const t = proj.dist / TUNE.GUN_SPEED;
            const leadPos = {
              x: jet.pos.x + jet.vel.x * t,
              y: jet.pos.y + jet.vel.y * t,
              z: jet.pos.z + jet.vel.z * t,
            };
            const lp = renderer.projectToScreen(leadPos, cam, span, w, h);
            if (lp.inFront) {
              ctx.strokeStyle = 'rgba(255, 210, 96, 0.85)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(lp.x, lp.y, 5, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
        ctx.restore();
      } else if (isEnemy && proj.dist < 2200) {
        // Edge-of-screen directional chevron for offscreen enemy
        const cx = w * 0.5;
        const cy = h * 0.5;
        let dx = proj.x - cx;
        let dy = proj.y - cy;
        if (!proj.inFront) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const rx = w * 0.44;
        const ry = h * 0.42;
        const ex = cx + Math.cos(ang) * rx;
        const ey = cy + Math.sin(ang) * ry;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.fillStyle = 'rgba(255, 90, 69, 0.85)';
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-5, -5);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Leviathan Boss target marker
    if (sim.boss.active && sim.boss.alive) {
      const bp = renderer.projectToScreen(sim.boss.pos, cam, span, w, h);
      if (bp.inFront) {
        ctx.save();
        ctx.strokeStyle = player.lockTargetId === -1 && player.lockProgress >= 1 ? '#58f080' : '#ff9b30';
        ctx.lineWidth = 2;
        const pulse = 22 + Math.sin(time * 6) * 3;
        ctx.strokeRect(bp.x - pulse, bp.y - pulse * 0.7, pulse * 2, pulse * 1.4);
        ctx.fillStyle = '#ff9b30';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        const rem = sim.boss.parts.filter((p) => !p.destroyed).length;
        ctx.fillText(`LEVIATHAN [${rem}/4] ${Math.round(bp.dist)}m`, bp.x, bp.y - pulse * 0.7 - 6);
        ctx.restore();
      }
    }
  }

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    hitTimer: number,
    isKill: boolean
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 239, 226, 0.78)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5);
    ctx.lineTo(cx, cy + 12);
    ctx.stroke();

    if (hitTimer > 0) {
      ctx.strokeStyle = isKill ? '#ff5247' : '#ffd060';
      ctx.lineWidth = 2.5;
      const d = 10;
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d);
      ctx.lineTo(cx - 4, cy - 4);
      ctx.moveTo(cx + d, cy - d);
      ctx.lineTo(cx + 4, cy - 4);
      ctx.moveTo(cx - d, cy + d);
      ctx.lineTo(cx - 4, cy + 4);
      ctx.moveTo(cx + d, cy + d);
      ctx.lineTo(cx + 4, cy + 4);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMinimap(
    ctx: CanvasRenderingContext2D,
    sim: Simulation,
    x: number,
    y: number,
    size: number
  ): void {
    const player = sim.getPlayer();
    const span = getWorldSpan(sim.world);

    ctx.save();
    ctx.fillStyle = 'rgba(14, 22, 46, 0.86)';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#5c6d82';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, size, size);

    // Subtle radar grid
    ctx.strokeStyle = 'rgba(147, 167, 190, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + size * 0.5, y);
    ctx.lineTo(x + size * 0.5, y + size);
    ctx.moveTo(x, y + size * 0.5);
    ctx.lineTo(x + size, y + size * 0.5);
    ctx.stroke();

    // North marker
    ctx.fillStyle = '#f5efe2';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', x + size * 0.5, y + 11);

    const cx = x + size * 0.5;
    const cy = y + size * 0.5;
    const range = 2200;

    // Carrier silhouette
    const cd = torusDelta(player.pos, sim.world.carrierPos, span);
    if (Math.abs(cd.x) < range && Math.abs(cd.z) < range) {
      const mx = cx + (cd.x / range) * (size * 0.45);
      const my = cy - (cd.z / range) * (size * 0.45);
      ctx.fillStyle = '#6da862';
      ctx.fillRect(mx - 2, my - 6, 4, 12);
    }

    // Jets
    for (const jet of sim.jets) {
      if (!jet.alive || jet.isPlayer) continue;
      const d = torusDelta(player.pos, jet.pos, span);
      const mx = clamp(cx + (d.x / range) * (size * 0.46), x + 4, x + size - 4);
      const my = clamp(cy - (d.z / range) * (size * 0.46), y + 4, y + size - 4);
      ctx.fillStyle = jet.team === 0 ? '#58d5ff' : '#ff5247';
      ctx.fillRect(mx - 2, my - 2, 4, 4);
    }

    // Boss dot
    if (sim.boss.active && sim.boss.alive) {
      const d = torusDelta(player.pos, sim.boss.pos, span);
      const mx = clamp(cx + (d.x / range) * (size * 0.46), x + 5, x + size - 5);
      const my = clamp(cy - (d.z / range) * (size * 0.46), y + 5, y + size - 5);
      ctx.fillStyle = '#ff9b30';
      ctx.fillRect(mx - 4, my - 4, 8, 8);
    }

    // Player arrow at center
    const hdg = Math.atan2(player.basis.fwd.x, player.basis.fwd.z);
    ctx.translate(cx, cy);
    ctx.rotate(hdg);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawTopScoreAndBanners(
    ctx: CanvasRenderingContext2D,
    sim: Simulation,
    w: number,
    time: number
  ): void {
    const match = sim.match;
    const player = sim.getPlayer();
    const cx = w * 0.5;

    ctx.save();
    // Score / Timer pill
    if (match.mode === 'dogfight' || match.mode === 'boss') {
      const bw = 240;
      const bh = 28;
      ctx.fillStyle = 'rgba(16, 24, 52, 0.88)';
      ctx.fillRect(cx - bw * 0.5, 14, bw, bh);
      ctx.strokeStyle = '#5c6d82';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - bw * 0.5, 14, bw, bh);

      const mins = Math.floor(match.timeLeft / 60);
      const secs = Math.floor(match.timeLeft % 60);
      const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      if (match.mode === 'dogfight') {
        ctx.fillStyle = '#58d5ff';
        ctx.fillText(`BLU ${match.scoreBlue}`, cx - 72, 33);
        ctx.fillStyle = '#f5efe2';
        ctx.fillText(timeStr, cx, 33);
        ctx.fillStyle = '#ff5a45';
        ctx.fillText(`RED ${match.scoreRed}`, cx + 72, 33);
      } else {
        const rem = sim.boss.parts.filter((p) => !p.destroyed).length;
        ctx.fillStyle = '#ff9b30';
        ctx.fillText(`LEVIATHAN ${rem}/4  |  ${timeStr}`, cx, 33);
      }
    }

    // Incoming missile urgent warning
    if (player.alive && sim.hasIncomingMissile(player.id)) {
      const blink = Math.floor(time * 10) % 2 === 0;
      if (blink) {
        ctx.fillStyle = 'rgba(220, 38, 38, 0.92)';
        ctx.fillRect(cx - 115, 52, 230, 26);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('! MISSILE INCOMING — [F] FLARE !', cx, 69);
      }
    }

    // Center Callout Banner (TAKE OFF / TOO SLOW / AIRBORNE / SPLASH)
    if (match.bannerTimer > 0 && match.bannerText) {
      const by = 88;
      ctx.fillStyle = 'rgba(16, 24, 52, 0.9)';
      ctx.fillRect(cx - 125, by, 250, 32);
      ctx.strokeStyle = '#93a7be';
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 125, by, 250, 32);

      ctx.fillStyle = '#f5efe2';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(match.bannerText, cx, by + 23);

      if (match.bannerSub) {
        ctx.fillStyle = 'rgba(16, 24, 52, 0.9)';
        ctx.fillRect(cx - 140, by + 36, 280, 24);
        ctx.strokeStyle = '#5c6d82';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx - 140, by + 36, 280, 24);
        ctx.fillStyle = '#ffb040';
        ctx.font = 'bold 13px monospace';
        ctx.fillText(match.bannerSub, cx, by + 53);
      }

      // Catapult 3-light launch bar on carrier!
      if (player.onCarrier) {
        const ly = by + 76;
        ctx.fillStyle = 'rgba(16, 24, 52, 0.9)';
        ctx.fillRect(cx - 48, ly, 96, 28);
        ctx.strokeStyle = '#5c6d82';
        ctx.strokeRect(cx - 48, ly, 96, 28);
        for (let i = 0; i < 3; i++) {
          const lit = player.catapultCharge >= (i + 1) / 3.1;
          ctx.fillStyle = lit ? '#58f080' : '#ff7a18';
          ctx.fillRect(cx - 40 + i * 28, ly + 5, 22, 18);
        }
      }
    }
    ctx.restore();
  }

  private drawKillFeed(ctx: CanvasRenderingContext2D, sim: Simulation, w: number, fps: number): void {
    ctx.save();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'right';
    let y = 26;
    if (fps > 0) {
      ctx.fillStyle = '#9eb0c7';
      ctx.fillText(`${fps} FPS`, w - 16, y);
      y += 18;
    }
    for (const item of sim.match.killFeed) {
      ctx.fillStyle = 'rgba(10, 16, 36, 0.72)';
      ctx.fillRect(w - 220, y - 12, 204, 16);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, w - 22, y);
      y += 19;
    }
    ctx.restore();
  }

  private drawTelemetry(ctx: CanvasRenderingContext2D, sim: Simulation, x: number, y: number): void {
    const p = sim.getPlayer();
    const boxW = 166;
    const boxH = 126;

    ctx.save();
    if (p.stalling) {
      ctx.fillStyle = '#d9342b';
      ctx.fillRect(x, y - 22, boxW, 20);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('STALL', x + boxW * 0.5, y - 8);
    }

    ctx.fillStyle = 'rgba(16, 24, 52, 0.88)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = '#5c6d82';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, boxW, boxH);

    ctx.font = 'bold 12px monospace';
    const row = (label: string, val: string, ry: number, valCol = '#f5efe2') => {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#9eb0c7';
      ctx.fillText(label, x + 10, ry);
      ctx.textAlign = 'right';
      ctx.fillStyle = valCol;
      ctx.fillText(val, x + boxW - 10, ry);
    };

    row('SPD', `${Math.round(p.speed * 3.4)}`, y + 20);
    row('ALT', `${Math.round(p.pos.y * 12)}`, y + 38);

    // BOOST segmented bar
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9eb0c7';
    ctx.fillText('BOOST', x + 10, y + 58);
    const segs = 8;
    const filled = Math.round(p.boost * segs);
    for (let i = 0; i < segs; i++) {
      ctx.fillStyle = i < filled ? '#ff942e' : 'rgba(255,255,255,0.16)';
      ctx.fillRect(x + 76 + i * 10, y + 48, 7, 11);
    }

    // AMMO
    row('AMMO', p.ammo > 0 ? `${p.ammo}` : 'RELOAD', y + 78, p.ammo > 0 ? '#f5efe2' : '#ffd060');

    // MSL icons
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9eb0c7';
    ctx.fillText('MSL', x + 10, y + 98);
    for (let i = 0; i < p.maxMissiles; i++) {
      ctx.fillStyle = i < p.missiles ? '#f5efe2' : 'rgba(255,255,255,0.16)';
      ctx.fillRect(x + boxW - 14 - i * 9, y + 87, 5, 12);
    }

    // HULL bar
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9eb0c7';
    ctx.fillText('HULL', x + 10, y + 116);
    const hpRatio = clamp(p.hp / p.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x + 62, y + 107, 94, 10);
    ctx.fillStyle = p.shieldTimer > 0 ? '#58d5ff' : hpRatio > 0.45 ? '#58f080' : '#ff4747';
    ctx.fillRect(x + 62, y + 107, Math.round(94 * hpRatio), 10);

    ctx.restore();
  }

  private drawAbilities(ctx: CanvasRenderingContext2D, sim: Simulation, cx: number, y: number): void {
    const p = sim.getPlayer();
    const drawCard = (
      x: number,
      key: string,
      name: string,
      activeTimer: number,
      cdTimer: number
    ) => {
      const cw = 92;
      const ch = 48;
      const ready = cdTimer <= 0;
      ctx.save();
      ctx.fillStyle = activeTimer > 0
        ? 'rgba(40, 130, 190, 0.85)'
        : ready
        ? 'rgba(130, 68, 22, 0.85)'
        : 'rgba(16, 24, 52, 0.85)';
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = activeTimer > 0 ? '#58d5ff' : ready ? '#ffaa44' : '#5c6d82';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cw, ch);

      ctx.fillStyle = '#f5efe2';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(name, x + cw * 0.5, y + 18);

      ctx.fillStyle = activeTimer > 0 ? '#b8f0ff' : ready ? '#ffd060' : '#9eb0c7';
      ctx.font = 'bold 11px monospace';
      const status = activeTimer > 0
        ? `${activeTimer.toFixed(1)}S`
        : ready
        ? `[${key}] READY`
        : `${Math.ceil(cdTimer)}S`;
      ctx.fillText(status, x + cw * 0.5, y + 36);
      ctx.restore();
    };

    drawCard(cx - 98, '1', 'SHIELD', p.shieldTimer, p.shieldCooldown);
    drawCard(cx + 6, '2', 'TURRET', p.turretTimer, p.turretCooldown);
  }

  private drawHints(ctx: CanvasRenderingContext2D, rightX: number, bottomY: number, camMode: string): void {
    const bw = 205;
    const bh = 44;
    const x = rightX - bw;
    const y = bottomY - bh;
    ctx.save();
    ctx.fillStyle = 'rgba(16, 24, 52, 0.86)';
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = '#5c6d82';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bw, bh);

    ctx.fillStyle = '#f5efe2';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`[SPACE] CAM:${camMode.toUpperCase()}  [T] HELP`, rightX - 8, y + 17);
    ctx.fillText(`[ESC] MENU   [I] INTEL`, rightX - 8, y + 34);
    ctx.restore();
  }

  private drawTutorialBox(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const bw = 380;
    const bh = 225;
    const x = w * 0.5 - bw * 0.5;
    const y = h * 0.5 - bh * 0.5;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 18, 40, 0.94)';
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = '#ff7a18';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bw, bh);

    ctx.fillStyle = '#ff7a18';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FLIGHT CONTROLS [T TO CLOSE]', x + 16, y + 26);

    const lines = [
      'W/S or UP/DOWN     Pitch Nose Down / Up',
      'A/D or LEFT/RIGHT  Roll Bank Left / Right',
      'Q / E              Rudder Yaw',
      'SHIFT              Afterburner / Carrier Launch',
      'X                  Airbrake (Tighter Turn)',
      'C or LEFT CLICK    Vulcan Cannon',
      'M or RIGHT CLICK   Homing Missile (Wait for Lock)',
      'F                  Deploy Flares / Evade Roll',
      'SPACE              Switch Camera (Chase/Cockpit/Top)',
      '1 / 2              Shield / Auto-Turret Abilities',
    ];
    ctx.fillStyle = '#f5efe2';
    ctx.font = '11px monospace';
    lines.forEach((line, idx) => {
      ctx.fillText(line, x + 16, y + 50 + idx * 16);
    });
    ctx.restore();
  }

  private drawIntelBox(ctx: CanvasRenderingContext2D, sim: Simulation, w: number, h: number): void {
    const bw = 340;
    const bh = 210;
    const x = w * 0.5 - bw * 0.5;
    const y = h * 0.5 - bh * 0.5;
    ctx.save();
    ctx.fillStyle = 'rgba(12, 18, 40, 0.94)';
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeStyle = '#58d5ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bw, bh);

    ctx.fillStyle = '#58d5ff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`SQUADRON INTEL — ${sim.world.def.name.toUpperCase()}`, x + 14, y + 26);

    const sorted = [...sim.jets].sort((a, b) => b.kills - a.kills).slice(0, 8);
    ctx.font = '11px monospace';
    sorted.forEach((j, idx) => {
      const ry = y + 50 + idx * 18;
      ctx.fillStyle = j.team === 0 ? '#58d5ff' : '#ff6b57';
      ctx.fillText(`${j.name.padEnd(10)}  K:${j.kills}  D:${j.deaths}  ${j.alive ? 'AIR' : 'KIA'}`, x + 16, ry);
    });
    ctx.restore();
  }
}
