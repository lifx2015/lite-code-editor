/**
 * 字符串匹配可视化组件
 * 支持: 朴素匹配、KMP、Boyer-Moore
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { VisualizerProps } from '../../core/types/directive';

// ============================================
// 类型定义
// ============================================

type MatchAlgorithm = 'naive' | 'kmp' | 'boyer-moore';

interface StringMatchConfig {
  algorithm?: MatchAlgorithm;
  text?: string;
  pattern?: string;
  speed?: number;
}

interface MatchStep {
  text: string;
  pattern: string;
  textIndex: number;
  patternIndex: number;
  compareIndices: number[];
  matchIndices: number[];
  foundIndices: number[];
  description: string;
  // KMP 特有
  lpsTable?: number[];
  currentLps?: number;
  // Boyer-Moore 特有
  badCharTable?: Record<string, number>;
  goodSuffixShift?: number;
}

// ============================================
// 字符串匹配算法
// ============================================

// 朴素匹配
function* naiveMatch(text: string, pattern: string): Generator<MatchStep> {
  const n = text.length;
  const m = pattern.length;
  const foundIndices: number[] = [];

  yield {
    text,
    pattern,
    textIndex: 0,
    patternIndex: 0,
    compareIndices: [],
    matchIndices: [],
    foundIndices: [],
    description: `开始朴素匹配：在文本中查找模式 "${pattern}"`,
  };

  for (let i = 0; i <= n - m; i++) {
    let j = 0;
    const matchIndices: number[] = [];

    yield {
      text,
      pattern,
      textIndex: i,
      patternIndex: 0,
      compareIndices: [],
      matchIndices: [],
      foundIndices: [...foundIndices],
      description: `尝试从位置 ${i} 开始匹配`,
    };

    while (j < m) {
      yield {
        text,
        pattern,
        textIndex: i + j,
        patternIndex: j,
        compareIndices: [i + j],
        matchIndices: [...matchIndices],
        foundIndices: [...foundIndices],
        description: `比较 text[${i + j}]='${text[i + j]}' 与 pattern[${j}]='${pattern[j]}'`,
      };

      if (text[i + j] === pattern[j]) {
        matchIndices.push(i + j);
        j++;
      } else {
        yield {
          text,
          pattern,
          textIndex: i + j,
          patternIndex: j,
          compareIndices: [i + j],
          matchIndices: [...matchIndices],
          foundIndices: [...foundIndices],
          description: `不匹配！text[${i + j}]='${text[i + j]}' ≠ pattern[${j}]='${pattern[j]}'，移动到下一位置`,
        };
        break;
      }
    }

    if (j === m) {
      foundIndices.push(i);
      yield {
        text,
        pattern,
        textIndex: i,
        patternIndex: 0,
        compareIndices: [],
        matchIndices: Array.from({ length: m }, (_, k) => i + k),
        foundIndices: [...foundIndices],
        description: `✓ 在位置 ${i} 找到匹配！`,
      };
    }
  }

  yield {
    text,
    pattern,
    textIndex: n,
    patternIndex: m,
    compareIndices: [],
    matchIndices: [],
    foundIndices: [...foundIndices],
    description: foundIndices.length > 0
      ? `匹配完成，共找到 ${foundIndices.length} 个匹配`
      : '匹配完成，未找到匹配',
  };
}

// KMP 算法
function computeLPS(pattern: string): number[] {
  const m = pattern.length;
  const lps = new Array(m).fill(0);
  let len = 0;
  let i = 1;

  while (i < m) {
    if (pattern[i] === pattern[len]) {
      len++;
      lps[i] = len;
      i++;
    } else {
      if (len !== 0) {
        len = lps[len - 1];
      } else {
        lps[i] = 0;
        i++;
      }
    }
  }

  return lps;
}

function* kmpMatch(text: string, pattern: string): Generator<MatchStep> {
  const n = text.length;
  const m = pattern.length;
  const lps = computeLPS(pattern);
  const foundIndices: number[] = [];

  yield {
    text,
    pattern,
    textIndex: 0,
    patternIndex: 0,
    compareIndices: [],
    matchIndices: [],
    foundIndices: [],
    lpsTable: lps,
    description: `KMP 算法：计算部分匹配表 (LPS)`,
  };

  let i = 0;
  let j = 0;

  yield {
    text,
    pattern,
    textIndex: i,
    patternIndex: j,
    compareIndices: [],
    matchIndices: [],
    foundIndices: [],
    lpsTable: lps,
    currentLps: lps[j],
    description: `开始匹配，i=${i}, j=${j}`,
  };

  while (i < n) {
    yield {
      text,
      pattern,
      textIndex: i,
      patternIndex: j,
      compareIndices: [i],
      matchIndices: [],
      foundIndices: [...foundIndices],
      lpsTable: lps,
      currentLps: lps[j],
      description: `比较 text[${i}]='${text[i]}' 与 pattern[${j}]='${pattern[j]}'`,
    };

    if (pattern[j] === text[i]) {
      i++;
      j++;
    }

    if (j === m) {
      foundIndices.push(i - j);
      yield {
        text,
        pattern,
        textIndex: i - 1,
        patternIndex: j - 1,
        compareIndices: [],
        matchIndices: Array.from({ length: m }, (_, k) => i - j + k),
        foundIndices: [...foundIndices],
        lpsTable: lps,
        description: `✓ 在位置 ${i - j} 找到匹配！`,
      };
      j = lps[j - 1];
    } else if (i < n && pattern[j] !== text[i]) {
      if (j !== 0) {
        yield {
          text,
          pattern,
          textIndex: i,
          patternIndex: j,
          compareIndices: [i],
          matchIndices: [],
          foundIndices: [...foundIndices],
          lpsTable: lps,
          currentLps: lps[j - 1],
          description: `不匹配！利用 LPS 表跳过 ${j - lps[j - 1]} 个字符`,
        };
        j = lps[j - 1];
      } else {
        yield {
          text,
          pattern,
          textIndex: i,
          patternIndex: j,
          compareIndices: [i],
          matchIndices: [],
          foundIndices: [...foundIndices],
          lpsTable: lps,
          description: `不匹配且 j=0，移动文本指针`,
        };
        i++;
      }
    }
  }

  yield {
    text,
    pattern,
    textIndex: n,
    patternIndex: j,
    compareIndices: [],
    matchIndices: [],
    foundIndices: [...foundIndices],
    lpsTable: lps,
    description: foundIndices.length > 0
      ? `KMP 匹配完成，共找到 ${foundIndices.length} 个匹配`
      : 'KMP 匹配完成，未找到匹配',
  };
}

// Boyer-Moore 算法（简化版：坏字符规则）
function computeBadCharTable(pattern: string): Record<string, number> {
  const table: Record<string, number> = {};
  const m = pattern.length;

  for (let i = 0; i < m - 1; i++) {
    table[pattern[i]] = m - 1 - i;
  }

  return table;
}

function* boyerMooreMatch(text: string, pattern: string): Generator<MatchStep> {
  const n = text.length;
  const m = pattern.length;
  const badCharTable = computeBadCharTable(pattern);
  const foundIndices: number[] = [];

  yield {
    text,
    pattern,
    textIndex: m - 1,
    patternIndex: m - 1,
    compareIndices: [],
    matchIndices: [],
    foundIndices: [],
    badCharTable,
    description: `Boyer-Moore 算法：构建坏字符表`,
  };

  let i = m - 1;

  while (i < n) {
    let j = m - 1;
    const matchIndices: number[] = [];

    yield {
      text,
      pattern,
      textIndex: i,
      patternIndex: j,
      compareIndices: [],
      matchIndices: [],
      foundIndices: [...foundIndices],
      badCharTable,
      description: `从右向左检查，起始位置 ${i - m + 1}`,
    };

    while (j >= 0 && text[i - (m - 1 - j)] === pattern[j]) {
      matchIndices.unshift(i - (m - 1 - j));
      j--;
    }

    if (j < 0) {
      foundIndices.push(i - m + 1);
      yield {
        text,
        pattern,
        textIndex: i,
        patternIndex: 0,
        compareIndices: [],
        matchIndices: Array.from({ length: m }, (_, k) => i - m + 1 + k),
        foundIndices: [...foundIndices],
        badCharTable,
        description: `✓ 在位置 ${i - m + 1} 找到匹配！`,
      };
      i += m;
    } else {
      const badChar = text[i - (m - 1 - j)];
      const shift = badCharTable[badChar] || m;

      yield {
        text,
        pattern,
        textIndex: i - (m - 1 - j),
        patternIndex: j,
        compareIndices: [i - (m - 1 - j)],
        matchIndices: [...matchIndices],
        foundIndices: [...foundIndices],
        badCharTable,
        description: `坏字符 '${badChar}'，查表得移动 ${shift} 位`,
      };

      i += Math.max(1, shift);
    }
  }

  yield {
    text,
    pattern,
    textIndex: n,
    patternIndex: 0,
    compareIndices: [],
    matchIndices: [],
    foundIndices: [...foundIndices],
    badCharTable,
    description: foundIndices.length > 0
      ? `Boyer-Moore 匹配完成，共找到 ${foundIndices.length} 个匹配`
      : 'Boyer-Moore 匹配完成，未找到匹配',
  };
}

// ============================================
// 主组件
// ============================================

const StringMatchVisualizer: React.FC<VisualizerProps<StringMatchConfig>> = ({ args, onStateChange }) => {
  const {
    algorithm = 'kmp',
    text = 'ABABDABACDABABCABAB',
    pattern = 'ABABCABAB',
    speed = 500,
  } = args || {};

  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [currentPatternIndex, setCurrentPatternIndex] = useState(0);
  const [compareIndices, setCompareIndices] = useState<number[]>([]);
  const [matchIndices, setMatchIndices] = useState<number[]>([]);
  const [foundIndices, setFoundIndices] = useState<number[]>([]);
  const [lpsTable, setLpsTable] = useState<number[]>([]);
  const [description, setDescription] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);

  const stepsRef = useRef<MatchStep[]>([]);
  const animationRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 生成步骤
  const generateSteps = useCallback(() => {
    const steps: MatchStep[] = [];
    let generator: Generator<MatchStep>;

    switch (algorithm) {
      case 'naive':
        generator = naiveMatch(text, pattern);
        break;
      case 'kmp':
        generator = kmpMatch(text, pattern);
        break;
      case 'boyer-moore':
        generator = boyerMooreMatch(text, pattern);
        break;
      default:
        generator = kmpMatch(text, pattern);
    }

    let result = generator.next();
    while (!result.done) {
      steps.push(result.value);
      result = generator.next();
    }

    return steps;
  }, [text, pattern, algorithm]);

  // 初始化
  useEffect(() => {
    const steps = generateSteps();
    stepsRef.current = steps;
    setTotalSteps(steps.length);
    setCurrentStep(0);
    setCompareIndices([]);
    setMatchIndices([]);
    setFoundIndices([]);
    setDescription('');
    setLpsTable([]);
    setIsPlaying(false);
    onStateChange?.({ status: 'idle', totalSteps: steps.length });
  }, [text, pattern, algorithm, generateSteps, onStateChange]);

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
      setCurrentTextIndex(stepData.textIndex);
      setCurrentPatternIndex(stepData.patternIndex);
      setCompareIndices(stepData.compareIndices);
      setMatchIndices(stepData.matchIndices);
      setFoundIndices(stepData.foundIndices);
      setDescription(stepData.description);
      if (stepData.lpsTable) setLpsTable(stepData.lpsTable);
      setCurrentStep(currentStep + 1);

      if (currentStep + 1 >= totalSteps) {
        setIsPlaying(false);
        onStateChange?.({ status: 'completed', currentStep: currentStep + 1, totalSteps });
      }
    }
  }, [currentStep, totalSteps, onStateChange]);

  const reset = useCallback(() => {
    setIsPlaying(false);
    setCurrentStep(0);
    setCompareIndices([]);
    setMatchIndices([]);
    setFoundIndices([]);
    setDescription('');
    setLpsTable([]);
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

  const getCharColor = (index: number) => {
    if (foundIndices.some(start => index >= start && index < start + pattern.length)) {
      return '#22c55e'; // 已找到的匹配
    }
    if (matchIndices.includes(index)) {
      return '#22c55e'; // 当前匹配中
    }
    if (compareIndices.includes(index)) {
      return '#eab308'; // 正在比较
    }
    return 'var(--text-primary)';
  };

  const algorithmNames: Record<MatchAlgorithm, string> = {
    'naive': '朴素匹配',
    'kmp': 'KMP 算法',
    'boyer-moore': 'Boyer-Moore',
  };

  return (
    <div className="stringmatch-visualizer">
      {/* 控制栏 */}
      <div className="visualizer-controls">
        <button onClick={isPlaying ? pause : play} className="control-btn">
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

      {/* 文本显示 */}
      <div className="stringmatch-text-container">
        <div className="stringmatch-label">文本:</div>
        <div className="stringmatch-text">
          {text.split('').map((char, idx) => (
            <span
              key={idx}
              className={`stringmatch-char ${compareIndices.includes(idx) ? 'comparing' : ''} ${matchIndices.includes(idx) ? 'matching' : ''}`}
              style={{ color: getCharColor(idx) }}
            >
              {char}
            </span>
          ))}
        </div>
        <div className="stringmatch-indices">
          {text.split('').map((_, idx) => (
            <span key={idx} className="stringmatch-index">{idx}</span>
          ))}
        </div>
      </div>

      {/* 模式显示 */}
      <div className="stringmatch-pattern-container">
        <div className="stringmatch-label">模式:</div>
        <div className="stringmatch-pattern" style={{ marginLeft: `${currentTextIndex - currentPatternIndex}ch` }}>
          {pattern.split('').map((char, idx) => (
            <span
              key={idx}
              className={`stringmatch-char ${idx === currentPatternIndex ? 'current' : ''}`}
              style={{ color: getCharColor(currentTextIndex - currentPatternIndex + idx) }}
            >
              {char}
            </span>
          ))}
        </div>
      </div>

      {/* LPS 表 (KMP) */}
      {algorithm === 'kmp' && lpsTable.length > 0 && (
        <div className="stringmatch-lps-container">
          <div className="stringmatch-label">LPS 表:</div>
          <div className="stringmatch-lps">
            {lpsTable.map((val, idx) => (
              <span
                key={idx}
                className={`lps-value ${idx === currentPatternIndex ? 'current' : ''}`}
              >
                {val}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 描述 */}
      {description && (
        <div className="visualizer-description">{description}</div>
      )}

      {/* 信息 */}
      <div className="visualizer-info">
        <span>算法: {algorithmNames[algorithm]}</span>
        <span>文本长度: {text.length}</span>
        <span>模式长度: {pattern.length}</span>
        <span>匹配数: {foundIndices.length}</span>
      </div>
    </div>
  );
};

export default StringMatchVisualizer;