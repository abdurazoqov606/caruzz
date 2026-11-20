package com.example.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.DirectionsCar
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.CrimsonBrake
import com.example.ui.theme.EmeraldGas
import com.example.ui.theme.NeonCyan
import com.example.ui.theme.ObsidianBg
import com.example.ui.theme.SlateSurface
import com.example.ui.theme.TashkentGold
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.sin

private data class Vec3(val x: Float, val y: Float, val z: Float) {
    operator fun minus(o: Vec3) = Vec3(x - o.x, y - o.y, z - o.z)
    fun dot(o: Vec3) = x * o.x + y * o.y + z * o.z
    fun cross(o: Vec3) = Vec3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun norm(): Vec3 {
        val l = hypot(hypot(x, y), z).coerceAtLeast(0.0001f)
        return Vec3(x / l, y / l, z / l)
    }
}

private class Cam3D(
    val pos: Vec3,
    val right: Vec3,
    val up: Vec3,
    val forward: Vec3,
    val halfW: Float,
    val halfH: Float,
    val focal: Float
) {
    fun toCam(p: Vec3): Vec3 {
        val rel = p - pos
        return Vec3(rel.dot(right), rel.dot(up), rel.dot(forward))
    }

    fun projectCam(c: Vec3): Offset =
        Offset(halfW + (c.x / c.z) * focal, halfH - (c.y / c.z) * focal)

    fun projectWorld(p: Vec3): Offset? {
        val c = toCam(p)
        if (c.z < 0.6f) return null
        return projectCam(c)
    }

    fun clipQuad(pts: List<Vec3>): List<Offset>? {
        val camPts = pts.map { toCam(it) }
        val near = 0.6f
        val clipped = mutableListOf<Vec3>()
        for (i in camPts.indices) {
            val a = camPts[i]
            val b = camPts[(i + 1) % camPts.size]
            val aIn = a.z >= near
            val bIn = b.z >= near
            if (aIn) clipped.add(a)
            if (aIn != bIn) {
                val t = (near - a.z) / (b.z - a.z)
                clipped.add(Vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, near))
            }
        }
        if (clipped.size < 3) return null
        return clipped.map { projectCam(it) }
    }
}

private data class Drawable3D(val distSq: Float, val draw: DrawScope.(Cam3D) -> Unit)

