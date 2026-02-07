/**
 * PCD文件调试工具
 * 用于对比 pcl_viewer 和当前实现的差异
 */

import type { Point3D, PointCloudData } from '../types'

/**
 * 对比两个点云数据
 */
export function comparePointClouds(
  original: PointCloudData,
  processed: PointCloudData
): {
  pointCountDiff: number
  boundsDiff: {
    original: { min: Point3D; max: Point3D }
    processed: { min: Point3D; max: Point3D }
  }
  samplePoints: {
    original: Point3D[]
    processed: Point3D[]
  }
} {
  const originalBounds = calculateBounds(original.points)
  const processedBounds = calculateBounds(processed.points)

  return {
    pointCountDiff: original.points.length - processed.points.length,
    boundsDiff: {
      original: originalBounds,
      processed: processedBounds
    },
    samplePoints: {
      original: original.points.slice(0, 10),
      processed: processed.points.slice(0, 10)
    }
  }
}

/**
 * 计算点云边界（优化版本，避免栈溢出）
 */
function calculateBounds(points: Point3D[]): { min: Point3D; max: Point3D } {
  if (points.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  }

  const firstPoint = points[0]
  if (!firstPoint) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  }

  let minX = firstPoint.x
  let minY = firstPoint.y
  let minZ = firstPoint.z
  let maxX = firstPoint.x
  let maxY = firstPoint.y
  let maxZ = firstPoint.z

  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    if (!p) continue
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    minZ = Math.min(minZ, p.z)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    maxZ = Math.max(maxZ, p.z)
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  }
}

/**
 * 检查坐标轴顺序是否正确
 * 通过分析点云的分布来判断
 */
export function checkCoordinateOrder(points: Point3D[]): {
  xyz: { min: Point3D; max: Point3D; range: Point3D }
  xzy: { min: Point3D; max: Point3D; range: Point3D }
  yxz: { min: Point3D; max: Point3D; range: Point3D }
  yzx: { min: Point3D; max: Point3D; range: Point3D }
  zxy: { min: Point3D; max: Point3D; range: Point3D }
  zyx: { min: Point3D; max: Point3D; range: Point3D }
} {
  const sampleSize = Math.min(points.length, 10000)
  const sample = points.slice(0, sampleSize)

  const calculateBoundsForOrder = (order: 'xyz' | 'xzy' | 'yxz' | 'yzx' | 'zxy' | 'zyx') => {
    let minX = sample[0]?.[order[0] as 'x' | 'y' | 'z'] ?? 0
    let minY = sample[0]?.[order[1] as 'x' | 'y' | 'z'] ?? 0
    let minZ = sample[0]?.[order[2] as 'x' | 'y' | 'z'] ?? 0
    let maxX = minX
    let maxY = minY
    let maxZ = minZ

    for (let i = 1; i < sample.length; i++) {
      const p = sample[i]
      if (!p) continue
      const v1 = p[order[0] as 'x' | 'y' | 'z']
      const v2 = p[order[1] as 'x' | 'y' | 'z']
      const v3 = p[order[2] as 'x' | 'y' | 'z']
      minX = Math.min(minX, v1)
      minY = Math.min(minY, v2)
      minZ = Math.min(minZ, v3)
      maxX = Math.max(maxX, v1)
      maxY = Math.max(maxY, v2)
      maxZ = Math.max(maxZ, v3)
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
      range: {
        x: maxX - minX,
        y: maxY - minY,
        z: maxZ - minZ
      }
    }
  }

  return {
    xyz: calculateBoundsForOrder('xyz'),
    xzy: calculateBoundsForOrder('xzy'),
    yxz: calculateBoundsForOrder('yxz'),
    yzx: calculateBoundsForOrder('yzx'),
    zxy: calculateBoundsForOrder('zxy'),
    zyx: calculateBoundsForOrder('zyx')
  }
}
