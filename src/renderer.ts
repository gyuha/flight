import { cross, dot, localToWorld, normalize, sub, torusDelta } from './math';
import { FLAME_STYLES, getBossVoxels, getCarrierVoxels, getJetVoxels } from './models';
import { TUNE } from './tune';
import type {
  Basis,
  BossEntity,
  BulletEntity,
  CameraMode,
  JetEntity,
  MissileEntity,
  Particle,
  Vec3,
  WorldData,
} from './types';
import { getWorldSpan } from './worlds';

export interface CameraState {
  pos: Vec3;
  basis: Basis;
  fovY: number;
  near: number;
  far: number;
}

const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

// Pass 1: VoxelSpace / Heightfield Raymarcher + Pixel Ocean + Dithered Clouds + Depth Output
const TERRAIN_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uHeight;
uniform sampler2D uColor;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform float uWorldSpan;
uniform float uMaxH;
uniform float uTime;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;
uniform float uRain;
uniform float uLightning;

// 4x4 Bayer matrix for retro pixel-art dithering
float bayer4(ivec2 p) {
  int x = p.x & 3;
  int y = p.y & 3;
  int idx = y * 4 + x;
  const float m[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return (m[idx] + 0.5) / 16.0;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbmCloud(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.05;
    a *= 0.5;
  }
  return v;
}

float sampleH(vec2 wxz) {
  vec2 uv = fract(wxz / uWorldSpan);
  return texture(uHeight, uv).r * uMaxH;
}

float depthFromViewZ(float vz) {
  float a = uFar / (uFar - uNear);
  float b = (-uFar * uNear) / (uFar - uNear);
  float ndc = (a * vz + b) / max(vz, 0.001);
  return clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  float bayer = bayer4(px);

  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(
    uCamFwd +
    uCamRight * (ndc.x * uAspect * uTanHalfFov) +
    uCamUp * (ndc.y * uTanHalfFov)
  );

  // Sky gradient + sun + dithered pixel clouds
  float skyT = clamp(pow(max(rd.y, 0.0), 0.58), 0.0, 1.0);
  vec3 sky = mix(uSkyHorizon, uSkyTop, skyT);

  // Sun glow & pixel disc
  float sunDot = max(dot(rd, uSunDir), 0.0);
  sky += uSunColor * pow(sunDot, 18.0) * 0.35;
  if (sunDot > 0.9965) {
    sky = mix(sky, uSunColor * 1.15, 0.9);
  }

  // Multi-layer dithered pixel clouds above horizon
  if (rd.y > 0.01) {
    float cDist = 420.0 / (rd.y + 0.09);
    vec2 cUv = (uCamPos.xz + rd.xz * cDist) * 0.0005 + vec2(uTime * 0.008, uTime * 0.003);
    float c = fbmCloud(cUv);
    float cEdge = smoothstep(0.36, 0.62, c) * smoothstep(0.01, 0.11, rd.y);
    if (cEdge > bayer * 0.92 + 0.03) {
      float shade = clamp(fbmCloud(cUv + uSunDir.xz * 0.14) - c + 0.55, 0.0, 1.0);
      vec3 cCol = shade > 0.46 + (bayer - 0.5) * 0.18 ? uCloudColor : uCloudShadow;
      sky = mix(sky, cCol, 0.88);
    }
  }

  // Lightning sky flash
  sky += vec3(0.6, 0.72, 0.95) * uLightning;

  float hitT = uFar;
  vec3 col = sky;
  bool hitTerrain = false;

  // Raymarch terrain heightfield when ray can reach below max terrain height
  float maxDist = min(uFar * 0.95, 2500.0);
  float t = 4.0;
  if (uCamPos.y > uMaxH + 4.0 && rd.y < -0.002) {
    t = max(4.0, (uMaxH + 4.0 - uCamPos.y) / rd.y);
  }

  if (rd.y < 0.22 && (uCamPos.y <= uMaxH + 4.0 || rd.y < -0.002)) {
    float prevT = t;
    for (int i = 0; i < 96; i++) {
      if (t > maxDist) break;
      vec3 p = uCamPos + rd * t;
      if (p.y < 0.0) break;
      if (p.y <= uMaxH) {
        float h = sampleH(p.xz);
        if (p.y <= h) {
          // Binary search refinement
          float lo = prevT;
          float hi = t;
          for (int j = 0; j < 5; j++) {
            float mid = 0.5 * (lo + hi);
            vec3 mp = uCamPos + rd * mid;
            if (mp.y <= sampleH(mp.xz)) hi = mid;
            else lo = mid;
          }
          hitT = hi;
          hitTerrain = true;
          break;
        }
      }
      prevT = t;
      t += max(5.5, t * 0.032);
    }
  }

  if (hitTerrain) {
    vec3 p = uCamPos + rd * hitT;
    vec2 uv = fract(p.xz / uWorldSpan);
    vec3 baseCol = texture(uColor, uv).rgb;
    // Estimate normal from heightmap
    float eps = 7.0;
    float hL = sampleH(p.xz - vec2(eps, 0.0));
    float hR = sampleH(p.xz + vec2(eps, 0.0));
    float hD = sampleH(p.xz - vec2(0.0, eps));
    float hU = sampleH(p.xz + vec2(0.0, eps));
    vec3 n = normalize(vec3(hL - hR, eps * 1.8, hD - hU));
    float ndl = max(dot(n, uSunDir), 0.0);
    // Slight quantized toon/pixel shading bands
    float lit = 0.42 + floor(ndl * 4.5 + bayer * 0.35) / 4.5 * 0.65;
    col = baseCol * lit * mix(vec3(1.0), uSunColor, 0.35);

    // Distance fog with pixel dither
    float fog = clamp((hitT - 450.0) / 1950.0, 0.0, 1.0);
    fog = clamp(fog + (bayer - 0.5) * 0.06, 0.0, 1.0);
    col = mix(col, uFogColor, fog);
  } else if (rd.y < -0.001 && uCamPos.y > 0.0) {
    // Ocean plane intersection (y = 0)
    float waterT = -uCamPos.y / rd.y;
    if (waterT > 0.0 && waterT < maxDist) {
      hitT = waterT;
      vec3 wp = uCamPos + rd * waterT;
      // Check nearby land for shallow turquoise tint
      float nearH = sampleH(wp.xz + vec2(18.0, 0.0)) + sampleH(wp.xz - vec2(18.0, 0.0))
                  + sampleH(wp.xz + vec2(0.0, 18.0)) + sampleH(wp.xz - vec2(0.0, 18.0));
      float shallow = clamp(nearH * 0.015, 0.0, 1.0);
      vec3 water = mix(uWaterDeep, uWaterShallow, shallow);

      // Retro pixel wave bands & white sparkles
      vec2 waveCell = floor(wp.xz * 0.09 + vec2(uTime * 1.1, uTime * 0.45));
      float w1 = hash21(waveCell);
      float w2 = sin(wp.x * 0.06 + uTime * 2.2) * cos(wp.z * 0.05 - uTime * 1.6);
      if (w2 > 0.32) {
        water *= 1.12;
      } else if (w2 < -0.35) {
        water *= 0.88;
      }
      // Crisp horizontal pixel glints
      float glint = step(0.962, w1) * (1.0 - clamp(waterT / 1500.0, 0.0, 1.0));
      water = mix(water, vec3(0.88, 0.96, 1.0), glint * 0.85);

      // Sun specular shimmer on water
      vec3 refl = reflect(rd, vec3(0.0, 1.0, 0.0));
      float spec = pow(max(dot(refl, uSunDir), 0.0), 28.0);
      if (spec > bayer * 0.8 + 0.15) {
        water = mix(water, uSunColor, 0.65);
      }

      float fog = clamp((waterT - 350.0) / 1850.0, 0.0, 1.0);
      col = mix(water, uFogColor, fog);
    }
  }

  // Rain streaks on Storm Front / Iron Strait
  if (uRain > 0.01) {
    float rCell = hash21(vec2(floor(float(px.x) * 0.5 + float(px.y) * 0.18), floor(float(px.y) * 0.09 - uTime * 28.0)));
    if (rCell > 1.0 - 0.025 * uRain) {
      col = mix(col, vec3(0.75, 0.84, 0.94), 0.45 * uRain);
    }
  }

  // Write true linear view-space depth for 3D voxel occlusion
  float viewZ = hitT * dot(rd, uCamFwd);
  gl_FragDepth = depthFromViewZ(viewZ);

  // Alpha = 0.0 marks non-jet background/terrain pixels (for Pass 3 jet outline)
  outColor = vec4(col, 0.0);
}
`;

// Pass 2: Instanced 3D Voxel Cubes (Jets, Carrier, Boss, Missiles, Bullets, Flames, Contrails)
const VOXEL_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 iPosSize;   // xyz = world pos, w = cube size
layout(location = 3) in vec4 iColorFlag; // rgb = 0..1 color, w = flags (>0.5 outline, >1.5 emissive)

uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform vec3 uSunDir;

out vec3 vColor;
out float vTag;

void main() {
  vec3 worldPos = iPosSize.xyz + aPos * iPosSize.w;
  vec3 rel = worldPos - uCamPos;

  float vx = dot(rel, uCamRight);
  float vy = dot(rel, uCamUp);
  float vz = dot(rel, uCamFwd);

  float sx = vx / (uAspect * uTanHalfFov);
  float sy = vy / uTanHalfFov;
  float a = uFar / (uFar - uNear);
  float b = (-uFar * uNear) / (uFar - uNear);
  gl_Position = vec4(sx, sy, a * vz + b, vz);

  float flag = iColorFlag.w;
  bool isEmissive = flag > 1.5;
  float ndl = max(dot(aNormal, uSunDir), 0.0);
  float shade = isEmissive ? 1.15 : (0.52 + ndl * 0.56);
  vColor = iColorFlag.rgb * shade;
  vTag = (flag > 0.5 && flag < 1.5) ? 1.0 : 0.0;
}
`;

const VOXEL_FS = `#version 300 es
precision highp float;

in vec3 vColor;
in float vTag;
out vec4 outColor;

void main() {
  outColor = vec4(clamp(vColor, 0.0, 1.0), vTag);
}
`;

// Pass 3: Pixel-Art Silhouette Outlines + Damage/Lightning Flash + Crisp Upscale
const COMPOSITE_FS = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uScene;
uniform ivec2 uSize;
uniform float uDamageFlash;
uniform float uLightningFlash;

void main() {
  ivec2 p = clamp(ivec2(vUv * vec2(uSize)), ivec2(0), uSize - ivec2(1));
  vec4 c = texelFetch(uScene, p, 0);
  vec3 rgb = c.rgb;

  // 1-pixel dark outline around tagged voxel aircraft / boss silhouettes
  if (c.a < 0.5) {
    float n =
      texelFetch(uScene, clamp(p + ivec2( 1,  0), ivec2(0), uSize - 1), 0).a +
      texelFetch(uScene, clamp(p + ivec2(-1,  0), ivec2(0), uSize - 1), 0).a +
      texelFetch(uScene, clamp(p + ivec2( 0,  1), ivec2(0), uSize - 1), 0).a +
      texelFetch(uScene, clamp(p + ivec2( 0, -1), ivec2(0), uSize - 1), 0).a;
    if (n > 0.5) {
      rgb = vec3(0.05, 0.07, 0.13);
    }
  }

  // Subtle damage red vignette & lightning flash
  if (uDamageFlash > 0.01) {
    float dist = length(vUv - 0.5) * 1.5;
    rgb = mix(rgb, vec3(0.95, 0.15, 0.12), uDamageFlash * clamp(dist, 0.25, 0.85));
  }
  rgb += vec3(0.45, 0.55, 0.72) * uLightningFlash;

  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

const MAX_INSTANCES = 14000;

function createCubeGeometry(): Float32Array {
  // 36 vertices * 6 floats (pos.xyz, normal.xyz)
  const faces: [number[], number[][]][] = [
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
    [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
  ];
  const out = new Float32Array(36 * 6);
  let k = 0;
  for (const [n, verts] of faces) {
    for (const v of verts) {
      out[k++] = v[0]; out[k++] = v[1]; out[k++] = v[2];
      out[k++] = n[0]; out[k++] = n[1]; out[k++] = n[2];
    }
  }
  return out;
}

function compileProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(`Shader error: ${gl.getShaderInfoLog(sh)}`);
    }
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

export class StormRenderer {
  private gl: WebGL2RenderingContext;
  private terrainProg: WebGLProgram;
  private voxelProg: WebGLProgram;
  private compositeProg: WebGLProgram;

  private emptyVao: WebGLVertexArrayObject;
  private voxelVao: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer;
  private instanceData = new Float32Array(MAX_INSTANCES * 8);
  private instanceCount = 0;

  private heightTex: WebGLTexture;
  private colorTex: WebGLTexture;
  private currentWorldId: string | null = null;

  private fbo: WebGLFramebuffer;
  private sceneTex: WebGLTexture;
  private depthRb: WebGLRenderbuffer;
  public fbWidth = 420;
  public fbHeight = 260;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required for STORM: First Lightning');
    this.gl = gl;

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.terrainProg = compileProgram(gl, FULLSCREEN_VS, TERRAIN_FS);
    this.voxelProg = compileProgram(gl, VOXEL_VS, VOXEL_FS);
    this.compositeProg = compileProgram(gl, FULLSCREEN_VS, COMPOSITE_FS);

    this.emptyVao = gl.createVertexArray()!;

    // Voxel instanced VAO
    this.voxelVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.voxelVao);

    const cubeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, createCubeGeometry(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    // Terrain textures
    this.heightTex = gl.createTexture()!;
    this.colorTex = gl.createTexture()!;

    // Low-res FBO
    this.fbo = gl.createFramebuffer()!;
    this.sceneTex = gl.createTexture()!;
    this.depthRb = gl.createRenderbuffer()!;
    this.resize(window.innerWidth, window.innerHeight, 1);
  }

  public resize(viewW: number, viewH: number, pixelScale: number): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(viewW * dpr));
    canvas.height = Math.max(1, Math.floor(viewH * dpr));

    const targetW = pixelScale === 2 ? 320 : pixelScale === 0 ? 520 : 420;
    const aspect = viewW / Math.max(1, viewH);
    this.fbWidth = Math.max(160, Math.round(targetW));
    this.fbHeight = Math.max(120, Math.round(targetW / aspect));

    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.fbWidth,
      this.fbHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.fbWidth, this.fbHeight);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public uploadWorld(world: WorldData): void {
    if (this.currentWorldId === world.def.id) return;
    this.currentWorldId = world.def.id;
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      world.size,
      world.size,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      world.heightTex
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      world.size,
      world.size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      world.colorTex
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  private pushCube(
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
    flag: number
  ): void {
    if (this.instanceCount >= MAX_INSTANCES) return;
    const i = this.instanceCount * 8;
    const d = this.instanceData;
    d[i] = x;
    d[i + 1] = y;
    d[i + 2] = z;
    d[i + 3] = size;
    d[i + 4] = r;
    d[i + 5] = g;
    d[i + 6] = b;
    d[i + 7] = flag;
    this.instanceCount++;
  }

  public projectToScreen(
    worldPos: Vec3,
    cam: CameraState,
    worldSpan: number,
    viewW: number,
    viewH: number
  ): { x: number; y: number; dist: number; inFront: boolean } {
    const rel = torusDelta(cam.pos, worldPos, worldSpan);
    const vx = dot(rel, cam.basis.right);
    const vy = dot(rel, cam.basis.up);
    const vz = dot(rel, cam.basis.fwd);
    const aspect = viewW / Math.max(1, viewH);
    const tanHalf = Math.tan(cam.fovY * 0.5);
    if (vz <= 1.0) {
      return {
        x: (vx >= 0 ? 1 : -1) * viewW,
        y: (vy >= 0 ? -1 : 1) * viewH,
        dist: Math.hypot(rel.x, rel.y, rel.z),
        inFront: false,
      };
    }
    const ndcX = vx / (vz * aspect * tanHalf);
    const ndcY = vy / (vz * tanHalf);
    return {
      x: (ndcX * 0.5 + 0.5) * viewW,
      y: (0.5 - ndcY * 0.5) * viewH,
      dist: Math.hypot(rel.x, rel.y, rel.z),
      inFront: true,
    };
  }

  public render(
    world: WorldData,
    cam: CameraState,
    cameraMode: CameraMode,
    jets: JetEntity[],
    bullets: BulletEntity[],
    missiles: MissileEntity[],
    particles: Particle[],
    boss: BossEntity,
    time: number,
    damageFlash: number,
    lightningFlash: number
  ): void {
    this.uploadWorld(world);
    const gl = this.gl;
    const span = getWorldSpan(world);
    const aspect = this.fbWidth / this.fbHeight;
    const tanHalfFov = Math.tan(cam.fovY * 0.5);

    // Build voxel instance list (positions wrapped relative to camera for seamless torus rendering)
    this.instanceCount = 0;

    // 1. Aircraft Carrier
    const cDelta = torusDelta(cam.pos, world.carrierPos, span);
    if (Math.hypot(cDelta.x, cDelta.y, cDelta.z) < 2200) {
      const cWorld = {
        x: cam.pos.x + cDelta.x,
        y: world.carrierPos.y,
        z: cam.pos.z + cDelta.z,
      };
      const carrierVox = getCarrierVoxels();
      const cs = 4.6;
      for (let i = 0; i < carrierVox.length; i++) {
        const v = carrierVox[i];
        this.pushCube(
          cWorld.x + v.x * cs,
          cWorld.y + v.y * cs,
          cWorld.z + v.z * cs,
          cs * 1.02,
          v.color[0] / 255,
          v.color[1] / 255,
          v.color[2] / 255,
          v.emissive ? 2.0 : 0.0
        );
      }
    }

    // 2. Leviathan Boss
    if (boss.active && boss.alive) {
      const bDelta = torusDelta(cam.pos, boss.pos, span);
      if (Math.hypot(bDelta.x, bDelta.y, bDelta.z) < 2400) {
        const bWorld = {
          x: cam.pos.x + bDelta.x,
          y: boss.pos.y,
          z: cam.pos.z + bDelta.z,
        };
        const ch = Math.cos(boss.heading);
        const sh = Math.sin(boss.heading);
        const bossVox = getBossVoxels();
        const bs = 5.4;
        for (let i = 0; i < bossVox.length; i++) {
          const v = bossVox[i];
          const rx = v.x * ch + v.z * sh;
          const rz = -v.x * sh + v.z * ch;
          this.pushCube(
            bWorld.x + rx * bs,
            bWorld.y + v.y * bs,
            bWorld.z + rz * bs,
            bs * 1.04,
            v.color[0] / 255,
            v.color[1] / 255,
            v.color[2] / 255,
            v.emissive ? 2.0 : 1.0
          );
        }
        // Highlight live boss parts with glowing orange cores
        for (const part of boss.parts) {
          if (part.destroyed) continue;
          const rx = part.offset.x * ch + part.offset.z * sh;
          const rz = -part.offset.x * sh + part.offset.z * ch;
          this.pushCube(
            bWorld.x + rx,
            bWorld.y + part.offset.y,
            bWorld.z + rz,
            9.5,
            1.0,
            0.42 + Math.sin(time * 8) * 0.2,
            0.12,
            2.0
          );
        }
      }
    }

    // 3. Fighter Jets + Afterburners + Wingtip Contrails + Shield Aura
    for (const jet of jets) {
      if (!jet.alive) continue;
      if (jet.isPlayer && cameraMode === 'cockpit') continue;

      const delta = torusDelta(cam.pos, jet.pos, span);
      const dist = Math.hypot(delta.x, delta.y, delta.z);
      if (dist > 2200) continue;

      const jWorld = {
        x: cam.pos.x + delta.x,
        y: jet.pos.y,
        z: cam.pos.z + delta.z,
      };
      const vox = getJetVoxels(jet.modelIndex, jet.paintIndex);
      const vs = 1.15;

      for (let i = 0; i < vox.length; i++) {
        const v = vox[i];
        const off = localToWorld(jet.basis, { x: v.x * vs, y: v.y * vs, z: v.z * vs });
        this.pushCube(
          jWorld.x + off.x,
          jWorld.y + off.y,
          jWorld.z + off.z,
          vs * 1.08,
          v.color[0] / 255,
          v.color[1] / 255,
          v.color[2] / 255,
          1.0
        );
      }

      // Retractable landing gear when on/near carrier
      if (jet.gearDown > 0.1) {
        const gy = -1.7 * jet.gearDown;
        for (const gx of [-1.8, 1.8, 0]) {
          const gz = gx === 0 ? 3.2 : -1.2;
          const off = localToWorld(jet.basis, { x: gx, y: gy, z: gz });
          this.pushCube(jWorld.x + off.x, jWorld.y + off.y, jWorld.z + off.z, 1.0, 0.16, 0.18, 0.22, 1.0);
        }
      }

      // Twin Afterburner Flame Plumes
      const flame = FLAME_STYLES[jet.flameStyle % FLAME_STYLES.length];
      const flameLen = jet.boosting ? 5 : jet.onCarrier && jet.catapultCharge > 0 ? 4 : 3;
      const flicker = Math.sin(time * 42 + jet.id * 7) * 0.45;
      for (const side of [-1.15, 1.15]) {
        for (let s = 0; s < flameLen; s++) {
          const c = flame.colors[Math.min(s, flame.colors.length - 1)];
          const fz = -7.2 - s * (1.25 + (jet.boosting ? 0.45 : 0)) + flicker * 0.4;
          const sz = (1.55 - s * 0.22) * (jet.boosting ? 1.25 : 0.95);
          const off = localToWorld(jet.basis, { x: side, y: 0, z: fz });
          this.pushCube(
            jWorld.x + off.x,
            jWorld.y + off.y,
            jWorld.z + off.z,
            Math.max(0.5, sz),
            c[0] / 255,
            c[1] / 255,
            c[2] / 255,
            2.0
          );
        }
      }

      // Energy Shield Halo
      if (jet.shieldTimer > 0) {
        for (let k = 0; k < 8; k++) {
          const a = time * 4 + (k * Math.PI) / 4;
          const off = localToWorld(jet.basis, { x: Math.cos(a) * 9.5, y: Math.sin(a) * 4.5, z: 0 });
          this.pushCube(jWorld.x + off.x, jWorld.y + off.y, jWorld.z + off.z, 1.3, 0.35, 0.85, 1.0, 2.0);
        }
      }

      // Wingtip contrails
      const trailCol = flame.trailColor;
      const drawTrail = (pts: typeof jet.wingTrailL) => {
        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i];
          const td = torusDelta(cam.pos, pt, span);
          const fade = 1 - pt.age / pt.maxAge;
          if (fade <= 0.05) continue;
          this.pushCube(
            cam.pos.x + td.x,
            pt.y,
            cam.pos.z + td.z,
            0.22 + fade * 0.28,
            trailCol[0] / 255,
            trailCol[1] / 255,
            trailCol[2] / 255,
            2.0
          );
        }
      };
      drawTrail(jet.wingTrailL);
      drawTrail(jet.wingTrailR);
    }

    // 4. Vulcan Cannon Tracers
    for (const b of bullets) {
      const bd = torusDelta(cam.pos, b, span);
      if (Math.hypot(bd.x, bd.y, bd.z) > 1600) continue;
      const isBlue = b.team === 0;
      this.pushCube(
        cam.pos.x + bd.x,
        b.y,
        cam.pos.z + bd.z,
        1.5,
        isBlue ? 1.0 : 1.0,
        isBlue ? 0.92 : 0.32,
        isBlue ? 0.48 : 0.22,
        2.0
      );
    }

    // 5. Homing Missiles
    for (const m of missiles) {
      const md = torusDelta(cam.pos, m, span);
      if (Math.hypot(md.x, md.y, md.z) > 1900) continue;
      this.pushCube(cam.pos.x + md.x, m.y, cam.pos.z + md.z, 2.1, 0.95, 0.95, 0.98, 1.0);
      this.pushCube(
        cam.pos.x + md.x - m.vx * 0.012,
        m.y - m.vy * 0.012,
        cam.pos.z + md.z - m.vz * 0.012,
        2.0,
        1.0,
        0.58,
        0.16,
        2.0
      );
    }

    // 6. Explosions, Smoke, Flares & Debris Particles
    for (const pt of particles) {
      const pd = torusDelta(cam.pos, pt, span);
      if (Math.hypot(pd.x, pd.y, pd.z) > 2000) continue;
      const lifeRatio = 1 - pt.age / pt.maxAge;
      this.pushCube(
        cam.pos.x + pd.x,
        pt.y,
        cam.pos.z + pd.z,
        pt.size * (0.45 + lifeRatio * 0.75),
        pt.color[0] / 255,
        pt.color[1] / 255,
        pt.color[2] / 255,
        pt.emissive ? 2.0 : 0.0
      );
    }

    // --- PASS 1: Raymarched Terrain, Ocean, Sky & Clouds into low-res FBO ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.fbWidth, this.fbHeight);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);

    gl.useProgram(this.terrainProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.uniform1i(gl.getUniformLocation(this.terrainProg, 'uHeight'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.uniform1i(gl.getUniformLocation(this.terrainProg, 'uColor'), 1);

    const def = world.def;
    gl.uniform3f(gl.getUniformLocation(this.terrainProg, 'uCamPos'), cam.pos.x, cam.pos.y, cam.pos.z);
    gl.uniform3f(gl.getUniformLocation(this.terrainProg, 'uCamRight'), cam.basis.right.x, cam.basis.right.y, cam.basis.right.z);
    gl.uniform3f(gl.getUniformLocation(this.terrainProg, 'uCamUp'), cam.basis.up.x, cam.basis.up.y, cam.basis.up.z);
    gl.uniform3f(gl.getUniformLocation(this.terrainProg, 'uCamFwd'), cam.basis.fwd.x, cam.basis.fwd.y, cam.basis.fwd.z);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uTanHalfFov'), tanHalfFov);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uAspect'), aspect);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uNear'), cam.near);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uFar'), cam.far);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uWorldSpan'), span);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uMaxH'), TUNE.MAX_TERRAIN_H);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uTime'), time);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uSkyTop'), def.skyTop);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uSkyHorizon'), def.skyHorizon);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uFogColor'), def.fogColor);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uWaterDeep'), def.waterDeep);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uWaterShallow'), def.waterShallow);
    gl.uniform3f(gl.getUniformLocation(this.terrainProg, 'uSunDir'), def.sunDir.x, def.sunDir.y, def.sunDir.z);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uSunColor'), def.sunColor);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uCloudColor'), def.cloudColor);
    gl.uniform3fv(gl.getUniformLocation(this.terrainProg, 'uCloudShadow'), def.cloudShadow);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uRain'), def.rain);
    gl.uniform1f(gl.getUniformLocation(this.terrainProg, 'uLightning'), lightningFlash);

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- PASS 2: Instanced 3D Voxels with true terrain depth occlusion ---
    if (this.instanceCount > 0) {
      gl.depthFunc(gl.LESS);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      gl.useProgram(this.voxelProg);
      gl.uniform3f(gl.getUniformLocation(this.voxelProg, 'uCamPos'), cam.pos.x, cam.pos.y, cam.pos.z);
      gl.uniform3f(gl.getUniformLocation(this.voxelProg, 'uCamRight'), cam.basis.right.x, cam.basis.right.y, cam.basis.right.z);
      gl.uniform3f(gl.getUniformLocation(this.voxelProg, 'uCamUp'), cam.basis.up.x, cam.basis.up.y, cam.basis.up.z);
      gl.uniform3f(gl.getUniformLocation(this.voxelProg, 'uCamFwd'), cam.basis.fwd.x, cam.basis.fwd.y, cam.basis.fwd.z);
      gl.uniform1f(gl.getUniformLocation(this.voxelProg, 'uTanHalfFov'), tanHalfFov);
      gl.uniform1f(gl.getUniformLocation(this.voxelProg, 'uAspect'), aspect);
      gl.uniform1f(gl.getUniformLocation(this.voxelProg, 'uNear'), cam.near);
      gl.uniform1f(gl.getUniformLocation(this.voxelProg, 'uFar'), cam.far);
      gl.uniform3f(gl.getUniformLocation(this.voxelProg, 'uSunDir'), def.sunDir.x, def.sunDir.y, def.sunDir.z);

      gl.bindVertexArray(this.voxelVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, this.instanceCount * 8));
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.instanceCount);
      gl.disable(gl.CULL_FACE);
    }

    // --- PASS 3: Pixel Outline + Composite to Screen ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const canvas = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(this.compositeProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(gl.getUniformLocation(this.compositeProg, 'uScene'), 0);
    gl.uniform2i(gl.getUniformLocation(this.compositeProg, 'uSize'), this.fbWidth, this.fbHeight);
    gl.uniform1f(gl.getUniformLocation(this.compositeProg, 'uDamageFlash'), damageFlash);
    gl.uniform1f(gl.getUniformLocation(this.compositeProg, 'uLightningFlash'), lightningFlash);

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

export function buildLookBasis(from: Vec3, to: Vec3, upHint: Vec3 = { x: 0, y: 1, z: 0 }): Basis {
  const fwd = normalize(sub(to, from));
  const right = normalize(cross(upHint, fwd));
  const up = normalize(cross(fwd, right));
  return { right, up, fwd };
}
