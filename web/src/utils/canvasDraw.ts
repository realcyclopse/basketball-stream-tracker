import type { CourtZone } from '../types/telemetry';

/**
 * Convert hex color to rgba string. Handles both #RGB and #RRGGBB formats.
 */
export function hexToRgba(hex: string, alpha: number): string {
  if (!hex) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  let clean = hex.trim();
  if (clean.startsWith('#')) {
    clean = clean.slice(1);
  }

  // Handle #RGB
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  // Handle #RRGGBB or #RRGGBBAA
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }

  // Handle rgb(...) or rgba(...) inputs gracefully
  const rgbMatch = clean.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  }

  return `rgba(255, 255, 255, ${alpha})`;
}

/**
 * NBA 2K-style perspective glowing floor ring:
 * - rx = bboxWidth * 0.65, ry = bboxWidth * 0.22
 * - Draw 4 concentric ellipses with decreasing opacity (0.6, 0.4, 0.2, 0.1) and increasing size for glow
 * - Main ellipse: 3px stroke in color
 * - If isInterpolated: use ctx.setLineDash([8, 4])
 * - Draw vertical gradient spotlight beam: a narrow trapezoid from feet up ~80px with gradient from color at 0.3 opacity to transparent
 * - Reset line dash after drawing
 */
export function drawFloorRing(
  ctx: CanvasRenderingContext2D,
  feetXY: [number, number],
  bboxWidth: number,
  color: string,
  accent: string,
  isInterpolated: boolean
): void {
  const [feetX, feetY] = feetXY;
  const rx = bboxWidth * 0.65;
  const ry = bboxWidth * 0.22;
  const beamHeight = 80;

  ctx.save();

  // 1. Draw vertical gradient spotlight beam: narrow trapezoid from feet up ~80px
  const topHalfWidth = rx * 0.35;
  const bottomHalfWidth = rx * 0.85;

  const gradient = ctx.createLinearGradient(feetX, feetY, feetX, feetY - beamHeight);
  gradient.addColorStop(0, hexToRgba(color, 0.3));
  if (accent) {
    gradient.addColorStop(0.5, hexToRgba(accent, 0.15));
  }
  gradient.addColorStop(1, hexToRgba(color, 0));

  ctx.beginPath();
  ctx.moveTo(feetX - topHalfWidth, feetY - beamHeight);
  ctx.lineTo(feetX + topHalfWidth, feetY - beamHeight);
  ctx.lineTo(feetX + bottomHalfWidth, feetY);
  ctx.lineTo(feetX - bottomHalfWidth, feetY);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Line dash configuration for interpolated frames
  if (isInterpolated) {
    ctx.setLineDash([8, 4]);
  } else {
    ctx.setLineDash([]);
  }

  // 2. Draw 4 concentric ellipses with decreasing opacity and increasing size for glow
  const glowScales = [1.0, 1.15, 1.3, 1.45];
  const glowOpacities = [0.6, 0.4, 0.2, 0.1];

  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const scale = glowScales[i];
    const opacity = glowOpacities[i];
    const ringColor = (i % 2 === 1 && accent) ? accent : color;
    ctx.beginPath();
    ctx.ellipse(feetX, feetY, rx * scale, ry * scale, 0, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(ringColor, opacity);
    ctx.stroke();
  }

  // 3. Main ellipse: 3px stroke in color
  ctx.beginPath();
  ctx.ellipse(feetX, feetY, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();

  // Reset line dash after drawing
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Glowing neon segmentation outline:
 * - Draw the polygon path
 * - Fill with color at 15% opacity (use hex to rgba conversion)
 * - Stroke with 3px in color
 * - Draw outer glow: same path with 8px stroke at 20% opacity, then 14px at 10% opacity
 * - If isInterpolated: dashed stroke
 * - Use ctx.save/restore for shadow effects: ctx.shadowColor = color, ctx.shadowBlur = 15
 */
export function drawNeonContour(
  ctx: CanvasRenderingContext2D,
  polygon: number[][],
  color: string,
  isInterpolated: boolean
): void {
  if (!polygon || polygon.length < 3) return;

  ctx.save();

  if (isInterpolated) {
    ctx.setLineDash([8, 4]);
  } else {
    ctx.setLineDash([]);
  }

  const buildPolygonPath = () => {
    ctx.beginPath();
    ctx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i][0], polygon[i][1]);
    }
    ctx.closePath();
  };

  // Outer glow: 14px stroke at 10% opacity
  buildPolygonPath();
  ctx.lineWidth = 14;
  ctx.strokeStyle = hexToRgba(color, 0.1);
  ctx.stroke();

  // Outer glow: 8px stroke at 20% opacity
  buildPolygonPath();
  ctx.lineWidth = 8;
  ctx.strokeStyle = hexToRgba(color, 0.2);
  ctx.stroke();

  // Fill with color at 15% opacity
  buildPolygonPath();
  ctx.fillStyle = hexToRgba(color, 0.15);
  ctx.fill();

  // Main stroke: 3px in color with shadow glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 15;
  buildPolygonPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();

  // Reset line dash after drawing
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Futuristic HUD targeting brackets:
 * - bbox is [x1, y1, x2, y2]
 * - At each corner, draw an L-shaped bracket
 * - Bracket arm length = 20% of the shorter side (min 15px)
 * - 2px stroke in color with shadow glow (shadowBlur: 8, shadowColor: color)
 * - Top-left: horizontal right + vertical down
 * - Top-right: horizontal left + vertical down
 * - Bottom-left: horizontal right + vertical up
 * - Bottom-right: horizontal left + vertical up
 * - Add small crosshair dot at center of bbox
 */
