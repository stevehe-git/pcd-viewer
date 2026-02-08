/**
 * 高性能点云渲染引擎
 * 基于 Three.js，实现 LOD、视锥体剔除、分块加载
 * 支持千万级点云的流畅可视化
 */

import * as THREE from 'three'
import type { ParsedPointCloud } from '../../workers/pcd-parser.worker'

export interface PointCloudChunk {
  id: string
  points: Float32Array
  colors: Uint8Array
  count: number
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
    center: [number, number, number]
  }
  lod: number // LOD 层级：0=最高，数字越大分辨率越低
  geometry?: THREE.BufferGeometry
  material?: THREE.PointsMaterial
  pointsObject?: THREE.Points
}

export interface RenderOptions {
  maxPointCount?: number // 单帧最大渲染点数（默认 200 万）
  pointBudget?: number // 点预算，用于动态 LOD 调整（默认 100 万）
  pointSize?: number
  pointColor?: string | null // 统一颜色覆盖（null 表示使用原始颜色）
  enableLOD?: boolean
  enableFrustumCulling?: boolean
  enableVoxelDownsample?: boolean
  voxelSize?: number
  highPerformanceMode?: boolean // 高性能模式
}

export class PointCloudEngine {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private chunks: Map<string, PointCloudChunk> = new Map()
  private chunksByLOD: Map<number, PointCloudChunk[]> = new Map()
  
  private options: Required<RenderOptions>
  private raycaster: THREE.Raycaster
  private frustum: THREE.Frustum
  
  // 性能统计
  private stats = {
    totalPoints: 0,
    renderedPoints: 0,
    visibleChunks: 0,
    frameTime: 0
  }

  constructor(
    container: HTMLElement,
    options: RenderOptions = {}
  ) {
    this.options = {
      maxPointCount: options.maxPointCount || 2000000,
      pointBudget: options.pointBudget || 1000000,
      pointSize: options.pointSize ?? 0.01, // 默认点大小 0.01
      pointColor: options.pointColor ?? null,
      enableLOD: options.enableLOD !== false,
      enableFrustumCulling: options.enableFrustumCulling !== false,
      enableVoxelDownsample: options.enableVoxelDownsample !== false,
      voxelSize: options.voxelSize || 0.1,
      highPerformanceMode: options.highPerformanceMode !== false
    }

    // 初始化 Three.js 场景
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x333333)

