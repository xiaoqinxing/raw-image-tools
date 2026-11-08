export const FULLSCREEN_VERT = `#version 300 es
precision highp float;
const vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}
`;

export const COMMON_HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

export const LEVELS_FRAG = `${COMMON_HEADER}
uniform highp usampler2D uRaw;
uniform ivec2 uSize;
uniform ivec2 uOrigin;
uniform ivec4 uSites;
uniform vec4 uBlack;
uniform vec4 uWhite;
uniform int uClampNegative;
out vec4 outColor;

int siteAt(ivec2 p) {
  p = clamp(p, ivec2(0), uSize - 1);
  return uSites[(p.y & 1) * 2 + (p.x & 1)];
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  ivec2 sp = p + uOrigin;
  int c = siteAt(p);
  float d = float(texelFetch(uRaw, sp, 0).r);
  float v = (d - uBlack[c]) / max(1e-9, uWhite[c] - uBlack[c]);
  if (uClampNegative == 1) v = max(v, 0.0);
  outColor = vec4(v, 0.0, 0.0, 1.0);
}
`;

export const FLAT_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform highp usampler2D uFlat;
uniform ivec2 uSize;
uniform ivec2 uFlatOrigin;
uniform ivec4 uSites;
uniform vec4 uFlatBlack;
uniform vec4 uFlatWhite;
uniform vec4 uFlatMeans;
uniform float uStrength;
uniform float uEpsilon;
uniform float uMaxGain;
out vec4 outColor;

int siteAt(ivec2 p) {
  p = clamp(p, ivec2(0), uSize - 1);
  return uSites[(p.y & 1) * 2 + (p.x & 1)];
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  int c = siteAt(p);
  float x = texelFetch(uIn, p, 0).r;
  float fd = float(texelFetch(uFlat, p + uFlatOrigin, 0).r);
  float f = (fd - uFlatBlack[c]) / max(1e-9, uFlatWhite[c] - uFlatBlack[c]);
  float gain = 1.0;
  if (f > uEpsilon) {
    gain = clamp(uFlatMeans[c] / f, 1.0 / uMaxGain, uMaxGain);
  }
  float gRef = max(1e-6, (uFlatMeans[1] + uFlatMeans[2]) * 0.5);
  gain /= gRef;
  float applied = 1.0 + uStrength * (gain - 1.0);
  outColor = vec4(x * applied, 0.0, 0.0, 1.0);
}
`;

export const WB_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
uniform ivec4 uSites;
uniform vec4 uWb;
out vec4 outColor;
int siteAt(ivec2 p) { return uSites[(p.y & 1) * 2 + (p.x & 1)]; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  int c = siteAt(p);
  float x = texelFetch(uIn, p, 0).r;
  outColor = vec4(x * uWb[c], 0.0, 0.0, 1.0);
}
`;

export const DEMOSAIC_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
uniform ivec4 uSites;
uniform int uAlgorithm;
out vec4 outColor;

