import { ref, onMounted, onUnmounted } from 'vue'

export interface RenderStats {
  // 总渲染次数
  totalRenderCalls: number
  // 当前 FPS
  fps: number
  // 平均 FPS
  avgFps: number
  // 渲染时间（ms）
  renderTime: number
  // 平均渲染时间（ms）
  avgRenderTime: number
  // 最小渲染时间（ms）
  minRenderTime: number
  // 最大渲染时间（ms）
  maxRenderTime: number
  // 点云总点数（加载的所有点数）
  pointCount: number
  // 每帧数据大小（MB，基于实际渲染的点数）
  frameSize: number
  // 总数据大小（MB，基于所有加载的点数）
  totalDataSize: number
  // 点云更新次数
  pointCloudUpdates: number
  // 最后更新时间
  lastUpdateTime: number
}

export function useRenderStats() {
  const stats = ref<RenderStats>({
    totalRenderCalls: 0,
    fps: 0,
    avgFps: 0,
    renderTime: 0,
    avgRenderTime: 0,
    minRenderTime: Infinity,
    maxRenderTime: 0,
    pointCount: 0,
    frameSize: 0,
    totalDataSize: 0,
    pointCloudUpdates: 0,
    lastUpdateTime: 0
  })

  // FPS 计算相关
  let lastFrameTime = performance.now()
  let frameCount = 0
  let fpsUpdateTime = performance.now()
  const fpsHistory: number[] = []
  const MAX_FPS_HISTORY = 60 // 保留最近60帧的FPS

  // 渲染时间历史
  const renderTimeHistory: number[] = []
  const MAX_RENDER_TIME_HISTORY = 100

  // 更新间隔（用于控制台打印）
  let lastPrintTime = performance.now()
  const PRINT_INTERVAL = 2000 // 每2秒打印一次

  // 保存总点数（从点云加载时设置，不会被渲染覆盖）
  let totalPointCount = 0

  /**
   * 记录一次渲染
   */
  function recordRender(renderTime: number, renderedPointCount: number = 0): void {
    const now = performance.now()
    
    // 更新总渲染次数
    stats.value.totalRenderCalls++
    
    // 更新渲染时间
    stats.value.renderTime = renderTime
    renderTimeHistory.push(renderTime)
    if (renderTimeHistory.length > MAX_RENDER_TIME_HISTORY) {
      renderTimeHistory.shift()
    }
    
    // 计算平均、最小、最大渲染时间
    if (renderTimeHistory.length > 0) {
      stats.value.avgRenderTime = renderTimeHistory.reduce((a, b) => a + b, 0) / renderTimeHistory.length
      stats.value.minRenderTime = Math.min(...renderTimeHistory)
      stats.value.maxRenderTime = Math.max(...renderTimeHistory)
    }
    
    // 注意：pointCount 字段保持为总点数，不会被渲染点数覆盖
    // 使用实际渲染的点数来计算每帧大小
    const bytesPerPoint = 12 // 基础位置数据（x, y, z 各 4 字节）
    const colorBytesPerPoint = 3 // 颜色数据（r, g, b 各 1 字节，Uint8Array）
    const totalBytesPerPoint = bytesPerPoint + colorBytesPerPoint // 总共 15 字节/点
    const frameSizeBytes = renderedPointCount * totalBytesPerPoint
    stats.value.frameSize = frameSizeBytes / (1024 * 1024) // 转换为 MB
    
    // 计算 FPS
    frameCount++
    const deltaTime = now - lastFrameTime
    lastFrameTime = now
    
    if (deltaTime > 0) {
      const currentFps = 1000 / deltaTime
      fpsHistory.push(currentFps)
      if (fpsHistory.length > MAX_FPS_HISTORY) {
        fpsHistory.shift()
      }
      
      // 每秒更新一次 FPS 显示
      if (now - fpsUpdateTime >= 1000) {
        stats.value.fps = Math.round(currentFps)
        if (fpsHistory.length > 0) {
          stats.value.avgFps = Math.round(
            fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length
          )
        }
        fpsUpdateTime = now
      }
    }
    
    // 定期打印到控制台
    if (now - lastPrintTime >= PRINT_INTERVAL) {
      printStats()
      lastPrintTime = now
    }
  }

  /**
   * 记录点云更新
   */
  function recordPointCloudUpdate(pointCount: number, updateTime?: number): void {
    stats.value.pointCloudUpdates++
    // 更新总点数（点云加载时的总点数）
    totalPointCount = pointCount
    stats.value.pointCount = pointCount
    stats.value.lastUpdateTime = updateTime || performance.now()
    
    // 计算总数据大小（包含位置和颜色数据）
    const bytesPerPoint = 12 // 基础位置数据（x, y, z 各 4 字节）
    const colorBytesPerPoint = 3 // 颜色数据（r, g, b 各 1 字节）
    const totalBytesPerPoint = bytesPerPoint + colorBytesPerPoint // 总共 15 字节/点
    const totalBytes = pointCount * totalBytesPerPoint
    stats.value.totalDataSize = totalBytes / (1024 * 1024) // 转换为 MB
  }

  /**
   * 打印统计信息到控制台
   */
  function printStats(): void {
    const s = stats.value
    console.group('📊 渲染统计信息')
    console.log('总渲染次数:', s.totalRenderCalls.toLocaleString())
    console.log('当前 FPS:', s.fps, '| 平均 FPS:', s.avgFps)
    console.log('渲染时间:', {
      当前: `${s.renderTime.toFixed(2)}ms`,
      平均: `${s.avgRenderTime.toFixed(2)}ms`,
      最小: `${s.minRenderTime === Infinity ? 'N/A' : s.minRenderTime.toFixed(2) + 'ms'}`,
      最大: `${s.maxRenderTime.toFixed(2)}ms`
    })
    console.log('点云信息:', {
      点数: s.pointCount.toLocaleString(),
      每帧大小: `${s.frameSize.toFixed(2)}MB`,
      总数据大小: `${s.totalDataSize.toFixed(2)}MB`,
      更新次数: s.pointCloudUpdates
    })
    console.log('点云打印频率:', s.pointCloudUpdates > 0 
      ? `${(s.totalRenderCalls / s.pointCloudUpdates).toFixed(2)} 帧/次更新`
      : 'N/A'
    )
    console.groupEnd()
  }

  /**
   * 重置统计信息
   */
  function resetStats(): void {
    stats.value = {
      totalRenderCalls: 0,
      fps: 0,
      avgFps: 0,
      renderTime: 0,
      avgRenderTime: 0,
      minRenderTime: Infinity,
      maxRenderTime: 0,
      pointCount: 0,
      frameSize: 0,
      totalDataSize: 0,
      pointCloudUpdates: 0,
      lastUpdateTime: 0
    }
    frameCount = 0
    fpsHistory.length = 0
    renderTimeHistory.length = 0
    lastFrameTime = performance.now()
    fpsUpdateTime = performance.now()
    lastPrintTime = performance.now()
    console.log('✅ 渲染统计已重置')
  }

  return {
    stats,
    recordRender,
    recordPointCloudUpdate,
    printStats,
    resetStats
  }
}