@Composable
fun SandboxScreen(
    state: GameUiState,
    viewModel: GameViewModel,
    modifier: Modifier = Modifier
) {
    var showTuningDialog by remember { mutableStateOf(false) }
    val activeCar = state.cars.find { it.id == state.activeCarId }
    val tuningTargetCar = activeCar ?: state.cars.first()

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ObsidianBg)
    ) {
        // 1. 3D Perspective Tashkent City Canvas
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .testTag("city_sandbox_canvas")
        ) {
            val w = size.width
            val h = size.height

            val camPos: Vec3
            val target: Vec3
            if (state.cameraMode == CameraMode.FIRST_PERSON) {
                val eyeY = if (activeCar != null) 1.35f else 1.6f
                val fwdOffset = if (activeCar != null) 0.4f else 0.1f
                val lookYaw = if (activeCar != null) activeCar.yaw else state.cameraYaw
                camPos = Vec3(
                    state.playerX - sin(lookYaw) * fwdOffset,
                    eyeY,
                    state.playerZ - cos(lookYaw) * fwdOffset
                )
                target = Vec3(
                    camPos.x - sin(state.cameraYaw) * 10f,
                    eyeY - sin(state.cameraPitch) * 5f,
                    camPos.z - cos(state.cameraYaw) * 10f
                )
            } else {
                val dist = when (state.cameraMode) {
                    CameraMode.FAR -> if (activeCar != null) 12.5f else 9.0f
                    else -> if (activeCar != null) 6.0f else 4.8f
                }
                target = Vec3(state.playerX, if (activeCar != null) 1.3f else 1.4f, state.playerZ)
                val pitch = state.cameraPitch.coerceIn(0.08f, 0.95f)
                val horiz = dist * cos(pitch)
                camPos = Vec3(
                    target.x + sin(state.cameraYaw) * horiz,
                    target.y + dist * sin(pitch) + 1.0f,
                    target.z + cos(state.cameraYaw) * horiz
                )
            }

            val forward = (target - camPos).norm()
            val right = forward.cross(Vec3(0f, 1f, 0f)).norm()
            val up = right.cross(forward).norm()
            val cam = Cam3D(camPos, right, up, forward, w / 2f, h / 2f, w * 0.92f)

            val horizonY = (h / 2f + forward.y * cam.focal).coerceIn(0f, h)
            drawRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color(0xFF0C4A6E), Color(0xFF38BDF8), Color(0xFFBAE6FD)),
                    startY = 0f,
                    endY = horizonY.coerceAtLeast(1f)
                ),
                size = Size(w, horizonY)
            )
            drawRect(
                brush = Brush.verticalGradient(
                    colors = listOf(Color(0xFF334155), Color(0xFF1E293B)),
                    startY = horizonY,
                    endY = h
                ),
                topLeft = Offset(0f, horizonY),
                size = Size(w, (h - horizonY).coerceAtLeast(0f))
            )

            drawRoadStrip(cam, -5f, 5f, -95f, 95f, Color(0xFF111827), northSouth = true)
            drawRoadStrip(cam, -95f, 95f, -5f, 5f, Color(0xFF111827), northSouth = false)

            val items = mutableListOf<Drawable3D>()
            fun distToCam(x: Float, z: Float): Float {
                val dx = x - camPos.x
                val dz = z - camPos.z
                return dx * dx + dz * dz
            }

            val buildings = listOf(
                Triple(-22f, -22f, Vec3(14f, 18f, 14f)),
                Triple(22f, -24f, Vec3(14f, 24f, 16f)),
                Triple(-24f, 22f, Vec3(16f, 14f, 14f)),
                Triple(22f, 22f, Vec3(14f, 20f, 14f)),
                Triple(-48f, -24f, Vec3(18f, 28f, 16f)),
                Triple(46f, 24f, Vec3(16f, 22f, 18f))
            )
            buildings.forEach { (bx, bz, bSize) ->
                items.add(Drawable3D(distToCam(bx, bz)) { c ->
                    drawBox3D(c, Vec3(bx, 0f, bz), bSize.x, bSize.y, bSize.z, 0f, Color(0xFF475569), Color(0xFF334155), Color(0xFF64748B))
                })
            }

            // Toshkent Teleminorasi
            val tx = 36f
            val tz = -38f
            items.add(Drawable3D(distToCam(tx, tz)) { c ->
                drawBox3D(c, Vec3(tx, 0f, tz), 6f, 12f, 6f, 0f, TashkentGold, Color(0xFFD97706), Color(0xFFFBBF24))
                drawBox3D(c, Vec3(tx, 12f, tz), 2.5f, 26f, 2.5f, 0f, Color(0xFFE2E8F0), Color(0xFF94A3B8), Color.White)
                drawBox3D(c, Vec3(tx, 26f, tz), 5.5f, 4f, 5.5f, 0f, NeonCyan, Color(0xFF0284C7), NeonCyan)
                drawBox3D(c, Vec3(tx, 38f, tz), 0.8f, 16f, 0.8f, 0f, Color.White, Color(0xFFCBD5E1), Color.White)
            })

            // Registon
            val rx = -46f
            val rz = -46f
            items.add(Drawable3D(distToCam(rx, rz)) { c ->
                drawBox3D(c, Vec3(rx, 0f, rz), 18f, 9f, 10f, 0f, Color(0xFFD97706), Color(0xFFB45309), Color(0xFFF59E0B))
                drawBox3D(c, Vec3(rx - 5f, 9f, rz), 5f, 5f, 5f, 0f, Color(0xFF0284C7), Color(0xFF0369A1), Color(0xFF38BDF8))
                drawBox3D(c, Vec3(rx + 5f, 9f, rz), 5f, 5f, 5f, 0f, Color(0xFF0284C7), Color(0xFF0369A1), Color(0xFF38BDF8))
            })

            // NPCs with animated arms & legs
            state.npcs.forEach { npc ->
                items.add(Drawable3D(distToCam(npc.x, npc.z)) { c ->
                    if (npc.isCar) {
                        draw3DCar(c, npc.x, npc.z, npc.yaw, npc.color, 0f, isVan = false, damaged = false)
                    } else {
                        draw3DCharacter(c, npc.x, npc.z, npc.yaw, npc.color, npc.walkPhase)
                    }
                })
            }

            // All Road Cars
            state.cars.forEach { car ->
                items.add(Drawable3D(distToCam(car.x, car.z)) { c ->
                    draw3DCar(c, car.x, car.z, car.yaw, car.color, car.steerAngle, car.isVan, car.hp < 85f)
                })
            }

            // Player Character with animated arms & legs
            if (state.activeCarId == null && state.cameraMode != CameraMode.FIRST_PERSON) {
                val playerCol = if (state.activeCharIndex == 0) NeonCyan else TashkentGold
                val phase = if (state.isWalking) state.walkPhase else 0f
                items.add(Drawable3D(distToCam(state.playerX, state.playerZ)) { c ->
                    draw3DCharacter(c, state.playerX, state.playerZ, state.playerYaw, playerCol, phase)
                })
            }

            items.sortByDescending { it.distSq }
            items.forEach { it.draw(this, cam) }
        }

        // Right-side 360 Camera Drag Zone
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(0.55f)
                .align(Alignment.CenterEnd)
                .pointerInput(Unit) {
                    detectDragGestures { change, dragAmount ->
                        change.consume()
                        viewModel.orbitCamera(
                            deltaYaw = -dragAmount.x * 0.007f,
                            deltaPitch = dragAmount.y * 0.005f
                        )
                    }
                }
                .testTag("camera_orbit_zone")
        )

        // 2. Minimal Transparent Icon-Only Top HUD (Yozuvlarsiz!)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // Camera Mode Button (1st Person / Close / Far)
                TransparentIconBtn(
                    icon = Icons.Default.Visibility,
                    desc = "Kamera rejimi",
                    active = state.cameraMode == CameraMode.FIRST_PERSON,
                    onClick = { viewModel.cycleCameraMode() },
                    modifier = Modifier.testTag("camera_mode_button")
                )

                // Character Switcher (Cyberpunk Women <-> Wladimir)
                TransparentIconBtn(
                    icon = Icons.Default.Person,
                    desc = "Personaj almashtirish",
                    active = state.activeCharIndex == 1,
                    onClick = { viewModel.switchCharacter() },
                    modifier = Modifier.testTag("switch_char_button")
                )
            }

            // Compact Speed & HP Gauge
            val speedKmh = ((abs(activeCar?.speed ?: 0f)) * 3.6f).roundToInt()
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color(0xFF0F172A).copy(alpha = 0.28f))
                    .border(1.dp, Color.White.copy(alpha = 0.24f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "$speedKmh",
                    color = NeonCyan,
                    fontWeight = FontWeight.Black,
                    fontSize = 15.sp
                )
                Box(
                    modifier = Modifier
                        .width(46.dp)
                        .height(6.dp)
                        .clip(RoundedCornerShape(99.dp))
                        .background(Color.White.copy(alpha = 0.18f))
                ) {
                    val hpRatio = (tuningTargetCar.hp / 100f).coerceIn(0f, 1f)
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(hpRatio)
                            .background(
                                when {
                                    tuningTargetCar.hp > 60f -> EmeraldGas
                                    tuningTargetCar.hp > 30f -> TashkentGold
                                    else -> CrimsonBrake
                                }
                            )
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TransparentIconBtn(
                    icon = Icons.Default.MusicNote,
                    desc = "Radio",
                    active = state.radioOn,
                    onClick = { viewModel.toggleRadio() },
                    modifier = Modifier.testTag("radio_toggle_button")
                )
                TransparentIconBtn(
                    icon = Icons.Default.Palette,
                    desc = "Nomer va Rang",
                    active = false,
                    onClick = { showTuningDialog = true },
                    modifier = Modifier.testTag("tuning_button")
                )
                if (tuningTargetCar.hp < 99f) {
                    TransparentIconBtn(
                        icon = Icons.Default.Build,
                        desc = "Ta'mirlash",
                        active = true,
                        onClick = { viewModel.repairActiveCar() },
                        modifier = Modifier.testTag("repair_car_button")
                    )
                }
            }
        }

        // 3. Bottom Transparent Icon-Only Controls
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.BottomCenter)
                .padding(horizontal = 18.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Bottom
        ) {
            if (activeCar == null) {
                VirtualJoystick(
                    onMove = { dx, dy -> viewModel.setJoystick(dx, dy) },
                    modifier = Modifier.testTag("walk_joystick")
                )
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    TransparentHoldButton(
                        onHoldChanged = { viewModel.setSteer(left = it) },
                        border = Color.White.copy(alpha = 0.35f),
                        modifier = Modifier
                            .size(66.dp)
                            .clip(CircleShape)
                            .testTag("steer_left_button")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                            contentDescription = "Chapga",
                            tint = Color.White,
                            modifier = Modifier.size(34.dp)
                        )
                    }
                    TransparentHoldButton(
                        onHoldChanged = { viewModel.setSteer(right = it) },
                        border = Color.White.copy(alpha = 0.35f),
                        modifier = Modifier
                            .size(66.dp)
                            .clip(CircleShape)
                            .testTag("steer_right_button")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = "O'ngga",
                            tint = Color.White,
                            modifier = Modifier.size(34.dp)
                        )
                    }
                }
            }

            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (state.activeCarId != null || state.nearbyCarId != null) {
                    IconButton(
                        onClick = { viewModel.toggleEnterExit() },
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(TashkentGold.copy(alpha = 0.38f))
                            .border(1.5.dp, Color(0xFFFDE68A), CircleShape)
                            .testTag("enter_exit_car_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.DirectionsCar,
                            contentDescription = "Minish / Tushish",
                            tint = Color.White,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                }

                if (activeCar != null) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        TransparentHoldButton(
                            onHoldChanged = { viewModel.setBrake(it) },
                            border = CrimsonBrake.copy(alpha = 0.7f),
                            modifier = Modifier
                                .width(64.dp)
                                .height(72.dp)
                                .clip(RoundedCornerShape(18.dp))
                                .testTag("brake_pedal_button")
                        ) {
                            Icon(
                                imageVector = Icons.Default.KeyboardArrowDown,
                                contentDescription = "Tormoz",
                                tint = Color.White,
                                modifier = Modifier.size(34.dp)
                            )
                        }
                        TransparentHoldButton(
                            onHoldChanged = { viewModel.setGas(it) },
                            border = EmeraldGas.copy(alpha = 0.75f),
                            modifier = Modifier
                                .width(64.dp)
                                .height(98.dp)
                                .clip(RoundedCornerShape(18.dp))
                                .testTag("gas_pedal_button")
                        ) {
                            Icon(
                                imageVector = Icons.Default.KeyboardArrowUp,
                                contentDescription = "Gaz",
                                tint = Color.White,
                                modifier = Modifier.size(36.dp)
                            )
                        }
                    }
                }
            }
        }
    }

    if (showTuningDialog) {
        TuningDialog(
            car = tuningTargetCar,
            onDismiss = { showTuningDialog = false },
            onApply = { reg, num, col ->
                viewModel.updateCarTuning(tuningTargetCar.id, reg, num, col)
                showTuningDialog = false
            }
        )
    }
}

