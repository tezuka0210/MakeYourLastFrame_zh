// src/lib/workflowGraph.js
import * as d3 from 'd3'
import * as dagre from 'dagre'
import WaveSurfer from 'wavesurfer.js'

import { workflowParameters } from '@/lib/useWorkflowForm.js';
import { setPrevAgentContext, clearPrevAgentContext } from '@/lib/agentSharedState.js';
import { updateEntityDisplay } from '@/lib/entityCard.js';
import { isSpeechInputSupported, startBrowserSpeechInput } from '@/lib/speechInput.js';


// --- link color: light gray for all edges ---
const defaultLinkColor = '#D1D5DB' // gray-300 #D1D5DB

// --- node category palette (paper-friendly, from CSS variables) ---
const NODE_COLORS = {
  auxBorder:  'var(--media-aux-border)',

  image:      'var(--media-image)',
  video:      'var(--media-video)',
  audio:      'var(--media-audio)',
  overlap:    'var(--media-overlap)',

  imageSoft:  'var(--media-image-soft)',
  videoSoft:  'var(--media-video-soft)',
  audioSoft:  'var(--media-audio-soft)',
  overlapSoft:'var(--media-overlap-soft)',
}

// 允许在运行时刷新节点颜色（CSS 变量改变后调用）
export function refreshNodeColors() {
  NODE_COLORS.image = getCSSVar('--media-image', NODE_COLORS.image);
  NODE_COLORS.video = getCSSVar('--media-video', NODE_COLORS.video);
  NODE_COLORS.audio = getCSSVar('--media-audio', NODE_COLORS.audio);
  NODE_COLORS.text = getCSSVar('--media-text', NODE_COLORS.text);
  NODE_COLORS.auxBorder = getCSSVar('--media-aux-border', NODE_COLORS.auxBorder);
  NODE_COLORS.overlap = getCSSVar('--media-overlap', NODE_COLORS.overlap);
  NODE_COLORS.overlapSoft = getCSSVar('--media-overlap-soft', NODE_COLORS.overlapSoft);
}

// ---- 可配置的布局参数（默认值与之前一致） ----
let layoutConfig = {
  nodesep: 100,
  ranksep: 120,
};

// 对外暴露：更新 layoutConfig
export function setLayoutConfig(newConfig = {}) {
  if (typeof newConfig.nodesep === 'number') {
    layoutConfig.nodesep = newConfig.nodesep;
  }
  if (typeof newConfig.ranksep === 'number') {
    layoutConfig.ranksep = newConfig.ranksep;
  }
}

/**
 * 创建统一配置的 dagre graph
 */
function createDagreGraph() {
  // Dagre 布局
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    // align: 'UL',
    nodesep: layoutConfig.nodesep,
    ranksep: layoutConfig.ranksep,
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}));

  return g;
}

/**
 * 读取 CSS 变量的工具函数
 * @param {string} name - 例如 '--media-image'
 */
function getCSSVar(name, fallback = '') {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback
}


// selection shadow color is same as category color, but used in box-shadow
function getNodeCategory(node) {
  // 新增：复合节点特殊处理
  if (node.isComposite) return 'composite';
  
  // const hasIVMedia = !!(node.assets && node.assets.output && node.assets.output.images && node.assets.output.images.length > 0)
  // const hasAudioMedia = !!(node.assets && node.assets.output && node.assets.output.audio && node.assets.output.audio.length > 0)
  // const hasMedia = hasIVMedia || hasAudioMedia
  // const rawIVPath = hasIVMedia ? node.assets.output.images[0] : ''
  // const rawAudioPath = hasAudioMedia? node.assets.output.audio[0]:''
  // // 从路径推断媒体类型（因为原数据中没有 type 字段）
  // const mediaType = rawIVPath.includes('.png') || rawIVPath.includes('.jpg') || rawIVPath.includes('.jpeg') ? 'image' 
  //   : rawIVPath.includes('.mp4') ? 'video' 
  //   : rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') ? 'audio' 
  //   : ''
  //console.log(`getNodeCategory,${mediaType}`)
  // const isAudioMedia =
  //   typeof rawAudioPath === 'string' &&
  //   (rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') || rawAudioPath.includes('subfolder=audio') || mediaType === 'audio')
  const isAudioMedia = (node.module_id=='TextToAudio')

  // const isVideoMedia =
  //   typeof rawIVPath === 'string' &&
  //   (rawIVPath.includes('.mp4') || rawIVPath.includes('subfolder=video') || mediaType === 'video')
  const isVideoMedia = (node.module_id=='TextGenerateVideo')||(node.module_id=='ImageGenerateVideo')||(node.module_id=='FLFrameToVideo')||(node.module_id=='TextToVideo'||(node.module_id=='CameraControl')||(node.module_id=='FrameInterpolation'))

  const isImageMedia = (node.module_id!='AddText')&&(node.module_id!='AddWorkflow')&&!isAudioMedia&&!isVideoMedia;

  if (isAudioMedia) {
    //console.log(`audio`)
    return 'audio'
  }
  if (isImageMedia) {
    //console.log(`image`)
    return 'image'
  }
  if (isVideoMedia) {
    //console.log(`video`)
    return 'video'
  }
  //console.log(`aux`)
  return 'aux'
}

function getNodeBorderColor(node) {
  const cat = getNodeCategory(node)
  if (cat === 'composite') return NODE_COLORS.overlap
  if (cat === 'audio') return NODE_COLORS.audio
  if (cat === 'image') return NODE_COLORS.image
  if (cat === 'video') return NODE_COLORS.video
  return NODE_COLORS.auxBorder
}

function getSelectionColor(node) {
  const cat = getNodeCategory(node)
  if (cat === 'composite') return NODE_COLORS.overlap
  if (cat === 'audio') return NODE_COLORS.audio
  if (cat === 'image') return NODE_COLORS.image
  if (cat === 'video') return NODE_COLORS.video
  return '#CBD5E1'
}

function getNodeHeaderBaseLabel(node) {
  if (node.isComposite) return `合并节点（${node.combinedNodes?.length || 0}）`;
  if (node.module_id === 'AddText') return '草稿';
  if (node.module_id === 'AddWorkflow') return '规划';
  return node.displayName || node.module_id || '状态';


  const mid = (node.module_id || '').toLowerCase()

  if (mid === 'addtext') return '草稿'
  if (mid === 'addworkflow') return '规划'

  return node.displayName || node.module_id || '状态'
}

function getNodeMetaTag(node) {
  if (node.isComposite) return '合并状态'
  const mid = (node.module_id || '').toLowerCase()
  if (mid === 'init') return '根状态'
  if (mid === 'addtext') return '草稿笔记'
  if (mid === 'addworkflow') return '规划状态'
  const cat = getNodeCategory(node)
  if (cat === 'image') return '图像草稿'
  if (cat === 'video') return '视频草稿'
  if (cat === 'audio') return '音频草稿'
  return '草稿状态'
}

/** 统一控制卡片选中样式 */
function setCardSelected(cardSel, nodeData, isSelected) {
  // 只通过 class 控制选中状态，具体阴影 & 颜色交给 CSS
  cardSel.classed('is-selected', isSelected)
  // 不再在这里写 box-shadow，避免覆盖你在 CSS 里的
}

/** 折叠状态：按钮“颜色反转” */
function applyCollapseBtnStyle(btnSel, isCollapsed) {
  // collapsed: 反转（深底白字）；expanded: 普通（白底灰字）
  if (isCollapsed) {
    btnSel
      .style('background', '#6b7280')   // gray-500
      .style('color', '#ffffff')
      .style('border-color', '#4b5563') // gray-600
  } else {
    btnSel
      .style('background', '#ffffff')
      .style('color', '#9ca3af')        // gray-400
      .style('border-color', '#e5e7eb')
  }
}

function applyCollapseBtnHoverStyle(btnSel, isCollapsed) {
  // hover 不改变语义，只做轻微强调
  if (isCollapsed) {
    // collapsed 状态 hover：稍微更深一点
    btnSel
      .style('background', '#4b5563')   // gray-600
      .style('color', '#ffffff')
      .style('border-color', '#374151') // gray-700
  } else {
    // expanded 状态 hover：轻微灰底提示可点
    btnSel
      .style('background', '#f3f4f6')   // gray-100
      .style('color', '#6b7280')        // gray-500
      .style('border-color', '#d1d5db') // gray-300
  }
}

/** 统一：collapsed 节点强制视为“视觉选中” */
function isVisuallySelected(nodeData, selectedIds = []) {
  return !!(nodeData && (nodeData._collapsed || selectedIds.includes(nodeData.id)))
}


function normalizeSelectedIds(selectedIds = []) {
  return Array.from(new Set((Array.isArray(selectedIds) ? selectedIds : []).filter(Boolean)))
}

function getSelectionState(svgElement, fallbackSelectedIds = []) {
  if (!svgElement) return normalizeSelectedIds(fallbackSelectedIds)
  if (!Array.isArray(svgElement.__workflowSelectedIds)) {
    svgElement.__workflowSelectedIds = normalizeSelectedIds(fallbackSelectedIds)
  }
  return normalizeSelectedIds(svgElement.__workflowSelectedIds)
}

function commitSelectionState(svgElement, nextSelectedIds, emit) {
  const normalized = normalizeSelectedIds(nextSelectedIds)
  if (svgElement) {
    svgElement.__workflowSelectedIds = normalized
  }
  if (typeof emit === 'function') {
    emit('update:selectedIds', normalized)
  }
  if (svgElement) {
    try {
      updateSelectionStyles(svgElement, normalized)
    } catch (err) {
      console.warn('updateSelectionStyles failed:', err)
    }
  }
  return normalized
}

function clearAllSelections(svgElement, emit) {
  return commitSelectionState(svgElement, [], emit)
}

function toggleSelectionForNode(svgElement, node, fallbackSelectedIds, emit, options = {}) {
  if (!node || !node.id) return getSelectionState(svgElement, fallbackSelectedIds)
  const {
    maxCount = null,
    allowComposite = true,
  } = options

  if (!allowComposite && node.isComposite) {
    return getSelectionState(svgElement, fallbackSelectedIds)
  }

  let selected = new Set(getSelectionState(svgElement, fallbackSelectedIds))
  if (selected.has(node.id)) {
    selected.delete(node.id)
  } else {
    if (typeof maxCount === 'number' && maxCount > 0 && selected.size >= maxCount) {
      selected = new Set(Array.from(selected).slice(-(maxCount - 1)))
    }
    selected.add(node.id)
  }
  return commitSelectionState(svgElement, Array.from(selected), emit)
}

function syncSelectionStateFromProps(svgElement, selectedIds = []) {
  if (!svgElement) return normalizeSelectedIds(selectedIds)
  svgElement.__workflowSelectedIds = normalizeSelectedIds(selectedIds)
  return svgElement.__workflowSelectedIds
}


const lineGenerator = d3.line()
  .x(d => d.x)
  .y(d => d.y)
  .curve(d3.curveBasis)

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '--:--'
  const min = Math.floor(seconds / 60)
  const sec = Math.floor(seconds % 60)
  return `${min}:${sec < 10 ? '0' : ''}${sec}`
}

/** 递归查找子孙（用于收缩控制） */
function findDescendants(nodeId, hierarchy) {
  const node = hierarchy.get(nodeId)
  if (!node || !node.children || node.children.length === 0) return []
  let descendants = []
  node.children.forEach(child => {
    descendants.push(child.id)
    descendants = descendants.concat(findDescendants(child.id, hierarchy))
  })
  return descendants
}

/** 基于 _collapsed 计算可见节点与连线 */

export function getVisibleNodesAndLinks(allNodes) {
  if (!allNodes || allNodes.length === 0) {
    return { visibleNodes: [], visibleLinks: [] }
  }

  const nodeMap = new Map(allNodes.map(n => [n.id, { ...n, children: [] }]))
  allNodes.forEach(n => {
    if (n.originalParents && n.originalParents.length > 0) { // 新增：判断有父节点
      // 改动1：只取第一个父节点，不再遍历所有parentId
      const parentId = n.originalParents[0]; 
      const p = nodeMap.get(parentId)
      if (p) p.children.push(n)
    }
  })

  const hidden = new Set()
  allNodes.forEach(node => {
    if (node._collapsed) {
      findDescendants(node.id, nodeMap).forEach(id => hidden.add(id))
    }
    // 新增：隐藏被组合的节点
    //if (node.isCombined) hidden.add(node.id);
  })

   const visibleNodes = allNodes.filter(n => !hidden.has(n.id))
  const visibleIds = new Set(visibleNodes.map(n => n.id))
  
  // --- 调试点 2: 检查 ID 存在性 ---
  console.log("Currently visible node IDs:", Array.from(visibleIds));

  const visibleLinks = []
  visibleNodes.forEach(n => {
    if (n.originalParents) {
      n.originalParents.forEach(pId => {
        const isParentVisible = visibleIds.has(pId);
        // 如果你发现 2 和 3 都明明在上面打印的 ID 列表里，但这里判断为 false，说明 ID 类型不匹配（String vs Number）
        if (isParentVisible) {
          visibleLinks.push({ source: pId, target: n.id });
        } else {
          // --- 调试点 3: 追踪丢失的连线 ---
          console.warn(`Node[${n.id}] tried to link to parent[${pId}], but that parent is not visible (hidden or deleted).`);
        }
      })
    }
  })
  return { visibleNodes, visibleLinks }
}



/** 粗略推断当前“卡片类型” */
function inferCardType(node) {
  const mid = (node.module_id || '').trim()

  if (mid === 'Init') return 'init'
  if (mid === 'AddText') return 'textFull'
  if (mid === 'TextImage' || mid === 'Upload') return 'TextImage'

  // ⭐ 关键：兼容所有 AddWorkflow* 形态的新旧节点
  if (mid === 'AddWorkflow' || mid.startsWith('AddWorkflow')) return 'AddWorkflow'

  if (mid === 'TextToAudio') return 'audio'
  return 'io'
}


/** 仅更新“选中”样式（按类型着色阴影） */
export function updateSelectionStyles(svgElement, selectedIds) {
  d3.select(svgElement).selectAll('.node')
    .each(function (d) {
      if (!d || !d.id) return
      const card = d3.select(this).select('.node-card')
      if (card.empty()) return

      const isSelected = isVisuallySelected(d, selectedIds)
      setCardSelected(card, d, isSelected)

    })
}

/**
 * 为卡片创建右键菜单（包含 Intent Draft / Workflow Planning）
 * @param {d3.Selection} card - 卡片DOM选择器
 * @param {Object} d - 节点数据
 * @param {Function} emit - 事件发射器
 */
function addRightClickMenu(card, d, emit) {
  card.on('contextmenu', (ev) => {
    // 如果在 phrase 行上右键，不弹节点级菜单
    const target = ev.target;
    if (target && target.closest && target.closest('.phrase-row')) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    const menu = d3.select('body').append('xhtml:div')
      .style('position', 'absolute')
      .style('left', `${ev.pageX}px`)
      .style('top', `${ev.pageY}px`)
      .style('background', 'white')
      .style('border', '1px solid #e5e7eb')
      .style('border-radius', '4px')
      .style('padding', '4px 0')
      .style('box-shadow', '0 2px 8px rgba(0,0,0,0.1)')
      .style('z-index', '1000')
      .style('min-width', '160px');

    const addMenuItem = (label, onClick) => {
      menu.append('xhtml:div')
        .style('padding', '4px 12px')
        .style('cursor', 'pointer')
        .style('font-size', '12px')
        .style('color', '#374151')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('gap', '6px')
        .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6') })
        .on('mouseleave', function () { d3.select(this).style('background', 'transparent') })
        .text(label)
        .on('click', () => {
          onClick()
          menu.remove()
        })
    }

    addMenuItem('创建子草稿', () => {
      emit('create-card', d, 'AddText', 'util')
    })

    addMenuItem('添加再编辑规划', () => {
      emit('create-card', d, 'AddWorkflow', 'util')
    })

    const closeMenu = () => {
      menu.remove()
      document.removeEventListener('click', closeMenu)
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)
  })
}



