/**
 * 脑图（思维导图）可视化组件
 * 支持: 树形布局、折叠展开、缩放拖拽
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

interface MindMapNode {
  id: string;
  label: string;
  children?: MindMapNode[];
  collapsed?: boolean;
}

interface MindMapConfig {
  data?: MindMapNode;
  direction?: 'right' | 'left' | 'both';
}

interface LayoutNode extends MindMapNode {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parent?: LayoutNode;
}

// ============================================
// 布局计算
// ============================================

const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const H_GAP = 60;
const V_GAP = 12;

// 计算子树高度
function calculateSubtreeHeight(node: MindMapNode): number {
  if (!node.children || node.children.length === 0 || node.collapsed) {
    return NODE_HEIGHT;
  }
  const childrenHeight = node.children.reduce((sum, child) => {
    return sum + calculateSubtreeHeight(child) + V_GAP;
  }, -V_GAP);
  return Math.max(NODE_HEIGHT, childrenHeight);
}

// 布局算法
function calculateLayout(
  node: MindMapNode,
  x: number,
  y: number,
  direction: 'right' | 'left' | 'both',
  depth: number = 0,
  parent?: LayoutNode
): LayoutNode[] {
  const nodes: LayoutNode[] = [];

  const subtreeHeight = calculateSubtreeHeight(node);
  const layoutNode: LayoutNode = {
    ...node,
    x,
    y: y + subtreeHeight / 2 - NODE_HEIGHT / 2,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    depth,
    parent,
  };
  nodes.push(layoutNode);

  if (node.children && node.children.length > 0 && !node.collapsed) {
    let currentY = y;
    const nextX = direction === 'left' ? x - NODE_WIDTH - H_GAP : x + NODE_WIDTH + H_GAP;

    for (const child of node.children) {
      const childHeight = calculateSubtreeHeight(child);
      const childNodes = calculateLayout(
        child,
        nextX,
        currentY,
        direction,
        depth + 1,
        layoutNode
      );
      nodes.push(...childNodes);
      currentY += childHeight + V_GAP;
    }
  }

  return nodes;
}

// 收集所有边
function collectEdges(nodes: LayoutNode[]): { from: LayoutNode; to: LayoutNode }[] {
  const edges: { from: LayoutNode; to: LayoutNode }[] = [];
  const nodeMap = new Map<string, LayoutNode>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  for (const node of nodes) {
    if (node.parent) {
      edges.push({ from: node.parent, to: node });
    }
  }

  return edges;
}

// ============================================
// 默认数据
// ============================================

const DEFAULT_DATA: MindMapNode = {
  id: 'root',
  label: '中心主题',
  children: [
    {
      id: 'branch1',
      label: '分支一',
      children: [
        { id: 'leaf1', label: '子节点 1' },
        { id: 'leaf2', label: '子节点 2' },
      ],
    },
    {
      id: 'branch2',
      label: '分支二',
      children: [
        { id: 'leaf3', label: '子节点 3' },
      ],
    },
    {
      id: 'branch3',
      label: '分支三',
      children: [
        { id: 'leaf4', label: '子节点 4' },
        { id: 'leaf5', label: '子节点 5' },
      ],
    },
  ],
};

// ============================================
// 主组件
// ============================================

const MindMapVisualizer: React.FC<VisualizerProps<MindMapConfig>> = ({ args }) => {
  const { data = DEFAULT_DATA, direction = 'right' } = args || {};

  const [rootNode, setRootNode] = useState<MindMapNode>(data);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const svgRef = useRef<SVGSVGElement>(null);

  // 更新数据
  useEffect(() => {
    setRootNode(data);
  }, [data]);

  // 切换折叠状态
  const toggleCollapse = useCallback((nodeId: string) => {
    const toggle = (node: MindMapNode): MindMapNode => {
      if (node.id === nodeId) {
        return { ...node, collapsed: !node.collapsed };
      }
      if (node.children) {
        return { ...node, children: node.children.map(toggle) };
      }
      return node;
    };
    setRootNode(toggle(rootNode));
  }, [rootNode]);

  // 计算布局
  const layoutNodes = useMemo(() => {
    return calculateLayout(rootNode, 100, 0, direction);
  }, [rootNode, direction]);

  const edges = useMemo(() => collectEdges(layoutNodes), [layoutNodes]);

  // 缩放控制
  const handleZoomIn = () => setZoom((z) => Math.min(2, z + 0.1));
  const handleZoomOut = () => setZoom((z) => Math.max(0.3, z - 0.1));
  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 50, y: 50 });
  };

  // 拖拽处理
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as Element).tagName === 'svg') {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 滚轮缩放（需要 Ctrl+Shift）
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom((z) => Math.max(0.3, Math.min(3, z + delta)));
    }
  };

  // 全屏状态
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 切换全屏
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        void containerRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        void document.exitFullscreen();
      }
    }
  }, [isFullscreen]);

  // 监听全屏变化
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // ESC 退出全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        if (document.exitFullscreen) {
          void document.exitFullscreen();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // 计算边界
  const bounds = useMemo(() => {
    if (layoutNodes.length === 0) return { minX: 0, maxX: 800, minY: 0, maxY: 400 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const node of layoutNodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x + node.width);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y + node.height);
    }
    return { minX, maxX, minY, maxY };
  }, [layoutNodes]);

  const svgWidth = Math.max(800, (bounds.maxX - bounds.minX + 200));
  const svgHeight = Math.max(400, (bounds.maxY - bounds.minY + 100));

  return (
    <div ref={containerRef} className={`mindmap-visualizer ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* 控制栏 */}
      <div className="visualizer-controls">
        <button onClick={handleZoomIn} className="control-btn" title="放大">
          🔍+
        </button>
        <button onClick={handleZoomOut} className="control-btn" title="缩小">
          🔍-
        </button>
        <button onClick={handleResetZoom} className="control-btn" title="重置视图">
          ⟲ 重置
        </button>
        <button onClick={toggleFullscreen} className="control-btn" title={isFullscreen ? "退出全屏" : "全屏显示"}>
          {isFullscreen ? '⛶ 退出全屏' : '⛶ 全屏'}
        </button>
        <span className="zoom-info">{Math.round(zoom * 100)}%</span>
        <span className="node-count">节点: {layoutNodes.length}</span>
      </div>

      {/* 可视化区域 */}
      <div className="visualizer-container mindmap-container">
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${-pan.x} ${-pan.y} ${svgWidth / zoom} ${svgHeight / zoom}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          {/* 边 */}
          {edges.map((edge, idx) => {
            const fromX = edge.from.x + NODE_WIDTH;
            const fromY = edge.from.y + NODE_HEIGHT / 2;
            const toX = edge.to.x;
            const toY = edge.to.y + NODE_HEIGHT / 2;
            const midX = (fromX + toX) / 2;

            return (
              <path
                key={`edge-${idx}`}
                d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
                fill="none"
                stroke="var(--accent-color)"
                strokeWidth="2"
                opacity="0.6"
              />
            );
          })}

          {/* 节点 */}
          {layoutNodes.map((node) => {
            const isSelected = selectedId === node.id;
            const hasChildren = node.children && node.children.length > 0;
            const isCollapsed = node.collapsed;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasChildren) {
                    toggleCollapse(node.id);
                  }
                  setSelectedId(node.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                {/* 节点背景 */}
                <rect
                  width={node.width}
                  height={node.height}
                  rx="8"
                  fill={isSelected ? 'var(--accent-color)' : 'var(--bg-tertiary)'}
                  stroke={isSelected ? 'var(--accent-hover)' : 'var(--border-color-strong)'}
                  strokeWidth={isSelected ? 2 : 1}
                  className="mindmap-node"
                />

                {/* 节点文字 */}
                <text
                  x={node.width / 2}
                  y={node.height / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={isSelected ? 'white' : 'var(--text-primary)'}
                  fontSize="13"
                  fontWeight="500"
                >
                  {node.label.length > 10 ? node.label.slice(0, 10) + '...' : node.label}
                </text>

                {/* 折叠/展开指示器 */}
                {hasChildren && (
                  <g transform={`translate(${node.width - 16}, ${node.height / 2})`}>
                    <circle
                      r="8"
                      fill={isSelected ? 'rgba(255,255,255,0.3)' : 'var(--bg-input)'}
                      stroke={isSelected ? 'white' : 'var(--border-color-strong)'}
                      strokeWidth="1"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={isSelected ? 'white' : 'var(--text-secondary)'}
                      fontSize="12"
                      fontWeight="bold"
                    >
                      {isCollapsed ? '+' : '−'}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 提示信息 */}
      <div className="visualizer-description">
        点击节点展开/折叠子节点 | Ctrl+Shift+滚轮缩放 | 拖拽移动画布 | ESC退出全屏
      </div>
    </div>
  );
};

export default MindMapVisualizer;