/**
 * 简化的八叉树实现
 * 用于点云的空间分割和LOD渲染
 * 参考 Potree 的简化版本
 */

import type { Point3D, Color } from '../types'

export interface OctreeNode {
  bounds: {
    min: Point3D
    max: Point3D
    center: Point3D
    size: number
  }
  points: Point3D[]
  colors?: Color[]
  children?: OctreeNode[]
  level: number
  pointCount: number
}

export interface OctreeOptions {
  maxPointsPerNode?: number
  maxDepth?: number
  minNodeSize?: number
}

/**
 * 构建八叉树
 */
export function buildOctree(
  points: Point3D[],
  colors?: Color[],
  options: OctreeOptions = {}
): OctreeNode {
  const {
    maxPointsPerNode = 50000,
    maxDepth = 8,
    minNodeSize = 0.1
  } = options

  // 计算边界
  const bounds = calculateBounds(points)
  const root: OctreeNode = {
    bounds,
    points: [],
    colors: colors ? [] : undefined,
    level: 0,
    pointCount: 0
  }

  // 递归构建
  buildOctreeRecursive(root, points, colors || [], 0, maxPointsPerNode, maxDepth, minNodeSize)

  return root
}

/**
 * 计算点云的边界
 */
function calculateBounds(points: Point3D[]): OctreeNode['bounds'] {
  if (points.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      size: 0
    }
  }

  const firstPoint = points[0]
  if (!firstPoint) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      size: 0
    }
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

  const center = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2
  }

  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ)

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    center,
    size
  }
}

/**
 * 递归构建八叉树
 */
function buildOctreeRecursive(
  node: OctreeNode,
  points: Point3D[],
  colors: Color[],
  level: number,
  maxPointsPerNode: number,
  maxDepth: number,
  minNodeSize: number
): void {
  node.level = level
  node.pointCount = points.length

  // 如果点数少于阈值或达到最大深度或节点太小，则停止分割
  if (
    points.length <= maxPointsPerNode ||
    level >= maxDepth ||
    node.bounds.size < minNodeSize
  ) {
    node.points = points
    if (colors && colors.length > 0) {
      node.colors = colors
    }
    return
  }

  // 分割为8个子节点
  const children: OctreeNode[] = []
  const childPoints: Point3D[][] = [[], [], [], [], [], [], [], []]
  const childColors: Color[][] = [[], [], [], [], [], [], [], []]

  const center = node.bounds.center
  if (!center) return

  // 将点分配到8个子节点
  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    if (!point) continue
    
    const color = colors[i]

    let index = 0
    if (center) {
      if (point.x >= center.x) index |= 1
      if (point.y >= center.y) index |= 2
      if (point.z >= center.z) index |= 4
    }

    const childPointsArray = childPoints[index]
    const childColorsArray = childColors[index]
    if (childPointsArray) {
      childPointsArray.push(point)
      if (color && childColorsArray) {
        childColorsArray.push(color)
      }
    }
  }

  // 创建子节点
  for (let i = 0; i < 8; i++) {
    const childPointsArray = childPoints[i]
    if (!childPointsArray || childPointsArray.length === 0) continue

    const childBounds = calculateChildBounds(node.bounds, i)
    const childNode: OctreeNode = {
      bounds: childBounds,
      points: [],
      colors: colors && colors.length > 0 ? [] : undefined,
      level: level + 1,
      pointCount: 0
    }

    const pointsArray = childPoints[i]
    const colorsArray = childColors[i]
    if (pointsArray) {
      buildOctreeRecursive(
        childNode,
        pointsArray,
        colorsArray || [],
        level + 1,
        maxPointsPerNode,
        maxDepth,
        minNodeSize
      )
    }

    children.push(childNode)
  }

  node.children = children
}

/**
 * 计算子节点的边界
 */
