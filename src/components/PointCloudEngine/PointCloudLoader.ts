/**
 * 点云加载管理器
 * 实现分块加载、LOD 管理、渐进式加载
 */

import * as Comlink from 'comlink'
import type { PCDParserWorkerType, ParsedPointCloud } from '../../workers/pcd-parser.worker'
import { indexedDBCache } from '../../utils/indexedDB'
import type { PointCloudChunk } from './PointCloudEngine'

export interface LoadOptions {
  maxPoints?: number
  chunkSize?: number // 每块点数
  lodLevels?: number[] // LOD 层级，如 [1, 0.5, 0.1] 表示 100%, 50%, 10%
  enableCache?: boolean
  onProgress?: (progress: number, message: string) => void
}

export class PointCloudLoader {
  private worker: Comlink.Remote<PCDParserWorkerType> | null = null

  /**
   * 初始化 Worker
   */
  private async initWorker(): Promise<Comlink.Remote<PCDParserWorkerType>> {
    if (this.worker) return this.worker

    // 使用 Vite 的 Worker 导入方式
    const WorkerModule = await import('../../workers/pcd-parser.worker.ts?worker')
    const WorkerConstructor = Comlink.wrap<PCDParserWorkerType>(
      new WorkerModule.default()
    )
    this.worker = WorkerConstructor
    return this.worker
  }

  /**
   * 生成文件哈希（用于缓存键）
   */
  private async generateFileHash(file: File): Promise<string> {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /**
   * 加载点云文件
   */
  async loadPointCloud(
    file: File,
    options: LoadOptions = {}
  ): Promise<PointCloudChunk[]> {
    const {
      maxPoints = 10000000, // 默认最多 1000 万点
      chunkSize = 100000, // 每块 10 万点
      lodLevels = [1, 0.5, 0.1], // 3 个 LOD 层级
      enableCache = true,
      onProgress
    } = options

    onProgress?.(0, '开始加载点云文件...')

    // 生成缓存键
    const fileHash = await this.generateFileHash(file)
    const cacheKey = `pcd_${fileHash}`

    // 检查缓存
    if (enableCache) {
      const cached = await indexedDBCache.getPointCloud(cacheKey)
      if (cached) {
        onProgress?.(100, '从缓存加载点云')
        return this.createChunksFromCache(cached, lodLevels)
      }
    }

    // 初始化 Worker
    const worker = await this.initWorker()
    onProgress?.(10, '解析点云文件...')

    // 解析点云（先加载完整数据）
    // 注意：由于 Worker 无法传递函数回调，进度在主线程中模拟
    const parsePromise = worker.parsePCD(file, {
      maxPoints
    })

    // 模拟解析进度（根据文件大小估算）
    // 大文件通常需要更长时间，我们模拟一个渐进的过程
    let simulatedProgress = 10
    const progressInterval = setInterval(() => {
      simulatedProgress = Math.min(simulatedProgress + 2, 45) // 最多到 45%
      onProgress?.(simulatedProgress, `解析点云文件... ${simulatedProgress}%`)
    }, 200) // 每 200ms 更新一次

    try {
      const parsed = await parsePromise
      clearInterval(progressInterval)
      onProgress?.(50, '解析完成，生成 LOD 层级...')

      // 生成不同 LOD 层级
      const chunks: PointCloudChunk[] = []
      
      for (let lodIndex = 0; lodIndex < lodLevels.length; lodIndex++) {
        const lodRatio = lodLevels[lodIndex]
        const lodProgress = 50 + (lodIndex / lodLevels.length) * 40

        onProgress?.(lodProgress, `生成 LOD ${lodIndex + 1}/${lodLevels.length}...`)

        let lodData: ParsedPointCloud

        if (lodIndex === 0) {
          // 最高 LOD：使用原始数据
          lodData = parsed
        } else {
          // 其他 LOD：体素下采样
          const voxelSize = this.calculateVoxelSize(parsed.bounds, lodRatio)
          lodData = await worker.voxelDownsample(
            parsed.points,
            parsed.colors,
            voxelSize
          )
        }

        // 分块处理
        const lodChunks = this.splitIntoChunks(lodData, chunkSize, lodIndex)
        chunks.push(...lodChunks)

        // 缓存 LOD 数据
        if (enableCache) {
          await indexedDBCache.savePointCloud(`${cacheKey}_lod${lodIndex}`, {
            points: lodData.points,
            colors: lodData.colors,
            count: lodData.count,
            bounds: lodData.bounds,
            fileSize: file.size,
            lod: lodIndex
          })
        }
      }

      onProgress?.(100, '加载完成')
      return chunks
    } catch (error) {
      clearInterval(progressInterval)
      throw error
    }
  }

  /**
   * 从缓存创建分块
   */
  private async createChunksFromCache(
    cached: any,
    lodLevels: number[]
  ): Promise<PointCloudChunk[]> {
    const chunks: PointCloudChunk[] = []

    for (let lodIndex = 0; lodIndex < lodLevels.length; lodIndex++) {
      const cacheKey = cached.key.replace('_lod0', `_lod${lodIndex}`)
      const lodCache = await indexedDBCache.getPointCloud(cacheKey)

      if (lodCache) {
        const lodChunks = this.splitIntoChunks(
          {
            points: lodCache.points,
            colors: lodCache.colors,
            count: lodCache.count,
            bounds: lodCache.bounds
          },
          100000, // 默认分块大小
          lodIndex
        )
        chunks.push(...lodChunks)
      }
    }

    return chunks
  }

  /**
   * 将点云数据分割为多个块
   */
  private splitIntoChunks(
    data: ParsedPointCloud,
    chunkSize: number,
    lod: number
  ): PointCloudChunk[] {
    const chunks: PointCloudChunk[] = []
    const totalPoints = data.count
    const numChunks = Math.ceil(totalPoints / chunkSize)

    for (let i = 0; i < numChunks; i++) {
      const startIdx = i * chunkSize * 3
      const endIdx = Math.min(startIdx + chunkSize * 3, data.points.length)
      const chunkPointCount = (endIdx - startIdx) / 3

      // 提取分块数据
      const chunkPoints = data.points.slice(startIdx, endIdx)
      const chunkColors = data.colors.slice(startIdx, endIdx)

      // 计算分块边界（简化：使用整体边界）
      // 实际应用中应该计算每个分块的实际边界
      const chunkBounds = {
        min: data.bounds.min,
        max: data.bounds.max,
        center: data.bounds.center
      }

      chunks.push({
        id: `chunk_${lod}_${i}`,
        points: chunkPoints,
        colors: chunkColors,
        count: chunkPointCount,
        bounds: chunkBounds,
        lod
      })
    }

    return chunks
  }

  /**
   * 计算体素大小（基于 LOD 比例）
   */
  private calculateVoxelSize(
    bounds: ParsedPointCloud['bounds'],
    lodRatio: number
  ): number {
    const sizeX = bounds.max[0] - bounds.min[0]
    const sizeY = bounds.max[1] - bounds.min[1]
    const sizeZ = bounds.max[2] - bounds.min[2]
    const maxSize = Math.max(sizeX, sizeY, sizeZ)

    // 体素大小与 LOD 比例成反比
    // lodRatio = 0.1 时，体素应该更大（更少的点）
    return maxSize * (1 - lodRatio) * 0.01
  }

  /**
   * 清理 Worker
   */
  dispose(): void {
    if (this.worker) {
      // Comlink 会自动清理
      this.worker = null
    }
  }
}