int siteAt(ivec2 p) {
  p = clamp(p, ivec2(0), uSize - 1);
  return uSites[(p.y & 1) * 2 + (p.x & 1)];
}
float f(ivec2 p) {
  p = clamp(p, ivec2(0), uSize - 1);
  return texelFetch(uIn, p, 0).r;
}
float gRB(ivec2 p) {
  return (-f(p + ivec2(0, -2)) + 2.0 * f(p + ivec2(0, -1))
    - f(p + ivec2(-2, 0)) + 2.0 * f(p + ivec2(-1, 0))
    + 4.0 * f(p)
    + 2.0 * f(p + ivec2(1, 0)) - f(p + ivec2(2, 0))
    + 2.0 * f(p + ivec2(0, 1)) - f(p + ivec2(0, 2))) / 8.0;
}
float cSameRow(ivec2 p) {
  return (0.5 * f(p + ivec2(0, -2)) + 0.5 * f(p + ivec2(0, 2))
    - f(p + ivec2(-1, -1)) - f(p + ivec2(1, -1))
    - f(p + ivec2(2, 0)) - f(p + ivec2(-2, 0))
    + 4.0 * f(p + ivec2(-1, 0)) + 5.0 * f(p) + 4.0 * f(p + ivec2(1, 0))
    - f(p + ivec2(-1, 1)) - f(p + ivec2(1, 1))) / 8.0;
}
float cSameCol(ivec2 p) {
  return (0.5 * f(p + ivec2(-2, 0)) + 0.5 * f(p + ivec2(2, 0))
    - f(p + ivec2(-1, -1)) - f(p + ivec2(1, -1))
    - f(p + ivec2(0, 2)) - f(p + ivec2(0, -2))
    + 4.0 * f(p + ivec2(0, -1)) + 5.0 * f(p) + 4.0 * f(p + ivec2(0, 1))
    - f(p + ivec2(-1, 1)) - f(p + ivec2(1, 1))) / 8.0;
}
float cDiag(ivec2 p) {
  return (-1.5 * f(p + ivec2(0, -2))
    + 2.0 * f(p + ivec2(-1, -1)) + 2.0 * f(p + ivec2(1, -1))
    - 1.5 * f(p + ivec2(-2, 0)) + 6.0 * f(p) - 1.5 * f(p + ivec2(2, 0))
    + 2.0 * f(p + ivec2(-1, 1)) + 2.0 * f(p + ivec2(1, 1))
    - 1.5 * f(p + ivec2(0, 2))) / 8.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  int c = siteAt(p);
  float center = f(p);
  float r = center, g = center, b = center;
  if (uAlgorithm == 0) {
    float gAvg = (f(p + ivec2(-1, 0)) + f(p + ivec2(1, 0)) + f(p + ivec2(0, -1)) + f(p + ivec2(0, 1))) * 0.25;
    float diag = (f(p + ivec2(-1, -1)) + f(p + ivec2(1, -1)) + f(p + ivec2(-1, 1)) + f(p + ivec2(1, 1))) * 0.25;
    if (c == 0) { r = center; g = gAvg; b = diag; }
    else if (c == 3) { b = center; g = gAvg; r = diag; }
    else {
      g = center;
      int left = siteAt(p + ivec2(-1, 0));
      int right = siteAt(p + ivec2(1, 0));
      int up = siteAt(p + ivec2(0, -1));
      int down = siteAt(p + ivec2(0, 1));
      bool rHoriz = (left == 0 || right == 0);
      bool bHoriz = (left == 3 || right == 3);
      float rh = (f(p + ivec2(-1, 0)) + f(p + ivec2(1, 0))) * 0.5;
      float rv = (f(p + ivec2(0, -1)) + f(p + ivec2(0, 1))) * 0.5;
      float bh = (f(p + ivec2(-1, 0)) + f(p + ivec2(1, 0))) * 0.5;
      float bv = (f(p + ivec2(0, -1)) + f(p + ivec2(0, 1))) * 0.5;
      r = rHoriz ? rh : rv;
      b = bHoriz ? bh : bv;
    }
  } else {
    if (c == 0) { r = center; g = gRB(p); b = cDiag(p); }
    else if (c == 3) { b = center; g = gRB(p); r = cDiag(p); }
    else {
      g = center;
      int left = siteAt(p + ivec2(-1, 0));
      int right = siteAt(p + ivec2(1, 0));
      bool rHoriz = (left == 0 || right == 0);
      r = rHoriz ? cSameRow(p) : cSameCol(p);
      b = rHoriz ? cSameCol(p) : cSameRow(p);
    }
  }
  outColor = vec4(r, g, b, 1.0);
}
`;

export const MOMENTS_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
uniform int uTarget;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec3 rgb = texelFetch(uIn, p, 0).rgb;
  float y = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  float cb = rgb.b - y;
  float cr = rgb.r - y;
  if (uTarget == 0) outColor = vec4(y, y * y, cb, cr);
  else outColor = vec4(y * cb, y * cr, cb * cb, cr * cr);
}
`;

