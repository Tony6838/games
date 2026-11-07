/* WebGL2 渲染器：纸牌、圆角长方体、阴影贴图、灯光、粒子。没有用任何第三方库。 */
(function (root) {
  'use strict';

  // ---- 向量与矩阵 ------------------------------------------------------------
  const V3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    norm: (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
  };

  const Quat = {
    identity: () => [0, 0, 0, 1],
    axis(x, y, z, a) {
      const s = Math.sin(a / 2);
      return [x * s, y * s, z * s, Math.cos(a / 2)];
    },
    mul(a, b) {
      return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
      ];
    },
    slerp(a, b, t) {
      let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
      let bx = b;
      if (d < 0) {
        d = -d;
        bx = [-b[0], -b[1], -b[2], -b[3]];
      }
      if (d > 0.9995) {
        const r = [a[0] + (bx[0] - a[0]) * t, a[1] + (bx[1] - a[1]) * t, a[2] + (bx[2] - a[2]) * t, a[3] + (bx[3] - a[3]) * t];
        const l = Math.hypot(r[0], r[1], r[2], r[3]);
        return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
      }
      const th = Math.acos(d);
      const s = Math.sin(th);
      const wa = Math.sin((1 - t) * th) / s;
      const wb = Math.sin(t * th) / s;
      return [a[0] * wa + bx[0] * wb, a[1] * wa + bx[1] * wb, a[2] * wa + bx[2] * wb, a[3] * wa + bx[3] * wb];
    },
    rotate(q, v) {
      const u = [q[0], q[1], q[2]];
      const c1 = V3.cross(u, v);
      const c2 = V3.cross(u, [c1[0] + q[3] * v[0], c1[1] + q[3] * v[1], c1[2] + q[3] * v[2]]);
      return [v[0] + 2 * c2[0], v[1] + 2 * c2[1], v[2] + 2 * c2[2]];
    },
    conj: (q) => [-q[0], -q[1], -q[2], q[3]],
  };

  const M4 = {
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      const nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    ortho(l, r, b, t, n, f) {
      return new Float32Array([
        2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0,
        -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
      ]);
    },
    lookAt(eye, at, up) {
      const z = V3.norm(V3.sub(eye, at));
      const x = V3.norm(V3.cross(up, z));
      const y = V3.cross(z, x);
      return new Float32Array([
        x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -V3.dot(x, eye), -V3.dot(y, eye), -V3.dot(z, eye), 1,
      ]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[r + 4] * b[c * 4 + 1] + a[r + 8] * b[c * 4 + 2] + a[r + 12] * b[c * 4 + 3];
        }
      }
      return o;
    },
    invert(m) {
      const a = m;
      const o = new Float32Array(16);
      const b00 = a[0] * a[5] - a[1] * a[4];
      const b01 = a[0] * a[6] - a[2] * a[4];
      const b02 = a[0] * a[7] - a[3] * a[4];
      const b03 = a[1] * a[6] - a[2] * a[5];
      const b04 = a[1] * a[7] - a[3] * a[5];
      const b05 = a[2] * a[7] - a[3] * a[6];
      const b06 = a[8] * a[13] - a[9] * a[12];
      const b07 = a[8] * a[14] - a[10] * a[12];
      const b08 = a[8] * a[15] - a[11] * a[12];
      const b09 = a[9] * a[14] - a[10] * a[13];
      const b10 = a[9] * a[15] - a[11] * a[13];
      const b11 = a[10] * a[15] - a[11] * a[14];
      const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
      o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
      o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
      o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
      o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
      o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det;
      o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
      o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det;
      o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
      o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
      o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
      o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
      o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
      o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det;
      o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
      o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det;
      o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
      return o;
    },
    compose(out, p, q, s) {
      const [x, y, z, w] = q;
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      out[0] = (1 - (yy + zz)) * s; out[1] = (xy + wz) * s; out[2] = (xz - wy) * s; out[3] = 0;
      out[4] = (xy - wz) * s; out[5] = (1 - (xx + zz)) * s; out[6] = (yz + wx) * s; out[7] = 0;
      out[8] = (xz + wy) * s; out[9] = (yz - wx) * s; out[10] = (1 - (xx + yy)) * s; out[11] = 0;
      out[12] = p[0]; out[13] = p[1]; out[14] = p[2]; out[15] = 1;
      return out;
    },
    transform(m, v) {
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
      const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
      const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
      const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15];
      return [x / w, y / w, z / w, w];
    },
  };

  // ---- 网格 ------------------------------------------------------------------
  /** 圆角长方体。uv 把六个面放进 3×2 的格子：+x,-x,+y / -y,+z,-z。 */
  function roundedBox(w, h, d, r, seg) {
    const half = [w / 2, h / 2, d / 2];
    const inner = half.map((v) => v - r);
    const pos = [];
    const idx = [];
    const lines = (L) => {
      const out = [];
      for (let i = 0; i <= seg; i++) out.push(-L + (r * i) / seg);
      for (let i = seg; i >= 0; i--) out.push(L - (r * i) / seg);
      return out;
    };
    const faces = [
      { n: 0, s: 1, u: 2, v: 1, flipU: -1, flipV: 1, cell: 0 },
      { n: 0, s: -1, u: 2, v: 1, flipU: 1, flipV: 1, cell: 1 },
      { n: 1, s: 1, u: 0, v: 2, flipU: 1, flipV: -1, cell: 2 },
      { n: 1, s: -1, u: 0, v: 2, flipU: 1, flipV: 1, cell: 3 },
      { n: 2, s: 1, u: 0, v: 1, flipU: 1, flipV: 1, cell: 4 },
      { n: 2, s: -1, u: 0, v: 1, flipU: -1, flipV: 1, cell: 5 },
    ];
    for (const f of faces) {
      const us = lines(half[f.u]);
      const vs = lines(half[f.v]);
      const base = pos.length / 8;
      const stride = vs.length;
      for (let iu = 0; iu < us.length; iu++) {
        for (let iv = 0; iv < vs.length; iv++) {
          const p = [0, 0, 0];
          p[f.n] = f.s * half[f.n];
          p[f.u] = us[iu];
          p[f.v] = vs[iv];
          const q = p.map((x, i) => Math.max(-inner[i], Math.min(inner[i], x)));
          const nn = V3.norm(V3.sub(p, q));
          const px = q[0] + nn[0] * r;
          const py = q[1] + nn[1] * r;
          const pz = q[2] + nn[2] * r;
          const cu = (f.cell % 3) / 3;
          const cv = Math.floor(f.cell / 3) / 2;
          const uu = (f.flipU * us[iu] / half[f.u] + 1) / 2;
          const vv = (f.flipV * vs[iv] / half[f.v] + 1) / 2;
          pos.push(px, py, pz, nn[0], nn[1], nn[2], cu + uu / 3, cv + (1 - vv) / 2);
        }
      }
      for (let iu = 0; iu < us.length - 1; iu++) {
        for (let iv = 0; iv < vs.length - 1; iv++) {
          const a = base + iu * stride + iv;
          const b = a + stride;
          const c = b + 1;
          const e = a + 1;
          // 绕序按法线方向定
          const pa = [pos[a * 8], pos[a * 8 + 1], pos[a * 8 + 2]];
          const pb = [pos[b * 8], pos[b * 8 + 1], pos[b * 8 + 2]];
          const pc = [pos[c * 8], pos[c * 8 + 1], pos[c * 8 + 2]];
          const fn = V3.cross(V3.sub(pb, pa), V3.sub(pc, pa));
          const axisDir = fn[f.n] * f.s;
          if (axisDir >= 0) idx.push(a, b, c, a, c, e);
          else idx.push(a, c, b, a, e, c);
        }
      }
    }
    return { vertices: new Float32Array(pos), indices: new Uint32Array(idx) };
  }

  function planeRect(hx, hz, uvPerUnit) {
    const u = hx * uvPerUnit;
    const v = hz * uvPerUnit;
    return {
      vertices: new Float32Array([
        -hx, 0, -hz, 0, 1, 0, 0, 0,
        hx, 0, -hz, 0, 1, 0, u, 0,
        hx, 0, hz, 0, 1, 0, u, v,
        -hx, 0, hz, 0, 1, 0, 0, v,
      ]),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    };
  }

  /** 纸牌：圆角矩形薄片。正面朝 +z，背面朝 -z，四周一圈窄边。 */
  function cardMesh(w, h, t, r, seg) {
    const outline = [];
    const corners = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI], [w / 2 - r, -h / 2 + r, Math.PI * 1.5]];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        outline.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
      }
    }
    const v = [];
    const idx = [];
    const push = (x, y, z, nx, ny, nz) => {
      v.push(x, y, z, nx, ny, nz, 0, 0);
      return v.length / 8 - 1;
    };
    const n = outline.length;
    const fc = push(0, 0, t / 2, 0, 0, 1);
    const fBase = v.length / 8;
    for (const o of outline) push(o[0], o[1], t / 2, 0, 0, 1);
    for (let i = 0; i < n; i++) idx.push(fc, fBase + i, fBase + (i + 1) % n);
    const bc = push(0, 0, -t / 2, 0, 0, -1);
    const bBase = v.length / 8;
    for (const o of outline) push(o[0], o[1], -t / 2, 0, 0, -1);
    for (let i = 0; i < n; i++) idx.push(bc, bBase + (i + 1) % n, bBase + i);
    const eBase = v.length / 8;
    for (const o of outline) {
      push(o[0], o[1], t / 2, o[2], o[3], 0);
      push(o[0], o[1], -t / 2, o[2], o[3], 0);
    }
    for (let i = 0; i < n; i++) {
      const a = eBase + i * 2;
      const b = eBase + ((i + 1) % n) * 2;
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    }
    return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
  }

  function plane(size, uvScale) {
    const s = size;
    const u = uvScale;
    return {
      vertices: new Float32Array([
        -s, 0, -s, 0, 1, 0, 0, 0,
        s, 0, -s, 0, 1, 0, u, 0,
        s, 0, s, 0, 1, 0, u, u,
        -s, 0, s, 0, 1, 0, 0, u,
      ]),
      indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    };
  }

  // ---- 着色器 ----------------------------------------------------------------
  const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uVP, uModel, uLightVP;
