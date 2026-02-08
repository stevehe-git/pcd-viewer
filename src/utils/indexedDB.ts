/**
 * IndexedDB 缓存管理
 * 用于缓存解析后的点云数据，避免重复加载
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface PointCloudCacheDB extends DBSchema {
  pointClouds: {
    key: string // 文件路径或哈希
    value: {
      key: string
      points: Float32Array
      colors: Uint8Array
      count: number
      bounds: {
        min: [number, number, number]
        max: [number, number, number]
        center: [number, number, number]
      }
      timestamp: number
      fileSize: number
      lod?: number // LOD 层级
    }
    indexes: { 'by-timestamp': number }
  }
  chunks: {
    key: string // chunkId
    value: {
      chunkId: string
      points: Float32Array
      colors: Uint8Array
      count: number
      bounds: {
        min: [number, number, number]
        max: [number, number, number]
      }
      timestamp: number
      parentKey: string
    }
    indexes: { 'by-parent': string; 'by-timestamp': number }
  }
}

const DB_NAME = 'pcd-viewer-cache'
const DB_VERSION = 1
const MAX_CACHE_SIZE = 5 * 1024 * 1024 * 1024 // 5GB

class IndexedDBCache {
  private db: IDBPDatabase<PointCloudCacheDB> | null = null
  private currentCacheSize = 0

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    if (this.db) return

    this.db = await openDB<PointCloudCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // 点云缓存表
        if (!db.objectStoreNames.contains('pointClouds')) {
          const pointCloudStore = db.createObjectStore('pointClouds', {
            keyPath: 'key'
          })
          pointCloudStore.createIndex('by-timestamp', 'timestamp')
        }

        // 分块缓存表
        if (!db.objectStoreNames.contains('chunks')) {
          const chunkStore = db.createObjectStore('chunks', {
            keyPath: 'chunkId'
          })
          chunkStore.createIndex('by-parent', 'parentKey')
          chunkStore.createIndex('by-timestamp', 'timestamp')
        }
      }
    })

    // 计算当前缓存大小
    await this.updateCacheSize()
  }

  /**
   * 更新缓存大小统计
   */
  private async updateCacheSize(): Promise<void> {
    if (!this.db) return

    let size = 0
    const tx = this.db.transaction('pointClouds', 'readonly')
    const store = tx.objectStore('pointClouds')

    for await (const cursor of store.iterate()) {
      const data = cursor.value
      size += data.points.byteLength + data.colors.byteLength
    }

    const chunkTx = this.db.transaction('chunks', 'readonly')
    const chunkStore = chunkTx.objectStore('chunks')

    for await (const cursor of chunkStore.iterate()) {
      const data = cursor.value
      size += data.points.byteLength + data.colors.byteLength
    }

    this.currentCacheSize = size
  }

  /**
   * 获取点云缓存
   */
  async getPointCloud(key: string): Promise<PointCloudCacheDB['pointClouds']['value'] | null> {
    if (!this.db) await this.init()
    if (!this.db) return null

    const tx = this.db.transaction('pointClouds', 'readonly')
    const store = tx.objectStore('pointClouds')
    return (await store.get(key)) || null
  }

  /**
   * 保存点云缓存
   */
  async savePointCloud(
    key: string,
    data: Omit<PointCloudCacheDB['pointClouds']['value'], 'key' | 'timestamp'>
  ): Promise<void> {
    if (!this.db) await this.init()
    if (!this.db) return

    const cacheData: PointCloudCacheDB['pointClouds']['value'] = {
      key,
      ...data,
      timestamp: Date.now()
    }

    const tx = this.db.transaction('pointClouds', 'readwrite')
    const store = tx.objectStore('pointClouds')
    await store.put(cacheData)

    // 检查缓存大小，如果超过限制则清理旧数据
    await this.updateCacheSize()
    if (this.currentCacheSize > MAX_CACHE_SIZE) {
      await this.cleanupOldCache()
    }
  }

  /**
   * 获取分块缓存
   */
  async getChunk(chunkId: string): Promise<PointCloudCacheDB['chunks']['value'] | null> {
    if (!this.db) await this.init()
    if (!this.db) return null

    const tx = this.db.transaction('chunks', 'readonly')
    const store = tx.objectStore('chunks')
    return (await store.get(chunkId)) || null
  }

  /**
   * 保存分块缓存
   */
  async saveChunk(
    chunkId: string,
    parentKey: string,
    data: Omit<PointCloudCacheDB['chunks']['value'], 'chunkId' | 'parentKey' | 'timestamp'>
  ): Promise<void> {
    if (!this.db) await this.init()
    if (!this.db) return

    const cacheData: PointCloudCacheDB['chunks']['value'] = {
      chunkId,
      parentKey,
      ...data,
      timestamp: Date.now()
    }

    const tx = this.db.transaction('chunks', 'readwrite')
    const store = tx.objectStore('chunks')
    await store.put(cacheData)

    await this.updateCacheSize()
    if (this.currentCacheSize > MAX_CACHE_SIZE) {
      await this.cleanupOldCache()
    }
  }

  /**
   * 获取所有分块
   */
  async getChunksByParent(parentKey: string): Promise<PointCloudCacheDB['chunks']['value'][]> {
    if (!this.db) await this.init()
    if (!this.db) return []

    const tx = this.db.transaction('chunks', 'readonly')
    const store = tx.objectStore('chunks')
    const index = store.index('by-parent')
    return await index.getAll(parentKey)
  }

  /**
   * 清理旧缓存
   */
  private async cleanupOldCache(): Promise<void> {
    if (!this.db) return

    // 按时间戳排序，删除最旧的数据
    const tx = this.db.transaction(['pointClouds', 'chunks'], 'readwrite')
    const pointCloudStore = tx.objectStore('pointClouds')
    const chunkStore = tx.objectStore('chunks')

    // 清理点云缓存
    const pointCloudIndex = pointCloudStore.index('by-timestamp')
    let cursor = await pointCloudIndex.openCursor()
    const pointCloudsToDelete: string[] = []

    while (cursor && this.currentCacheSize > MAX_CACHE_SIZE * 0.8) {
      pointCloudsToDelete.push(cursor.value.key)
      this.currentCacheSize -= cursor.value.points.byteLength + cursor.value.colors.byteLength
      cursor = await cursor.continue()
    }

    for (const key of pointCloudsToDelete) {
      await pointCloudStore.delete(key)
    }

    // 清理分块缓存
    const chunkIndex = chunkStore.index('by-timestamp')
    let chunkCursor = await chunkIndex.openCursor()
    const chunksToDelete: string[] = []

    while (chunkCursor && this.currentCacheSize > MAX_CACHE_SIZE * 0.8) {
      chunksToDelete.push(chunkCursor.value.chunkId)
      this.currentCacheSize -= chunkCursor.value.points.byteLength + chunkCursor.value.colors.byteLength
      chunkCursor = await chunkCursor.continue()
    }

    for (const chunkId of chunksToDelete) {
      await chunkStore.delete(chunkId)
    }
  }

  /**
   * 删除点云缓存
   */
  async deletePointCloud(key: string): Promise<void> {
    if (!this.db) await this.init()
    if (!this.db) return

    const tx = this.db.transaction('pointClouds', 'readwrite')
    const store = tx.objectStore('pointClouds')
    await store.delete(key)

    // 同时删除相关分块
    const chunks = await this.getChunksByParent(key)
    const chunkTx = this.db.transaction('chunks', 'readwrite')
    const chunkStore = chunkTx.objectStore('chunks')
    for (const chunk of chunks) {
      await chunkStore.delete(chunk.chunkId)
    }

    await this.updateCacheSize()
  }

  /**
   * 清空所有缓存
   */
  async clearAll(): Promise<void> {
    if (!this.db) await this.init()
    if (!this.db) return

    const tx = this.db.transaction(['pointClouds', 'chunks'], 'readwrite')
    await tx.objectStore('pointClouds').clear()
    await tx.objectStore('chunks').clear()
    this.currentCacheSize = 0
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{
    pointCloudCount: number
    chunkCount: number
    totalSize: number
    totalSizeMB: number
  }> {
    if (!this.db) await this.init()
    if (!this.db) {
      return { pointCloudCount: 0, chunkCount: 0, totalSize: 0, totalSizeMB: 0 }
    }

    await this.updateCacheSize()

    const tx = this.db.transaction(['pointClouds', 'chunks'], 'readonly')
    const pointCloudCount = await tx.objectStore('pointClouds').count()
    const chunkCount = await tx.objectStore('chunks').count()

    return {
      pointCloudCount,
      chunkCount,
      totalSize: this.currentCacheSize,
      totalSizeMB: this.currentCacheSize / (1024 * 1024)
    }
  }
}

// 导出单例
export const indexedDBCache = new IndexedDBCache()
