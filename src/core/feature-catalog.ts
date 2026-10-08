/**
 * 增强功能目录
 *
 * 集中描述编辑器的 Markdown 增强能力（可视化组件、图形、嵌入等），
 * 供「增强功能」面板展示使用示例，方便快速查阅与插入。
 */

export type FeatureCategory =
  | 'algorithm'
  | 'datastructure'
  | 'chart'
  | 'diagram'
  | 'embed'
  | 'external';

export interface FeatureCategoryMeta {
  id: FeatureCategory;
  label: string;
  description: string;
}

export interface FeatureParam {
  name: string;
  type: string;
  defaultValue?: string;
  description: string;
}

export interface FeatureOption {
  value: string;
  label: string;
  note?: string;
}

export interface FeatureExample {
  label: string;
  code: string;
}

export interface FeatureItem {
  id: string;
  title: string;
  category: FeatureCategory;
  description: string;
  syntax: string;
  keywords: string[];
  /** 触发方式，决定卡片角标显示：directive => `:id{`，codeblock => ```id，tag => <id> */
  kind?: 'directive' | 'codeblock' | 'tag';
  /** 是否由「外部插件」目录提供（用于卡片上的「插件」标记） */
  plugin?: boolean;
  params: FeatureParam[];
  options?: {
    title: string;
    items: FeatureOption[];
  };
  examples: FeatureExample[];
  tips?: string[];
}

export const FEATURE_CATEGORIES: FeatureCategoryMeta[] = [
  { id: 'algorithm', label: '算法', description: '排序、查找、图、字符串匹配' },
  { id: 'datastructure', label: '数据结构', description: '树、堆、栈、队列、链表、哈希表' },
  { id: 'chart', label: '图表', description: '数据曲线图' },
  { id: 'diagram', label: '图形', description: '脑图与 Mermaid 流程图' },
  { id: 'embed', label: '嵌入', description: '在文档中嵌入网页内容' },
  { id: 'external', label: '示例插件', description: '插件目录中加载的自定义插件示例' },
];