export function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  bbox: [number, number, number, number],
  color: string
): void {
  const [x1, y1, x2, y2] = bbox;
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);

  const width = right - left;
  const height = bottom - top;
  const shorterSide = Math.min(width, height);
  const armLength = Math.max(15, shorterSide * 0.2);

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  ctx.beginPath();
  // Top-left: horizontal right + vertical down
  ctx.moveTo(left, top + armLength);
  ctx.lineTo(left, top);
  ctx.lineTo(left + armLength, top);

  // Top-right: horizontal left + vertical down
  ctx.moveTo(right - armLength, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, top + armLength);

  // Bottom-left: horizontal right + vertical up
  ctx.moveTo(left, bottom - armLength);
  ctx.lineTo(left, bottom);
  ctx.lineTo(left + armLength, bottom);

  // Bottom-right: horizontal left + vertical up
  ctx.moveTo(right - armLength, bottom);
  ctx.lineTo(right, bottom);
  ctx.lineTo(right, bottom - armLength);

  ctx.stroke();

  // Add small crosshair dot at center of bbox
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  ctx.beginPath();
  ctx.arc(centerX, centerY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
}

/**
 * Floating broadcast pill badge:
 * - Position: centered horizontally on bbox, 12px above bbox[1] (top)
 * - Background: rgba(0,0,0,0.75) rounded rectangle
 * - Left section: colored circle with jersey number
 * - Center text: shortName in white, bold, 14px
 * - Right section: speed value in smaller text
 * - Border: 1px in color
 * - Pill shape: use roundRect if available, otherwise manual arc paths
 * - Text: ctx.font, ctx.fillText, centered
 * - Total badge width: measure text + padding (~160px typical)
 * - Badge height: ~28px
 */
