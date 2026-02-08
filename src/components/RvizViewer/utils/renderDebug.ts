/**
 * 渲染调试工具
 * 封装渲染相关的调试功能，提供详细的调试信息输出
 */

export interface RenderDebugOptions {
  enabled: boolean
  logLevel: 'none' | 'basic' | 'detailed' | 'verbose'
  logRenderCalls: boolean
  logPointCloudUpdates: boolean
  logPerformance: boolean
  logMemory: boolean
}

export interface RenderStats {
  renderCalls: number
  pointCloudUpdates: number
  lastRenderTime: number
  lastUpdateTime: number
  pointCount: number
  bufferSize: number
  memoryUsage?: {
    used: number
    total: number
  }
}

class RenderDebugger {
  private options: RenderDebugOptions = {
    enabled: false,
    logLevel: 'basic',
    logRenderCalls: false,
    logPointCloudUpdates: false,
    logPerformance: false,
    logMemory: false
  }

  private stats: RenderStats = {
    renderCalls: 0,
    pointCloudUpdates: 0,
    lastRenderTime: 0,
    lastUpdateTime: 0,
    pointCount: 0,
    bufferSize: 0
  }

  private renderTimings: number[] = []
  private updateTimings: number[] = []
  private readonly MAX_TIMINGS = 100

  /**
   * 配置调试选项
   */
  configure(options: Partial<RenderDebugOptions>): void {
    this.options = { ...this.options, ...options }
    if (this.options.enabled) {
      console.log('[RenderDebug] 调试已启用', this.options)
    }
  }

