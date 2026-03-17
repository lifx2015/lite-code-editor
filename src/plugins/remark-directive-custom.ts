/**
 * remark 自定义指令插件
 * 解析 :directive{...} 和 ^directive{...} 语法
 *
 * 基于 unist-util-visit 实现
 */

import { visit } from 'unist-util-visit';
import type { Plugin } from 'unified';
import type { Root, Content, Text, Code, Paragraph } from 'mdast';

// 指令数据类型
export interface DirectiveData {
  directiveName: string;
  directiveArgs: Record<string, unknown>;
  raw: string;
}

/**
 * 解析指令参数字符串
 * 例如: "array=[1,2,3], speed=500, algorithm=\"quick\""
 */
function parseArgs(argsString: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (!argsString.trim()) {
    return result;
  }

  // 改进的参数解析
  const argPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(\[[^\]]*\]|"[^"]*"|'[^']*'|[^,\s]+)/g;
  let match;

  while ((match = argPattern.exec(argsString)) !== null) {
    const key = match[1];
    let value: unknown = match[2];

    // 解析数组
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      try {
        value = JSON.parse(value);
      } catch {
        // 保持原值
      }
    }
    // 解析字符串
    else if (typeof value === 'string' && (value.startsWith('"') || value.startsWith("'"))) {
      value = value.slice(1, -1);
    }
    // 解析数字
    else if (typeof value === 'string' && !isNaN(Number(value))) {
      value = Number(value);
    }
    // 解析布尔值
    else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    }

    result[key] = value;
  }

  return result;
}

/**
 * remark 插件：解析自定义指令
 */
export const remarkDirectiveCustom: Plugin<[], Root> = function () {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || typeof index !== 'number') return;

      // 获取段落文本
      const textNode = node.children[0] as Text | undefined;
      if (!textNode || textNode.type !== 'text') return;

      const text = textNode.value;

      // 匹配 :directive{args} 语法（块级）
      const blockMatch = text.match(/^:([a-zA-Z][a-zA-Z0-9]*)\s*\{([^}]*)\}\s*$/);
      if (blockMatch) {
        const directiveName = blockMatch[1];
        const argsString = blockMatch[2];
        const args = parseArgs(argsString);

        // 在节点上添加 data 属性标记为指令
        // 使用 any 绕过类型检查
        (node as any).data = {
          directiveName,
          directiveArgs: args,
          raw: text,
        };
        return;
      }

      // 匹配 ^directive{args} 或 ^directive(args) 语法（行内）
      const inlinePattern = /\^([a-zA-Z][a-zA-Z0-9]*)\s*[\({]([^}\)]*)[\})]/g;
      let inlineMatch;
      const newChildren: Content[] = [];
      let lastIndex = 0;
      let hasDirective = false;

      while ((inlineMatch = inlinePattern.exec(text)) !== null) {
        hasDirective = true;
        // 添加前面的文本
        if (inlineMatch.index > lastIndex) {
          newChildren.push({
            type: 'text',
            value: text.slice(lastIndex, inlineMatch.index),
          } as Text);
        }

        // 添加指令节点（包装为 text 节点但带 data）
        const directiveName = inlineMatch[1];
        const argsString = inlineMatch[2];
        const args = parseArgs(argsString);

        const textNodeWithDirective: Text = {
          type: 'text',
          value: inlineMatch[0],
        };
        (textNodeWithDirective as any).data = {
          directiveName,
          directiveArgs: args,
          raw: inlineMatch[0],
        };
        newChildren.push(textNodeWithDirective as unknown as Content);

        lastIndex = inlineMatch.index + inlineMatch[0].length;
      }

      // 添加剩余文本
      if (lastIndex < text.length) {
        newChildren.push({
          type: 'text',
          value: text.slice(lastIndex),
        } as Text);
      }

      // 如果有行内指令，替换节点
      if (hasDirective) {
        node.children = newChildren as typeof node.children;
      }
    });

    // 处理代码块指令: ```algorithm sort
    visit(tree, 'code', (node: Code) => {
      if (node.lang === 'algorithm' && node.meta) {
        const directiveName = node.meta.trim();
        const argsString = node.value || '';

        // 解析 YAML 风格的参数
        const args: Record<string, unknown> = {};
        const lines = argsString.split('\n');
        for (const line of lines) {
          const colonMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/);
          if (colonMatch) {
            let value: unknown = colonMatch[2].trim();
            // 尝试解析为 JSON
            try {
              value = JSON.parse(value as string);
            } catch {
              // 保持字符串
            }
            args[colonMatch[1]] = value;
          }
        }

        // 添加指令数据到节点
        (node as any).data = {
          directiveName,
          directiveArgs: args,
          raw: node.value || '',
        };
      }
    });
  };
};

export default remarkDirectiveCustom;