import { BASE_FRAGMENT_SHADER, OVERLAY_FRAGMENT_SHADER, SURFACE_FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";
import { shadingConstants, type Finish, type SurfaceStats } from "./model";
import { CLEANUP, type ShadingMap } from "./shading";
import { NEUTRAL, type LightingGains } from "./lighting";
import type { Lab } from "@/lib/color/lab";

export type SurfaceRenderInput = {
  id: string;
  target: Lab | null;
  stats: SurfaceStats | null;
  finish: Finish;
  brightness: number;
  visible: boolean;
  /** Hide stains and defects (needs a shading map, see setShading). */
  cleanup: boolean;
};

/** A tinted, outlined mask drawn on top (selection highlight, detected surfaces). */
export type OverlayInput = { maskId: string; color: [number, number, number]; opacity: number };

type Program = { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null>; aPos: number };

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log ?? "unknown"}`);
  }
  return shader;
}

function link(gl: WebGLRenderingContext, fs: string, uniforms: string[]): Program {
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link error: ${gl.getProgramInfoLog(program) ?? "unknown"}`);
  }
  const u: Program["uniforms"] = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(program, name);
  return { program, uniforms: u, aPos: gl.getAttribLocation(program, "aPos") };
}

/**
 * WebGL renderer that composites the original photo with every painted
 * surface. Rendering a 2048px image takes a few milliseconds on phones, so we
 * re-render on every parameter change.
 */