/** 折叠/展开后：同时更新可见性 + 重新布局（带过渡） */
export function updateVisibility(svgElement, allNodes) {
  // 1) 先算出当前可见节点/边（保持你原来的折叠语义）
  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodes)
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id))
  const visibleLinkIds = new Set(visibleLinks.map(l => `${l.source}->${l.target}`))

  const svg = d3.select(svgElement)

  // 保留原来的显示/隐藏逻辑
  svg.selectAll('.node')
    .style('display', d => visibleNodeIds.has(d.id) ? null : 'none')
    .each(function (d) {
      const btn = d3.select(this).select('button.collapse-btn')
      if (btn.size()) {
        btn.text(d._collapsed ? '+' : '-')
        applyCollapseBtnStyle(btn, !!d._collapsed)

      }
    })

  svg.selectAll('.link')
    .style('display', d => visibleLinkIds.has(`${d.v}->${d.w}`) ? null : 'none')

  // 2) 基于「可见节点」重新建一个 dagre graph
  if (!visibleNodes.length) return

  const g = createDagreGraph();

  g.setDefaultEdgeLabel(() => ({}))

  visibleNodes.forEach(node => {
    const width = node.calculatedWidth || 260
    const height = node.calculatedHeight || 140
    g.setNode(node.id, { width, height })
  })

  visibleLinks.forEach(l => g.setEdge(l.source, l.target))

  dagre.layout(g)

  const dagreNodes = new Map(g.nodes().map(id => [id, g.node(id)]));
  // 新增：把原始节点数据建一个 map，方便判断是不是 Init
  const nodeDataMap = new Map(visibleNodes.map(n => [n.id, n]));

  const dagreEdges = g.edges().map(e => {
    const edgeData = g.edge(e);
    const src = dagreNodes.get(e.v);
    const tgt = dagreNodes.get(e.w);

    if (!edgeData || !edgeData.points || edgeData.points.length === 0 || !src || !tgt) {
      return { v: e.v, w: e.w, points: [] };
    }

    const pts = edgeData.points.map(p => ({ x: p.x, y: p.y }));
    const first = pts[0];
    const last  = pts[pts.length - 1];

    const srcData = nodeDataMap.get(e.v) || {};
    const tgtData = nodeDataMap.get(e.w) || {};

    const isSrcInit = (srcData.module_id === 'Init') || inferCardType(srcData) === 'init';
    const isTgtInit = (tgtData.module_id === 'Init') || inferCardType(tgtData) === 'init';

    // ===== 起点处理 =====
    if (isSrcInit) {
      // Init：从圆心出发
      first.x = src.x;
      first.y = src.y;
    } else {
      // 普通节点：右侧中点
      first.x = src.x + (src.width || 0) / 2;
      // first.y 用 dagre 原来的，保留转折
    }

    // ===== 终点处理 =====
    if (isTgtInit) {
      // 如果以后有指向 Init 的边，也从圆心结束
      last.x = tgt.x;
      last.y = tgt.y;
    } else {
      // 普通节点：左侧中点
      last.x = tgt.x - (tgt.width || 0) / 2;
      // last.y 保持原样
    }

    return { v: e.v, w: e.w, points: pts };
  });

  // 3) 选中当前 layout 容器里的 nodes / links，做平滑过渡
  const layoutGroup = svg.select('g.zoom-container')
  const nodeSel = layoutGroup.select('g.nodes').selectAll('.node')
  const linkSel = layoutGroup.select('g.links').selectAll('path.link')

  // 节点位置过渡
  nodeSel
    .transition()
    .duration(400)
    .attr('transform', function (d) {
      const n = dagreNodes.get(d.id)
      if (!n) {
        // 找不到（说明被隐藏），保持原 transform
        return d3.select(this).attr('transform')
      }
      return `translate(${n.x},${n.y})`
    })

  // 连线路径过渡
  linkSel
    .transition()
    .duration(400)
    .attr('d', function (d) {
      const match = dagreEdges.find(e => e.v === d.v && e.w === d.w)
      if (!match) {
        return d3.select(this).attr('d')
      }
      return lineGenerator(match.points)
    })
}


