/**
 * PCD 点云解析 Web Worker
 * 在后台线程解析点云数据，避免阻塞主线程
 * 支持分块加载和渐进式解析
 */

import * as Comlink from 'comlink'

export interface PCDPoint {
  x: number
  y: number
  z: number
  r?: number
  g?: number
  b?: number
  intensity?: number
}

export interface ParsedPointCloud {
  points: Float32Array // [x, y, z, x, y, z, ...]
  colors: Uint8Array   // [r, g, b, r, g, b, ...]
  count: number
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
    center: [number, number, number]
  }
}

export interface ParseOptions {
  maxPoints?: number // 最大点数限制
  downsampleRatio?: number // 下采样比例 (0-1)
  chunkSize?: number // 分块大小
  // 注意：onProgress 回调无法通过 postMessage 传递，需要在主线程中处理进度
}

/**
 * 解析 PCD 文件（ASCII 格式）
 */
function parsePCDASCII(text: string, options: ParseOptions = {}): ParsedPointCloud {
  const lines = text.split('\n')
  let headerEnd = -1
  let pointCount = 0
  let hasColor = false
  
  // 解析头部
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue
    if (line.startsWith('POINTS')) {
      const parts = line.split(/\s+/)
      if (parts[1]) {
        pointCount = parseInt(parts[1], 10)
      }
    } else if (line.startsWith('FIELDS')) {
      const fields = line.split(/\s+/).slice(1)
      hasColor = fields.includes('rgb') || (fields.includes('r') && fields.includes('g') && fields.includes('b'))
    } else if (line === 'DATA ascii') {
      headerEnd = i + 1
      break
    }
  }
  
  if (headerEnd === -1 || pointCount === 0) {
    throw new Error('Invalid PCD file format')
  }
  
  // 应用限制
  const maxPoints = options.maxPoints || pointCount
  const actualPointCount = Math.min(pointCount, maxPoints)
  const downsampleRatio = options.downsampleRatio || 1
  const finalPointCount = Math.floor(actualPointCount * downsampleRatio)
  
  // 预分配 TypedArray（性能优化）
  const points = new Float32Array(finalPointCount * 3)
  const colors = new Uint8Array(finalPointCount * 3)
  
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  
  let pointIndex = 0
  const step = Math.max(1, Math.floor(1 / downsampleRatio))
  
  // 解析点数据
  for (let i = headerEnd; i < lines.length && pointIndex < finalPointCount; i++) {
    const line = lines[i]?.trim()
    if (!line || line.startsWith('#')) continue
    
    // 下采样：跳过部分点
    if ((i - headerEnd) % step !== 0) continue
    
    const values = line.split(/\s+/).map(parseFloat).filter(v => !isNaN(v))
    if (values.length < 3) continue
    
    const x = values[0] ?? 0
    const y = values[1] ?? 0
    const z = values[2] ?? 0
    
    // 更新边界
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
    
    // 存储位置
    const idx = pointIndex * 3
    points[idx] = x
    points[idx + 1] = y
    points[idx + 2] = z
    
    // 处理颜色
    if (hasColor) {
      if (values.length >= 6) {
        // r, g, b 分别存储
        colors[idx] = Math.floor((values[3] ?? 1) * 255)
        colors[idx + 1] = Math.floor((values[4] ?? 1) * 255)
        colors[idx + 2] = Math.floor((values[5] ?? 1) * 255)
      } else if (values.length >= 4 && values[3] !== undefined) {
        // RGB 打包为整数
        const rgb = Math.floor(values[3])
        colors[idx] = (rgb >> 16) & 0xff
        colors[idx + 1] = (rgb >> 8) & 0xff
        colors[idx + 2] = rgb & 0xff
      } else {
        // 默认白色
        colors[idx] = 255
        colors[idx + 1] = 255
        colors[idx + 2] = 255
      }
    } else {
      // 默认白色
      colors[idx] = 255
      colors[idx + 1] = 255
      colors[idx + 2] = 255
    }
    
    pointIndex++
  }
  
  const finalMinX = minX === Infinity ? 0 : minX
  const finalMinY = minY === Infinity ? 0 : minY
  const finalMinZ = minZ === Infinity ? 0 : minZ
  const finalMaxX = maxX === -Infinity ? 0 : maxX
  const finalMaxY = maxY === -Infinity ? 0 : maxY
  const finalMaxZ = maxZ === -Infinity ? 0 : maxZ
  
  const center: [number, number, number] = [
    (finalMinX + finalMaxX) / 2,
    (finalMinY + finalMaxY) / 2,
    (finalMinZ + finalMaxZ) / 2
  ]
  
  return {
    points: points.slice(0, pointIndex * 3),
    colors: colors.slice(0, pointIndex * 3),
    count: pointIndex,
    bounds: {
      min: [finalMinX, finalMinY, finalMinZ],
      max: [finalMaxX, finalMaxY, finalMaxZ],
      center
    }
  }
}