export class RecolorRenderer {
  readonly gl: WebGLRenderingContext;
  private base: Program;
  private surface: Program;
  private overlay: Program;
  private quad: WebGLBuffer;
  private imageTex: WebGLTexture | null = null;
  private maskTex = new Map<string, WebGLTexture>();
  private shadingTex = new Map<string, WebGLTexture>();
  private width = 0;
  private height = 0;
  private lost = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true, // needed for export / eyedropper / tests
    });
    if (!gl) throw new Error("WebGL is not available");
    this.gl = gl;
    this.base = link(gl, BASE_FRAGMENT_SHADER, ["uImage", "uImageGain"]);
    this.surface = link(gl, SURFACE_FRAGMENT_SHADER, [
      "uImage",
      "uMask",
      "uTargetLab",
      "uTargetY",
      "uRefY",
      "uContrast",
      "uKnee",
      "uSpecular",
      "uShading",
      "uCleanup",
      "uBeta",
      "uTexture",
      "uTexel",
      "uImageGain",
      "uPaintGain",
    ]);
    this.overlay = link(gl, OVERLAY_FRAGMENT_SHADER, ["uMask", "uSize", "uColor", "uOpacity"]);
    const quad = gl.createBuffer();
    if (!quad) throw new Error("createBuffer failed");
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    canvas.addEventListener("webglcontextlost", this.onLost);
  }

  private onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };

  get isContextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  setImage(source: TexImageSource, width: number, height: number): void {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const t of this.maskTex.values()) gl.deleteTexture(t);
    this.maskTex.clear();
    for (const t of this.shadingTex.values()) gl.deleteTexture(t);
    this.shadingTex.clear();
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    this.imageTex = this.createTexture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
  }

  /** Upload (or replace) an 8-bit mask. Defaults to image size; overlays may use a lower resolution. */
  setMask(id: string, mask: Uint8Array, width = this.width, height = this.height): void {
    const gl = this.gl;
    let tex = this.maskTex.get(id);
    if (!tex) {
      tex = this.createTexture();
      this.maskTex.set(id, tex);
    } else gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, mask);
  }

  /** Update only a rectangular region of a mask (cheap during brush strokes). */
  updateMaskRegion(id: string, mask: Uint8Array, x: number, y: number, w: number, h: number): void {
    const tex = this.maskTex.get(id);
    if (!tex) return this.setMask(id, mask);
    const gl = this.gl;
    const region = new Uint8Array(w * h);
    for (let row = 0; row < h; row++) {
      const start = (y + row) * this.width + x;
      region.set(mask.subarray(start, start + w), row * w);
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.LUMINANCE, gl.UNSIGNED_BYTE, region);
  }

  removeMask(id: string): void {
    const tex = this.maskTex.get(id);
    if (tex) this.gl.deleteTexture(tex);
    this.maskTex.delete(id);
    const sh = this.shadingTex.get(id);
    if (sh) this.gl.deleteTexture(sh);
    this.shadingTex.delete(id);
  }

  /** Upload the low-resolution lighting map of a surface (null removes it). */
  setShading(id: string, map: ShadingMap | null): void {
    const gl = this.gl;
    let tex = this.shadingTex.get(id);
    if (!map) {
      if (tex) gl.deleteTexture(tex);
      this.shadingTex.delete(id);
      return;
    }
    if (!tex) {
      tex = this.createTexture();
      this.shadingTex.set(id, tex);
    } else gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, map.width, map.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, map.data);
  }

  private bindQuad(p: Program): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(p.aPos);
    gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
  }

  render(surfaces: SurfaceRenderInput[], overlays: OverlayInput[] = [], lighting: LightingGains = { image: NEUTRAL, paint: NEUTRAL }): void {
    if (!this.imageTex || this.isContextLost) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);

    gl.useProgram(this.base.program);
    this.bindQuad(this.base);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.uniform1i(this.base.uniforms.uImage ?? null, 0);
    gl.uniform3f(this.base.uniforms.uImageGain ?? null, ...lighting.image);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const s = this.surface;
    gl.useProgram(s.program);
    this.bindQuad(s);
    gl.uniform1i(s.uniforms.uImage ?? null, 0);
    gl.uniform1i(s.uniforms.uMask ?? null, 1);
    gl.uniform1i(s.uniforms.uShading ?? null, 2);
    gl.uniform1f(s.uniforms.uBeta ?? null, CLEANUP.beta);
    gl.uniform1f(s.uniforms.uTexture ?? null, CLEANUP.texture);
    gl.uniform2f(s.uniforms.uTexel ?? null, 1 / this.width, 1 / this.height);
    gl.uniform3f(s.uniforms.uImageGain ?? null, ...lighting.image);
    gl.uniform3f(s.uniforms.uPaintGain ?? null, ...lighting.paint);
    for (const surf of surfaces) {
      const tex = this.maskTex.get(surf.id);
      if (!surf.visible || !surf.target || !surf.stats || !tex) continue;
      const c = shadingConstants(surf.target, surf.stats, surf.finish, surf.brightness);
      const shading = surf.cleanup ? this.shadingTex.get(surf.id) : undefined;
      gl.activeTexture(gl.TEXTURE2);
      // Bind something valid even when unused (sampler must reference a complete texture).
      gl.bindTexture(gl.TEXTURE_2D, shading ?? tex);
      gl.uniform1f(s.uniforms.uCleanup ?? null, shading ? 1 : 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform3f(s.uniforms.uTargetLab ?? null, surf.target.L, surf.target.a, surf.target.b);
      gl.uniform1f(s.uniforms.uTargetY ?? null, c.targetY);
      gl.uniform1f(s.uniforms.uRefY ?? null, c.refY);
      gl.uniform1f(s.uniforms.uContrast ?? null, c.contrast);
      gl.uniform1f(s.uniforms.uKnee ?? null, c.knee);
      gl.uniform1f(s.uniforms.uSpecular ?? null, c.specular);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if (overlays.length) {
      const o = this.overlay;
      gl.useProgram(o.program);
      this.bindQuad(o);
      gl.uniform1i(o.uniforms.uMask ?? null, 1);
      gl.uniform2f(o.uniforms.uSize ?? null, this.width, this.height);
      for (const overlay of overlays) {
        const tex = this.maskTex.get(overlay.maskId);
        if (!tex) continue;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform3f(o.uniforms.uColor ?? null, ...overlay.color);
        gl.uniform1f(o.uniforms.uOpacity ?? null, overlay.opacity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Read back a single pixel (sRGB 0..255) from the last render. */
  readPixel(x: number, y: number): [number, number, number] {
    const gl = this.gl;
    const out = new Uint8Array(4);
    // GL origin is bottom-left; our vertex shader maps image row 0 to the top.
    gl.readPixels(Math.floor(x), this.height - 1 - Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
  }

  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    for (const t of this.maskTex.values()) gl.deleteTexture(t);
    for (const t of this.shadingTex.values()) gl.deleteTexture(t);
    if (this.imageTex) gl.deleteTexture(this.imageTex);
    gl.deleteBuffer(this.quad);
    gl.deleteProgram(this.base.program);
    gl.deleteProgram(this.surface.program);
    gl.deleteProgram(this.overlay.program);
  }
}
