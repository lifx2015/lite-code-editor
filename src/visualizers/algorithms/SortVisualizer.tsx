/**
 * 排序算法可视化组件
 * 支持: 冒泡排序、快速排序、归并排序、插入排序、选择排序
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

interface SortConfig {
  array: number[];
  algorithm: 'bubble' | 'quick' | 'merge' | 'insertion' | 'selection';
  speed: number;
  showSteps: boolean;
}

interface SortStep {
  array: number[];
  comparing?: [number, number];
  swapping?: [number, number];
  sorted?: number[];
  description?: string;
}

type SortAlgorithm = (arr: number[]) => Generator<SortStep>;

// ============================================
// 排序算法实现 (生成器版本)
// ============================================

function* bubbleSort(arr: number[]): Generator<SortStep> {
  const a = [...arr];
  const n = a.length;
  const sorted: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - i - 1; j++) {
      yield { array: [...a], comparing: [j, j + 1], sorted: [...sorted] };

      if (a[j] > a[j + 1]) {
        yield { array: [...a], swapping: [j, j + 1], sorted: [...sorted], description: `交换 ${a[j]} 和 ${a[j + 1]}` };
        [a[j], a[j + 1]] = [a[j + 1], a[j]];
      }
    }
    sorted.unshift(n - i - 1);
  }
  sorted.unshift(0);
  yield { array: [...a], sorted, description: '排序完成' };
}

function* quickSort(arr: number[]): Generator<SortStep> {
  const a = [...arr];

  function partition(low: number, high: number): number {
    const pivot = a[high];
    let i = low - 1;

    for (let j = low; j < high; j++) {
      // 不在这里 yield，由外部处理
      if (a[j] < pivot) {
        i++;
        [a[i], a[j]] = [a[j], a[i]];
      }
    }
    [a[i + 1], a[high]] = [a[high], a[i + 1]];
    return i + 1;
  }

  function* sort(low: number, high: number): Generator<SortStep> {
    if (low < high) {
      // 显示当前状态
      yield { array: [...a], comparing: [low, high], description: `分区 [${low}, ${high}]` };
      const pi = partition(low, high);
      yield { array: [...a], sorted: [pi], description: `基准点 ${a[pi]} 就位` };
      yield* sort(low, pi - 1);
      yield* sort(pi + 1, high);
    } else if (low === high) {
      yield { array: [...a], sorted: [low], description: `元素 ${a[low]} 已就位` };
    }
  }

  yield* sort(0, a.length - 1);
  yield { array: [...a], sorted: a.map((_, i) => i), description: '排序完成' };
}

function* insertionSort(arr: number[]): Generator<SortStep> {
  const a = [...arr];
  const sorted = [0];

  for (let i = 1; i < a.length; i++) {
    const key = a[i];
    let j = i - 1;

    yield { array: [...a], comparing: [i, i], sorted: [...sorted], description: `选择元素 ${key}` };

    while (j >= 0 && a[j] > key) {
      yield { array: [...a], comparing: [j, j + 1], sorted: [...sorted] };
      a[j + 1] = a[j];
      yield { array: [...a], swapping: [j, j + 1], sorted: [...sorted], description: `移动 ${a[j]}` };
      j--;
    }
    a[j + 1] = key;
    sorted.push(i);
    sorted.sort((x, y) => x - y);
  }

  yield { array: [...a], sorted: a.map((_, i) => i), description: '排序完成' };
}

function* selectionSort(arr: number[]): Generator<SortStep> {
  const a = [...arr];
  const sorted: number[] = [];

  for (let i = 0; i < a.length; i++) {
    let minIdx = i;

    for (let j = i + 1; j < a.length; j++) {
      yield { array: [...a], comparing: [minIdx, j], sorted: [...sorted] };
      if (a[j] < a[minIdx]) {
        minIdx = j;
      }
    }

    if (minIdx !== i) {
      yield { array: [...a], swapping: [i, minIdx], sorted: [...sorted], description: `交换 ${a[i]} 和 ${a[minIdx]}` };
      [a[i], a[minIdx]] = [a[minIdx], a[i]];
    }
    sorted.push(i);
  }

  yield { array: [...a], sorted, description: '排序完成' };
}

function* mergeSort(arr: number[]): Generator<SortStep> {
  const a = [...arr];

  function* merge(l: number, m: number, r: number): Generator<SortStep> {
    const left = a.slice(l, m + 1);
    const right = a.slice(m + 1, r + 1);
    let i = 0, j = 0, k = l;

    while (i < left.length && j < right.length) {
      yield { array: [...a], comparing: [l + i, m + 1 + j], description: `比较 ${left[i]} 和 ${right[j]}` };
      if (left[i] <= right[j]) {
        a[k] = left[i];
        i++;
      } else {
        a[k] = right[j];
        j++;
      }
      yield { array: [...a], swapping: [k, k], description: '归并元素' };
      k++;
    }

    while (i < left.length) {
      a[k] = left[i];
      yield { array: [...a], swapping: [k, k] };
      i++; k++;
    }

    while (j < right.length) {
      a[k] = right[j];
      yield { array: [...a], swapping: [k, k] };
      j++; k++;
    }
  }

  function* sort(l: number, r: number): Generator<SortStep> {
    if (l < r) {
      const m = Math.floor((l + r) / 2);
      yield* sort(l, m);
      yield* sort(m + 1, r);
      yield* merge(l, m, r);
    }
  }

  yield* sort(0, a.length - 1);
  yield { array: [...a], sorted: a.map((_, i) => i), description: '排序完成' };
}

// ============================================
// 主组件
// ============================================

const SortVisualizer: React.FC<VisualizerProps<SortConfig>> = ({ args, onStateChange }) => {
  const {
    array = [5, 2, 8, 1, 9, 3, 7, 4, 6],
    algorithm = 'bubble',
    speed = 300,
    showSteps = true,
  } = args || {};

  const [currentArray, setCurrentArray] = useState<number[]>(array);
  const [comparing, setComparing] = useState<[number, number] | null>(null);
  const [swapping, setSwapping] = useState<[number, number] | null>(null);
  const [sorted, setSorted] = useState<number[]>([]);
  const [description, setDescription] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const generatorRef = useRef<Generator<SortStep> | null>(null);
  const stepsRef = useRef<SortStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 获取排序算法
  const getAlgorithm = useCallback((name: string): SortAlgorithm => {
    switch (name) {
      case 'bubble': return bubbleSort;
      case 'quick': return quickSort;
      case 'merge': return mergeSort;
      case 'insertion': return insertionSort;
      case 'selection': return selectionSort;
      default: return bubbleSort;
    }
  }, []);

  // 初始化生成器
  useEffect(() => {
    const sortFn = getAlgorithm(algorithm);
    const gen = sortFn(array);
    generatorRef.current = gen;

    // 预计算所有步骤
    const steps: SortStep[] = [];
    let result = gen.next();
    while (!result.done) {
      steps.push(result.value);
      result = gen.next();
    }
    stepsRef.current = steps;
    setTotalSteps(steps.length);

    // 重置状态
    setCurrentArray(array);
    setComparing(null);
    setSwapping(null);
    setSorted([]);
    setDescription('');
    setCurrentStep(0);
    setIsPlaying(false);

    onStateChange?.({ status: 'idle', totalSteps: steps.length });
  }, [array, algorithm, getAlgorithm, onStateChange]);

  // 播放动画
  const play = useCallback(() => {
    if (currentStep >= totalSteps) {
      // 重新开始
      setCurrentStep(0);
      setComparing(null);
      setSwapping(null);
      setSorted([]);
      setCurrentArray(array);
    }
    setIsPlaying(true);
    onStateChange?.({ status: 'playing', currentStep, totalSteps });
  }, [currentStep, totalSteps, array, onStateChange]);

  // 暂停动画
  const pause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      clearTimeout(animationRef.current);
    }
    onStateChange?.({ status: 'paused', currentStep, totalSteps });
  }, [currentStep, totalSteps, onStateChange]);

  // 步进
  const step = useCallback(() => {
    if (currentStep < totalSteps) {
      const stepData = stepsRef.current[currentStep];
      setCurrentArray(stepData.array);
      setComparing(stepData.comparing || null);
      setSwapping(stepData.swapping || null);
      setSorted(stepData.sorted || []);
      setDescription(stepData.description || '');
      setCurrentStep(currentStep + 1);

      if (currentStep + 1 >= totalSteps) {
        onStateChange?.({ status: 'completed', currentStep: currentStep + 1, totalSteps });
      } else {
        onStateChange?.({ status: 'paused', currentStep: currentStep + 1, totalSteps });
      }
    }
  }, [currentStep, totalSteps, onStateChange]);

  // 动画循环
  useEffect(() => {
    if (isPlaying && currentStep < totalSteps) {
      animationRef.current = setTimeout(() => {
        step();
        if (currentStep + 1 >= totalSteps) {
          setIsPlaying(false);
          onStateChange?.({ status: 'completed', currentStep: currentStep + 1, totalSteps });
        }
      }, speed);
    }

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, [isPlaying, currentStep, totalSteps, speed, step, onStateChange]);

  // 重置
  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentStep(0);
    setCurrentArray(array);
    setComparing(null);
    setSwapping(null);
    setSorted([]);
    setDescription('');
    onStateChange?.({ status: 'idle', currentStep: 0, totalSteps });
  }, [array, totalSteps, onStateChange]);

  // 计算最大值用于缩放
  const maxValue = Math.max(...currentArray, 1);

  return (
    <div className="sort-visualizer">
      {/* 控制栏 */}
      <div className="visualizer-controls">
        <button onClick={isPlaying ? pause : play} className="control-btn">
          {isPlaying ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={step} disabled={isPlaying} className="control-btn">
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
      <div className="visualizer-container">
        {currentArray.map((value, idx) => {
          const height = (value / maxValue) * 100;
          const isComparing = comparing?.includes(idx);
          const isSwapping = swapping?.includes(idx);
          const isSorted = sorted.includes(idx);

          return (
            <div
              key={idx}
              className={`bar ${isComparing ? 'comparing' : ''} ${isSwapping ? 'swapping' : ''} ${isSorted ? 'sorted' : ''}`}
              style={{ height: `${height}%` }}
            >
              <span className="bar-value">{value}</span>
            </div>
          );
        })}
      </div>

      {/* 描述 */}
      {showSteps && description && (
        <div className="visualizer-description">{description}</div>
      )}

      {/* 算法信息 */}
      <div className="visualizer-info">
        <span>算法: {algorithm}</span>
        <span>数组: [{array.join(', ')}]</span>
      </div>
    </div>
  );
};

export default SortVisualizer;