export const BOX_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
uniform int uRadius;
uniform ivec2 uDir;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec4 sum = vec4(0.0);
  float count = 0.0;
  for (int i = -5; i <= 5; i++) {
    if (abs(i) > uRadius) continue;
    ivec2 q = clamp(p + uDir * i, ivec2(0), uSize - 1);
    sum += texelFetch(uIn, q, 0);
    count += 1.0;
  }
  outColor = sum / max(1.0, count);
}
`;

export const DENOISE_COMBINE_FRAG = `${COMMON_HEADER}
uniform sampler2D uOriginal;
uniform sampler2D uMean0;
uniform sampler2D uMean1;
uniform ivec2 uSize;
uniform float uLuma;
uniform float uChroma;
uniform float uEpsY;
uniform float uEpsC;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec3 rgb = texelFetch(uOriginal, p, 0).rgb;
  float y = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  float cb = rgb.b - y;
  float cr = rgb.r - y;
  vec4 m0 = texelFetch(uMean0, p, 0);
  vec4 m1 = texelFetch(uMean1, p, 0);
  float meanY = m0.r;
  float meanY2 = m0.g;
  float meanCb = m0.b;
  float meanCr = m0.a;
  float varY = max(0.0, meanY2 - meanY * meanY);
  float aY = varY / (varY + uEpsY);
  float qY = aY * y + (meanY - aY * meanY);
  float covCb = m1.r - meanY * meanCb;
  float covCr = m1.g - meanY * meanCr;
  float aCb = covCb / (varY + uEpsC);
  float aCr = covCr / (varY + uEpsC);
  float qCb = aCb * y + (meanCb - aCb * meanY);
  float qCr = aCr * y + (meanCr - aCr * meanY);
  float yy = mix(y, qY, uLuma);
  float ccb = mix(cb, qCb, uChroma);
  float ccr = mix(cr, qCr, uChroma);
  float r = yy + ccr;
  float b = yy + ccb;
  float g = (yy - 0.2126 * r - 0.0722 * b) / 0.7152;
  outColor = vec4(r, g, b, 1.0);
}
`;

export const BILATERAL_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform sampler2D uGuide;
uniform ivec2 uSize;
uniform ivec2 uDir;
uniform int uRadius;
uniform float uSigmaS;
uniform float uSigmaR;
uniform float uStrength;
out vec4 outColor;
float luma(vec3 c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec3 center = texelFetch(uIn, p, 0).rgb;
  float lc = luma(texelFetch(uGuide, p, 0).rgb);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  float s2 = max(0.25, uSigmaS * uSigmaS);
  float r2 = max(1e-8, uSigmaR * uSigmaR);
  for (int i = -5; i <= 5; i++) {
    if (abs(i) > uRadius) continue;
    ivec2 q = clamp(p + uDir * i, ivec2(0), uSize - 1);
    float lg = luma(texelFetch(uGuide, q, 0).rgb);
    float ds = float(i * i);
    float dr = (lg - lc) * (lg - lc);
    float w = exp(-ds / (2.0 * s2)) * exp(-dr / (2.0 * r2));
    sum += texelFetch(uIn, q, 0).rgb * w;
    wsum += w;
  }
  vec3 filtered = sum / max(wsum, 1e-6);
  outColor = vec4(mix(center, filtered, uStrength), 1.0);
}
`;

export const MATRIX_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
uniform mat3 uMatrix;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec3 v = texelFetch(uIn, p, 0).rgb;
  outColor = vec4(uMatrix * v, 1.0);
}
`;

export const GAMMA_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
uniform int uMode;
out vec4 outColor;
vec3 srgbEncode(vec3 x) {
  vec3 a = 12.92 * x;
  vec3 b = 1.055 * pow(max(x, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(a, b, step(vec3(0.0031308), x));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec3 v = texelFetch(uIn, p, 0).rgb;
  if (uMode == 0) v = srgbEncode(max(v, 0.0));
  else if (uMode == 1) v = pow(max(v, 0.0), vec3(1.0 / 2.2));
  outColor = vec4(v, 1.0);
}
`;

export const LUMA_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec3 c = texelFetch(uIn, p, 0).rgb;
  outColor = vec4(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, 0.0, 0.0, 1.0);
}
`;

export const GAUSSIAN_FRAG = `${COMMON_HEADER}
uniform sampler2D uIn;
uniform ivec2 uSize;
uniform ivec2 uDir;
uniform float uSigma;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  float sum = 0.0;
  float wsum = 0.0;
  float s2 = max(0.2, uSigma * uSigma);
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / (2.0 * s2));
    ivec2 q = clamp(p + uDir * i, ivec2(0), uSize - 1);
    sum += texelFetch(uIn, q, 0).r * w;
    wsum += w;
  }
  outColor = vec4(sum / max(1e-6, wsum), 0.0, 0.0, 1.0);
}
`;

export const USM_COMBINE_FRAG = `${COMMON_HEADER}
uniform sampler2D uOriginal;
uniform sampler2D uBlur;
uniform ivec2 uSize;
uniform float uAmount;
uniform float uThreshold;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (p.x >= uSize.x || p.y >= uSize.y) discard;
  vec3 c = texelFetch(uOriginal, p, 0).rgb;
  float y = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  float b = texelFetch(uBlur, p, 0).r;
  float h = y - b;
  float hh = sign(h) * max(abs(h) - uThreshold, 0.0);
  float y2 = y + uAmount * hh;
  float scale = y > 1e-6 ? y2 / y : 1.0;
  outColor = vec4(clamp(c * scale, 0.0, 1.0), 1.0);
}
`;

export const DISPLAY_FRAG = `${COMMON_HEADER}
uniform sampler2D uA;
uniform sampler2D uB;
uniform ivec2 uImageSize;
uniform ivec2 uTexSize;
uniform vec2 uCanvasSize;
uniform vec2 uPan;
uniform float uScale;
uniform int uMode;        // 0 single, 1 split, 2 diff, 3 flicker
uniform int uDomain;      // 0 raw-cfa, 1 camera-rgb, 2 linear-srgb, 3 display-srgb
uniform int uDomainB;
uniform int uFalseColor;
uniform int uShowClipping;
uniform int uLinearDisplay;
uniform int uInterp;
uniform ivec4 uCfaSites;
uniform float uSplit;
uniform float uFlicker;
uniform float uDiffGain;
uniform int uDiffSigned;
uniform vec3 uBackground;
out vec4 outColor;