@Composable
private fun TransparentIconBtn(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    desc: String,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    IconButton(
        onClick = onClick,
        modifier = modifier
            .minimumInteractiveComponentSize()
            .size(46.dp)
            .clip(CircleShape)
            .background(
                if (active) NeonCyan.copy(alpha = 0.25f) else Color(0xFF0F172A).copy(alpha = 0.26f)
            )
            .border(
                1.5.dp,
                if (active) NeonCyan else Color.White.copy(alpha = 0.24f),
                CircleShape
            )
    ) {
        Icon(imageVector = icon, contentDescription = desc, tint = Color.White, modifier = Modifier.size(22.dp))
    }
}

private fun DrawScope.draw3DCharacter(
    cam: Cam3D,
    x: Float,
    z: Float,
    yaw: Float,
    color: Color,
    walkPhase: Float
) {
    val swing = if (walkPhase != 0f) sin(walkPhase) * 0.25f else 0f
    val bob = if (walkPhase != 0f) abs(sin(walkPhase)) * 0.06f else 0f
    // Oyoqlar
    drawBox3D(cam, Vec3(x - 0.14f, 0f, z + swing), 0.18f, 0.72f, 0.2f, yaw, Color(0xFF1E293B), Color(0xFF0F172A), Color(0xFF334155))
    drawBox3D(cam, Vec3(x + 0.14f, 0f, z - swing), 0.18f, 0.72f, 0.2f, yaw, Color(0xFF1E293B), Color(0xFF0F172A), Color(0xFF334155))
    // Tana
    drawBox3D(cam, Vec3(x, 0.72f + bob, z), 0.46f, 0.6f, 0.26f, yaw, color, color.copy(alpha = 0.8f), color)
    // Qo'llar (oyoqlarga qarama-qarshi tebranadi)
    drawBox3D(cam, Vec3(x - 0.34f, 0.78f + bob, z - swing), 0.14f, 0.52f, 0.14f, yaw, color, color.copy(alpha = 0.75f), color)
    drawBox3D(cam, Vec3(x + 0.34f, 0.78f + bob, z + swing), 0.14f, 0.52f, 0.14f, yaw, color, color.copy(alpha = 0.75f), color)
    // Bosh
    drawBox3D(cam, Vec3(x, 1.34f + bob, z), 0.3f, 0.32f, 0.3f, yaw, Color(0xFFFDE68A), Color(0xFFF59E0B), Color(0xFFFEF3C7))
}