function calculateChildBounds(parentBounds: OctreeNode['bounds'], index: number): OctreeNode['bounds'] {
  const center = parentBounds.center
  const halfSize = parentBounds.size / 2

  const min = {
    x: (index & 1) ? center.x : (parentBounds.min?.x ?? center.x),
    y: (index & 2) ? center.y : (parentBounds.min?.y ?? center.y),
    z: (index & 4) ? center.z : (parentBounds.min?.z ?? center.z)
  }

  const max = {
    x: (index & 1) ? (parentBounds.max?.x ?? center.x) : center.x,
    y: (index & 2) ? (parentBounds.max?.y ?? center.y) : center.y,
    z: (index & 4) ? (parentBounds.max?.z ?? center.z) : center.z
  }

  return {
    min,
    max,
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2
    },
    size: halfSize
  }
}

/**
 * 根据相机位置和距离选择要渲染的节点（LOD）
 */
export function selectLODNodes(
  root: OctreeNode,
  cameraPosition: Point3D,
  maxDistance: number = 1000,
  maxNodes: number = 100
): { points: Point3D[]; colors?: Color[] } {
  const selectedPoints: Point3D[] = []
  const selectedColors: Color[] = []
  const nodes: OctreeNode[] = [root]
  let nodeCount = 0

  while (nodes.length > 0 && nodeCount < maxNodes) {
    const node = nodes.shift()!
    if (!node) continue

    const distance = calculateDistance(cameraPosition, node.bounds.center)
    const nodeSize = node.bounds.size

    // LOD 判断：如果节点距离远或节点小，使用该节点；否则继续分割
    const shouldUseNode = distance > nodeSize * 2 || !node.children || node.children.length === 0

    if (shouldUseNode) {
      // 使用该节点的点
      if (node.points) {
        selectedPoints.push(...node.points)
      }
      if (node.colors && node.colors.length > 0) {
        selectedColors.push(...node.colors)
      }
      nodeCount++
    } else if (node.children) {
      // 继续处理子节点
      for (const child of node.children) {
        if (child && child.bounds && child.bounds.center) {
          const childDistance = calculateDistance(cameraPosition, child.bounds.center)
          if (childDistance <= maxDistance) {
            nodes.push(child)
          }
        }
      }
    }
  }

  return {
    points: selectedPoints,
    colors: selectedColors.length > 0 ? selectedColors : undefined
  }
}

/**
 * 计算两点之间的距离
 */
function calculateDistance(p1: Point3D, p2: Point3D): number {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  const dz = p1.z - p2.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * 简化的体素下采样（类似 PCL 的 VoxelGrid）
 */
export function voxelDownsample(
  points: Point3D[],
  colors: Color[] | undefined,
  voxelSize: number
): { points: Point3D[]; colors?: Color[] } {
  if (points.length === 0) {
    return { points: [], colors: undefined }
  }

  const voxelMap = new Map<string, { point: Point3D; color?: Color; count: number }>()
  const hasColors = colors && colors.length > 0

  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    if (!point) continue
    
    const color = hasColors ? colors![i] : undefined

    // 计算体素索引
    const vx = Math.floor(point.x / voxelSize)
    const vy = Math.floor(point.y / voxelSize)
    const vz = Math.floor(point.z / voxelSize)
    const key = `${vx},${vy},${vz}`

    const existing = voxelMap.get(key)
    if (existing) {
      // 累加点的位置和颜色（用于计算平均值）
      existing.point.x += point.x
      existing.point.y += point.y
      existing.point.z += point.z
      if (existing.color && color) {
        existing.color.r += color.r
        existing.color.g += color.g
        existing.color.b += color.b
      }
      existing.count++
    } else {
      voxelMap.set(key, {
        point: { x: point.x, y: point.y, z: point.z },
        color: color ? { r: color.r, g: color.g, b: color.b, a: color.a || 1 } : undefined,
        count: 1
      })
    }
  }

  // 计算平均值并生成结果
  const resultPoints: Point3D[] = []
  const resultColors: Color[] = []

  for (const value of voxelMap.values()) {
    const count = value.count
    resultPoints.push({
      x: value.point.x / count,
      y: value.point.y / count,
      z: value.point.z / count
    })

    if (value.color) {
      resultColors.push({
        r: value.color.r / count,
        g: value.color.g / count,
        b: value.color.b / count,
        a: value.color.a
      })
    }
  }

  return {
    points: resultPoints,
    colors: hasColors && resultColors.length > 0 ? resultColors : undefined
  }
}
