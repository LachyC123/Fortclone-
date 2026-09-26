import * as THREE from 'three';

/** Shared materials. Everything static uses vertex colours so a handful of materials cover the world. */
export const shared = {
  time: { value: 0 },
  windStrength: { value: 1 },
};

export function worldMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
  return m;
}

/** Vertex-coloured material with a wind sway driven by the per-vertex `wind` attribute. */
export function foliageMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.uniforms.uWind = shared.windStrength;
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float wind;
        uniform float uTime;
        uniform float uWind;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float ph = wp.x * 0.21 + wp.z * 0.17;
          float sway = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 3.7 + ph * 2.3) * 0.25;
          transformed.x += sway * wind * 0.16 * uWind;
          transformed.z += cos(uTime * 1.3 + ph * 1.3) * wind * 0.1 * uWind;
          transformed.y += sin(uTime * 2.1 + ph) * wind * 0.02;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'foliage-v1';
  return m;
}

/** Toy-like material for characters: soft rim light gives that "chunky vinyl figure" read. */
const charCache = new Map<string, THREE.MeshStandardMaterial>();
export function toyMaterial(hex: number, opts: { rough?: number; metal?: number; emissive?: number; emissiveIntensity?: number } = {}) {
  const k = `${hex}-${opts.rough ?? 0.6}-${opts.metal ?? 0}-${opts.emissive ?? 0}-${opts.emissiveIntensity ?? 0}`;
  let m = charCache.get(k);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: hex,
    roughness: opts.rough ?? 0.6,
    metalness: opts.metal ?? 0,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
      {
        float rim = 1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0);
        gl_FragColor.rgb += pow(rim, 3.0) * vec3(1.0, 0.95, 0.85) * 0.28;
      }`,
    );
  };
  m.customProgramCacheKey = () => 'toy-rim-v1';
  charCache.set(k, m);
  return m;
}

export function glowMaterial(hex: number, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color: hex, transparent: opacity < 1, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

export function waterMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x4fc3d9, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vWp; uniform float uTime;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed,1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n varying vec3 vWp; uniform float uTime;`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          float w = sin(vWp.x * 1.3 + uTime * 1.2) * sin(vWp.z * 1.1 - uTime * 0.9);
          float w2 = sin((vWp.x + vWp.z) * 3.1 + uTime * 2.4);
          float band = smoothstep(0.55, 0.9, w * 0.6 + w2 * 0.4);
          gl_FragColor.rgb += band * vec3(0.55, 0.85, 0.9) * 0.45;
        }`,
      );
    sh.uniforms.uTime = shared.time;
  };
  m.customProgramCacheKey = () => 'water-v1';
  return m;
}