private fun DrawScope.drawRoadStrip(
    cam: Cam3D,
    xMin: Float,
    xMax: Float,
    zMin: Float,
    zMax: Float,
    color: Color,
    northSouth: Boolean
) {
    val segs = 12
    for (i in 0 until segs) {
        val t0 = i.toFloat() / segs
        val t1 = (i + 1).toFloat() / segs
        val quad = if (northSouth) {
            val z0 = zMin + (zMax - zMin) * t0
            val z1 = zMin + (zMax - zMin) * t1
            listOf(Vec3(xMin, 0.02f, z0), Vec3(xMax, 0.02f, z0), Vec3(xMax, 0.02f, z1), Vec3(xMin, 0.02f, z1))
        } else {
            val x0 = xMin + (xMax - xMin) * t0
            val x1 = xMin + (xMax - xMin) * t1
            listOf(Vec3(x0, 0.01f, zMin), Vec3(x1, 0.01f, zMin), Vec3(x1, 0.01f, zMax), Vec3(x0, 0.01f, zMax))
        }
        val pts = cam.clipQuad(quad) ?: continue
        val path = Path().apply {
            moveTo(pts[0].x, pts[0].y)
            for (k in 1 until pts.size) lineTo(pts[k].x, pts[k].y)
            close()
        }
        drawPath(path, color = color)

        if (i % 2 == 0) {
            val lineQuad = if (northSouth) {
                val z0 = zMin + (zMax - zMin) * t0
                val z1 = zMin + (zMax - zMin) * (t0 + 0.04f)
                listOf(Vec3(-0.18f, 0.04f, z0), Vec3(0.18f, 0.04f, z0), Vec3(0.18f, 0.04f, z1), Vec3(-0.18f, 0.04f, z1))
            } else {
                val x0 = xMin + (xMax - xMin) * t0
                val x1 = xMin + (xMax - xMin) * (t0 + 0.04f)
                listOf(Vec3(x0, 0.03f, -0.18f), Vec3(x1, 0.03f, -0.18f), Vec3(x1, 0.03f, 0.18f), Vec3(x0, 0.03f, 0.18f))
            }
            cam.clipQuad(lineQuad)?.let { lpts ->
                val lp = Path().apply {
                    moveTo(lpts[0].x, lpts[0].y)
                    for (k in 1 until lpts.size) lineTo(lpts[k].x, lpts[k].y)
                    close()
                }
                drawPath(lp, color = Color(0xFFFACC15))
            }
        }
    }
}