/** 完整重绘（重新布局 & 初始缩放） */
export function renderTree(
  svgElement,
  allNodesData,
  selectedIds,
  emit,
  workflowTypes,
  viewState = null,
  layoutOptions = null   // 新增参数：来自 WorkflowTree.vue 的布局配置
) {
  // ====== 合并布局参数：外部传入的 horizontalGap / verticalGap 优先 ======
  if (layoutOptions) {
    if (typeof layoutOptions.horizontalGap === 'number') {
      layoutConfig.ranksep = layoutOptions.horizontalGap
    }
    if (typeof layoutOptions.verticalGap === 'number') {
      layoutConfig.nodesep = layoutOptions.verticalGap
    }
  }

  const wrapper = d3.select(svgElement)
  syncSelectionStateFromProps(svgElement, selectedIds)

  // 优先用外部传进来的 viewState；如果没有，就从 d3 的内部 zoom 状态恢复
  let savedView = viewState
  if (!savedView) {
    const prev = wrapper.property('__zoom')      // d3.zoom 内部记录
    if (prev) {
      savedView = { k: prev.k, x: prev.x, y: prev.y }
    }
  }

   // --- 调试点 1: 检查原始数据 ---
  console.log("=== RenderTree Check ===");
  allNodesData.forEach(n => {
    if (n.originalParents && n.originalParents.length > 0) {
      console.log(`Parent list for Node[${n.id}]:`, n.originalParents);
    }
  });

  // 清空旧内容，但不要动 wrapper 本身（保留 __zoom 属性）
  wrapper.html('')

  const { visibleNodes, visibleLinks } = getVisibleNodesAndLinks(allNodesData)
  if (!visibleNodes.length) {
    wrapper.append('text')
      .attr('x', '50%').attr('y', '50%')
      .attr('text-anchor', 'middle')
      .attr('fill', '#ffffffff')//#9ca3af
      .text('暂无草稿状态。创建一个子草稿开始。')
    return
  }


  // Dagre 布局（使用统一配置）
  const g = createDagreGraph();

  const BASE_CARD_HEIGHT = 170
  const PROMPT_AREA_HEIGHT = 30

  visibleNodes.forEach(node => {
    const cardType = inferCardType(node)
    const isInit = cardType === 'init'

    const hasMedia = !!(
      node.assets &&
      node.assets.output &&
      node.assets.output.images &&
      node.assets.output.images.length > 0
    )

    const rawPath = hasMedia ? node.assets.output.images[0] : ''

    const isAudioMedia =
      typeof rawPath === 'string' &&
      (
        rawPath.includes('.mp3') ||
        rawPath.includes('.wav') ||
        rawPath.includes('subfolder=audio')
      )

    const promptText = node.parameters
      ? (node.parameters.positive_prompt || node.parameters.text)
      : null

    const hasPrompt = typeof promptText === 'string' && promptText.trim() !== ''

    let nodeWidth = 260
    let nodeHeight = 120

    if (isInit) {
      nodeWidth = 60
      nodeHeight = 60
    } else if (getNodeCategory(node) === 'composite') {
      nodeWidth = 300
      nodeHeight = getCompositeHeight(node)
    } else if (cardType === 'textFull') {
      nodeWidth = 260
      nodeHeight = 150
    } else if (cardType === 'AddWorkflow') {
      nodeWidth = 260
      nodeHeight = 190
    } else if (cardType === 'TextImage') {
      nodeWidth = 260
      nodeHeight = 140
    } else if (cardType === 'audio' || isAudioMedia) {
      nodeWidth = 260
      nodeHeight = 175 
    } else {
      nodeWidth = 260
      //if (hasMedia && hasPrompt) {
      nodeHeight = BASE_CARD_HEIGHT + PROMPT_AREA_HEIGHT
      // } else if (hasMedia) {
      //   nodeHeight = BASE_CARD_HEIGHT
      // } else if (hasPrompt) {
      //   nodeHeight = 140
      // } else {
      //   nodeHeight = 120
      // }
    }

    node.calculatedWidth = nodeWidth
    node.calculatedHeight = nodeHeight
    node._cardType = cardType

    g.setNode(node.id, {
      label: node.module_id,
      width: nodeWidth,
      height: nodeHeight
    })
  })

  visibleLinks.forEach(l => {
    console.log(`Dagre Edge: ${l.source} -> ${l.target}`);
    g.setEdge(l.source, l.target);
  })

  dagre.layout(g)

  const dagreNodes = new Map(g.nodes().map(id => [id, g.node(id)]));
  const nodeDataMap = new Map(visibleNodes.map(n => [n.id, n]));

  const dagreEdges = g.edges().map(e => {
    const edgeData = g.edge(e);
    const src = dagreNodes.get(e.v);
    const tgt = dagreNodes.get(e.w);

    if (!edgeData || !edgeData.points || edgeData.points.length === 0 || !src || !tgt) {
      return { v: e.v, w: e.w, points: [] };
    }

    const pts = edgeData.points.map(p => ({ x: p.x, y: p.y }));
    const first = pts[0];
    const last  = pts[pts.length - 1];

    const srcData = nodeDataMap.get(e.v) || {};
    const tgtData = nodeDataMap.get(e.w) || {};

    const isSrcInit = (srcData.module_id === 'Init') || inferCardType(srcData) === 'init';
    const isTgtInit = (tgtData.module_id === 'Init') || inferCardType(tgtData) === 'init';

    if (isSrcInit) {
      first.x = src.x;
      first.y = src.y;
    } else {
      first.x = src.x + (src.width || 0) / 2;
    }

    if (isTgtInit) {
      last.x = tgt.x;
      last.y = tgt.y;
    } else {
      last.x = tgt.x - (tgt.width || 0) / 2;
    }

    return { v: e.v, w: e.w, points: pts };
  });



  // SVG 容器与缩放
  const width = svgElement.clientWidth || 1200
  const height = svgElement.clientHeight || 600
  const svg = wrapper
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')


  const defs = svg.append('defs')
  // 只保留一种灰色箭头
  defs.append('marker')
    .attr('id', 'arrowhead-default')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 10).attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('xoverflow', 'visible')
    .append('path')
    .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
    .style('fill', defaultLinkColor)
    .style('stroke', 'none')

  // 给 layoutGroup 添加 class 方便选择
  const layoutGroup = svg.append('g')
    .attr('class', 'zoom-container'); // 新增 class 用于选择

  const linkGroup = layoutGroup.append('g').attr('class', 'links')
  const nodeGroup = layoutGroup.append('g').attr('class', 'nodes')

  const zoom = d3.zoom()
    .scaleExtent([0.1, 2.5])
    .on('zoom', (ev) => layoutGroup.attr('transform', ev.transform))
    .filter((ev) => {
      const target = ev.target;
      return !(target && target.closest && target.closest('foreignObject'));
    });

  svg.call(zoom);

  // ⭐ 优先恢复旧视图；没有旧视图时才做一次自适应缩放
  if (savedView) {
    svg.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(savedView.x, savedView.y)
        .scale(savedView.k)
    );
  } else {
    const graphWidth = g.graph().width || width;
    const graphHeight = g.graph().height || height;
    const s = Math.min(1, Math.min(width / graphWidth, height / graphHeight) * 0.9);
    const tx = (width - graphWidth * s) / 2;
    const ty = (height - graphHeight * s) / 2;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(s));
  }

  // 背景点击：取消选择
  const svgDom = svg.node()
  svgDom.addEventListener('click', (ev) => {
    if (ev.target === svgDom) {
      clearAllSelections(svgElement, emit)
    }
  })

  // 新增：初始化框选交互
  // initSelectionBox(svg, svgElement, allNodesData, emit);


  function getSegmentHostKey(node) {
    return node?.id
  }

  function hasSegmentData(node) {
    return !!(
      node &&
      node.assets &&
      node.assets.segmented &&
      (
        Array.isArray(node.assets.segmented)
        || (typeof node.assets.segmented === 'object' && Object.keys(node.assets.segmented).length > 0)
      )
    )
  }

  function isSegmentOnlyNode(node) {
    const mid = String(node?.module_id || '').toLowerCase()
    return (
      mid.includes('segment')
      || mid.includes('segmentelement')
      || mid === 'segmentelement'
    )
  }

  function getLinkStyle() {
    return { color: defaultLinkColor, id: 'url(#arrowhead-default)' }
  }

  // Links
  linkGroup.selectAll('path.link')
    .data(dagreEdges)
    .enter().append('path')
    .attr('class', 'link')
    .each(function () {
      const st = getLinkStyle()
      d3.select(this).style('stroke', st.color).attr('marker-end', st.id)
    })
    .attr('d', d => lineGenerator(d.points))

  // Nodes
  const nodeSel = nodeGroup.selectAll('.node')
    .data(visibleNodes, d => d.id)
    .enter().append('g')
    .attr('class', 'node')
    .attr('data-id', d => d.id)
    .attr('transform', d => {
      const n = dagreNodes.get(d.id)
      return `translate(${n.x},${n.y})`
    })

  
  /**
   * 统一构建 header：左标题 + 右侧 [-][+][x]
   * 现在会根据模块类型给辅助节点更友好的标题：
   *   - AddText      -> "Intent Draft"
   *   - AddWorkflow  -> "Workflow Planning"
   */
  function buildHeader(card, d) {
    let isEditingTitle = false

    const header = card.append('xhtml:div')
      .style('display', 'flex')
      .style('justify-content', 'space-between')
      .style('align-items', 'center')
      .style('padding', '4px 8px')
      .style('border-bottom', '1px solid #e5e7eb')
      .style('flex-shrink', '0')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')

    const cat = getNodeCategory(d)
    let headerBg = '#f9fafb'
    if (cat === 'image') headerBg = NODE_COLORS.imageSoft
    else if (cat === 'video') headerBg = NODE_COLORS.videoSoft
    else if (cat === 'audio') headerBg = NODE_COLORS.audioSoft
    else if (cat === 'composite') headerBg = NODE_COLORS.overlapSoft

    header
      .style('background-color', headerBg)
      .attr('data-node-category', cat)

    const titleWrap = header.append('xhtml:div')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('min-width', '0')
      .style('flex', '1 1 auto')

    const initialLabel = getNodeHeaderBaseLabel(d)

    const title = titleWrap.append('xhtml:div')
      .style('font-size', '12px')
      .style('font-weight', '600')
      .style('color', '#111827')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .style('white-space', 'nowrap')
      .style('min-width', '0')
      .style('cursor', 'text')
      .text(initialLabel)

    title.on('click', (ev) => {
      if (isEditingTitle) return
      ev.stopPropagation()
      toggleSelectionForNode(svgElement, d, selectedIds, emit, { allowComposite: true, maxCount: 2 })
    })

    title.on('dblclick', (ev) => {
      ev.stopPropagation()
      if (isEditingTitle) return
      isEditingTitle = true
      const currentLabel = getNodeHeaderBaseLabel(d)
      title.text(null)
        .style('border', '1px dashed #9ca3af')
        .style('border-radius', '4px')
        .style('padding', '1px 4px')

      const input = title.append('xhtml:input')
        .attr('type', 'text')
        .attr('value', currentLabel)
        .style('width', '100%')
        .style('font-size', '12px')
        .style('font-weight', '600')
        .style('color', '#111827')
        .style('border', 'none')
        .style('outline', 'none')
        .style('background', 'transparent')
        .on('mousedown', ev2 => ev2.stopPropagation())

      const inputNode = input.node()
      if (inputNode) {
        setTimeout(() => {
          inputNode.focus()
          inputNode.select()
        }, 0)
      }

      function finishEdit(commit) {
        if (!isEditingTitle) return
        isEditingTitle = false
        const fallback = getNodeHeaderBaseLabel({ ...d, displayName: '' })
        const newText = commit && inputNode ? inputNode.value.trim() : (d.displayName || fallback)
        const finalLabel = newText || fallback
        d.displayName = finalLabel
        title.selectAll('*').remove()
        title.style('border', 'none').style('padding', '0').text(finalLabel)
      }

      d3.select(inputNode).on('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          finishEdit(true)
          emit('rename-node', { id: d.id, label: d.displayName })
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finishEdit(false)
        }
      })

      d3.select(inputNode).on('blur', () => {
        finishEdit(true)
        emit('rename-node', { id: d.id, label: d.displayName })
      })
    })

    const toolbar = header.append('xhtml:div')
      .style('display', 'flex')
      .style('gap', '4px')
      .style('align-items', 'center')
      .style('margin-left', '8px')
      .style('flex-shrink', '0')

    const tempMap = new Map(allNodesData.map(n => [n.id, { ...n, children: [] }]))
    allNodesData.forEach(n => {
      if (n.originalParents) {
        n.originalParents.forEach(p => tempMap.get(p)?.children.push(n))
      }
    })
    const hasChildren = !!(tempMap.get(d.id) && tempMap.get(d.id).children.length)

    if (hasChildren) {
      const collapseBtn = toolbar.append('xhtml:button')
        .attr('class', 'collapse-btn')
        .text(d._collapsed ? '+' : '-')
        .style('width', '18px')
        .style('height', '18px')
        .style('border-radius', '999px')
        .style('border', '1px solid #e5e7eb')
        .style('font-size', '12px')
        .style('line-height', '1')
        .style('display', 'inline-flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('cursor', 'pointer')
        .style('user-select', 'none')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          const nextCollapsed = !d._collapsed
          d._collapsed = nextCollapsed
          collapseBtn.text(nextCollapsed ? '+' : '-')
          applyCollapseBtnStyle(collapseBtn, nextCollapsed)
          emit('toggle-collapse', d.id)
        })

      applyCollapseBtnStyle(collapseBtn, !!d._collapsed)
      collapseBtn
        .on('mouseenter', function () {
          applyCollapseBtnHoverStyle(d3.select(this), !!d._collapsed)
        })
        .on('mouseleave', function () {
          applyCollapseBtnStyle(d3.select(this), !!d._collapsed)
        })
    }

    toolbar.append('xhtml:button')
      .text('×')
      .style('width', '18px')
      .style('height', '18px')
      .style('border-radius', '999px')
      .style('border', '1px solid #fecaca')
      .style('background', '#ffffff')
      .style('font-size', '12px')
      .style('line-height', '1')
      .style('display', 'inline-flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('color', '#dc2626')
      .style('cursor', 'pointer')
      .style('user-select', 'none')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', ev => {
        ev.stopPropagation()
        emit('delete-node', d.id)
      })
      .on('mouseenter', function () {
        d3.select(this).style('background', '#dc2626').style('color', '#ffffff').style('border-color', '#dc2626')
      })
      .on('mouseleave', function () {
        d3.select(this).style('background', '#ffffff').style('color', '#dc2626').style('border-color', '#fecaca')
      })

    return header
  }



  function buildCollapsibleSection(parent, title, expanded = true, controlsBuilder = null) {
    let isExpanded = !!expanded
    const section = parent.append('xhtml:div')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '4px')
      .style('padding', '2px 0')

    const header = section.append('xhtml:div')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '6px')
      .style('padding', '0 2px')
      .style('cursor', 'pointer')
      .on('mousedown', ev => ev.stopPropagation())

    const toggle = header.append('xhtml:span')
      .style('font-size', '10px')
      .style('color', '#6b7280')
      .text(isExpanded ? '▾' : '▸')

    header.append('xhtml:span')
      .style('font-size', '10px')
      .style('font-weight', '600')
      .style('color', '#4b5563')
      .text(title)

    const controls = header.append('xhtml:div')
      .style('margin-left', 'auto')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('gap', '4px')
      .on('click', ev => ev.stopPropagation())
      .on('mousedown', ev => ev.stopPropagation())

    if (controlsBuilder) controlsBuilder(controls)

    section.append('xhtml:div').style('height', '1px').style('background', '#e5e7eb')

    const content = section.append('xhtml:div')
      .style('display', isExpanded ? 'block' : 'none')
      .style('padding', '2px 0 0 0')
      .style('width', '100%')
      .style('box-sizing', 'border-box')
      .style('overflow-x', 'hidden')

    header.on('click', () => {
      isExpanded = !isExpanded
      toggle.text(isExpanded ? '▾' : '▸')
      content.style('display', isExpanded ? 'block' : 'none')
    })

    return { section, header, content, controls }
  }

  function getWorkflowOptionIds(currentId = '') {
    const keys = Object.keys(workflowParameters || {})
    if (currentId && !keys.includes(currentId)) return [currentId, ...keys]
    return keys
  }

  function getDefaultWorkflowParams(workflowId) {
    const defs = workflowParameters?.[workflowId] || []
    return defs.reduce((acc, item) => { acc[item.id] = item.defaultValue; return acc }, {})
  }

  function isVideoUrl(url = '') {
    const v = String(url).toLowerCase()
    return v.includes('.mp4') || v.includes('.mov') || v.includes('.webm') || v.includes('subfolder=video')
  }

  function isAudioUrl(url = '') {
    const v = String(url).toLowerCase()
    return v.includes('.mp3') || v.includes('.wav') || v.includes('.m4a') || v.includes('subfolder=audio')
  }

  function deriveMediaKind(url = '') {
    if (isAudioUrl(url)) return 'audio'
    if (isVideoUrl(url)) return 'video'
    return 'image'
  }

  function getInputMediaUrls(node) {
    const a = node.assets?.input || {}
    return [...(a.images || []), ...(a.videos || []), ...(a.audio || [])].filter(Boolean)
  }

  function getOutputMediaUrls(node) {
    const a = node.assets?.output || {}
    return [...(a.images || []), ...(a.videos || []), ...(a.audio || [])].filter(Boolean)
  }

  function getInputMediaState(node, state) {
    const input = node?.assets?.input || {}
    const imageUrls = Array.isArray(input.images) ? [...input.images] : []
    const videoUrls = Array.isArray(input.videos) ? [...input.videos] : []
    const audioUrls = Array.isArray(input.audio) ? [...input.audio] : []
    const allUrls = Array.isArray(state?.inputUrls) && state.inputUrls.length
      ? [...state.inputUrls]
      : [...imageUrls, ...videoUrls, ...audioUrls]

    return { imageUrls, videoUrls, audioUrls, allUrls }
  }

  function syncNodeInputAssets(node, mediaState) {
    if (!node.assets) node.assets = {}
    if (!node.assets.input) node.assets.input = {}
    node.assets.input.images = [...(mediaState.imageUrls || [])]
    node.assets.input.videos = [...(mediaState.videoUrls || [])]
    node.assets.input.audio = [...(mediaState.audioUrls || [])]
    mediaState.allUrls = [
      ...(mediaState.imageUrls || []),
      ...(mediaState.videoUrls || []),
      ...(mediaState.audioUrls || []),
    ]
    return mediaState.allUrls
  }

  function fileNameFromUrl(url = '', fallbackBase = 'asset') {
    try {
      const parsed = new URL(String(url || ''), window.location.origin)
      const filename = parsed.searchParams.get('filename')
      if (filename && filename.includes('.')) return filename
    } catch (_) {
      /* fall through to path parsing */
    }

    const safeUrl = String(url || '').split('?')[0].split('#')[0]
    const tail = safeUrl.split('/').pop() || ''
    if (tail && tail.includes('.')) return tail
    const kind = deriveMediaKind(url)
    if (kind === 'video') return `${fallbackBase}.mp4`
    if (kind === 'audio') return `${fallbackBase}.mp3`
    return `${fallbackBase}.png`
  }

  async function urlToUploadableFile(url, fallbackName = 'asset.png') {
    const safeUrl = String(url || '').trim()
    if (!safeUrl) return null

    if (safeUrl.startsWith('data:')) {
      const match = safeUrl.match(/^data:([^;,]+)?(;base64)?,/)
      const mime = match && match[1] ? match[1] : 'image/png'
      const res = await fetch(safeUrl)
      const blob = await res.blob()
      const ext = mime.split('/')[1] || 'png'
      const fileName = fallbackName.includes('.') ? fallbackName : `${fallbackName}.${ext}`
      return new File([blob], fileName, { type: mime })
    }

    if (safeUrl.startsWith('blob:')) {
      const res = await fetch(safeUrl)
      const blob = await res.blob()
      return new File([blob], fallbackName, { type: blob.type || 'application/octet-stream' })
    }

    try {
      const res = await fetch(safeUrl)
      if (!res.ok) return null

      const blob = await res.blob()
      return new File([blob], fallbackName, {
        type: blob.type || res.headers.get('content-type') || 'application/octet-stream'
      })
    } catch (e) {
      console.warn('Could not convert dropped media URL to an uploadable file:', safeUrl, e)
      return null
    }
  }

  function getCompositeSourceItems(compositeNode) {
    const members = compositeNode?.combinedNodes || []
    const items = []

    members.forEach(node => {
      const outputs = getOutputMediaUrls(node)

      if (outputs.length) {
        outputs.forEach(url => {
          items.push({
            url,
            type: deriveMediaKind(url),
            label: node.displayName || node.label || node.module_id || '状态'
          })
        })
      } else {
        items.push({
          url: '',
          type: 'empty',
          label: node.displayName || node.label || node.module_id || '状态'
        })
      }
    })

    return items
  }

  function getCompositeHeight(compositeNode) {
    const sourceItems = getCompositeSourceItems(compositeNode)
    const visibleCount = Math.min(sourceItems.length, 4)
    const rows = visibleCount <= 2 ? 1 : 2
    const tileHeight = rows === 1 ? 74 : 64
    const gridHeight = rows === 1 ? tileHeight : tileHeight * 2 + 6

    // header + body padding + sources row + grid + bottom safe
    return 52 + 8 + 18 + 8 + gridHeight + 12
  }

  function extractPromptState(node) {
    const p = node.parameters || {}
    return {
      note: p.text || p.prompt_note || p.global_context || '',
      positive: p.positive_prompt || '',
      negative: p.negative_prompt || '',
      positiveCues: Array.isArray(p.positive_cues) ? p.positive_cues : null,
      negativeCues: Array.isArray(p.negative_cues) ? p.negative_cues : null
    }
  }

  function shouldShowPromptInput(node) {
    const p = node?.parameters || {}
    const hasPositive = typeof p.positive_prompt === 'string' && p.positive_prompt.trim() !== ''
    const hasNegative = typeof p.negative_prompt === 'string' && p.negative_prompt.trim() !== ''
    return !(hasPositive || hasNegative)
  }

  function syncPromptState(node, next, emit) {
    if (!node.parameters) node.parameters = {}
    node.parameters.text = next.note || ''
    node.parameters.prompt_note = next.note || ''
    node.parameters.positive_prompt = next.positive || ''
    node.parameters.negative_prompt = next.negative || ''
    node.parameters.positive_cues = Array.isArray(next.positiveCues) ? next.positiveCues : []
    node.parameters.negative_cues = Array.isArray(next.negativeCues) ? next.negativeCues : []
    emit('update-node-parameters', node.id, node.parameters)
  }

  function createHiddenUploader(parent, node, emit, onLocalUrls) {
    const input = parent.append('xhtml:input')
      .attr('type', 'file')
      .attr('accept', 'image/*,video/*,audio/*')
      .attr('multiple', true)
      .style('display', 'none')
      .on('change', function () {
        const files = Array.from(this.files || [])
        if (!files.length) return
        const localUrls = files.map(file => URL.createObjectURL(file))
        onLocalUrls(localUrls, files)
        emit('upload-media', node.id, files)
        this.value = ''
      })
    return input
  }

  const TINY_BUTTON_SIZES = {
    xs: { size: '18px', padding: '0 6px', font: '10px' },
    sm: { size: '22px', padding: '0 7px', font: '11px' },
    md: { size: '24px', padding: '0 9px', font: '12px' }
  }

  // 语义配色：默认灰、主操作蓝、危险红。hover 时整块反显。
  const TINY_BUTTON_TONES = {
    default: { border: '#d1d5db', color: '#4b5563', hoverBg: '#4b5563', hoverBorder: '#4b5563' },
    primary: { border: '#bfdbfe', color: '#2563eb', hoverBg: '#2563eb', hoverBorder: '#2563eb' },
    danger:  { border: '#fecaca', color: '#dc2626', hoverBg: '#dc2626', hoverBorder: '#dc2626' }
  }

  function buildTinyButton(parent, text, title, onClick, options = {}) {
    const { size = 'xs', tone = 'default' } = options
    const dim = TINY_BUTTON_SIZES[size] || TINY_BUTTON_SIZES.xs
    const palette = TINY_BUTTON_TONES[tone] || TINY_BUTTON_TONES.default
    // 只放图标或单字符时强制正圆：左右内边距会把宽度撑开，变成椭圆。
    const circle = options.circle !== undefined
      ? options.circle
      : String(text || '').length <= 1

    const button = parent.append('xhtml:button')
      .text(text)
      .attr('title', title || '')
      .style('height', dim.size)
      .style('width', circle ? dim.size : null)
      .style('min-width', dim.size)
      .style('padding', circle ? '0' : dim.padding)
      .style('flex-shrink', '0')
      .style('box-sizing', 'border-box')
      .style('display', 'inline-flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('border-radius', '999px')
      .style('border', `1px solid ${palette.border}`)
      .style('background', '#ffffff')
      .style('color', palette.color)
      .style('font-size', dim.font)
      .style('line-height', '1')
      .style('cursor', 'pointer')
      .style('transition', 'background 0.14s ease, color 0.14s ease, border-color 0.14s ease')
      .on('mousedown', ev => ev.stopPropagation())
      .on('click', function (ev) { ev.stopPropagation(); if (onClick) onClick(ev) })

    button
      .on('mouseenter.tone', function () {
        if (this.disabled) return
        d3.select(this)
          .style('background', palette.hoverBg)
          .style('color', '#ffffff')
          .style('border-color', palette.hoverBorder)
      })
      .on('mouseleave.tone', function () {
        d3.select(this)
          .style('background', '#ffffff')
          .style('color', palette.color)
          .style('border-color', palette.border)
      })

    return button
  }

  function appendMediaPreview(parent, url, type) {
    const safeType = type || deriveMediaKind(url)
    if (safeType === 'image') {
      return parent.append('xhtml:img')
        .attr('src', url)
        .attr('draggable', false)
        .style('width', '100%')
        .style('height', '100%')
        .style('object-fit', 'cover')
        .style('display', 'block')
    }

    if (safeType === 'video') {
      return parent.append('xhtml:video')
        .attr('src', url)
        .attr('muted', true)
        .attr('loop', true)
        .attr('playsinline', true)
        .attr('preload', 'metadata')
        .style('width', '100%')
        .style('height', '100%')
        .style('object-fit', 'cover')
        .style('display', 'block')
        .on('loadedmetadata', function () {
          try {
            this.currentTime = Math.min(0.1, this.duration || 0)
          } catch (e) {}
        })
    }

    return parent.append('xhtml:div')
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'flex')
      .style('align-items', 'center')
      .style('justify-content', 'center')
      .style('font-size', '18px')
      .style('color', '#64748b')
      .text('音频')
  }
function getMediaBoxState(node, boxKey = 'default') {
  if (!node.__mediaBoxState) node.__mediaBoxState = {}

  if (!node.__mediaBoxState[boxKey]) {
    node.__mediaBoxState[boxKey] = {
      height: 72,      // 渲染后会按实际行高和行数重新测量
      minHeight: 60,
      tileMin: 48,     // 允许常见节点宽度下一行容纳 4 个结果
      userResized: false
    }
  }

  return node.__mediaBoxState[boxKey]
}

function applyMediaBoxStyle(sel, boxState) {
  return sel
    .style('position', 'relative')
    .style('width', '100%')
    .style('height', `${boxState.height}px`)
    .style('box-sizing', 'border-box')
    .style('border', '1px dashed #d1d5db')
    .style('border-radius', '10px')
    .style('background', '#fcfcfd')
    .style('overflow', 'hidden')
}

function buildMediaGrid(box, boxState) {
  return box.append('xhtml:div')
    .attr('class', 'media-box-grid')
    .style('position', 'absolute')
    .style('top', '7px')
    .style('left', '7px')
    .style('right', '7px')
    .style('bottom', '7px')
    .style('display', 'grid')
    // auto-fill 保留空轨道：只有一个项目时也与一行多个项目保持相同尺寸。
    .style('grid-template-columns', `repeat(auto-fill, minmax(${boxState.tileMin}px, 1fr))`)
    .style('grid-auto-rows', 'auto')
    .style('gap', '7px')
    .style('align-content', 'start')
    .style('width', 'auto')
    .style('height', 'auto')
    .style('overflow', 'hidden')
}