  /**
   * 启用/禁用调试
   */
  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled
    if (enabled) {
      console.log('[RenderDebug] 调试已启用')
    }
  }

  /**
   * 记录渲染调用
   */
  logRender(
    projection: any,
    view: any,
    viewport: { width: number; height: number },
    pointCount?: number
  ): void {
    if (!this.options.enabled) return

    this.stats.renderCalls++
    const now = performance.now()
    const renderTime = now - this.stats.lastRenderTime
    this.stats.lastRenderTime = now

    if (this.options.logPerformance) {
      this.renderTimings.push(renderTime)
      if (this.renderTimings.length > this.MAX_TIMINGS) {
        this.renderTimings.shift()
      }
    }

    if (this.options.logRenderCalls) {
      const level = this.options.logLevel
      const info: any = {
        call: this.stats.renderCalls,
        viewport: { width: viewport.width, height: viewport.height },
        renderTime: level !== 'none' ? `${renderTime.toFixed(2)}ms` : undefined
      }

      if (pointCount !== undefined) {
        info.pointCount = pointCount
      }

      if (level === 'detailed' || level === 'verbose') {
        info.projection = this.formatMatrix(projection)
        info.view = this.formatMatrix(view)
      }

      if (level === 'verbose') {
        const avgTime = this.renderTimings.length > 0
          ? this.renderTimings.reduce((a, b) => a + b, 0) / this.renderTimings.length
          : 0
        const minTime = this.renderTimings.length > 0 ? Math.min(...this.renderTimings) : 0
        const maxTime = this.renderTimings.length > 0 ? Math.max(...this.renderTimings) : 0
        info.performance = {
          avg: `${avgTime.toFixed(2)}ms`,
          min: `${minTime.toFixed(2)}ms`,
          max: `${maxTime.toFixed(2)}ms`,
          samples: this.renderTimings.length
        }
      }

      console.log('[RenderDebug] 渲染调用', info)
    }
  }

  /**
   * 记录点云更新
   */
  logPointCloudUpdate(
    data: {
      pointCount: number
      hasColors: boolean
      pointSize: number
      bufferSize?: number
    },
    updateTime?: number
  ): void {
    if (!this.options.enabled) return

    this.stats.pointCloudUpdates++
    const now = performance.now()
    const timeSinceLastUpdate = now - this.stats.lastUpdateTime
    this.stats.lastUpdateTime = now

    if (updateTime !== undefined && this.options.logPerformance) {
      this.updateTimings.push(updateTime)
      if (this.updateTimings.length > this.MAX_TIMINGS) {
        this.updateTimings.shift()
      }
    }

    this.stats.pointCount = data.pointCount
    if (data.bufferSize !== undefined) {
      this.stats.bufferSize = data.bufferSize
    }

    if (this.options.logPointCloudUpdates) {
      const level = this.options.logLevel
      const info: any = {
        update: this.stats.pointCloudUpdates,
        pointCount: data.pointCount.toLocaleString(),
        hasColors: data.hasColors,
        pointSize: data.pointSize,
        timeSinceLastUpdate: level !== 'none' ? `${timeSinceLastUpdate.toFixed(2)}ms` : undefined
      }

      if (data.bufferSize !== undefined) {
        info.bufferSize = `${(data.bufferSize / 1024).toFixed(2)}KB`
      }

      if (updateTime !== undefined && level !== 'none') {
        info.updateTime = `${updateTime.toFixed(2)}ms`
      }

      if (level === 'detailed' || level === 'verbose') {
        const memoryInfo = this.getMemoryInfo()
        if (memoryInfo) {
          info.memory = memoryInfo
        }
      }

      if (level === 'verbose' && this.updateTimings.length > 0) {
        const avgTime = this.updateTimings.reduce((a, b) => a + b, 0) / this.updateTimings.length
        const minTime = Math.min(...this.updateTimings)
        const maxTime = Math.max(...this.updateTimings)
        info.updatePerformance = {
          avg: `${avgTime.toFixed(2)}ms`,
          min: `${minTime.toFixed(2)}ms`,
          max: `${maxTime.toFixed(2)}ms`,
          samples: this.updateTimings.length
        }
      }

      console.log('[RenderDebug] 点云更新', info)
    }
  }

  /**
   * 记录命令创建
   */
  logCommandCreation(commandType: string, details?: any): void {
    if (!this.options.enabled || this.options.logLevel === 'none') return

    const info: any = { commandType }
    if (details) {
      Object.assign(info, details)
    }

    if (this.options.logLevel === 'verbose') {
      console.log('[RenderDebug] 命令创建', info)
    } else if (this.options.logLevel === 'detailed') {
      console.log('[RenderDebug] 命令创建', commandType)
    }
  }

  /**
   * 记录缓冲区创建
   */
  logBufferCreation(
    bufferType: string,
    size: number,
    dataType?: string
  ): void {
    if (!this.options.enabled || this.options.logLevel === 'none') return

    const info: any = {
      bufferType,
      size: `${(size / 1024).toFixed(2)}KB`,
      elementCount: size
    }

    if (dataType) {
      info.dataType = dataType
    }

    if (this.options.logLevel === 'verbose') {
      console.log('[RenderDebug] 缓冲区创建', info)
    }
  }

  /**
   * 记录绘制调用
   */
  logDrawCall(
    commandType: string,
    count: number,
    details?: any
  ): void {
    if (!this.options.enabled || this.options.logLevel === 'none') return

    const info: any = {
      commandType,
      count
    }

    if (details) {
      Object.assign(info, details)
    }

    if (this.options.logLevel === 'verbose') {
      console.log('[RenderDebug] 绘制调用', info)
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): RenderStats {
    return { ...this.stats }
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(): {
    render: {
      avg: number
      min: number
      max: number
      samples: number
    }
    update: {
      avg: number
      min: number
      max: number
      samples: number
    }
  } | null {
    if (!this.options.logPerformance) return null

    const renderStats = this.renderTimings.length > 0
      ? {
          avg: this.renderTimings.reduce((a, b) => a + b, 0) / this.renderTimings.length,
          min: Math.min(...this.renderTimings),
          max: Math.max(...this.renderTimings),
          samples: this.renderTimings.length
        }
      : { avg: 0, min: 0, max: 0, samples: 0 }

    const updateStats = this.updateTimings.length > 0
      ? {
          avg: this.updateTimings.reduce((a, b) => a + b, 0) / this.updateTimings.length,
          min: Math.min(...this.updateTimings),
          max: Math.max(...this.updateTimings),
          samples: this.updateTimings.length
        }
      : { avg: 0, min: 0, max: 0, samples: 0 }

    return { render: renderStats, update: updateStats }
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      renderCalls: 0,
      pointCloudUpdates: 0,
      lastRenderTime: 0,
      lastUpdateTime: 0,
      pointCount: 0,
      bufferSize: 0
    }
    this.renderTimings = []
    this.updateTimings = []
    console.log('[RenderDebug] 统计信息已重置')
  }

  /**
   * 打印完整统计报告
   */
  printReport(): void {
    if (!this.options.enabled) {
      console.warn('[RenderDebug] 调试未启用')
      return
    }

    const stats = this.getStats()
    const perfStats = this.getPerformanceStats()

    console.group('[RenderDebug] 统计报告')
    console.log('渲染统计:', {
      渲染调用次数: stats.renderCalls,
      点云更新次数: stats.pointCloudUpdates,
      当前点数: stats.pointCount.toLocaleString(),
      缓冲区大小: `${(stats.bufferSize / 1024).toFixed(2)}KB`
    })

    if (perfStats) {
      console.log('性能统计:', {
        渲染: {
          平均: `${perfStats.render.avg.toFixed(2)}ms`,
          最小: `${perfStats.render.min.toFixed(2)}ms`,
          最大: `${perfStats.render.max.toFixed(2)}ms`,
          样本数: perfStats.render.samples
        },
        更新: {
          平均: `${perfStats.update.avg.toFixed(2)}ms`,
          最小: `${perfStats.update.min.toFixed(2)}ms`,
          最大: `${perfStats.update.max.toFixed(2)}ms`,
          样本数: perfStats.update.samples
        }
      })
    }

    const memoryInfo = this.getMemoryInfo()
    if (memoryInfo) {
      console.log('内存信息:', memoryInfo)
    }

    console.groupEnd()
  }

  /**
   * 格式化矩阵为字符串
   */
  private formatMatrix(matrix: any): string {
    if (!matrix || !Array.isArray(matrix)) return 'N/A'
    if (matrix.length === 16) {
      // 4x4矩阵
      return `[
        [${matrix[0].toFixed(3)}, ${matrix[4].toFixed(3)}, ${matrix[8].toFixed(3)}, ${matrix[12].toFixed(3)}],
        [${matrix[1].toFixed(3)}, ${matrix[5].toFixed(3)}, ${matrix[9].toFixed(3)}, ${matrix[13].toFixed(3)}],
        [${matrix[2].toFixed(3)}, ${matrix[6].toFixed(3)}, ${matrix[10].toFixed(3)}, ${matrix[14].toFixed(3)}],
        [${matrix[3].toFixed(3)}, ${matrix[7].toFixed(3)}, ${matrix[11].toFixed(3)}, ${matrix[15].toFixed(3)}]
      ]`
    }
    return JSON.stringify(matrix)
  }

  /**
   * 获取内存信息（如果可用）
   */
  private getMemoryInfo(): { used: string; total: string; percentage: string } | null {
    if (!this.options.logMemory) return null

    // @ts-ignore - performance.memory 可能不存在
    const memory = performance.memory
    if (!memory) return null

    const used = memory.usedJSHeapSize
    const total = memory.totalJSHeapSize
    const percentage = ((used / total) * 100).toFixed(2)

    return {
      used: `${(used / 1024 / 1024).toFixed(2)}MB`,
      total: `${(total / 1024 / 1024).toFixed(2)}MB`,
      percentage: `${percentage}%`
    }
  }
}

// 导出单例实例
export const renderDebug = new RenderDebugger()

// 导出便捷函数
export function enableRenderDebug(level: 'basic' | 'detailed' | 'verbose' = 'basic'): void {
  renderDebug.configure({
    enabled: true,
    logLevel: level,
    logRenderCalls: true,
    logPointCloudUpdates: true,
    logPerformance: true,
    logMemory: level === 'detailed' || level === 'verbose'
  })
}

export function disableRenderDebug(): void {
  renderDebug.setEnabled(false)
}

export function printRenderStats(): void {
  renderDebug.printReport()
}