private fun DrawScope.draw3DCar(
    cam: Cam3D,
    x: Float,
    z: Float,
    yaw: Float,
    color: Color,
    steerAngle: Float,
    isVan: Boolean,
    damaged: Boolean
) {
    val w = if (isVan) 1.75f else 1.9f
    val l = if (isVan) 3.7f else 4.3f
    val bodyH = if (isVan) 1.0f else 0.7f
    drawBox3D(cam, Vec3(x, 0.3f, z), w, bodyH, l, yaw, color, color.copy(alpha = 0.8f), color)
    drawBox3D(
        cam,
        Vec3(x, 0.3f + bodyH, z),
        w * 0.85f,
        if (isVan) 0.7f else 0.52f,
        if (isVan) l * 0.78f else l * 0.52f,
        yaw,
        Color(0xFF0F172A),
        Color(0xFF1E293B),
        color
    )
    val wheelOffsets = listOf(
        Triple(-w * 0.48f, -l * 0.32f, yaw + steerAngle),
        Triple(w * 0.48f, -l * 0.32f, yaw + steerAngle),
        Triple(-w * 0.48f, l * 0.32f, yaw),
        Triple(w * 0.48f, l * 0.32f, yaw)
    )
    val cosY = cos(yaw)
    val sinY = sin(yaw)
    wheelOffsets.forEach { (ox, oz, wYaw) ->
        val wx = x + ox * cosY + oz * sinY
        val wz = z - ox * sinY + oz * cosY
        drawBox3D(cam, Vec3(wx, 0f, wz), 0.28f, 0.62f, 0.62f, wYaw, Color(0xFF020617), Color(0xFF111827), Color(0xFF334155))
    }
    if (damaged) {
        cam.projectWorld(Vec3(x, 1.8f, z))?.let { p ->
            drawCircle(color = CrimsonBrake.copy(alpha = 0.7f), radius = 8f, center = p)
        }
    }
}