function updateMediaGridLayout(box, boxState) {
  box.style('height', `${boxState.height}px`)
  box.select('.media-box-grid')
    .style('grid-template-columns', `repeat(auto-fill, minmax(${boxState.tileMin}px, 1fr))`)
}

function syncMediaBoxHeight(box, grid, boxState, options = {}) {
  const { fitContent = true } = options

  requestAnimationFrame(() => {
    const gridEl = grid?.node?.() || grid
    if (!gridEl) return

    const children = Array.from(gridEl.children)
      .filter(child => !child.classList.contains('segment-empty-placeholder'))
    const firstTile = children[0]
    const firstRowHeight = firstTile?.getBoundingClientRect().height || 48
    const verticalInset = 14

    boxState.minHeight = Math.max(60, Math.ceil(firstRowHeight + verticalInset))

    if (fitContent && !boxState.userResized) {
      const contentHeight = Math.ceil(gridEl.scrollHeight + verticalInset)
      boxState.height = Math.max(boxState.minHeight, Math.min(220, contentHeight))
      box.style('height', `${boxState.height}px`)
    } else if (boxState.height < boxState.minHeight) {
      boxState.height = boxState.minHeight
      box.style('height', `${boxState.height}px`)
    }
  })
}

function addMediaBoxResizeHandle(box, boxState) {
  const handle = box.append('xhtml:div')
    .attr('class', 'media-box-resize-handle')
    .style('position', 'absolute')
    .style('right', '6px')
    .style('bottom', '6px')
    .style('width', '8px')
    .style('height', '8px')
    .style('background', '#9ca3af')
    .style('clip-path', 'polygon(100% 0, 0 100%, 100% 100%)')
    .style('cursor', 'ns-resize')
    .style('opacity', '0')
    .style('transition', 'opacity 120ms ease')
    .style('z-index', '8')
    .style('pointer-events', 'auto')

  box
    .on('mouseenter.media-box-handle', () => handle.style('opacity', '0.65'))
    .on('mouseleave.media-box-handle', () => handle.style('opacity', '0'))

  handle.on('mousedown', function (event) {
    event.preventDefault()
    event.stopPropagation()

    const startY = event.clientY
    const startHeight = boxState.height
    function onMouseMove(ev) {
      const dy = ev.clientY - startY

      // 这里只调整容器高度，缩略图尺寸始终由可用宽度和标准列宽决定。
      boxState.userResized = true
      boxState.height = Math.max(boxState.minHeight || 60, Math.min(220, startHeight + dy))

      updateMediaGridLayout(box, boxState)
    }

    function onMouseUp() {
          window.removeEventListener('mousemove', onMouseMove)
          window.removeEventListener('mouseup', onMouseUp)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
      })
    }

    function createMediaBox(parent, node, boxKey, options = {}) {
      const {
        makeDroppable = false,
        onDropMedia = null
      } = options

      const boxState = getMediaBoxState(node, boxKey)
      const box = parent.append('xhtml:div')
      applyMediaBoxStyle(box, boxState)

      const grid = buildMediaGrid(box, boxState)
      addMediaBoxResizeHandle(box, boxState)

      if (typeof ResizeObserver !== 'undefined') {
        let lastWidth = -1
        const observer = new ResizeObserver(() => {
          const boxEl = box.node()
          if (!boxEl?.isConnected) {
            observer.disconnect()
            return
          }

          const nextWidth = Math.round(boxEl.clientWidth)
          if (nextWidth === lastWidth) return
          lastWidth = nextWidth
          syncMediaBoxHeight(box, grid, boxState)
        })
        observer.observe(box.node())
      }

      if (makeDroppable) {
        box
          .on('dragover', ev => {
            ev.preventDefault()
            ev.stopPropagation()
            box.style('border-color', '#94a3b8').style('background', '#f8fafc')
          })
          .on('dragleave', ev => {
            ev.preventDefault()
            ev.stopPropagation()
            box.style('border-color', '#d1d5db').style('background', '#ffffff')
          })
          .on('drop', ev => {
            ev.preventDefault()
            ev.stopPropagation()
            box.style('border-color', '#d1d5db').style('background', '#ffffff')
            if (!onDropMedia) return

            const rawJson = ev.dataTransfer.getData('application/json')
            const rawText = ev.dataTransfer.getData('text/plain')
            let dragData = null

            try {
              dragData = JSON.parse(rawJson || rawText || '{}')
            } catch (e) {
              dragData = { url: rawText || '' }
            }

            const resolvedUrl =
              dragData?.mediaUrl ||
              dragData?.originalUrl ||
              dragData?.fullUrl ||
              dragData?.imageUrl ||
              dragData?.url ||
              dragData?.thumbnailUrl ||
              dragData?.clip?.mediaUrl ||
              dragData?.clip?.originalUrl ||
              dragData?.clip?.fullUrl ||
              dragData?.clip?.imageUrl ||
              dragData?.clip?.url ||
              dragData?.clip?.thumbnailUrl ||
              ''

            if (resolvedUrl) onDropMedia(resolvedUrl, dragData)
          })
      }

      return { box, grid, boxState }
    }


  function buildWorkflowCanvasDragPayload(node, url, type, extra = {}) {
    const safeUrl = String(url || '').trim()
    const output = node?.assets?.output || {}
    const input = node?.assets?.input || {}

    return {
      source: 'workflow-result',
      nodeId: node?.id || '',
      moduleId: node?.module_id || '',
      displayName: node?.displayName || node?.label || node?.module_id || '状态',
      type: type || deriveMediaKind(safeUrl),
      url: safeUrl,
      mediaUrl: safeUrl,
      originalUrl: safeUrl,
      fullUrl: safeUrl,
      imageUrl: safeUrl,
      thumbnailUrl: safeUrl,
      prompt: node?.parameters?.positive_prompt || node?.parameters?.text || '',
      output,
      input,
      ...extra,
    }
  }

  function attachWorkflowMediaDrag(selection, payloadFactory) {
    if (!selection || typeof payloadFactory !== 'function') return

    selection
      .attr('draggable', true)
      .style('cursor', 'grab')
      .on('dragstart', function (ev) {
        ev.stopPropagation()
        const payload = payloadFactory(this) || {}
        const json = JSON.stringify(payload)

        if (ev.dataTransfer) {
          ev.dataTransfer.effectAllowed = 'copy'
          ev.dataTransfer.setData('application/json', json)
          ev.dataTransfer.setData('text/plain', json)
          if (payload.mediaUrl || payload.url) {
            ev.dataTransfer.setData('text/uri-list', payload.mediaUrl || payload.url)
          }
        }
      })
      .on('dragend', function () {
        d3.select(this).style('cursor', 'grab')
      })
  }

  function renderThumbRow(parent, urls, options = {}) {
    const {
      emptyText = '暂无媒体',
      onThumbClick = null,
      onStageClick = null,
      makeDroppable = false,
      onDropMedia = null,
      boxed = false,
      node = null,
      boxKey = 'default'
    } = options

    const safeUrls = Array.isArray(urls) ? urls : []

    // 非 boxed 保留普通模式
    if (!makeDroppable && !boxed) {
      const row = parent.append('xhtml:div')
        .style('display', 'flex')
        .style('flex-wrap', 'wrap')
        .style('gap', '6px')

      if (!safeUrls.length) {
        row.append('xhtml:div')
          .style('font-size', '10px')
          .style('color', '#9ca3af')
          .text(emptyText)
        return row
      }

      safeUrls.forEach(url => {
        const type = deriveMediaKind(url)
        const wrap = row.append('xhtml:div')
          .style('width', '56px')
          .style('height', '56px')
          .style('box-sizing', 'border-box')
          .style('min-width', '0')
          .style('border-radius', '8px')
          .style('overflow', 'hidden')
          .style('border', '1px solid #e5e7eb')
          .style('background', '#f9fafb')
        appendMediaPreview(wrap, url, type)
      })

      return row
    }

    const { box, grid } = createMediaBox(parent, node, boxKey, {
      makeDroppable,
      onDropMedia
    })

    if (!safeUrls.length) {
      grid.append('xhtml:div')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'flex-start')
        .style('font-size', '10px')
        .style('color', '#9ca3af')
        .style('grid-column', '1 / -1')
        .style('height', '100%')
        .text(emptyText)

      syncMediaBoxHeight(box, grid, getMediaBoxState(node, boxKey))
      return box
    }

    safeUrls.forEach(url => {
      const type = deriveMediaKind(url)

      const tile = grid.append('xhtml:div')
        .style('position', 'relative')
        .style('width', '100%')
        .style('min-width', '0')
        .style('box-sizing', 'border-box')
        .style('aspect-ratio', '1 / 1')
        .style('border-radius', '10px')
        .style('overflow', 'hidden')
        .style('border', '1px solid #d8dde5')
        .style('background', '#ffffff')
        .style('cursor', 'pointer')
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => {
          ev.stopPropagation()
          if (onThumbClick) onThumbClick(url, type)
        })

      attachWorkflowMediaDrag(tile, () => buildWorkflowCanvasDragPayload(node, url, type))

      if (type === 'image') {
        tile.append('xhtml:img')
          .attr('src', url)
          .style('width', '100%')
          .style('height', '100%')
          .style('object-fit', 'cover')
          .style('display', 'block')
      } else if (type === 'video') {
        tile.append('xhtml:video')
          .attr('src', url)
          .attr('autoplay', true)
          .attr('muted', true)
          .attr('loop', true)
          .attr('playsinline', true)
          .style('width', '100%')
          .style('height', '100%')
          .style('object-fit', 'cover')
          .style('display', 'block')
      } else {
        tile.append('xhtml:div')
          .style('width', '100%')
          .style('height', '100%')
          .style('display', 'flex')
          .style('align-items', 'center')
          .style('justify-content', 'center')
          .style('font-size', '18px')
          .style('color', '#64748b')
          .text('♪')
      }

      if (onStageClick) {
        buildTinyButton(tile, '↗', '加入暂存区', () => onStageClick(url, type))
          .style('position', 'absolute')
          .style('top', '4px')
          .style('right', '4px')
          .style('background', 'rgba(255,255,255,0.94)')
          .style('z-index', '3')
      }
    })

    syncMediaBoxHeight(box, grid, getMediaBoxState(node, boxKey))

    return box
  }

  function buildFunctionSection(parent, node, emit) {
    const sec = buildCollapsibleSection(parent, 'Function', true)
    const row = sec.content.append('xhtml:div').style('display', 'flex').style('gap', '6px').style('align-items', 'center')
    const options = getWorkflowOptionIds(node.module_id)
    const select = row.append('xhtml:select')
      .style('flex', '1 1 auto').style('height', '24px').style('box-sizing', 'border-box').style('box-sizing', 'border-box').style('border', '1px solid #d1d5db').style('border-radius', '6px').style('background', '#ffffff').style('font-size', '10px').style('color', '#374151')
      .on('mousedown', ev => ev.stopPropagation())
    options.forEach(id => {
      const opt = select.append('xhtml:option').attr('value', id).text(id)
      if (id === node.module_id) opt.attr('selected', 'selected')
    })
    select.on('change', function () {
      const workflowId = this.value
      const nextParams = { ...getDefaultWorkflowParams(workflowId), text: node.parameters?.text || node.parameters?.prompt_note || '', prompt_note: node.parameters?.prompt_note || node.parameters?.text || '', positive_prompt: node.parameters?.positive_prompt || '', negative_prompt: node.parameters?.negative_prompt || '', positive_cues: node.parameters?.positive_cues || [], negative_cues: node.parameters?.negative_cues || [] }
      node.parameters = nextParams
      emit('refresh-node', node.id, workflowId, nextParams, workflowId)
    })
    return sec
  }

  function buildPromptSection(parent, node, emit, inputMediaResolver = null) {
    const promptState = extractPromptState(node)
    const CUE_SEP = ' | '
    const cueTypes = ['relation', 'entity', 'attribute']
    const cueBaseColor = getNodeBorderColor(node) || '#94a3b8'
    const CUE_COLOR_OPACITY = 0.6
    const CUE_HOVER_OPACITY = 0.9
    const cuePalette = deriveCuePalette(cueBaseColor)
    const CUE_ROW_RADIUS = '8px'
    const CUE_INPUT_RADIUS = '6px'
    const CUE_INPUT_HEIGHT = '22px'
    const CUE_ROW_PADDING = '3px 4px 3px 7px'

    function clampColorValue(value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    function resolveRgbColor(cssColor) {
      const probe = document.createElement('span')
      probe.style.display = 'none'
      probe.style.color = cssColor
      document.body.appendChild(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()

      const channels = resolved.match(/[\d.]+/g)?.slice(0, 3).map(Number)
      if (!channels || channels.length < 3 || channels.some(value => !Number.isFinite(value))) {
        return { r: 148, g: 163, b: 184 }
      }
      return { r: channels[0], g: channels[1], b: channels[2] }
    }

    function rgbToHsl({ r, g, b }) {
      const red = r / 255
      const green = g / 255
      const blue = b / 255
      const max = Math.max(red, green, blue)
      const min = Math.min(red, green, blue)
      const delta = max - min
      const lightness = (max + min) / 2
      let hue = 0
      let saturation = 0

      if (delta) {
        saturation = delta / (1 - Math.abs(2 * lightness - 1))
        if (max === red) hue = 60 * (((green - blue) / delta) % 6)
        else if (max === green) hue = 60 * ((blue - red) / delta + 2)
        else hue = 60 * ((red - green) / delta + 4)
      }

      return {
        h: (hue + 360) % 360,
        s: saturation * 100,
        l: lightness * 100
      }
    }

    function hslColor(hue, saturation, lightness, alpha = 1) {
      const normalizedHue = (hue + 360) % 360
      const color = `hsl(${normalizedHue.toFixed(1)} ${clampColorValue(saturation, 0, 100).toFixed(1)}% ${clampColorValue(lightness, 0, 100).toFixed(1)}%`
      return alpha < 1 ? `${color} / ${alpha})` : `${color})`
    }

    function cueColorWithOpacity(cssColor, opacity = CUE_COLOR_OPACITY) {
      const percentage = clampColorValue(opacity, 0, 1) * 100
      return `color-mix(in srgb, ${cssColor} ${percentage}%, transparent)`
    }

    function deriveCuePalette(cssColor) {
      const base = rgbToHsl(resolveRgbColor(cssColor))
      const saturation = base.s < 8 ? 0 : clampColorValue(base.s, 32, 78)
      const accentLightness = clampColorValue(base.l, 36, 62)

      return {
        relation: {
          color: hslColor(base.h - 14, saturation, accentLightness, CUE_COLOR_OPACITY),
          tint: hslColor(base.h - 14, saturation * 0.68, 90, CUE_COLOR_OPACITY),
          activeColor: hslColor(base.h - 14, saturation, accentLightness, CUE_HOVER_OPACITY),
          activeTint: hslColor(base.h - 14, saturation * 0.68, 90, CUE_HOVER_OPACITY)
        },
        entity: {
          color: hslColor(base.h, saturation * 0.86, accentLightness + 5, CUE_COLOR_OPACITY),
          tint: hslColor(base.h, saturation * 0.56, 94, CUE_COLOR_OPACITY),
          activeColor: hslColor(base.h, saturation * 0.86, accentLightness + 5, CUE_HOVER_OPACITY),
          activeTint: hslColor(base.h, saturation * 0.56, 94, CUE_HOVER_OPACITY)
        },
        attribute: {
          color: hslColor(base.h + 14, saturation * 0.72, accentLightness + 9, CUE_COLOR_OPACITY),
          tint: hslColor(base.h + 14, saturation * 0.48, 97, CUE_COLOR_OPACITY),
          activeColor: hslColor(base.h + 14, saturation * 0.72, accentLightness + 9, CUE_HOVER_OPACITY),
          activeTint: hslColor(base.h + 14, saturation * 0.48, 97, CUE_HOVER_OPACITY)
        }
      }
    }

    function normalizeForMatch(value) {
      return String(value || '').normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ')
    }

    function inferCueType(text, semanticCues = null) {
      const normalized = normalizeForMatch(text)
      const semanticGroups = [
        ['relation', semanticCues?.relations],
        ['entity', semanticCues?.entities],
        ['attribute', semanticCues?.attributes]
      ]
      for (const [type, values] of semanticGroups) {
        if ((values || []).some(value => normalizeForMatch(value) === normalized)) return type
      }

      const relationHints = /\b(in front of|behind|beside|between|inside|outside|above|below|under|over|next to|near|far from|holding|looking|facing|connected|attached|through|toward|around|across|following|leading|contains|wearing|carrying|placed|standing|sitting|camera|viewpoint)\b/i
      if (relationHints.test(String(text || ''))) return 'relation'
      return normalized.split(' ').filter(Boolean).length <= 2 ? 'entity' : 'attribute'
    }

    function normalizeCue(item, semanticCues = null) {
      const source = item && typeof item === 'object' ? item : { text: item }
      const text = String(source.text || '').trim()
      if (!text) return null
      const parsedWeight = Number.parseFloat(source.weight)
      const sourceType = String(source.type || '').trim().toLocaleLowerCase()
      const type = cueTypes.includes(sourceType) ? sourceType : inferCueType(text, semanticCues)
      return {
        ...source,
        text,
        weight: Number.isFinite(parsedWeight) ? parsedWeight : 1.0,
        type
      }
    }

    function parseOneCue(rawCue, semanticCues = null) {
      let body = String(rawCue || '').trim()
      body = body.replace(/^\(\s*/, '').replace(/\s*\)$/, '').trim()
      if (!body) return null

      let weight = 1.0
      const idx = body.lastIndexOf(':')
      if (idx >= 0) {
        const possibleWeight = body.slice(idx + 1).trim()
        if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(possibleWeight)) {
          weight = Number.parseFloat(possibleWeight)
          body = body.slice(0, idx).trim()
        }
      }
      return normalizeCue({ text: body, weight }, semanticCues)
    }

    function parseCueString(structuredCues, fallbackPrompt = '', semanticCues = null) {
      // 新数据优先使用结构化 cue；字符串解析只服务历史记录与旧后端。
      if (Array.isArray(structuredCues) && structuredCues.length) {
        return structuredCues.map(item => normalizeCue(item, semanticCues)).filter(Boolean)
      }

      const raw = String(fallbackPrompt || '').trim()
      if (!raw) return []
      let chunks
      if (raw.includes(CUE_SEP)) {
        chunks = raw.split(CUE_SEP)
      } else if (/\)\s*,\s*\(/.test(raw)) {
        chunks = raw.split(/\)\s*,\s*\(/)
      } else if (raw.startsWith('(') && raw.endsWith(')')) {
        chunks = [raw]
      } else {
        // 最后兼容无括号的旧逗号格式；这种格式本身无法区分 cue 内部逗号。
        chunks = raw.split(',')
      }
      return chunks.map(item => parseOneCue(item, semanticCues)).filter(Boolean)
    }

    function fmtWeight(weight) {
      const value = Number.parseFloat(weight)
      return (Number.isFinite(value) ? value : 1.0).toFixed(1)
    }

    function serializeCueList(list) {
      return (list || [])
        .filter(item => item && String(item.text || '').trim())
        .map(item => `(${String(item.text).trim()}:${fmtWeight(item.weight)})`)
        .join(CUE_SEP)
    }

    function sortCueEntries(list, type = null) {
      return (list || [])
        .map((phrase, index) => ({ phrase, index }))
        .filter(({ phrase }) => !type || phrase.type === type)
        .sort((a, b) => {
          const aWeight = Number.isFinite(Number.parseFloat(a.phrase.weight)) ? Number.parseFloat(a.phrase.weight) : 1.0
          const bWeight = Number.isFinite(Number.parseFloat(b.phrase.weight)) ? Number.parseFloat(b.phrase.weight) : 1.0
          return bWeight - aWeight || a.index - b.index
        })
    }

    let noteArea
    let noteAreaWrap
    let showPromptInput = shouldShowPromptInput(node)
    let positivePhrases = parseCueString(promptState.positiveCues, promptState.positive || promptState.note)
    let negativePhrases = parseCueString(promptState.negativeCues, promptState.negative)
    let positiveContainer, negativeContainer, positiveCount, negativeCount
    const collapsedCueGroups = { relation: false, entity: false, attribute: false }
    let speechSession = null
    let speechButton = null
    let speechListening = false
    let speechPolishing = false

    function syncPromptStateFromUI() {
      const next = {
        note: noteArea ? (noteArea.property('value') || '') : '',
        positive: serializeCueList(positivePhrases),
        negative: serializeCueList(negativePhrases),
        positiveCues: positivePhrases.map(item => ({ ...item })),
        negativeCues: negativePhrases.map(item => ({ ...item }))
      }
      syncPromptState(node, next, emit)
      return next
    }

    // 三个控件共用一套图标规格：按钮外形一致，靠图标本身区分。
    const ICON_SIZE = 13
    const iconWrap = body => `
      <svg aria-hidden="true" viewBox="0 0 24 24" width="${ICON_SIZE}" height="${ICON_SIZE}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

    const microphoneIcon = iconWrap(`
        <rect x="9" y="2" width="6" height="12" rx="3"></rect>
        <path d="M5 10a7 7 0 0 0 14 0"></path>
        <path d="M12 17v5"></path>
        <path d="M8 22h8"></path>`)

    // 停止录音：实心方块
    const stopIcon = iconWrap(`<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"></rect>`)

    // 机器人：方头 + 天线 + 两只眼睛，替代原来的字母 A
    const agentIcon = iconWrap(`
        <rect x="4" y="8" width="16" height="12" rx="3"></rect>
        <path d="M12 8V4"></path>
        <circle cx="12" cy="3" r="1.2"></circle>
        <path d="M2 13v3"></path>
        <path d="M22 13v3"></path>
        <circle cx="9" cy="14" r="1.15" fill="currentColor" stroke="none"></circle>
        <circle cx="15" cy="14" r="1.15" fill="currentColor" stroke="none"></circle>`)

    // 重新生成：两段首尾相接的弧线各带箭头，比单个 ↻ 更能读出「再跑一次」
    const regenerateIcon = iconWrap(`
        <path d="M20.5 12a8.5 8.5 0 0 1-14.5 6"></path>
        <path d="M3.5 12a8.5 8.5 0 0 1 14.5-6"></path>
        <polyline points="18 2.5 18 6 14.5 6"></polyline>
        <polyline points="6 21.5 6 18 9.5 18"></polyline>`)

    // 转写中的省略号与图标同尺寸，避免状态切换时视觉重量跳动
    const ellipsisIcon = `<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:${ICON_SIZE}px;height:${ICON_SIZE}px;font-size:${ICON_SIZE}px;line-height:1">…</span>`

    function updateSpeechButton() {
      if (!speechButton) return
      speechButton
        .html(speechPolishing ? ellipsisIcon : (speechListening ? stopIcon : microphoneIcon))
        .attr('title', !isSpeechInputSupported()
          ? '当前浏览器不支持语音输入'
          : (speechPolishing ? '正在润色语音文本' : (speechListening ? '停止语音输入' : '开始语音输入')))
        .style('opacity', speechPolishing ? '0.65' : '1')
    }

    function stopSpeechInput() {
      if (speechSession) {
        speechSession.stop()
        speechSession = null
      }
      speechListening = false
      updateSpeechButton()
    }

    function toggleSpeechInput() {
      if (!isSpeechInputSupported()) {
        updateSpeechButton()
        return
      }

      if (speechListening) {
        stopSpeechInput()
        return
      }

      try {
        speechSession = startBrowserSpeechInput({
          getValue: () => noteArea ? (noteArea.property('value') || '') : '',
          setValue: (value) => {
            if (!noteArea) return
            noteArea.property('value', value)
            syncPromptStateFromUI()
          },
          onStateChange: (isListening) => {
            speechListening = isListening
            if (!isListening) speechSession = null
            updateSpeechButton()
          },
          onPolishingChange: (isPolishing) => {
            speechPolishing = isPolishing
            updateSpeechButton()
          },
          onError: (error) => {
            console.warn('Speech input failed:', error)
          }
        })
      } catch (error) {
        console.warn('Speech input is unavailable:', error)
      }
    }

    function cueMentionsLabel(cueText, label) {
      const cue = normalizeForMatch(cueText)
      const target = normalizeForMatch(label)
      if (!cue || !target) return false
      if (/[^\u0000-\u00ff]/.test(target)) return cue.includes(target)
      const toWords = value => value.replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
      return ` ${toWords(cue)} `.includes(` ${toWords(target)} `)
    }

    function highlightCueOnCanvas(cueText) {
      const api = window.__canvasAPI
      if (!api?.highlightByLabels) return
      const labels = [...document.querySelectorAll('.canvas-image-label')]
        .map(element => element.textContent?.trim())
        .filter(label => label && cueMentionsLabel(cueText, label))
      api.highlightByLabels(labels)
    }

    function attachCueHover(selection, phrase) {
      selection
        .on('mouseenter', () => highlightCueOnCanvas(phrase.text))
        .on('mouseleave', () => window.__canvasAPI?.clearHighlight?.())
    }

    // --- cue 拖拽排序 ---
    // 权重不显示也不可直接编辑，但它决定渲染顺序，也是模型实际吃到的值。
    // 拖拽不产生新数值：把这一组已有的权重降序排好，按新位置重新落座。
    function roundWeight(value) {
      const parsed = Number.parseFloat(value)
      return Math.round((Number.isFinite(parsed) ? parsed : 1.0) * 10) / 10
    }

    function reassignWeightsByPosition(weights) {
      return [...weights].map(roundWeight).sort((a, b) => b - a)
    }

    let cueDragState = null

    function reorderPositiveCues(type, fromIndex, toIndex, placeAfter) {
      if (fromIndex === toIndex) return

      const groupIndices = sortCueEntries(positivePhrases, type).map(e => e.index)
      const from = groupIndices.indexOf(fromIndex)
      let to = groupIndices.indexOf(toIndex)
      if (from === -1 || to === -1) return

      const reordered = [...groupIndices]
      reordered.splice(from, 1)
      if (from < to) to -= 1
      reordered.splice(placeAfter ? to + 1 : to, 0, fromIndex)

      const weights = reassignWeightsByPosition(
        groupIndices.map(flatIndex => positivePhrases[flatIndex]?.weight)
      )
      const updated = reordered.map((flatIndex, position) => ({
        ...positivePhrases[flatIndex],
        weight: weights[position]
      }))

      // 权重可能重复（一位小数档位有限），排序的并列兜底是数组下标，
      // 因此物理次序必须跟着变，否则重新渲染时并列的几条会跳回原位。
      const slotQueue = [...groupIndices].sort((a, b) => a - b)
      const next = [...positivePhrases]
      slotQueue.forEach((slot, i) => { next[slot] = updated[i] })
      positivePhrases = next

      renderAllCueEditors()
      syncPromptStateFromUI()
    }

    function attachCueDrag(row, handle, entry, config) {
      const { index } = entry

      handle
        .attr('draggable', 'true')
        .style('cursor', 'grab')
        .on('mousedown', ev => ev.stopPropagation())
        .on('dragstart', function (ev) {
          cueDragState = { index, type: config.type }
          this.style.cursor = 'grabbing'
          row.style('opacity', '0.45')
          try {
            ev.dataTransfer.effectAllowed = 'move'
            // Firefox 要求写入数据才会触发后续 drag 事件
            ev.dataTransfer.setData('text/plain', String(index))
          } catch (_) { /* 某些环境禁止写 dataTransfer */ }
        })
        .on('dragend', function () {
          cueDragState = null
          this.style.cursor = 'grab'
          row.style('opacity', '1').style('box-shadow', 'none')
        })

      const clearDropHint = () => row.style('box-shadow', 'none')

      row
        .on('dragover', function (ev) {
          if (!cueDragState || cueDragState.type !== config.type) return
          if (cueDragState.index === index) return
          ev.preventDefault()
          ev.dataTransfer.dropEffect = 'move'
          const rect = this.getBoundingClientRect()
          const after = (ev.clientY - rect.top) > rect.height / 2
          row.style('box-shadow', after
            ? `inset 0 -2px 0 0 ${config.color}`
            : `inset 0 2px 0 0 ${config.color}`)
        })
        .on('dragleave', clearDropHint)
        .on('drop', function (ev) {
          if (!cueDragState || cueDragState.type !== config.type) return
          ev.preventDefault()
          ev.stopPropagation()
          clearDropHint()
          const rect = this.getBoundingClientRect()
          const after = (ev.clientY - rect.top) > rect.height / 2
          reorderPositiveCues(config.type, cueDragState.index, index, after)
          cueDragState = null
        })
    }

    function updatePositiveCue(index, patch) {
      positivePhrases = positivePhrases.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
      syncPromptStateFromUI()
    }

    function addPositiveCue(type, afterIndex = null) {
      const next = [...positivePhrases]
      const insertAt = Number.isInteger(afterIndex) ? afterIndex + 1 : next.length
      next.splice(insertAt, 0, { text: '', weight: 1.0, type })
      positivePhrases = next
      renderAllCueEditors()
      syncPromptStateFromUI()
    }

    function deletePositiveCue(index) {
      positivePhrases = positivePhrases.filter((_, itemIndex) => itemIndex !== index)
      renderAllCueEditors()
      syncPromptStateFromUI()
    }

    function renderPositiveCue(parent, entry, config) {
      const { phrase, index } = entry
      const row = parent.append('xhtml:div')
        .style('display', 'grid')
        .style('grid-template-columns', '10px minmax(0, 1fr) 18px 18px')
        .style('align-items', 'center')
        .style('gap', '4px')
        .style('width', '100%')
        .style('box-sizing', 'border-box')
        .style('margin', '0 0 4px')
        .style('padding', '3px 4px 3px 3px')
        .style('border-radius', CUE_ROW_RADIUS)
        .style('border-left', `2px solid ${config.color}`)
        .style('background', config.tint)
        .style('transition', 'box-shadow 0.14s ease, background 0.14s ease, border-color 0.14s ease')

      attachCueHover(row, phrase)

      // 拖拽把手。只有它可拖，输入框仍可正常选中文字。
      const handle = row.append('xhtml:div')
        .attr('title', '拖动调整顺序（顺序即权重）')
        .style('width', '10px')
        .style('height', CUE_INPUT_HEIGHT)
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('font-size', '9px')
        .style('line-height', '1')
        .style('letter-spacing', '-1px')
        .style('color', config.color)
        .style('opacity', '0.8')
        .style('user-select', 'none')
        .style('flex-shrink', '0')
        .text('⋮⋮')

      row.on('mouseenter.cueHandle', () => handle.style('opacity', '1'))
      row.on('mouseleave.cueHandle', () => handle.style('opacity', '0.8'))

      attachCueDrag(row, handle, entry, config)
      row
        .on('mouseenter.cueRowStyle', function () {
          this.style.background = config.activeTint
          this.style.borderLeftColor = config.activeColor
          this.style.boxShadow = `0 0 0 1px ${config.activeColor}`
          handle.style('color', config.activeColor)
        })
        .on('mouseleave.cueRowStyle', function () {
          this.style.background = config.tint
          this.style.borderLeftColor = config.color
          this.style.boxShadow = 'none'
          handle.style('color', config.color)
        })

      const input = row.append('xhtml:input')
        .attr('type', 'text')
        .attr('value', phrase.text || '')
        .attr('class', 'phrase-input phrase-input-wide')
        .style('width', '100%')
        .style('min-width', '0')
        .style('height', CUE_INPUT_HEIGHT)
        .style('border', 'none')
        .style('border-radius', CUE_INPUT_RADIUS)
        .style('padding', '0 5px')
        .style('font-size', '10px')
        .style('color', '#3f4752')
        .style('background', 'transparent')
        .style('outline', 'none')
        .style('--cue-focus-color', cueColorWithOpacity(cueBaseColor))
        .style('--cue-focus-ring', cueColorWithOpacity(cueBaseColor, 0.24 * CUE_COLOR_OPACITY))
        .style('--cue-selection-color', cueColorWithOpacity(cueBaseColor, 0.32 * CUE_COLOR_OPACITY))
        .style('caret-color', cueColorWithOpacity(cueBaseColor))
        .on('mousedown', ev => ev.stopPropagation())
        .on('input', function () {
          phrase.text = this.value
          updatePositiveCue(index, { text: this.value })
        })

      buildTinyButton(row, '+', `在下方添加${config.label}线索`, () => addPositiveCue(config.type, index))
        .style('padding', '0')
        .style('min-width', '18px')
        .style('justify-self', 'end')
      buildTinyButton(row, '×', `删除${config.label}线索`, () => deletePositiveCue(index))
        .style('padding', '0')
        .style('min-width', '18px')
        .style('justify-self', 'end')
    }

    function renderPositiveEditor() {
      if (!positiveContainer) return
      positiveContainer.selectAll('*').remove()
      positiveCount.text(`(${positivePhrases.filter(item => String(item.text || '').trim()).length})`)

      const configs = [
        { type: 'relation', label: '关系', ...cuePalette.relation },
        { type: 'entity', label: '实体', ...cuePalette.entity },
        { type: 'attribute', label: '属性', ...cuePalette.attribute }
      ]

      configs.forEach(config => {
        const entries = sortCueEntries(positivePhrases, config.type)
        const group = positiveContainer.append('xhtml:div')
          .style('border-left', `3px solid ${config.color}`)
          .style('padding-left', '5px')
          .style('margin-bottom', '5px')

        const head = group.append('xhtml:div')
          .style('display', 'flex')
          .style('align-items', 'center')
          .style('gap', '4px')
          .style('min-height', '20px')

        const toggle = head.append('xhtml:button')
          .attr('type', 'button')
          .attr('title', `${collapsedCueGroups[config.type] ? '展开' : '收起'}${config.label}`)
          .style('border', 'none')
          .style('padding', '0')
          .style('background', 'transparent')
          .style('font-size', '10px')
          .style('font-weight', '600')
          .style('color', '#4b5563')
          .style('cursor', 'pointer')
          .text(`${collapsedCueGroups[config.type] ? '▸' : '▾'} ${config.label} (${entries.length})`)

        const body = group.append('xhtml:div')
          .style('display', collapsedCueGroups[config.type] ? 'none' : 'block')
          .style('padding-top', '2px')

        toggle.on('click', ev => {
          ev.stopPropagation()
          collapsedCueGroups[config.type] = !collapsedCueGroups[config.type]
          renderPositiveEditor()
        })

        buildTinyButton(head, '+', `添加${config.label}线索`, () => addPositiveCue(config.type))
          .style('margin-left', 'auto')
          .style('padding', '0')
          .style('min-width', '18px')

        if (!entries.length) {
          body.append('xhtml:div')
            .style('font-size', '9px')
            .style('color', '#9ca3af')
            .style('padding', '2px 0')
            .text(`暂无${config.label}`)
        } else {
          entries.forEach(entry => renderPositiveCue(body, entry, config))
        }
      })
    }

    function renderNegativeEditor() {
      if (!negativeContainer) return
      negativeContainer.selectAll('*').remove()
      const entries = sortCueEntries(negativePhrases)
      negativeCount.text(`(${entries.filter(({ phrase }) => String(phrase.text || '').trim()).length})`)

      if (!entries.length) {
        negativeContainer.append('xhtml:div')
          .style('font-size', '9px')
          .style('color', '#9ca3af')
          .style('padding', '2px 0')
          .text('暂无负向提示词')
      }

      entries.forEach(({ phrase, index }) => {
        const row = negativeContainer.append('xhtml:div')
          .style('display', 'grid')
          .style('grid-template-columns', 'minmax(0, 1fr) 18px 18px')
          .style('gap', '4px')
          .style('align-items', 'center')
          .style('width', '100%')
          .style('box-sizing', 'border-box')
          .style('padding', CUE_ROW_PADDING)
          .style('border-left', '2px solid rgba(209, 213, 219, 0.6)')
          .style('border-radius', CUE_ROW_RADIUS)
          .style('background', 'rgba(247, 247, 247, 0.6)')
          .style('transition', 'box-shadow 0.14s ease, background 0.14s ease, border-color 0.14s ease')
          .style('margin-bottom', '4px')
        attachCueHover(row, phrase)
        row
          .on('mouseenter.cueRowStyle', function () {
            this.style.background = 'rgba(247, 247, 247, 0.9)'
            this.style.borderLeftColor = 'rgba(209, 213, 219, 0.9)'
            this.style.boxShadow = '0 0 0 1px rgba(107, 114, 128, 0.126)'
          })
          .on('mouseleave.cueRowStyle', function () {
            this.style.background = 'rgba(247, 247, 247, 0.6)'
            this.style.borderLeftColor = 'rgba(209, 213, 219, 0.6)'
            this.style.boxShadow = 'none'
          })

        row.append('xhtml:input')
          .attr('type', 'text')
          .attr('value', phrase.text || '')
          .attr('class', 'phrase-input phrase-input-wide')
          .style('width', '100%')
          .style('min-width', '0')
          .style('height', CUE_INPUT_HEIGHT)
          .style('border', 'none')
          .style('border-radius', CUE_INPUT_RADIUS)
          .style('padding', '0 5px')
          .style('font-size', '10px')
          .style('color', '#3f4752')
          .style('background', 'transparent')
          .style('outline', 'none')
          .style('--cue-focus-color', cueColorWithOpacity(cueBaseColor))
          .style('--cue-focus-ring', cueColorWithOpacity(cueBaseColor, 0.24 * CUE_COLOR_OPACITY))
          .style('--cue-selection-color', cueColorWithOpacity(cueBaseColor, 0.32 * CUE_COLOR_OPACITY))
          .style('caret-color', cueColorWithOpacity(cueBaseColor))
          .on('mousedown', ev => ev.stopPropagation())
          .on('input', function () {
            phrase.text = this.value
            negativePhrases = negativePhrases.map((item, itemIndex) => itemIndex === index ? { ...item, text: this.value } : item)
            syncPromptStateFromUI()
          })

        buildTinyButton(row, '+', '在下方添加负向提示词', () => {
          const next = [...negativePhrases]
          next.splice(index + 1, 0, { text: '', weight: 1.0, type: 'attribute' })
          negativePhrases = next
          renderNegativeEditor()
          syncPromptStateFromUI()
        }).style('padding', '0').style('min-width', '18px').style('justify-self', 'end')
        buildTinyButton(row, '×', '删除负向提示词', () => {
          negativePhrases = negativePhrases.filter((_, itemIndex) => itemIndex !== index)
          renderNegativeEditor()
          syncPromptStateFromUI()
        }).style('padding', '0').style('min-width', '18px').style('justify-self', 'end')
      })
    }

    function renderAllCueEditors() {
      renderPositiveEditor()
      renderNegativeEditor()
    }

    const sec = buildCollapsibleSection(parent, '提示词', true, (controls) => {
      speechButton = buildTinyButton(controls, '', '开始语音输入', toggleSpeechInput)
      updateSpeechButton()

      buildTinyButton(controls, '', 'Agent 辅助', async () => {
        try {
          clearPrevAgentContext()

          if (noteAreaWrap) {
            noteAreaWrap.style('display', 'none')
          }

          const mediaUrl = inputMediaResolver ? inputMediaResolver() : (getInputMediaUrls(node)[0] || '')
          const payload = {
            user_input: noteArea.property('value') || '',
            node_id: node.id,
            image_url: mediaUrl || '',
            workflow_context: { current_workflow: node.module_id, parent_nodes: node.originalParents || [] }
          }
          const res = await fetch('/api/agents/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
          const data = await res.json()
          setPrevAgentContext({
            global_context: data.global_context || '',
            intent: data.intent || '',
            selected_workflow: data.selected_workflow || '',
            knowledge_context: data.knowledge_context || '',
            image_caption: data.image_caption || '',
            style: data.style || ''
          })
        const note = data.message?.text || noteArea.property('value') || ''
        noteArea.property('value', note)

        positivePhrases = parseCueString(
          data.message?.positive_cues,
          data.message?.positive || '',
          data.semantic_cues
        )
        negativePhrases = parseCueString(data.message?.negative_cues, data.message?.negative || '')

        renderAllCueEditors()

        syncPromptStateFromUI()

        } catch (err) {
          console.error('Agent assist failed:', err)
        }
      }).html(agentIcon)

      buildTinyButton(controls, '', '重新生成', () => {
        const next = syncPromptStateFromUI()
        const regenerated = { ...(node.parameters || {}) }
        regenerated.text = next.note
        regenerated.prompt_note = next.note
        regenerated.positive_prompt = next.positive
        regenerated.negative_prompt = next.negative
        emit('regenerate-node', node.id, node.module_id, regenerated)
      }).html(regenerateIcon)

      
    })

    noteAreaWrap = sec.content.append('xhtml:div')
      .style('display', showPromptInput ? 'block' : 'none')
      .style('width', '100%')

    noteArea = noteAreaWrap.append('xhtml:textarea')
      .attr('class', 'thin-scroll')
      .style('width', '100%')
      .style('box-sizing', 'border-box')
      .style('min-height', '54px')
      .style('padding', '6px 8px')
      .style('font-size', '10px')
      .style('border', '1px solid #e5e7eb')
      .style('border-radius', '8px')
      .style('background', '#f9fafb')
      .style('resize', 'none')
      .style('outline', 'none')
      .attr('placeholder', '描述场景、操作或目标效果...')
      .property('value', promptState.note)
      .on('mousedown', ev => ev.stopPropagation())
      .on('blur', () => syncPromptStateFromUI())

    const cuesRow = sec.content.append('xhtml:div')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '8px')
      .style('margin-top', '6px')

    const posWrap = cuesRow.append('xhtml:div').style('display', 'flex').style('flex-direction', 'column').style('gap', '4px')
    const posHead = posWrap.append('xhtml:div').style('display', 'flex').style('align-items', 'center').style('gap', '6px')
    posHead.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text('正向提示词')
    positiveCount = posHead.append('xhtml:span').style('font-size', '10px').style('color', '#9ca3af').text('(0)')
    positiveContainer = posWrap.append('xhtml:div')

    const negWrap = cuesRow.append('xhtml:div').style('display', 'flex').style('flex-direction', 'column').style('gap', '4px')
    const negHead = negWrap.append('xhtml:div').style('display', 'flex').style('align-items', 'center').style('gap', '6px')
    negHead.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text('负向提示词')
    negativeCount = negHead.append('xhtml:span').style('font-size', '10px').style('color', '#9ca3af').text('(0)')
    buildTinyButton(negHead, '+', '添加负向提示词', () => {
      negativePhrases = [...negativePhrases, { text: '', weight: 1.0, type: 'attribute' }]
      renderNegativeEditor()
      syncPromptStateFromUI()
    }).style('margin-left', 'auto')
    negativeContainer = negWrap.append('xhtml:div')

    renderAllCueEditors()

    return sec
  }

  
  function buildAssetsSection(parent, node, emit, state) {
    const mediaState = getInputMediaState(node, state)
    state.inputUrls = [...mediaState.allUrls]

    const appendLocalUrls = (urls = [], forcedType = null) => {
      const list = Array.isArray(urls) ? urls : []
      list.forEach(url => {
        const resolvedType = forcedType || deriveMediaKind(url)
        if (resolvedType === 'video') {
          if (!mediaState.videoUrls.includes(url)) mediaState.videoUrls.push(url)
        } else if (resolvedType === 'audio') {
          if (!mediaState.audioUrls.includes(url)) mediaState.audioUrls.push(url)
        } else {
          if (!mediaState.imageUrls.includes(url)) mediaState.imageUrls.push(url)
        }
      })
      state.inputUrls = syncNodeInputAssets(node, mediaState)
    }

    const sec = buildCollapsibleSection(parent, '素材', true, (controls) => {
      const uploader = createHiddenUploader(controls, node, emit, (localUrls, files = []) => {
        files.forEach((file, idx) => {
          appendLocalUrls([localUrls[idx]], file?.type?.startsWith('video/')
            ? 'video'
            : file?.type?.startsWith('audio/')
              ? 'audio'
              : 'image')
        })
        renderRow()
      })
      buildTinyButton(controls, '+', '上传素材', () => uploader.node().click())
    })

    const contentRoot = sec.content.append('xhtml:div')

    const renderRow = () => {
      contentRoot.selectAll('*').remove()
      renderThumbRow(contentRoot, state.inputUrls, {
        emptyText: '上传或拖入输入素材',
        makeDroppable: true,
        node,
        boxKey: 'assets',
        onDropMedia: async (resolvedUrl, dragData = {}) => {
          const resolvedType = dragData?.type || dragData?.clip?.type || deriveMediaKind(resolvedUrl)
          const uploadFile = await urlToUploadableFile(
            resolvedUrl,
            fileNameFromUrl(resolvedUrl, `asset-${resolvedType}`)
          )
          if (uploadFile) {
            appendLocalUrls([resolvedUrl], resolvedType)
            renderRow()
            emit('upload-media', node.id, [uploadFile])
          } else {
            console.warn('Dropped asset could not be uploaded:', resolvedUrl)
          }
        },
        onThumbClick: (url, type) => emit('open-preview', url, type)
      })
    }
    renderRow()
    return sec
  }

  function buildResultsSection(parent, node, emit, state) {
    const sec = buildCollapsibleSection(parent, '结果', true)

    const root = sec.content
      .append('xhtml:div')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '6px')

    const outputUrls = Array.isArray(state?.outputUrls) ? state.outputUrls : []
    const hasOutput = outputUrls.length > 0
    const hasSegment = hasSegmentData(node)
    const isSegmentNode = isSegmentOnlyNode(node)
    const segmentHostKey = getSegmentHostKey(node)

    // 情况 A：segment 节点
    // 只显示 segment 内容，不显示原 generate results
    if (isSegmentNode) {
      const { box } = createMediaBox(root, node, 'results')

      box.append('xhtml:div')
        .attr('class', 'segment-empty-placeholder')
        .style('position', 'absolute')
        .style('left', '10px')
        .style('top', '10px')
        .style('font-size', '10px')
        .style('color', '#9ca3af')
        .style('pointer-events', 'none')
        .text(hasSegment ? '' : '暂无分割结果')

      box.append('xhtml:div')
        .attr('id', `entities-${segmentHostKey}`)
        .attr('class', 'segment-results-host')
        .style('position', 'absolute')
        .style('top', '7px')
        .style('left', '7px')
        .style('right', '7px')
        .style('bottom', '7px')
        .style('display', 'grid')
        .style('grid-template-columns', 'repeat(auto-fill, minmax(48px, 1fr))')
        .style('grid-auto-rows', 'max-content')
        .style('align-content', 'flex-start')
        .style('gap', '7px')
        .style('overflow-x', 'hidden')
        .style('overflow-y', 'auto')
        .style('pointer-events', 'auto')

      return sec
    }

    // 情况 B：普通生成节点
    if (hasOutput) {
      renderThumbRow(root, outputUrls, {
        emptyText: '暂无生成结果',
        boxed: true,
        node,
        boxKey: 'results',
        onThumbClick: (url, type) => emit('open-preview', url, type),
        onStageClick: (url, type) => emit('add-clip', node, url, type)
      })
    } else {
      renderThumbRow(root, [], {
        emptyText: '暂无生成结果',
        boxed: true,
        node,
        boxKey: 'results'
      })
    }

    return sec
  }

  function shouldShowFeedback(node) {
    const category = getNodeCategory(node)
    const excludedModules = new Set(['Upload', 'TextImage', 'AddText', 'AddWorkflow'])
    return ['image', 'video', 'audio'].includes(category) && !excludedModules.has(node.module_id)
  }

  function buildFeedbackSection(parent, node, emit) {
    const options = [
      { value: 'exact', label: '完全正确' },
      { value: 'reframed', label: '不同但更好' },
      { value: 'deferred', label: '不同但保留' },
      { value: 'redo', label: '重做' }
    ]
    const savedFeedback = node.parameters?.generation_feedback || {}
    let selectedValue = options.some(option => option.value === savedFeedback.value)
      ? savedFeedback.value
      : ''
    let submitButton = null
    let status = null

    const setSubmitting = (submitting) => {
      if (!submitButton) return
      submitButton
        .property('disabled', submitting)
        .attr('aria-disabled', submitting ? 'true' : 'false')
        .style('opacity', '1')
        .style('cursor', submitting ? 'default' : 'pointer')
    }

    const setStatus = (message = '', color = '#64748b') => {
      if (!status) return
      status
        .text(message)
        .style('color', color)
        .style('display', message ? 'block' : 'none')
    }

    const submitFeedback = () => {
      if (!selectedValue) {
        setStatus('请选择一项')
        return
      }
      const selected = options.find(option => option.value === selectedValue)
      if (!selected) return

      const feedback = {
        value: selected.value,
        label: selected.label,
        submitted_at: new Date().toISOString(),
        media_type: getNodeCategory(node),
        output_urls: getOutputMediaUrls(node)
      }

      setSubmitting(true)
      setStatus('提交中...', '#6b7280')
      emit('submit-feedback', node.id, feedback, (succeeded) => {
        if (succeeded) {
          setStatus('已提交')
        } else {
          setStatus('提交失败', '#9f5f5f')
          setSubmitting(false)
        }
      })
    }

    const sec = buildCollapsibleSection(parent, '反馈', false, (controls) => {
      submitButton = buildTinyButton(controls, '', '提交反馈', submitFeedback)
        .attr('aria-label', '提交反馈')
        .html('<svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2 8L8 2M4 2h4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')
    })

    const list = sec.content.append('xhtml:div')
      .style('display', 'grid')
      .style('grid-template-columns', 'minmax(0, 1fr) minmax(0, 1fr)')
      .style('column-gap', '4px')
      .style('row-gap', '1px')
      .style('padding', '0 2px')

    const radioName = `generation-feedback-${String(node.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`
    options.forEach(option => {
      const row = list.append('xhtml:label')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('gap', '4px')
        .style('min-width', '0')
        .style('min-height', '18px')
        .style('padding', '0 3px')
        .style('border-radius', '5px')
        .style('font-size', '9px')
        .style('color', '#4b5563')
        .style('cursor', 'pointer')
        .on('mousedown', event => event.stopPropagation())
        .on('click', event => event.stopPropagation())
        .on('mouseenter', function () { d3.select(this).style('background', '#f7f7f7') })
        .on('mouseleave', function () { d3.select(this).style('background', 'transparent') })

      row.append('xhtml:input')
        .attr('type', 'radio')
        .attr('name', radioName)
        .attr('value', option.value)
        .property('checked', selectedValue === option.value)
        .style('width', '11px')
        .style('height', '11px')
        .style('flex', '0 0 11px')
        .style('margin', '0')
        .style('accent-color', getNodeBorderColor(node))
        .style('cursor', 'pointer')
        .on('change', function () {
          selectedValue = this.value
          setStatus('')
        })

      row.append('xhtml:span')
        .style('min-width', '0')
        .style('white-space', 'nowrap')
        .text(option.label)
    })

    status = list.append('xhtml:div')
      .style('display', 'none')
      .style('grid-column', '1 / -1')
      .style('padding', '1px 3px 0 18px')
      .style('font-size', '8px')
      .style('color', '#64748b')

    return sec
  }

  function buildSettingsSection(parent, node) {
    const sec = buildCollapsibleSection(parent, '设置', false)
    const params = node.parameters || {}
    const excluded = new Set(['text', 'prompt_note', 'global_context', 'positive_prompt', 'negative_prompt', 'generation_feedback'])
    const keys = Object.keys(params).filter(k => !excluded.has(k))
    if (!keys.length) {
      sec.content.append('xhtml:div').style('font-size', '10px').style('color', '#9ca3af').text('当前功能没有可调参数')
      return sec
    }
    const grid = sec.content.append('xhtml:div').style('display', 'grid').style('grid-template-columns', '1fr').style('gap', '6px').style('width', '100%')
    keys.forEach(key => {
      const val = params[key]
      const field = grid.append('xhtml:div').style('display', 'flex').style('flex-direction', 'column').style('gap', '4px')
      field.append('xhtml:div').style('font-size', '10px').style('font-weight', '600').style('color', '#6b7280').text(key.replace(/_/g, ' '))
      if (key === 'camera_pose') {
        const select = field.append('xhtml:select').attr('class', 'node-input').attr('data-key', key).style('height', '24px').style('box-sizing', 'border-box').style('border', '1px solid #d1d5db').style('border-radius', '6px').style('font-size', '10px').style('background', '#ffffff').on('mousedown', ev => ev.stopPropagation())
        ;['Pan Up','Pan Down','Pan Left','Pan Right','Zoom In','Zoom Out','Anti Clockwise (ACW)','ClockWise (CW)'].forEach(opt => {
          const option = select.append('xhtml:option').attr('value', opt).text(opt)
          if (val === opt) option.attr('selected', 'selected')
        })
      } else {
        field.append('xhtml:input').attr('class', 'node-input').attr('data-key', key).attr('type', typeof val === 'number' ? 'number' : 'text').attr('value', val).style('height', '24px').style('box-sizing', 'border-box').style('border', '1px solid #d1d5db').style('border-radius', '6px').style('font-size', '10px').style('padding', '0 6px').style('background', '#ffffff').on('mousedown', ev => ev.stopPropagation())
      }
    })
    return sec
  }

  function renderUnifiedVisualNode(gEl, d, selectedIds, emit) {
    const state = { inputUrls: [...getInputMediaUrls(d)], outputUrls: [...getOutputMediaUrls(d)] }
    const fo = gEl.append('foreignObject').attr('width', d.calculatedWidth).attr('height', d.calculatedHeight).attr('x', -d.calculatedWidth / 2).attr('y', -d.calculatedHeight / 2).style('overflow', 'visible')
    const card = fo.append('xhtml:div').attr('class', 'node-card').attr('data-node-category', getNodeCategory(d)).style('width', '100%').style('height', '100%').style('display', 'flex').style('flex-direction', 'column').style('border-width', '2px').style('border-color', getNodeBorderColor(d)).style('border-radius', '10px').style('background', '#ffffff').style('position', 'relative').style('cursor', 'pointer').style('user-select', 'none').style('-webkit-user-select', 'none')
    setCardSelected(card, d, isVisuallySelected(d, selectedIds))
    addRightClickMenu(card, d, emit)
    card.on('click', ev => ev.stopPropagation())

    buildHeader(card, d)

    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '6px')
      .style('padding', '6px')
      .style('overflow-y', 'auto')
      .style('overflow-x', 'hidden')
      .style('width', '100%')
      .style('box-sizing', 'border-box')

    buildFunctionSection(body, d, emit)
    buildAssetsSection(body, d, emit, state)
    buildPromptSection(body, d, emit, () => state.inputUrls[0] || '')
    buildResultsSection(body, d, emit, state)
    buildSettingsSection(body, d)
    if (shouldShowFeedback(d)) buildFeedbackSection(body, d, emit)

    addResizeHandle(card, d, svgElement, allNodesData)
    addTooltip(gEl, d)

  }

  function renderUnifiedAudioNode(gEl, d, selectedIds, emit) {
    const state = { inputUrls: [...getInputMediaUrls(d)], outputUrls: [...getOutputMediaUrls(d)] }
    const fo = gEl.append('foreignObject').attr('width', d.calculatedWidth).attr('height', d.calculatedHeight).attr('x', -d.calculatedWidth / 2).attr('y', -d.calculatedHeight / 2).style('overflow', 'visible')
    const card = fo.append('xhtml:div').attr('class', 'node-card').attr('data-node-category', getNodeCategory(d)).style('width', '100%').style('height', '100%').style('display', 'flex').style('flex-direction', 'column').style('border-width', '2px').style('border-color', getNodeBorderColor(d)).style('border-radius', '10px').style('background', '#ffffff').style('position', 'relative').style('cursor', 'pointer').style('user-select', 'none').style('-webkit-user-select', 'none')
    setCardSelected(card, d, isVisuallySelected(d, selectedIds))
    addRightClickMenu(card, d, emit)
    card.on('click', ev => ev.stopPropagation())
    buildHeader(card, d)

    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('gap', '6px')
      .style('padding', '6px')
      .style('overflow-y', 'auto')
      .style('overflow-x', 'hidden')
      .style('width', '100%')
      .style('box-sizing', 'border-box')

    buildFunctionSection(body, d, emit)
    buildAssetsSection(body, d, emit, state)
    buildPromptSection(body, d, emit, () => state.inputUrls[0] || '')
    buildResultsSection(body, d, emit, state)
    buildSettingsSection(body, d)
    if (shouldShowFeedback(d)) buildFeedbackSection(body, d, emit)

    addResizeHandle(card, d, svgElement, allNodesData)
    addTooltip(gEl, d)
    
  }


  /**
   * Tooltip 辅助
   */
  function addTooltip(gEl, d) {
    const titleText =
      (d.module_id || '') +
      (d.created_at ? (' · ' + d.created_at) : '') +
      (d.status ? (' · ' + d.status) : '')
    gEl.attr('title', titleText)
  }

  /**
   * Intent Draft 辅助节点（AddText）：
   * 单栏结构，顶部 "Input Thought" + 右侧小发送按钮，下面是对话框文本框
   */
  function renderTextFullNode(gEl, d, selectedIds, emit) {
    const initialText =
      d.parameters?.global_context ||
      d.parameters?.text ||
      d.parameters?.positive_prompt ||
      ''

    const fo = gEl.append('foreignObject')
      .attr('width', d.calculatedWidth)
      .attr('height', d.calculatedHeight)
      .attr('x', -d.calculatedWidth / 2)
      .attr('y', -d.calculatedHeight / 2)
      .style('overflow', 'visible')

    const card = fo.append('xhtml:div')
      .attr('class', 'node-card')
      .attr('data-node-category', getNodeCategory(d))
      .style('width', '100%')
      .style('height', '100%')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('border-width', '2px')
      .style('border-color', getNodeBorderColor(d))
      .style('border-radius', '12px')
      .style('position', 'relative')
      .style('cursor', 'pointer')
      .style('background-color', '#ffffff')
      .style('box-shadow', '0 2px 8px rgba(15,23,42,0.05)')
      .style('user-select', 'none')
      .style('-webkit-user-select', 'none')

    // 选中样式（保留原逻辑）
    setCardSelected(card, d, isVisuallySelected(d, selectedIds))

    card.on('click', ev => ev.stopPropagation())

    card.on('mouseenter', () =>
      card.selectAll('.dots-container').style('opacity', '1')
    ).on('mouseleave', () =>
      card.selectAll('.dots-container').style('opacity', '0')
    )

    // 顶部 header（节点标题 + 折叠/复制/删除）
    buildHeader(card, d)
    addRightClickMenu(card, d, emit)

    // ====== 主体：单栏，对话框风格 ======
    const body = card.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('min-height', '0')
      .style('display', 'flex')
      .style('flex-direction', 'column')
      .style('padding', '5px 5px 4px')

    // 顶部行：Input Thought + 右侧发送按钮（小一号）
    const headerRow = body.append('xhtml:div')
      .attr('class', 'io-header')
      .style('align-items', 'center')

    headerRow.append('xhtml:span')
      .attr('class', 'io-label')
      .text('草稿笔记')

    // 发送小按钮：挪到 Input Thought 右侧
    const sendBtn = headerRow.append('xhtml:button')
      .html('➤')
      .attr('title','保存')
      .attr('class', 'icon-circle-btn output-clip-btn send-btn-icon')
      .style('box-shadow', '0 1px 2px rgba(0,0,0,0.15)')
      .on('mousedown', ev => ev.stopPropagation())

    // 文本输入区域
    const inputWrapper = body.append('xhtml:div')
      .style('flex', '1 1 auto')
      .style('display', 'flex')
      .style('margin-top', '2px')

    const textArea = inputWrapper.append('xhtml:textarea')
      .attr('class', 'thin-scroll')
      .style('flex', '1 1 auto')
      .style('width', '100%')
      .style('padding', '4px 6px')
      .style('font-size', '10px')
      .style('color', '#374151')
      .style('background-color', '#f9fafb')
      .style('border', '1px solid #e5e7eb')
      .style('border-radius', '6px')
      .style('resize', 'none')
      .style('outline', 'none')
      .style('font-family', 'inherit')
      .attr('placeholder', '描述下一个关键帧状态、视觉目标或修改想法...')
      .property('value', initialText)
      .on('mousedown', ev => ev.stopPropagation())

    // blur 时同步参数
    textArea.on('blur', function () {
      const newVal = d3.select(this).property('value') || ''
      if (!d.parameters) d.parameters = {}
      d.parameters.global_context = newVal
      d.parameters.text = newVal
      emit('update-node-parameters', d.id, d.parameters)
    })

    // 点击发送按钮：写回参数 + 通知上层调用大模型
    sendBtn.on('click', ev => {
      ev.stopPropagation()
      const value = textArea.property('value') || ''
      if (!value.trim()) return

      if (!d.parameters) d.parameters = {}
      d.parameters.global_context = value
      d.parameters.text = value
      emit('regenerate-node', d.id,"AddText", d.parameters,"意图草稿")

      //emit('intent-draft-send', d.id, value)
      //console.log('[IntentDraft] send:', d.id, value)
    })

    addResizeHandle(card, d, svgElement, allNodesData)
    addTooltip(gEl, d)
  }


  /**
   * 图文混排节点：左侧大文本，右侧图片/占位符
   */
  function renderTextImageNode(gEl, d, selectedIds, emit) {
    renderUnifiedVisualNode(gEl, d, selectedIds, emit)
  }


