package com.personal.murmur

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sqrt

/**
 * Small stable-fluids solver (semi-Lagrangian advection, vorticity confinement, Gauss-Seidel
 * pressure projection) carrying three dye channels. It runs on a coarse grid (~4k cells) and is
 * upscaled with bilinear filtering, so it reads as soft liquid light rather than smoke.
 * Every buffer is allocated once; [step] and [render] allocate nothing.
 */
internal class LiquidField(val columns: Int, val rows: Int) {
    private val count = columns * rows
    private var u = FloatArray(count)
    private var v = FloatArray(count)
    private var uNext = FloatArray(count)
    private var vNext = FloatArray(count)
    private var red = FloatArray(count)
    private var green = FloatArray(count)
    private var blue = FloatArray(count)
    private var redNext = FloatArray(count)
    private var greenNext = FloatArray(count)
    private var blueNext = FloatArray(count)
    private val pressure = FloatArray(count)
    private val divergence = FloatArray(count)
    private val curl = FloatArray(count)
    private val ambientRed = FloatArray(count)
    private val ambientGreen = FloatArray(count)
    private val ambientBlue = FloatArray(count)
    /** ARGB pixels from the last [render], one per cell. */
    val pixels = IntArray(count)

    var vorticity = 14f
    var velocityHalfLife = 1.4f
    /** How fast dye relaxes back to the ambient colour field (so the liquid never drains to black). */
    var dyeHalfLife = 2.4f

    /** Resets motion and fills the liquid with the ambient colours. */
    fun reset() {
        u.fill(0f); v.fill(0f); pressure.fill(0f)
        ambientRed.copyInto(red); ambientGreen.copyInto(green); ambientBlue.copyInto(blue)
    }

    fun clearAmbient() {
        ambientRed.fill(0f); ambientGreen.fill(0f); ambientBlue.fill(0f)
    }

    /** Adds a soft blob to the resting colour field the dye relaxes toward. */
    fun ambient(x: Float, y: Float, radius: Float, color: Int, amount: Float) {
        val r = ((color shr 16) and 0xFF) / 255f * amount
        val g = ((color shr 8) and 0xFF) / 255f * amount
        val b = (color and 0xFF) / 255f * amount
        val inverse = -1f / (radius * radius)
        for (j in 0 until rows) {
            val dy = j - y
            for (i in 0 until columns) {
                val dx = i - x
                val weight = exp((dx * dx + dy * dy) * inverse)
                val at = j * columns + i
                ambientRed[at] += r * weight
                ambientGreen[at] += g * weight
                ambientBlue[at] += b * weight
            }
        }
    }

    /** Adds a Gaussian splat of velocity (cells/s) and dye (linear RGB 0..1, scaled by [amount]). */
    fun splat(x: Float, y: Float, radius: Float, du: Float, dv: Float, color: Int, amount: Float) {
        val r = ((color shr 16) and 0xFF) / 255f * amount
        val g = ((color shr 8) and 0xFF) / 255f * amount
        val b = (color and 0xFF) / 255f * amount
        val reach = (radius * 2.6f).toInt() + 1
        val x0 = (x.toInt() - reach).coerceAtLeast(0)
        val x1 = (x.toInt() + reach).coerceAtMost(columns - 1)
        val y0 = (y.toInt() - reach).coerceAtLeast(0)
        val y1 = (y.toInt() + reach).coerceAtMost(rows - 1)
        if (x0 > x1 || y0 > y1) return
        val inverse = -1f / (radius * radius)
        for (j in y0..y1) {
            val dy = j - y
            var i = j * columns + x0
            for (column in x0..x1) {
                val dx = column - x
                val weight = exp((dx * dx + dy * dy) * inverse)
                if (weight > .004f) {
                    u[i] += du * weight
                    v[i] += dv * weight
                    red[i] += r * weight
                    green[i] += g * weight
                    blue[i] += b * weight
                }
                i++
            }
        }
    }

    /** Stirs the liquid: adds a Gaussian vortex (positive [spin] is clockwise on screen, cells/s). */
    fun swirl(x: Float, y: Float, radius: Float, spin: Float) {
        val reach = (radius * 2.4f).toInt() + 1
        val x0 = (x.toInt() - reach).coerceAtLeast(0)
        val x1 = (x.toInt() + reach).coerceAtMost(columns - 1)
        val y0 = (y.toInt() - reach).coerceAtLeast(0)
        val y1 = (y.toInt() + reach).coerceAtMost(rows - 1)
        if (x0 > x1 || y0 > y1) return
        val inverse = -1f / (radius * radius)
        val scale = spin / radius
        for (j in y0..y1) {
            val dy = j - y
            var i = j * columns + x0
            for (column in x0..x1) {
                val dx = column - x
                val weight = exp((dx * dx + dy * dy) * inverse) * scale
                u[i] -= dy * weight
                v[i] += dx * weight
                i++
            }
        }
    }

    fun step(dt: Float) {
        if (dt <= 0f) return
        confineVorticity(dt)
        project()
        advect(dt)
        val keepVelocity = exp(-dt * .693f / velocityHalfLife)
        val relax = 1f - exp(-dt * .693f / dyeHalfLife)
        for (i in 0 until count) {
            u[i] *= keepVelocity
            v[i] *= keepVelocity
            red[i] += (ambientRed[i] - red[i]) * relax
            green[i] += (ambientGreen[i] - green[i]) * relax
            blue[i] += (ambientBlue[i] - blue[i]) * relax
        }
    }

