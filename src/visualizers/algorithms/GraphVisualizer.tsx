/**
 * 图算法可视化组件
 * 支持: BFS、DFS、Dijkstra、Kruskal、Prim
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

interface GraphNode {
  id: string;
  label?: string;
  x?: number;
  y?: number;
}

interface GraphEdge {
  from: string;
  to: string;
  weight?: number;
}

interface GraphConfig {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  algorithm?: 'bfs' | 'dfs' | 'dijkstra' | 'kruskal' | 'prim';
  startNode?: string;
  speed?: number;
}

interface GraphStep {
  visited: string[];
  current: string | null;
  queue?: string[];
  stack?: string[];
  path?: string[];
  edges?: string[];
  description: string;
  distances?: Record<string, number>;
  previous?: Record<string, string | null>;
}

// ============================================
// 默认图数据
// ============================================

const defaultNodes: GraphNode[] = [
  { id: 'A', label: 'A' },
  { id: 'B', label: 'B' },
  { id: 'C', label: 'C' },
  { id: 'D', label: 'D' },
  { id: 'E', label: 'E' },
  { id: 'F', label: 'F' },
];

const defaultEdges: GraphEdge[] = [
  { from: 'A', to: 'B', weight: 4 },
  { from: 'A', to: 'C', weight: 2 },
  { from: 'B', to: 'C', weight: 1 },
  { from: 'B', to: 'D', weight: 5 },
  { from: 'C', to: 'D', weight: 8 },
  { from: 'C', to: 'E', weight: 10 },
  { from: 'D', to: 'E', weight: 2 },
  { from: 'D', to: 'F', weight: 6 },
  { from: 'E', to: 'F', weight: 3 },
];

// 布局位置
const nodePositions: Record<string, { x: number; y: number }> = {
  A: { x: 50, y: 80 },
  B: { x: 150, y: 40 },
  C: { x: 150, y: 120 },
  D: { x: 250, y: 80 },
  E: { x: 350, y: 120 },
  F: { x: 350, y: 40 },
};

// 为自定义节点计算布局位置
function calculateNodePositions(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};

  // 首先使用预定义位置
  for (const node of nodes) {
    if (nodePositions[node.id]) {
      positions[node.id] = nodePositions[node.id];
    }
  }

  // 为没有预定义位置的节点计算位置（圆形布局）
  const unpositionedNodes = nodes.filter(n => !positions[n.id]);
  if (unpositionedNodes.length > 0) {
    const centerX = 200;
    const centerY = 90;
    const radius = 70;
    const count = unpositionedNodes.length;

    unpositionedNodes.forEach((node, idx) => {
      const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
      positions[node.id] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });
  }

  return positions;
}

// ============================================
// 图算法实现
// ============================================

function buildAdjList(edges: GraphEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  return adj;
}

function* bfs(_nodes: GraphNode[], edges: GraphEdge[], start: string): Generator<GraphStep> {
  const adj = buildAdjList(edges);
  const visited: string[] = [];
  const queue: string[] = [start];

  yield { visited: [], current: null, queue: [...queue], description: `从节点 ${start} 开始 BFS` };

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.includes(current)) continue;

    visited.push(current);
    yield { visited: [...visited], current, queue: [...queue], description: `访问节点 ${current}` };

    const neighbors = adj.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.includes(neighbor) && !queue.includes(neighbor)) {
        queue.push(neighbor);
      }
    }
    yield { visited: [...visited], current, queue: [...queue], description: `将邻居加入队列: [${queue.join(', ')}]` };
  }

  yield { visited, current: null, queue: [], description: 'BFS 完成' };
}

function* dfs(_nodes: GraphNode[], edges: GraphEdge[], start: string): Generator<GraphStep> {
  const adj = buildAdjList(edges);
  const visited: string[] = [];
  const stack: string[] = [start];

  yield { visited: [], current: null, stack: [...stack], description: `从节点 ${start} 开始 DFS` };

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.includes(current)) continue;

    visited.push(current);
    yield { visited: [...visited], current, stack: [...stack], description: `访问节点 ${current}` };

    const neighbors = adj.get(current) || [];
    for (const neighbor of [...neighbors].reverse()) {
      if (!visited.includes(neighbor)) {
        stack.push(neighbor);
      }
    }
    yield { visited: [...visited], current, stack: [...stack], description: `栈: [${stack.join(', ')}]` };
  }

  yield { visited, current: null, stack: [], description: 'DFS 完成' };
}

function* dijkstra(nodes: GraphNode[], edges: GraphEdge[], start: string): Generator<GraphStep> {
  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push({ to: e.to, weight: e.weight || 1 });
    adj.get(e.to)!.push({ to: e.from, weight: e.weight || 1 });
  }

  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  const visited: string[] = [];

  for (const node of nodes) {
    distances[node.id] = Infinity;
    previous[node.id] = null;
  }
  distances[start] = 0;

  yield { visited: [], current: null, distances: { ...distances }, previous: { ...previous }, description: `初始化, 从 ${start} 开始` };

  while (true) {
    let minDist = Infinity;
    let current: string | null = null;

    for (const node of nodes) {
      if (!visited.includes(node.id) && distances[node.id] < minDist) {
        minDist = distances[node.id];
        current = node.id;
      }
    }

    if (current === null) break;
    visited.push(current);

    yield { visited: [...visited], current, distances: { ...distances }, previous: { ...previous }, description: `选择最短距离节点 ${current} (距离: ${minDist})` };

    const neighbors = adj.get(current) || [];
    for (const { to, weight } of neighbors) {
      if (!visited.includes(to)) {
        const newDist = distances[current] + weight;
        if (newDist < distances[to]) {
          distances[to] = newDist;
          previous[to] = current;
          yield { visited: [...visited], current, distances: { ...distances }, previous: { ...previous }, description: `更新 ${to} 距离: ${newDist}` };
        }
      }
    }
  }

  yield { visited, current: null, distances, previous, description: 'Dijkstra 完成' };
}

function* kruskal(nodes: GraphNode[], edges: GraphEdge[]): Generator<GraphStep> {
  const parent: Record<string, string> = {};
  const rank: Record<string, number> = {};

  for (const node of nodes) {
    parent[node.id] = node.id;
    rank[node.id] = 0;
  }

  function find(x: string): string {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(x: string, y: string): boolean {
    const px = find(x), py = find(y);
    if (px === py) return false;
    if (rank[px] < rank[py]) parent[px] = py;
    else if (rank[px] > rank[py]) parent[py] = px;
    else { parent[py] = px; rank[px]++; }
    return true;
  }

  const sortedEdges = [...edges].sort((a, b) => (a.weight || 1) - (b.weight || 1));
  const mstEdges: string[] = [];
  const visited: string[] = [];

  yield { visited: [], current: null, edges: [], description: 'Kruskal: 按权重排序边' };

  for (const edge of sortedEdges) {
    const edgeId = `${edge.from}-${edge.to}`;
    yield { visited, current: null, edges: [...mstEdges], description: `检查边 ${edge.from}-${edge.to} (权重: ${edge.weight})` };

    if (union(edge.from, edge.to)) {
      mstEdges.push(edgeId);
      if (!visited.includes(edge.from)) visited.push(edge.from);
      if (!visited.includes(edge.to)) visited.push(edge.to);
      yield { visited: [...visited], current: null, edges: [...mstEdges], description: `添加边 ${edge.from}-${edge.to}` };
    } else {
      yield { visited, current: null, edges: [...mstEdges], description: `跳过边 ${edge.from}-${edge.to} (形成环)` };
    }
  }

  yield { visited, current: null, edges: mstEdges, description: `MST 完成, 共 ${mstEdges.length} 条边` };
}

function* prim(nodes: GraphNode[], edges: GraphEdge[], start: string): Generator<GraphStep> {
  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push({ to: e.to, weight: e.weight || 1 });
    adj.get(e.to)!.push({ to: e.from, weight: e.weight || 1 });
  }

  const visited: string[] = [start];
  const mstEdges: string[] = [];

  yield { visited: [...visited], current: start, edges: [], description: `Prim: 从 ${start} 开始` };

  while (visited.length < nodes.length) {
    let minEdge: { from: string; to: string; weight: number } | null = null;

    for (const v of visited) {
      const neighbors = adj.get(v) || [];
      for (const n of neighbors) {
        if (!visited.includes(n.to)) {
          if (!minEdge || n.weight < minEdge.weight) {
            minEdge = { from: v, to: n.to, weight: n.weight };
          }
        }
      }
    }

    if (!minEdge) break;

    visited.push(minEdge.to);
    mstEdges.push(`${minEdge.from}-${minEdge.to}`);
    yield { visited: [...visited], current: minEdge.to, edges: [...mstEdges], description: `添加边 ${minEdge.from}-${minEdge.to} (权重: ${minEdge.weight})` };
  }

  yield { visited, current: null, edges: mstEdges, description: `MST 完成, 共 ${mstEdges.length} 条边` };
}

// ============================================
// 主组件
// ============================================

const GraphVisualizer: React.FC<VisualizerProps<GraphConfig>> = ({ args, onStateChange }) => {
  const {
    nodes = defaultNodes,
    edges = defaultEdges,
    algorithm = 'bfs',
    startNode = 'A',
    speed = 800,
  } = args || {};

  const [visited, setVisited] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [stack, setStack] = useState<string[]>([]);
  const [pathEdges, setPathEdges] = useState<string[]>([]);
  const [distances, setDistances] = useState<Record<string, number>>({});
  const [description, setDescription] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const stepsRef = useRef<GraphStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAlgorithm = useCallback(() => {
    switch (algorithm) {
      case 'bfs': return bfs(nodes, edges, startNode);
      case 'dfs': return dfs(nodes, edges, startNode);
      case 'dijkstra': return dijkstra(nodes, edges, startNode);
      case 'kruskal': return kruskal(nodes, edges);
      case 'prim': return prim(nodes, edges, startNode);
      default: return bfs(nodes, edges, startNode);
    }
  }, [nodes, edges, algorithm, startNode]);

  useEffect(() => {
    const gen = runAlgorithm();
    const steps: GraphStep[] = [];
    let result = gen.next();
    while (!result.done) {
      steps.push(result.value);
      result = gen.next();
    }
    stepsRef.current = steps;

    setVisited([]);
    setCurrent(null);
    setQueue([]);
    setStack([]);
    setPathEdges([]);
    setDistances({});
    setDescription('');
    setCurrentStep(0);
    setIsPlaying(false);

    onStateChange?.({ status: 'idle', totalSteps: steps.length });
  }, [runAlgorithm, onStateChange]);

  const play = useCallback(() => {
    if (currentStep >= stepsRef.current.length) {
      setCurrentStep(0);
      setVisited([]);
      setCurrent(null);
      setQueue([]);
      setStack([]);
      setPathEdges([]);
    }
    setIsPlaying(true);
    onStateChange?.({ status: 'playing', currentStep, totalSteps: stepsRef.current.length });
  }, [currentStep, onStateChange]);

  const pause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) clearTimeout(animationRef.current);
  }, []);

  const step = useCallback(() => {
    if (currentStep < stepsRef.current.length) {
      const s = stepsRef.current[currentStep];
      setVisited(s.visited);
      setCurrent(s.current);
      setQueue(s.queue || []);
      setStack(s.stack || []);
      setPathEdges(s.edges || []);
      if (s.distances) setDistances(s.distances);
      setDescription(s.description);
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentStep(0);
    setVisited([]);
    setCurrent(null);
    setQueue([]);
    setStack([]);
    setPathEdges([]);
    setDistances({});
    setDescription('');
  }, []);

  useEffect(() => {
    if (isPlaying && currentStep < stepsRef.current.length) {
      animationRef.current = setTimeout(() => {
        step();
        if (currentStep + 1 >= stepsRef.current.length) setIsPlaying(false);
      }, speed);
    }
    return () => { if (animationRef.current) clearTimeout(animationRef.current); };
  }, [isPlaying, currentStep, speed, step]);

  // 计算边样式
  const edgeKey = (from: string, to: string) => [from, to].sort().join('-');
  const activeEdges = useMemo(() => {
    const set = new Set<string>();
    pathEdges.forEach(e => {
      const [a, b] = e.split('-');
      set.add(edgeKey(a, b));
    });
    return set;
  }, [pathEdges]);

  // 计算节点位置（支持自定义节点）
  const computedPositions = useMemo(() => calculateNodePositions(nodes), [nodes]);

  return (
    <div className="graph-visualizer">
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
        <span className="step-info">算法: {algorithm.toUpperCase()}</span>
      </div>

      <svg className="graph-canvas" viewBox="0 0 400 180">
        {/* 边 */}
        {edges.map((edge, idx) => {
          const from = computedPositions[edge.from];
          const to = computedPositions[edge.to];
          if (!from || !to) return null;
          const isActive = activeEdges.has(edgeKey(edge.from, edge.to));
          return (
            <g key={idx}>
              <line
                x1={from.x} y1={from.y}
                x2={to.x} y2={to.y}
                stroke={isActive ? '#2563eb' : 'var(--border-color-strong)'}
                strokeWidth={isActive ? 3 : 1.5}
              />
              {edge.weight !== undefined && (
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-secondary)"
                >
                  {edge.weight}
                </text>
              )}
            </g>
          );
        })}

        {/* 节点 */}
        {nodes.map(node => {
          const pos = computedPositions[node.id];
          if (!pos) return null;
          const isVisited = visited.includes(node.id);
          const isCurrent = current === node.id;
          return (
            <g key={node.id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={18}
                fill={isCurrent ? '#2563eb' : isVisited ? '#10b981' : 'var(--bg-tertiary)'}
                stroke={isCurrent ? '#1d4ed8' : isVisited ? '#059669' : 'var(--border-color-strong)'}
                strokeWidth={2}
              />
              <text
                x={pos.x}
                y={pos.y + 4}
                textAnchor="middle"
                fontSize="12"
                fontWeight="600"
                fill={isCurrent || isVisited ? 'white' : 'var(--text-primary)'}
              >
                {node.label || node.id}
              </text>
              {distances[node.id] !== undefined && distances[node.id] !== Infinity && (
                <text
                  x={pos.x}
                  y={pos.y - 24}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--accent-color)"
                >
                  d={distances[node.id]}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* 状态信息 */}
      <div className="graph-status">
        {queue.length > 0 && <span>队列: [{queue.join(', ')}]</span>}
        {stack.length > 0 && <span>栈: [{stack.join(', ')}]</span>}
        {visited.length > 0 && <span>已访问: [{visited.join(', ')}]</span>}
      </div>

      <div className="visualizer-description">{description}</div>
    </div>
  );
};

export default GraphVisualizer;