/**
 * 分块解析大文件
 */
async function parsePCDInChunks(
  file: File | ArrayBuffer,
  options: ParseOptions = {}
): Promise<ParsedPointCloud> {
  let text = ''
  
  if (file instanceof File) {
    text = await file.text()
  } else {
    const decoder = new TextDecoder()
    text = decoder.decode(file)
  }
  
  // 对于超大文件，可以进一步优化为流式解析
  // 这里先使用完整解析
  return parsePCDASCII(text, options)
}

/**
 * 体素下采样（空间均匀采样）
 */
function voxelDownsample(
  points: Float32Array,
  colors: Uint8Array,
  voxelSize: number
): ParsedPointCloud {
  const count = points.length / 3
  const voxelMap = new Map<string, { point: [number, number, number], color: [number, number, number], count: number }>()
  
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  
  // 将点分配到体素
  for (let i = 0; i < count; i++) {
    const idx = i * 3
    const x = points[idx] ?? 0
    const y = points[idx + 1] ?? 0
    const z = points[idx + 2] ?? 0
    
    // 计算体素索引
    const voxelX = Math.floor(x / voxelSize)
    const voxelY = Math.floor(y / voxelSize)
    const voxelZ = Math.floor(z / voxelSize)
    const key = `${voxelX},${voxelY},${voxelZ}`
    
    // 更新边界
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
    
    const r = colors[idx] ?? 255
    const g = colors[idx + 1] ?? 255
    const b = colors[idx + 2] ?? 255
    
    if (!voxelMap.has(key)) {
      voxelMap.set(key, {
        point: [x, y, z],
        color: [r, g, b],
        count: 1
      })
    } else {
      const voxel = voxelMap.get(key)!
      // 平均位置和颜色
      const n = voxel.count
      voxel.point[0] = (voxel.point[0] * n + x) / (n + 1)
      voxel.point[1] = (voxel.point[1] * n + y) / (n + 1)
      voxel.point[2] = (voxel.point[2] * n + z) / (n + 1)
      voxel.color[0] = Math.floor((voxel.color[0] * n + r) / (n + 1))
      voxel.color[1] = Math.floor((voxel.color[1] * n + g) / (n + 1))
      voxel.color[2] = Math.floor((voxel.color[2] * n + b) / (n + 1))
      voxel.count++
    }
  }
  
  // 转换为 TypedArray
  const finalCount = voxelMap.size
  const finalPoints = new Float32Array(finalCount * 3)
  const finalColors = new Uint8Array(finalCount * 3)
  
  let idx = 0
  for (const voxel of voxelMap.values()) {
    finalPoints[idx * 3] = voxel.point[0]
    finalPoints[idx * 3 + 1] = voxel.point[1]
    finalPoints[idx * 3 + 2] = voxel.point[2]
    finalColors[idx * 3] = voxel.color[0]
    finalColors[idx * 3 + 1] = voxel.color[1]
    finalColors[idx * 3 + 2] = voxel.color[2]
    idx++
  }
  
  const finalMinX = minX === Infinity ? 0 : minX
  const finalMinY = minY === Infinity ? 0 : minY
  const finalMinZ = minZ === Infinity ? 0 : minZ
  const finalMaxX = maxX === -Infinity ? 0 : maxX
  const finalMaxY = maxY === -Infinity ? 0 : maxY
  const finalMaxZ = maxZ === -Infinity ? 0 : maxZ
  
  const center: [number, number, number] = [
    (finalMinX + finalMaxX) / 2,
    (finalMinY + finalMaxY) / 2,
    (finalMinZ + finalMaxZ) / 2
  ]
  
  return {
    points: finalPoints,
    colors: finalColors,
    count: finalCount,
    bounds: {
      min: [finalMinX, finalMinY, finalMinZ],
      max: [finalMaxX, finalMaxY, finalMaxZ],
      center
    }
  }
}

// 导出给主线程使用的方法
const PCDParserWorker = {
  /**
   * 解析 PCD 文件
   */
  async parsePCD(file: File | ArrayBuffer, options: ParseOptions = {}): Promise<ParsedPointCloud> {
    return parsePCDInChunks(file, options)
  },
  
  /**
   * 体素下采样
   */
  voxelDownsample(
    points: Float32Array,
    colors: Uint8Array,
    voxelSize: number
  ): ParsedPointCloud {
    return voxelDownsample(points, colors, voxelSize)
  }
}

// 使用 Comlink 暴露给主线程
Comlink.expose(PCDParserWorker)

export type PCDParserWorkerType = typeof PCDParserWorker
