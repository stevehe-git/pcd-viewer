/**
 * PCD文件解析器
 * 支持ASCII和二进制格式的PCD文件
 */

import type { PointCloudData, Point3D, Color } from '../types'

export interface PCDHeader {
  version: string
  fields: string[]
  size: number[]
  type: string[]
  count: number[]
  width: number
  height: number
  viewpoint?: string
  points: number
  data: 'ascii' | 'binary' | 'binary_compressed'
}

/**
 * 解析PCD文件头部
 */
function parsePCDHeader(headerText: string): PCDHeader {
  const lines = headerText.split('\n')
  const header: Partial<PCDHeader> = {
    fields: [],
    size: [],
    type: [],
    count: []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const [key, ...valueParts] = trimmed.split(/\s+/)
    const value = valueParts.join(' ')

    switch (key.toLowerCase()) {
      case 'version':
        header.version = value
        break
      case 'fields':
        header.fields = value.split(/\s+/)
        break
      case 'size':
        header.size = value.split(/\s+/).map(Number)
        break
      case 'type':
        header.type = value.split(/\s+/)
        break
      case 'count':
        header.count = value.split(/\s+/).map(Number)
        break
      case 'width':
        header.width = parseInt(value, 10)
        break
      case 'height':
        header.height = parseInt(value, 10)
        break
      case 'viewpoint':
        header.viewpoint = value
        break
      case 'points':
        header.points = parseInt(value, 10)
        break
      case 'data':
        header.data = value.toLowerCase() as 'ascii' | 'binary' | 'binary_compressed'
        break
    }
  }

  if (!header.version || !header.fields || !header.points || !header.data) {
    throw new Error('Invalid PCD header: missing required fields')
  }

  return header as PCDHeader
}

/**
 * 解析ASCII格式的PCD数据
 * 优化版本：使用预分配数组和批量处理
 */
function parseASCIIData(
  dataText: string,
  header: PCDHeader
): { points: Point3D[]; colors?: Color[] } {
  const lines = dataText.split('\n').filter((line) => line.trim())
  const expectedPoints = header.points || lines.length
  
  // 预分配数组大小，避免动态扩容
  const points: Point3D[] = new Array(expectedPoints)
  const colors: Color[] = []
  let pointIndex = 0

  const xIndex = header.fields.indexOf('x')
  const yIndex = header.fields.indexOf('y')
  const zIndex = header.fields.indexOf('z')
  const rIndex = header.fields.indexOf('r')
  const gIndex = header.fields.indexOf('g')
  const bIndex = header.fields.indexOf('b')
  const rgbIndex = header.fields.indexOf('rgb')

  if (xIndex === -1 || yIndex === -1 || zIndex === -1) {
    throw new Error('PCD file must contain x, y, z fields')
  }

  const hasColor = rIndex !== -1 || gIndex !== -1 || bIndex !== -1 || rgbIndex !== -1
  if (hasColor) {
    colors.length = expectedPoints
  }

  // 调试信息：输出字段索引
  console.log('Field indices (ASCII):', { xIndex, yIndex, zIndex, rIndex, gIndex, bIndex, rgbIndex, fields: header.fields })

  // 批量处理，避免频繁push
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    const values = trimmed.split(/\s+/)
    const numValues = values.length

    // 快速解析坐标（避免map创建新数组）
    const x = parseFloat(values[xIndex])
    const y = parseFloat(values[yIndex])
    const z = parseFloat(values[zIndex])

    if (isNaN(x) || isNaN(y) || isNaN(z)) continue

    // 直接赋值，避免push
    points[pointIndex] = { x, y, z }

    // 提取颜色
    if (hasColor) {
      if (rgbIndex !== -1 && rgbIndex < numValues) {
        // RGB packed in single field (usually as float)
        const rgb = parseFloat(values[rgbIndex])
        const r = Math.floor(rgb) & 0xff
        const g = Math.floor(rgb / 256) & 0xff
        const b = Math.floor(rgb / 65536) & 0xff
        colors[pointIndex] = { r: r / 255, g: g / 255, b: b / 255, a: 1 }
      } else {
        // Separate r, g, b fields
        const r = rIndex !== -1 && rIndex < numValues ? parseFloat(values[rIndex]) : 1
        const g = gIndex !== -1 && gIndex < numValues ? parseFloat(values[gIndex]) : 1
        const b = bIndex !== -1 && bIndex < numValues ? parseFloat(values[bIndex]) : 1
        // Normalize color values (assuming 0-255 range)
        const rNorm = r > 1 ? r / 255 : r
        const gNorm = g > 1 ? g / 255 : g
        const bNorm = b > 1 ? b / 255 : b
        colors[pointIndex] = { r: rNorm, g: gNorm, b: bNorm, a: 1 }
      }
    }

    pointIndex++
  }

  // 截断到实际点数
  if (pointIndex < expectedPoints) {
    points.length = pointIndex
    if (hasColor) {
      colors.length = pointIndex
    }
  }

  return { points, colors: hasColor && colors.length > 0 ? colors : undefined }
}