function renderAudioNode(gEl, d, selectedIds, emit, workflowTypes) {
  renderUnifiedAudioNode(gEl, d, selectedIds, emit)
}


/**
 * 左右 IO 卡：左输入，右输出（图片 / 视频 / 文本）
 */
function renderIONode(gEl, d, selectedIds, emit, workflowTypes) {
  renderUnifiedVisualNode(gEl, d, selectedIds, emit)
}

// Workflow Planning 辅助节点（AddWorkflow）：
// 上：Fine-tune operation 文字细化；下：Input Images 图片参考
function renderAddWorkflowNode(gEl, d, selectedIds, emit) {
  renderUnifiedVisualNode(gEl, d, selectedIds, emit)
}
// --- 新增：渲染复合节点 ---
function renderCompositeNode(gEl, d, selectedIds, emit) {
  const sourceItems = getCompositeSourceItems(d)
  const visibleItems = sourceItems.slice(0, 4)
  const remainingCount = Math.max(0, sourceItems.length - visibleItems.length)

  const rows = visibleItems.length <= 2 ? 1 : 2
  const tileHeight = rows === 1 ? 74 : 64
  const gridHeight = rows === 1 ? tileHeight : tileHeight * 2 + 6

  d.calculatedWidth = 300
  d.calculatedHeight = getCompositeHeight(d)

  const fo = gEl.append('foreignObject')
    .attr('width', d.calculatedWidth)
    .attr('height', d.calculatedHeight)
    .attr('x', -d.calculatedWidth / 2)
    .attr('y', -d.calculatedHeight / 2)
    .style('overflow', 'visible')

  const card = fo.append('xhtml:div')
    .attr('class', 'node-card')
    .attr('data-node-category', 'composite')
    .style('width', '100%')
    .style('height', '100%')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('border', `2px solid ${NODE_COLORS.overlap}`)
    .style('border-radius', '10px')
    .style('background', '#ffffff')
    .style('box-sizing', 'border-box')
    .style('overflow', 'hidden')
    .style('cursor', 'pointer')
    .style('user-select', 'none')
    .style('-webkit-user-select', 'none')

  setCardSelected(card, d, isVisuallySelected(d, selectedIds))

  card.on('click', ev => ev.stopPropagation())

  // 统一标题栏
  buildHeader(card, d)

  const body = card.append('xhtml:div')
    .style('flex', '1 1 auto')
    .style('display', 'flex')
    .style('flex-direction', 'column')
    .style('gap', '8px')
    .style('padding', '8px')
    .style('overflow', 'visible')

  const sourceHeader = body.append('xhtml:div')
    .style('display', 'flex')
    .style('align-items', 'center')
    .style('justify-content', 'space-between')
    .style('gap', '8px')

  sourceHeader.append('xhtml:div')
    .style('font-size', '10px')
    .style('font-weight', '600')
    .style('color', '#6b7280')
    .text('来源')

  sourceHeader.append('xhtml:button')
    .text('拆分')
    .style('height', '18px')
    .style('padding', '0 8px')
    .style('border-radius', '999px')
    .style('border', `1px solid ${NODE_COLORS.overlap}`)
    .style('background', '#ffffff')
    .style('color', '#475569')
    .style('font-size', '10px')
    .style('font-weight', '600')
    .style('cursor', 'pointer')
    .style('line-height', '1')
    .style('flex-shrink', '0')
    .on('mousedown', ev => ev.stopPropagation())
    .on('click', ev => {
      ev.stopPropagation()
      emit('ungroup-node', d.id)
    })

  const grid = body.append('xhtml:div')
    .style('display', 'grid')
    .style('grid-template-columns', '1fr 1fr')
    .style('gap', '6px')
    .style('min-height', `${gridHeight}px`)

  addResizeHandle(card, d, svgElement, allNodesData)

  visibleItems.forEach((item, idx) => {
    const tile = grid.append('xhtml:div')
      .style('position', 'relative')
      .style('height', `${tileHeight}px`)
      .style('border-radius', '8px')
      .style('overflow', 'hidden')
      .style('border', '1px solid #e5e7eb')
      .style('background', '#f8fafc')
      .style('cursor', item.url ? 'pointer' : 'default')
      .on('mousedown', ev => ev.stopPropagation())

    if (item.url) {
      tile.on('click', ev => {
        ev.stopPropagation()
        emit('open-preview', item.url, item.type)
      })
    }

    if (item.type === 'image' && item.url) {
      tile.append('xhtml:img')
        .attr('src', item.url)
        .style('width', '100%')
        .style('height', '100%')
        .style('object-fit', 'cover')
        .style('display', 'block')
    } else if (item.type === 'video' && item.url) {
      tile.append('xhtml:video')
        .attr('src', item.url)
        .attr('autoplay', true)
        .attr('muted', true)
        .attr('loop', true)
        .attr('playsinline', true)
        .style('width', '100%')
        .style('height', '100%')
        .style('object-fit', 'cover')
        .style('display', 'block')
    } else if (item.type === 'audio' && item.url) {
      tile.append('xhtml:div')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('font-size', '18px')
        .style('color', '#64748b')
        .text('♪')
    } else {
      tile.append('xhtml:div')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('font-size', '10px')
        .style('color', '#9ca3af')
        .text('暂无输出')
    }

    tile.append('xhtml:div')
      .style('position', 'absolute')
      .style('left', '0')
      .style('right', '0')
      .style('bottom', '0')
      .style('padding', '4px 6px')
      .style('background', 'linear-gradient(180deg, rgba(15,23,42,0) 0%, rgba(15,23,42,0.65) 100%)')
      .style('font-size', '10px')
      .style('color', '#ffffff')
      .style('white-space', 'nowrap')
      .style('overflow', 'hidden')
      .style('text-overflow', 'ellipsis')
      .text(item.label || '状态')

    if (remainingCount > 0 && idx === visibleItems.length - 1) {
      tile.append('xhtml:div')
        .style('position', 'absolute')
        .style('top', '6px')
        .style('right', '6px')
        .style('padding', '2px 6px')
        .style('border-radius', '999px')
        .style('background', 'rgba(15,23,42,0.72)')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .style('color', '#ffffff')
        .text(`+${remainingCount}`)
    }
    
  })
}
// --- 辅助函数：渲染媒体内容（图片/音频/文本） ---
function renderMediaContent(container, data) {
  // 渲染文本
  if (data.text) {
    container.append('xhtml:div')
      .style('color', '#374151')
      .style('margin-bottom', '4px')
      .style('word-break', 'break-all')
      .text(`文本：${data.text.slice(0, 30)}${data.text.length > 30 ? '...' : ''}`);
  }

  // 渲染图片
  if (data.images.length > 0) {
    const imgContainer = container.append('xhtml:div')
      .style('display', 'flex')
      .style('gap', '4px')
      .style('margin-bottom', '4px');

    data.images.slice(0, 2).forEach(imgUrl => {
      imgContainer.append('xhtml:img')
        .attr('src', imgUrl)
        .style('width', '40px')
        .style('height', '40px')
        .style('object-fit', 'cover')
        .style('border-radius', '2px');
    });

    if (data.images.length > 2) {
      imgContainer.append('xhtml:div')
        .style('width', '40px')
        .style('height', '40px')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .style('background', '#e5e7eb')
        .style('border-radius', '2px')
        .style('font-size', '10px')
        .text(`+${data.images.length - 2}`);
    }
  }

  // 渲染音频
  if (data.audio.length > 0) {
    container.append('xhtml:div')
      .style('color', '#4b5563')
      .style('margin-bottom', '4px')
      .text(`音频：${data.audio.length} 个文件`);
  }

  // 无内容提示
  if (!data.text && data.images.length === 0 && data.audio.length === 0) {
    container.append('xhtml:div')
      .style('color', '#9ca3af')
      .text('暂无内容');
  }
}


  // --- 主循环：根据类型分发渲染 ---
  nodeSel.each(function (d) {
    const gEl = d3.select(this)
    const cardType = d._cardType || inferCardType(d)

    // Init 特例
        if (cardType === 'init') {
      // 圆形 Init 节点
      gEl.append('circle')
        .attr('r', 30)
        .attr('fill', '#fff')
        .attr('stroke', NODE_COLORS.auxBorder)
        .attr('stroke-width', 2);

      const initTitle = gEl.append('text')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-size', '14px')
        .style('fill', '#6b7280')
        .style('pointer-events', 'all')
        .style('cursor', 'pointer')
        .text('开始');

      // 只有节点标题文字触发选中，圆形空白区域仅阻止事件继续冒泡。
      initTitle.on('click', (ev) => {
        ev.stopPropagation();
        toggleSelectionForNode(svgElement, d, selectedIds, emit, { allowComposite: true, maxCount: 2 });
      });
      gEl.on('click', ev => ev.stopPropagation());

      // 右键：弹出菜单 → Add Intent Draft
      gEl.on('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const menu = d3.select('body').append('xhtml:div')
          .style('position', 'absolute')
          .style('left', `${ev.pageX}px`)
          .style('top', `${ev.pageY}px`)
          .style('background', '#ffffff')
          .style('border', '1px solid #e5e7eb')
          .style('border-radius', '4px')
          .style('padding', '4px 0')
          .style('box-shadow', '0 2px 8px rgba(0,0,0,0.1)')
          .style('z-index', '1000')
          .style('min-width', '160px');

        const addMenuItem = (label, onClick) => {
          menu.append('xhtml:div')
            .style('padding', '4px 12px')
            .style('cursor', 'pointer')
            .style('font-size', '12px')
            .style('color', '#374151')
            .on('mouseenter', function () { d3.select(this).style('background', '#f3f4f6'); })
            .on('mouseleave', function () { d3.select(this).style('background', 'transparent'); })
            .text(label)
            .on('click', () => {
              onClick();
              menu.remove();
            });
        };

        addMenuItem('创建子草稿', () => {
          // 和原来小加号的行为保持一致
          emit('create-card', d, 'AddText', 'util');
        });

        const closeMenu = () => {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
      });

      return;
    }


    const hasIVMedia = !!(d.assets && d.assets.output && d.assets.output.images && d.assets.output.images.length > 0)
    const hasAudioMedia = !!(d.assets && d.assets.output && d.assets.output.audio && d.assets.output.audio.length > 0)
    const hasMedia = hasIVMedia || hasAudioMedia
    const rawIVPath = hasIVMedia ? d.assets.output.images[0] : ''
    const rawAudioPath = hasAudioMedia? d.assets.output.audio[0]:''
    // 从路径推断媒体类型（因为原数据中没有 type 字段）
    const mediaType = rawIVPath.includes('.png') || rawIVPath.includes('.jpg') || rawIVPath.includes('.jpeg') ? 'image' 
      : rawIVPath.includes('.mp4') ? 'video' 
      : rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') ? 'audio' 
      : ''
    //console.log(`getNodeCategory,${mediaType}`)
    const isAudioMedia =
      typeof rawAudioPath === 'string' &&
      (rawAudioPath.includes('.mp3') || rawAudioPath.includes('.wav') || rawAudioPath.includes('subfolder=audio') || mediaType === 'audio')

    // if (d.isComposite) {
    //   // 复合节点：调用专属渲染函数
    //   console.log('Rendering composite node:', d.id); // 验证是否走到这里
    //   renderCompositeNode(gEl, d, selectedIds, emit);
    // } 
    if (cardType === 'textFull') {
      console.log(`renderTree textFull`)
      renderTextFullNode(gEl, d, selectedIds, emit)
    } else if (getNodeCategory(d) === 'composite') {
      console.log('Rendering composite node:', d.id)
      renderCompositeNode(gEl, d, selectedIds, emit)
    } else if (cardType === 'audio' || isAudioMedia) {
      renderAudioNode(gEl, d, selectedIds, emit, workflowTypes)
    } else if (cardType === 'TextImage') {
      console.log(`render TextImage`)
      renderTextImageNode(gEl, d, selectedIds, emit)
    } else if (cardType === 'AddWorkflow') {
      renderAddWorkflowNode(gEl, d, selectedIds, emit)
    } else {
      renderIONode(gEl, d, selectedIds, emit, workflowTypes)
    }
  })

  setTimeout(() => {
    allNodesData.forEach(node => {
      console.log(`Checking entity data for node ${node.id}:`, node.assets?.segmented)

      if (!hasSegmentData(node)) return

      const segmentHostKey = getSegmentHostKey(node)
      updateEntityDisplay(segmentHostKey, node.assets.segmented, node)

      const host = document.getElementById(`entities-${segmentHostKey}`)
      const placeholder = host?.parentElement?.querySelector('.segment-empty-placeholder')
      if (!host) return

      if (host.children.length > 0 && placeholder) {
        placeholder.style.display = 'none'
      }

      // 使用实际 clientWidth 排布；节点滚动条出现时，Grid 会自动重算可用列宽。
      host.style.display = 'grid'
      host.style.gridTemplateColumns = 'repeat(auto-fill, minmax(48px, 1fr))'
      host.style.gridAutoRows = 'max-content'
      host.style.alignContent = 'flex-start'
      host.style.gap = '7px'
      host.style.overflowX = 'hidden'
      host.style.overflowY = 'auto'

      const hoverColor = getNodeBorderColor(node)

      Array.from(host.children).forEach((child) => {
        // ===== tile 基础样式 =====
        child.style.width = '100%'
        child.style.height = 'auto'
        child.style.aspectRatio = '1 / 1'
        child.style.minWidth = '0'
        child.style.position = 'relative'
        child.style.overflow = 'hidden'
        child.style.boxSizing = 'border-box'
        child.style.borderRadius = '10px'
        child.style.border = '1px solid #d8dde5'
        child.style.background = '#ffffff'
        child.style.boxShadow = 'none'
        child.style.transform = 'none'
        child.style.transition = 'border-color 120ms ease, border-width 120ms ease'
        child.style.zIndex = '1'

        // ===== 媒体元素：不放大，不外溢 =====
        const mediaEl = child.querySelector('img, video, canvas')
        if (mediaEl) {
          mediaEl.style.display = 'block'
          mediaEl.style.width = '100%'
          mediaEl.style.height = '100%'
          mediaEl.style.objectFit = 'contain'
          mediaEl.style.outline = 'none'
          mediaEl.style.border = 'none'
          mediaEl.style.borderRadius = '10px'
          mediaEl.style.background = '#ffffff'
          mediaEl.style.transform = 'none'
          mediaEl.style.transition = 'none'
          mediaEl.style.pointerEvents = 'none'
        }

        // ===== 删除按钮：如果没有就创建；有就复用 =====
        let removeBtn =
          child.querySelector('.remove-btn') ||
          child.querySelector('.delete-btn') ||
          child.querySelector('[data-action="delete"]') ||
          child.querySelector('button')

        if (!removeBtn) {
          removeBtn = document.createElement('button')
          removeBtn.type = 'button'
          removeBtn.textContent = '×'
          removeBtn.className = 'remove-btn'
          removeBtn.setAttribute('data-action', 'delete')
          child.appendChild(removeBtn)
        } else {
          removeBtn.classList.add('remove-btn')
        }

        // 只定位，不覆盖你全局 .remove-btn 的视觉样式
        removeBtn.style.position = 'absolute'
        removeBtn.style.top = '4px'
        removeBtn.style.right = '4px'
        removeBtn.style.left = 'auto'
        removeBtn.style.bottom = 'auto'
        removeBtn.style.opacity = '0'
        removeBtn.style.pointerEvents = 'none'
        removeBtn.style.zIndex = '20'

        // 防止重复绑定
        if (!removeBtn.dataset.segmentHoverBound) {
          removeBtn.dataset.segmentHoverBound = '1'

          removeBtn.addEventListener('mousedown', (ev) => {
            ev.stopPropagation()
          })
        }

        // ===== hover：只改细黄色边框，不放大 =====
        child.onmouseenter = () => {
          child.style.borderColor = hoverColor
          child.style.borderWidth = '1.5px'
          child.style.boxShadow = 'none'
          child.style.transform = 'none'

          removeBtn.style.opacity = '0.95'
          removeBtn.style.pointerEvents = 'auto'
        }

        const mediaSrc = mediaEl?.getAttribute?.('src') || mediaEl?.dataset?.src || ''
        const mediaType = mediaEl?.tagName?.toLowerCase?.() === 'video'
          ? 'video'
          : (mediaEl?.tagName?.toLowerCase?.() === 'img' || mediaEl?.tagName?.toLowerCase?.() === 'canvas')
            ? 'image'
            : 'image'

        if (mediaSrc) {
          const childSel = d3.select(child)
          attachWorkflowMediaDrag(childSel, () => buildWorkflowCanvasDragPayload(node, mediaSrc, mediaType, {
            source: 'workflow-segment-result',
            segmentHostKey,
          }))
        }

        child.onmouseleave = () => {
          child.style.borderColor = '#d1d5db'
          child.style.borderWidth = '1px'
          child.style.boxShadow = 'none'
          child.style.transform = 'none'

          removeBtn.style.opacity = '0'
          removeBtn.style.pointerEvents = 'none'
        }
      })

      const segmentBox = host.parentElement
      if (segmentBox) {
        syncMediaBoxHeight(
          d3.select(segmentBox),
          host,
          getMediaBoxState(node, 'results')
        )
      }
    })
  }, 100)

}


