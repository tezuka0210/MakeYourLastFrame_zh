// src/lib/workflowLayout.ts
// import App from '@/App.vue'
// import type { AppNode } from '@/composables/useWorkflow'

// 三种卡片类型（后面可以再细分）
export type CardType =
  | 'init'
  | 'textFull'
  | 'audio'
  | 'io'
  | 'composite'
  | 'AddWorkflow'
  | 'TextImage'

export interface AssetMedia {
  rawPath: string
  url: string
  type: 'image' | 'video' | 'audio'
  source: 'input' | 'output'
}

// D3 实际使用的节点结构 = AppNode + UI 元数据
export interface ViewNode extends AppNode {
  cardType: CardType
  title: string          // 卡片标题栏显示的文字
  isInit: boolean        // 是否是根/初始卡
}

export interface AppNode {
  id: string;
  originalParents: string[] | null;
  module_id: string;
  created_at: string;
  status: string;
  media: AssetMedia[] | null;
  linkColor?: string;
  _collapsed?: boolean;
  parameters: Record<string, any> | null;

  childrenIds?: string[];
  isComposite?: boolean;
  isVirtualGroup?: boolean;
  sourceNodeIds?: string[];
  label?: string;
  assets?: any;

  combinedNodes?: AppNode[];
  summary?: {
    image: number;
    video: number;
    audio: number;
    text: number;
  };
}

// 根据 AppNode 判定 cardType
function inferCardType(node: AppNode): CardType {
  if (node.isComposite) {
    return 'composite'
  }

  if (!node.originalParents || node.originalParents.length === 0) {
    return 'init'
  }

  if (node.module_id === 'AddText') {
    return 'textFull'
  }

  if (node.module_id === 'AddWorkflow' || node.module_id?.startsWith('AddWorkflow')) {
    return 'AddWorkflow'
  }

  if (node.module_id === 'TextImage' || node.module_id === 'Upload') {
    return 'TextImage'
  }

  if (node.module_id === 'TextToAudio') {
    return 'audio'
  }

  return 'io'
}
// 构造显示标题（现在先用 module_id 占位）
function buildTitle(node: AppNode): string {
  if (node.isComposite) {
    return node.label || `组合（${node.combinedNodes?.length || 0}）`
  }

  if (!node.originalParents || node.originalParents.length === 0) {
    return '开始'
  }

  if (node.module_id === 'AddText') {
    return '意图草稿'
  }

  if (node.module_id === 'AddWorkflow' || node.module_id?.startsWith('AddWorkflow')) {
    return '工作流规划'
  }

  return node.module_id
}
// 对外暴露的主函数：把 AppNode[] 变成 ViewNode[]
export function buildWorkflowView(nodes: AppNode[]): ViewNode[] {
  return (nodes || []).map((n) => {
    const cardType = inferCardType(n)
    //console.log(`workflowLayout.ts ${cardType}`)
    return {
      ...n,
      cardType,
      title: buildTitle(n),
      isInit: !n.originalParents || n.originalParents.length === 0,
    }
  })
}
