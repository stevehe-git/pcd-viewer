/**
 * 场景管理器
 * 基于 regl-worldview 的架构，使用命令系统管理场景对象
 */
import type { Regl, PointCloudData, PathData, RenderOptions } from '../types'
import { grid, defaultAxes, lines, makePointsCommand } from '../commands'
import type { CameraState } from '../camera'

export class SceneManager {
  private reglContext: Regl
  private worldviewContext: any // WorldviewContext
  private gridCommand: any = null
  private axesCommand: any = null
  private pointsCommand: any = null
  private linesCommand: any = null

  private gridData: any = null
  private axesData: any = null
  private pointCloudData: any = null
  private pathsData: any[] = []

  private options: Required<Omit<RenderOptions, 'gridColor'>> & { gridColor: [number, number, number, number] }
  private gridVisible = true
  private axesVisible = true

  constructor(reglContext: Regl, worldviewContext: any, options?: RenderOptions) {
    this.reglContext = reglContext
    this.worldviewContext = worldviewContext
    this.options = {
      clearColor: options?.clearColor || [0.2, 0.2, 0.2, 1.0],
      enableGrid: options?.enableGrid ?? true,
      enableAxes: options?.enableAxes ?? true,
      gridSize: options?.gridSize || 10,
      gridDivisions: options?.gridDivisions ?? 5,
      gridColor: options?.gridColor || [0.67, 0.67, 0.67, 1.0]
    }

    // 初始化命令
    this.initializeCommands()
    
    // 注册绘制调用
    this.registerDrawCalls()
  }

  private initializeCommands(): void {
    // 初始化 Grid 命令
    if (this.options.enableGrid) {
      this.gridCommand = grid(this.reglContext)
      this.updateGridData()
    }

    // 初始化 Axes 命令（使用 Lines）
    if (this.options.enableAxes) {
      this.linesCommand = lines(this.reglContext)
      this.updateAxesData()
    }

    // 初始化 Points 命令
    this.pointsCommandRef = makePointsCommand({})
    this.pointsCommand = this.pointsCommandRef(this.reglContext)

    // 初始化 Lines 命令
    if (!this.linesCommand) {
      this.linesCommand = lines(this.reglContext)
    }
  }

  private updateGridData(): void {
    const count = this.options.gridDivisions
    const gridColor = this.options.gridColor

    // Grid 命令需要 count 属性
    this.gridData = {
      count,
      color: gridColor
    }
  }

  private updateAxesData(): void {
    if (this.axesData) return

    // 使用 defaultAxes 数据
    this.axesData = defaultAxes
  }

  // 保存实例引用以便正确管理
  private gridInstance: any = { displayName: 'Grid' }
  private axesInstance: any = { displayName: 'Axes' }
  private pointsInstance: any = { displayName: 'Points' }
  private pathInstances: any[] = []
  
  // 保存命令引用以便正确注册
  private pointsCommandRef: any = null

  /**
   * 注册所有绘制调用到 WorldviewContext
   * 这个方法应该在初始化时和每次数据更新时调用
   */
  registerDrawCalls(): void {
    // 清除旧的绘制调用
    this.unregisterAllDrawCalls()

    // 注册 Grid
    if (this.gridVisible && this.gridCommand && this.gridData) {
      this.worldviewContext.onMount(this.gridInstance, grid)
      this.worldviewContext.registerDrawCall({
        instance: this.gridInstance,
        reglCommand: grid,
        children: this.gridData,
        layerIndex: 0
      })
    }

    // 注册 Axes
    if (this.axesVisible && this.linesCommand && this.axesData) {
      this.worldviewContext.onMount(this.axesInstance, lines)
      this.worldviewContext.registerDrawCall({
        instance: this.axesInstance,
        reglCommand: lines,
        children: this.axesData,
        layerIndex: 1
      })
    }

    // 注册点云
    if (this.pointsCommand && this.pointCloudData && this.pointsCommandRef) {
      this.worldviewContext.onMount(this.pointsInstance, this.pointsCommandRef)
      this.worldviewContext.registerDrawCall({
        instance: this.pointsInstance,
        reglCommand: this.pointsCommandRef,
        children: this.pointCloudData,
        layerIndex: 2
      })
    }

    // 注册路径
    this.pathsData.forEach((pathData, index) => {
      if (this.linesCommand && pathData) {
        if (!this.pathInstances[index]) {
          this.pathInstances[index] = { displayName: `Path-${index}` }
        }
        this.worldviewContext.onMount(this.pathInstances[index], lines)
        this.worldviewContext.registerDrawCall({
          instance: this.pathInstances[index],
          reglCommand: lines,
          children: pathData,
          layerIndex: 3 + index
        })
      }
    })
  }

  /**
   * 取消注册所有绘制调用
   */
  private unregisterAllDrawCalls(): void {
    // 清除所有实例的绘制调用
    this.worldviewContext.onUnmount(this.gridInstance)
    this.worldviewContext.onUnmount(this.axesInstance)
    this.worldviewContext.onUnmount(this.pointsInstance)
    this.pathInstances.forEach((instance) => {
      this.worldviewContext.onUnmount(instance)
    })
    this.pathInstances = []
  }

