'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { KENNEY_UNIT_SCALE, useBuilderStore } from '@/lib/builderStore';

/**
 * 2D top-down SVG architectural blueprint dynamically scaling to fit any expanded
 * room footprint, walls, furniture footprints, selected highlight, and character pose.
 */
export function BlueprintMinimap() {
  const placedItems = useBuilderStore((s) => s.placedItems);
  const selectedItemId = useBuilderStore((s) => s.selectedItemId);
  const playerPos = useBuilderStore((s) => s.playerPos);
  const playerYaw = useBuilderStore((s) => s.playerYaw);
  const roomBounds = useBuilderStore((s) => s.roomBounds);

  const size = 160;

  const { scale, offsetX, offsetZ, floors, walls, props } = useMemo(() => {
    let minX = roomBounds.minX;
    let maxX = roomBounds.maxX;
    let minZ = roomBounds.minZ;
    let maxZ = roomBounds.maxZ;

    for (const item of placedItems) {
      const ix = item.position[0];
      const iz = item.position[2];
      if (ix < minX) minX = ix;
      if (ix + 2 > maxX && item.type === 'floor') maxX = ix + 2;
      else if (ix + 1 > maxX) maxX = ix + 1;
      if (iz - 2 < minZ && item.type === 'floor') minZ = iz - 2;
      else if (iz - 1 < minZ) minZ = iz - 1;
      if (iz + 1 > maxZ) maxZ = iz + 1;
    }

    const spanX = maxX - minX + 2;
    const spanZ = maxZ - minZ + 2;
    const worldSpan = Math.max(12, spanX, spanZ);
    const sc = size / worldSpan;
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const toSvg = (wx: number, wz: number): [number, number] => [
      size / 2 + (wx - cx) * sc,
      size / 2 + (wz - cz) * sc,
    ];

    const f: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const w: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; isDoor: boolean; selected: boolean }> = [];
    const p: Array<{ id: string; x: number; y: number; selected: boolean; interactive: boolean }> = [];

    for (const item of placedItems) {
      const selected = item.id === selectedItemId;
      if (item.type === 'floor') {
        const span = (item.catalogId.includes('Half') ? 0.5 : 1.0) * item.scale[0];
        const depth = 1.0 * item.scale[2];
        const [sx, sy] = toSvg(item.position[0], item.position[2] - depth);
        f.push({
          id: item.id,
          x: sx,
          y: sy,
          w: span * sc,
          h: depth * sc,
        });
      } else if (item.type === 'wall') {
        const len = (item.catalogId.includes('wallHalf') ? 0.5 : item.catalogId.includes('Corner') ? 0.55 : 1.0) * item.scale[0];
        const rad = THREE.MathUtils.degToRad(item.rotation);
        const endX = item.position[0] + Math.cos(rad) * len;
        const endZ = item.position[2] - Math.sin(rad) * len;
        const [x1, y1] = toSvg(item.position[0], item.position[2]);
        const [x2, y2] = toSvg(endX, endZ);
        const isDoor = item.catalogId.includes('Doorway') || item.catalogId.includes('doorway');
        w.push({ id: wlId(item.id), x1, y1, x2, y2, isDoor, selected });
      } else if (!item.noCollide) {
        const [px, py] = toSvg(item.position[0], item.position[2]);
        p.push({
          id: item.id,
          x: px,
          y: py,
          selected,
          interactive: Boolean(item.interactTag),
        });
      }
    }

    return { scale: sc, offsetX: cx, offsetZ: cz, floors: f, walls: w, props: p };
  }, [placedItems, selectedItemId, roomBounds]);

  const charX = size / 2 + (playerPos[0] - offsetX) * scale;
  const charY = size / 2 + (playerPos[2] - offsetZ) * scale;
  const lookX = charX + Math.sin(playerYaw) * 8;
  const lookY = charY + Math.cos(playerYaw) * 8;

  void KENNEY_UNIT_SCALE;

  return (
    <div className="flex flex-col items-center border-b border-white/10 pb-2">
      <div className="relative flex w-full items-center justify-center overflow-hidden rounded-[2px] border border-[#dfba73]/25 bg-[#101319] p-1.5">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="h-[118px] w-full max-w-[220px]"
          role="img"
          aria-label="Room blueprint minimap"
        >
          <defs>
            <pattern id="bp-grid-small" width={scale * 0.5} height={scale * 0.5} patternUnits="userSpaceOnUse">
              <path
                d={`M ${scale * 0.5} 0 L 0 0 0 ${scale * 0.5}`}
                fill="none"
                stroke="#1d2430"
                strokeWidth="0.6"
              />
            </pattern>
            <pattern id="bp-grid-major" width={scale * 2} height={scale * 2} patternUnits="userSpaceOnUse">
              <rect width={scale * 2} height={scale * 2} fill="url(#bp-grid-small)" />
              <path
                d={`M ${scale * 2} 0 L 0 0 0 ${scale * 2}`}
                fill="none"
                stroke="#2b3546"
                strokeWidth="0.9"
              />
            </pattern>
          </defs>

          <rect width={size} height={size} fill="url(#bp-grid-major)" />

          {floors.map((fl) => (
            <rect
              key={fl.id}
              x={fl.x}
              y={fl.y}
              width={fl.w}
              height={fl.h}
              fill="rgba(212, 180, 131, 0.10)"
              stroke="rgba(212, 180, 131, 0.22)"
              strokeWidth="0.6"
            />
          ))}

          {props.map((pr) => (
            <rect
              key={pr.id}
              x={pr.x - 3.5}
              y={pr.y - 3.5}
              width={7}
              height={7}
              rx={1}
              fill={pr.selected ? 'rgba(234, 200, 127, 0.65)' : pr.interactive ? 'rgba(58, 208, 255, 0.35)' : 'rgba(180, 188, 200, 0.32)'}
              stroke={pr.selected ? '#eac87f' : pr.interactive ? '#67e8f9' : 'rgba(255,255,255,0.28)'}
              strokeWidth={pr.selected ? 1.2 : 0.6}
            />
          ))}

          {walls.map((wl) => (
            <line
              key={wl.id}
              x1={wl.x1}
              y1={wl.y1}
              x2={wl.x2}
              y2={wl.y2}
              stroke={wl.selected ? '#eac87f' : '#e4e8ef'}
              strokeWidth={wl.selected ? 3.2 : 2.3}
              strokeDasharray={wl.isDoor ? '4 3' : undefined}
              strokeLinecap="square"
            />
          ))}

          <line
            x1={charX}
            y1={charY}
            x2={lookX}
            y2={lookY}
            stroke="#eac87f"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle
            cx={charX}
            cy={charY}
            r={3.5}
            fill="#ffffff"
            stroke="#dfba73"
            strokeWidth="1.3"
          />
        </svg>
      </div>
      <span className="mt-1 font-mono text-[10px] tracking-[0.14em] text-[#b4aea4] uppercase">
        Blueprint · {roomBounds.maxX - roomBounds.minX}×{roomBounds.maxZ - roomBounds.minZ}m
      </span>
    </div>
  );
}

function wlId(id: string): string {
  return id;
}