private fun DrawScope.drawBox3D(
    cam: Cam3D,
    baseCenter: Vec3,
    w: Float,
    h: Float,
    l: Float,
    yaw: Float,
    frontColor: Color,
    sideColor: Color,
    topColor: Color
) {
    val hw = w / 2f
    val hl = l / 2f
    val c = cos(yaw)
    val s = sin(yaw)

    fun pt(lx: Float, ly: Float, lz: Float) = Vec3(
        baseCenter.x + lx * c + lz * s,
        baseCenter.y + ly,
        baseCenter.z - lx * s + lz * c
    )

    val v = listOf(
        pt(-hw, 0f, -hl), pt(hw, 0f, -hl), pt(hw, h, -hl), pt(-hw, h, -hl),
        pt(-hw, 0f, hl), pt(hw, 0f, hl), pt(hw, h, hl), pt(-hw, h, hl)
    )

    val faces = listOf(
        Pair(listOf(v[0], v[1], v[2], v[3]), frontColor),
        Pair(listOf(v[5], v[4], v[7], v[6]), frontColor),
        Pair(listOf(v[4], v[0], v[3], v[7]), sideColor),
        Pair(listOf(v[1], v[5], v[6], v[2]), sideColor),
        Pair(listOf(v[3], v[2], v[6], v[7]), topColor)
    )

    val sortedFaces = faces.map { (quad, col) ->
        val center = Vec3(
            quad.sumOf { it.x.toDouble() }.toFloat() / 4f,
            quad.sumOf { it.y.toDouble() }.toFloat() / 4f,
            quad.sumOf { it.z.toDouble() }.toFloat() / 4f
        )
        val d = center - cam.pos
        Triple(d.dot(d), quad, col)
    }.sortedByDescending { it.first }

    sortedFaces.forEach { (_, quad, col) ->
        val pts = cam.clipQuad(quad) ?: return@forEach
        val path = Path().apply {
            moveTo(pts[0].x, pts[0].y)
            for (i in 1 until pts.size) lineTo(pts[i].x, pts[i].y)
            close()
        }
        drawPath(path, color = col)
        drawPath(path, color = Color.Black.copy(alpha = 0.2f), style = Stroke(width = 1f))
    }
}

