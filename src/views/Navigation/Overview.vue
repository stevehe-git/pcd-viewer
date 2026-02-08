<template>
  <div class="page-container">
    <div class="header-section">
      <h1>导航概览</h1>
      <div class="file-controls">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".pcd"
          @change="handleFileChange"
        >
          <template #trigger>
            <el-button type="primary" :loading="loading">
              <el-icon><Upload /></el-icon>
              加载PCD文件
            </el-button>
          </template>
        </el-upload>
        <el-button v-if="pointCloudData" @click="clearPointCloud">
          <el-icon><Delete /></el-icon>
          清除点云
        </el-button>
        <div v-if="pointCloudData" class="point-cloud-info">
          <span>点数: {{ pointCloudData.points.length.toLocaleString() }}</span>
          <el-checkbox v-model="autoDownsample" size="small" style="margin-left: 12px;">
            自动下采样
          </el-checkbox>
          <el-button size="small" @click="debugPointCloud" style="margin-left: 8px;">
            调试信息
          </el-button>
        </div>
      </div>
    </div>
    <div class="content">
      <div class="viewer-wrapper">
        <RvizViewer
          :width="viewerWidth"
          :height="viewerHeight"
          :point-cloud="pointCloudData"
          :paths="pathData"
          :options="viewerOptions"
          @render="handleRender"
          @point-cloud-update="handlePointCloudUpdate"
        />
        <!-- 渲染信息面板 -->
        <div v-if="showRenderStats" class="render-stats-panel">
          <div class="stats-header">
            <span>渲染统计</span>
            <el-button size="small" text @click="showRenderStats = false">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
          <div class="stats-content">
            <div class="stats-item">
              <span class="stats-label">总渲染次数:</span>
              <span class="stats-value">{{ renderStats.totalRenderCalls.toLocaleString() }}</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">当前 FPS:</span>
              <span class="stats-value">{{ renderStats.fps }}</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">平均 FPS:</span>
              <span class="stats-value">{{ renderStats.avgFps }}</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">渲染时间:</span>
              <span class="stats-value">{{ renderStats.renderTime.toFixed(2) }}ms</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">平均渲染时间:</span>
              <span class="stats-value">{{ renderStats.avgRenderTime.toFixed(2) }}ms</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">最小/最大:</span>
              <span class="stats-value">
                {{ renderStats.minRenderTime === Infinity ? 'N/A' : renderStats.minRenderTime.toFixed(2) }}ms / 
                {{ renderStats.maxRenderTime.toFixed(2) }}ms
              </span>
            </div>
            <div class="stats-item">
              <span class="stats-label">点云点数:</span>
              <span class="stats-value">{{ renderStats.pointCount.toLocaleString() }}</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">每帧大小:</span>
              <span class="stats-value">{{ renderStats.frameSize.toFixed(2) }}MB</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">总数据大小:</span>
              <span class="stats-value">{{ renderStats.totalDataSize.toFixed(2) }}MB</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">点云更新次数:</span>
              <span class="stats-value">{{ renderStats.pointCloudUpdates }}</span>
            </div>
            <div class="stats-item">
              <span class="stats-label">打印频率:</span>
              <span class="stats-value">
                {{ renderStats.pointCloudUpdates > 0 
                  ? (renderStats.totalRenderCalls / renderStats.pointCloudUpdates).toFixed(2) + ' 帧/次'
                  : 'N/A'
                }}
              </span>
            </div>
            <div class="stats-actions">
              <el-button size="small" @click="resetRenderStats">重置统计</el-button>
              <el-button size="small" @click="printRenderStats">打印到控制台</el-button>
            </div>
          </div>
        </div>
        <!-- 显示/隐藏统计面板按钮 -->
        <el-button 
          v-if="!showRenderStats" 
          class="toggle-stats-btn"
          size="small"
          @click="showRenderStats = true"
        >
          <el-icon><DataAnalysis /></el-icon>
          显示渲染统计
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Upload, Delete, Close, DataAnalysis } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import RvizViewer from '../../components/RvizViewer/RvizViewer.vue'
import type { PointCloudData, PathData } from '../../components/RvizViewer/types'
import { parsePCDFile, downsamplePointCloud } from '../../components/RvizViewer/utils/pcdParser'
import { checkCoordinateOrder } from '../../components/RvizViewer/utils/pcdDebug'
import { useRenderStats } from '../../composables/useRenderStats'

