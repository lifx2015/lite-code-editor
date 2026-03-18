/**
 * 链表可视化组件
 * 支持: 单链表、双链表、环形链表
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

type ListType = 'singly' | 'doubly' | 'circular';

interface ListNode {
  id: string;
  value: number;
  next: string | null;
  prev?: string | null;  // 双链表用
  highlight?: 'current' | 'comparing' | 'found' | 'none';
}

interface LinkedListConfig {
  type?: ListType;
  values?: number[];
  insertValue?: number;
  deleteValue?: number;
  searchValue?: number;
  speed?: number;
}

interface ListStep {
  nodes: Map<string, ListNode>;
  headId: string | null;
  tailId: string | null;
  currentId: string | null;
  highlightIds: string[];
  highlightType: 'current' | 'comparing' | 'found';
  description: string;
  operation: 'insert' | 'delete' | 'search' | 'traverse';
}

// ============================================
// 链表操作生成器
// ============================================

let nodeIdCounter = 0;
function generateNodeId(): string {
  return `node_${nodeIdCounter++}`;
}

function cloneNodes(nodes: Map<string, ListNode>): Map<string, ListNode> {
  const cloned = new Map<string, ListNode>();
  nodes.forEach((node, id) => {
    cloned.set(id, { ...node });
  });
  return cloned;
}

// 创建链表
function createList(values: number[], type: ListType): { nodes: Map<string, ListNode>; headId: string | null; tailId: string | null } {
  nodeIdCounter = 0;
  const nodes = new Map<string, ListNode>();

  if (values.length === 0) {
    return { nodes, headId: null, tailId: null };
  }

  const nodeIds: string[] = values.map(() => generateNodeId());

  for (let i = 0; i < values.length; i++) {
    const node: ListNode = {
      id: nodeIds[i],
      value: values[i],
      next: i < values.length - 1 ? nodeIds[i + 1] : (type === 'circular' ? nodeIds[0] : null),
    };

    // 双链表：设置前驱指针
    if (type === 'doubly') {
      node.prev = i > 0 ? nodeIds[i - 1] : null;
    }

    nodes.set(nodeIds[i], node);
  }

  // 双向环形链表：首尾相连
  if (type === 'doubly' && values.length > 0) {
    const headNode = nodes.get(nodeIds[0]);
    const tailNode = nodes.get(nodeIds[values.length - 1]);
    if (headNode && tailNode) {
      headNode.prev = nodeIds[values.length - 1];
      tailNode.next = nodeIds[0];
    }
  }

  return { nodes, headId: nodeIds[0], tailId: nodeIds[values.length - 1] };
}

// 遍历链表
function* traverseList(
  nodes: Map<string, ListNode>,
  headId: string | null,
  type: ListType
): Generator<ListStep> {
  if (!headId) {
    yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: '链表为空', operation: 'traverse' };
    return;
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: '开始遍历', operation: 'traverse' };

  let currentId: string | null = headId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodes.get(currentId);
    if (!node) break;

    yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId, highlightIds: [currentId], highlightType: 'current', description: `访问节点 ${node.value}`, operation: 'traverse' };

    currentId = node.next;

    // 环形链表检测
    if (type === 'circular' && currentId === headId) {
      yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId, highlightIds: [], highlightType: 'found', description: '回到头节点，遍历完成', operation: 'traverse' };
      break;
    }
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'found', description: '遍历完成', operation: 'traverse' };
}

// 搜索节点
function* searchList(
  nodes: Map<string, ListNode>,
  headId: string | null,
  target: number,
  type: ListType
): Generator<ListStep> {
  if (!headId) {
    yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: '链表为空', operation: 'search' };
    return;
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: `搜索值 ${target}`, operation: 'search' };

  let currentId: string | null = headId;
  const visited = new Set<string>();
  let index = 0;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodes.get(currentId);
    if (!node) break;

    yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId, highlightIds: [currentId], highlightType: 'comparing', description: `比较节点 ${node.value} 与目标 ${target}`, operation: 'search' };

    if (node.value === target) {
      yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId, highlightIds: [currentId], highlightType: 'found', description: `找到值 ${target} 在位置 ${index}`, operation: 'search' };
      return;
    }

    currentId = node.next;
    index++;

    if (type === 'circular' && currentId === headId) {
      break;
    }
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: `未找到值 ${target}`, operation: 'search' };
}

// 插入节点（头部）
function* insertHead(
  nodes: Map<string, ListNode>,
  headId: string | null,
  value: number,
  type: ListType
): Generator<ListStep> {
  const newNodeId = generateNodeId();
  const newNode: ListNode = {
    id: newNodeId,
    value,
    next: headId,
  };

  if (type === 'doubly' && headId) {
    newNode.prev = null;
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [newNodeId], highlightType: 'current', description: `创建新节点 ${value}`, operation: 'insert' };

  // 添加新节点
  nodes.set(newNodeId, newNode);

  // 更新旧头节点的 prev
  if (type === 'doubly' && headId) {
    const oldHead = nodes.get(headId);
    if (oldHead) {
      oldHead.prev = newNodeId;
    }
  }

  // 环形链表：更新尾节点
  if (type === 'circular' && headId) {
    // 找到尾节点
    let tailId: string | null = headId;
    let currentId = headId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodes.get(currentId);
      if (!node || !node.next || node.next === headId) {
        tailId = currentId;
        break;
      }
      currentId = node.next;
    }

    // 尾节点指向新头节点
    const tail = nodes.get(tailId!);
    if (tail) {
      tail.next = newNodeId;
    }

    newNode.next = headId;
  }

  yield { nodes: cloneNodes(nodes), headId: newNodeId, tailId: null, currentId: newNodeId, highlightIds: [newNodeId], highlightType: 'found', description: `插入节点 ${value} 到头部`, operation: 'insert' };

  return { newHeadId: newNodeId };
}

// 插入节点（尾部）
function* insertTail(
  nodes: Map<string, ListNode>,
  headId: string | null,
  value: number,
  type: ListType
): Generator<ListStep> {
  const newNodeId = generateNodeId();
  const newNode: ListNode = {
    id: newNodeId,
    value,
    next: type === 'circular' ? headId : null,
  };

  if (type === 'doubly') {
    newNode.prev = null;
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [newNodeId], highlightType: 'current', description: `创建新节点 ${value}`, operation: 'insert' };

  if (!headId) {
    nodes.set(newNodeId, newNode);
    yield { nodes: cloneNodes(nodes), headId: newNodeId, tailId: newNodeId, currentId: newNodeId, highlightIds: [newNodeId], highlightType: 'found', description: `插入节点 ${value}（空链表）`, operation: 'insert' };
    return { newHeadId: newNodeId };
  }

  nodes.set(newNodeId, newNode);

  // 找到尾节点
  let tailId: string | null = headId;
  let currentId = headId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodes.get(currentId);
    if (!node || !node.next || (type === 'circular' && node.next === headId)) {
      tailId = currentId;
      break;
    }
    currentId = node.next;
  }

  const tail = nodes.get(tailId!);
  if (tail) {
    tail.next = newNodeId;
    if (type === 'doubly') {
      newNode.prev = tailId;
    }
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: newNodeId, currentId: newNodeId, highlightIds: [newNodeId, tailId!], highlightType: 'found', description: `插入节点 ${value} 到尾部`, operation: 'insert' };

  return { newHeadId: headId };
}

// 删除节点
function* deleteNode(
  nodes: Map<string, ListNode>,
  headId: string | null,
  target: number,
  type: ListType
): Generator<ListStep> {
  if (!headId) {
    yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: '链表为空', operation: 'delete' };
    return;
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: `删除值 ${target}`, operation: 'delete' };

  // 检查头节点
  const head = nodes.get(headId);
  if (head && head.value === target) {
    yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: headId, highlightIds: [headId], highlightType: 'comparing', description: `头节点值匹配 ${target}`, operation: 'delete' };

    const newHeadId = head.next;

    // 环形链表：找尾节点更新
    if (type === 'circular' && newHeadId) {
      let tailId: string | null = headId;
      let currentId = headId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const node = nodes.get(currentId);
        if (!node || !node.next || node.next === headId) {
          tailId = currentId;
          break;
        }
        currentId = node.next;
      }
      const tail = nodes.get(tailId!);
      if (tail) {
        tail.next = newHeadId;
      }
    }

    if (type === 'doubly' && newHeadId) {
      const newHead = nodes.get(newHeadId);
      if (newHead) {
        newHead.prev = null;
      }
    }

    nodes.delete(headId);

    yield { nodes: cloneNodes(nodes), headId: newHeadId || null, tailId: null, currentId: null, highlightIds: [], highlightType: 'found', description: `删除头节点 ${target}`, operation: 'delete' };
    return { newHeadId };
  }

  // 搜索要删除的节点
  let prevId: string | null = null;
  let currentId: string | null = headId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodes.get(currentId);
    if (!node) break;

    yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId, highlightIds: [currentId], highlightType: 'comparing', description: `比较节点 ${node.value}`, operation: 'delete' };

    if (node.value === target) {
      // 找到，删除
      const prevNode = prevId ? nodes.get(prevId) : null;
      if (prevNode) {
        prevNode.next = node.next;
      }

      if (type === 'doubly' && node.next) {
        const nextNode = nodes.get(node.next);
        if (nextNode) {
          nextNode.prev = prevId;
        }
      }

      nodes.delete(currentId);

      yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'found', description: `删除节点 ${target}`, operation: 'delete' };
      return { newHeadId: headId };
    }

    prevId = currentId;
    currentId = node.next;
  }

  yield { nodes: cloneNodes(nodes), headId, tailId: null, currentId: null, highlightIds: [], highlightType: 'current', description: `未找到值 ${target}`, operation: 'delete' };
}

// ============================================
// 布局计算
// ============================================

interface LayoutNode {
  id: string;
  value: number;
  x: number;
  y: number;
  nextId: string | null;
  prevId: string | null;
}

function calculateLayout(
  nodes: Map<string, ListNode>,
  headId: string | null,
  type: ListType,
  containerWidth: number = 600
): LayoutNode[] {
  const result: LayoutNode[] = [];
  if (!headId || nodes.size === 0) return result;

  const visited = new Set<string>();
  let currentId: string | null = headId;
  let x = 50;
  const y = 60;
  const spacing = 100;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodes.get(currentId);
    if (!node) break;

    result.push({
      id: node.id,
      value: node.value,
      x,
      y,
      nextId: node.next,
      prevId: type === 'doubly' ? node.prev || null : null,
    });

    x += spacing;
    if (x > containerWidth - 50) {
      // 换行
      x = 50;
    }

    currentId = node.next;

    if (type === 'circular' && currentId === headId) break;
  }

  return result;
}

// ============================================
// 主组件
// ============================================

const LinkedListVisualizer: React.FC<VisualizerProps<LinkedListConfig>> = ({ args, onStateChange }) => {
  const {
    type = 'singly',
    values = [10, 20, 30, 40, 50],
    insertValue,
    searchValue,
    deleteValue,
    speed = 500,
  } = args || {};

  const [nodes, setNodes] = useState<Map<string, ListNode>>(new Map());
  const [headId, setHeadId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [highlightType, setHighlightType] = useState<'current' | 'comparing' | 'found'>('current');
  const [description, setDescription] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const stepsRef = useRef<ListStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialValuesRef = useRef<number[]>(values);

  // 初始化链表
  useEffect(() => {
    initialValuesRef.current = values;
    const { nodes: newNodes, headId: newHeadId } = createList(values, type);
    setNodes(newNodes);
    setHeadId(newHeadId);
    setHighlightIds([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);
    onStateChange?.({ status: 'idle' });
  }, [values, type, onStateChange]);

  // 生成操作步骤
  const generateSteps = useCallback((operation: 'traverse' | 'search' | 'insertHead' | 'insertTail' | 'delete', value?: number) => {
    const steps: ListStep[] = [];
    let generator: Generator<ListStep>;

    const nodesCopy = cloneNodes(nodes);

    switch (operation) {
      case 'traverse':
        generator = traverseList(nodesCopy, headId, type);
        break;
      case 'search':
        generator = searchList(nodesCopy, headId, value ?? searchValue ?? values[0], type);
        break;
      case 'insertHead':
        generator = insertHead(nodesCopy, headId, value ?? insertValue ?? Math.floor(Math.random() * 100), type);
        break;
      case 'insertTail':
        generator = insertTail(nodesCopy, headId, value ?? insertValue ?? Math.floor(Math.random() * 100), type);
        break;
      case 'delete':
        generator = deleteNode(nodesCopy, headId, value ?? deleteValue ?? values[0], type);
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
  }, [nodes, headId, type, searchValue, insertValue, deleteValue, values]);

  // 操作处理
  const handleTraverse = useCallback(() => {
    const steps = generateSteps('traverse');
    if (steps) {
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [generateSteps]);

  const handleSearch = useCallback(() => {
    const steps = generateSteps('search');
    if (steps) {
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [generateSteps]);

  const handleInsertHead = useCallback(() => {
    const steps = generateSteps('insertHead');
    if (steps) {
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [generateSteps]);

  const handleInsertTail = useCallback(() => {
    const steps = generateSteps('insertTail');
    if (steps) {
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [generateSteps]);

  const handleDelete = useCallback(() => {
    const steps = generateSteps('delete');
    if (steps) {
      stepsRef.current = steps;
      setTotalSteps(steps.length);
      setCurrentStep(0);
      setIsPlaying(true);
    }
  }, [generateSteps]);

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
      setNodes(cloneNodes(stepData.nodes));
      setHeadId(stepData.headId);
      setHighlightIds(stepData.highlightIds);
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
    const { nodes: newNodes, headId: newHeadId } = createList(initialValuesRef.current, type);
    setNodes(newNodes);
    setHeadId(newHeadId);
    setHighlightIds([]);
    setDescription('');
    setCurrentStep(0);
    setTotalSteps(0);
    onStateChange?.({ status: 'idle' });
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
  const layoutNodes = useMemo(() => calculateLayout(nodes, headId, type), [nodes, headId, type]);

  // 获取节点颜色
  const getNodeColor = (nodeId: string) => {
    if (highlightIds.includes(nodeId)) {
      switch (highlightType) {
        case 'found': return '#22c55e';
        case 'comparing': return '#eab308';
        default: return '#3b82f6';
      }
    }
    return 'var(--bg-accent)';
  };

  const typeNames: Record<ListType, string> = {
    singly: '单链表',
    doubly: '双链表',
    circular: '环形链表',
  };

  return (
    <div className="linkedlist-visualizer">
      {/* 控制栏 */}
      <div className="visualizer-controls">
        <button onClick={handleTraverse} disabled={isPlaying} className="control-btn">
          🔄 遍历
        </button>
        <button onClick={handleSearch} disabled={isPlaying} className="control-btn">
          🔍 搜索
        </button>
        <button onClick={handleInsertHead} disabled={isPlaying} className="control-btn">
          ➕ 头插
        </button>
        <button onClick={handleInsertTail} disabled={isPlaying} className="control-btn">
          ➕ 尾插
        </button>
        <button onClick={handleDelete} disabled={isPlaying} className="control-btn">
          ➖ 删除
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
      <div className="linkedlist-container">
        <svg width="100%" height="150" viewBox="0 0 600 150">
          {/* 节点和箭头 */}
          {layoutNodes.map((node, idx) => {
            const nextNode = layoutNodes.find(n => n.id === node.nextId);
            const prevNode = layoutNodes.find(n => n.id === node.prevId);

            return (
              <g key={node.id}>
                {/* 后继指针箭头 */}
                {node.nextId && nextNode && (
                  <line
                    x1={node.x + 30}
                    y1={node.y}
                    x2={nextNode.x - 30}
                    y2={nextNode.y}
                    stroke="var(--accent-color)"
                    strokeWidth="2"
                    markerEnd="url(#arrowhead)"
                  />
                )}

                {/* 前驱指针箭头（双链表） */}
                {type === 'doubly' && node.prevId && prevNode && (
                  <line
                    x1={node.x - 30}
                    y1={node.y + 20}
                    x2={prevNode.x + 30}
                    y2={prevNode.y + 20}
                    stroke="#9333ea"
                    strokeWidth="2"
                    strokeDasharray="4,2"
                    markerEnd="url(#arrowhead-purple)"
                  />
                )}

                {/* 节点 */}
                <g transform={`translate(${node.x}, ${node.y})`}>
                  {/* 值区域 */}
                  <rect
                    x="-25"
                    y="-20"
                    width="50"
                    height="40"
                    rx="6"
                    fill={getNodeColor(node.id)}
                    stroke={highlightIds.includes(node.id) ? 'var(--text-primary)' : 'var(--border-color)'}
                    strokeWidth={highlightIds.includes(node.id) ? 2 : 1}
                  />
                  <text
                    x="0"
                    y="6"
                    textAnchor="middle"
                    fill="var(--text-primary)"
                    fontSize="14"
                    fontWeight="600"
                  >
                    {node.value}
                  </text>

                  {/* 指针区域 */}
                  <rect
                    x="25"
                    y="-15"
                    width="20"
                    height="30"
                    rx="4"
                    fill="var(--bg-tertiary)"
                    stroke="var(--border-color)"
                  />
                  {node.nextId && (
                    <circle cx="35" cy="0" r="4" fill="var(--accent-color)" />
                  )}

                  {/* 前驱指针区域（双链表） */}
                  {type === 'doubly' && (
                    <>
                      <rect
                        x="-45"
                        y="-15"
                        width="20"
                        height="30"
                        rx="4"
                        fill="var(--bg-tertiary)"
                        stroke="var(--border-color)"
                      />
                      {node.prevId && (
                        <circle cx="-35" cy="0" r="4" fill="#9333ea" />
                      )}
                    </>
                  )}
                </g>

                {/* 头节点标记 */}
                {idx === 0 && (
                  <text
                    x={node.x}
                    y={node.y - 35}
                    textAnchor="middle"
                    fontSize="10"
                    fill="var(--accent-color)"
                  >
                    HEAD
                  </text>
                )}
              </g>
            );
          })}

          {/* 箭头标记定义 */}
          <defs>
            <marker
              id="arrowhead"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent-color)" />
            </marker>
            <marker
              id="arrowhead-purple"
              markerWidth="10"
              markerHeight="7"
              refX="9"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="#9333ea" />
            </marker>
          </defs>

          {/* 空链表提示 */}
          {layoutNodes.length === 0 && (
            <text
              x="300"
              y="75"
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="14"
            >
              链表为空
            </text>
          )}
        </svg>
      </div>

      {/* 描述 */}
      {description && (
        <div className="visualizer-description">{description}</div>
      )}

      {/* 链表信息 */}
      <div className="visualizer-info">
        <span>类型: {typeNames[type]}</span>
        <span>节点数: {nodes.size}</span>
        <span>特点: {type === 'singly' ? '单向' : type === 'doubly' ? '双向' : '首尾相连'}</span>
      </div>
    </div>
  );
};

export default LinkedListVisualizer;