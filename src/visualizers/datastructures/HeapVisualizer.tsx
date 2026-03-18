/**
 * 堆可视化组件
 * 支持: 最大堆、最小堆
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

type HeapType = 'max' | 'min';

interface HeapConfig {
  type?: HeapType;
  values?: number[];
  insertValue?: number;
  speed?: number;
}

interface HeapStep {
  heap: number[];
  highlightIndices: number[];
  highlightType: 'comparing' | 'swapping' | 'inserted' | 'removed';
  description: string;
}

// ============================================
// 堆操作算法 (生成器版本)
// ============================================

function compare(a: number, b: number, heapType: HeapType): boolean {
  return heapType === 'max' ? a > b : a < b;
}

function* heapifyUp(heap: number[], index: number, heapType: HeapType): Generator<HeapStep> {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);

    yield {
      heap: [...heap],
      highlightIndices: [index, parent],
      highlightType: 'comparing',
      description: `比较节点 ${index} (${heap[index]}) 与父节点 ${parent} (${heap[parent]})`,
    };

    if (compare(heap[index], heap[parent], heapType)) {
      yield {
        heap: [...heap],
        highlightIndices: [index, parent],
        highlightType: 'swapping',
        description: `交换 ${heap[index]} 和 ${heap[parent]}`,
      };
      [heap[index], heap[parent]] = [heap[parent], heap[index]];
      index = parent;
    } else {
      break;
    }
  }
}

function* heapifyDown(heap: number[], index: number, heapType: HeapType): Generator<HeapStep> {
  const n = heap.length;

  while (true) {
    let target = index;
    const left = 2 * index + 1;
    const right = 2 * index + 2;

    if (left < n && compare(heap[left], heap[target], heapType)) {
      target = left;
    }

    if (right < n && compare(heap[right], heap[target], heapType)) {
      target = right;
    }

    if (target !== index) {
      yield {
        heap: [...heap],
        highlightIndices: [index, target],
        highlightType: 'comparing',
        description: `比较并选择子节点 ${target}`,
      };

      yield {
        heap: [...heap],
        highlightIndices: [index, target],
        highlightType: 'swapping',
        description: `交换 ${heap[index]} 和 ${heap[target]}`,
      };

      [heap[index], heap[target]] = [heap[target], heap[index]];
      index = target;
    } else {
      break;
    }
  }
}

function* insertHeap(heap: number[], value: number, heapType: HeapType): Generator<HeapStep> {
  yield {
    heap: [...heap],
    highlightIndices: [],
    highlightType: 'inserted',
    description: `准备插入 ${value}`,
  };

  heap.push(value);
  const insertIndex = heap.length - 1;

  yield {
    heap: [...heap],
    highlightIndices: [insertIndex],
    highlightType: 'inserted',
    description: `添加 ${value} 到末尾`,
  };

  yield* heapifyUp(heap, insertIndex, heapType);

  yield {
    heap: [...heap],
    highlightIndices: [],
    highlightType: 'inserted',
    description: `插入 ${value} 完成`,
  };

  return heap;
}

function* extractTop(heap: number[], heapType: HeapType): Generator<HeapStep> {
  if (heap.length === 0) {
    yield { heap: [], highlightIndices: [], highlightType: 'removed', description: '堆为空' };
    return heap;
  }

  const top = heap[0];
  yield {
    heap: [...heap],
    highlightIndices: [0],
    highlightType: 'removed',
    description: `准备移除堆顶元素 ${top}`,
  };

  const last = heap.pop()!;

  if (heap.length > 0) {
    heap[0] = last;
    yield {
      heap: [...heap],
      highlightIndices: [0],
      highlightType: 'swapping',
      description: `将末尾元素 ${last} 移到堆顶`,
    };

    yield* heapifyDown(heap, 0, heapType);
  }

  yield {
    heap: [...heap],
    highlightIndices: [],
    highlightType: 'removed',
    description: `移除 ${top} 完成`,
  };

  return heap;
}

function* buildHeap(values: number[], heapType: HeapType): Generator<HeapStep> {
  const heap = [...values];
  const n = heap.length;

  yield {
    heap: [...heap],
    highlightIndices: [],
    highlightType: 'comparing',
    description: '开始构建堆',
  };

  // 从最后一个非叶子节点开始
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
    yield {
      heap: [...heap],
      highlightIndices: [i],
      highlightType: 'comparing',
      description: `对节点 ${i} 进行堆化`,
    };

    yield* heapifyDown(heap, i, heapType);
  }

  yield {
    heap: [...heap],
    highlightIndices: [],
    highlightType: 'inserted',
    description: '堆构建完成',
  };

  return heap;
}

// ============================================
// 树布局计算
// ============================================

interface TreeNode {
  value: number;
  index: number;
  x: number;
  y: number;
}

function calculateHeapLayout(heap: number[], width: number = 800, _height: number = 350): TreeNode[] {
  if (heap.length === 0) return [];

  const nodes: TreeNode[] = [];
  const startY = 40;
  const levelHeight = 70;

  for (let i = 0; i < heap.length; i++) {
    const level = Math.floor(Math.log2(i + 1));
    const levelStart = Math.pow(2, level) - 1;
    const posInLevel = i - levelStart;
    const nodesInLevel = Math.pow(2, level);

    const x = width / 2 + (posInLevel - (nodesInLevel - 1) / 2) * (width / nodesInLevel);
    const y = startY + level * levelHeight;

    nodes.push({ value: heap[i], index: i, x, y });
  }

  return nodes;
}

// ============================================
// 主组件
// ============================================

const HeapVisualizer: React.FC<VisualizerProps<HeapConfig>> = ({ args, onStateChange }) => {
  const {
    type = 'max',
    values = [50, 30, 70, 20, 40, 60, 80, 10, 25],
    insertValue,
    speed = 600,
  } = args || {};

  const [heap, setHeap] = useState<number[]>([]);
  const [highlightIndices, setHighlightIndices] = useState<number[]>([]);
  const [highlightType, setHighlightType] = useState<'comparing' | 'swapping' | 'inserted' | 'removed'>('comparing');
  const [description, setDescription] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const stepsRef = useRef<HeapStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialHeapRef = useRef<number[]>([]);

  // 初始化堆
  useEffect(() => {
    initialHeapRef.current = [...values];
    setHeap([]);
    setHighlightIndices([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);

    // 生成构建堆的步骤
    const steps: HeapStep[] = [];
    const gen = buildHeap([...values], type);
    let result = gen.next();
    while (!result.done) {
      steps.push(result.value);
      result = gen.next();
    }

    stepsRef.current = steps;
    setTotalSteps(steps.length);
    setIsPlaying(true);
    onStateChange?.({ status: 'playing' });
  }, [values, type, onStateChange]);

  // 插入操作
  const handleInsert = useCallback(() => {
    const value = insertValue ?? Math.floor(Math.random() * 100) + 1;
    const steps: HeapStep[] = [];
    const gen = insertHeap([...heap], value, type);
    let result = gen.next();
    while (!result.done) {
      steps.push(result.value);
      result = gen.next();
    }
    stepsRef.current = steps;
    setTotalSteps(steps.length);
    setCurrentStep(0);
    setIsPlaying(true);
    onStateChange?.({ status: 'playing' });
  }, [heap, type, insertValue, onStateChange]);

  // 删除堆顶
  const handleExtract = useCallback(() => {
    if (heap.length === 0) return;
    const steps: HeapStep[] = [];
    const gen = extractTop([...heap], type);
    let result = gen.next();
    while (!result.done) {
      steps.push(result.value);
      result = gen.next();
    }
    stepsRef.current = steps;
    setTotalSteps(steps.length);
    setCurrentStep(0);
    setIsPlaying(true);
    onStateChange?.({ status: 'playing' });
  }, [heap, type, onStateChange]);

  // 播放控制
  const play = useCallback(() => {
    if (currentStep < totalSteps) {
      setIsPlaying(true);
    }
  }, [currentStep, totalSteps]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      clearTimeout(animationRef.current);
    }
  }, []);

  const step = useCallback(() => {
    if (currentStep < totalSteps) {
      const stepData = stepsRef.current[currentStep];
      setHeap(stepData.heap);
      setHighlightIndices(stepData.highlightIndices);
      setHighlightType(stepData.highlightType);
      setDescription(stepData.description);
      setCurrentStep(currentStep + 1);

      if (currentStep + 1 >= totalSteps) {
        setIsPlaying(false);
        onStateChange?.({ status: 'completed', currentStep: currentStep + 1, totalSteps });
      }
    }
  }, [currentStep, totalSteps, onStateChange]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setHeap([...initialHeapRef.current]);
    setHighlightIndices([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);
    onStateChange?.({ status: 'idle' });

    // 重新构建堆
    const steps: HeapStep[] = [];
    const gen = buildHeap([...initialHeapRef.current], type);
    let result = gen.next();
    while (!result.done) {
      steps.push(result.value);
      result = gen.next();
    }
    stepsRef.current = steps;
    setTotalSteps(steps.length);
  }, [type, onStateChange]);

  // 动画循环
  useEffect(() => {
    if (isPlaying && currentStep < totalSteps) {
      animationRef.current = setTimeout(() => {
        step();
      }, speed);
    }

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, [isPlaying, currentStep, totalSteps, speed, step]);

  // 计算布局
  const nodes = useMemo(() => calculateHeapLayout(heap), [heap]);

  // 获取节点颜色
  const getNodeColor = (index: number) => {
    if (highlightIndices.includes(index)) {
      switch (highlightType) {
        case 'inserted': return '#22c55e';
        case 'removed': return '#ef4444';
        case 'swapping': return '#a855f7';
        default: return '#eab308';
      }
    }
    return 'var(--bg-accent)';
  };

  // 计算边
  const edges = useMemo(() => {
    const result: { from: TreeNode; to: TreeNode }[] = [];
    for (let i = 0; i < heap.length; i++) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      const fromNode = nodes.find(n => n.index === i);
      if (fromNode) {
        const leftNode = nodes.find(n => n.index === left);
        if (leftNode) result.push({ from: fromNode, to: leftNode });
        const rightNode = nodes.find(n => n.index === right);
        if (rightNode) result.push({ from: fromNode, to: rightNode });
      }
    }
    return result;
  }, [nodes, heap.length]);

  return (
    <div className="heap-visualizer">
      {/* 控制栏 */}
      <div className="visualizer-controls">
        <button onClick={handleInsert} disabled={isPlaying} className="control-btn">
          ➕ 插入
        </button>
        <button onClick={handleExtract} disabled={isPlaying || heap.length === 0} className="control-btn">
          ➖ 移除堆顶
        </button>
        <button onClick={isPlaying ? pause : play} disabled={totalSteps === 0} className="control-btn">
          {isPlaying ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={step} disabled={isPlaying || currentStep >= totalSteps} className="control-btn">
          ⏭ 单步
        </button>
        <button onClick={reset} className="control-btn">
          ↺ 重置
        </button>
        <span className="step-info">
          步骤: {currentStep} / {totalSteps}
        </span>
      </div>

      {/* 可视化区域 */}
      <div className="visualizer-container heap-container">
        <svg width="100%" height="350" viewBox="0 0 800 350">
          {/* 边 */}
          {edges.map((edge, idx) => (
            <line
              key={`edge-${idx}`}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
              stroke="var(--border-color)"
              strokeWidth="2"
            />
          ))}

          {/* 节点 */}
          {nodes.map((node) => (
            <g key={`node-${node.index}`}>
              <circle
                cx={node.x}
                cy={node.y}
                r="24"
                fill={getNodeColor(node.index)}
                stroke={highlightIndices.includes(node.index) ? 'var(--text-primary)' : 'var(--border-color)'}
                strokeWidth={highlightIndices.includes(node.index) ? 3 : 1}
                className="heap-node"
              />
              <text
                x={node.x}
                y={node.y + 5}
                textAnchor="middle"
                fill="var(--text-primary)"
                fontSize="14"
                fontWeight="bold"
              >
                {node.value}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* 数组视图 */}
      <div className="heap-array-view">
        <span className="array-label">数组表示:</span>
        <div className="array-container">
          {heap.map((value, idx) => (
            <div
              key={idx}
              className={`array-item ${highlightIndices.includes(idx) ? 'highlighted' : ''}`}
              style={{
                backgroundColor: highlightIndices.includes(idx) ? getNodeColor(idx) : 'var(--bg-secondary)',
              }}
            >
              <span className="array-index">{idx}</span>
              <span className="array-value">{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 描述 */}
      {description && (
        <div className="visualizer-description">{description}</div>
      )}

      {/* 堆信息 */}
      <div className="visualizer-info">
        <span>类型: {type === 'max' ? '最大堆' : '最小堆'}</span>
        <span>大小: {heap.length}</span>
        {heap.length > 0 && (
          <span>堆顶: {heap[0]}</span>
        )}
      </div>
    </div>
  );
};

export default HeapVisualizer;