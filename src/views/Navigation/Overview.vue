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
        <el-button v-if="currentFile" @click="clearPointCloud">
          <el-icon><Delete /></el-icon>
          清除点云
        </el-button>
        <div v-if="currentFile" class="point-cloud-info">
          <span>文件: {{ currentFile.name }}</span>
        </div>
      </div>
    </div>
    <div class="content">
      <div class="viewer-wrapper">
        <!-- 高性能渲染引擎（支持千万级点云） -->
        <PointCloudViewer
          v-if="currentFile"
          :point-cloud-file="currentFile"
          :auto-load="true"
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
import PointCloudViewer from '../../components/PointCloudEngine/PointCloudViewer.vue'
import { useRenderStats } from '../../composables/useRenderStats'

// 加载状态
const loading = ref(false)
const currentFile = ref<File | undefined>(undefined)

// 渲染统计
const { stats: renderStats, recordRender, recordPointCloudUpdate, printStats, resetStats } = useRenderStats()
const showRenderStats = ref(true) // 默认显示统计面板

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

// 处理文件选择
function handleFileChange(file: any): void {
  const selectedFile = file.raw || file
  if (!selectedFile) {
    return
  }

  if (!selectedFile.name.toLowerCase().endsWith('.pcd')) {
    ElMessage.error('请选择PCD格式的文件')
    return
  }

  // 保存文件引用（由 PointCloudViewer 处理加载）
  currentFile.value = selectedFile
  ElMessage.success('开始加载点云文件...')
}

// 清除点云
function clearPointCloud(): void {
  currentFile.value = undefined
  ElMessage.info('已清除点云')
}

onMounted(() => {
  // 初始化完成，等待用户加载PCD文件
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