out vec3 vWorld, vN, vObj, vObjN;
out vec2 vUV;
out vec4 vLight;
void main(){
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vN = mat3(uModel) * aNormal;
  vObj = aPos;
  vObjN = aNormal;
  vUV = aUV;
  vLight = uLightVP * w;
  gl_Position = uVP * w;
}`;

  const FS = (pcf) => `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld, vN, vObj, vObjN;
in vec2 vUV;
in vec4 vLight;
out vec4 outColor;
uniform int uMode;           // 0 纸牌  1 贴图材质
uniform sampler2D uTex;
uniform sampler2DShadow uShadow;
uniform vec4 uCell;
uniform vec4 uBack;
uniform float uHasFace;
uniform vec3 uTileDim;
uniform vec3 uEye, uKeyPos;
uniform vec3 uEmissive;
uniform float uDim;
uniform vec2 uGloss;         // x 高光强度, y 高光锐度
uniform float uFlash;
uniform float uFogR;
uniform int uUVMode;         // 0 网格 UV  1 木纹沿 x  2 木纹沿 z

float shadowAt(vec3 N, vec3 L){
  vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return 1.0;
  float bias = 0.0009 + 0.0016 * (1.0 - max(dot(N, L), 0.0));
  float texel = 1.0 / ${pcf === 1 ? '1536.0' : '2048.0'};
  float s = 0.0;
  for (int x = -${pcf}; x <= ${pcf}; x++) {
    for (int y = -${pcf}; y <= ${pcf}; y++) {
      s += texture(uShadow, vec3(p.xy + vec2(float(x), float(y)) * texel * ${pcf === 1 ? '2.6' : '1.6'}, p.z - bias));
    }
  }
  return s / ${(2 * pcf + 1) * (2 * pcf + 1)}.0;
}