  /**
   * 更新点云数据
   * 优化版本：使用批量处理和高效数据结构
   * 对于大点云，使用更紧凑的数据格式
   */
  updatePointCloud(data: PointCloudData): void {
    if (!data || !data.points || data.points.length === 0) {
      this.pointCloudData = null
      this.registerDrawCalls()
      this.worldviewContext.onDirty()
      return
    }

    const numPoints = data.points.length
    const defaultColor = { r: 1, g: 1, b: 1, a: 1 }
    // 根据点数量自动调整点大小
    let pointSize = data.pointSize
    if (!pointSize) {
      if (numPoints > 1000000) {
        pointSize = 0.5
      } else if (numPoints > 500000) {
        pointSize = 1.0
      } else if (numPoints > 100000) {
        pointSize = 1.5
      } else {
        pointSize = 2.0
      }
    }
    
    const hasColors = data.colors && data.colors.length > 0

    // 使用批量处理，避免逐个push
    // 对于大点云，直接使用数组而不是对象数组，减少内存占用
    const points: any[] = new Array(numPoints)
    let colors: any[] | undefined = undefined

    if (hasColors) {
      colors = new Array(numPoints)
    }

    // 批量处理点数据 - 使用requestIdleCallback分批处理，避免阻塞
    const processBatch = (startIndex: number, batchSize: number) => {
      const endIndex = Math.min(startIndex + batchSize, numPoints)
      
      for (let i = startIndex; i < endIndex; i++) {
        const point = data.points[i]
        if (!point) continue
        // 直接使用对象字面量，避免创建临时对象
        points[i] = { x: point.x, y: point.y, z: point.z }
        
        if (hasColors && colors) {
          colors[i] = data.colors![i] || defaultColor
        }
      }
      
      return endIndex
    }

    // 对于超大点云，分批处理以避免阻塞UI
    if (numPoints > 500000) {
      const batchSize = 100000
      let currentIndex = 0
      
      const processNextBatch = () => {
        currentIndex = processBatch(currentIndex, batchSize)
        if (currentIndex < numPoints) {
          // 使用setTimeout让浏览器有机会渲染
          setTimeout(processNextBatch, 0)
        } else {
          // 所有批次处理完成
          this.pointCloudData = {
            pose: {
              position: { x: 0, y: 0, z: 0 },
              orientation: { x: 0, y: 0, z: 0, w: 1 }
            },
            points,
            colors: colors,
            color: !hasColors ? defaultColor : undefined,
            scale: { x: pointSize, y: pointSize, z: pointSize }
          }
          this.registerDrawCalls()
          this.worldviewContext.onDirty()
        }
      }
      
      processNextBatch()
    } else {
      // 小点云直接处理
      processBatch(0, numPoints)
      
      this.pointCloudData = {
        pose: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 }
        },
        points,
        colors: colors,
        color: !hasColors ? defaultColor : undefined,
        scale: { x: pointSize, y: pointSize, z: pointSize }
      }
      this.registerDrawCalls()
      this.worldviewContext.onDirty()
    }
  }

  /**
   * 添加路径
   */
  addPath(data: PathData): number {
    if (!data || !data.waypoints || data.waypoints.length < 2) {
      return -1
    }

    const points: any[] = []
    const defaultColor = data.color || { r: 0, g: 1, b: 0, a: 1 }

    data.waypoints.forEach((point) => {
      points.push({ x: point.x, y: point.y, z: point.z })
    })

    const pathData = {
      pose: {
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 }
      },
      points,
      color: defaultColor,
      scale: { x: data.lineWidth || 1, y: data.lineWidth || 1, z: data.lineWidth || 1 },
      primitive: 'line strip' as const
    }

    this.pathsData.push(pathData)
    // 重新注册绘制调用
    this.registerDrawCalls()
    this.worldviewContext.onDirty()
    return this.pathsData.length - 1
  }

  /**
   * 清除所有路径
   */
  clearPaths(): void {
    this.pathsData = []
    // 只有在 WorldviewContext 已初始化时才重新注册绘制调用
    if (this.worldviewContext.initializedData) {
      this.registerDrawCalls()
      this.worldviewContext.onDirty()
    }
  }

  /**
   * 清除点云
   */
  clearPointCloud(): void {
    this.pointCloudData = null
    this.worldviewContext.onDirty()
  }

  /**
   * 设置网格可见性
   */
  setGridVisible(visible: boolean): void {
    this.gridVisible = visible
    this.registerDrawCalls()
    this.worldviewContext.onDirty()
  }

  /**
   * 设置坐标轴可见性
   */
  setAxesVisible(visible: boolean): void {
    this.axesVisible = visible
    this.registerDrawCalls()
    this.worldviewContext.onDirty()
  }

  /**
   * 销毁场景
   */
  destroy(): void {
    // 先清除所有绘制调用，避免在销毁时触发渲染
    this.unregisterAllDrawCalls()
    // 清除数据，但不触发渲染
    this.pathsData = []
    this.pointCloudData = null
    this.gridCommand = null
    this.axesCommand = null
    this.pointsCommand = null
    this.linesCommand = null
    this.axesData = null
    this.gridData = null
  }
}