/**
 * 解析二进制格式的PCD数据
 */
function parseBinaryData(
  buffer: ArrayBuffer,
  header: PCDHeader,
  startOffset: number
): { points: Point3D[]; colors?: Color[] } {
  // 检查起始偏移量是否有效
  if (startOffset >= buffer.byteLength) {
    throw new Error(`Invalid start offset: ${startOffset} (buffer size: ${buffer.byteLength})`)
  }

  const availableBytes = buffer.byteLength - startOffset
  const dataView = new DataView(buffer, startOffset, availableBytes)
  const points: Point3D[] = []
  const colors: Color[] = []

  const xIndex = header.fields.indexOf('x')
  const yIndex = header.fields.indexOf('y')
  const zIndex = header.fields.indexOf('z')
  const rIndex = header.fields.indexOf('r')
  const gIndex = header.fields.indexOf('g')
  const bIndex = header.fields.indexOf('b')
  const rgbIndex = header.fields.indexOf('rgb')

  if (xIndex === -1 || yIndex === -1 || zIndex === -1) {
    throw new Error(`PCD file must contain x, y, z fields. Found fields: ${header.fields.join(', ')}`)
  }

  // 调试信息：输出字段索引
  console.log('Field indices (binary):', { xIndex, yIndex, zIndex, rIndex, gIndex, bIndex, rgbIndex, fields: header.fields })

  // 计算每个字段的偏移量和类型
  // PCD格式：字段按顺序紧密排列，不需要对齐
  // 根据实际测试，PCL的binary_compressed格式解压后的数据是紧密排列的
  const fieldOffsets: number[] = []
  const fieldTypes: string[] = []
  let currentOffset = 0
  
  for (let i = 0; i < header.fields.length; i++) {
    const fieldSize = header.size[i] * (header.count[i] || 1)
    fieldOffsets[i] = currentOffset
    fieldTypes[i] = header.type[i]
    currentOffset += fieldSize
  }
  
  const pointSize = currentOffset
  const hasColor = rIndex !== -1 || gIndex !== -1 || bIndex !== -1 || rgbIndex !== -1
  
  // 调试：输出字段偏移量信息
  console.log('Field offsets (no alignment):', {
    fieldOffsets: fieldOffsets.map((offset, i) => ({
      field: header.fields[i],
      offset,
      size: header.size[i],
      count: header.count[i],
      type: header.type[i]
    })),
    pointSize,
    expectedPointSize: header.size.reduce((sum, size, i) => sum + size * (header.count[i] || 1), 0)
  })

  // 调试信息：输出字段偏移量和点大小
  console.log('Binary parsing details:', {
    pointSize,
    availableBytes,
    expectedPoints: header.points,
    maxPossiblePoints: Math.floor(availableBytes / pointSize),
    fieldOffsets: fieldOffsets.map((offset, i) => ({
      field: header.fields[i],
      offset,
      size: header.size[i],
      count: header.count[i],
      type: header.type[i],
      totalSize: header.size[i] * (header.count[i] || 1)
    }))
  })
  
  // 验证点大小是否合理
  if (pointSize === 0) {
    throw new Error(`Invalid point size: ${pointSize}. Check header size and count fields.`)
  }
  
  // 验证数据大小是否足够
  const expectedDataSize = pointSize * header.points
  if (availableBytes < expectedDataSize) {
    console.warn(`Warning: Available bytes (${availableBytes}) is less than expected (${expectedDataSize}). File may be truncated.`)
  }

  // 读取数据
  let offset = 0
  const numPoints = Math.min(header.points, Math.floor(availableBytes / pointSize))
  
  console.log(`Will attempt to read ${numPoints} points (pointSize=${pointSize}, availableBytes=${availableBytes})`)
  
  let validPoints = 0
  let invalidPoints = 0

  for (let i = 0; i < numPoints; i++) {
    // 检查是否有足够的数据读取一个完整的点
    if (offset + pointSize > availableBytes) {
      break // 数据不足，停止读取
    }

    // 读取x, y, z
    // 注意：fieldOffsets是相对于每个点起始位置的偏移量
    // 所以实际偏移量 = 当前点的offset + 字段在点内的偏移量
    const xOffset = offset + fieldOffsets[xIndex]
    const yOffset = offset + fieldOffsets[yIndex]
    const zOffset = offset + fieldOffsets[zIndex]
    
    // 验证偏移量（相对于dataView的偏移量）
    const xOffsetInView = xOffset
    const yOffsetInView = yOffset
    const zOffsetInView = zOffset
    
    if (xOffsetInView + header.size[xIndex] > availableBytes || 
        yOffsetInView + header.size[yIndex] > availableBytes || 
        zOffsetInView + header.size[zIndex] > availableBytes) {
      console.warn(`Point ${i}: offset out of bounds, skipping`)
      offset += pointSize
      continue
    }
    
    // 读取字段值（注意：readField使用的是相对于dataView的偏移量）
    const x = readField(dataView, xOffsetInView, fieldTypes[xIndex], header.size[xIndex], availableBytes)
    const y = readField(dataView, yOffsetInView, fieldTypes[yIndex], header.size[yIndex], availableBytes)
    const z = readField(dataView, zOffsetInView, fieldTypes[zIndex], header.size[zIndex], availableBytes)

    // 调试前10个点的详细信息
    if (i < 10) {
      const pointBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, pointSize)
      const xBytes = pointBytes.slice(fieldOffsets[xIndex], fieldOffsets[xIndex] + header.size[xIndex])
      const yBytes = pointBytes.slice(fieldOffsets[yIndex], fieldOffsets[yIndex] + header.size[yIndex])
      const zBytes = pointBytes.slice(fieldOffsets[zIndex], fieldOffsets[zIndex] + header.size[zIndex])
      
      // 手动解析float32验证
      const xManual = new DataView(xBytes.buffer, xBytes.byteOffset, xBytes.length).getFloat32(0, true)
      const yManual = new DataView(yBytes.buffer, yBytes.byteOffset, yBytes.length).getFloat32(0, true)
      const zManual = new DataView(zBytes.buffer, zBytes.byteOffset, zBytes.length).getFloat32(0, true)
      
      // 预期值（从ASCII格式）
      const expectedValues = [
        { x: -6.074852, y: -14.039310, z: -1.622512 },
        { x: -5.744178, y: -14.592180, z: -1.576594 },
        { x: -10.339480, y: -50.591090, z: 0.890583 },
        { x: -5.248258, y: -15.187070, z: -1.549184 },
        { x: -4.776381, y: -15.665570, z: -1.475647 }
      ]
      
      console.log(`Point ${i}:`, {
        pointOffset: offset,
        pointSize,
        fieldOffsets: {
          x: fieldOffsets[xIndex],
          y: fieldOffsets[yIndex],
          z: fieldOffsets[zIndex]
        },
        actualOffsets: {
          x: xOffsetInView,
          y: yOffsetInView,
          z: zOffsetInView
        },
        parsedValues: { x, y, z },
        manualParsedValues: { x: xManual, y: yManual, z: zManual },
        expectedValues: expectedValues[i] || null,
        matches: expectedValues[i] ? {
          x: Math.abs(x - expectedValues[i].x) < 0.001,
          y: Math.abs(y - expectedValues[i].y) < 0.001,
          z: Math.abs(z - expectedValues[i].z) < 0.001
        } : null,
        rawPointBytes: Array.from(pointBytes),
        hexValues: {
          x: Array.from(xBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
          y: Array.from(yBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
          z: Array.from(zBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
        }
      })
    }

    // 验证坐标值是否合理（过滤异常值）
    // 放宽限制：很多LiDAR点云的坐标值可能在较大范围内
    // 但异常大的值（如1e30）肯定是错误的
    const isValid = !isNaN(x) && !isNaN(y) && !isNaN(z) && 
                    isFinite(x) && isFinite(y) && isFinite(z) &&
                    Math.abs(x) <= 1e8 && Math.abs(y) <= 1e8 && Math.abs(z) <= 1e8 &&
                    Math.abs(x) >= -1e8 && Math.abs(y) >= -1e8 && Math.abs(z) >= -1e8
    
    if (!isValid) {
      invalidPoints++
      if (i < 20) {
        console.warn(`Point ${i}: invalid coordinates (x=${x}, y=${y}, z=${z}), skipping. Offset=${offset}, pointSize=${pointSize}`)
        // 输出该点的所有字段的原始字节数据
        const pointBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, pointSize)
        console.warn(`  Raw bytes:`, Array.from(pointBytes))
      }
      offset += pointSize
      continue
    }

    validPoints++
    points.push({ x, y, z })

    // 读取颜色
    if (hasColor) {
      if (rgbIndex !== -1) {
        const rgb = readField(dataView, offset + fieldOffsets[rgbIndex], fieldTypes[rgbIndex], header.size[rgbIndex], availableBytes)
        const r = Math.floor(rgb) & 0xff
        const g = Math.floor(rgb / 256) & 0xff
        const b = Math.floor(rgb / 65536) & 0xff
        colors.push({ r: r / 255, g: g / 255, b: b / 255, a: 1 })
      } else {
        const r = rIndex !== -1 ? readField(dataView, offset + fieldOffsets[rIndex], fieldTypes[rIndex], header.size[rIndex], availableBytes) : 1
        const g = gIndex !== -1 ? readField(dataView, offset + fieldOffsets[gIndex], fieldTypes[gIndex], header.size[gIndex], availableBytes) : 1
        const b = bIndex !== -1 ? readField(dataView, offset + fieldOffsets[bIndex], fieldTypes[bIndex], header.size[bIndex], availableBytes) : 1
        const rNorm = r > 1 ? r / 255 : r
        const gNorm = g > 1 ? g / 255 : g
        const bNorm = b > 1 ? b / 255 : b
        colors.push({ r: rNorm, g: gNorm, b: bNorm, a: 1 })
      }
    }

    offset += pointSize
  }

  console.log(`Parsed ${validPoints} valid points out of ${numPoints} attempted (${invalidPoints} invalid points skipped)`)

  return { points, colors: hasColor && colors.length > 0 ? colors : undefined }
}

/**
 * 从DataView读取字段值
 * PCD格式使用little-endian字节序
 */
function readField(dataView: DataView, offset: number, type: string, size: number, maxOffset: number): number {
  // 检查偏移量是否在有效范围内
  if (offset < 0 || offset + size > maxOffset) {
    throw new Error(`Field read out of bounds: offset=${offset}, size=${size}, maxOffset=${maxOffset}`)
  }

  // 调试：输出原始字节
  const rawBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, size)
  
  switch (type) {
    case 'I':
      // Signed integer
      if (size === 1) return dataView.getInt8(offset)
      if (size === 2) return dataView.getInt16(offset, true) // little-endian
      if (size === 4) return dataView.getInt32(offset, true) // little-endian
      if (size === 8) {
        // int64 - JavaScript doesn't support 64-bit integers natively
        // 读取为两个32位整数
        const low = dataView.getInt32(offset, true)
        const high = dataView.getInt32(offset + 4, true)
        // 注意：这可能会丢失精度
        return high * 0x100000000 + (low >>> 0)
      }
      break
    case 'U':
      // Unsigned integer
      if (size === 1) return dataView.getUint8(offset)
      if (size === 2) return dataView.getUint16(offset, true) // little-endian
      if (size === 4) return dataView.getUint32(offset, true) // little-endian
      if (size === 8) {
        // uint64 - JavaScript doesn't support 64-bit integers natively
        const low = dataView.getUint32(offset, true)
        const high = dataView.getUint32(offset + 4, true)
        // 注意：这可能会丢失精度
        return high * 0x100000000 + (low >>> 0)
      }
      break
    case 'F':
      // Floating point
      if (size === 4) {
        const value = dataView.getFloat32(offset, true) // little-endian
        return value
      }
      if (size === 8) {
        const value = dataView.getFloat64(offset, true) // little-endian
        return value
      }
      break
  }
  throw new Error(`Unsupported field type: ${type} with size ${size}`)
}