vec3 toLinear(vec3 c){ return pow(c, vec3(2.2)); }
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vWorld);
  vec3 L = normalize(uKeyPos - vWorld);
  vec3 H = normalize(L + V);
  vec3 albedo;
  vec2 gloss = uGloss;

  if (uMode == 0) {
    vec3 ON = normalize(vObjN);
    vec2 fuv = vec2(vObj.x / uTileDim.x + 0.5, 0.5 - vObj.y / uTileDim.y);
    if (ON.z > 0.5) {
      albedo = uHasFace > 0.5 ? texture(uTex, uCell.xy + fuv * uCell.zw).rgb
                              : texture(uTex, uBack.xy + fuv * uBack.zw).rgb;
    } else if (ON.z < -0.5) {
      albedo = texture(uTex, uBack.xy + vec2(1.0 - fuv.x, fuv.y) * uBack.zw).rgb;
    } else {
      albedo = vec3(0.92, 0.9, 0.84);
    }
    albedo = toLinear(albedo);
  } else {
    vec2 uv = vUV;
    if (uUVMode == 1) uv = vec2(vObj.x * 0.045, (vObj.z + vObj.y) * 0.32);
    else if (uUVMode == 2) uv = vec2(vObj.z * 0.045, (vObj.x + vObj.y) * 0.32);
    albedo = toLinear(texture(uTex, uv).rgb);
  }

  float ndl = max(dot(N, L), 0.0);
  float sh = shadowAt(N, L);
  float r = length(vWorld.xz * vec2(0.62, 1.0)) / uFogR;
  float pool = mix(1.0, 0.34, smoothstep(0.28, 1.02, r));
  vec3 key = vec3(1.0, 0.94, 0.82) * 2.1 * pool;
  vec3 hemi = mix(vec3(0.11, 0.095, 0.08), vec3(0.30, 0.33, 0.38), N.y * 0.5 + 0.5);
  float spec = pow(max(dot(N, H), 0.0), gloss.y) * gloss.x;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);

  vec3 col = albedo * (hemi + key * ndl * mix(0.16, 1.0, sh));
  col += key * spec * sh * 0.5;
  col += vec3(0.16, 0.18, 0.21) * fres * (uMode == 1 ? 0.25 : 1.0);
  col *= uDim;
  col += uEmissive;
  col += uFlash * vec3(1.0, 0.82, 0.45) * 0.28;
  col = aces(col);
  col = pow(col, vec3(1.0 / 2.2));
  outColor = vec4(col, 1.0);
}`;

  const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP, uModel;
void main(){ gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;
  const SHADOW_FS = `#version 300 es
