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
 */
function parseASCIIData(
  dataText: string,
  header: PCDHeader
): { points: Point3D[]; colors?: Color[] } {
  const lines = dataText.split('\n').filter((line) => line.trim())
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
    throw new Error('PCD file must contain x, y, z fields')
  }

  const hasColor = rIndex !== -1 || gIndex !== -1 || bIndex !== -1 || rgbIndex !== -1

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const values = trimmed.split(/\s+/).map(parseFloat)

    // 提取坐标
    const x = values[xIndex]
    const y = values[yIndex]
    const z = values[zIndex]

    if (isNaN(x) || isNaN(y) || isNaN(z)) continue

    points.push({ x, y, z })

    // 提取颜色
    if (hasColor) {
      if (rgbIndex !== -1) {
        // RGB packed in single field (usually as float)
        const rgb = values[rgbIndex]
        const r = Math.floor(rgb) & 0xff
        const g = Math.floor(rgb / 256) & 0xff
        const b = Math.floor(rgb / 65536) & 0xff
        colors.push({ r: r / 255, g: g / 255, b: b / 255, a: 1 })
      } else {
        // Separate r, g, b fields
        const r = rIndex !== -1 ? values[rIndex] : 1
        const g = gIndex !== -1 ? values[gIndex] : 1
        const b = bIndex !== -1 ? values[bIndex] : 1
        // Normalize color values (assuming 0-255 range)
        const rNorm = r > 1 ? r / 255 : r
        const gNorm = g > 1 ? g / 255 : g
        const bNorm = b > 1 ? b / 255 : b
        colors.push({ r: rNorm, g: gNorm, b: bNorm, a: 1 })
      }
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
    throw new Error('PCD file must contain x, y, z fields')
  }

  // 计算每个字段的偏移量和类型
  const fieldOffsets: number[] = []
  const fieldTypes: string[] = []
  let currentOffset = 0
  for (let i = 0; i < header.fields.length; i++) {
    fieldOffsets[i] = currentOffset
    fieldTypes[i] = header.type[i]
    currentOffset += header.size[i] * header.count[i]
  }

  const pointSize = currentOffset
  const hasColor = rIndex !== -1 || gIndex !== -1 || bIndex !== -1 || rgbIndex !== -1

  // 读取数据
  let offset = 0
  const numPoints = Math.min(header.points, Math.floor(availableBytes / pointSize))

  for (let i = 0; i < numPoints; i++) {
    // 检查是否有足够的数据读取一个完整的点
    if (offset + pointSize > availableBytes) {
      break // 数据不足，停止读取
    }

    // 读取x, y, z
    const x = readField(dataView, offset + fieldOffsets[xIndex], fieldTypes[xIndex], header.size[xIndex], availableBytes)
    const y = readField(dataView, offset + fieldOffsets[yIndex], fieldTypes[yIndex], header.size[yIndex], availableBytes)
    const z = readField(dataView, offset + fieldOffsets[zIndex], fieldTypes[zIndex], header.size[zIndex], availableBytes)

    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      offset += pointSize
      continue
    }

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

  return { points, colors: hasColor && colors.length > 0 ? colors : undefined }
}

/**
 * 从DataView读取字段值
 */
function readField(dataView: DataView, offset: number, type: string, size: number, maxOffset: number): number {
  // 检查偏移量是否在有效范围内
  if (offset < 0 || offset + size > maxOffset) {
    throw new Error(`Field read out of bounds: offset=${offset}, size=${size}, maxOffset=${maxOffset}`)
  }

  switch (type) {
    case 'I':
      if (size === 1) return dataView.getInt8(offset)
      if (size === 2) return dataView.getInt16(offset, true)
      if (size === 4) return dataView.getInt32(offset, true)
      break
    case 'U':
      if (size === 1) return dataView.getUint8(offset)
      if (size === 2) return dataView.getUint16(offset, true)
      if (size === 4) return dataView.getUint32(offset, true)
      break
    case 'F':
      if (size === 4) return dataView.getFloat32(offset, true)
      if (size === 8) return dataView.getFloat64(offset, true)
      break
  }
  throw new Error(`Unsupported field type: ${type} with size ${size}`)
}

/**
 * LZF解压缩算法
 * PCD文件的binary_compressed格式使用LZF压缩
 * 基于PCL的LZF实现（liblzf算法）
 */
function lzfDecompress(compressed: Uint8Array, decompressedSize: number): Uint8Array {
  const decompressed = new Uint8Array(decompressedSize)
  let inputPos = 0
  let outputPos = 0
  const inputLength = compressed.length

  while (inputPos < inputLength && outputPos < decompressedSize) {
    let ctrl = compressed[inputPos++]

    if (ctrl < 32) {
      // 字面量运行：复制接下来的ctrl+1个字节
      let length = ctrl + 1
      
      // 检查是否有足够的输入数据
      if (inputPos + length > inputLength) {
        // 如果输入数据不足，复制剩余的所有数据
        length = inputLength - inputPos
        if (length === 0) break
      }
      
      // 检查输出空间
      if (outputPos + length > decompressedSize) {
        // 如果输出空间不足，截断
        length = decompressedSize - outputPos
        if (length === 0) break
      }
      
      // 批量复制字面量数据
      decompressed.set(compressed.subarray(inputPos, inputPos + length), outputPos)
      inputPos += length
      outputPos += length
    } else {
      // 匹配（引用）：从之前解压的数据中复制
      let length = ctrl >> 5
      
      // 如果长度是7，需要读取额外的长度字节
      if (length === 7) {
        if (inputPos >= inputLength) {
          throw new Error('LZF decompression error: unexpected end of input when reading extended length')
        }
        length += compressed[inputPos++]
      }
      length += 2

      // 读取偏移量（低8位在下一个字节）
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
        // 如果输出空间不足，截断
        length = decompressedSize - outputPos
        if (length === 0) break
      }

      // 复制匹配数据（可能重叠，需要逐个字节复制）
      for (let i = 0; i < length; i++) {
        decompressed[outputPos++] = decompressed[offset + i]
      }
    }
  }

  // 如果解压的数据少于预期，可能是正常的（如果输入数据提前结束）
  // 但如果差异很大，可能是算法实现有问题
  if (outputPos < decompressedSize) {
    const diff = decompressedSize - outputPos
    // 如果差异超过1%，可能是问题
    if (diff > decompressedSize * 0.01) {
      console.warn(`LZF decompression: size mismatch (expected ${decompressedSize}, got ${outputPos}, diff: ${diff})`)
      // 用零填充剩余空间（虽然这可能不正确，但至少不会崩溃）
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
  const compressedData = new Uint8Array(buffer, startOffset + offset, compressedSize)

  // 解压缩
  let decompressedData: Uint8Array
  try {
    decompressedData = lzfDecompress(compressedData, uncompressedSize)
  } catch (error) {
    throw new Error(`Failed to decompress data: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  // 使用解压缩后的数据，按照binary格式解析
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

        // 计算数据起始位置：找到DATA行结束后的字节位置
        // 使用 TextEncoder 重新编码头部文本，确保字节位置准确
        const headerTextBytes = new TextEncoder().encode(headerText)
        const dataStartOffset = headerTextBytes.length

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
