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
          <span>点数: {{ pointCloudData.points.length }}</span>
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
import { parsePCDFile } from '../../components/RvizViewer/utils/pcdParser'

// 视口尺寸
const viewerWidth = ref(1200)
const viewerHeight = ref(600)

// 点云数据
const pointCloudData = ref<PointCloudData | undefined>(undefined)

// 路径数据示例
const pathData = ref<PathData[]>([])

// 加载状态
const loading = ref(false)

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
  try {
    const data = await parsePCDFile(selectedFile)
    pointCloudData.value = data
    ElMessage.success(`成功加载点云文件，共 ${data.points.length} 个点`)
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
