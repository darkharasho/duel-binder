/** Raw pixels, 4 bytes per pixel (R, G, B, A), row-major. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}