export function drawPlayerBadge(
  ctx: CanvasRenderingContext2D,
  bbox: [number, number, number, number],
  number: string,
  shortName: string,
  speedKmh: number,
  color: string
): void {
  ctx.save();
  ctx.setLineDash([]);

  const [x1, y1, x2] = bbox;
  const bboxCenterX = (x1 + x2) / 2;
  const topY = Math.min(y1, bbox[3]);
  const badgeHeight = 28;
  const pillRadius = badgeHeight / 2;

  const speedText = `${(speedKmh ?? 0).toFixed(1)} km/h`;

  // Measure text widths for total pill sizing
  ctx.font = 'bold 14px sans-serif';
  const nameWidth = ctx.measureText(shortName).width;

  ctx.font = '11px sans-serif';
  const speedWidth = ctx.measureText(speedText).width;

  const circleDiameter = 20;
  const circleRadius = circleDiameter / 2;
  const leftPad = 4;
  const circleToNameGap = 8;
  const nameToSpeedGap = 10;
  const rightPad = 10;

  const calculatedWidth = leftPad + circleDiameter + circleToNameGap + nameWidth + nameToSpeedGap + speedWidth + rightPad;
  const totalBadgeWidth = Math.max(140, Math.round(calculatedWidth));

  // Position: centered horizontally on bbox, 12px above bbox[1] (top)
  const badgeX = Math.round(bboxCenterX - totalBadgeWidth / 2);
  const badgeY = Math.round(topY - 12 - badgeHeight);

  // Draw pill shape (using roundRect if available, otherwise manual arcs)
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(badgeX, badgeY, totalBadgeWidth, badgeHeight, pillRadius);
  } else {
    ctx.moveTo(badgeX + pillRadius, badgeY);
    ctx.lineTo(badgeX + totalBadgeWidth - pillRadius, badgeY);
    ctx.arc(badgeX + totalBadgeWidth - pillRadius, badgeY + pillRadius, pillRadius, -Math.PI / 2, 0);
    ctx.lineTo(badgeX + totalBadgeWidth, badgeY + badgeHeight - pillRadius);
    ctx.arc(badgeX + totalBadgeWidth - pillRadius, badgeY + badgeHeight - pillRadius, pillRadius, 0, Math.PI / 2);
    ctx.lineTo(badgeX + pillRadius, badgeY + badgeHeight);
    ctx.arc(badgeX + pillRadius, badgeY + badgeHeight - pillRadius, pillRadius, Math.PI / 2, Math.PI);
    ctx.lineTo(badgeX, badgeY + pillRadius);
    ctx.arc(badgeX + pillRadius, badgeY + pillRadius, pillRadius, Math.PI, -Math.PI / 2);
    ctx.closePath();
  }

  // Background: rgba(0,0,0,0.75) rounded rectangle
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fill();

  // Border: 1px in color
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.stroke();

  const centerY = badgeY + badgeHeight / 2;

  // Left section: colored circle with jersey number
  const circleCenterX = badgeX + leftPad + circleRadius + 2;
  ctx.beginPath();
  ctx.arc(circleCenterX, centerY, circleRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(number, circleCenterX, centerY);

  // Center text: shortName in white, bold, 14px
  const nameStartX = circleCenterX + circleRadius + circleToNameGap;
  const nameCenterX = nameStartX + nameWidth / 2;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shortName, nameCenterX, centerY);

  // Right section: speed value in smaller text
  const speedCenterX = badgeX + totalBadgeWidth - rightPad - speedWidth / 2;
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#d1d5db';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(speedText, speedCenterX, centerY);

  ctx.restore();
}

/**
 * Small indicator dot for unselected players:
 * - Circle at feetXY with radius 5
 * - Fill with color at 40% opacity
 * - Thin 1px border in color at 60% opacity
 */
export function drawSubtleDot(
  ctx: CanvasRenderingContext2D,
  feetXY: [number, number],
  color: string
): void {
  ctx.save();
  ctx.setLineDash([]);

  const [x, y] = feetXY;

  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);

  ctx.fillStyle = hexToRgba(color, 0.4);
  ctx.fill();

  ctx.lineWidth = 1;
  ctx.strokeStyle = hexToRgba(color, 0.6);
  ctx.stroke();

  ctx.restore();
}

/**
 * Court zone for a position in NBA court centimetres, relative to the nearer
 * basket (hoop 160 cm from the baseline, paint 579 x 488, arc radius 724,
 * corner three 91 cm from the sideline out to 424 cm).
 */
export function getCourtZone(
  courtXY: [number, number],
  courtWidth: number,
  courtHeight: number
): CourtZone {
  const [x, y] = courtXY;
  const leftHalf = x < courtWidth / 2;
  const distFromBaseline = leftHalf ? x : courtWidth - x;
  const dy = Math.abs(y - courtHeight / 2);
  const distFromHoop = Math.hypot(distFromBaseline - 160, dy);

  if (distFromBaseline <= 579 && dy <= 244) return 'Paint';

  if (distFromBaseline <= 424) {
    if (dy >= courtHeight / 2 - 91) return leftHalf ? 'Left Corner 3' : 'Right Corner 3';
    return 'Midrange';
  }

  if (distFromHoop <= 724) return 'Midrange';
  if (distFromHoop > 1000) return 'Backcourt';
  if (dy <= 300) return 'Top of Key';
  return leftHalf ? 'Left Wing' : 'Right Wing';
}
