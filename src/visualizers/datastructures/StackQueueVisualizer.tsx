/**
 * 栈/队列可视化组件
 * 支持: 栈(LIFO)、队列(FIFO)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

type DSMode = 'stack' | 'queue';

interface StackQueueConfig {
  mode?: DSMode;
  values?: number[];
  pushValue?: number;
  speed?: number;
}

interface DSStep {
  data: number[];
  highlightIndices: number[];
  highlightType: 'push' | 'pop' | 'peek';
  operation: string;
  description: string;
}

// ============================================
// 操作生成器
// ============================================

function* pushOperation(data: number[], value: number, mode: DSMode): Generator<DSStep> {
  yield {
    data: [...data],
    highlightIndices: [],
    highlightType: 'push',
    operation: 'push',
    description: `准备${mode === 'stack' ? '压入' : '入队'} ${value}`,
  };

  const newData = [...data, value];

  yield {
    data: newData,
    highlightIndices: [newData.length - 1],
    highlightType: 'push',
    operation: 'push',
    description: `${mode === 'stack' ? '压入' : '入队'} ${value}`,
  };

  return newData;
}

function* popOperation(data: number[], mode: DSMode): Generator<DSStep> {
  if (data.length === 0) {
    yield {
      data: [],
      highlightIndices: [],
      highlightType: 'pop',
      operation: 'pop',
      description: `${mode === 'stack' ? '栈' : '队列'}为空`,
    };
    return data;
  }

  const popIndex = mode === 'stack' ? data.length - 1 : 0;
  const popValue = data[popIndex];

  yield {
    data: [...data],
    highlightIndices: [popIndex],
    highlightType: 'pop',
    operation: 'pop',
    description: `准备${mode === 'stack' ? '弹出' : '出队'} ${popValue}`,
  };

  const newData = mode === 'stack' ? data.slice(0, -1) : data.slice(1);

  yield {
    data: newData,
    highlightIndices: [],
    highlightType: 'pop',
    operation: 'pop',
    description: `${mode === 'stack' ? '弹出' : '出队'} ${popValue}`,
  };

  return newData;
}

function* peekOperation(data: number[], mode: DSMode): Generator<DSStep> {
  if (data.length === 0) {
    yield {
      data: [],
      highlightIndices: [],
      highlightType: 'peek',
      operation: 'peek',
      description: `${mode === 'stack' ? '栈' : '队列'}为空`,
    };
    return;
  }

  const peekIndex = mode === 'stack' ? data.length - 1 : 0;

  yield {
    data: [...data],
    highlightIndices: [peekIndex],
    highlightType: 'peek',
    operation: 'peek',
    description: `查看${mode === 'stack' ? '栈顶' : '队头'}元素: ${data[peekIndex]}`,
  };
}

// ============================================
// 主组件
// ============================================

const StackQueueVisualizer: React.FC<VisualizerProps<StackQueueConfig>> = ({ args, onStateChange }) => {
  const {
    mode = 'stack',
    values = [10, 20, 30, 40, 50],
    pushValue,
    speed = 500,
  } = args || {};

  const [data, setData] = useState<number[]>([]);
  const [highlightIndices, setHighlightIndices] = useState<number[]>([]);
  const [highlightType, setHighlightType] = useState<'push' | 'pop' | 'peek'>('push');
  const [description, setDescription] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const stepsRef = useRef<DSStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDataRef = useRef<number[]>([]);

  // 初始化
  useEffect(() => {
    initialDataRef.current = [...values];
    setData([...values]);
    setHighlightIndices([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);
    onStateChange?.({ status: 'idle' });
  }, [values, mode, onStateChange]);

  // 压入/入队
  const handlePush = useCallback(() => {
    const value = pushValue ?? Math.floor(Math.random() * 100) + 1;
    const steps: DSStep[] = [];
    const gen = pushOperation([...data], value, mode);
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
  }, [data, mode, pushValue, onStateChange]);

  // 弹出/出队
  const handlePop = useCallback(() => {
    if (data.length === 0) return;
    const steps: DSStep[] = [];
    const gen = popOperation([...data], mode);
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
  }, [data, mode, onStateChange]);

  // 查看顶部/头部
  const handlePeek = useCallback(() => {
    if (data.length === 0) return;
    const steps: DSStep[] = [];
    const gen = peekOperation([...data], mode);
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
  }, [data, mode, onStateChange]);

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
      setData(stepData.data);
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
    setData([...initialDataRef.current]);
    setHighlightIndices([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);
    onStateChange?.({ status: 'idle' });
  }, [onStateChange]);

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

  // 获取元素颜色
  const getItemColor = (index: number) => {
    if (highlightIndices.includes(index)) {
      switch (highlightType) {
        case 'push': return '#22c55e';
        case 'pop': return '#ef4444';
        case 'peek': return '#3b82f6';
      }
    }
    return 'var(--bg-accent)';
  };

  const modeName = mode === 'stack' ? '栈' : '队列';
  const pushName = mode === 'stack' ? '压入 (Push)' : '入队 (Enqueue)';
  const popName = mode === 'stack' ? '弹出 (Pop)' : '出队 (Dequeue)';
  const peekName = mode === 'stack' ? '栈顶' : '队头';

  return (
    <div className="stack-queue-visualizer">
      {/* 控制栏 */}
      <div className="visualizer-controls">
        <button onClick={handlePush} disabled={isPlaying} className="control-btn">
          ➕ {pushName}
        </button>
        <button onClick={handlePop} disabled={isPlaying || data.length === 0} className="control-btn">
          ➖ {popName}
        </button>
        <button onClick={handlePeek} disabled={isPlaying || data.length === 0} className="control-btn">
          👁 查看{peekName}
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
      </div>

      {/* 可视化区域 */}
      <div className="ds-container">
        {/* 栈/队列主体 */}
        <div className={`ds-body ${mode}`}>
          {/* 方向指示 */}
          <div className="direction-indicators">
            {mode === 'stack' ? (
              <>
                <div className="indicator top">
                  <span>↑</span>
                  <span>栈顶 (Top)</span>
                </div>
                <div className="indicator bottom">
                  <span>栈底 (Bottom)</span>
                  <span>↓</span>
                </div>
              </>
            ) : (
              <>
                <div className="indicator left">
                  <span>← 出队</span>
                  <span>队头 (Front)</span>
                </div>
                <div className="indicator right">
                  <span>队尾 (Rear)</span>
                  <span>入队 →</span>
                </div>
              </>
            )}
          </div>

          {/* 元素容器 */}
          <div className={`elements-container ${mode}`}>
            {data.length === 0 ? (
              <div className="empty-state">
                {modeName}为空
              </div>
            ) : (
              data.map((value, idx) => (
                <div
                  key={idx}
                  className={`ds-element ${highlightIndices.includes(idx) ? 'highlighted' : ''} ${mode === 'queue' && idx === 0 ? 'front' : ''} ${mode === 'stack' && idx === data.length - 1 ? 'top' : ''}`}
                  style={{
                    backgroundColor: getItemColor(idx),
                    transform: highlightIndices.includes(idx) ? 'scale(1.05)' : 'scale(1)',
                  }}
                >
                  <span className="element-value">{value}</span>
                  {mode === 'stack' && idx === data.length - 1 && (
                    <span className="element-label">Top</span>
                  )}
                  {mode === 'queue' && idx === 0 && (
                    <span className="element-label">Front</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 操作说明 */}
        <div className="ds-info-panel">
          <div className="info-item">
            <span className="info-label">类型:</span>
            <span className="info-value">{modeName} ({mode === 'stack' ? 'LIFO' : 'FIFO'})</span>
          </div>
          <div className="info-item">
            <span className="info-label">大小:</span>
            <span className="info-value">{data.length}</span>
          </div>
          {data.length > 0 && (
            <div className="info-item">
              <span className="info-label">{mode === 'stack' ? '栈顶' : '队头'}:</span>
              <span className="info-value">{mode === 'stack' ? data[data.length - 1] : data[0]}</span>
            </div>
          )}
        </div>
      </div>

      {/* 描述 */}
      {description && (
        <div className="visualizer-description">{description}</div>
      )}

      {/* 复杂度信息 */}
      <div className="visualizer-info">
        <span>时间复杂度: Push/Pop O(1)</span>
        <span>空间复杂度: O(n)</span>
      </div>
    </div>
  );
};

export default StackQueueVisualizer;