    // 初始化相机
    const width = container.clientWidth
    const height = container.clientHeight
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000)
    this.camera.position.set(0, 0, 10)

    // 初始化渲染器（优先使用 WebGL2，支持更多特性）
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.options.highPerformanceMode, // 高性能模式关闭抗锯齿
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true // 支持大场景
    })
    this.renderer.setSize(width, height)
    // 高性能模式：限制像素比以提升性能
    const pixelRatio = this.options.highPerformanceMode 
      ? Math.min(window.devicePixelRatio, 1.5) 
      : Math.min(window.devicePixelRatio, 2)
    this.renderer.setPixelRatio(pixelRatio)
    container.appendChild(this.renderer.domElement)

    // 初始化视锥体剔除
    this.raycaster = new THREE.Raycaster()
    this.frustum = new THREE.Frustum()

    // 监听窗口大小变化
    window.addEventListener('resize', () => this.handleResize(container))
  }

  /**
   * 添加点云分块
   */
  addChunk(chunk: PointCloudChunk): void {
    this.chunks.set(chunk.id, chunk)
    
    // 按 LOD 分组
    if (!this.chunksByLOD.has(chunk.lod)) {
      this.chunksByLOD.set(chunk.lod, [])
    }
    this.chunksByLOD.get(chunk.lod)!.push(chunk)

    // 创建 Three.js 几何体和材质
    this.createChunkGeometry(chunk)
    
    // 添加到场景
    if (chunk.pointsObject) {
      this.scene.add(chunk.pointsObject)
    }

    this.stats.totalPoints += chunk.count
  }

  /**
   * 创建分块的几何体和材质
   */
  private createChunkGeometry(chunk: PointCloudChunk): void {
    // 创建几何体
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.points, 3))
    geometry.setAttribute('color', new THREE.Uint8BufferAttribute(chunk.colors, 3, true))
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()

    // 创建材质
    const material = new THREE.PointsMaterial({
      size: this.options.pointSize,
      vertexColors: !this.options.pointColor, // 如果设置了统一颜色，则禁用顶点颜色
      color: this.options.pointColor ? new THREE.Color(this.options.pointColor) : undefined,
      sizeAttenuation: true,
      transparent: false
    })

    // 创建点云对象
    const points = new THREE.Points(geometry, material)
    points.userData.chunkId = chunk.id
    points.userData.lod = chunk.lod
    points.userData.pointCount = chunk.count

    chunk.geometry = geometry
    chunk.material = material
    chunk.pointsObject = points
  }

  /**
   * 移除分块
   */
  removeChunk(chunkId: string): void {
    const chunk = this.chunks.get(chunkId)
    if (!chunk) return

    if (chunk.pointsObject) {
      this.scene.remove(chunk.pointsObject)
      chunk.geometry?.dispose()
      chunk.material?.dispose()
    }

    // 从 LOD 分组中移除
    const lodChunks = this.chunksByLOD.get(chunk.lod)
    if (lodChunks) {
      const index = lodChunks.indexOf(chunk)
      if (index > -1) lodChunks.splice(index, 1)
    }

    this.chunks.delete(chunkId)
    this.stats.totalPoints -= chunk.count
  }

  /**
   * 更新视锥体剔除和 LOD
   */
  private updateVisibilityAndLOD(): void {
    if (!this.camera) return

    // 更新视锥体
    this.frustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse
      )
    )

    let renderedCount = 0
    let visibleChunks = 0

    // 按 LOD 从低到高遍历（优先显示低分辨率）
    const lodLevels = Array.from(this.chunksByLOD.keys()).sort((a, b) => a - b)

    for (const lod of lodLevels) {
      const chunks = this.chunksByLOD.get(lod) || []

      for (const chunk of chunks) {
        if (!chunk.pointsObject) continue

        // 视锥体剔除
        if (this.options.enableFrustumCulling) {
          const boundingBox = new THREE.Box3(
            new THREE.Vector3(...chunk.bounds.min),
            new THREE.Vector3(...chunk.bounds.max)
          )
          
          if (!this.frustum.intersectsBox(boundingBox)) {
            chunk.pointsObject.visible = false
            continue
          }
        }

        // 检查点预算
        if (renderedCount + chunk.count > this.options.maxPointCount) {
          chunk.pointsObject.visible = false
          continue
        }

        // 显示该分块
        chunk.pointsObject.visible = true
        renderedCount += chunk.count
        visibleChunks++

        // 如果已达到预算，隐藏更高 LOD 的块
        if (renderedCount >= this.options.pointBudget) {
          // 隐藏所有更高 LOD 的块
          for (const higherLOD of lodLevels) {
            if (higherLOD > lod) {
              const higherChunks = this.chunksByLOD.get(higherLOD) || []
              for (const higherChunk of higherChunks) {
                if (higherChunk.pointsObject) {
                  higherChunk.pointsObject.visible = false
                }
              }
            }
          }
          break
        }
      }

      // 如果已达到预算，不再处理更高 LOD
      if (renderedCount >= this.options.pointBudget) {
        break
      }
    }

    this.stats.renderedPoints = renderedCount
    this.stats.visibleChunks = visibleChunks
  }

  /**
   * 渲染一帧
   */
  render(): void {
    const startTime = performance.now()

    // 更新可见性和 LOD
    this.updateVisibilityAndLOD()

    // 渲染场景
    this.renderer.render(this.scene, this.camera)

    this.stats.frameTime = performance.now() - startTime
  }

  /**
   * 设置相机
   */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera
  }

  /**
   * 获取相机
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  /**
   * 获取场景
   */
  getScene(): THREE.Scene {
    return this.scene
  }

  /**
   * 获取渲染器
   */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer
  }

  /**
   * 适应屏幕（自动调整相机位置）
   */
  fitToScreen(): void {
    if (this.chunks.size === 0) return

    // 计算所有分块的边界
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

    for (const chunk of this.chunks.values()) {
      minX = Math.min(minX, chunk.bounds.min[0])
      minY = Math.min(minY, chunk.bounds.min[1])
      minZ = Math.min(minZ, chunk.bounds.min[2])
      maxX = Math.max(maxX, chunk.bounds.max[0])
      maxY = Math.max(maxY, chunk.bounds.max[1])
      maxZ = Math.max(maxZ, chunk.bounds.max[2])
    }

    const center = new THREE.Vector3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    )

    const size = new THREE.Vector3(
      maxX - minX,
      maxY - minY,
      maxZ - minZ
    )

    const maxDim = Math.max(size.x, size.y, size.z)
    const distance = maxDim * 1.5

    this.camera.position.set(
      center.x,
      center.y + distance * 0.5,
      center.z + distance
    )
    this.camera.lookAt(center)
    this.camera.updateProjectionMatrix()
  }

  /**
   * 处理窗口大小变化
   */
  private handleResize(container: HTMLElement): void {
    const width = container.clientWidth
    const height = container.clientHeight

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  /**
   * 获取性能统计
   */
  getStats() {
    return {
      ...this.stats,
      fps: this.stats.frameTime > 0 ? Math.round(1000 / this.stats.frameTime) : 0
    }
  }

  /**
   * 更新选项
   */
  updateOptions(options: Partial<RenderOptions>): void {
    this.options = { ...this.options, ...options }

    // 更新点大小
    if (options.pointSize !== undefined) {
      for (const chunk of this.chunks.values()) {
        if (chunk.material) {
          chunk.material.size = options.pointSize
        }
      }
    }

    // 更新点颜色
    if (options.pointColor !== undefined) {
      for (const chunk of this.chunks.values()) {
        if (chunk.material) {
          chunk.material.vertexColors = !options.pointColor
          if (options.pointColor) {
            chunk.material.color = new THREE.Color(options.pointColor)
          }
        }
      }
    }

    // 更新高性能模式
    if (options.highPerformanceMode !== undefined) {
      this.renderer.setPixelRatio(
        options.highPerformanceMode 
          ? Math.min(window.devicePixelRatio, 1.5) 
          : Math.min(window.devicePixelRatio, 2)
      )
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    // 清理所有分块
    for (const chunk of this.chunks.values()) {
      if (chunk.pointsObject) {
        this.scene.remove(chunk.pointsObject)
      }
      chunk.geometry?.dispose()
      chunk.material?.dispose()
    }

    this.chunks.clear()
    this.chunksByLOD.clear()

    // 清理渲染器
    this.renderer.dispose()

    // 移除事件监听
    window.removeEventListener('resize', () => this.handleResize)
  }
}