// 视口尺寸
const viewerWidth = ref(1200)
const viewerHeight = ref(600)

// 点云数据
const pointCloudData = ref<PointCloudData | undefined>(undefined)

// 路径数据示例
const pathData = ref<PathData[]>([])

// 加载状态
const loading = ref(false)
const autoDownsample = ref(true) // 默认启用自动下采样

// 渲染统计
const { stats: renderStats, recordRender, recordPointCloudUpdate, printStats, resetStats } = useRenderStats()
const showRenderStats = ref(false)

// 处理渲染事件
function handleRender(stats: { renderTime: number; pointCount: number }): void {
  recordRender(stats.renderTime, stats.pointCount)
}

// 处理点云更新事件
function handlePointCloudUpdate(stats: { pointCount: number; updateTime?: number }): void {
  recordPointCloudUpdate(stats.pointCount, stats.updateTime)
}

// 重置渲染统计
function resetRenderStats(): void {
  resetStats()
  ElMessage.success('渲染统计已重置')
}

// 打印渲染统计
function printRenderStats(): void {
  printStats()
  ElMessage.success('渲染统计已打印到控制台')
}

// 查看器选项（rviz 风格：深灰色背景，浅灰色网格）
const viewerOptions = {
  clearColor: [0.2, 0.2, 0.2, 1.0] as [number, number, number, number], // 深灰色背景 #333333
  enableGrid: true,
  enableAxes: false, // rviz 默认不显示坐标轴
  gridSize: 10,
  gridDivisions: 5, // 5个格子（从-5到5，共10个格子）
  gridColor: [0.67, 0.67, 0.67, 1.0] as [number, number, number, number] // 浅灰色网格 #AAAAAA
}