export const FEATURE_CATALOG: FeatureItem[] = [
  // ============================================
  // 算法
  // ============================================
  {
    id: 'sort',
    plugin: true,
    title: '排序算法可视化',
    category: 'algorithm',
    description: '以动画方式展示排序过程的比较与交换，所有算法均带默认数组。',
    syntax: ':sort{algorithm="bubble" array=[5,2,8,1,9,3,7,4,6] speed=300}',
    keywords: ['排序', 'sort', '冒泡', '快速', '归并', '插入', '选择', 'bubble', 'quick', 'merge'],
    options: {
      title: '算法',
      items: [
        { value: 'bubble', label: '冒泡排序', note: 'O(n²)' },
        { value: 'quick', label: '快速排序', note: 'O(n log n)' },
        { value: 'merge', label: '归并排序', note: 'O(n log n)' },
        { value: 'insertion', label: '插入排序', note: 'O(n²)' },
        { value: 'selection', label: '选择排序', note: 'O(n²)' },
      ],
    },
    params: [
      { name: 'algorithm', type: 'string', defaultValue: '"bubble"', description: '排序算法类型' },
      { name: 'array', type: 'number[]', defaultValue: '[5,2,8,1,9,3,7,4,6]', description: '待排序数组' },
      { name: 'speed', type: 'number', defaultValue: '300', description: '动画速度（毫秒）' },
      { name: 'showSteps', type: 'boolean', defaultValue: 'true', description: '是否显示步骤说明' },
    ],
    examples: [
      { label: '冒泡排序（默认数组）', code: ':sort{algorithm="bubble"}' },
      { label: '快速排序 + 自定义数组', code: ':sort{algorithm="quick" array=[10,7,8,9,1,5] speed=200}' },
      { label: '归并排序', code: ':sort{algorithm="merge"}' },
    ],
  },
  {
    id: 'search',
    plugin: true,
    title: '查找算法可视化',
    category: 'algorithm',
    description: '展示线性查找、二分查找、插值查找的搜索过程。',
    syntax: ':search{algorithm="binary" target=13}',
    keywords: ['查找', '搜索', 'search', '线性', '二分', '插值', 'binary', 'linear'],
    options: {
      title: '算法',
      items: [
        { value: 'linear', label: '线性查找', note: '适用于无序数组' },
        { value: 'binary', label: '二分查找', note: '要求数组有序' },
        { value: 'interpolation', label: '插值查找', note: '要求数组有序且分布均匀' },
      ],
    },
    params: [
      { name: 'algorithm', type: 'string', defaultValue: '"binary"', description: '查找算法类型' },
      { name: 'target', type: 'number', defaultValue: '13', description: '要查找的目标值' },
      { name: 'array', type: 'number[]', defaultValue: '有序数组', description: '查找数组（二分/插值需有序）' },
      { name: 'speed', type: 'number', defaultValue: '500', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '二分查找', code: ':search{algorithm="binary" target=13}' },
      { label: '线性查找', code: ':search{algorithm="linear" target=7 array=[5,3,8,1,9,7,2]}' },
      { label: '插值查找', code: ':search{algorithm="interpolation" target=50 array=[10,20,30,40,50,60,70,80,90]}' },
    ],
  },
  {
    id: 'graph',
    plugin: true,
    title: '图算法可视化',
    category: 'algorithm',
    description: '展示图的遍历、最短路径与最小生成树算法。默认提供 6 节点 9 边的图结构，无需自定义数据。',
    syntax: ':graph{algorithm="dijkstra" startNode="A"}',
    keywords: ['图', 'graph', 'bfs', 'dfs', 'dijkstra', 'kruskal', 'prim', '最短路径', '最小生成树'],
    options: {
      title: '算法',
      items: [
        { value: 'bfs', label: '广度优先搜索', note: '层级遍历' },
        { value: 'dfs', label: '深度优先搜索', note: '路径探索' },
        { value: 'dijkstra', label: 'Dijkstra', note: '单源最短路径（带权）' },
        { value: 'kruskal', label: 'Kruskal', note: '最小生成树' },
        { value: 'prim', label: 'Prim', note: '最小生成树' },
      ],
    },
    params: [
      { name: 'algorithm', type: 'string', defaultValue: '"bfs"', description: '图算法类型' },
      { name: 'startNode', type: 'string', defaultValue: '"A"', description: '起始节点 ID' },
      { name: 'nodes', type: 'object[]', defaultValue: '预设 6 个节点', description: '节点列表（可选）' },
      { name: 'edges', type: 'object[]', defaultValue: '预设 9 条边', description: '边列表（可选）' },
      { name: 'speed', type: 'number', defaultValue: '800', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '广度优先搜索', code: ':graph{algorithm="bfs"}' },
      { label: 'Dijkstra', code: ':graph{algorithm="dijkstra" startNode="A"}' },
      { label: 'Prim 最小生成树', code: ':graph{algorithm="prim"}' },
      {
        label: '自定义图结构',
        code: ':graph{algorithm="dijkstra" startNode="1" nodes=[{id="1"},{id="2"},{id="3"}] edges=[{from="1",to="2",weight=5},{from="2",to="3",weight=3}]}',
      },
    ],
  },
  {
    id: 'stringmatch',
    plugin: true,
    title: '字符串匹配可视化',
    category: 'algorithm',
    description: '对比朴素匹配、KMP 与 Boyer-Moore 的字符串查找过程。',
    syntax: ':stringmatch{algorithm="kmp" text="ABABDABACDABABCABAB" pattern="ABABCABAB"}',
    keywords: ['字符串', '匹配', 'stringmatch', 'kmp', 'boyer', 'naive', '朴素'],
    options: {
      title: '算法',
      items: [
        { value: 'naive', label: '朴素匹配', note: '逐位尝试' },
        { value: 'kmp', label: 'KMP', note: '部分匹配表跳转' },
        { value: 'boyer-moore', label: 'Boyer-Moore', note: '坏字符规则' },
      ],
    },
    params: [
      { name: 'algorithm', type: 'string', defaultValue: '"kmp"', description: '匹配算法' },
      { name: 'text', type: 'string', defaultValue: '"ABABDABACDABABCABAB"', description: '被搜索的文本' },
      { name: 'pattern', type: 'string', defaultValue: '"ABABCABAB"', description: '要查找的模式串' },
      { name: 'speed', type: 'number', defaultValue: '500', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: 'KMP（默认）', code: ':stringmatch{}' },
      { label: '朴素匹配', code: ':stringmatch{algorithm="naive" text="ABCDEFG" pattern="CDE"}' },
      { label: 'Boyer-Moore', code: ':stringmatch{algorithm="boyer-moore" text="HEREISASIMPLEEXAMPLE" pattern="EXAMPLE"}' },
    ],
  },

  // ============================================
  // 数据结构
  // ============================================
  {
    id: 'tree',
    plugin: true,
    title: '树结构可视化',
    category: 'datastructure',
    description: '展示二叉树、二叉搜索树、AVL 树与红黑树的插入与查找过程。',
    syntax: ':tree{type="bst" values=[50,30,70,20,40,60,80]}',
    keywords: ['树', 'tree', '二叉树', 'bst', 'avl', '红黑树', 'redblack'],
    options: {
      title: '树类型',
      items: [
        { value: 'binary', label: '二叉树' },
        { value: 'bst', label: '二叉搜索树' },
        { value: 'avl', label: 'AVL 树', note: '自平衡' },
        { value: 'redblack', label: '红黑树', note: '自平衡' },
      ],
    },
    params: [
      { name: 'type', type: 'string', defaultValue: '"bst"', description: '树类型' },
      { name: 'values', type: 'number[]', defaultValue: '[50,30,70,20,40,60,80]', description: '初始节点值' },
      { name: 'insertValue', type: 'number', defaultValue: '随机', description: '要插入的值' },
      { name: 'searchValue', type: 'number', defaultValue: '随机', description: '要搜索的值' },
      { name: 'speed', type: 'number', defaultValue: '800', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '二叉搜索树', code: ':tree{type="bst"}' },
      { label: '红黑树', code: ':tree{type="redblack"}' },
      { label: 'AVL 树 + 指定插入值', code: ':tree{type="avl" insertValue=25}' },
    ],
  },
  {
    id: 'heap',
    plugin: true,
    title: '堆可视化',
    category: 'datastructure',
    description: '展示最大堆 / 最小堆的插入与移除堆顶操作。',
    syntax: ':heap{type="max" values=[50,30,70,20,40,60,80,10,25]}',
    keywords: ['堆', 'heap', '最大堆', '最小堆', '优先队列'],
    options: {
      title: '堆类型',
      items: [
        { value: 'max', label: '最大堆', note: '父 ≥ 子' },
        { value: 'min', label: '最小堆', note: '父 ≤ 子' },
      ],
    },
    params: [
      { name: 'type', type: 'string', defaultValue: '"max"', description: '堆类型' },
      { name: 'values', type: 'number[]', defaultValue: '[50,30,70,20,40,60,80,10,25]', description: '初始元素' },
      { name: 'insertValue', type: 'number', defaultValue: '随机', description: '要插入的值' },
      { name: 'speed', type: 'number', defaultValue: '600', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '最大堆', code: ':heap{}' },
      { label: '最小堆', code: ':heap{type="min"}' },
      { label: '自定义数据', code: ':heap{type="max" values=[100,50,75,25,60]}' },
    ],
  },
  {
    id: 'stack',
    plugin: true,
    title: '栈可视化（LIFO）',
    category: 'datastructure',
    description: '展示栈的压入（Push）、弹出（Pop）与查看栈顶（Peek）操作。',
    syntax: ':stack{values=[10,20,30,40,50]}',
    keywords: ['栈', 'stack', 'lifo', '后进先出', 'push', 'pop'],
    params: [
      { name: 'values', type: 'number[]', defaultValue: '[10,20,30,40,50]', description: '初始元素' },
      { name: 'pushValue', type: 'number', defaultValue: '随机', description: '要压入的值' },
      { name: 'speed', type: 'number', defaultValue: '500', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '默认栈', code: ':stack{}' },
      { label: '自定义数据', code: ':stack{values=[1,2,3,4,5]}' },
    ],
  },
  {
    id: 'queue',
    plugin: true,
    title: '队列可视化（FIFO）',
    category: 'datastructure',
    description: '展示队列的入队（Enqueue）、出队（Dequeue）与查看队头（Peek）操作。',
    syntax: ':queue{values=[10,20,30,40,50]}',
    keywords: ['队列', 'queue', 'fifo', '先进先出', 'enqueue', 'dequeue'],
    params: [
      { name: 'values', type: 'number[]', defaultValue: '[10,20,30,40,50]', description: '初始元素' },
      { name: 'pushValue', type: 'number', defaultValue: '随机', description: '要入队的值' },
      { name: 'speed', type: 'number', defaultValue: '500', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '默认队列', code: ':queue{}' },
      { label: '自定义数据', code: ':queue{values=[100,200,300]}' },
    ],
  },
  {
    id: 'linkedlist',
    plugin: true,
    title: '链表可视化',
    category: 'datastructure',
    description: '展示单链表、双链表、环形链表的遍历、搜索、插入与删除。',
    syntax: ':linkedlist{type="singly" values=[10,20,30,40,50]}',
    keywords: ['链表', 'linkedlist', '单链表', '双链表', '环形', 'singly', 'doubly', 'circular'],
    options: {
      title: '链表类型',
      items: [
        { value: 'singly', label: '单链表' },
        { value: 'doubly', label: '双链表' },
        { value: 'circular', label: '环形链表' },
      ],
    },
    params: [
      { name: 'type', type: 'string', defaultValue: '"singly"', description: '链表类型' },
      { name: 'values', type: 'number[]', defaultValue: '[10,20,30,40,50]', description: '初始节点值' },
      { name: 'insertValue', type: 'number', defaultValue: '随机', description: '要插入的值' },
      { name: 'searchValue', type: 'number', defaultValue: '随机', description: '要搜索的值' },
      { name: 'deleteValue', type: 'number', defaultValue: '随机', description: '要删除的值' },
      { name: 'speed', type: 'number', defaultValue: '500', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '单链表', code: ':linkedlist{}' },
      { label: '双链表', code: ':linkedlist{type="doubly"}' },
      { label: '环形链表', code: ':linkedlist{type="circular" values=[1,2,3,4,5]}' },
    ],
  },
  {
    id: 'hashtable',
    plugin: true,
    title: '哈希表可视化',
    category: 'datastructure',
    description: '展示哈希表的插入与查找，以及链地址法、线性探测、二次探测等冲突解决策略。',
    syntax: ':hashtable{method="chaining" size=8}',
    keywords: ['哈希表', 'hashtable', '散列表', '链地址', '线性探测', '二次探测', 'chaining'],
    options: {
      title: '冲突解决方法',
      items: [
        { value: 'chaining', label: '链地址法' },
        { value: 'linear', label: '线性探测' },
        { value: 'quadratic', label: '二次探测' },
      ],
    },
    params: [
      { name: 'method', type: 'string', defaultValue: '"chaining"', description: '冲突解决方法' },
      { name: 'size', type: 'number', defaultValue: '8', description: '哈希表容量' },
      { name: 'items', type: 'object[]', defaultValue: '示例键值对', description: '初始键值对' },
      { name: 'insertKey', type: 'string', defaultValue: '随机', description: '要插入的键' },
      { name: 'insertValue', type: 'number', defaultValue: '随机', description: '要插入的值' },
      { name: 'searchKey', type: 'string', defaultValue: '随机', description: '要搜索的键' },
      { name: 'speed', type: 'number', defaultValue: '600', description: '动画速度（毫秒）' },
    ],
    examples: [
      { label: '链地址法', code: ':hashtable{}' },
      { label: '线性探测', code: ':hashtable{method="linear" size=10}' },
      {
        label: '自定义键值对',
        code: ':hashtable{method="chaining" items=[{key="apple",value=5},{key="banana",value=8}]}',
      },
    ],
  },

  // ============================================
  // 图表
  // ============================================
  {
    id: 'chart',
    plugin: true,
    title: '曲线图',
    category: 'chart',
    description: '绘制单系列或多系列数据曲线，支持鼠标悬停查看数值。',
    syntax: ':chart{title="销售趋势" data=[10,25,18,32,28,45] labels=["一月","二月","三月","四月","五月","六月"]}',
    keywords: ['图表', '曲线', 'chart', '数据', '折线', '多系列'],
    params: [
      { name: 'title', type: 'string', description: '图表标题' },
      { name: 'data', type: 'number[] | object[]', description: '数据（必填）' },
      { name: 'labels', type: 'string[]', defaultValue: '["1","2",...]', description: 'X 轴标签' },
      { name: 'width', type: 'number', defaultValue: '400', description: '图表宽度' },
      { name: 'height', type: 'number', defaultValue: '200', description: '图表高度' },
      { name: 'showGrid', type: 'boolean', defaultValue: 'true', description: '是否显示网格' },
      { name: 'showDots', type: 'boolean', defaultValue: 'true', description: '是否显示数据点' },
    ],
    examples: [
      {
        label: '单系列',
        code: ':chart{title="销售趋势" data=[10,25,18,32,28,45] labels=["一月","二月","三月","四月","五月","六月"]}',
      },
      {
        label: '多系列对比',
        code: ':chart{title="对比分析" data=[{values=[10,20,30,40],label="产品A"},{values=[15,25,20,35],label="产品B",color="#16a34a"}] labels=["Q1","Q2","Q3","Q4"]}',
      },
    ],
  },

  // ============================================
  // 图形
  // ============================================
  {
    id: 'mindmap',
    plugin: true,
    title: '脑图（思维导图）',
    category: 'diagram',
    description: '使用缩进表示层级关系，自动生成可交互的思维导图。使用 ```mindmap 代码块。',
    syntax: '```mindmap\n根节点\n  子节点 A\n    叶子节点\n  子节点 B\n```',
    keywords: ['脑图', '思维导图', 'mindmap', '导图'],
    params: [
      { name: '缩进', type: '空格/制表符', description: '每 2 个空格或 1 个制表符为一级' },
      { name: '首行', type: 'string', description: '根节点文案' },
    ],
    examples: [
      {
        label: '项目规划脑图',
        code: '```mindmap\n项目规划\n  需求分析\n    用户调研\n    竞品分析\n  设计\n    UI 设计\n    交互设计\n  开发\n  测试\n```',
      },
    ],
    tips: ['直接书写 Markdown 的代码块语言标注为 mindmap 即可。'],
  },
  {
    id: 'mermaid',
    kind: 'codeblock',
    title: 'Mermaid 图形',
    category: 'diagram',
    description: '使用 Mermaid 语法绘制流程图、时序图、甘特图等。使用 ```mermaid 代码块。',
    syntax: '```mermaid\nflowchart TD\n  A[开始] --> B{判断}\n  B -- 是 --> C[执行]\n  B -- 否 --> D[结束]\n```',
    keywords: ['流程图', 'mermaid', '时序图', '甘特图', '状态图', 'diagram'],
    params: [
      { name: '语言标注', type: 'string', description: '代码块语言必须是 mermaid' },
      { name: '图表类型', type: 'string', description: 'flowchart / sequenceDiagram / gantt / stateDiagram 等' },
    ],
    examples: [
      {
        label: '流程图',
        code: '```mermaid\nflowchart TD\n  A[开始] --> B{条件判断}\n  B -- 是 --> C[执行操作]\n  B -- 否 --> D[结束]\n```',
      },
      {
        label: '时序图',
        code: '```mermaid\nsequenceDiagram\n  participant U as 用户\n  participant S as 服务端\n  U->>S: 发起请求\n  S-->>U: 返回响应\n```',
      },
    ],
    tips: ['Mermaid 由 mermaid 库渲染，图表内容随主题自动适配。'],
  },

  // ============================================
  // 嵌入
  // ============================================
  {
    id: 'iframe',
    kind: 'tag',
    title: '网页嵌入（iframe）',
    category: 'embed',
    description: '在 Markdown 中直接使用 <iframe> 标签嵌入网页，默认带工具栏可切换默认 / 标准 / 全屏三种显示模式（Esc 退出全屏）。',
    syntax: '<iframe src="https://example.com" title="示例"></iframe>',
    keywords: ['iframe', '嵌入', '网页', 'embed', '全屏'],
    params: [
      { name: 'src', type: 'string', description: '要嵌入的网页地址（必填）' },
      { name: 'width', type: 'number | string', description: '宽度（未指定时使用 16:9 自适应）' },
      { name: 'height', type: 'number | string', description: '高度（未指定时使用 16:9 自适应）' },
      { name: 'title', type: 'string', description: '无障碍标题' },
      { name: 'sandbox', type: 'string', description: '沙箱策略，默认允许脚本与同源' },
    ],
    examples: [
      { label: '自适应嵌入', code: '<iframe src="https://example.com" title="示例页面"></iframe>' },
      { label: '指定尺寸', code: '<iframe src="https://example.com" width="800" height="450"></iframe>' },
    ],
    tips: ['出于安全考虑，外部页面运行在沙箱中；点击「全屏」可沉浸查看，按 Esc 退出。'],
  },

  // ============================================
  // 外部插件
  // ============================================
  {
    id: 'counter',
    plugin: true,
    title: '计数器（示例插件）',
    category: 'external',
    description: '位于 plugins/example-counter 的示例外部插件，用于演示自定义指令的加载方式。插件会随「插件」目录自动加载，无需重新打包。',
    syntax: ':counter{initialValue=10 step=5 min=0 max=100}',
    keywords: ['计数器', 'counter', '插件', 'plugin', '外部'],
    params: [
      { name: 'initialValue', type: 'number', defaultValue: '0', description: '计数器初始值' },
      { name: 'step', type: 'number', defaultValue: '1', description: '每次增减的步长' },
      { name: 'min', type: 'number', defaultValue: '-100', description: '最小值' },
      { name: 'max', type: 'number', defaultValue: '100', description: '最大值' },
    ],
    examples: [
      { label: '默认计数器', code: ':counter{initialValue=10 step=5}' },
      { label: '限定范围', code: ':counter{min=0 max=50 step=2}' },
    ],
    tips: ['可在插件目录放置自定义插件，插件通过 plugin.json 声明指令后即可在 Markdown 中调用。'],
  },
];

/**
 * 按关键字过滤功能（匹配标题、描述、关键字、示例代码与参数名）。
 */
export function searchFeatures(query: string): FeatureItem[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return FEATURE_CATALOG;

  return FEATURE_CATALOG.filter((item) => {
    const haystack = [
      item.title,
      item.description,
      item.syntax,
      ...item.keywords,
      ...item.params.map((p) => `${p.name} ${p.description}`),
      ...item.examples.map((e) => `${e.label} ${e.code}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(keyword);
  });
}
