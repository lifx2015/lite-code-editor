/**
 * Mermaid 流程图渲染组件
 * 支持多种图表类型：流程图、时序图、类图、状态图等
 */

import React, { useEffect, useRef, useState, memo, useCallback } from 'react';
import mermaid from 'mermaid';

// 初始化 mermaid 配置
mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    primaryColor: '#eff6ff',
    primaryTextColor: '#388bfd',
    primaryBorderColor: '#388bfd',
    lineColor: '#388bfd',
    secondaryColor: '#eff6ff',
    tertiaryColor: '#f5f9ff',
    // mindmap 配色 - 淡雅
    mindmapPrimary: '#dbeafe',
    mindmapSecondary: '#ede9fe',
  },
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
    padding: 20,
    nodeSpacing: 50,
    rankSpacing: 50,
  },
  sequence: {
    useMaxWidth: true,
    diagramMarginX: 50,
    diagramMarginY: 10,
    actorMargin: 50,
    noteMargin: 10,
    messageMargin: 35,
  },
  gantt: {
    useMaxWidth: true,
    titleTopMargin: 25,
    barHeight: 20,
    barGap: 4,
    topPadding: 50,
  },
  mindmap: {
    useMaxWidth: true,
    padding: 25,
  },
});

interface MermaidDiagramProps {
  chart: string;
  id?: string;
}

// 渲染缓存
const renderCache = new Map<string, string>();
let mermaidIdCounter = 0;

function generateMermaidId(): string {
  return `mermaid-${++mermaidIdCounter}`;
}

const MermaidDiagram: React.FC<MermaidDiagramProps> = memo(function MermaidDiagram({ chart, id }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 使用 ref 存储稳定的 graphId
  const graphIdRef = useRef(id || generateMermaidId());

  // 使用 ref 来追踪当前正在渲染的 chart
  const chartRef = useRef(chart);
  const containerRef = useRef<HTMLDivElement>(null);

  // 检查是否为脑图
  const isMindmap = chart.trim().startsWith('mindmap');

  // 全屏切换
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

  useEffect(() => {
    chartRef.current = chart;
  }, [chart]);

  useEffect(() => {
    let mounted = true;

    const renderChart = async () => {
      const currentChart = chartRef.current;

      // 检查缓存
      const cached = renderCache.get(currentChart);
      if (cached && mounted) {
        setSvg(cached);
        setLoading(false);
        return;
      }

      try {
        const uniqueId = `${graphIdRef.current}-${Math.random().toString(36).slice(2, 9)}`;
        const { svg: renderedSvg } = await mermaid.render(uniqueId, currentChart);

        if (mounted && chartRef.current === currentChart) {
          renderCache.set(currentChart, renderedSvg);
          setSvg(renderedSvg);
          setLoading(false);
        }
      } catch (err) {
        if (mounted && chartRef.current === currentChart) {
          setError(err instanceof Error ? err.message : '流程图渲染失败');
          setLoading(false);
        }
      }
    };

    renderChart();

    return () => {
      mounted = false;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-icon">⚠️</div>
        <div className="mermaid-error-title">流程图渲染失败</div>
        <div className="mermaid-error-message">{error}</div>
        <pre className="mermaid-source">{chart}</pre>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`mermaid-container ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* 全屏按钮 - 仅脑图显示 */}
      {isMindmap && !loading && !error && (
        <button
          className="mermaid-fullscreen-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? "退出全屏" : "全屏查看"}
        >
          {isFullscreen ? '⛶ 退出' : '⛶ 全屏'}
        </button>
      )}
      {loading ? (
        <div className="mermaid-loading">
          <div className="mermaid-loading-spinner"></div>
          <span>渲染流程图...</span>
        </div>
      ) : (
        <div
          className="mermaid-diagram"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
});

MermaidDiagram.displayName = 'MermaidDiagram';

export default MermaidDiagram;