    /** Tone-maps dye into opaque pixels; [exposure] lifts the whole field (beat bloom). */
    fun render(exposure: Float, ceiling: Float) {
        val scale = 255f * ceiling
        for (i in 0 until count) {
            val r = (scale * soft(red[i] * exposure)).toInt()
            val g = (scale * soft(green[i] * exposure)).toInt()
            val b = (scale * soft(blue[i] * exposure)).toInt()
            pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
    }

    // Cheap filmic shoulder: x / (1 + x) keeps colour hue while saturating highlights.
    private fun soft(x: Float) = if (x <= 0f) 0f else x / (1f + x)

    private fun confineVorticity(dt: Float) {
        if (vorticity <= 0f) return
        for (j in 0 until rows) {
            val up = if (j > 0) -columns else 0
            val down = if (j < rows - 1) columns else 0
            for (i in 0 until columns) {
                val at = j * columns + i
                val left = if (i > 0) -1 else 0
                val right = if (i < columns - 1) 1 else 0
                curl[at] = .5f * ((v[at + right] - v[at + left]) - (u[at + down] - u[at + up]))
            }
        }
        for (j in 1 until rows - 1) {
            for (i in 1 until columns - 1) {
                val at = j * columns + i
                val dx = abs(curl[at + 1]) - abs(curl[at - 1])
                val dy = abs(curl[at + columns]) - abs(curl[at - columns])
                val length = sqrt(dx * dx + dy * dy) + 1e-5f
                val c = curl[at] * vorticity * dt / length
                u[at] += dy * c
                v[at] -= dx * c
            }
        }
    }

    private fun project() {
        for (j in 0 until rows) {
            val up = if (j > 0) -columns else 0
            val down = if (j < rows - 1) columns else 0
            for (i in 0 until columns) {
                val at = j * columns + i
                val left = if (i > 0) -1 else 0
                val right = if (i < columns - 1) 1 else 0
                divergence[at] = .5f * (u[at + right] - u[at + left] + v[at + down] - v[at + up])
            }
        }
        // Warm-started Gauss-Seidel: last frame's pressure is a good first guess.
        repeat(PRESSURE_ITERATIONS) {
            for (j in 0 until rows) {
                val up = if (j > 0) -columns else 0
                val down = if (j < rows - 1) columns else 0
                for (i in 0 until columns) {
                    val at = j * columns + i
                    val left = if (i > 0) -1 else 0
                    val right = if (i < columns - 1) 1 else 0
                    pressure[at] = (pressure[at + left] + pressure[at + right] + pressure[at + up] +
                        pressure[at + down] - divergence[at]) * .25f
                }
            }
        }
        for (j in 0 until rows) {
            val up = if (j > 0) -columns else 0
            val down = if (j < rows - 1) columns else 0
            for (i in 0 until columns) {
                val at = j * columns + i
                val left = if (i > 0) -1 else 0
                val right = if (i < columns - 1) 1 else 0
                u[at] -= .5f * (pressure[at + right] - pressure[at + left])
                v[at] -= .5f * (pressure[at + down] - pressure[at + up])
            }
        }
        // Walls: no flow through the screen edges.
        for (j in 0 until rows) {
            u[j * columns] = 0f
            u[j * columns + columns - 1] = 0f
        }
        for (i in 0 until columns) {
            v[i] = 0f
            v[(rows - 1) * columns + i] = 0f
        }
    }

    private fun advect(dt: Float) {
        val maxX = columns - 1.001f
        val maxY = rows - 1.001f
        for (j in 0 until rows) {
            for (i in 0 until columns) {
                val at = j * columns + i
                val x = (i - dt * u[at]).coerceIn(0f, maxX)
                val y = (j - dt * v[at]).coerceIn(0f, maxY)
                val x0 = x.toInt()
                val y0 = y.toInt()
                val fx = x - x0
                val fy = y - y0
                val a = y0 * columns + x0
                val b = a + 1
                val c = a + columns
                val d = c + 1
                val w00 = (1f - fx) * (1f - fy)
                val w10 = fx * (1f - fy)
                val w01 = (1f - fx) * fy
                val w11 = fx * fy
                uNext[at] = u[a] * w00 + u[b] * w10 + u[c] * w01 + u[d] * w11
                vNext[at] = v[a] * w00 + v[b] * w10 + v[c] * w01 + v[d] * w11
                redNext[at] = red[a] * w00 + red[b] * w10 + red[c] * w01 + red[d] * w11
                greenNext[at] = green[a] * w00 + green[b] * w10 + green[c] * w01 + green[d] * w11
                blueNext[at] = blue[a] * w00 + blue[b] * w10 + blue[c] * w01 + blue[d] * w11
            }
        }
        var swap = u; u = uNext; uNext = swap
        swap = v; v = vNext; vNext = swap
        swap = red; red = redNext; redNext = swap
        swap = green; green = greenNext; greenNext = swap
        swap = blue; blue = blueNext; blueNext = swap
    }

    private companion object {
        const val PRESSURE_ITERATIONS = 8
    }
}