vec3 srgbEncode(vec3 x) {
  vec3 a = 12.92 * x;
  vec3 b = 1.055 * pow(max(x, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(a, b, step(vec3(0.0031308), x));
}
vec3 cfaColor(int c) {
  if (c == 0) return vec3(1.0, 0.18, 0.16);
  if (c == 1 || c == 2) return vec3(0.18, 0.9, 0.28);
  return vec3(0.18, 0.4, 1.0);
}
vec3 displayRgb(vec3 v, int dom) {
  if (dom == 0) return vec3(pow(clamp(v.r, 0.0, 1.0), 1.0 / 2.2));
  if (dom == 1 || dom == 2) return srgbEncode(clamp(v, 0.0, 1.0));
  return clamp(v, 0.0, 1.0);
}
void main() {
  float screenY = uCanvasSize.y - 1.0 - gl_FragCoord.y;
  vec2 screen = vec2(gl_FragCoord.x, screenY);
  vec2 img = uPan + (screen - uCanvasSize * 0.5) / max(1e-6, uScale);
  if (img.x < 0.0 || img.y < 0.0 || img.x >= float(uImageSize.x) || img.y >= float(uImageSize.y)) {
    float checker = mod(floor(screen.x / 16.0) + floor(screen.y / 16.0), 2.0);
    outColor = vec4(uBackground * (0.75 + 0.25 * checker), 1.0);
    return;
  }
  vec2 uv = (img + 0.5) / vec2(uImageSize);
  ivec2 tp = clamp(ivec2(uv * vec2(uTexSize)), ivec2(0), uTexSize - 1);
  vec4 a = uInterp == 0 ? texelFetch(uA, tp, 0) : texture(uA, uv);
  vec4 b = uInterp == 0 ? texelFetch(uB, tp, 0) : texture(uB, uv);
  bool useB = (uMode == 1 && screen.x >= uSplit * uCanvasSize.x)
    || (uMode == 3 && uFlicker >= 0.5);
  vec4 s = useB ? b : a;
  int dom = useB ? uDomainB : uDomain;
  vec3 col;
  if (uMode == 2) {
    vec3 d = displayRgb(a.rgb, uDomain) - displayRgb(b.rgb, uDomainB);
    if (uDiffSigned == 1) col = clamp(0.5 + d * uDiffGain * 0.5, 0.0, 1.0);
    else col = vec3(clamp(abs(d) * uDiffGain, 0.0, 1.0));
    if (uDiffSigned == 0) col = pow(col, vec3(1.0 / 2.4));
  } else if (dom == 0) {
    float v = clamp(s.r, 0.0, 1.0);
    if (uFalseColor == 1) {
      int c = uCfaSites[(int(img.y) & 1) * 2 + (int(img.x) & 1)];
      col = cfaColor(c) * pow(v, 1.0 / 2.2);
    } else {
      col = vec3(pow(v, 1.0 / 2.2));
    }
  } else if (dom == 1 || dom == 2) {
    col = (dom == 2 && uLinearDisplay == 1)
      ? clamp(s.rgb, 0.0, 1.0)
      : srgbEncode(clamp(s.rgb, 0.0, 1.0));
  } else {
    col = clamp(s.rgb, 0.0, 1.0);
  }
  if (uShowClipping == 1) {
    float hi = max(s.r, max(s.g, s.b));
    float lo = min(s.r, min(s.g, s.b));
    if (hi >= 1.0) col = vec3(1.0, 0.18, 0.18);
    else if (lo <= 0.0) col = vec3(0.20, 0.42, 1.0);
  }
  outColor = vec4(col, 1.0);
}
`;
