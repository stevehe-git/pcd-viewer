<template>
  <div class="point-cloud-viewer">
    <div ref="containerRef" class="viewer-container"></div>
    
    <!-- 加载进度 -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-content">
        <el-progress
          :percentage="loadProgress"
          :status="loadProgress === 100 ? 'success' : undefined"
        />
        <p class="loading-message">{{ loadMessage }}</p>
      </div>
    </div>

    <!-- 控制面板 -->
    <div class="control-panel">
      <el-button-group>
        <el-button size="small" @click="resetCamera">
          <el-icon><Refresh /></el-icon>
          重置视角
        </el-button>
        <el-button size="small" @click="fitToScreen">
          <el-icon><FullScreen /></el-icon>
          适应屏幕
        </el-button>
      </el-button-group>
      
      <div class="point-size-control">
        <span>点大小:</span>
        <el-slider
          v-model="pointSize"
          :min="0.01"
          :max="5"
          :step="0.01"
          style="width: 120px; margin: 0 8px;"
          @change="updatePointSize"
        />
        <span>{{ pointSize.toFixed(1) }}</span>
      </div>
      
      <div class="point-color-control">
        <span>点颜色:</span>
        <el-color-picker
          v-model="pointColor"
          :show-alpha="false"
          @change="updatePointColor"
        />
        <el-button
          size="small"
          text
          style="margin-left: 8px; color: white;"
          @click="resetPointColor"
        >
          重置
        </el-button>
      </div>
      
      <div class="performance-mode-control">
        <el-switch
          v-model="highPerformanceMode"
          active-text="高性能模式"
          inactive-text="标准模式"
          @change="updatePerformanceMode"
        />
      </div>
    </div>

    <!-- 性能统计 - 实时信息显示 -->
    <div class="stats-panel">
      <div class="stats-header">
        <span>实时信息</span>
        <el-button size="small" text @click="showStats = !showStats">
          <el-icon><Close v-if="showStats" /><DataAnalysis v-else /></el-icon>
        </el-button>
      </div>
      <div v-show="showStats" class="stats-content">
        <div class="stats-item">
          <span>FPS:</span>
          <span :class="{ 'fps-good': stats.fps >= 30, 'fps-warning': stats.fps < 30 && stats.fps >= 15, 'fps-bad': stats.fps < 15 }">
            {{ stats.fps }}
          </span>
        </div>
        <div class="stats-item">
          <span>渲染点数:</span>
          <span>{{ stats.renderedPoints.toLocaleString() }}</span>
        </div>
        <div class="stats-item">
          <span>总点数:</span>
          <span>{{ stats.totalPoints.toLocaleString() }}</span>
        </div>
        <div class="stats-item">
          <span>可见分块:</span>
          <span>{{ stats.visibleChunks }}</span>
        </div>
        <div class="stats-item">
          <span>帧时间:</span>
          <span>{{ stats.frameTime.toFixed(2) }}ms</span>
        </div>
        <div class="stats-item">
          <span>模式:</span>
          <span>{{ highPerformanceMode ? '高性能' : '标准' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Refresh, FullScreen, Close, DataAnalysis } from '@element-plus/icons-vue'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PointCloudEngine } from './PointCloudEngine'
import { PointCloudLoader } from './PointCloudLoader'

interface Props {
  pointCloudFile?: File
  autoLoad?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  pointCloudFile: undefined,
  autoLoad: false
})

// 定义事件
const emit = defineEmits<{
  render: [stats: { renderTime: number; pointCount: number }]
  'point-cloud-update': [stats: { pointCount: number; updateTime?: number }]
}>()

const containerRef = ref<HTMLElement | null>(null)
const loading = ref(false)
const loadProgress = ref(0)
const loadMessage = ref('')
const showStats = ref(true) // 默认显示统计信息
const pointSize = ref(0.01) // 默认点大小 0.01
const pointColor = ref<string | null>(null) // null 表示使用原始颜色
const highPerformanceMode = ref(true) // 默认启用高性能模式

let engine: PointCloudEngine | null = null
let loader: PointCloudLoader | null = null
let controls: OrbitControls | null = null
let animationFrameId: number | null = null

// 性能统计
const stats = ref({
  fps: 0,
  renderedPoints: 0,
  totalPoints: 0,
  visibleChunks: 0,
  frameTime: 0
})

// 初始化
onMounted(async () => {
  if (!containerRef.value) return

  // 初始化渲染引擎
  engine = new PointCloudEngine(containerRef.value, {
    maxPointCount: 2000000, // 最多渲染 200 万点
    pointBudget: 1000000, // 点预算 100 万
    pointSize: pointSize.value,
    pointColor: pointColor.value,
    enableLOD: true,
    enableFrustumCulling: true,
    highPerformanceMode: highPerformanceMode.value
  })

  // 初始化相机控制器
  const camera = engine.getCamera()
  const renderer = engine.getRenderer()
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 0.1
  controls.maxDistance = 1000

  // 初始化加载器
  loader = new PointCloudLoader()

  // 开始渲染循环
  startRenderLoop()

  // 如果自动加载且有文件，则加载
  if (props.autoLoad && props.pointCloudFile) {
    await loadPointCloud(props.pointCloudFile)
  }
})