precision mediump float;
void main(){}`;

  const PART_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aColor;
layout(location=2) in float aSize;
uniform mat4 uVP;
uniform float uScale;
out vec4 vColor;
void main(){
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = aSize * uScale / gl_Position.w;
  vColor = aColor;
}`;
  const PART_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 outColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  outColor = vec4(vColor.rgb * a * vColor.a, a * vColor.a);
}`;

  const RING_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUV;
uniform mat4 uVP;
uniform vec3 uCenter;
uniform float uRadius;
out vec2 vP;
void main(){
  vP = aPos.xz;
  gl_Position = uVP * vec4(uCenter + vec3(aPos.x * uRadius, 0.03, aPos.z * uRadius), 1.0);
}`;
  const RING_FS = `#version 300 es
precision mediump float;
in vec2 vP;
uniform vec4 uColor;
out vec4 outColor;
void main(){
  float d = length(vP);
  float a = smoothstep(0.78, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d));
  outColor = vec4(uColor.rgb * a * uColor.a, a * uColor.a);
}`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  class Gfx {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('NO_WEBGL2');
      this.gl = gl;
      this.canvas = canvas;
      this.phone = Math.max(screen.width, screen.height) < 1100 || matchMedia('(pointer: coarse)').matches;
      this.lost = false;
      this.onRestored = null;
      this.maxParticles = 1500;
      this.partData = new Float32Array(this.maxParticles * 8);
      this.initGL();
      // 手机切到别的应用时，系统可能收回显存。不调 preventDefault 就收不到恢复事件，牌桌会一直黑着。
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.lost = true;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        this.initGL();
        if (this.onRestored) this.onRestored();
        this.lost = false;
      });
    }

    /** 建立和场景无关的 GL 资源。上下文恢复后，所有 GL 对象都已失效，要重新建一遍。 */
    initGL() {
      const gl = this.gl;
      const phone = this.phone;
      this.main = program(gl, VS, FS(phone ? 1 : 2));
      this.shadow = program(gl, SHADOW_VS, SHADOW_FS);
      this.part = program(gl, PART_VS, PART_FS);
      this.ring = program(gl, RING_VS, RING_FS);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 0);

      this.shadowSize = phone ? 1536 : 2048;
      this.shadowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.shadowFb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // 粒子缓冲：位置 3 + 颜色 4 + 大小 1
      this.partVao = gl.createVertexArray();
      this.partBuf = gl.createBuffer();
      gl.bindVertexArray(this.partVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.partData.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
      gl.bindVertexArray(null);

      this.ringMesh = this.mesh(plane(1, 1));

      const light = M4.lookAt([11, 42, 15], [0, 0, 0], [0, 1, 0]);
      this.lightVP = M4.mul(M4.ortho(-40, 40, -28, 28, 8, 95), light);
      this.keyPos = [9, 34, 13];
    }

    mesh(data) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: data.indices.length };
    }

    texture(source, opts) {
      const gl = this.gl;
      const o = { premultiply: false, repeat: false, ...opts };
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, o.premultiply);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = o.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      const ext = gl.getExtension('EXT_texture_filter_anisotropic');
      if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      return t;
    }

    updateTexture(t, source) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(this.canvas.clientWidth * dpr);
      const h = Math.round(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      return { w, h, dpr };
    }

    /**
     * frame: { vp, eye, statics:[{mesh,model,tex,gloss,uvMode}], tileMesh, tiles:[{model,cell,hasFace,emissive,dim}],
     *          atlas, tileDim, backCell, particleCount, rings:[...], flash }
     */
    render(frame) {
      const gl = this.gl;

      // 阴影
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.shadow.p);
      gl.uniformMatrix4fv(this.shadow.u.uLightVP, false, this.lightVP);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(frame.tileMesh.vao);
      for (const t of frame.tiles) {
        gl.uniformMatrix4fv(this.shadow.u.uModel, false, t.model);
        gl.drawElements(gl.TRIANGLES, frame.tileMesh.count, gl.UNSIGNED_INT, 0);
      }
      for (const s of frame.statics) {
        if (!s.castShadow) continue;
        gl.bindVertexArray(s.mesh.vao);
        gl.uniformMatrix4fv(this.shadow.u.uModel, false, s.model);
        gl.drawElements(gl.TRIANGLES, s.mesh.count, gl.UNSIGNED_INT, 0);
      }
      gl.enable(gl.CULL_FACE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // 主画面
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const m = this.main;
      gl.useProgram(m.p);
      gl.uniformMatrix4fv(m.u.uVP, false, frame.vp);
      gl.uniformMatrix4fv(m.u.uLightVP, false, this.lightVP);
      gl.uniform3fv(m.u.uEye, frame.eye);
      gl.uniform3fv(m.u.uKeyPos, this.keyPos);
      gl.uniform1f(m.u.uFlash, frame.flash || 0);
      gl.uniform1f(m.u.uFogR, 25);
      gl.uniform3fv(m.u.uTileDim, frame.tileDim);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.uniform1i(m.u.uShadow, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(m.u.uTex, 0);
      gl.uniform3f(m.u.uEmissive, 0, 0, 0);
      gl.uniform1f(m.u.uDim, 1);

      gl.uniform1i(m.u.uMode, 1);
      for (const s of frame.statics) {
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform2fv(m.u.uGloss, s.gloss);
        gl.uniform1i(m.u.uUVMode, s.uvMode || 0);
        gl.uniformMatrix4fv(m.u.uModel, false, s.model);
        gl.bindVertexArray(s.mesh.vao);
        gl.drawElements(gl.TRIANGLES, s.mesh.count, gl.UNSIGNED_INT, 0);
      }

      gl.uniform1i(m.u.uMode, 0);
      gl.uniform2f(m.u.uGloss, 0.28, 55);
      gl.uniform4fv(m.u.uBack, frame.backCell);
      gl.bindTexture(gl.TEXTURE_2D, frame.atlas);
      gl.bindVertexArray(frame.tileMesh.vao);
      for (const t of frame.tiles) {
        gl.uniformMatrix4fv(m.u.uModel, false, t.model);
        gl.uniform1f(m.u.uHasFace, t.hasFace);
        if (t.hasFace) gl.uniform4fv(m.u.uCell, t.cell);
        gl.uniform3fv(m.u.uEmissive, t.emissive);
        gl.uniform1f(m.u.uDim, t.dim);
        gl.drawElements(gl.TRIANGLES, frame.tileMesh.count, gl.UNSIGNED_INT, 0);
      }

      // 光环和粒子（叠加发光）
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      if (frame.rings.length) {
        gl.useProgram(this.ring.p);
        gl.uniformMatrix4fv(this.ring.u.uVP, false, frame.vp);
        gl.bindVertexArray(this.ringMesh.vao);
        for (const r of frame.rings) {
          gl.uniform3fv(this.ring.u.uCenter, r.center);
          gl.uniform1f(this.ring.u.uRadius, r.radius);
          gl.uniform4fv(this.ring.u.uColor, r.color);
          gl.drawElements(gl.TRIANGLES, this.ringMesh.count, gl.UNSIGNED_INT, 0);
        }
      }
      if (frame.particleCount > 0) {
        gl.useProgram(this.part.p);
        gl.uniformMatrix4fv(this.part.u.uVP, false, frame.vp);
        gl.uniform1f(this.part.u.uScale, this.canvas.height * 0.11);
        gl.bindVertexArray(this.partVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.partData.subarray(0, frame.particleCount * 8));
        gl.drawArrays(gl.POINTS, 0, frame.particleCount);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }
  }

  root.TJ.GFX = { Gfx, V3, Quat, M4, roundedBox, plane, planeRect, cardMesh };
})(typeof self !== 'undefined' ? self : globalThis);
