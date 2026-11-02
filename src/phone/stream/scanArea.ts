import { centreCrop, type CropRect } from '@/features/scan/crop'

interface Size {
  width: number
  height: number
}

/**
 * The part of the screen the scan loop reads, in screen pixels: `centreCrop` of the video, placed
 * the way `object-fit: cover` places the video in the view, then cut to the view (the crop can run
 * past it, and what is off screen isn't marked). Before the video has a size, the whole view.
 */
export function scanArea(video: Size, view: Size): CropRect {
  if (video.width <= 0 || video.height <= 0) {
    return { x: 0, y: 0, width: view.width, height: view.height }
  }
  const crop = centreCrop(video.width, video.height)
  const scale = Math.max(view.width / video.width, view.height / video.height)
  const offsetX = (view.width - video.width * scale) / 2
  const offsetY = (view.height - video.height * scale) / 2
  const left = Math.min(Math.max(0, Math.round(offsetX + crop.x * scale)), view.width)
  const top = Math.min(Math.max(0, Math.round(offsetY + crop.y * scale)), view.height)
  const right = Math.min(
    Math.max(left, Math.round(offsetX + (crop.x + crop.width) * scale)),
    view.width
  )
  const bottom = Math.min(
    Math.max(top, Math.round(offsetY + (crop.y + crop.height) * scale)),
    view.height
  )
  return { x: left, y: top, width: right - left, height: bottom - top }
}