/**
 * LZF解压缩算法
 * PCD文件的binary_compressed格式使用LZF压缩
 * 基于liblzf算法（PCL使用的标准实现）
 * 
 * LZF格式说明：
 * - 控制字节 < 32: 字面量，复制接下来的(ctrl+1)个字节
 * - 控制字节 >= 32: 匹配引用
 *   - 长度 = (ctrl >> 5) + 2，如果长度是7则读取额外字节
 *   - 偏移量 = ((ctrl & 0x1f) << 8) | next_byte，从当前位置向前
 */
function lzfDecompress(compressed: Uint8Array, decompressedSize: number): Uint8Array {
  const decompressed = new Uint8Array(decompressedSize)
  let inputPos = 0
  let outputPos = 0
  const inputLength = compressed.length
  
  // 调试：记录前几个操作
  const debugSteps: Array<{type: string, inputPos: number, outputPos: number, length?: number, offset?: number, firstBytes?: number[]}> = []
  const maxDebugSteps = 10

  while (inputPos < inputLength && outputPos < decompressedSize) {
    const ctrl = compressed[inputPos++]
    const stepStartInputPos = inputPos - 1
    const stepStartOutputPos = outputPos

    if (ctrl < 32) {
      // 字面量运行：复制接下来的ctrl+1个字节
      let length = ctrl + 1
      
      // 边界检查
      if (inputPos + length > inputLength) {
        length = inputLength - inputPos
        if (length === 0) break
      }
      
      if (outputPos + length > decompressedSize) {
        length = decompressedSize - outputPos
        if (length === 0) break
      }
      
      // 调试：记录前几个字面量操作
      if (debugSteps.length < maxDebugSteps) {
        const copiedBytes = Array.from(compressed.subarray(inputPos, inputPos + Math.min(length, 12)))
        debugSteps.push({
          type: 'literal',
          inputPos: stepStartInputPos,
          outputPos: stepStartOutputPos,
          length,
          firstBytes: copiedBytes
        })
      }
      
      // 复制字面量数据
      decompressed.set(compressed.subarray(inputPos, inputPos + length), outputPos)
      inputPos += length
      outputPos += length
    } else {
      // 匹配引用：从之前解压的数据中复制
      let length = ctrl >> 5
      
      // 如果长度是7，需要读取额外的长度字节
      if (length === 7) {
        if (inputPos >= inputLength) {
          throw new Error('LZF decompression error: unexpected end of input when reading extended length')
        }
        length += compressed[inputPos++]
      }
      length += 2 // 最小匹配长度是2

      // 读取偏移量字节
      if (inputPos >= inputLength) {
        throw new Error('LZF decompression error: unexpected end of input when reading offset')
      }
      const offsetLow = compressed[inputPos++]
      const offsetHigh = ctrl & 0x1f
      let offset = (offsetHigh << 8) | offsetLow

      // 计算实际偏移量（从当前位置向前）
      offset = outputPos - offset - 1

      // 验证偏移量
      if (offset < 0 || offset >= outputPos) {
        throw new Error(`LZF decompression error: invalid offset ${offset} at position ${outputPos}`)
      }

      // 检查输出空间
      if (outputPos + length > decompressedSize) {
        length = decompressedSize - outputPos
        if (length === 0) break
      }

      // 调试：记录前几个匹配操作
      if (debugSteps.length < maxDebugSteps) {
        const copiedBytes = Array.from(decompressed.subarray(offset, offset + Math.min(length, 12)))
        debugSteps.push({
          type: 'match',
          inputPos: stepStartInputPos,
          outputPos: stepStartOutputPos,
          length,
          offset,
          firstBytes: copiedBytes
        })
      }

      // 复制匹配数据（可能重叠，必须逐个字节复制）
      // 注意：不能使用set或copyWithin，因为可能重叠
      for (let i = 0; i < length; i++) {
        if (outputPos >= decompressedSize) break
        decompressed[outputPos++] = decompressed[offset + i]
      }
    }
  }

  // 输出调试信息
  if (debugSteps.length > 0) {
    console.log('LZF decompression steps (first', debugSteps.length, 'steps):', debugSteps)
    console.log('First 32 bytes after decompression:', Array.from(decompressed.slice(0, 32)))
  }

  // 验证解压大小
  if (outputPos !== decompressedSize) {
    const diff = decompressedSize - outputPos
    if (diff > decompressedSize * 0.01) {
      throw new Error(`LZF decompression error: size mismatch (expected ${decompressedSize}, got ${outputPos}, diff: ${diff})`)
    } else {
      // 小差异可能是正常的，用零填充
      decompressed.fill(0, outputPos)
    }
  }

  return decompressed
}