// 监听文件变化
watch(
  () => props.pointCloudFile,
  async (newFile) => {
    if (newFile) {
      await loadPointCloud(newFile)
    }
  }
)

// 加载点云
async function loadPointCloud(file: File): Promise<void> {
  if (!engine || !loader) return

  loading.value = true
  loadProgress.value = 0
  loadMessage.value = '开始加载...'

  try {
    // 清除旧的点云
    if (engine) {
      // 这里需要添加清除方法
    }

    // 加载点云（快速模式：只生成一个 LOD 层级，直接加载原始数据）
    const chunks = await loader.loadPointCloud(file, {
      maxPoints: 10000000, // 最多 1000 万点
      chunkSize: 500000, // 每块 50 万点（增大分块以减少分块数量，加快加载）
      lodLevels: [1], // 只使用最高 LOD，不生成多个层级（加快加载速度，类似 pcl_viewer）
      enableCache: true,
      onProgress: (progress, message) => {
        loadProgress.value = progress
        loadMessage.value = message
      }
    })

    // 添加到渲染引擎
    let totalPointCount = 0
    for (const chunk of chunks) {
      engine.addChunk(chunk)
      totalPointCount += chunk.count
    }

    // 适应屏幕
    engine.fitToScreen()

    // 触发点云更新事件，用于更新父组件的统计面板
    emit('point-cloud-update', {
      pointCount: totalPointCount,
      updateTime: performance.now()
    })

    loadMessage.value = '加载完成'
    setTimeout(() => {
      loading.value = false
    }, 500)
  } catch (error) {
    console.error('加载点云失败:', error)
    loadMessage.value = `加载失败: ${error instanceof Error ? error.message : '未知错误'}`
    loading.value = false
  }
}

// 渲染循环
function startRenderLoop(): void {
  function render() {
    if (!engine || !controls) return

    // 更新控制器
    controls.update()

    // 渲染并记录时间
    const renderStartTime = performance.now()
    engine.render()
    const renderTime = performance.now() - renderStartTime

    // 更新统计
    const engineStats = engine.getStats()
    stats.value = engineStats

    // 触发渲染事件，用于更新父组件的统计面板
    // 传递实际渲染的点数（用于计算每帧大小）
    // 注意：总点数在点云加载时通过 point-cloud-update 事件设置
    emit('render', {
      renderTime,
      pointCount: engineStats.renderedPoints || 0 // 使用实际渲染的点数，如果为0则传递0
    })

    animationFrameId = requestAnimationFrame(render)
  }

  render()
}

// 重置相机
function resetCamera(): void {
  if (!engine) return
  const camera = engine.getCamera()
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  if (controls) {
    controls.update()
  }
}

// 适应屏幕
function fitToScreen(): void {
  if (!engine) return
  engine.fitToScreen()
  if (controls) {
    controls.update()
  }
}

// 更新点大小
function updatePointSize(): void {
  if (!engine) return
  engine.updateOptions({ pointSize: pointSize.value })
}

// 更新点颜色
function updatePointColor(): void {
  if (!engine) return
  engine.updateOptions({ pointColor: pointColor.value })
}

// 重置点颜色（使用原始颜色）
function resetPointColor(): void {
  pointColor.value = null
  updatePointColor()
}

// 更新高性能模式
function updatePerformanceMode(): void {
  if (!engine) return
  engine.updateOptions({ highPerformanceMode: highPerformanceMode.value })
}

// 清理
onUnmounted(() => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId)
  }
  if (engine) {
    engine.dispose()
  }
  if (loader) {
    loader.dispose()
  }
  if (controls) {
    controls.dispose()
  }
})
</script>

<style scoped>
.point-cloud-viewer {
  width: 100%;
  height: 100%;
  position: relative;
  background: #333;
}

.viewer-container {
  width: 100%;
  height: 100%;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.loading-content {
  background: white;
  padding: 24px;
  border-radius: 8px;
  min-width: 300px;
}

.loading-message {
  margin-top: 12px;
  text-align: center;
  color: #666;
  font-size: 14px;
}

.control-panel {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 100;
  background: rgba(0, 0, 0, 0.6);
  padding: 12px;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  backdrop-filter: blur(8px);
}

.point-size-control,
.point-color-control,
.performance-mode-control {
  display: flex;
  align-items: center;
  color: white;
  font-size: 12px;
}

.point-color-control {
  gap: 8px;
}

.performance-mode-control {
  margin-top: 4px;
}

.stats-panel {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 100;
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 12px;
  border-radius: 6px;
  min-width: 200px;
  font-size: 12px;
  backdrop-filter: blur(8px);
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
}

.stats-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stats-item {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
}

.stats-item .fps-good {
  color: #67c23a;
  font-weight: 600;
}

.stats-item .fps-warning {
  color: #e6a23c;
  font-weight: 600;
}

.stats-item .fps-bad {
  color: #f56c6c;
  font-weight: 600;
}
</style>
