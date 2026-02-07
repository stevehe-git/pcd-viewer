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
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { Upload, Delete } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import RvizViewer from '../../components/RvizViewer/RvizViewer.vue'
import type { PointCloudData, PathData } from '../../components/RvizViewer/types'
import { parsePCDFile, downsamplePointCloud } from '../../components/RvizViewer/utils/pcdParser'
import { checkCoordinateOrder } from '../../components/RvizViewer/utils/pcdDebug'

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
    
    const parseTime = performance.now() - startTime
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
  let minX = points[0].x
  let minY = points[0].y
  let minZ = points[0].z
  let maxX = points[0].x
  let maxY = points[0].y
  let maxZ = points[0].z
  
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
</style>