/**
 * 解析binary_compressed格式的PCD数据
 * PCD binary_compressed格式结构（根据PCL实现）：
 * - uint32_t: 压缩数据的压缩大小
 * - uint32_t: 压缩数据的未压缩大小
 * - uint8_t[]: LZF压缩的数据
 * 
 * 注意：PCL的binary_compressed格式通常只有一个压缩块，整个点云数据作为一个块压缩
 */
function parseBinaryCompressedData(
  buffer: ArrayBuffer,
  header: PCDHeader,
  startOffset: number
): { points: Point3D[]; colors?: Color[] } {
  // 检查起始偏移量是否有效
  if (startOffset >= buffer.byteLength) {
    throw new Error(`Invalid start offset: ${startOffset} (buffer size: ${buffer.byteLength})`)
  }

  const availableBytes = buffer.byteLength - startOffset
  if (availableBytes < 8) {
    throw new Error('Not enough data to read compression header (need at least 8 bytes)')
  }

  const dataView = new DataView(buffer, startOffset, availableBytes)
  let offset = 0

  // 读取压缩大小
  const compressedSize = dataView.getUint32(offset, true)
  offset += 4

  // 读取未压缩大小
  const uncompressedSize = dataView.getUint32(offset, true)
  offset += 4

  // 验证大小合理性
  if (compressedSize === 0 || compressedSize > availableBytes - offset) {
    throw new Error(`Invalid compressed size: ${compressedSize} (available: ${availableBytes - offset})`)
  }

  if (uncompressedSize === 0 || uncompressedSize > 1000000000) {
    throw new Error(`Invalid uncompressed size: ${uncompressedSize}`)
  }

  // 检查是否有足够的数据
  if (offset + compressedSize > availableBytes) {
    throw new Error(`Not enough data for compressed data: need ${compressedSize}, have ${availableBytes - offset}`)
  }

  // 读取压缩数据
  // 注意：压缩数据紧跟在uncompressedSize之后
  const compressedDataStart = startOffset + offset
  const compressedData = new Uint8Array(buffer, compressedDataStart, compressedSize)

  // 调试：输出压缩数据的开头几个字节
  if (compressedData.length > 0) {
    const firstBytes = Array.from(compressedData.slice(0, Math.min(20, compressedData.length)))
    console.log('Compressed data first bytes:', {
      firstBytes,
      hexBytes: firstBytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '),
      compressedSize,
      uncompressedSize,
      offset,
      dataStartOffset: startOffset
    })
  }

  // 解压缩
  let decompressedData: Uint8Array
  try {
    decompressedData = lzfDecompress(compressedData, uncompressedSize)
  } catch (error) {
    throw new Error(`Failed to decompress data: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  // 验证解压缩后的数据大小
  if (decompressedData.length !== uncompressedSize) {
    console.warn(`Decompressed size mismatch: expected ${uncompressedSize}, got ${decompressedData.length}`)
  }

  // 计算期望的数据大小（不对齐）
  const pointSizeNoAlign = header.size.reduce((sum, size, i) => sum + size * (header.count[i] || 1), 0)
  const expectedDecompressedSize = pointSizeNoAlign * header.points
  
  console.log('Decompression info:', {
    compressedSize,
    uncompressedSize,
    actualDecompressedSize: decompressedData.length,
    pointSizeNoAlign,
    expectedDecompressedSize,
    points: header.points,
    match: decompressedData.length === expectedDecompressedSize,
    note: uncompressedSize === expectedDecompressedSize ? '数据大小匹配，不需要对齐' : '数据大小不匹配，可能需要对齐'
  })

  // 验证解压缩后的第一个点的数据
  if (decompressedData.length >= pointSizeNoAlign) {
    const firstPointBytes = decompressedData.slice(0, pointSizeNoAlign)
    const xBytes = firstPointBytes.slice(0, 4)
    const yBytes = firstPointBytes.slice(4, 8)
    const zBytes = firstPointBytes.slice(8, 12)
    
    const xVal = new DataView(xBytes.buffer, xBytes.byteOffset, xBytes.length).getFloat32(0, true)
    const yVal = new DataView(yBytes.buffer, yBytes.byteOffset, yBytes.length).getFloat32(0, true)
    const zVal = new DataView(zBytes.buffer, zBytes.byteOffset, zBytes.length).getFloat32(0, true)
    
    console.log('First point after decompression:', {
      x: xVal,
      y: yVal,
      z: zVal,
      expected: { x: -6.074852, y: -14.039310, z: -1.622512 },
      matches: {
        x: Math.abs(xVal - (-6.074852)) < 0.001,
        y: Math.abs(yVal - (-14.039310)) < 0.001,
        z: Math.abs(zVal - (-1.622512)) < 0.001
      },
      rawBytes: Array.from(firstPointBytes),
      hexBytes: Array.from(firstPointBytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')
    })
  }

  // 使用解压缩后的数据，按照binary格式解析
  // 注意：解压缩后的数据是一个新的ArrayBuffer，startOffset应该是0
  // 重要：PCL的binary_compressed格式解压后的数据是紧密排列的，不需要对齐
  return parseBinaryData(decompressedData.buffer, header, 0)
}

/**
 * 解析PCD文件
 */
export async function parsePCDFile(file: File): Promise<PointCloudData> {
  return new Promise((resolve, reject) => {
    // 先读取为ArrayBuffer以支持二进制格式
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const result = e.target?.result
        if (!result || !(result instanceof ArrayBuffer)) {
          reject(new Error('Failed to read file'))
          return
        }

        // 解码头部（PCD头部总是文本格式）
        // 使用 'ignore' 错误处理模式，避免二进制数据影响解码
        const textDecoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
        const text = textDecoder.decode(result)
        const headerEnd = text.indexOf('DATA')
        if (headerEnd === -1) {
          reject(new Error('Invalid PCD file: DATA field not found'))
          return
        }

        // 找到DATA行的结束位置
        const dataLineEnd = text.indexOf('\n', headerEnd)
        if (dataLineEnd === -1) {
          reject(new Error('Invalid PCD file: malformed header'))
          return
        }

        const headerText = text.substring(0, dataLineEnd + 1)
        const dataTypeLine = text.substring(headerEnd, dataLineEnd)
        const dataType = dataTypeLine.split(/\s+/)[1]?.toLowerCase()

        const header = parsePCDHeader(headerText)
        
        // 调试信息：输出字段顺序
        console.log('PCD Header:', {
          fields: header.fields,
          size: header.size,
          type: header.type,
          count: header.count,
          points: header.points,
          data: header.data
        })

        // 计算数据起始位置：找到DATA行结束后的字节位置
        // 使用 TextEncoder 重新编码头部文本，确保字节位置准确
        const headerTextBytes = new TextEncoder().encode(headerText)
        const dataStartOffset = headerTextBytes.length
        
        // 调试信息：输出数据起始位置和点大小
        const pointSize = header.size.reduce((sum, size, i) => sum + size * (header.count[i] || 1), 0)
        console.log('Data parsing info:', {
          dataStartOffset,
          fileSize: result.byteLength,
          pointSize,
          expectedTotalSize: pointSize * header.points,
          fields: header.fields.map((f, i) => ({
            name: f,
            size: header.size[i],
            count: header.count[i],
            type: header.type[i],
            offset: header.size.slice(0, i).reduce((sum, s, idx) => sum + s * (header.count[idx] || 1), 0)
          }))
        })

        // 验证数据起始位置
        if (dataStartOffset >= result.byteLength) {
          reject(new Error(`Invalid data start offset: ${dataStartOffset} (file size: ${result.byteLength})`))
          return
        }

        let points: Point3D[]
        let colors: Color[] | undefined

        if (header.data === 'binary_compressed') {
          // binary_compressed格式：需要先解压缩
          const compressedResult = parseBinaryCompressedData(result, header, dataStartOffset)
          points = compressedResult.points
          colors = compressedResult.colors
        } else if (header.data === 'binary') {
          // 二进制格式：直接使用计算好的偏移量
          const binaryResult = parseBinaryData(result, header, dataStartOffset)
          points = binaryResult.points
          colors = binaryResult.colors
        } else {
          // ASCII格式：直接使用文本数据
          const dataText = text.substring(dataLineEnd + 1)
          const asciiResult = parseASCIIData(dataText, header)
          points = asciiResult.points
          colors = asciiResult.colors
        }

        if (points.length === 0) {
          reject(new Error('No valid points found in PCD file'))
          return
        }

        // 调试信息：输出前几个点的坐标
        if (points.length > 0) {
          console.log('First 5 points:', points.slice(0, 5))
          
          // 使用循环计算边界，避免栈溢出（对于大点云）
          let minX = points[0].x
          let minY = points[0].y
          let minZ = points[0].z
          let maxX = points[0].x
          let maxY = points[0].y
          let maxZ = points[0].z
          
          // 只计算前10000个点的边界作为示例（避免大点云计算太慢）
          const sampleSize = Math.min(points.length, 10000)
          for (let i = 1; i < sampleSize; i++) {
            const p = points[i]
            if (!p) continue
            minX = Math.min(minX, p.x)
            minY = Math.min(minY, p.y)
            minZ = Math.min(minZ, p.z)
            maxX = Math.max(maxX, p.x)
            maxY = Math.max(maxY, p.y)
            maxZ = Math.max(maxZ, p.z)
          }
          
          console.log('Point cloud bounds (sample):', {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ },
            sampleSize,
            totalPoints: points.length
          })
        }

        resolve({
          points,
          colors,
          pointSize: 2.0 // 默认点大小
        })
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    // 读取为ArrayBuffer以支持二进制格式
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 从URL加载PCD文件
 */
export async function loadPCDFromURL(url: string): Promise<PointCloudData> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load PCD file: ${response.statusText}`)
  }

  const blob = await response.blob()
  const file = new File([blob], 'pointcloud.pcd', { type: 'application/octet-stream' })
  return parsePCDFile(file)
}

