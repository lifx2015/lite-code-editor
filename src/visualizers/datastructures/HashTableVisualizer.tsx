/**
 * 哈希表可视化组件
 * 支持: 链地址法、开放寻址法（线性探测、二次探测）
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

type CollisionMethod = 'chaining' | 'linear' | 'quadratic';

interface HashItem {
  key: string;
  value: number;
  highlight?: 'current' | 'comparing' | 'found' | 'collision';
}

interface Bucket {
  index: number;
  items: HashItem[];
  highlight?: 'current' | 'probing';
}

interface HashTableConfig {
  method?: CollisionMethod;
  size?: number;
  items?: { key: string; value: number }[];
  insertKey?: string;
  insertValue?: number;
  searchKey?: string;
  deleteKey?: string;
  speed?: number;
}

interface HashStep {
  buckets: Bucket[];
  currentKey: string | null;
  currentValue: number | null;
  hashValue: number | null;
  probeSequence: number[];
  description: string;
  operation: 'insert' | 'search' | 'delete';
  loadFactor: number;
}

// ============================================
// 哈希函数
// ============================================

function hashFunction(key: string, size: number): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % size;
}

// ============================================
// 哈希表操作生成器
// ============================================

function createEmptyBuckets(size: number): Bucket[] {
  return Array.from({ length: size }, (_, i) => ({
    index: i,
    items: [],
  }));
}

function cloneBuckets(buckets: Bucket[]): Bucket[] {
  return buckets.map(b => ({
    index: b.index,
    items: b.items.map(item => ({ ...item })),
    highlight: b.highlight,
  }));
}

function calculateLoadFactor(buckets: Bucket[]): number {
  const totalItems = buckets.reduce((sum, b) => sum + b.items.length, 0);
  return totalItems / buckets.length;
}

// 链地址法插入
function* insertChaining(
  buckets: Bucket[],
  key: string,
  value: number
): Generator<HashStep> {
  const size = buckets.length;
  const hash = hashFunction(key, size);

  yield {
    buckets: cloneBuckets(buckets),
    currentKey: key,
    currentValue: value,
    hashValue: hash,
    probeSequence: [hash],
    description: `计算哈希值: hash("${key}") = ${hash}`,
    operation: 'insert',
    loadFactor: calculateLoadFactor(buckets),
  };

  const bucket = buckets[hash];

  // 检查是否已存在
  for (let i = 0; i < bucket.items.length; i++) {
    bucket.items[i].highlight = 'comparing';
    yield {
      buckets: cloneBuckets(buckets),
      currentKey: key,
      currentValue: value,
      hashValue: hash,
      probeSequence: [hash],
      description: `检查位置 ${hash} 的第 ${i + 1} 个元素: ${bucket.items[i].key}`,
      operation: 'insert',
      loadFactor: calculateLoadFactor(buckets),
    };
    bucket.items[i].highlight = undefined;

    if (bucket.items[i].key === key) {
      bucket.items[i].value = value;
      bucket.items[i].highlight = 'found';
      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: value,
        hashValue: hash,
        probeSequence: [hash],
        description: `键 "${key}" 已存在，更新值为 ${value}`,
        operation: 'insert',
        loadFactor: calculateLoadFactor(buckets),
      };
      bucket.items[i].highlight = undefined;
      return;
    }
  }

  // 插入新元素
  bucket.items.push({ key, value, highlight: 'found' });
  bucket.highlight = 'current';

  yield {
    buckets: cloneBuckets(buckets),
    currentKey: key,
    currentValue: value,
    hashValue: hash,
    probeSequence: [hash],
    description: `插入键值对 ("${key}", ${value}) 到桶 ${hash}`,
    operation: 'insert',
    loadFactor: calculateLoadFactor(buckets),
  };

  bucket.items[bucket.items.length - 1].highlight = undefined;
  bucket.highlight = undefined;
}

// 开放寻址法插入（线性探测）
function* insertLinear(
  buckets: Bucket[],
  key: string,
  value: number
): Generator<HashStep> {
  const size = buckets.length;
  const hash = hashFunction(key, size);
  const probeSequence: number[] = [];

  yield {
    buckets: cloneBuckets(buckets),
    currentKey: key,
    currentValue: value,
    hashValue: hash,
    probeSequence: [],
    description: `计算哈希值: hash("${key}") = ${hash}`,
    operation: 'insert',
    loadFactor: calculateLoadFactor(buckets),
  };

  let index = hash;
  let probes = 0;

  while (probes < size) {
    probeSequence.push(index);
    const bucket = buckets[index];

    bucket.highlight = 'probing';
    yield {
      buckets: cloneBuckets(buckets),
      currentKey: key,
      currentValue: value,
      hashValue: hash,
      probeSequence: [...probeSequence],
      description: `探测位置 ${index}`,
      operation: 'insert',
      loadFactor: calculateLoadFactor(buckets),
    };

    if (bucket.items.length === 0) {
      // 空位，插入
      bucket.items.push({ key, value, highlight: 'found' });
      bucket.highlight = 'current';

      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: value,
        hashValue: hash,
        probeSequence: [...probeSequence],
        description: `在位置 ${index} 插入 ("${key}", ${value})`,
        operation: 'insert',
        loadFactor: calculateLoadFactor(buckets),
      };

      bucket.items[0].highlight = undefined;
      bucket.highlight = undefined;
      return;
    } else if (bucket.items[0].key === key) {
      // 已存在，更新
      bucket.items[0].highlight = 'found';
      bucket.items[0].value = value;

      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: value,
        hashValue: hash,
        probeSequence: [...probeSequence],
        description: `键 "${key}" 已存在，更新值为 ${value}`,
        operation: 'insert',
        loadFactor: calculateLoadFactor(buckets),
      };

      bucket.items[0].highlight = undefined;
      bucket.highlight = undefined;
      return;
    }

    // 冲突
    bucket.items[0].highlight = 'collision';
    yield {
      buckets: cloneBuckets(buckets),
      currentKey: key,
      currentValue: value,
      hashValue: hash,
      probeSequence: [...probeSequence],
      description: `位置 ${index} 冲突（已存在 "${bucket.items[0].key}"），继续探测`,
      operation: 'insert',
      loadFactor: calculateLoadFactor(buckets),
    };
    bucket.items[0].highlight = undefined;
    bucket.highlight = undefined;

    index = (index + 1) % size;
    probes++;
  }

  yield {
    buckets: cloneBuckets(buckets),
    currentKey: key,
    currentValue: value,
    hashValue: hash,
    probeSequence: probeSequence,
    description: `哈希表已满，无法插入`,
    operation: 'insert',
    loadFactor: calculateLoadFactor(buckets),
  };
}

// 开放寻址法插入（二次探测）
function* insertQuadratic(
  buckets: Bucket[],
  key: string,
  value: number
): Generator<HashStep> {
  const size = buckets.length;
  const hash = hashFunction(key, size);
  const probeSequence: number[] = [];

  yield {
    buckets: cloneBuckets(buckets),
    currentKey: key,
    currentValue: value,
    hashValue: hash,
    probeSequence: [],
    description: `计算哈希值: hash("${key}") = ${hash}`,
    operation: 'insert',
    loadFactor: calculateLoadFactor(buckets),
  };

  let probes = 0;
  const visited = new Set<number>();

  while (probes < size) {
    // 二次探测: (hash + i^2) % size
    const index = (hash + probes * probes) % size;

    if (visited.has(index)) {
      probes++;
      continue;
    }
    visited.add(index);

    probeSequence.push(index);
    const bucket = buckets[index];

    bucket.highlight = 'probing';
    yield {
      buckets: cloneBuckets(buckets),
      currentKey: key,
      currentValue: value,
      hashValue: hash,
      probeSequence: [...probeSequence],
      description: `探测位置 ${index} (i = ${probes}, i² = ${probes * probes})`,
      operation: 'insert',
      loadFactor: calculateLoadFactor(buckets),
    };

    if (bucket.items.length === 0) {
      bucket.items.push({ key, value, highlight: 'found' });
      bucket.highlight = 'current';

      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: value,
        hashValue: hash,
        probeSequence: [...probeSequence],
        description: `在位置 ${index} 插入 ("${key}", ${value})`,
        operation: 'insert',
        loadFactor: calculateLoadFactor(buckets),
      };

      bucket.items[0].highlight = undefined;
      bucket.highlight = undefined;
      return;
    } else if (bucket.items[0].key === key) {
      bucket.items[0].highlight = 'found';
      bucket.items[0].value = value;

      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: value,
        hashValue: hash,
        probeSequence: [...probeSequence],
        description: `键 "${key}" 已存在，更新值为 ${value}`,
        operation: 'insert',
        loadFactor: calculateLoadFactor(buckets),
      };

      bucket.items[0].highlight = undefined;
      bucket.highlight = undefined;
      return;
    }

    bucket.items[0].highlight = 'collision';
    yield {
      buckets: cloneBuckets(buckets),
      currentKey: key,
      currentValue: value,
      hashValue: hash,
      probeSequence: [...probeSequence],
      description: `位置 ${index} 冲突，继续探测`,
      operation: 'insert',
      loadFactor: calculateLoadFactor(buckets),
    };
    bucket.items[0].highlight = undefined;
    bucket.highlight = undefined;

    probes++;
  }

  yield {
    buckets: cloneBuckets(buckets),
    currentKey: key,
    currentValue: value,
    hashValue: hash,
    probeSequence: probeSequence,
    description: `哈希表已满或探测失败`,
    operation: 'insert',
    loadFactor: calculateLoadFactor(buckets),
  };
}

// 搜索
function* searchHash(
  buckets: Bucket[],
  key: string,
  method: CollisionMethod
): Generator<HashStep> {
  const size = buckets.length;
  const hash = hashFunction(key, size);
  const probeSequence: number[] = [];

  yield {
    buckets: cloneBuckets(buckets),
    currentKey: key,
    currentValue: null,
    hashValue: hash,
    probeSequence: [],
    description: `搜索键 "${key}"，哈希值 = ${hash}`,
    operation: 'search',
    loadFactor: calculateLoadFactor(buckets),
  };

  if (method === 'chaining') {
    const bucket = buckets[hash];

    for (let i = 0; i < bucket.items.length; i++) {
      bucket.items[i].highlight = 'comparing';
      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: null,
        hashValue: hash,
        probeSequence: [hash],
        description: `检查桶 ${hash} 的第 ${i + 1} 个元素: ${bucket.items[i].key}`,
        operation: 'search',
        loadFactor: calculateLoadFactor(buckets),
      };

      if (bucket.items[i].key === key) {
        bucket.items[i].highlight = 'found';
        yield {
          buckets: cloneBuckets(buckets),
          currentKey: key,
          currentValue: bucket.items[i].value,
          hashValue: hash,
          probeSequence: [hash],
          description: `找到键 "${key}"，值 = ${bucket.items[i].value}`,
          operation: 'search',
          loadFactor: calculateLoadFactor(buckets),
        };
        bucket.items[i].highlight = undefined;
        return;
      }
      bucket.items[i].highlight = undefined;
    }

    yield {
      buckets: cloneBuckets(buckets),
      currentKey: key,
      currentValue: null,
      hashValue: hash,
      probeSequence: [hash],
      description: `未找到键 "${key}"`,
      operation: 'search',
      loadFactor: calculateLoadFactor(buckets),
    };
  } else {
    // 开放寻址法
    let index = hash;
    let probes = 0;
    const visited = new Set<number>();

    while (probes < size) {
      if (method === 'linear') {
        index = (hash + probes) % size;
      } else {
        index = (hash + probes * probes) % size;
      }

      if (visited.has(index)) {
        probes++;
        continue;
      }
      visited.add(index);

      probeSequence.push(index);
      const bucket = buckets[index];

      bucket.highlight = 'probing';
      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: null,
        hashValue: hash,
        probeSequence: [...probeSequence],
        description: `探测位置 ${index}`,
        operation: 'search',
        loadFactor: calculateLoadFactor(buckets),
      };

      if (bucket.items.length === 0) {
        yield {
          buckets: cloneBuckets(buckets),
          currentKey: key,
          currentValue: null,
          hashValue: hash,
          probeSequence: [...probeSequence],
          description: `位置 ${index} 为空，未找到键 "${key}"`,
          operation: 'search',
          loadFactor: calculateLoadFactor(buckets),
        };
        bucket.highlight = undefined;
        return;
      }

      bucket.items[0].highlight = 'comparing';
      yield {
        buckets: cloneBuckets(buckets),
        currentKey: key,
        currentValue: null,
        hashValue: hash,
        probeSequence: [...probeSequence],
        description: `比较位置 ${index} 的键: ${bucket.items[0].key}`,
        operation: 'search',
        loadFactor: calculateLoadFactor(buckets),
      };

      if (bucket.items[0].key === key) {
        bucket.items[0].highlight = 'found';
        yield {
          buckets: cloneBuckets(buckets),
          currentKey: key,
          currentValue: bucket.items[0].value,
          hashValue: hash,
          probeSequence: [...probeSequence],
          description: `找到键 "${key}"，值 = ${bucket.items[0].value}`,
          operation: 'search',
          loadFactor: calculateLoadFactor(buckets),
        };
        bucket.items[0].highlight = undefined;
        bucket.highlight = undefined;
        return;
      }

      bucket.items[0].highlight = undefined;
      bucket.highlight = undefined;
      probes++;
    }

    yield {
      buckets: cloneBuckets(buckets),
      currentKey: key,
      currentValue: null,
      hashValue: hash,
      probeSequence: probeSequence,
      description: `未找到键 "${key}"`,
      operation: 'search',
      loadFactor: calculateLoadFactor(buckets),
    };
  }
}

// ============================================
// 主组件
// ============================================

const HashTableVisualizer: React.FC<VisualizerProps<HashTableConfig>> = ({ args, onStateChange }) => {
  const {
    method = 'chaining',
    size = 8,
    items = [
      { key: 'apple', value: 5 },
      { key: 'banana', value: 8 },
      { key: 'cherry', value: 3 },
      { key: 'date', value: 7 },
    ],
    insertKey,
    insertValue,
    searchKey,
    speed = 600,
  } = args || {};

  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [hashValue, setHashValue] = useState<number | null>(null);
  const [probeSequence, setProbeSequence] = useState<number[]>([]);
  const [description, setDescription] = useState<string>('');
  const [loadFactor, setLoadFactor] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const stepsRef = useRef<HashStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 初始化哈希表
  useEffect(() => {
    const newBuckets = createEmptyBuckets(size);
    // 预填充数据
    for (const item of items) {
      const hash = hashFunction(item.key, size);
      if (method === 'chaining') {
        newBuckets[hash].items.push({ key: item.key, value: item.value });
      } else {
        // 开放寻址法：简单线性探测
        let idx = hash;
        while (newBuckets[idx].items.length > 0) {
          idx = (idx + 1) % size;
        }
        newBuckets[idx].items.push({ key: item.key, value: item.value });
      }
    }
    setBuckets(newBuckets);
    setLoadFactor(calculateLoadFactor(newBuckets));
    setCurrentKey(null);
    setHashValue(null);
    setProbeSequence([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);
    onStateChange?.({ status: 'idle' });
  }, [size, method, items, onStateChange]);

  // 生成步骤
  const generateSteps = useCallback((operation: 'insert' | 'search', key?: string, value?: number) => {
    const steps: HashStep[] = [];
    let generator: Generator<HashStep>;

    const bucketsCopy = cloneBuckets(buckets);
    const actualKey = key || insertKey || `key${Math.floor(Math.random() * 100)}`;
    const actualValue = value ?? insertValue ?? Math.floor(Math.random() * 100);

    switch (operation) {
      case 'insert':
        if (method === 'chaining') {
          generator = insertChaining(bucketsCopy, actualKey, actualValue);
        } else if (method === 'linear') {
          generator = insertLinear(bucketsCopy, actualKey, actualValue);
        } else {
          generator = insertQuadratic(bucketsCopy, actualKey, actualValue);
        }
        break;
      case 'search':
        generator = searchHash(bucketsCopy, actualKey, method);
        break;
      default:
        return;
    }

    let result = generator.next();
    while (!result.done) {
      steps.push(result.value);
      result = generator.next();
    }

    return steps;
  }, [buckets, method, insertKey, insertValue, searchKey]);

  // 操作处理
  const handleInsert = useCallback(() => {
    const steps = generateSteps('insert');
    if (steps) {
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [generateSteps]);

  const handleSearch = useCallback(() => {
    const key = searchKey || items[Math.floor(Math.random() * items.length)]?.key || 'apple';
    const steps = generateSteps('search', key);
    if (steps) {
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [generateSteps, searchKey, items]);

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
      setBuckets(cloneBuckets(stepData.buckets));
      setCurrentKey(stepData.currentKey);
      setHashValue(stepData.hashValue);
      setProbeSequence(stepData.probeSequence);
      setDescription(stepData.description);
      setLoadFactor(stepData.loadFactor);
      setCurrentStep(currentStep + 1);

      if (currentStep + 1 >= totalSteps) {
        setIsPlaying(false);
        onStateChange?.({ status: 'completed' });
      }
    }
  }, [currentStep, totalSteps, onStateChange]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    // 重新初始化
    const newBuckets = createEmptyBuckets(size);
    for (const item of items) {
      const hash = hashFunction(item.key, size);
      if (method === 'chaining') {
        newBuckets[hash].items.push({ key: item.key, value: item.value });
      } else {
        let idx = hash;
        while (newBuckets[idx].items.length > 0) {
          idx = (idx + 1) % size;
        }
        newBuckets[idx].items.push({ key: item.key, value: item.value });
      }
    }
    setBuckets(newBuckets);
    setCurrentKey(null);
    setHashValue(null);
    setProbeSequence([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);
    onStateChange?.({ status: 'idle' });
  }, [size, method, items, onStateChange]);

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

  const methodNames: Record<CollisionMethod, string> = {
    chaining: '链地址法',
    linear: '线性探测',
    quadratic: '二次探测',
  };

  const getBucketColor = (bucket: Bucket) => {
    if (bucket.highlight === 'current') return '#22c55e';
    if (bucket.highlight === 'probing') return '#eab308';
    return 'var(--bg-tertiary)';
  };

  const getItemColor = (item: HashItem) => {
    if (item.highlight === 'found') return '#22c55e';
    if (item.highlight === 'comparing') return '#3b82f6';
    if (item.highlight === 'collision') return '#ef4444';
    if (item.highlight === 'current') return '#22c55e';
    return 'var(--bg-accent)';
  };

  return (
    <div className="hashtable-visualizer">
      {/* 控制栏 */}
      <div className="visualizer-controls">
        <button onClick={handleInsert} disabled={isPlaying} className="control-btn">
          ➕ 插入
        </button>
        <button onClick={handleSearch} disabled={isPlaying} className="control-btn">
          🔍 搜索
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

      {/* 信息栏 */}
      <div className="hashtable-info-bar">
        {currentKey && <span>当前键: <strong>{currentKey}</strong></span>}
        {hashValue !== null && <span>哈希值: <strong>{hashValue}</strong></span>}
        {probeSequence.length > 0 && <span>探测序列: [{probeSequence.join(', ')}]</span>}
        <span>负载因子: <strong>{loadFactor.toFixed(2)}</strong></span>
      </div>

      {/* 哈希表可视化 */}
      <div className="hashtable-container">
        <div className="hashtable-grid">
          {buckets.map((bucket, idx) => (
            <div
              key={idx}
              className={`hashtable-bucket ${bucket.items.length > 0 ? 'occupied' : ''} ${bucket.highlight ? 'highlighted' : ''}`}
              style={{ backgroundColor: getBucketColor(bucket) }}
            >
              <div className="bucket-index">{idx}</div>
              <div className="bucket-items">
                {bucket.items.length === 0 ? (
                  <div className="bucket-empty">空</div>
                ) : (
                  bucket.items.map((item, itemIdx) => (
                    <div
                      key={itemIdx}
                      className="bucket-item"
                      style={{ backgroundColor: getItemColor(item) }}
                    >
                      <span className="item-key">{item.key}</span>
                      <span className="item-value">: {item.value}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 描述 */}
      {description && (
        <div className="visualizer-description">{description}</div>
      )}

      {/* 方法信息 */}
      <div className="visualizer-info">
        <span>方法: {methodNames[method]}</span>
        <span>容量: {size}</span>
        <span>元素数: {buckets.reduce((sum, b) => sum + b.items.length, 0)}</span>
      </div>
    </div>
  );
};

export default HashTableVisualizer;