// 处理文件选择
async function handleFileChange(file: any): Promise<void> {
  const selectedFile = file.raw || file
  if (!selectedFile) {
    return
  }

  if (!selectedFile.name.toLowerCase().endsWith('.pcd')) {
    ElMessage.error('请选择PCD格式的文件')
    return
  }

  loading.value = true
  const startTime = performance.now()
  
  try {
    // 解析PCD文件
    let data = await parsePCDFile(selectedFile)
    
    // 验证数据有效性
    if (!data || !data.points || data.points.length === 0) {
      throw new Error('解析后的点云数据为空')
    }
    
    const originalPoints = data.points.length
    
    // 如果启用自动下采样且点数超过阈值，进行下采样
    if (autoDownsample.value && originalPoints > 1000000) {
      const downsampleStart = performance.now()
      // 使用体素下采样，保持空间分布（类似 PCL.js 的 VoxelGrid）
      const downsampled = downsamplePointCloud(data, 1000000, 'voxel')
      if (downsampled instanceof Promise) {
        data = await downsampled
      } else {
        data = downsampled
      }
      
      // 验证下采样后的数据
      if (!data || !data.points || data.points.length === 0) {
        throw new Error('下采样后的点云数据为空')
      }
      
      const downsampleTime = performance.now() - downsampleStart
      console.log(`下采样: ${originalPoints.toLocaleString()} -> ${data.points.length.toLocaleString()} 点 (${downsampleTime.toFixed(0)}ms)`)
    }
    
    const totalTime = performance.now() - startTime
    
    // 根据点数量调整点大小
    const numPoints = data.points.length
    if (numPoints > 1000000) {
      data.pointSize = 0.5 // 超大点云使用非常小的点
    } else if (numPoints > 500000) {
      data.pointSize = 1.0
    } else if (numPoints > 100000) {
      data.pointSize = 1.5
    } else {
      data.pointSize = 2.0
    }
    
    pointCloudData.value = data
    
    const message = originalPoints > data.points.length
      ? `成功加载点云文件，共 ${data.points.length.toLocaleString()} 个点 (原始: ${originalPoints.toLocaleString()}, ${totalTime.toFixed(0)}ms)`
      : `成功加载点云文件，共 ${numPoints.toLocaleString()} 个点 (${totalTime.toFixed(0)}ms)`
    
    ElMessage.success(message)
  } catch (error) {
    console.error('Failed to parse PCD file:', error)
    ElMessage.error(`加载PCD文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
  } finally {
    loading.value = false
  }
}

// 清除点云
function clearPointCloud(): void {
  pointCloudData.value = undefined
  ElMessage.info('已清除点云数据')
}

// 调试点云信息
function debugPointCloud(): void {
  if (!pointCloudData.value) return
  
  const data = pointCloudData.value
  const points = data.points
  
  if (points.length === 0) {
    ElMessage.warning('点云数据为空')
    return
  }
  
  // 计算边界（使用循环避免栈溢出）
  const firstPoint = points[0]
  if (!firstPoint) {
    ElMessage.warning('点云数据格式错误')
    return
  }
  
  let minX = firstPoint.x
  let minY = firstPoint.y
  let minZ = firstPoint.z
  let maxX = firstPoint.x
  let maxY = firstPoint.y
  let maxZ = firstPoint.z
  
  // 对于大点云，只计算前10000个点的边界作为示例
  const sampleSize = Math.min(points.length, 10000)
  for (let i = 1; i < sampleSize; i++) {
    const p = points[i]
    if (!p) continue
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    minZ = Math.min(minZ, p.z)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    maxZ = Math.max(maxZ, p.z)
  }
  
  const bounds = {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  }
  
  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z
  }
  
  // 检查坐标轴顺序
  const coordinateOrders = checkCoordinateOrder(points)
  
  console.log('点云调试信息:', {
    点数: points.length,
    边界: bounds,
    尺寸: size,
    前5个点: points.slice(0, 5),
    后5个点: points.slice(-5),
    坐标轴顺序分析: coordinateOrders,
    建议: '如果形状不对，可能是坐标轴顺序问题。检查各顺序的范围，找出最合理的顺序。'
  })
  
  ElMessage.info(`点云信息已输出到控制台 (点数: ${points.length.toLocaleString()})`)
}

// 更新视口尺寸
function updateViewportSize(): void {
  const container = document.querySelector('.viewer-wrapper')
  if (container) {
    viewerWidth.value = container.clientWidth
    viewerHeight.value = container.clientHeight
  }
}

onMounted(() => {
  updateViewportSize()
  window.addEventListener('resize', updateViewportSize)
  // 初始化完成，等待用户加载PCD文件
})

onUnmounted(() => {
  window.removeEventListener('resize', updateViewportSize)
})
</script>

<style scoped>
.page-container {
  padding: 20px;
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

h1 {
  color: #2c3e50;
  margin: 0;
}

.file-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.point-cloud-info {
  padding: 8px 12px;
  background: #f0f0f0;
  border-radius: 4px;
  font-size: 14px;
  color: #666;
}

.content {
  flex: 1;
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.viewer-wrapper {
  flex: 1;
  width: 100%;
  min-height: 500px;
  position: relative;
}

.render-stats-panel {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 100;
  background: rgba(0, 0, 0, 0.85);
  color: #fff;
  padding: 12px;
  border-radius: 6px;
  min-width: 280px;
  max-width: 320px;
  font-size: 12px;
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.stats-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  font-weight: 600;
  font-size: 14px;
}

.stats-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stats-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.stats-label {
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
}

.stats-value {
  color: #fff;
  font-weight: 500;
  font-size: 12px;
  font-family: 'Courier New', monospace;
}

.stats-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
}

.toggle-stats-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 100;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: none;
  backdrop-filter: blur(8px);
}

.toggle-stats-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}
</style>