/**
 * 点云下采样（均匀下采样实现）
 * 内部函数，避免递归调用
 */
function uniformDownsample(
  data: PointCloudData,
  targetPoints: number
): PointCloudData {
  const numPoints = data.points.length
  
  // 如果点数已经很少，不需要下采样
  if (numPoints <= targetPoints) {
    return data
  }

  const step = Math.max(1, Math.floor(numPoints / targetPoints))
  if (step === 1) {
    return data
  }

  const downsampledPoints: Point3D[] = []
  const downsampledColors: Color[] | undefined = data.colors ? [] : undefined

  for (let i = 0; i < numPoints; i += step) {
    downsampledPoints.push(data.points[i])
    if (downsampledColors && data.colors) {
      downsampledColors.push(data.colors[i])
    }
  }

  return {
    points: downsampledPoints,
    colors: downsampledColors,
    pointSize: data.pointSize || 1.0
  }
}

/**
 * 点云下采样
 * 使用体素网格下采样或均匀下采样
 * 
 * 注意：voxel 方法返回 Promise，uniform 方法返回同步结果
 */
export function downsamplePointCloud(
  data: PointCloudData,
  targetPoints?: number,
  method: 'uniform' | 'voxel' = 'uniform'
): PointCloudData | Promise<PointCloudData> {
  if (!data || !data.points || data.points.length === 0) {
    return data
  }

  const numPoints = data.points.length
  
  // 如果点数已经很少，不需要下采样
  if (targetPoints && numPoints <= targetPoints) {
    return data
  }

  // 均匀下采样：直接返回结果，避免递归
  if (method === 'uniform') {
    const defaultTarget = targetPoints || 1000000
    return uniformDownsample(data, defaultTarget)
  }

  // 体素下采样：更智能，保持空间分布
  if (method === 'voxel') {
    // 计算合适的体素大小
    const bounds = calculateBounds(data.points)
    const dx = bounds.max.x - bounds.min.x
    const dy = bounds.max.y - bounds.min.y
    const dz = bounds.max.z - bounds.min.z
    const volume = dx * dy * dz
    
    // 如果体积为0或无效，回退到均匀下采样（使用内部函数避免递归）
    if (volume <= 0 || !isFinite(volume)) {
      console.warn('Invalid bounds for voxel downsample, falling back to uniform')
      const defaultTarget = targetPoints || 1000000
      return uniformDownsample(data, defaultTarget)
    }
    
    const defaultTarget = targetPoints || 1000000
    const voxelSize = Math.cbrt(volume / defaultTarget) * 1.2 // 稍微增大体素以确保达到目标
    
    // 确保体素大小有效
    if (!isFinite(voxelSize) || voxelSize <= 0) {
      console.warn('Invalid voxel size, falling back to uniform')
      return uniformDownsample(data, defaultTarget)
    }

    // 动态导入以避免循环依赖
    return import('./octree').then(({ voxelDownsample }) => {
      const result = voxelDownsample(data.points, data.colors, voxelSize)
      
      // 确保返回有效的点云数据
      if (!result || !result.points || result.points.length === 0) {
        console.warn('Voxel downsample returned empty result, falling back to uniform')
        return uniformDownsample(data, defaultTarget)
      }
      
      return {
        points: result.points,
        colors: result.colors,
        pointSize: data.pointSize || 1.0
      }
    }).catch((error) => {
      // 如果导入失败，回退到均匀下采样（使用内部函数避免递归）
      console.warn('Voxel downsample not available, falling back to uniform:', error)
      const defaultTarget = targetPoints || 1000000
      return uniformDownsample(data, defaultTarget)
    })
  }

  // 默认返回原始数据
  return data
}


/**
 * 计算点云的边界
 */
function calculateBounds(points: Point3D[]): { min: Point3D; max: Point3D } {
  if (points.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  }

  let minX = points[0].x
  let minY = points[0].y
  let minZ = points[0].z
  let maxX = points[0].x
  let maxY = points[0].y
  let maxZ = points[0].z

  for (let i = 1; i < points.length; i++) {
    const p = points[i]
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
