# 渲染调试工具使用指南

## 概述

渲染调试工具 (`renderDebug.ts`) 提供了详细的渲染性能和数据统计信息，帮助开发者诊断和优化点云渲染性能。

## 快速开始

### 在浏览器控制台中使用

调试工具在开发环境下会自动暴露到全局对象 `window.__RVIZ_DEBUG__`。

```javascript
// 启用详细调试（verbose模式）
window.__RVIZ_DEBUG__.enable('verbose')

// 启用基础调试
window.__RVIZ_DEBUG__.enable('basic')

// 启用详细调试（但不包含性能统计）
window.__RVIZ_DEBUG__.enable('detailed')

// 禁用调试
window.__RVIZ_DEBUG__.disable()

// 打印统计报告
window.__RVIZ_DEBUG__.printStats()

// 获取当前统计信息
const stats = window.__RVIZ_DEBUG__.getStats()

// 获取性能统计
const perfStats = window.__RVIZ_DEBUG__.getPerformanceStats()

// 重置统计信息
window.__RVIZ_DEBUG__.resetStats()

// 自定义配置
window.__RVIZ_DEBUG__.configure({
  enabled: true,
  logLevel: 'verbose',
  logRenderCalls: true,
  logPointCloudUpdates: true,
  logPerformance: true,
  logMemory: true
})
```

## 调试级别

### `none`
不输出任何调试信息。

### `basic`
输出基本的调试信息：
- 渲染调用次数
- 点云更新次数
- 基本性能指标

### `detailed`
输出详细的调试信息：
- 所有 `basic` 级别的信息
- 矩阵信息（projection, view）
- 内存使用情况
- 缓冲区大小

### `verbose`
输出最详细的调试信息：
- 所有 `detailed` 级别的信息
- 性能统计（平均值、最小值、最大值）
- 每次渲染和更新的详细时间
- 绘制调用的详细信息

## 调试信息说明

### 渲染调用信息

当 `logRenderCalls` 为 `true` 时，每次渲染会输出：

```javascript
[RenderDebug] 渲染调用 {
  call: 1,                    // 渲染调用次数
  viewport: { width: 800, height: 600 },
  renderTime: "2.34ms",       // 本次渲染耗时
  pointCount: 99305,          // 渲染的点数
  projection: [...],          // 投影矩阵（detailed/verbose）
  view: [...],                // 视图矩阵（detailed/verbose）
  performance: {              // 性能统计（verbose）
    avg: "2.45ms",
    min: "1.23ms",
    max: "5.67ms",
    samples: 100
  }
}
```

### 点云更新信息

当 `logPointCloudUpdates` 为 `true` 时，每次点云更新会输出：

```javascript
[RenderDebug] 点云更新 {
  update: 1,                  // 更新次数
  pointCount: "99,305",       // 点数（格式化）
  hasColors: true,            // 是否有颜色
  pointSize: 2.0,             // 点大小
  bufferSize: "7.58MB",       // 缓冲区大小
  timeSinceLastUpdate: "123.45ms", // 距离上次更新的时间
  updateTime: "45.67ms",      // 本次更新耗时
  memory: {                   // 内存信息（detailed/verbose）
    used: "125.34MB",
    total: "256.00MB",
    percentage: "48.96%"
  },
  updatePerformance: {        // 更新性能统计（verbose）
    avg: "45.23ms",
    min: "12.34ms",
    max: "89.12ms",
    samples: 50
  }
}
```

### 命令创建信息

当创建渲染命令时会输出：

```javascript
[RenderDebug] 命令创建 Points {
  commandType: "Points",
  useWorldSpaceSize: false,
  minPointSize: 1,
  maxPointSize: 64
}
```

### 缓冲区创建信息

当创建缓冲区时会输出：

```javascript
[RenderDebug] 缓冲区创建 {
  bufferType: "points",
  size: "1.14MB",
  elementCount: 297915,
  dataType: "Float32Array"
}
```

### 绘制调用信息

每次绘制调用会输出：

```javascript
[RenderDebug] 绘制调用 {
  commandType: "Points",
  count: 99305,
  pointSize: 2.0,
  hasColors: true
}
```

## 统计报告示例

调用 `printStats()` 会输出完整的统计报告：

```
[RenderDebug] 统计报告
  渲染统计: {
    渲染调用次数: 1234,
    点云更新次数: 5,
    当前点数: 99,305,
    缓冲区大小: 7.58MB
  }
  性能统计: {
    渲染: {
      平均: "2.45ms",
      最小: "1.23ms",
      最大: "5.67ms",
      样本数: 100
    },
    更新: {
      平均: "45.23ms",
      最小: "12.34ms",
      最大: "89.12ms",
      样本数: 5
    }
  }
  内存信息: {
    used: "125.34MB",
    total: "256.00MB",
    percentage: "48.96%"
  }
```

## 性能优化建议

1. **监控渲染时间**：如果平均渲染时间超过 16ms（60fps），考虑优化：
   - 减少点数（下采样）
   - 减小点大小
   - 使用 LOD（细节层次）

2. **监控更新时间**：如果点云更新耗时过长：
   - 检查数据量
   - 优化数据转换逻辑
   - 考虑使用 Web Worker

3. **监控内存使用**：如果内存使用过高：
   - 检查是否有内存泄漏
   - 考虑释放不需要的缓冲区
   - 使用对象池复用缓冲区

## 注意事项

1. 调试工具仅在开发环境下可用（`import.meta.env.DEV`）
2. 启用详细调试可能会影响性能，建议仅在需要时启用
3. 性能统计会保留最近 100 次的数据
4. 内存信息需要浏览器支持 `performance.memory` API（Chrome/Edge）

## 在代码中使用

如果需要在代码中直接使用调试工具：

```typescript
import { renderDebug, enableRenderDebug } from './utils/renderDebug'

// 启用调试
enableRenderDebug('verbose')

// 或自定义配置
renderDebug.configure({
  enabled: true,
  logLevel: 'detailed',
  logRenderCalls: true,
  logPointCloudUpdates: true,
  logPerformance: true,
  logMemory: true
})
```