@Composable
private fun VirtualJoystick(
    onMove: (Float, Float) -> Unit,
    modifier: Modifier = Modifier
) {
    var knobX by remember { mutableFloatStateOf(0f) }
    var knobY by remember { mutableFloatStateOf(0f) }
    val maxDistPx = 110f

    Box(
        modifier = modifier
            .size(120.dp)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.08f))
            .border(1.5.dp, Color.White.copy(alpha = 0.25f), CircleShape)
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragEnd = {
                        knobX = 0f
                        knobY = 0f
                        onMove(0f, 0f)
                    },
                    onDragCancel = {
                        knobX = 0f
                        knobY = 0f
                        onMove(0f, 0f)
                    }
                ) { change, dragAmount ->
                    change.consume()
                    var nx = knobX + dragAmount.x
                    var ny = knobY + dragAmount.y
                    val d = hypot(nx, ny)
                    if (d > maxDistPx) {
                        nx = (nx / d) * maxDistPx
                        ny = (ny / d) * maxDistPx
                    }
                    knobX = nx
                    knobY = ny
                    onMove(nx / maxDistPx, ny / maxDistPx)
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .offset { IntOffset(knobX.roundToInt(), knobY.roundToInt()) }
                .size(48.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.35f))
                .border(1.5.dp, Color.White.copy(alpha = 0.7f), CircleShape)
        )
    }
}

@Composable
private fun TransparentHoldButton(
    onHoldChanged: (Boolean) -> Unit,
    border: Color,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Box(
        modifier = modifier
            .background(Color(0xFF0F172A).copy(alpha = 0.24f))
            .border(1.5.dp, border, RoundedCornerShape(18.dp))
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        onHoldChanged(true)
                        try {
                            awaitRelease()
                        } finally {
                            onHoldChanged(false)
                        }
                    }
                )
            },
        contentAlignment = Alignment.Center
    ) {
        content()
    }
}

@Composable
private fun TuningDialog(
    car: CarEntity,
    onDismiss: () -> Unit,
    onApply: (String, String, Color) -> Unit
) {
    var region by remember { mutableStateOf(car.plateRegion) }
    var number by remember { mutableStateOf(car.plateNumber) }
    var selectedColor by remember { mutableStateOf(car.color) }

    val palette = listOf(
        Color(0xFFF8FAFC),
        Color(0xFF111827),
        Color(0xFF94A3B8),
        Color(0xFF2563EB),
        Color(0xFFDC2626),
        Color(0xFF059669),
        Color(0xFFF59E0B)
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SlateSurface,
        title = { Text("${car.name}", color = NeonCyan, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Surface(
                    color = Color.White,
                    shape = RoundedCornerShape(8.dp),
                    border = androidx.compose.foundation.BorderStroke(2.dp, Color.Black),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "${region.padStart(2, '0')} | ${number.uppercase()}",
                            color = Color.Black,
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Black,
                            fontSize = 18.sp
                        )
                        Text(
                            text = "UZ",
                            color = Color(0xFF0284C7),
                            fontWeight = FontWeight.Black,
                            fontSize = 13.sp
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = region,
                        onValueChange = { region = it.filter { ch -> ch.isDigit() }.take(2) },
                        label = { Text("Kod") },
                        singleLine = true,
                        modifier = Modifier.width(84.dp)
                    )
                    OutlinedTextField(
                        value = number,
                        onValueChange = { number = it.take(9).uppercase() },
                        label = { Text("Raqam") },
                        singleLine = true,
                        modifier = Modifier.weight(1f)
                    )
                }

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    palette.forEach { col ->
                        val isSel = col == selectedColor
                        Box(
                            modifier = Modifier
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(col)
                                .border(
                                    width = if (isSel) 3.dp else 1.5.dp,
                                    color = if (isSel) NeonCyan else Color.White.copy(alpha = 0.4f),
                                    shape = CircleShape
                                )
                                .clickable { selectedColor = col }
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onApply(region, number, selectedColor) },
                modifier = Modifier.testTag("apply_tuning_button")
            ) {
                Text("OK")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("✕")
            }
        }
    )
}
