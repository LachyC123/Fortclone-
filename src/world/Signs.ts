import * as THREE from 'three';

/**
 * Hand-painted signboards rendered to canvas textures. Signs give every building a name and a
 * joke, which does a lot of the "authored world" work for very little cost.
 */
export function makeSign(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; border?: string; font?: number; sub?: string; round?: boolean } = {}) {
  const w = opts.w ?? 2.4, h = opts.h ?? 0.8;
  const pxW = 512, pxH = Math.round((512 * h) / w);
  const c = document.createElement('canvas');
  c.width = pxW;
  c.height = pxH;
  const g = c.getContext('2d')!;
  const r = opts.round ? pxH / 2 : 26;
  const bw = 14;
  g.fillStyle = opts.border ?? '#5e3b27';
  roundRect(g, 0, 0, pxW, pxH, r);
  g.fill();
  g.fillStyle = opts.bg ?? '#f4e7c8';
  roundRect(g, bw, bw, pxW - bw * 2, pxH - bw * 2, r - bw / 2);
  g.fill();
  // subtle painted grain
  g.globalAlpha = 0.07;
  for (let i = 0; i < 40; i++) {
    g.fillStyle = i % 2 ? '#000' : '#fff';
    g.fillRect(bw, bw + Math.random() * (pxH - bw * 2), pxW - bw * 2, 2);
  }
  g.globalAlpha = 1;
  g.fillStyle = opts.fg ?? '#2b2238';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fs = opts.font ?? Math.round(pxH * (opts.sub ? 0.42 : 0.55));
  g.font = `${fs}px "Lilita One", "Fredoka", system-ui, sans-serif`;
  let tw = g.measureText(text).width;
  const maxW = pxW - bw * 4;
  if (tw > maxW) {
    g.font = `${Math.floor((fs * maxW) / tw)}px "Lilita One", "Fredoka", system-ui, sans-serif`;
    tw = maxW;
  }
  g.fillText(text, pxW / 2, opts.sub ? pxH * 0.42 : pxH / 2 + fs * 0.05);
  if (opts.sub) {
    g.font = `${Math.round(pxH * 0.2)}px "Fredoka", system-ui, sans-serif`;
    g.globalAlpha = 0.8;
    g.fillText(opts.sub, pxW / 2, pxH * 0.76);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), mat);
  mesh.castShadow = true;
  return mesh;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