function addResizeHandle(card, node, svgElement, allNodesData) {
  const handle = card.append('xhtml:div')
    .attr('class', 'node-resize-handle')
    .style('position', 'absolute')
    .style('width', '8px')
    .style('height', '8px')
    .style('right', '6px')
    .style('bottom', '6px')
    .style('cursor', 'ns-resize')
    .style('background', '#9ca3af')
    .style('clip-path', 'polygon(100% 0, 0 100%, 100% 100%)')
    .style('opacity', '0')
    .style('transition', 'opacity 120ms ease')
    .style('z-index', '100000')
    .style('pointer-events', 'auto')
    .style('border-radius', '0')

  card.on('mouseenter.resize-handle', () => handle.style('opacity', '0.65'))
  card.on('mouseleave.resize-handle', () => handle.style('opacity', '0'))

  handle.on('mousedown', function (event) {
    event.stopPropagation();
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = node.calculatedHeight || 120;
    const fo = card.node()?.parentNode ? d3.select(card.node().parentNode) : null;

    function onMouseMove(ev) {
      const dy = ev.clientY - startY;
      const nextHeight = Math.max(60, startHeight + dy);
      node.calculatedHeight = nextHeight;
      if (fo) {
        fo.attr('height', nextHeight).attr('y', -nextHeight / 2);
      }
      card.style('height', `${nextHeight}px`);
      updateVisibility(svgElement, allNodesData);
    }

    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}


// === 最终修正版选择与合并逻辑 ===
// 点击或方框选择节点
function toggleNodeSelection(node, selectedIds, emit, svgElement = null) {
  return toggleSelectionForNode(svgElement, node, selectedIds, emit, { allowComposite: true, maxCount: 2 });
}

// 合并当前选择
function mergeSelectedNodes(allNodesData, selectedIds, emit, svgElement = null) {
  const effectiveSelectedIds = getSelectionState(svgElement, selectedIds);
  const nodesToMerge = allNodesData.filter(
    n => effectiveSelectedIds.includes(n.id)
  );
  if (nodesToMerge.length < 2) return;

  const newComposite = {
    id: generateUniqueId(),
    isComposite: true,
    combinedNodes: nodesToMerge,
    displayName: '已合并',
    module_id: 'CompositeNode'
  };

  allNodesData.push(newComposite);

  clearAllSelections(svgElement, emit);

  emit('refresh-tree', allNodesData);
}
