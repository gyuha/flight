import { clamp, torusDelta } from './math';
import type { Simulation } from './flight';
import { getWorldSpan } from './worlds';

export function drawCockpitOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sim: Simulation,
  time: number
): void {
  const player = sim.getPlayer();
  const pitch = Math.asin(clamp(player.basis.fwd.y, -1, 1));
  const roll = Math.atan2(player.basis.right.y, player.basis.up.y);
  const heading = (Math.atan2(player.basis.fwd.x, player.basis.fwd.z) * 180) / Math.PI;
  const hdgDeg = ((Math.round(heading) % 360) + 360) % 360;

  ctx.save();

  // 1. Canopy Arch Frame (dark steel + orange accents like STORM cockpit)
  ctx.lineWidth = Math.max(10, Math.round(w * 0.016));
  ctx.strokeStyle = '#141926';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.62, Math.min(w * 0.56, h * 0.68), Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  ctx.lineWidth = Math.max(6, Math.round(w * 0.01));
  ctx.strokeStyle = '#485366';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.62, Math.min(w * 0.56, h * 0.68), Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();

  // Orange canopy stripe segments
  ctx.strokeStyle = '#ff7a18';
  ctx.lineWidth = Math.max(5, Math.round(w * 0.008));
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.62, Math.min(w * 0.56, h * 0.68), Math.PI * 1.18, Math.PI * 1.32);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.62, Math.min(w * 0.56, h * 0.68), Math.PI * 1.68, Math.PI * 1.82);
  ctx.stroke();

  // 2. Green Collimated HUD Glass (Pitch ladder, heading tape, center pipper)
  const cx = w * 0.5;
  const cy = h * 0.42;
  ctx.strokeStyle = 'rgba(92, 248, 152, 0.78)';
  ctx.fillStyle = 'rgba(92, 248, 152, 0.85)';
  ctx.lineWidth = 2;

  // Heading tape
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(hdgDeg.toString().padStart(3, '0'), cx, cy - 86);
  ctx.beginPath();
  ctx.moveTo(cx - 75, cy - 76);
  ctx.lineTo(cx + 75, cy - 76);
  ctx.stroke();

  // Rotating pitch ladder
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-roll);
  const pitchOffset = (pitch * 180) / Math.PI * 3.2;
  for (let deg = -30; deg <= 30; deg += 10) {
    const py = pitchOffset - deg * 3.2;
    if (Math.abs(py) > 70) continue;
    const hw = deg === 0 ? 52 : 28;
    ctx.beginPath();
    ctx.moveTo(-hw, py);
    ctx.lineTo(-10, py);
    ctx.moveTo(10, py);
    ctx.lineTo(hw, py);
    ctx.stroke();
  }
  ctx.restore();

  // Center reticle
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.moveTo(cx - 16, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.moveTo(cx + 8, cy);
  ctx.lineTo(cx + 16, cy);
  ctx.stroke();

  // 3. Lower Instrument Dashboard Panel
  const dashY = Math.round(h * 0.66);
  const dashH = h - dashY;
  ctx.fillStyle = '#252b38';
  ctx.fillRect(0, dashY, w, dashH);
  ctx.fillStyle = '#4c566a';
  ctx.fillRect(0, dashY, w, 5);
  ctx.fillStyle = '#121622';
  ctx.fillRect(0, dashY + 5, w, 3);

  // Left MFD: Green Radar Scope
  const mfdW = Math.min(200, Math.round(w * 0.22));
  const mfdH = Math.min(130, dashH - 22);
  const leftX = Math.round(w * 0.03);
  const mfdY = dashY + 14;

  ctx.fillStyle = '#071b16';
  ctx.fillRect(leftX, mfdY, mfdW, mfdH);
  ctx.strokeStyle = '#5c6d82';
  ctx.lineWidth = 3;
  ctx.strokeRect(leftX, mfdY, mfdW, mfdH);

  const rcx = leftX + mfdW * 0.5;
  const rcy = mfdY + mfdH * 0.5;
  const rRad = Math.min(mfdW, mfdH) * 0.42;
  ctx.strokeStyle = 'rgba(64, 210, 124, 0.35)';
  ctx.lineWidth = 1;
  for (const frac of [0.35, 0.68, 1.0]) {
    ctx.beginPath();
    ctx.arc(rcx, rcy, rRad * frac, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Sweeping radar line
  const sweep = (time * 2.4) % (Math.PI * 2);
  ctx.strokeStyle = 'rgba(92, 255, 160, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rcx, rcy);
  ctx.lineTo(rcx + Math.cos(sweep) * rRad, rcy + Math.sin(sweep) * rRad);
  ctx.stroke();

  // Plot blips relative to player heading
  const span = getWorldSpan(sim.world);
  const pHdg = Math.atan2(player.basis.fwd.x, player.basis.fwd.z);
  const cosH = Math.cos(pHdg);
  const sinH = Math.sin(pHdg);
  for (const jet of sim.jets) {
    if (!jet.alive || jet.isPlayer) continue;
    const d = torusDelta(player.pos, jet.pos, span);
    const rx = (d.x * cosH - d.z * sinH) / 1800;
    const rz = (d.x * sinH + d.z * cosH) / 1800;
    if (Math.hypot(rx, rz) > 0.95) continue;
    ctx.fillStyle = jet.team === 0 ? '#58d5ff' : '#ff5247';
    ctx.fillRect(rcx + rx * rRad - 2, rcy - rz * rRad - 2, 4, 4);
  }

  // Center Attitude Indicator (Artificial Horizon)
  const aiR = Math.min(54, dashH * 0.38);
  const aiX = w * 0.5;
  const aiY = dashY + dashH * 0.48;
  ctx.save();
  ctx.beginPath();
  ctx.arc(aiX, aiY, aiR, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(aiX, aiY);
  ctx.rotate(-roll);
  const horY = clamp(pitch * aiR * 1.4, -aiR, aiR);
  ctx.fillStyle = '#4d9de0';
  ctx.fillRect(-aiR * 1.5, -aiR * 1.5, aiR * 3, aiR * 1.5 + horY);
  ctx.fillStyle = '#9c5a2c';
  ctx.fillRect(-aiR * 1.5, horY, aiR * 3, aiR * 2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-aiR, horY);
  ctx.lineTo(aiR, horY);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#8b9bb0';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(aiX, aiY, aiR, 0, Math.PI * 2);
  ctx.stroke();
  // Fixed center orange pip
  ctx.fillStyle = '#ff7a18';
  ctx.fillRect(aiX - 10, aiY - 1, 20, 3);

  // Right MFD: Aircraft Systems & Hull/Boost Bars
  const rightX = w - leftX - mfdW;
  ctx.fillStyle = '#071b16';
  ctx.fillRect(rightX, mfdY, mfdW, mfdH);
  ctx.strokeStyle = '#5c6d82';
  ctx.lineWidth = 3;
  ctx.strokeRect(rightX, mfdY, mfdW, mfdH);

  ctx.fillStyle = '#58f080';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`ALT ${Math.round(player.pos.y * 12).toString().padStart(5, '0')}`, rightX + 10, mfdY + 20);
  ctx.fillText(`SPD ${Math.round(player.speed * 3.4).toString().padStart(4, '0')}`, rightX + 10, mfdY + mfdH - 12);

  // Jet status silhouette
  const sx = rightX + mfdW * 0.42;
  const sy = mfdY + mfdH * 0.54;
  const hpRatio = clamp(player.hp / player.maxHp, 0, 1);
  ctx.fillStyle = hpRatio > 0.5 ? '#32d968' : hpRatio > 0.25 ? '#f5b82e' : '#ff4747';
  ctx.beginPath();
  ctx.moveTo(sx, sy - 26);
  ctx.lineTo(sx + 24, sy + 12);
  ctx.lineTo(sx + 6, sy + 12);
  ctx.lineTo(sx + 10, sy + 24);
  ctx.lineTo(sx - 10, sy + 24);
  ctx.lineTo(sx - 6, sy + 12);
  ctx.lineTo(sx - 24, sy + 12);
  ctx.closePath();
  ctx.fill();

  // Vertical Hull & Boost bars inside Right MFD
  const drawBar = (bx: number, ratio: number, col: string) => {
    const bh = mfdH - 36;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, mfdY + 18, 12, bh);
    const fh = Math.round(bh * clamp(ratio, 0, 1));
    ctx.fillStyle = col;
    ctx.fillRect(bx, mfdY + 18 + (bh - fh), 12, fh);
  };
  drawBar(rightX + mfdW - 38, hpRatio, '#4be87c');
  drawBar(rightX + mfdW - 20, player.boost, '#ff942e');

  ctx.restore();
}
