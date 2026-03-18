/**
 * 树结构可视化组件
 * 支持: 二叉树、二叉搜索树(BST)、AVL树、红黑树
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

interface TreeNode {
  id: string;
  value: number;
  left?: TreeNode;
  right?: TreeNode;
  height?: number;        // AVL树用
  color?: 'red' | 'black'; // 红黑树用
  x?: number;
  y?: number;
  highlight?: 'current' | 'comparing' | 'found' | 'rotating' | 'none';
}

type TreeType = 'binary' | 'bst' | 'avl' | 'redblack';

interface TreeConfig {
  type: TreeType;
  values?: number[];
  insertValue?: number;
  searchValue?: number;
  deleteValue?: number;
  speed?: number;
}

interface TreeStep {
  tree: TreeNode | null;
  description: string;
  highlightNodes?: string[];
  highlightType?: 'current' | 'comparing' | 'found' | 'rotating';
}

// ============================================
// 树操作算法 (生成器版本)
// ============================================

// 计算树高度
function getHeight(node: TreeNode | null | undefined): number {
  if (!node) return 0;
  return Math.max(getHeight(node.left), getHeight(node.right)) + 1;
}

// 克隆树
function cloneTree(node: TreeNode | null | undefined): TreeNode | null {
  if (!node) return null;
  const cloned: TreeNode = {
    id: node.id,
    value: node.value,
    height: node.height,
    color: node.color,
  };
  cloned.left = cloneTree(node.left) || undefined;
  cloned.right = cloneTree(node.right) || undefined;
  return cloned;
}

// 生成节点ID
let nodeIdCounter = 0;
function generateNodeId(): string {
  return `node_${nodeIdCounter++}`;
}

// 重置计数器
function resetNodeId() {
  nodeIdCounter = 0;
}

// 创建节点
function createNode(value: number, color?: 'red' | 'black'): TreeNode {
  return {
    id: generateNodeId(),
    value,
    height: 1,
    color: color || undefined,
  };
}

// 从数组创建完全二叉树
function createBinaryTree(values: number[]): TreeNode | null {
  if (values.length === 0) return null;
  resetNodeId();

  const nodes: (TreeNode | null)[] = values.map(v => createNode(v));

  for (let i = 0; i < nodes.length; i++) {
    const leftIdx = 2 * i + 1;
    const rightIdx = 2 * i + 2;
    if (nodes[i]) {
      nodes[i]!.left = nodes[leftIdx] || undefined;
      nodes[i]!.right = nodes[rightIdx] || undefined;
    }
  }

  return nodes[0];
}

// BST 插入
function* bstInsert(root: TreeNode | null, value: number): Generator<TreeStep> {
  resetNodeId();

  function* insert(node: TreeNode | null, value: number): Generator<TreeStep, TreeNode> {
    if (!node) {
      const newNode = createNode(value);
      yield { tree: cloneTree(root), description: `创建新节点 ${value}`, highlightNodes: [newNode.id], highlightType: 'current' };
      return newNode;
    }

    yield { tree: cloneTree(root), description: `比较 ${value} 与 ${node.value}`, highlightNodes: [node.id], highlightType: 'comparing' };

    if (value < node.value) {
      const newLeft = yield* insert(node.left || null, value);
      node.left = newLeft;
    } else if (value > node.value) {
      const newRight = yield* insert(node.right || null, value);
      node.right = newRight;
    } else {
      yield { tree: cloneTree(root), description: `值 ${value} 已存在`, highlightNodes: [node.id], highlightType: 'found' };
      return node;
    }

    return node;
  }

  const result = yield* insert(root, value);
  yield { tree: cloneTree(result), description: `插入 ${value} 完成` };
  return result;
}

// BST 搜索
function* bstSearch(root: TreeNode | null, value: number): Generator<TreeStep> {
  if (!root) {
    yield { tree: null, description: '树为空' };
    return;
  }

  let current: TreeNode | null = root;
  while (current) {
    yield { tree: cloneTree(root), description: `比较 ${value} 与 ${current.value}`, highlightNodes: [current.id], highlightType: 'comparing' };

    if (value === current.value) {
      yield { tree: cloneTree(root), description: `找到值 ${value}`, highlightNodes: [current.id], highlightType: 'found' };
      return;
    } else if (value < current.value) {
      current = current.left || null;
    } else {
      current = current.right || null;
    }
  }

  yield { tree: cloneTree(root), description: `未找到值 ${value}` };
}

// AVL 树旋转
function updateHeight(node: TreeNode): void {
  node.height = Math.max(getHeight(node.left), getHeight(node.right)) + 1;
}

function getBalance(node: TreeNode): number {
  return getHeight(node.left) - getHeight(node.right);
}

function rotateRight(y: TreeNode): TreeNode {
  const x = y.left!;
  const T2 = x.right;

  x.right = y;
  y.left = T2;

  updateHeight(y);
  updateHeight(x);

  return x;
}

function rotateLeft(x: TreeNode): TreeNode {
  const y = x.right!;
  const T2 = y.left;

  y.left = x;
  x.right = T2;

  updateHeight(x);
  updateHeight(y);

  return y;
}

// AVL 插入
function* avlInsert(root: TreeNode | null, value: number): Generator<TreeStep> {
  resetNodeId();

  function* insert(node: TreeNode | null, value: number): Generator<TreeStep, TreeNode> {
    if (!node) {
      const newNode = createNode(value);
      yield { tree: cloneTree(root), description: `创建新节点 ${value}`, highlightNodes: [newNode.id], highlightType: 'current' };
      return newNode;
    }

    yield { tree: cloneTree(root), description: `比较 ${value} 与 ${node.value}`, highlightNodes: [node.id], highlightType: 'comparing' };

    if (value < node.value) {
      node.left = yield* insert(node.left || null, value);
    } else if (value > node.value) {
      node.right = yield* insert(node.right || null, value);
    } else {
      return node;
    }

    updateHeight(node);
    const balance = getBalance(node);

    // 左左情况
    if (balance > 1 && value < (node.left?.value || 0)) {
      yield { tree: cloneTree(root), description: `左左失衡，右旋`, highlightNodes: [node.id], highlightType: 'rotating' };
      return rotateRight(node);
    }

    // 右右情况
    if (balance < -1 && value > (node.right?.value || 0)) {
      yield { tree: cloneTree(root), description: `右右失衡，左旋`, highlightNodes: [node.id], highlightType: 'rotating' };
      return rotateLeft(node);
    }

    // 左右情况
    if (balance > 1 && value > (node.left?.value || 0)) {
      yield { tree: cloneTree(root), description: `左右失衡，先左旋后右旋`, highlightNodes: [node.id], highlightType: 'rotating' };
      node.left = rotateLeft(node.left!);
      return rotateRight(node);
    }

    // 右左情况
    if (balance < -1 && value < (node.right?.value || 0)) {
      yield { tree: cloneTree(root), description: `右左失衡，先右旋后左旋`, highlightNodes: [node.id], highlightType: 'rotating' };
      node.right = rotateRight(node.right!);
      return rotateLeft(node);
    }

    return node;
  }

  const result = yield* insert(root, value);
  yield { tree: cloneTree(result), description: `AVL 插入 ${value} 完成` };
  return result;
}

// 红黑树插入
function* redblackInsert(root: TreeNode | null, value: number): Generator<TreeStep> {
  resetNodeId();

  // 创建红色节点
  function createRedNode(value: number): TreeNode {
    return createNode(value, 'red');
  }

  function* insert(node: TreeNode | null, value: number): Generator<TreeStep, TreeNode> {
    if (!node) {
      const newNode = createRedNode(value);
      yield { tree: cloneTree(root), description: `创建红色节点 ${value}`, highlightNodes: [newNode.id], highlightType: 'current' };
      return newNode;
    }

    yield { tree: cloneTree(root), description: `比较 ${value} 与 ${node.value}`, highlightNodes: [node.id], highlightType: 'comparing' };

    if (value < node.value) {
      node.left = yield* insert(node.left || null, value);
    } else if (value > node.value) {
      node.right = yield* insert(node.right || null, value);
    } else {
      return node;
    }

    return node;
  }

  let result = yield* insert(root, value);
  if (result) {
    result.color = 'black'; // 根节点必须为黑
    yield { tree: cloneTree(result), description: `根节点染黑`, highlightNodes: [result.id], highlightType: 'current' };
  }

  yield { tree: cloneTree(result), description: `红黑树插入 ${value} 完成` };
  return result;
}

// ============================================
// 树布局计算
// ============================================

function calculateLayout(node: TreeNode | null, x: number = 400, y: number = 40, level: number = 0, spacing: number = 200): void {
  if (!node) return;

  node.x = x;
  node.y = y;

  const nextSpacing = spacing * 0.55;

  if (node.left) {
    calculateLayout(node.left, x - spacing, y + 70, level + 1, nextSpacing);
  }
  if (node.right) {
    calculateLayout(node.right, x + spacing, y + 70, level + 1, nextSpacing);
  }
}

// 收集所有节点
function collectNodes(node: TreeNode | null, nodes: TreeNode[] = []): TreeNode[] {
  if (!node) return nodes;
  nodes.push(node);
  if (node.left) collectNodes(node.left, nodes);
  if (node.right) collectNodes(node.right, nodes);
  return nodes;
}

// 收集所有边
function collectEdges(node: TreeNode | null, edges: { from: TreeNode; to: TreeNode }[] = []): { from: TreeNode; to: TreeNode }[] {
  if (!node) return edges;
  if (node.left) {
    edges.push({ from: node, to: node.left });
    collectEdges(node.left, edges);
  }
  if (node.right) {
    edges.push({ from: node, to: node.right });
    collectEdges(node.right, edges);
  }
  return edges;
}

// ============================================
// 主组件
// ============================================

const TreeVisualizer: React.FC<VisualizerProps<TreeConfig>> = ({ args, onStateChange }) => {
  const {
    type = 'bst',
    values = [50, 30, 70, 20, 40, 60, 80],
    insertValue,
    searchValue,
    speed = 800,
  } = args || {};

  const [currentTree, setCurrentTree] = useState<TreeNode | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightType, setHighlightType] = useState<'current' | 'comparing' | 'found' | 'rotating'>('current');
  const [description, setDescription] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const stepsRef = useRef<TreeStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialTreeRef = useRef<TreeNode | null>(null);

  // 初始化树
  useEffect(() => {
    resetNodeId();
    const tree = createBinaryTree(values);
    initialTreeRef.current = cloneTree(tree);
    setCurrentTree(tree);
    stepsRef.current = [];
    setCurrentStep(0);
    setTotalSteps(0);
    setHighlightNodes(new Set());
    setDescription('');
    onStateChange?.({ status: 'idle' });
  }, [values, type, onStateChange]);

  // 生成操作步骤
  const generateSteps = useCallback((operation: 'insert' | 'search', value: number) => {
    resetNodeId();
    const steps: TreeStep[] = [];
    let generator: Generator<TreeStep>;

    const treeCopy = cloneTree(currentTree);

    if (operation === 'insert') {
      switch (type) {
        case 'avl':
          generator = avlInsert(treeCopy, value);
          break;
        case 'redblack':
          generator = redblackInsert(treeCopy, value);
          break;
        case 'bst':
        case 'binary':
        default:
          generator = bstInsert(treeCopy, value);
      }
    } else {
      generator = bstSearch(treeCopy, value);
    }

    let result = generator.next();
    while (!result.done) {
      steps.push(result.value);
      result = generator.next();
    }

    return steps;
  }, [currentTree, type]);

  // 执行插入
  const handleInsert = useCallback(() => {
    const value = insertValue ?? Math.floor(Math.random() * 100) + 1;
    const steps = generateSteps('insert', value);
    stepsRef.current = steps;
    setTotalSteps(steps.length);
    setCurrentStep(0);
    setIsPlaying(true);
  }, [insertValue, generateSteps]);

  // 执行搜索
  const handleSearch = useCallback(() => {
    const value = searchValue ?? values[Math.floor(Math.random() * values.length)];
    const steps = generateSteps('search', value);
    stepsRef.current = steps;
    setTotalSteps(steps.length);
    setCurrentStep(0);
    setIsPlaying(true);
  }, [searchValue, values, generateSteps]);

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
      if (stepData.tree) {
        calculateLayout(stepData.tree);
      }
      setCurrentTree(stepData.tree);
      setHighlightNodes(new Set(stepData.highlightNodes || []));
      setHighlightType(stepData.highlightType || 'current');
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
    setCurrentTree(cloneTree(initialTreeRef.current));
    setHighlightNodes(new Set());
    setDescription('');
    setCurrentStep(0);
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

  // 计算布局
  const layoutTree = useMemo(() => {
    if (!currentTree) return null;
    const treeCopy = cloneTree(currentTree);
    calculateLayout(treeCopy);
    return treeCopy;
  }, [currentTree]);

  const nodes = layoutTree ? collectNodes(layoutTree) : [];
  const edges = layoutTree ? collectEdges(layoutTree) : [];

  const getNodeColor = (node: TreeNode) => {
    if (highlightNodes.has(node.id)) {
      switch (highlightType) {
        case 'found': return '#22c55e';
        case 'comparing': return '#eab308';
        case 'rotating': return '#a855f7';
        default: return '#3b82f6';
      }
    }
    if (node.color === 'red') return '#ef4444';
    if (node.color === 'black') return '#1f2937';
    return 'var(--bg-accent)';
  };

  const treeTypeName: Record<TreeType, string> = {
    binary: '二叉树',
    bst: '二叉搜索树',
    avl: 'AVL树',
    redblack: '红黑树',
  };

  return (
    <div className="tree-visualizer">
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

      {/* 可视化区域 */}
      <div className="visualizer-container tree-container">
        <svg width="100%" height="400" viewBox="0 0 800 400">
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
            <g key={node.id}>
              <circle
                cx={node.x ?? 0}
                cy={node.y ?? 0}
                r="24"
                fill={getNodeColor(node)}
                stroke={highlightNodes.has(node.id) ? 'var(--text-primary)' : 'var(--border-color)'}
                strokeWidth={highlightNodes.has(node.id) ? 3 : 1}
                className="tree-node"
              />
              <text
                x={node.x ?? 0}
                y={(node.y ?? 0) + 5}
                textAnchor="middle"
                fill={node.color === 'black' ? 'white' : 'var(--text-primary)'}
                fontSize="14"
                fontWeight="bold"
              >
                {node.value}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* 描述 */}
      {description && (
        <div className="visualizer-description">{description}</div>
      )}

      {/* 树信息 */}
      <div className="visualizer-info">
        <span>类型: {treeTypeName[type]}</span>
        <span>节点数: {nodes.length}</span>
        <span>高度: {getHeight(layoutTree)}</span>
      </div>
    </div>
  );
};

export default TreeVisualizer;