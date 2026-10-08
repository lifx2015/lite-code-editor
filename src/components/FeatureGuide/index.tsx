/**
 * 增强功能面板
 *
 * 列出编辑器的 Markdown 增强能力（可视化组件、图形、嵌入等），
 * 支持分类筛选、关键字搜索、一键复制与插入示例。
 */

import React, { useMemo, useState } from 'react';
import {
  FEATURE_CATALOG,
  FEATURE_CATEGORIES,
  searchFeatures,
  type FeatureCategory,
} from '../../core/feature-catalog';

export interface FeatureGuideProps {
  open: boolean;
  onClose: () => void;
  onInsert: (code: string) => void;
  insertDisabled?: boolean;
}

type CategoryFilter = 'all' | FeatureCategory;

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 回退到 execCommand
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

const FeatureGuide: React.FC<FeatureGuideProps> = ({ open, onClose, onInsert, insertDisabled }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const searched = searchFeatures(query);
    if (category === 'all') return searched;
    return searched.filter((item) => item.category === category);
  }, [query, category]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<CategoryFilter, number>([['all', FEATURE_CATALOG.length]]);
    for (const cat of FEATURE_CATEGORIES) {
      counts.set(cat.id, FEATURE_CATALOG.filter((item) => item.category === cat.id).length);
    }
    return counts;
  }, []);

  if (!open) return null;

  const handleCopy = async (text: string) => {
    const ok = await copyToClipboard(text);
    setCopiedText(ok ? text : null);
    if (ok) {
      window.setTimeout(() => setCopiedText((prev) => (prev === text ? null : prev)), 1500);
    }
  };

  return (
    <div className="feature-guide-overlay" onClick={onClose}>
      <div className="feature-guide" onClick={(e) => e.stopPropagation()}>
        <div className="feature-guide-header">
          <div className="feature-guide-heading">
            <h2>增强功能</h2>
            <span className="feature-guide-count">{FEATURE_CATALOG.length} 项增强能力</span>
          </div>
          <button className="feature-guide-close" onClick={onClose} title="关闭 (Esc)" aria-label="关闭">
            ×
          </button>
        </div>

        <div className="feature-guide-toolbar">
          <input
            className="feature-guide-search"
            type="search"
            placeholder="搜索功能、算法或参数，如：排序 / kmp / 脑图"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="feature-guide-categories">
            <button
              className={`feature-guide-chip ${category === 'all' ? 'active' : ''}`}
              onClick={() => setCategory('all')}
            >
              全部 <span className="chip-count">{categoryCounts.get('all')}</span>
            </button>
            {FEATURE_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                className={`feature-guide-chip ${category === cat.id ? 'active' : ''}`}
                title={cat.description}
                onClick={() => setCategory(cat.id)}
              >
                {cat.label} <span className="chip-count">{categoryCounts.get(cat.id)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="feature-guide-body">
          {filtered.length === 0 && (
            <div className="feature-guide-empty">没有匹配的增强功能，试试其他关键字</div>
          )}

          {filtered.map((item) => {
            const expanded = expandedId === item.id;
            return (
              <div key={item.id} className={`feature-card ${expanded ? 'expanded' : ''}`}>
                <button
                  className="feature-card-head"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  aria-expanded={expanded}
                >
                  <div className="feature-card-title-row">
                    <span className="feature-card-title">{item.title}</span>
                    <span className="feature-card-badge">
                      {FEATURE_CATEGORIES.find((c) => c.id === item.category)?.label}
                    </span>
                    {item.plugin && <span className="feature-card-source">插件</span>}
                    <code className="feature-card-name">
                      {item.kind === 'codeblock'
                        ? '```' + item.id
                        : item.kind === 'tag'
                          ? `<${item.id}>`
                          : `:${item.id}{`}
                    </code>
                  </div>
                  <span className="feature-card-arrow">{expanded ? '▾' : '▸'}</span>
                </button>

                <p className="feature-card-desc">{item.description}</p>

                <div className="feature-syntax">
                  <code>{item.syntax}</code>
                  <button onClick={() => void handleCopy(item.syntax)}>
                    {copiedText === item.syntax ? '已复制' : '复制'}
                  </button>
                </div>

                {expanded && (
                  <div className="feature-card-detail">
                    {item.options && item.options.items.length > 0 && (
                      <div className="feature-section">
                        <h4>{item.options.title}</h4>
                        <div className="feature-options">
                          {item.options.items.map((opt) => (
                            <div key={opt.value} className="feature-option">
                              <code>{opt.value}</code>
                              <span>{opt.label}</span>
                              {opt.note && <em>{opt.note}</em>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.params.length > 0 && (
                      <div className="feature-section">
                        <h4>参数</h4>
                        <table className="feature-params">
                          <thead>
                            <tr>
                              <th>参数</th>
                              <th>类型</th>
                              <th>默认值</th>
                              <th>说明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {item.params.map((p) => (
                              <tr key={p.name}>
                                <td><code>{p.name}</code></td>
                                <td>{p.type}</td>
                                <td>{p.defaultValue ?? '-'}</td>
                                <td>{p.description}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="feature-section">
                      <h4>使用示例</h4>
                      {item.examples.map((ex) => (
                        <div key={ex.code} className="feature-example">
                          <div className="feature-example-label">{ex.label}</div>
                          <pre><code>{ex.code}</code></pre>
                          <div className="feature-example-actions">
                            <button onClick={() => void handleCopy(ex.code)}>
                              {copiedText === ex.code ? '已复制' : '复制'}
                            </button>
                            <button
                              className="primary"
                              disabled={insertDisabled}
                              onClick={() => onInsert(ex.code)}
                            >
                              插入到编辑器
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {item.tips && item.tips.length > 0 && (
                      <div className="feature-section feature-tips">
                        {item.tips.map((tip) => (
                          <p key={tip}>💡 {tip}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="feature-guide-footer">
          在 Markdown 文件中输入指令并切换到「分屏」或「预览」模式即可查看效果。
        </div>
      </div>
    </div>
  );
};

export default FeatureGuide;
