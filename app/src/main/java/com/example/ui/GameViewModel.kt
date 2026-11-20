package com.example.ui

import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

enum class CameraMode { CLOSE, FAR, FIRST_PERSON }

data class CarEntity(
    val id: String,
    val name: String,
    val x: Float,
    val z: Float,
    val yaw: Float = 0f,
    val speed: Float = 0f,
    val maxSpeed: Float = 36f,
    val steerAngle: Float = 0f,
    val wheelSpin: Float = 0f,
    val color: Color = Color(0xFFF8FAFC),
    val plateRegion: String = "01",
    val plateNumber: String = "A 777 AA",
    val hp: Float = 100f,
    val isVan: Boolean = false
)

data class NpcEntity(
    val id: Int,
    val x: Float,
    val z: Float,
    val yaw: Float,
    val speed: Float,
    val walkPhase: Float,
    val isCar: Boolean,
    val color: Color
)

data class ChecklistItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val ready: Boolean = true
)

data class GameUiState(
    val playerX: Float = 0f,
    val playerZ: Float = 14f,
    val playerYaw: Float = 0f,
    val walkPhase: Float = 0f,
    val isWalking: Boolean = false,
    val activeCharIndex: Int = 0, // 0: Cyberpunk Women, 1: Wladimir
    val cameraMode: CameraMode = CameraMode.CLOSE,
    val cameraYaw: Float = 0f,
    val cameraPitch: Float = 0.24f,
    val activeCarId: String? = null,
    val nearbyCarId: String? = null,
    val cars: List<CarEntity> = defaultCars(),
    val npcs: List<NpcEntity> = defaultNpcs(),
    val joyX: Float = 0f,
    val joyY: Float = 0f,
    val gasPressed: Boolean = false,
    val brakePressed: Boolean = false,
    val steerLeft: Boolean = false,
    val steerRight: Boolean = false,
    val radioOn: Boolean = false,
    val checklist: List<ChecklistItem> = defaultChecklist()
)

private fun defaultCars() = listOf(
    CarEntity("gentra", "Chevrolet Gentra", -4.5f, 5f, maxSpeed = 38f, color = Color(0xFFF8FAFC), plateRegion = "01", plateNumber = "A 777 AA"),
    CarEntity("nexia", "Daewoo Nexia 2", 4.5f, -6f, maxSpeed = 35f, color = Color(0xFF94A3B8), plateRegion = "01", plateNumber = "O 070 OO"),
    CarEntity("damas", "Chevrolet Damas", -4.5f, -18f, maxSpeed = 28f, color = Color(0xFFF8FAFC), plateRegion = "30", plateNumber = "D 505 DA", isVan = true),
    CarEntity("matiz", "Daewoo Matiz Turbo", 4.5f, 18f, maxSpeed = 36f, color = Color(0xFF10B981), plateRegion = "01", plateNumber = "M 101 MA"),
    CarEntity("malibu", "Chevrolet Malibu Premier", -4.5f, 30f, maxSpeed = 44f, color = Color(0xFF111827), plateRegion = "01", plateNumber = "Z 001 ZZ")
)

private fun defaultNpcs() = listOf(
    NpcEntity(1, -11f, -12f, 0.4f, 1.9f, 0f, isCar = false, color = Color(0xFF38BDF8)),
    NpcEntity(2, 11f, 8f, 2.2f, 1.8f, 1.2f, isCar = false, color = Color(0xFFF472B6)),
    NpcEntity(3, -10f, 18f, -0.8f, 2.0f, 2.4f, isCar = false, color = Color(0xFFA78BFA)),
    NpcEntity(4, 13f, -22f, 3.0f, 1.7f, 0.7f, isCar = false, color = Color(0xFF34D399)),
    NpcEntity(5, 3.2f, -45f, 0f, 13f, 0f, isCar = true, color = Color(0xFFEF4444)),
    NpcEntity(6, -3.2f, 45f, PI.toFloat(), 12.5f, 0f, isCar = true, color = Color(0xFF3B82F6))
)

private fun defaultChecklist() = listOf(
    ChecklistItem("manifest", "models-manifest.json", "Malibu, Matiz, Gentra, Nexia, Damas, Wladimir, TV Tower avtomatik topiladi", true),
    ChecklistItem("perf", "60 FPS Silliq Optimizatsiya", "Baked O(1) height grid + contact shadows + PMREM 9D osmon aks-sadosi", true),
    ChecklistItem("sound", "soundEngine.js (Offline WebAudio)", "Motor RPM, signal, to‘qnashuv, qadam, eshik va radio musiqasi", true),
    ChecklistItem("cam", "3 xil Kamera + Shaffof Tugmalar", "Ko‘z bilan (1-shaxs), Yaqin va Uzoq kamera + yozuvsiz shaffof tugmalar", true),
    ChecklistItem("ci", ".github/workflows/build-apk.yml", "Draco nusxalash + Capacitor Android + fullSensor + APK", true)
)

class GameViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(GameUiState())
    val uiState: StateFlow<GameUiState> = _uiState.asStateFlow()

    init {
        startLoop()
    }

    private fun startLoop() {
        viewModelScope.launch {
            val dt = 0.016f
            while (isActive) {
                stepSimulation(dt)
                delay(16L)
            }
        }
    }

    private fun stepSimulation(dt: Float) {
        _uiState.update { state ->
            var px = state.playerX
            var pz = state.playerZ
            var pYaw = state.playerYaw
            var camYaw = state.cameraYaw
            var walkPhase = state.walkPhase
            var walking = false

            val cars = state.cars.toMutableList()
            val activeIdx = cars.indexOfFirst { it.id == state.activeCarId }

            if (activeIdx >= 0) {
                var car = cars[activeIdx]
                val targetSteer = (if (state.steerLeft) 1f else 0f) - (if (state.steerRight) 1f else 0f)
                val newSteer = car.steerAngle + (targetSteer * 0.52f - car.steerAngle) * (dt * 9f)

                var spd = car.speed
                when {
                    state.gasPressed -> spd += 20f * dt
                    state.brakePressed -> spd -= if (spd > 0.5f) 32f * dt else 13f * dt
                    else -> spd *= 0.965f
                }
                spd = spd.coerceIn(-14f, car.maxSpeed)

                var yaw = car.yaw
                if (abs(spd) > 0.25f) {
                    val dir = if (spd >= 0f) 1f else -1f
                    val speedFactor = (abs(spd) / 6.5f).coerceAtMost(1f)
                    yaw += newSteer * 2.25f * speedFactor * dir * dt
                }

                // Gaz bosganda oldinga (-Z when yaw=0)
                var nx = car.x - sin(yaw) * spd * dt
                var nz = car.z - cos(yaw) * spd * dt
                var hp = car.hp

                val limit = 95f
                if (abs(nx) > limit || abs(nz) > limit) {
                    nx = nx.coerceIn(-limit, limit)
                    nz = nz.coerceIn(-limit, limit)
                    if (abs(spd) > 6f) hp = (hp - abs(spd) * 0.9f).coerceAtLeast(10f)
                    spd *= -0.35f
                }

                for (j in cars.indices) {
                    if (j == activeIdx) continue
                    val other = cars[j]
                    val dist = hypot(nx - other.x, nz - other.z)
                    if (dist < 4.2f && dist > 0.01f) {
                        val pushX = (nx - other.x) / dist
                        val pushZ = (nz - other.z) / dist
                        nx += pushX * (4.2f - dist)
                        nz += pushZ * (4.2f - dist)
                        if (abs(spd) > 5f) hp = (hp - abs(spd) * 1.1f).coerceAtLeast(10f)
                        spd *= -0.35f
                    }
                }

                car = car.copy(
                    x = nx,
                    z = nz,
                    yaw = yaw,
                    speed = spd,
                    steerAngle = newSteer,
                    wheelSpin = car.wheelSpin + (spd * dt) / 0.34f,
                    hp = hp
                )
                cars[activeIdx] = car
                px = nx
                pz = nz
                pYaw = yaw
                if (abs(spd) > 1.2f) {
                    val diff = atan2(sin(yaw - camYaw), cos(yaw - camYaw))
                    camYaw += diff * dt * 2.8f
                }
            } else {
                val mag = hypot(state.joyX, state.joyY)
                if (mag > 0.08f) {
                    walking = true
                    walkPhase += dt * 11f
                    val walkSpeed = 7.5f
                    val fwdX = -sin(camYaw)
                    val fwdZ = -cos(camYaw)
                    val rightX = cos(camYaw)
                    val rightZ = -sin(camYaw)

                    val moveX = fwdX * (-state.joyY) + rightX * state.joyX
                    val moveZ = fwdZ * (-state.joyY) + rightZ * state.joyX
                    val moveLen = hypot(moveX, moveZ).coerceAtLeast(0.001f)

                    val step = walkSpeed * mag.coerceAtMost(1f) * dt
                    px = (px + (moveX / moveLen) * step).coerceIn(-95f, 95f)
                    pz = (pz + (moveZ / moveLen) * step).coerceIn(-95f, 95f)
                    pYaw = atan2(-moveX, -moveZ)
                }
            }

            var nearby: String? = null
            if (activeIdx < 0) {
                var bestD = 5.5f
                cars.forEach { c ->
                    val d = hypot(c.x - px, c.z - pz)
                    if (d < bestD) {
                        bestD = d
                        nearby = c.id
                    }
                }
            }

            val updatedNpcs = state.npcs.map { npc ->
                var nx = npc.x + sin(npc.yaw) * npc.speed * dt
                var nz = npc.z + cos(npc.yaw) * npc.speed * dt
                var nyaw = npc.yaw
                if (abs(nx) > 85f || abs(nz) > 85f) {
                    nyaw += PI.toFloat()
                    nx = nx.coerceIn(-85f, 85f)
                    nz = nz.coerceIn(-85f, 85f)
                }
                npc.copy(x = nx, z = nz, yaw = nyaw, walkPhase = npc.walkPhase + dt * 10f)
            }

            state.copy(
                playerX = px,
                playerZ = pz,
                playerYaw = pYaw,
                walkPhase = walkPhase,
                isWalking = walking,
                cameraYaw = camYaw,
                nearbyCarId = nearby,
                cars = cars,
                npcs = updatedNpcs
            )
        }
    }

    fun setJoystick(dx: Float, dy: Float) {
        _uiState.update { it.copy(joyX = dx, joyY = dy) }
    }

    fun orbitCamera(deltaYaw: Float, deltaPitch: Float) {
        _uiState.update {
            it.copy(
                cameraYaw = it.cameraYaw + deltaYaw,
                cameraPitch = (it.cameraPitch + deltaPitch).coerceIn(-0.2f, 0.95f)
            )
        }
    }

    fun cycleCameraMode() {
        _uiState.update {
            val next = when (it.cameraMode) {
                CameraMode.CLOSE -> CameraMode.FAR
                CameraMode.FAR -> CameraMode.FIRST_PERSON
                CameraMode.FIRST_PERSON -> CameraMode.CLOSE
            }
            it.copy(cameraMode = next)
        }
    }

    fun switchCharacter() {
        _uiState.update {
            if (it.activeCarId != null) it else it.copy(activeCharIndex = (it.activeCharIndex + 1) % 2)
        }
    }

    fun setGas(pressed: Boolean) {
        _uiState.update { it.copy(gasPressed = pressed) }
    }

    fun setBrake(pressed: Boolean) {
        _uiState.update { it.copy(brakePressed = pressed) }
    }

    fun setSteer(left: Boolean? = null, right: Boolean? = null) {
        _uiState.update {
            it.copy(
                steerLeft = left ?: it.steerLeft,
                steerRight = right ?: it.steerRight
            )
        }
    }

    fun toggleEnterExit() {
        _uiState.update { state ->
            if (state.activeCarId != null) {
                val car = state.cars.find { it.id == state.activeCarId }
                val exitX = (car?.x ?: state.playerX) - 2.6f
                val exitZ = car?.z ?: state.playerZ
                val stoppedCars = state.cars.map {
                    if (it.id == state.activeCarId) it.copy(speed = 0f) else it
                }
                state.copy(
                    activeCarId = null,
                    playerX = exitX,
                    playerZ = exitZ,
                    cars = stoppedCars,
                    gasPressed = false,
                    brakePressed = false,
                    steerLeft = false,
                    steerRight = false
                )
            } else if (state.nearbyCarId != null) {
                val car = state.cars.find { it.id == state.nearbyCarId }
                state.copy(
                    activeCarId = state.nearbyCarId,
                    cameraYaw = car?.yaw ?: state.cameraYaw
                )
            } else {
                state
            }
        }
    }

    fun updateCarTuning(carId: String, region: String, number: String, color: Color) {
        _uiState.update { state ->
            val cleanRegion = region.filter { it.isDigit() }.take(2).padStart(2, '0')
            val cleanNumber = number.uppercase().ifBlank { "A 777 AA" }
            val updated = state.cars.map { car ->
                if (car.id == carId) {
                    car.copy(plateRegion = cleanRegion, plateNumber = cleanNumber, color = color)
                } else {
                    car
                }
            }
            state.copy(cars = updated)
        }
    }

    fun repairActiveCar() {
        _uiState.update { state ->
            val targetId = state.activeCarId ?: state.cars.first().id
            val updated = state.cars.map { c ->
                if (c.id == targetId) c.copy(hp = 100f) else c
            }
            state.copy(cars = updated)
        }
    }

    fun toggleRadio() {
        _uiState.update { it.copy(radioOn = !it.radioOn) }
    }

    fun toggleChecklistItem(id: String) {
        _uiState.update { state ->
            state.copy(
                checklist = state.checklist.map { item ->
                    if (item.id == id) item.copy(ready = !item.ready) else item
                }
            )
        }
    }
}
