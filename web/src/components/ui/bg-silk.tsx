'use client'

import { useCallback, useEffect, useRef } from 'react'

interface SilkBackgroundProps {
  speed?: number
  scale?: number
  color?: string
  noiseIntensity?: number
  rotation?: number
  className?: string
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')

  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)]
}

// Cheap pseudo-random noise mimicking the GLSL approach
function noise(x: number, y: number): number {
  const G = Math.E
  const rx = G * Math.sin(G * x)
  const ry = G * Math.sin(G * y)

  return (((rx * ry * (1.0 + x)) % 1) + 1) % 1
}

function rotateUV(u: number, v: number, angle: number): [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)

  return [c * u - s * v, s * u + c * v]
}

export default function SilkBackground({
  speed = 5,
  scale = 1,
  color = '#7B7481',
  noiseIntensity = 1.5,
  rotation = 0,
  className = ''
}: SilkBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const timeRef = useRef<number>(0)
  const lastTimestampRef = useRef<number | null>(null)
  const drawRef = useRef<(timestamp: number) => void>(() => {})

  const [baseR, baseG, baseB] = hexToRgb(color)

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current

      if (!canvas) return
      const ctx = canvas.getContext('2d')

      if (!ctx) return

      // Delta time in seconds (capped to avoid jumps on tab focus)
      const delta = lastTimestampRef.current ? Math.min((timestamp - lastTimestampRef.current) / 1000, 0.05) : 0.016

      lastTimestampRef.current = timestamp
      timeRef.current += 0.1 * delta

      const t = timeRef.current
      const w = canvas.width
      const h = canvas.height

      // On hidden layouts (e.g. mobile/tablet), canvas can be 0x0.
      if (w <= 0 || h <= 0) {
        animRef.current = requestAnimationFrame(drawRef.current)

        return
      }

      const imageData = ctx.createImageData(w, h)
      const data = imageData.data

      const tOffset = speed * t

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          // Normalized UV [0,1]
          const u = px / w
          const v = py / h

          // Rotate + scale UVs
          const [ru, rv] = rotateUV(u * scale, v * scale, rotation)
          const texX = ru * scale
          let texY = rv * scale

          // Sine warp on Y (matches GLSL: tex.y += 0.03 * sin(8*tex.x - tOffset))
          texY += 0.03 * Math.sin(8.0 * texX - tOffset)

          // Silk pattern (matches GLSL fragment shader pattern)
          const inner = 5.0 * (texX + texY + Math.cos(3.0 * texX + 5.0 * texY) + 0.02 * tOffset)

          const outer = 20.0 * (texX + texY - 0.1 * tOffset)

          const pattern = 0.6 + 0.4 * Math.sin(inner + Math.sin(outer))

          // Per-pixel noise (screen-space, matches gl_FragCoord)
          const rnd = noise(px, py)

          // Final colour: base colour * pattern - noise * noiseIntensity/15
          const adjust = (rnd / 15.0) * noiseIntensity
          const r = Math.min(255, Math.max(0, (baseR / 255) * pattern * 255 - adjust * 255))
          const g = Math.min(255, Math.max(0, (baseG / 255) * pattern * 255 - adjust * 255))
          const b = Math.min(255, Math.max(0, (baseB / 255) * pattern * 255 - adjust * 255))

          const idx = (py * w + px) * 4

          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = 255
        }
      }

      ctx.putImageData(imageData, 0, 0)
      animRef.current = requestAnimationFrame(drawRef.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speed, scale, color, noiseIntensity, rotation, baseR, baseG, baseB]
  )

  useEffect(() => {
    drawRef.current = draw
  }, [draw])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) return

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        const dpr = Math.min(window.devicePixelRatio || 1, 2)

        canvas.width = Math.floor(width * dpr)
        canvas.height = Math.floor(height * dpr)
      }
    })

    observer.observe(canvas.parentElement ?? canvas)

    return () => observer.disconnect()
  }, [])

  // Start / restart animation when props change
  useEffect(() => {
    cancelAnimationFrame(animRef.current)
    lastTimestampRef.current = null
    animRef.current = requestAnimationFrame(drawRef.current)

    return () => cancelAnimationFrame(animRef.current)
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: 'block',
        width: '100%',
        height: '100%'
      }}
    />
  )
}
