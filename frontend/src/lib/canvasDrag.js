export function initCanvasDrag() {
  const drawingBoard = document.getElementById('drawing-board');
  if (!drawingBoard) return;
  if (drawingBoard.dataset.canvasDragReady === '1') return;
  drawingBoard.dataset.canvasDragReady = '1';

  let drawingScene = document.getElementById('drawing-scene');
  if (!drawingScene) {
    drawingScene = document.createElement('div');
    drawingScene.id = 'drawing-scene';
    drawingBoard.appendChild(drawingScene);
  }

  drawingBoard.style.position = 'relative';
  drawingBoard.style.overflow = 'hidden';
  drawingBoard.style.touchAction = 'none';
  drawingBoard.style.userSelect = 'none';

  drawingScene.style.position = 'absolute';
  drawingScene.style.inset = '0';
  drawingScene.style.width = '100%';
  drawingScene.style.height = '100%';
  drawingScene.style.overflow = 'visible';
  drawingScene.style.transformOrigin = '0 0';
  drawingScene.style.willChange = 'transform';
  drawingScene.style.zIndex = '1';

  if (drawingBoard.parentElement) {
    drawingBoard.parentElement.style.position = 'relative';
  }

  const CAMERA_MIN_SCALE = 0.35;
  const CAMERA_MAX_SCALE = 3.2;
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 5;
  const DRAG_THRESHOLD = 4;

  const SCREEN_DPR = window.devicePixelRatio || 2;
  const MASK_DPR = Math.max(2, SCREEN_DPR);
  const MAX_EXPORT_SCALE = 8;

  const ENABLE_LIGHT_SR = true;
  const SR_MAX_SOURCE_UPSCALE = 2.5;
  const SR_STEP_RATIO = 1.6;
  const SR_SHARPEN_AMOUNT = 0.42;
  const SR_EDGE_THRESHOLD = 4;

  const srCache = new Map();

  let camera = { x: 0, y: 0, scale: 1 };

  let droppedImages = [];
  let draggingImg = null;
  let currentSelectedItem = null;
  let highlightedItemIds = new Set();
  let layerMenu = null;
  let layerMenuTarget = null;

  // 取景框右键菜单（附加功能）
  let regionMenu = null;
  let regionMenuTarget = null;

  // 画取景框时的比例吸附提示
  let aspectBadgeEl = null;
  let aspectGuideEls = [];
  let lastRegionDrawRect = null;

  // 素材编组（附加功能）
  let groups = [];
  // 按住空格进入临时平移模式（与 Figma / Photoshop / Illustrator 一致）
  let spacePanHeld = false;
  let groupMarqueeEl = null;
  let groupMarqueeStart = null;
  let groupMenu = null;
  let groupMenuTarget = null;
  let selectedGroup = null;
  let dragGroupSiblings = null;
  let dragGroupRef = null;
  let layerSeed = 0;

  let dragCandidate = null;
  let dragStartMouse = { x: 0, y: 0 };
  let dragStartPos = { x: 0, y: 0 };
  let dragRAF = null;
  let pendingDragPos = null;

  let regionDragCandidate = null;
  let draggingRegion = null;
  let regionDragStartMouse = { x: 0, y: 0 };
  let regionDragStartPos = { x: 0, y: 0 };

  let regionDragAttachedImages = [];
  let regionDragMaskState = null;
  let regionOverlapFeedbackEl = null;
  let regionAlignmentGuideX = null;
  let regionAlignmentGuideY = null;

  let boardPanCandidate = null;
  let boardPanActive = false;
  let boardPanMoved = false;

  let drawSubCanvasMode = false;
  let subCanvases = [];
  let subCanvasStart = { x: 0, y: 0 };
  let tempDrawRect = null;
  let activeRegionId = null;

  // 场景会话 ID：同一次画布状态下导出的所有取景框共享此 ID，
  // 用于事后计算不同关键帧之间的构图交集。纯附加，不影响既有逻辑。
  const sceneSessionId = `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  let paintMode = false;
  let isPainting = false;
  let maskCanvas;
  let maskCtx;

  let maskSceneCanvas;
  let maskSceneCtx;

  let paintLastScenePoint = null;
  let paintLastBoardPoint = null;
  let activePaintStroke = null;

  // 这个尺寸可以继续加大，基本够用了
  const SAFE_MASK_SCENE_MAX = 4096;
  let MASK_SCENE_SIZE = 4096;
  let MASK_SCENE_ORIGIN = MASK_SCENE_SIZE / 2;
  const BRUSH_SIZE_MIN = 2;
  const BRUSH_SIZE_MAX = 48;
  const BRUSH_SIZE_STEP = 2;
  let brushSize = 10;

  let regionColor = '#4b5563';
  let paintColor = '#5f96db';
  let activeColorPicker = null;  

  const DELETE_HANDLE_DELAY = 1500;
  const DELETE_HANDLE_HIDE_DELAY = 180;
  const REGION_GRIP_HEIGHT = 20;
  // 取景框推拉时的最小边长，避免缩到不可见
  const REGION_MIN_SIZE = 40;

  // 画取景框时可吸附的常见画幅比例。value = 宽 / 高
  const ASPECT_PRESETS = [
    { label: '9:16',   value: 9 / 16 },   // vertical / short-form
    { label: '2:3',    value: 2 / 3 },
    { label: '3:4',    value: 3 / 4 },    // vertical classic
    { label: '1:1',    value: 1 },        // square
    { label: '5:4',    value: 5 / 4 },
    { label: '4:3',    value: 4 / 3 },    // classic
    { label: '3:2',    value: 3 / 2 },    // photo
    { label: '16:9',   value: 16 / 9 },   // standard video
    { label: '1.85:1', value: 1.85 },     // theatrical flat
    { label: '2:1',    value: 2 },        // Univisium
    { label: '21:9',   value: 21 / 9 },   // ultrawide
    { label: '2.39:1', value: 2.39 }      // anamorphic scope
  ];
  // 相对误差在此范围内就吸附
  const ASPECT_SNAP_TOLERANCE = 0.05;
  const KEYFRAME_DUPLICATE_GAP = 24;

  let lastDragData = null;
  let boardDragDepth = 0;

  function setBoardDragVisual(active) {
    // 你现在不想要蓝色背景，所以这里直接禁用 dragover 视觉
    drawingBoard.classList.toggle('dragover', false);

    if (!active) {
      drawingBoard.classList.remove('dragover');
      applyBoardCamera();
    }
  }

  function resetBoardDragState() {
    boardDragDepth = 0;
    setBoardDragVisual(false);
  }
  const API_BASE = window.API_BASE || '';

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function normalizeImageUrl(url) {
    if (!url) return '';
    if (/^(data:|blob:|https?:)/i.test(url)) return url;

    if (API_BASE) {
      if (url.startsWith('/')) return `${API_BASE}${url}`;
      return `${API_BASE}/${url}`;
    }

    return url;
  }

  function isLikelyPreviewField(key, url) {
    const lower = String(url || '').toLowerCase();

    return (
      key === 'thumbnailUrl' ||
      key === 'imageUrl' ||
      /thumb|thumbnail|preview|poster|card|snapshot/.test(lower)
    );
  }

  function resolveDroppedImageUrl(data) {
    if (!data) return '';

    const candidates = [
      ['originalUrl', data.originalUrl],
      ['fullUrl', data.fullUrl],
      ['mediaUrl', data.mediaUrl],
      ['sourceUrl', data.sourceUrl],
      ['assetUrl', data.assetUrl],
      ['url', data.url],
      ['imageUrl', data.imageUrl],
      ['thumbnailUrl', data.thumbnailUrl],
    ]
      .map(([key, value]) => [key, typeof value === 'string' ? normalizeImageUrl(value.trim()) : ''])
      .filter(([, value]) => !!value);

    if (!candidates.length) return '';

    // 优先选“看起来不是预览图”的字段
    const nonPreview = candidates.find(([key, value]) => !isLikelyPreviewField(key, value));
    if (nonPreview) return nonPreview[1];

    // 实在没有就退回第一个可用字段
    return candidates[0][1];
  }

  function getBoardRect() {
    return drawingBoard.getBoundingClientRect();
  }

  function computeMaskSceneSize() {
    const rect = getBoardRect();
    const base = Math.max(rect.width, rect.height);

    // 取 viewport 的 4 倍范围，足够当前交互使用
    // 并限制最大 4096，避免再次进入超大 canvas 不稳定区
    const size = Math.min(
      SAFE_MASK_SCENE_MAX,
      Math.max(2048, Math.ceil((base * 4) / 256) * 256)
    );

    MASK_SCENE_SIZE = size;
    MASK_SCENE_ORIGIN = size / 2;
  }

  function getBoardPoint(clientX, clientY) {
    const rect = getBoardRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function screenToScene(clientX, clientY) {
    const boardPoint = getBoardPoint(clientX, clientY);
    return {
      x: (boardPoint.x - camera.x) / camera.scale,
      y: (boardPoint.y - camera.y) / camera.scale
    };
  }

  function sceneToScreen(x, y) {
    return {
      x: x * camera.scale + camera.x,
      y: y * camera.scale + camera.y
    };
  }

  function sceneToMaskBufferPoint(sceneX, sceneY) {
    return {
      x: sceneX + MASK_SCENE_ORIGIN,
      y: sceneY + MASK_SCENE_ORIGIN
    };
  }

  function resolveMaskDrawParams(sceneLeft, sceneTop, sceneWidth, sceneHeight, destWidth, destHeight) {
    if (!maskSceneCanvas) return null;

    let srcX = sceneLeft + MASK_SCENE_ORIGIN;
    let srcY = sceneTop + MASK_SCENE_ORIGIN;
    let srcW = sceneWidth;
    let srcH = sceneHeight;

    let dstX = 0;
    let dstY = 0;
    let dstW = destWidth;
    let dstH = destHeight;

    const scaleX = destWidth / sceneWidth;
    const scaleY = destHeight / sceneHeight;

    const maxW = maskSceneCanvas.width;
    const maxH = maskSceneCanvas.height;

    if (srcX < 0) {
      const cut = -srcX;
      srcX = 0;
      srcW -= cut;
      dstX += cut * scaleX;
      dstW -= cut * scaleX;
    }

    if (srcY < 0) {
      const cut = -srcY;
      srcY = 0;
      srcH -= cut;
      dstY += cut * scaleY;
      dstH -= cut * scaleY;
    }

    if (srcX + srcW > maxW) {
      const cut = srcX + srcW - maxW;
      srcW -= cut;
      dstW -= cut * scaleX;
    }

    if (srcY + srcH > maxH) {
      const cut = srcY + srcH - maxH;
      srcH -= cut;
      dstH -= cut * scaleY;
    }

    if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
      return null;
    }

    return {
      srcX,
      srcY,
      srcW,
      srcH,
      dstX,
      dstY,
      dstW,
      dstH
    };
  }

  function clientToScenePoint(clientX, clientY) {
    return screenToScene(clientX, clientY);
  }

  function clearViewportMask() {
    if (!maskCtx || !maskCanvas) return;

    maskCtx.save();
    maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.restore();
  }

  function renderMaskViewport() {
    if (!maskCtx || !maskCanvas || !maskSceneCanvas) return;

    clearViewportMask();

    const boardW = maskCanvas.width / MASK_DPR;
    const boardH = maskCanvas.height / MASK_DPR;

    const sceneLeft = (-camera.x) / camera.scale;
    const sceneTop = (-camera.y) / camera.scale;
    const sceneWidth = boardW / camera.scale;
    const sceneHeight = boardH / camera.scale;

    const params = resolveMaskDrawParams(
      sceneLeft,
      sceneTop,
      sceneWidth,
      sceneHeight,
      boardW,
      boardH
    );

    if (!params) return;

    maskCtx.save();
    maskCtx.drawImage(
      maskSceneCanvas,
      params.srcX,
      params.srcY,
      params.srcW,
      params.srcH,
      params.dstX,
      params.dstY,
      params.dstW,
      params.dstH
    );
    maskCtx.restore();
  }

  function getSceneBrushSize() {
    return brushSize / camera.scale;
  }

  function paintDot(scenePoint, boardPoint) {
    const sceneBrushSize = getSceneBrushSize();
    const sceneBufferPoint = sceneToMaskBufferPoint(scenePoint.x, scenePoint.y);

    maskSceneCtx.beginPath();
    maskSceneCtx.arc(sceneBufferPoint.x, sceneBufferPoint.y, sceneBrushSize / 2, 0, Math.PI * 2);
    maskSceneCtx.fillStyle = paintColor;
    maskSceneCtx.fill();

    maskCtx.beginPath();
    maskCtx.arc(boardPoint.x, boardPoint.y, brushSize / 2, 0, Math.PI * 2);
    maskCtx.fillStyle = paintColor;
    maskCtx.fill();
  }

  function paintSegment(fromScene, toScene, fromBoard, toBoard) {
    const sceneBrushSize = getSceneBrushSize();

    const p0 = sceneToMaskBufferPoint(fromScene.x, fromScene.y);
    const p1 = sceneToMaskBufferPoint(toScene.x, toScene.y);

    maskSceneCtx.beginPath();
    maskSceneCtx.moveTo(p0.x, p0.y);
    maskSceneCtx.lineTo(p1.x, p1.y);
    maskSceneCtx.lineWidth = sceneBrushSize;
    maskSceneCtx.lineCap = 'round';
    maskSceneCtx.lineJoin = 'round';
    maskSceneCtx.strokeStyle = paintColor;
    maskSceneCtx.stroke();

    maskCtx.beginPath();
    maskCtx.moveTo(fromBoard.x, fromBoard.y);
    maskCtx.lineTo(toBoard.x, toBoard.y);
    maskCtx.lineWidth = brushSize;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.strokeStyle = paintColor;
    maskCtx.stroke();
  }  

  function beginPaintStroke(scenePoint, boardPoint) {
    const sessionCanvas = document.createElement('canvas');
    sessionCanvas.width = MASK_SCENE_SIZE;
    sessionCanvas.height = MASK_SCENE_SIZE;

    const sessionCtx = sessionCanvas.getContext('2d');
    sessionCtx.imageSmoothingEnabled = true;
    sessionCtx.imageSmoothingQuality = 'high';

    activePaintStroke = {
      canvas: sessionCanvas,
      ctx: sessionCtx,
      minX: scenePoint.x,
      minY: scenePoint.y,
      maxX: scenePoint.x,
      maxY: scenePoint.y
    };

    paintStrokeDot(activePaintStroke, scenePoint, boardPoint);
  }

  function expandPaintStrokeBounds(stroke, scenePoint, radius) {
    stroke.minX = Math.min(stroke.minX, scenePoint.x - radius);
    stroke.minY = Math.min(stroke.minY, scenePoint.y - radius);
    stroke.maxX = Math.max(stroke.maxX, scenePoint.x + radius);
    stroke.maxY = Math.max(stroke.maxY, scenePoint.y + radius);
  }

  function paintStrokeDot(stroke, scenePoint, boardPoint) {
    const sceneBrushSize = getSceneBrushSize();
    const radius = sceneBrushSize / 2;
    const sceneBufferPoint = sceneToMaskBufferPoint(scenePoint.x, scenePoint.y);

    stroke.ctx.beginPath();
    stroke.ctx.arc(sceneBufferPoint.x, sceneBufferPoint.y, radius, 0, Math.PI * 2);
    stroke.ctx.fillStyle = paintColor;
    stroke.ctx.fill();

    expandPaintStrokeBounds(stroke, scenePoint, radius);

    maskCtx.beginPath();
    maskCtx.arc(boardPoint.x, boardPoint.y, brushSize / 2, 0, Math.PI * 2);
    maskCtx.fillStyle = paintColor;
    maskCtx.fill();
  }

  function paintStrokeSegment(stroke, fromScene, toScene, fromBoard, toBoard) {
    const sceneBrushSize = getSceneBrushSize();
    const radius = sceneBrushSize / 2;

    const p0 = sceneToMaskBufferPoint(fromScene.x, fromScene.y);
    const p1 = sceneToMaskBufferPoint(toScene.x, toScene.y);

    stroke.ctx.beginPath();
    stroke.ctx.moveTo(p0.x, p0.y);
    stroke.ctx.lineTo(p1.x, p1.y);
    stroke.ctx.lineWidth = sceneBrushSize;
    stroke.ctx.lineCap = 'round';
    stroke.ctx.lineJoin = 'round';
    stroke.ctx.strokeStyle = paintColor;
    stroke.ctx.stroke();

    expandPaintStrokeBounds(stroke, fromScene, radius);
    expandPaintStrokeBounds(stroke, toScene, radius);

    maskCtx.beginPath();
    maskCtx.moveTo(fromBoard.x, fromBoard.y);
    maskCtx.lineTo(toBoard.x, toBoard.y);
    maskCtx.lineWidth = brushSize;
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';
    maskCtx.strokeStyle = paintColor;
    maskCtx.stroke();
  }

  function commitPaintStrokeToItem() {
    if (!activePaintStroke) {
      clearViewportMask();
      return;
    }

    const stroke = activePaintStroke;
    activePaintStroke = null;

    try {
      const left = Math.floor(stroke.minX);
      const top = Math.floor(stroke.minY);
      const right = Math.ceil(stroke.maxX);
      const bottom = Math.ceil(stroke.maxY);

      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);

      const srcX = Math.round(left + MASK_SCENE_ORIGIN);
      const srcY = Math.round(top + MASK_SCENE_ORIGIN);

      const cropped = document.createElement('canvas');
      cropped.width = width;
      cropped.height = height;

      const croppedCtx = cropped.getContext('2d');
      croppedCtx.drawImage(
        stroke.canvas,
        srcX, srcY, width, height,
        0, 0, width, height
      );

      createMaskItem(cropped, left, top);
    } finally {
      clearViewportMask();
    }
  }

  function syncBoardContentState() {
    drawingBoard.classList.toggle('has-content', droppedImages.length > 0);
  }

  function updateBoardBackground() {
    const s = clamp(camera.scale, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE);

    const zoomOutT = 1 - smoothstep(0.45, 1.0, s);
    const zoomInT = smoothstep(1.0, 2.2, s);

    const gap = lerp(24, 34, zoomOutT) - lerp(0, 2.5, zoomInT);
    const dotSize = lerp(1.0, 0.62, zoomOutT) + lerp(0, 0.08, zoomInT);
    const dotAlpha = lerp(0.09, 0.028, zoomOutT) + lerp(0, 0.008, zoomInT);

    const effectiveGap = clamp(gap, 20, 38);
    const effectiveSize = clamp(dotSize, 0.55, 1.1);
    const effectiveAlpha = clamp(dotAlpha, 0.022, 0.095);

    const color = `rgba(122, 133, 151, ${effectiveAlpha.toFixed(3)})`;

    drawingBoard.style.setProperty('--board-dot-gap', `${effectiveGap.toFixed(2)}px`);
    drawingBoard.style.setProperty('--board-dot-size', `${effectiveSize.toFixed(2)}px`);
    drawingBoard.style.setProperty('--board-dot-alpha', `${effectiveAlpha.toFixed(3)}`);

    drawingBoard.style.backgroundColor = '#ffffff';
    drawingBoard.style.backgroundSize = `${effectiveGap.toFixed(2)}px ${effectiveGap.toFixed(2)}px`;
    drawingBoard.style.backgroundPosition = '0 0';
    drawingBoard.style.backgroundImage =
      `radial-gradient(circle, ${color} 0, ${color} ${effectiveSize.toFixed(2)}px, transparent ${(effectiveSize + 0.42).toFixed(2)}px)`;
  }

  function applyBoardCamera() {
    drawingScene.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.scale})`;
    updateBoardBackground();
    renderMaskViewport();

    droppedImages.forEach(updateDeleteHandlePosition);
    subCanvases.forEach(updateDeleteHandlePosition);
  }

  function zoomBoardAt(clientX, clientY, factor) {
    const local = getBoardPoint(clientX, clientY);

    const nextScale = clamp(camera.scale * factor, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE);
    if (Math.abs(nextScale - camera.scale) < 1e-4) return;

    const sceneX = (local.x - camera.x) / camera.scale;
    const sceneY = (local.y - camera.y) / camera.scale;

    camera.scale = nextScale;
    camera.x = local.x - sceneX * camera.scale;
    camera.y = local.y - sceneY * camera.scale;

    applyBoardCamera();
  }

  function createWorkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function loadImageAsync(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function progressiveUpscale(source, targetW, targetH) {
    const srcW = source.naturalWidth || source.width;
    const srcH = source.naturalHeight || source.height;

    let current = createWorkCanvas(srcW, srcH);
    let ctx = current.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, srcW, srcH);

    while (current.width < targetW || current.height < targetH) {
      const nextW = Math.min(
        targetW,
        Math.max(current.width + 1, Math.round(current.width * SR_STEP_RATIO))
      );
      const nextH = Math.min(
        targetH,
        Math.max(current.height + 1, Math.round(current.height * SR_STEP_RATIO))
      );

      const next = createWorkCanvas(nextW, nextH);
      const nctx = next.getContext('2d', { willReadFrequently: true });
      nctx.imageSmoothingEnabled = true;
      nctx.imageSmoothingQuality = 'high';
      nctx.drawImage(current, 0, 0, current.width, current.height, 0, 0, nextW, nextH);
      current = next;
    }

    return current;
  }

  function applyLumaUnsharp(canvas, amount = SR_SHARPEN_AMOUNT, threshold = SR_EDGE_THRESHOLD) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const size = width * height;
    const luma = new Float32Array(size);
    const blur = new Float32Array(size);

    for (let i = 0, p = 0; i < size; i++, p += 4) {
      luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let count = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const yy = Math.max(0, Math.min(height - 1, y + ky));
          for (let kx = -1; kx <= 1; kx++) {
            const xx = Math.max(0, Math.min(width - 1, x + kx));
            sum += luma[yy * width + xx];
            count++;
          }
        }
        blur[y * width + x] = sum / count;
      }
    }

    for (let i = 0, p = 0; i < size; i++, p += 4) {
      const diff = luma[i] - blur[i];
      if (Math.abs(diff) < threshold) continue;

      const boost = diff * amount;
      data[p] = Math.max(0, Math.min(255, data[p] + boost));
      data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + boost));
      data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + boost));
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  async function buildLightSRSource(item, scale) {
    const src = item.originalSrc || item.element.src;

    const displayW = item.element.offsetWidth || parseFloat(item.element.style.width) || 100;
    const displayH = item.element.offsetHeight || (
      item.element.naturalWidth
        ? (displayW * item.element.naturalHeight) / item.element.naturalWidth
        : 100
    );

    const targetPxW = Math.max(1, Math.round(displayW * scale));
    const targetPxH = Math.max(1, Math.round(displayH * scale));

    const cacheKey = `${src}__${targetPxW}x${targetPxH}`;
    if (srCache.has(cacheKey)) {
      return srCache.get(cacheKey);
    }

    const img = await loadImageAsync(src);

    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;

    if (targetPxW <= naturalW && targetPxH <= naturalH) {
      srCache.set(cacheKey, img);
      return img;
    }

    const srW = Math.min(targetPxW, Math.round(naturalW * SR_MAX_SOURCE_UPSCALE));
    const srH = Math.min(targetPxH, Math.round(naturalH * SR_MAX_SOURCE_UPSCALE));

    let work = progressiveUpscale(img, srW, srH);
    work = applyLumaUnsharp(work);

    srCache.set(cacheKey, work);
    return work;
  }

  function getItemByElement(el) {
    return droppedImages.find(item => item.element === el);
  }

  function getSortedItems() {
    return [...droppedImages].sort((a, b) => a.zIndex - b.zIndex);
  }

  function applyItemVisualLayer(item) {
    if (!item) return;
    item.element.style.zIndex = String(item.zIndex * 2);
    if (item.labelEl) {
      item.labelEl.style.zIndex = String(item.zIndex * 2 + 1);
    }
  }

  function normalizeLayerOrder() {
    droppedImages = getSortedItems();
    droppedImages.forEach((item, index) => {
      item.zIndex = index + 1;
      applyItemVisualLayer(item);
      updateLabelPosition(item);
    });
    layerSeed = droppedImages.length;
  }

  function setRegionPosition(regionItem, x, y) {
    if (!regionItem || !regionItem.element) return;

    regionItem.x = x;
    regionItem.y = y;
    regionItem.element.style.left = `${x}px`;
    regionItem.element.style.top = `${y}px`;

    updateDeleteHandlePosition(regionItem);
  }

  function setImagePosition(img, x, y) {
    const item = getItemByElement(img);

    img.dataset.x = String(x);
    img.dataset.y = String(y);

    if (item) {
      applyItemTransform(item);
    } else {
      img.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }

  function getImagePosition(img) {
    return {
      x: parseFloat(img.dataset.x || '0'),
      y: parseFloat(img.dataset.y || '0')
    };
  }

  function getItemSize(item) {
    if (!item?.element) return { w: 0, h: 0 };

    return {
      w: item.element.offsetWidth || item.element.width || item.width || 0,
      h: item.element.offsetHeight || item.element.height || item.height || 0
    };
  }

  function applyItemTransform(item) {
    if (!item?.element) return;

    const pos = getImagePosition(item.element);
    const { w, h } = getItemSize(item);

    const flipX = item.flipX ? -1 : 1;
    const flipY = item.flipY ? -1 : 1;

    const tx = item.flipX ? pos.x + w : pos.x;
    const ty = item.flipY ? pos.y + h : pos.y;

    item.element.style.transformOrigin = 'top left';
    item.element.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${flipX}, ${flipY})`;

    updateLabelPosition(item);
    updateDeleteHandlePosition(item);
  }

  function setSceneItemPosition(item, x, y) {
    if (!item?.element) return;
    item.element.dataset.x = String(x);
    item.element.dataset.y = String(y);
    applyItemTransform(item);
  }

  function clampImagePosition(img, x, y) {
    return { x, y };
  }

  function normalizeCanvasLabel(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
  }

  function refreshItemEmphasis(item) {
    if (!item?.element) return;
    const highlighted = highlightedItemIds.has(item.id);
    const selected = currentSelectedItem === item;

    // 选中态与编组一致：浅灰底 + 细边，不用深色粗描边
    item.element.style.outline = highlighted
      ? '2px solid #6b7280'
      : (selected ? '1.5px solid #6b7280' : 'none');
    item.element.style.outlineOffset = highlighted ? '3px' : '0';
    item.element.style.backgroundColor = (highlighted || selected)
      ? 'rgba(17,24,39,0.05)'
      : 'transparent';
    item.element.style.filter = 'none';

    if (item.labelEl) {
      item.labelEl.style.background = (highlighted || selected) ? '#4b5563' : '#8b929e';
      item.labelEl.style.boxShadow = 'none';
    }
  }

  function refreshAllItemEmphasis() {
    droppedImages.forEach(refreshItemEmphasis);
  }

  function highlightByLabels(labels = []) {
    const requestedLabels = new Set(
      (Array.isArray(labels) ? labels : [labels])
        .map(normalizeCanvasLabel)
        .filter(Boolean)
    );
    highlightedItemIds = new Set(
      droppedImages
        .filter(item => requestedLabels.has(normalizeCanvasLabel(item.label)))
        .map(item => item.id)
    );
    refreshAllItemEmphasis();
  }

  function clearHighlight() {
    if (!highlightedItemIds.size) return;
    highlightedItemIds.clear();
    refreshAllItemEmphasis();
  }

  function selectItem(item) {
    currentSelectedItem = item;
    refreshAllItemEmphasis();
  }

  function clearSelection() {
    currentSelectedItem = null;
    refreshAllItemEmphasis();
  }

  function updateLabelPosition(item) {
    if (!item || !item.labelEl) return;

    const pos = getImagePosition(item.element);
    const labelEl = item.labelEl;

    labelEl.style.left = `${pos.x}px`;
    labelEl.style.top = `${Math.max(0, pos.y - 22)}px`;

    applyItemVisualLayer(item);
  }

  function setItemLabel(item, text) {
    const next = (text || '').trim();
    item.label = next;

    if (!next) {
      if (item.labelEl) {
        item.labelEl.remove();
        item.labelEl = null;
      }
      return;
    }

    if (!item.labelEl) {
      const labelEl = document.createElement('div');
      labelEl.className = 'canvas-image-label';
      // 与编组标签保持同一套外观：灰底、白字、小圆角
      labelEl.style.cssText = `
        position:absolute;
        padding:2px 8px;
        background:#8b929e;
        border-radius:4px;
        font-size:12px;
        font-weight:500;
        line-height:18px;
        color:#ffffff;
        pointer-events:none;
        white-space:nowrap;
      `;
      drawingScene.appendChild(labelEl);
      item.labelEl = labelEl;
    }

    item.labelEl.textContent = next;
    updateLabelPosition(item);
    refreshItemEmphasis(item);
  }

  function normalizeHexColor(hex) {
    if (!hex) return '#000000';
    let value = String(hex).trim();

    if (!value.startsWith('#')) value = `#${value}`;

    if (value.length === 4) {
      value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return '#000000';
    return value.toLowerCase();
  }

  function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16)
    };
  }

  function rgbToHex(r, g, b) {
    const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;

    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;

    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (d !== 0) {
      switch (max) {
        case rn:
          h = ((gn - bn) / d) % 6;
          break;
        case gn:
          h = (bn - rn) / d + 2;
          break;
        case bn:
          h = (rn - gn) / d + 4;
          break;
      }
      h *= 60;
      if (h < 0) h += 360;
    }

    return { h, s, v };
  }

  function hsvToRgb(h, s, v) {
    const c = v * s;
    const hh = (h % 360) / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));

    let r1 = 0;
    let g1 = 0;
    let b1 = 0;

    if (hh >= 0 && hh < 1) [r1, g1, b1] = [c, x, 0];
    else if (hh >= 1 && hh < 2) [r1, g1, b1] = [x, c, 0];
    else if (hh >= 2 && hh < 3) [r1, g1, b1] = [0, c, x];
    else if (hh >= 3 && hh < 4) [r1, g1, b1] = [0, x, c];
    else if (hh >= 4 && hh < 5) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];

    const m = v - c;

    return {
      r: Math.round((r1 + m) * 255),
      g: Math.round((g1 + m) * 255),
      b: Math.round((b1 + m) * 255)
    };
  }


  function applyRegionStyle(el, { temp = false } = {}) {
    if (!el) return;

    const borderColor = normalizeHexColor(regionColor);
    const borderStyle = temp ? 'dashed' : 'solid';

    el.style.border = `1px ${borderStyle} ${borderColor}`;
    el.style.background = temp ? 'rgba(255,255,255,0.12)' : 'transparent';
    el.style.boxShadow = temp
      ? 'inset 0 0 0 1px rgba(255,255,255,0.18)'
      : 'none';
  }

  function refreshRegionStyles() {
    subCanvases.forEach(region => {
      if (region?.frameEl) {
        applyRegionStyle(region.frameEl, { temp: false });
      }
      if (region?.gripVisualEl) {
        region.gripVisualEl.style.background = normalizeHexColor(regionColor);
      }
    });

    if (tempDrawRect) {
      applyRegionStyle(tempDrawRect, { temp: true });
    }

    updateToolbarColorIndicators();
  }

  function destroyActiveColorPicker() {
    if (!activeColorPicker) return;

    const { el, onPointerDown, onResize } = activeColorPicker;

    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('resize', onResize);

    if (el?.parentNode) {
      el.parentNode.removeChild(el);
    }

    activeColorPicker = null;
  }

  function openToolbarColorPicker(kind, anchorEl) {
    if (!anchorEl) return;

    const isSamePickerOpen =
      activeColorPicker &&
      activeColorPicker.kind === kind &&
      activeColorPicker.anchorEl === anchorEl;

    if (isSamePickerOpen) {
      destroyActiveColorPicker();
      return;
    }

    destroyActiveColorPicker();

    const currentColor = kind === 'region' ? regionColor : paintColor;
    let hsv = rgbToHsv(...Object.values(hexToRgb(currentColor)));

    const panel = document.createElement('div');
    panel.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      width: 248px;
      padding: 10px;
      border-radius: 14px;
      background: rgba(255,255,255,0.98);
      border: 1px solid rgba(203,213,225,0.95);
      box-shadow:
        0 0 0 1px rgba(15,23,42,0.04),
        0 12px 28px rgba(15,23,42,0.12);
      backdrop-filter: blur(10px);
      box-sizing: border-box;
      user-select: none;
    `;

    const title = document.createElement('div');
    title.textContent = kind === 'paint' ? '画笔设置' : '取景框颜色';
    title.style.cssText = `
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 8px;
      line-height: 1;
    `;
    panel.appendChild(title);

    let minusBtn = null;
    let plusBtn = null;
    let brushValueEl = null;
    let brushDotEl = null;

    if (kind === 'paint') {
      const brushRow = document.createElement('div');
      brushRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 10px;
        padding: 6px;
        border-radius: 999px;
        background: rgba(248,250,252,0.92);
        border: 1px solid rgba(203,213,225,0.9);
      `;

      const makeBtn = (label) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.cssText = `
          width: 26px;
          height: 26px;
          border: none;
          border-radius: 999px;
          background: transparent;
          color: #475569;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
        `;
        btn.onmouseenter = () => {
          if (!btn.disabled) btn.style.background = '#ffffff';
        };
        btn.onmouseleave = () => {
          btn.style.background = 'transparent';
        };
        return btn;
      };

      minusBtn = makeBtn('−');
      plusBtn = makeBtn('+');

      const readout = document.createElement('div');
      readout.style.cssText = `
        flex: 1;
        height: 28px;
        padding: 0 10px 0 8px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: #ffffff;
        border: 1px solid rgba(203,213,225,0.95);
        box-sizing: border-box;
        color: #334155;
        font-size: 11px;
        font-weight: 700;
      `;

      brushDotEl = document.createElement('span');
      brushDotEl.style.cssText = `
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: ${paintColor};
        flex: 0 0 auto;
        box-shadow: 0 0 0 1px rgba(15,23,42,0.08);
      `;

      brushValueEl = document.createElement('span');
      brushValueEl.style.cssText = `
        min-width: 18px;
        text-align: center;
        line-height: 1;
      `;
      brushValueEl.textContent = String(brushSize);

      minusBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        adjustBrushSize(-BRUSH_SIZE_STEP);
      };

      plusBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        adjustBrushSize(BRUSH_SIZE_STEP);
      };

      readout.appendChild(brushDotEl);
      readout.appendChild(brushValueEl);

      brushRow.appendChild(minusBtn);
      brushRow.appendChild(readout);
      brushRow.appendChild(plusBtn);

      panel.appendChild(brushRow);
    }

    const svArea = document.createElement('div');
    svArea.style.cssText = `
      position: relative;
      width: 100%;
      height: 136px;
      border-radius: 10px;
      overflow: hidden;
      cursor: crosshair;
      margin-bottom: 10px;
      background:
        linear-gradient(to top, #000, transparent),
        linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%));
    `;

    const svHandle = document.createElement('div');
    svHandle.style.cssText = `
      position: absolute;
      width: 14px;
      height: 14px;
      border-radius: 999px;
      border: 2px solid #ffffff;
      box-shadow: 0 0 0 1px rgba(15,23,42,0.35);
      transform: translate(-50%, -50%);
      pointer-events: none;
    `;
    svArea.appendChild(svHandle);

    const hueArea = document.createElement('div');
    hueArea.style.cssText = `
      position: relative;
      width: 100%;
      height: 14px;
      border-radius: 999px;
      margin-bottom: 10px;
      background: linear-gradient(
        to right,
        #ff0000,
        #ffff00,
        #00ff00,
        #00ffff,
        #0000ff,
        #ff00ff,
        #ff0000
      );
      cursor: ew-resize;
    `;

    const hueHandle = document.createElement('div');
    hueHandle.style.cssText = `
      position: absolute;
      top: 50%;
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 2px solid #ffffff;
      box-shadow: 0 0 0 1px rgba(15,23,42,0.3);
      transform: translate(-50%, -50%);
      pointer-events: none;
    `;
    hueArea.appendChild(hueHandle);

    const footer = document.createElement('div');
    footer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
    `;

    const previewEl = document.createElement('div');
    previewEl.style.cssText = `
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid rgba(203,213,225,0.95);
      background: ${currentColor};
      flex: 0 0 auto;
    `;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = currentColor;
    hexInput.style.cssText = `
      flex: 1;
      height: 28px;
      border-radius: 8px;
      border: 1px solid rgba(203,213,225,0.95);
      padding: 0 10px;
      font-size: 12px;
      color: #334155;
      outline: none;
      box-sizing: border-box;
      background: #ffffff;
    `;

    footer.appendChild(previewEl);
    footer.appendChild(hexInput);

    panel.appendChild(svArea);
    panel.appendChild(hueArea);
    panel.appendChild(footer);

    document.body.appendChild(panel);

    const applyFromHSV = () => {
      const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
      const hex = rgbToHex(r, g, b);
      setToolColor(kind, hex);
    };

    const place = () => {
      const rect = anchorEl.getBoundingClientRect();
      const panelW = panel.offsetWidth || 248;
      const panelH = panel.offsetHeight || 230;

      let left = rect.left + rect.width + 10;
      let top = rect.bottom + 6;

      if (left + panelW > window.innerWidth - 8) {
        left = rect.right - panelW;
      }
      if (top + panelH > window.innerHeight - 8) {
        top = rect.top - panelH - 8;
      }

      left = clamp(left, 8, window.innerWidth - panelW - 8);
      top = clamp(top, 8, window.innerHeight - panelH - 8);

      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
    };

    const bindPointerDrag = (el, move) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const onMove = (ev) => {
          move(ev);
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };

        move(e);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    };

    bindPointerDrag(svArea, (e) => {
      const rect = svArea.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const y = clamp(e.clientY - rect.top, 0, rect.height);

      hsv.s = rect.width === 0 ? 0 : x / rect.width;
      hsv.v = rect.height === 0 ? 0 : 1 - y / rect.height;

      applyFromHSV();
    });

    bindPointerDrag(hueArea, (e) => {
      const rect = hueArea.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 0, rect.width);

      hsv.h = rect.width === 0 ? 0 : (x / rect.width) * 360;

      applyFromHSV();
    });

    hexInput.addEventListener('change', () => {
      const normalized = normalizeHexColor(hexInput.value);
      const rgb = hexToRgb(normalized);
      hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      setToolColor(kind, normalized);
    });

    const onPointerDown = (e) => {
      if (panel.contains(e.target) || anchorEl.contains(e.target)) return;
      destroyActiveColorPicker();
    };

    const onResize = () => {
      if (!activeColorPicker) return;
      place();
      updateActiveColorPickerUI();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onResize);

    activeColorPicker = {
      kind,
      anchorEl,
      el: panel,
      previewEl,
      hexInput,
      svArea,
      svHandle,
      hueArea,
      hueHandle,
      brushValueEl,
      brushDotEl,
      minusBtn,
      plusBtn,
      onPointerDown,
      onResize
    };

    place();
    updateActiveColorPickerUI();
  }

  function setToolbarButtonAccent(btn, color) {
    if (!btn) return;
    btn.style.boxShadow = `inset 0 -3px 0 ${color}`;
  }

  function setToolColor(kind, nextColor) {
    const normalized = normalizeHexColor(nextColor);

    if (kind === 'region') {
      regionColor = normalized;
      refreshRegionStyles();
    } else {
      paintColor = normalized;
      updateToolbarColorIndicators();
    }

    updateActiveColorPickerUI();
  }

  function updateToolbarColorIndicators() {
    const regionBtn = document.getElementById('tool-region-btn');
    const paintBtn = document.getElementById('tool-paint-btn');

    setToolbarButtonAccent(regionBtn, regionColor);
    setToolbarButtonAccent(paintBtn, paintColor);
  }

  function updateActiveColorPickerUI() {
    if (!activeColorPicker) return;

    const kind = activeColorPicker.kind;
    const color = kind === 'region' ? regionColor : paintColor;

    const { previewEl, hexInput, svHandle, hueHandle, svArea, hueArea, brushValueEl, brushDotEl, minusBtn, plusBtn } = activeColorPicker;

    if (previewEl) {
      previewEl.style.background = color;
    }

    if (hexInput && document.activeElement !== hexInput) {
      hexInput.value = color;
    }

    const { h, s, v } = rgbToHsv(...Object.values(hexToRgb(color)));

    if (svArea) {
      svArea.style.background = `
        linear-gradient(to top, #000, transparent),
        linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))
      `;
    }

    if (svHandle) {
      svHandle.style.left = `${s * 100}%`;
      svHandle.style.top = `${(1 - v) * 100}%`;
    }

    if (hueHandle && hueArea) {
      const hueWidth = hueArea.clientWidth || 180;
      hueHandle.style.left = `${(h / 360) * hueWidth}px`;
    }

    if (kind === 'paint') {
      if (brushValueEl) {
        brushValueEl.textContent = String(brushSize);
      }

      if (brushDotEl) {
        const previewSize = clamp(brushSize, 6, 18);
        brushDotEl.style.width = `${previewSize}px`;
        brushDotEl.style.height = `${previewSize}px`;
        brushDotEl.style.background = paintColor;
      }

      if (minusBtn) {
        minusBtn.disabled = brushSize <= BRUSH_SIZE_MIN;
        minusBtn.style.opacity = minusBtn.disabled ? '0.4' : '1';
      }

      if (plusBtn) {
        plusBtn.disabled = brushSize >= BRUSH_SIZE_MAX;
        plusBtn.style.opacity = plusBtn.disabled ? '0.4' : '1';
      }
    }
  }

  function syncBrushSizeControls() {
    const group = document.getElementById('tool-paint-size-group');
    const minusBtn = document.getElementById('tool-paint-decrease-btn');
    const plusBtn = document.getElementById('tool-paint-increase-btn');
    const valueEl = document.getElementById('tool-paint-size-value');
    const dotEl = document.getElementById('tool-paint-size-dot');
    const indicator = document.getElementById('tool-paint-size-indicator');

    if (!group || !minusBtn || !plusBtn || !valueEl || !dotEl || !indicator) return;

    const canDecrease = brushSize > BRUSH_SIZE_MIN;
    const canIncrease = brushSize < BRUSH_SIZE_MAX;

    minusBtn.disabled = !canDecrease;
    plusBtn.disabled = !canIncrease;

    valueEl.textContent = String(brushSize);
    indicator.setAttribute('aria-valuenow', String(brushSize));
    indicator.setAttribute('title', `画笔大小：${brushSize}`);

    const previewSize = clamp(brushSize, 6, 16);
    dotEl.style.width = `${previewSize}px`;
    dotEl.style.height = `${previewSize}px`;
    dotEl.style.background = paintColor;

    group.classList.toggle('is-disabled', !paintMode);
  }

  function setBrushSize(nextSize) {
    const normalized = clamp(Math.round(nextSize), BRUSH_SIZE_MIN, BRUSH_SIZE_MAX);
    if (normalized === brushSize) return;
    brushSize = normalized;
    updateActiveColorPickerUI();
  }

  function adjustBrushSize(delta) {
    setBrushSize(brushSize + delta);
  }

  function clearDeleteTimers(owner) {
    if (!owner) return;
    if (owner.showDeleteTimer) {
      clearTimeout(owner.showDeleteTimer);
      owner.showDeleteTimer = null;
    }
    if (owner.hideDeleteTimer) {
      clearTimeout(owner.hideDeleteTimer);
      owner.hideDeleteTimer = null;
    }
  }

  function ensureDeleteHandle(owner) {
    if (owner.deleteBtn) return owner.deleteBtn;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'canvas-delete-btn';
    btn.textContent = '×';
    btn.title = '删除';
    btn.setAttribute('aria-label', '删除');

    btn.style.cssText = `
      position:absolute;
      width:22px;
      height:22px;
      border:none;
      border-radius:999px;
      background:rgba(15,23,42,0.88);
      color:#ffffff;
      font-size:16px;
      line-height:1;
      display:flex;
      align-items:center;
      justify-content:center;
      cursor:pointer;
      opacity:0;
      transform:scale(0.92);
      transition:opacity 0.16s ease, transform 0.16s ease;
      pointer-events:none;
      z-index:9999;
      box-shadow:0 3px 10px rgba(0,0,0,0.18);
    `;

    btn.addEventListener('mouseenter', () => {
      owner.deleteHovering = true;
      clearDeleteTimers(owner);
      showDeleteHandle(owner);
    });

    btn.addEventListener('mouseleave', () => {
      owner.deleteHovering = false;
      scheduleDeleteHandleHide(owner);
    });

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeCanvasOwner(owner);
    });

    drawingBoard.appendChild(btn);
    owner.deleteBtn = btn;
    return btn;
  }

  function getDeleteAnchor(owner) {
    if (!owner) return { x: 0, y: 0 };

    if (owner.kind === 'region') {
      return {
        x: owner.x + owner.w,
        y: owner.y
      };
    }

    const pos = getImagePosition(owner.element);
    const { w } = getItemSize(owner);

    return {
      x: pos.x + w,
      y: pos.y
    };
  }

  function updateDeleteHandlePosition(owner) {
    if (!owner || !owner.deleteBtn) return;

    const anchor = getDeleteAnchor(owner);
    const screen = sceneToScreen(anchor.x, anchor.y);

    owner.deleteBtn.style.left = `${screen.x - 10}px`;
    owner.deleteBtn.style.top = `${screen.y - 10}px`;
  }

  function showDeleteHandle(owner) {
    if (!owner) return;
    const btn = ensureDeleteHandle(owner);
    updateDeleteHandlePosition(owner);
    btn.style.opacity = '1';
    btn.style.transform = 'scale(1)';
    btn.style.pointerEvents = 'auto';
  }

  function hideDeleteHandle(owner, immediate = false) {
    if (!owner || !owner.deleteBtn) return;
    if (owner.deleteHovering) return;

    const doHide = () => {
      if (!owner.deleteBtn) return;
      owner.deleteBtn.style.opacity = '0';
      owner.deleteBtn.style.transform = 'scale(0.92)';
      owner.deleteBtn.style.pointerEvents = 'none';
    };

    if (immediate) {
      doHide();
    } else {
      owner.hideDeleteTimer = setTimeout(doHide, DELETE_HANDLE_HIDE_DELAY);
    }
  }

  function scheduleDeleteHandleShow(owner) {
    if (!owner) return;
    clearDeleteTimers(owner);
    owner.showDeleteTimer = setTimeout(() => {
      showDeleteHandle(owner);
    }, DELETE_HANDLE_DELAY);
  }

  function scheduleDeleteHandleHide(owner) {
    if (!owner) return;
    if (owner.deleteHovering) return;
    clearDeleteTimers(owner);
    owner.hideDeleteTimer = setTimeout(() => {
      hideDeleteHandle(owner, true);
    }, DELETE_HANDLE_HIDE_DELAY);
  }

  function removeImageItem(item) {
    if (!item) return;

    clearDeleteTimers(item);

    if (item.deleteBtn) item.deleteBtn.remove();
    if (item.labelEl) item.labelEl.remove();
    if (item.element) item.element.remove();

    droppedImages = droppedImages.filter(it => it !== item);
    highlightedItemIds.delete(item.id);

    if (currentSelectedItem === item) {
      currentSelectedItem = null;
    }

    syncBoardContentState();
    normalizeLayerOrder();
  }

  function removeRegionItem(regionItem) {
    if (!regionItem) return;

    clearDeleteTimers(regionItem);

    if (regionItem.deleteBtn) regionItem.deleteBtn.remove();
    if (regionItem.element) regionItem.element.remove();

    subCanvases = subCanvases.filter(it => it !== regionItem);

    if (activeRegionId === regionItem.id) {
      activeRegionId = null;
    }
  }

  function removeCanvasOwner(owner) {
    if (!owner) return;

    if (owner.kind === 'region') {
      removeRegionItem(owner);
    } else {
      removeImageItem(owner);
    }
  }

  function bindSceneItemInteractions(item) {
    const el = item.element;

    el.addEventListener('mouseenter', () => {
      scheduleDeleteHandleShow(item);
    });

    el.addEventListener('mouseleave', () => {
      scheduleDeleteHandleHide(item);
    });

    el.addEventListener('click', ev => {
      ev.stopPropagation();
      selectItem(item);
      hideLayerMenu();
    });

    el.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      showLayerMenu(ev.clientX, ev.clientY, item);
    });

    el.addEventListener('dblclick', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      selectItem(item);
      const text = prompt('输入素材标签', item.label || '');
      if (text !== null) {
        setItemLabel(item, text);
      }
    });

    el.addEventListener('mousedown', ev => {
      if (paintMode) return;

      // 空格 / 中键要平移，或点在素材的透明处 —— 都当作空白区域处理，
      // 这样用户可以在看上去是空白的地方框选和平移。
      if (spacePanHeld || ev.button === 1 || !isOpaqueAt(item, ev.clientX, ev.clientY)) {
        handleEmptyAreaMouseDown(ev);
        return;
      }

      if (ev.button !== 0) return;

      hideDeleteHandle(item, true);

      // 属于编组时，选中的是整个编组（外框高亮），而不是被点到的那个成员
      const ownerGroup = getGroupOfItem(item);
      if (ownerGroup) selectGroup(ownerGroup);
      else { selectGroup(null); selectItem(item); }

      dragCandidate = {
        item,
        img: el,
        startMouse: { x: ev.clientX, y: ev.clientY },
        startPos: getImagePosition(el)
      };
    });

    if (item.kind === 'image') {
      el.addEventListener('wheel', ev => {
        if (paintMode) return;
        ev.preventDefault();
        ev.stopPropagation();

        // 属于编组时整组一起缩放，保持成员间的相对位置与大小关系
        const group = getGroupOfItem(item);
        if (group) {
          scaleGroupAboutCenter(group, ev.deltaY > 0 ? 0.9 : 1.1);
          return;
        }

        let scale = parseFloat(el.dataset.scale || '1');
        scale += ev.deltaY > 0 ? -0.1 : 0.1;
        scale = clamp(scale, MIN_SCALE, MAX_SCALE);

        el.dataset.scale = String(scale);
        el.style.width = `${100 * scale}px`;

        const current = getImagePosition(el);
        setImagePosition(el, current.x, current.y);
      }, { passive: false });
    }
  }

  // ---------------------------------------------------------------------
  // 画幅比例吸附（附加）
  //
  // 画取景框时找最接近的常见画幅比例，误差在容差内就吸附过去，
  // 并显示比例标签与对齐辅助线。让手圈也能得到精确的画幅。
  // ---------------------------------------------------------------------

  function findNearestAspect(w, h) {
    if (!(w > 0) || !(h > 0)) return null;

    const ratio = w / h;
    let best = null;

    ASPECT_PRESETS.forEach(preset => {
      const err = Math.abs(ratio - preset.value) / preset.value;
      if (!best || err < best.err) best = { ...preset, err };
    });

    return best;
  }

  // 以拖拽起点为锚，把矩形吸附到最近的常见比例
  function snapRectToAspect(startX, startY, curX, curY) {
    const rawW = Math.abs(curX - startX);
    const rawH = Math.abs(curY - startY);
    const nearest = findNearestAspect(rawW, rawH);

    let w = rawW;
    let h = rawH;
    let snapped = false;
    let label = '';

    if (nearest && nearest.err <= ASPECT_SNAP_TOLERANCE) {
      // 以较长边为准换算另一边，避免吸附时框突然跳动
      if (rawW >= rawH) h = rawW / nearest.value;
      else w = rawH * nearest.value;
      snapped = true;
      label = nearest.label;
    } else if (nearest) {
      label = `${(rawW / Math.max(1, rawH)).toFixed(2)}:1`;
    }

    const l = curX >= startX ? startX : startX - w;
    const t = curY >= startY ? startY : startY - h;

    return { l, t, w, h, snapped, label };
  }

  function ensureAspectFeedbackEls() {
    if (!aspectBadgeEl) {
      aspectBadgeEl = document.createElement('div');
      aspectBadgeEl.style.cssText = `
        position:absolute;
        display:none;
        padding:2px 8px;
        border-radius:4px;
        font-size:12px;
        font-weight:600;
        line-height:18px;
        color:#ffffff;
        background:#111827;
        pointer-events:none;
        z-index:1000;
        white-space:nowrap;
      `;
      drawingScene.appendChild(aspectBadgeEl);
    }

    if (aspectGuideEls.length === 0) {
      for (let i = 0; i < 4; i++) {
        const g = document.createElement('div');
        g.style.cssText = `
          position:absolute;
          display:none;
          background:#6b7280;
          opacity:0.4;
          pointer-events:none;
          z-index:999;
        `;
        drawingScene.appendChild(g);
        aspectGuideEls.push(g);
      }
    }
  }

  function updateAspectFeedback(rect) {
    ensureAspectFeedbackEls();

    aspectBadgeEl.textContent = rect.snapped ? `${rect.label}  ✓` : rect.label;
    aspectBadgeEl.style.background = rect.snapped ? '#111827' : '#9ca3af';
    aspectBadgeEl.style.display = 'block';
    aspectBadgeEl.style.left = `${rect.l}px`;
    aspectBadgeEl.style.top = `${Math.max(0, rect.t - 24)}px`;

    // 吸附成功时画四条延伸辅助线，帮助与画面里其它元素对齐
    if (rect.snapped) {
      const span = 4000;
      const lines = [
        { left: rect.l - span, top: rect.t, width: span * 2, height: 1 },
        { left: rect.l - span, top: rect.t + rect.h, width: span * 2, height: 1 },
        { left: rect.l, top: rect.t - span, width: 1, height: span * 2 },
        { left: rect.l + rect.w, top: rect.t - span, width: 1, height: span * 2 }
      ];
      aspectGuideEls.forEach((g, i) => {
        const s = lines[i];
        g.style.display = 'block';
        g.style.left = `${s.left}px`;
        g.style.top = `${s.top}px`;
        g.style.width = `${s.width}px`;
        g.style.height = `${s.height}px`;
      });
    } else {
      aspectGuideEls.forEach(g => { g.style.display = 'none'; });
    }
  }

  function hideAspectFeedback() {
    if (aspectBadgeEl) aspectBadgeEl.style.display = 'none';
    aspectGuideEls.forEach(g => { g.style.display = 'none'; });
  }

  // ---------------------------------------------------------------------
  // 素材编组（附加）
  //
  // 用途：把手绘内容和分割出来的素材打包成一个整体命名操作，
  // 整体拖动与缩放时保持它们之间的相对位置不变。
  // 例如把"小女孩"和一笔画出来的"蝴蝶"打成一组。
  // ---------------------------------------------------------------------

  function getGroupById(groupId) {
    return groups.find(g => g.id === groupId) || null;
  }

  function getGroupMembers(group) {
    if (!group) return [];
    return droppedImages.filter(it => group.memberIds.includes(it.id));
  }

  function getGroupOfItem(item) {
    return item?.groupId ? getGroupById(item.groupId) : null;
  }

  function getItemsBounds(items) {
    if (!items.length) return null;

    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    items.forEach(it => {
      const pos = getImagePosition(it.element);
      const { w, h } = getItemSize(it);
      left = Math.min(left, pos.x);
      top = Math.min(top, pos.y);
      right = Math.max(right, pos.x + w);
      bottom = Math.max(bottom, pos.y + h);
    });

    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  function createGroupFromItems(items, name) {
    const members = items.filter(it => it && it.kind !== 'region');
    if (members.length < 2) return null;

    const id = `group_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const frameEl = document.createElement('div');
    frameEl.style.cssText = `
      position:absolute;
      left:0;
      top:0;
      border:1px dashed #b0b6c0;
      border-radius:6px;
      background:rgba(17,24,39,0.02);
      pointer-events:none;
      z-index:15;
      transform-origin:top left;
      will-change:transform;
    `;
    drawingScene.appendChild(frameEl);

    const labelEl = document.createElement('div');
    labelEl.style.cssText = `
      position:absolute;
      left:0;
      top:0;
      padding:2px 8px;
      border-radius:4px;
      font-size:12px;
      font-weight:500;
      line-height:18px;
      color:#ffffff;
      background:#8b929e;
      pointer-events:auto;
      cursor:pointer;
      z-index:16;
      white-space:nowrap;
      user-select:none;
      transform-origin:top left;
      will-change:transform;
    `;
    labelEl.title = '双击重命名，右键查看更多操作。';
    drawingScene.appendChild(labelEl);

    const group = {
      id,
      name: name || `组合 ${groups.length + 1}`,
      memberIds: members.map(it => it.id),
      frameEl,
      labelEl
    };

    members.forEach(it => { it.groupId = id; });
    groups.push(group);

    labelEl.addEventListener('dblclick', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      renameGroup(group);
    });

    labelEl.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      createGroupMenu();
      showGroupMenu(ev.clientX, ev.clientY, group);
    });

    labelEl.addEventListener('mousedown', ev => ev.stopPropagation());

    refreshGroupVisual(group);
    return group;
  }

  function refreshGroupVisual(group) {
    if (!group) return;

    const members = getGroupMembers(group);
    if (members.length < 2) {
      dissolveGroup(group, { silent: true });
      return;
    }

    const b = getItemsBounds(members);
    if (!b) return;

    const pad = 6;
    // 与素材一样用 transform 定位：两者走同一条合成路径，快速拖动时不会脱节
    group.bounds = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    group.frameEl.style.width = `${group.bounds.w}px`;
    group.frameEl.style.height = `${group.bounds.h}px`;
    group.labelEl.textContent = group.name;
    applyGroupTransform(group, 0, 0);
  }

  // dx/dy 为拖动过程中的临时位移，避免每帧重新测量 DOM 造成的抖动
  function applyGroupTransform(group, dx = 0, dy = 0) {
    if (!group?.bounds) return;

    const x = group.bounds.x + dx;
    const y = group.bounds.y + dy;

    group.frameEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    group.labelEl.style.transform =
      `translate3d(${x}px, ${Math.max(0, y - 22)}px, 0)`;
  }

  function setGroupSelected(group, selected) {
    if (!group?.frameEl) return;
    group.frameEl.style.borderColor = selected ? '#6b7280' : '#b0b6c0';
    group.frameEl.style.borderWidth = selected ? '1.5px' : '1px';
    group.frameEl.style.background = selected
      ? 'rgba(17,24,39,0.05)'
      : 'rgba(17,24,39,0.02)';
    group.labelEl.style.background = selected ? '#4b5563' : '#8b929e';
  }

  function selectGroup(group) {
    selectedGroup = group || null;
    clearSelection();
    groups.forEach(g => setGroupSelected(g, g === selectedGroup));
  }

  function refreshAllGroupVisuals() {
    groups.slice().forEach(refreshGroupVisual);
  }

  function renameGroup(group) {
    if (!group) return;
    const next = window.prompt('为这个组合命名（例如“女孩和蝴蝶”）', group.name);
    if (next === null) return;
    group.name = next.trim() || group.name;
    refreshGroupVisual(group);
  }

  function dissolveGroup(group, options = {}) {
    if (!group) return;

    getGroupMembers(group).forEach(it => { delete it.groupId; });
    group.frameEl?.remove();
    group.labelEl?.remove();
    groups = groups.filter(g => g !== group);
    if (selectedGroup === group) selectedGroup = null;
    if (dragGroupRef === group) dragGroupRef = null;

    if (!options.silent) hideGroupMenu();
  }

  function deleteGroupWithMembers(group) {
    if (!group) return;
    getGroupMembers(group).forEach(it => removeImageItem(it));
    dissolveGroup(group, { silent: true });
    hideGroupMenu();
  }

  // 以整组包围盒中心为基准缩放，保持成员之间的相对位置
  function scaleGroupAboutCenter(group, factor) {
    const members = getGroupMembers(group);
    if (members.length < 2) return;

    const b = getItemsBounds(members);
    if (!b) return;

    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;

    members.forEach(it => {
      const pos = getImagePosition(it.element);
      const before = getItemSize(it);
      const itemCx = pos.x + before.w / 2;
      const itemCy = pos.y + before.h / 2;
      const el = it.element;

      if (it.kind === 'image') {
        const cur = parseFloat(el.dataset.scale || '1');
        const next = clamp(cur * factor, MIN_SCALE, MAX_SCALE);
        el.dataset.scale = String(next);
        el.style.width = `${100 * next}px`;
      } else if (before.w > 0 && before.h > 0) {
        el.style.width = `${before.w * factor}px`;
        el.style.height = `${before.h * factor}px`;
      }

      const after = getItemSize(it);
      const nextCx = cx + (itemCx - cx) * factor;
      const nextCy = cy + (itemCy - cy) * factor;
      setImagePosition(el, nextCx - after.w / 2, nextCy - after.h / 2);
    });

    refreshGroupVisual(group);
  }

  function createGroupMenu() {
    if (groupMenu) return;

    groupMenu = buildStyledMenu('canvas-group-menu', [
      { key: 'rename', label: '重命名组合' },
      { key: 'sep' },
      { key: 'scale-up', label: '放大（保持布局）' },
      { key: 'scale-down', label: '缩小（保持布局）' },
      { key: 'sep2' },
      { key: 'ungroup', label: '取消组合（保留素材）' },
      { key: 'delete', label: '删除组合和素材', danger: true }
    ], action => {
      if (!groupMenuTarget) return;
      handleGroupAction(groupMenuTarget, action);
      hideGroupMenu();
    });

    document.addEventListener('click', hideGroupMenu);
    window.addEventListener('blur', hideGroupMenu);
    document.addEventListener('scroll', hideGroupMenu, true);
  }

  function showGroupMenu(x, y, group) {
    if (!groupMenu) return;
    groupMenuTarget = group;
    positionStyledMenu(groupMenu, x, y);
  }

  function hideGroupMenu() {
    if (!groupMenu) return;
    groupMenu.style.display = 'none';
    groupMenuTarget = null;
  }

  function handleGroupAction(group, action) {
    if (action === 'rename') renameGroup(group);
    else if (action === 'scale-up') scaleGroupAboutCenter(group, 1.15);
    else if (action === 'scale-down') scaleGroupAboutCenter(group, 0.87);
    else if (action === 'ungroup') dissolveGroup(group);
    else if (action === 'delete') deleteGroupWithMembers(group);
  }

  // ---------------------------------------------------------------------
  // 三个右键菜单共用的外观与定位，保证素材 / 取景框 / 编组样式一致
  // ---------------------------------------------------------------------

  function buildStyledMenu(domId, actions, onAction) {
    const menu = document.createElement('div');
    menu.id = domId;
    menu.style.cssText = `
      position:fixed;
      display:none;
      min-width:200px;
      background:#ffffff;
      border:1px solid #e5e7eb;
      border-radius:8px;
      box-shadow:0 8px 24px rgba(0,0,0,0.12);
      padding:6px;
      z-index:99999;
    `;

    menu.addEventListener('contextmenu', e => e.preventDefault());
    menu.addEventListener('mousedown', e => e.stopPropagation());

    actions.forEach(action => {
      if (action.key.startsWith('sep')) {
        const hr = document.createElement('div');
        hr.style.cssText = 'height:1px;background:#e5e7eb;margin:4px 6px;';
        menu.appendChild(hr);
        return;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.action = action.key;
      btn.textContent = action.label;
      btn.style.cssText = `
        width:100%;
        display:block;
        border:none;
        background:transparent;
        text-align:left;
        padding:8px 10px;
        border-radius:6px;
        cursor:pointer;
        font-size:13px;
        color:${action.danger ? '#dc2626' : 'inherit'};
      `;
      btn.onmouseenter = () => { btn.style.background = action.danger ? '#fef2f2' : '#f3f4f6'; };
      btn.onmouseleave = () => { btn.style.background = 'transparent'; };
      menu.appendChild(btn);
    });

    menu.addEventListener('click', e => {
      const action = e.target?.dataset?.action;
      if (action) onAction(action);
    });

    document.body.appendChild(menu);
    return menu;
  }

  function positionStyledMenu(menu, x, y) {
    menu.style.display = 'block';

    const menuW = menu.offsetWidth || 200;
    const menuH = menu.offsetHeight || 260;
    const left = Math.min(x, window.innerWidth - menuW - 8);
    const top = Math.min(y, window.innerHeight - menuH - 8);

    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  // 空格键平移：按住时光标变抓手，松开恢复。输入框内不触发。
  function isTextEntryTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  }

  function updateBoardCursor() {
    if (paintMode) return;
    if (spacePanHeld) drawingBoard.style.cursor = 'grab';
    else if (drawSubCanvasMode) drawingBoard.style.cursor = 'crosshair';
    else drawingBoard.style.cursor = 'default';
  }

  function bindSpacePanKeys() {
    window.addEventListener('keydown', e => {
      if (e.code !== 'Space' || e.repeat) return;
      if (isTextEntryTarget(e.target)) return;
      e.preventDefault();          // 避免页面滚动
      spacePanHeld = true;
      updateBoardCursor();
    });

    window.addEventListener('keyup', e => {
      if (e.code !== 'Space') return;
      spacePanHeld = false;
      updateBoardCursor();
    });

    // 切走窗口时复位，避免回来后卡在平移状态
    window.addEventListener('blur', () => {
      spacePanHeld = false;
      updateBoardCursor();
    });
  }

  // ---------------------------------------------------------------------
  // 按像素透明度命中判定（附加）
  //
  // 分割出来的 PNG 和手绘笔画周围都有大片透明区域。若按元素矩形判定，
  // 用户点在看上去是空白的地方也会抓住素材，无法框选或平移。
  // 这里改成读取该点的 alpha：透明处不视为命中，事件按空白区域处理。
  // ---------------------------------------------------------------------

  const HIT_ALPHA_THRESHOLD = 12;   // 低于此值视为透明
  const HIT_SAMPLE_MAX = 256;       // 采样画布最长边，控制内存

  function ensureHitCanvas(item) {
    if (!item || item._hitReady || item._hitLoading) return;

    // mask 类型本身就是画布，直接用
    if (item.kind === 'mask' && item.sourceCanvas) {
      item._hitCanvas = item.sourceCanvas;
      item._hitCtx = item.sourceCanvas.getContext('2d', { willReadFrequently: true });
      item._hitReady = true;
      return;
    }

    const src = item.originalSrc || item.element?.src;
    if (!src) return;

    item._hitLoading = true;
    loadImageAsync(src)
      .then(img => {
        const nw = img.naturalWidth || img.width || 1;
        const nh = img.naturalHeight || img.height || 1;
        const k = Math.min(1, HIT_SAMPLE_MAX / Math.max(nw, nh));

        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(nw * k));
        c.height = Math.max(1, Math.round(nh * k));

        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, c.width, c.height);

        item._hitCanvas = c;
        item._hitCtx = ctx;
        item._hitReady = true;
      })
      .catch(() => {
        // 取不到像素（跨域等）时保持旧行为：整块矩形都可拖
        item._hitUnavailable = true;
      })
      .finally(() => {
        item._hitLoading = false;
      });
  }

  // 返回 true 表示该点落在不透明像素上。取不到像素信息时一律返回 true，
  // 保证降级后行为与改动前一致。
  function isOpaqueAt(item, clientX, clientY) {
    if (!item || item._hitUnavailable) return true;
    if (!item._hitReady || !item._hitCtx) return true;

    const scenePoint = screenToScene(clientX, clientY);
    const pos = getImagePosition(item.element);
    const { w, h } = getItemSize(item);
    if (!(w > 0) || !(h > 0)) return true;

    let u = (scenePoint.x - pos.x) / w;
    let v = (scenePoint.y - pos.y) / h;
    if (item.flipX) u = 1 - u;
    if (item.flipY) v = 1 - v;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;

    const cw = item._hitCanvas.width;
    const ch = item._hitCanvas.height;
    const px = Math.min(cw - 1, Math.max(0, Math.floor(u * cw)));
    const py = Math.min(ch - 1, Math.max(0, Math.floor(v * ch)));

    try {
      const alpha = item._hitCtx.getImageData(px, py, 1, 1).data[3];
      return alpha >= HIT_ALPHA_THRESHOLD;
    } catch (_) {
      item._hitUnavailable = true;
      return true;
    }
  }

  // 空白区域按下：左键框选；Ctrl/Command、空格或中键平移。素材透明处也走这里。
  function handleEmptyAreaMouseDown(e) {
    if (drawSubCanvasMode || paintMode) return;
    if (e.button !== 0 && e.button !== 1) return;

    const wantsPan = e.button === 1 || e.ctrlKey || e.metaKey || spacePanHeld;

    if (!wantsPan && e.button === 0) {
      e.preventDefault();
      selectGroup(null);
      startGroupMarquee(e);
      return;
    }

    boardPanCandidate = {
      startMouse: { x: e.clientX, y: e.clientY },
      startCamera: { ...camera }
    };
    e.preventDefault();
  }

  function startGroupMarquee(e) {
    groupMarqueeStart = screenToScene(e.clientX, e.clientY);

    groupMarqueeEl = document.createElement('div');
    groupMarqueeEl.style.cssText = `
      position:absolute;
      left:${groupMarqueeStart.x}px;
      top:${groupMarqueeStart.y}px;
      width:0;
      height:0;
      border:1px dashed #9ca3af;
      background:rgba(17,24,39,0.04);
      border-radius:4px;
      pointer-events:none;
      z-index:1001;
    `;
    drawingScene.appendChild(groupMarqueeEl);
  }

  function finishGroupMarquee(marquee) {
    // 与框相交的素材都算选中（不要求完全包住，手绘笔画往往会超出）
    const hit = droppedImages.filter(it => {
      if (it.groupId) return false;
      const pos = getImagePosition(it.element);
      const { w, h } = getItemSize(it);
      const rect = { x: pos.x, y: pos.y, w, h };
      return rectIntersectArea(rect, marquee) > 0;
    });

    if (hit.length < 2) {
      console.warn('[Group] Fewer than 2 assets in the marquee; no group created.');
      return;
    }

    const group = createGroupFromItems(hit);
    if (group) {
      renameGroup(group);
      selectGroup(group);
    }
  }

  function createRegionBox(l, t, w, h) {
    const region = document.createElement('div');
    const id = `region_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    region.dataset.regionId = id;
    region.style.cssText = `
      position:absolute;
      left:${l}px;
      top:${t}px;
      width:${w}px;
      height:${h}px;
      pointer-events:none;
      z-index:20;
    `;

    const frameEl = document.createElement('div');
    frameEl.style.cssText = `
      position:absolute;
      inset:0;
      pointer-events:none;
    `;
    applyRegionStyle(frameEl, { temp: false });

    const gripEl = document.createElement('div');
    gripEl.style.cssText = `
      position:absolute;
      left:0;
      right:0;
      top:0;
      height:${REGION_GRIP_HEIGHT}px;
      pointer-events:auto;
      cursor:grab;
      background:transparent;
    `;

    const gripVisualEl = document.createElement('div');
    gripVisualEl.style.cssText = `
      position:absolute;
      left:10px;
      top:6px;
      width:34px;
      height:4px;
      border-radius:999px;
      background:${normalizeHexColor(regionColor)};
      opacity:0.28;
      pointer-events:none;
    `;

    gripEl.appendChild(gripVisualEl);
    region.appendChild(frameEl);
    region.appendChild(gripEl);
    drawingScene.appendChild(region);

    const item = {
      kind: 'region',
      id,
      element: region,
      frameEl,
      gripEl,
      gripVisualEl,
      x: l,
      y: t,
      w,
      h,
      deleteBtn: null,
      deleteHovering: false,
      showDeleteTimer: null,
      hideDeleteTimer: null,
      flipX: false,
      flipY: false
    };

    subCanvases.push(item);
    activeRegionId = id;

    gripEl.addEventListener('mousedown', (ev) => {
      if (paintMode || drawSubCanvasMode) return;
      if (ev.button !== 0) return;

      ev.preventDefault();
      ev.stopPropagation();

      activeRegionId = id;
      hideDeleteHandle(item, true);

      regionDragCandidate = {
        item,
        startMouse: { x: ev.clientX, y: ev.clientY },
        startPos: { x: item.x, y: item.y }
      };
    });

    gripEl.addEventListener('mouseenter', () => {
      scheduleDeleteHandleShow(item);
    });

    gripEl.addEventListener('mouseleave', () => {
      scheduleDeleteHandleHide(item);
    });

    gripEl.addEventListener('click', (ev) => {
      ev.stopPropagation();
      activeRegionId = id;
    });

    // 取景框拖拽条上的右键菜单（附加功能，与素材图层菜单同一套模式）
    gripEl.addEventListener('contextmenu', (ev) => {
      if (paintMode || drawSubCanvasMode) return;
      ev.preventDefault();
      ev.stopPropagation();
      activeRegionId = id;
      createRegionMenu();
      showRegionMenu(ev.clientX, ev.clientY, item);
    });

    return item;
  }

  // ---------------------------------------------------------------------
  // 取景框右键菜单（纯附加）
  //
  // 设计取舍：
  //  - 长宽比必须一致，否则关键帧剪不到一起 → 所有复制/推拉都锁定原比例
  //  - 场景内尺寸允许不同 → 框大即远景、框小即近景，这是表达推拉镜头的手段，
  //    不能被"统一大小"抹掉
  //  - 重叠比例做成显式参数 → 创作者主动声明两个关键帧共享多少内容，
  //    而不是靠拖拽碰巧叠上
  // ---------------------------------------------------------------------

  function getRegionAspect(item) {
    return item && item.h > 0 ? item.w / item.h : 0;
  }

  function setRegionBounds(item, x, y, w, h) {
    if (!item || !item.element) return;
    item.x = x;
    item.y = y;
    item.w = w;
    item.h = h;
    item.element.style.left = `${x}px`;
    item.element.style.top = `${y}px`;
    item.element.style.width = `${w}px`;
    item.element.style.height = `${h}px`;
    updateDeleteHandlePosition(item);
  }

  function ensureRegionOverlapFeedback() {
    if (regionOverlapFeedbackEl) return regionOverlapFeedbackEl;

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:absolute;
      display:none;
      pointer-events:none;
      z-index:1002;
      background:rgba(100,116,139,0.2);
      box-shadow:inset 0 0 0 1px rgba(71,85,105,0.5);
    `;

    const label = document.createElement('div');
    label.style.cssText = `
      position:absolute;
      left:50%;
      top:50%;
      transform:translate(-50%,-50%);
      padding:3px 7px;
      border-radius:999px;
      background:rgba(55,65,81,0.92);
      color:#ffffff;
      font-size:11px;
      font-weight:700;
      line-height:1.2;
      white-space:nowrap;
      box-shadow:0 2px 8px rgba(15,23,42,0.2);
    `;
    overlay.appendChild(label);
    drawingScene.appendChild(overlay);
    regionOverlapFeedbackEl = overlay;
    return overlay;
  }

  function hideRegionOverlapFeedback() {
    if (regionOverlapFeedbackEl) regionOverlapFeedbackEl.style.display = 'none';
  }

  function ensureRegionAlignmentGuides() {
    const createGuide = () => {
      const guide = document.createElement('div');
      guide.style.cssText = `
        position:absolute;
        display:none;
        pointer-events:none;
        z-index:1003;
        background:rgba(75,85,99,0.62);
      `;
      drawingScene.appendChild(guide);
      return guide;
    };

    if (!regionAlignmentGuideX) regionAlignmentGuideX = createGuide();
    if (!regionAlignmentGuideY) regionAlignmentGuideY = createGuide();
  }

  function hideRegionAlignmentGuides() {
    if (regionAlignmentGuideX) regionAlignmentGuideX.style.display = 'none';
    if (regionAlignmentGuideY) regionAlignmentGuideY.style.display = 'none';
  }

  function alignDraggedRegion(item, x, y) {
    const threshold = 7 / Math.max(camera.scale, 0.01);
    let bestX = null;
    let bestY = null;

    const movingX = [x, x + item.w / 2, x + item.w];
    const movingY = [y, y + item.h / 2, y + item.h];

    subCanvases.forEach(other => {
      if (other === item) return;

      const targetX = [other.x, other.x + other.w / 2, other.x + other.w];
      const targetY = [other.y, other.y + other.h / 2, other.y + other.h];

      movingX.forEach(source => targetX.forEach(target => {
        const delta = target - source;
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, coordinate: target };
        }
      }));

      movingY.forEach(source => targetY.forEach(target => {
        const delta = target - source;
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, coordinate: target };
        }
      }));
    });

    ensureRegionAlignmentGuides();
    const span = 8000;

    if (bestX) {
      regionAlignmentGuideX.style.display = 'block';
      regionAlignmentGuideX.style.left = `${bestX.coordinate}px`;
      regionAlignmentGuideX.style.top = `${-span / 2}px`;
      regionAlignmentGuideX.style.width = '1px';
      regionAlignmentGuideX.style.height = `${span}px`;
    } else {
      regionAlignmentGuideX.style.display = 'none';
    }

    if (bestY) {
      regionAlignmentGuideY.style.display = 'block';
      regionAlignmentGuideY.style.left = `${-span / 2}px`;
      regionAlignmentGuideY.style.top = `${bestY.coordinate}px`;
      regionAlignmentGuideY.style.width = `${span}px`;
      regionAlignmentGuideY.style.height = '1px';
    } else {
      regionAlignmentGuideY.style.display = 'none';
    }

    return {
      x: x + (bestX?.delta || 0),
      y: y + (bestY?.delta || 0)
    };
  }

  function updateRegionOverlapFeedback(item) {
    if (!item || !(item.w > 0) || !(item.h > 0)) {
      hideRegionOverlapFeedback();
      return;
    }

    let best = null;
    subCanvases.forEach(other => {
      if (other === item) return;

      const left = Math.max(item.x, other.x);
      const top = Math.max(item.y, other.y);
      const right = Math.min(item.x + item.w, other.x + other.w);
      const bottom = Math.min(item.y + item.h, other.y + other.h);
      const w = right - left;
      const h = bottom - top;
      if (w <= 0 || h <= 0) return;

      const area = w * h;
      if (!best || area > best.area) best = { left, top, w, h, area };
    });

    if (!best) {
      hideRegionOverlapFeedback();
      return;
    }

    const overlay = ensureRegionOverlapFeedback();
    const percentage = Math.min(100, (best.area / (item.w * item.h)) * 100);
    overlay.style.display = 'block';
    overlay.style.left = `${best.left}px`;
    overlay.style.top = `${best.top}px`;
    overlay.style.width = `${best.w}px`;
    overlay.style.height = `${best.h}px`;
    overlay.firstElementChild.textContent = `重叠 ${percentage.toFixed(1)}%`;
  }

  // 按给定方向复制一个同尺寸同比例的取景框，overlap 为与原框的重叠比例（0~0.9）。
  // no-overlap 布局额外留出间距，避免两个关键帧边框贴在一起。
  function duplicateRegion(item, direction, overlap) {
    if (!item) return null;

    const ratio = Math.min(0.9, Math.max(0, Number(overlap) || 0));
    const gap = ratio === 0 ? KEYFRAME_DUPLICATE_GAP : 0;
    const stepX = item.w * (1 - ratio) + gap;
    const stepY = item.h * (1 - ratio) + gap;

    let nx = item.x;
    let ny = item.y;
    if (direction === 'right') nx = item.x + stepX;
    else if (direction === 'left') nx = item.x - stepX;
    else if (direction === 'down') ny = item.y + stepY;
    else if (direction === 'up') ny = item.y - stepY;

    const created = createRegionBox(nx, ny, item.w, item.h);
    activeRegionId = created?.id ?? activeRegionId;
    return created;
  }

  // 以中心为基准缩放取景框，保持长宽比。factor < 1 为推近，> 1 为拉远
  function scaleRegionAboutCenter(item, factor) {
    if (!item || !Number.isFinite(factor) || factor <= 0) return;

    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    const nw = Math.max(REGION_MIN_SIZE, item.w * factor);
    const nh = Math.max(REGION_MIN_SIZE, item.h * factor);

    setRegionBounds(item, cx - nw / 2, cy - nh / 2, nw, nh);
  }

  // 把当前取景框的尺寸对齐到第一个取景框（保持中心不动）
  function matchRegionToFirst(item) {
    const first = subCanvases[0];
    if (!first || first === item) return;

    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    setRegionBounds(item, cx - first.w / 2, cy - first.h / 2, first.w, first.h);
  }

  // 检查所有取景框长宽比是否一致，不一致时在控制台提示
  function reportRegionAspectMismatch() {
    if (subCanvases.length < 2) return true;

    const base = getRegionAspect(subCanvases[0]);
    if (!base) return true;

    const off = subCanvases
      .map((r, i) => ({ i, a: getRegionAspect(r) }))
      .filter(({ a }) => a > 0 && Math.abs(a - base) / base > 0.02);

    if (off.length) {
      console.warn(
        `[Viewport] Aspect ratios differ: viewport 1 is ${base.toFixed(3)}, ` +
        off.map(({ i, a }) => `viewport ${i + 1} is ${a.toFixed(3)}`).join(', ') +
        '. Keyframes with different aspect ratios cannot be cut together. ' +
        'Use "Match Size to First Viewport" in the viewport right-click menu.'
      );
      return false;
    }
    return true;
  }

  function createRegionMenu() {
    if (regionMenu) return;

    regionMenu = buildStyledMenu('canvas-region-menu', [
      { key: 'dup-right-0',  label: '向右复制 - 不重叠' },
      { key: 'dup-down-0',   label: '向下复制 - 不重叠' },
      { key: 'dup-right-30', label: '向右复制 - 重叠 30%' },
      { key: 'dup-down-30',  label: '向下复制 - 重叠 30%' },
      { key: 'sep' },
      { key: 'push-in',      label: '推近（更紧的镜头）' },
      { key: 'pull-out',     label: '拉远（更宽的镜头）' },
      { key: 'match-first',  label: '匹配第一个取景框尺寸' },
      { key: 'sep2' },
      { key: 'delete',       label: '删除取景框', danger: true }
    ], action => {
      if (!regionMenuTarget) return;
      handleRegionAction(regionMenuTarget, action);
      hideRegionMenu();
    });

    document.addEventListener('click', hideRegionMenu);
    window.addEventListener('blur', hideRegionMenu);
    document.addEventListener('scroll', hideRegionMenu, true);
  }

  function showRegionMenu(x, y, item) {
    if (!regionMenu) return;
    regionMenuTarget = item;
    positionStyledMenu(regionMenu, x, y);
  }

  function hideRegionMenu() {
    if (!regionMenu) return;
    regionMenu.style.display = 'none';
    regionMenuTarget = null;
  }

  function handleRegionAction(item, action) {
    if (!item) return;

    if (action === 'dup-right-0') duplicateRegion(item, 'right', 0);
    else if (action === 'dup-down-0') duplicateRegion(item, 'down', 0);
    else if (action === 'dup-right-30') duplicateRegion(item, 'right', 0.3);
    else if (action === 'dup-down-30') duplicateRegion(item, 'down', 0.3);
    else if (action === 'push-in') scaleRegionAboutCenter(item, 0.8);
    else if (action === 'pull-out') scaleRegionAboutCenter(item, 1.25);
    else if (action === 'match-first') matchRegionToFirst(item);
    else if (action === 'delete') { removeRegionItem(item); return; }

    reportRegionAspectMismatch();
  }

  function createLayerMenu() {
    if (layerMenu) return;

    layerMenu = buildStyledMenu('canvas-layer-menu', [
      { key: 'bring-front',     label: '置于顶层' },
      { key: 'forward-one',     label: '上移一层' },
      { key: 'backward-one',    label: '下移一层' },
      { key: 'send-back',       label: '置于底层' },
      { key: 'sep' },
      { key: 'flip-horizontal', label: '水平翻转' },
      { key: 'flip-vertical',   label: '垂直翻转' },
      { key: 'edit-label',      label: '编辑标签' },
      { key: 'sep2' },
      { key: 'group-selected',  label: '与所选素材组合...' },
      { key: 'ungroup',         label: '取消组合' },
      { key: 'sep3' },
      { key: 'delete',          label: '删除素材', danger: true }
    ], action => {
      if (!layerMenuTarget) return;
      handleLayerAction(layerMenuTarget, action);
      hideLayerMenu();
    });

    document.addEventListener('click', hideLayerMenu);
    window.addEventListener('blur', hideLayerMenu);
    document.addEventListener('scroll', hideLayerMenu, true);
  }

  function showLayerMenu(x, y, item) {
    if (!layerMenu) return;

    layerMenuTarget = item;
    selectItem(item);
    positionStyledMenu(layerMenu, x, y);
  }

  function hideLayerMenu() {
    if (!layerMenu) return;
    layerMenu.style.display = 'none';
    layerMenuTarget = null;
  }

  function handleLayerAction(item, action) {
    const sorted = getSortedItems();
    const idx = sorted.findIndex(it => it === item);
    if (idx === -1) return;

    if (action === 'bring-front') {
      item.zIndex = Math.max(...sorted.map(it => it.zIndex)) + 1;
      normalizeLayerOrder();
      selectItem(item);
      return;
    }

    if (action === 'send-back') {
      item.zIndex = Math.min(...sorted.map(it => it.zIndex)) - 1;
      normalizeLayerOrder();
      selectItem(item);
      return;
    }

    if (action === 'forward-one' && idx < sorted.length - 1) {
      const next = sorted[idx + 1];
      const tmp = item.zIndex;
      item.zIndex = next.zIndex;
      next.zIndex = tmp;
      normalizeLayerOrder();
      selectItem(item);
      return;
    }

    if (action === 'backward-one' && idx > 0) {
      const prev = sorted[idx - 1];
      const tmp = item.zIndex;
      item.zIndex = prev.zIndex;
      prev.zIndex = tmp;
      normalizeLayerOrder();
      selectItem(item);
      return;
    }

    if (action === 'flip-horizontal') {
      item.flipX = !item.flipX;
      applyItemTransform(item);
      return;
    }

    if (action === 'flip-vertical') {
      item.flipY = !item.flipY;
      applyItemTransform(item);
      return;
    }

    // --- 编组相关（附加） ---
    if (action === 'group-selected') {
      const existing = getGroupOfItem(item);
      if (existing) {
        window.alert('这个素材已经属于一个组合，请先取消组合。');
        return;
      }
      window.alert('请使用“选择”工具，拖框圈选要组合的素材。');
      return;
    }

    if (action === 'ungroup') {
      const group = getGroupOfItem(item);
      if (group) dissolveGroup(group);
      return;
    }

    if (action === 'delete') {
      const group = getGroupOfItem(item);
      removeImageItem(item);
      if (group) refreshGroupVisual(group);
      return;
    }

    if (action === 'edit-label') {
      const text = prompt('为这个素材命名', item.label || '');
      if (text !== null) {
        setItemLabel(item, text);
      }
    }
  }

  function splitLabelLines(ctx, text, maxWidth) {
    const chars = Array.from(text || '');
    const lines = [];
    let current = '';

    chars.forEach(ch => {
      const test = current + ch;
      if (current && ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = ch;
      } else {
        current = test;
      }
    });

    if (current) lines.push(current);
    return lines;
  }

  function drawLabelsToCanvas(ctx, items, clip) {
    items.forEach(item => {
      if (!item.label) return;

      const pos = getImagePosition(item.element);
      const screenPos = sceneToScreen(pos.x, pos.y);
      const x = screenPos.x - clip.x;
      const y = screenPos.y - clip.y;

      ctx.save();
      const fontSize = Math.max(12, Math.round(13 * camera.scale));
      ctx.font = `600 ${fontSize}px sans-serif`;

      const maxWidth = Math.max(120, item.element.offsetWidth * camera.scale);
      const lines = splitLabelLines(ctx, item.label, maxWidth - 16);
      const lineHeight = Math.max(18, Math.round(18 * camera.scale));
      const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 40);

      const boxW = Math.min(maxWidth, textWidth + 16);
      const boxH = lines.length * lineHeight + 10;
      const boxX = x;
      const boxY = Math.max(0, y - boxH - 6);

      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(boxX, boxY, boxW, boxH);

      ctx.strokeStyle = 'rgba(100,116,139,0.72)';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = '#0f172a';
      lines.forEach((line, i) => {
        ctx.fillText(line, boxX + 8, boxY + fontSize + 5 + i * lineHeight);
      });

      ctx.restore();
    });
  }

  async function drawExportItem(ctx, item, clip, scale) {
    const pos = getImagePosition(item.element);
    const screenPos = sceneToScreen(pos.x, pos.y);
    const x = screenPos.x - clip.x;
    const y = screenPos.y - clip.y;

    const { w, h } = getItemSize(item);
    const drawW = w * camera.scale;
    const drawH = h * camera.scale;

    const flipX = item.flipX ? -1 : 1;
    const flipY = item.flipY ? -1 : 1;

    ctx.save();
    ctx.translate(
      x + (item.flipX ? drawW : 0),
      y + (item.flipY ? drawH : 0)
    );
    ctx.scale(flipX, flipY);

    try {
      if (item.kind === 'mask') {
        ctx.drawImage(item.sourceCanvas || item.element, 0, 0, drawW, drawH);
      } else {
        const renderable = ENABLE_LIGHT_SR
          ? await buildLightSRSource(item, scale * camera.scale)
          : await loadImageAsync(item.originalSrc || item.element.src);

        ctx.drawImage(renderable, 0, 0, drawW, drawH);
      }
    } catch (err) {
      console.error('Failed to render item during export:', err);
    }

    ctx.restore();
  }

  async function drawExportItemsInOrder(ctx, items, clip, scale, options = {}) {
    for (const item of items) {
      if (options.onlyMask && item.kind !== 'mask') continue;
      if (options.includeMask === false && item.kind === 'mask') continue;
      await drawExportItem(ctx, item, clip, scale);
    }
  }
  function createExportCanvas(clip, scale = getRecommendedExportScale()) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(clip.w * scale));
    c.height = Math.max(1, Math.round(clip.h * scale));
    c.style.width = `${clip.w}px`;
    c.style.height = `${clip.h}px`;

    const ctx = c.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    return { c, ctx, scale };
  }

  function getRecommendedExportScale() {
    const base = Math.max(2, SCREEN_DPR);

    const ratios = droppedImages
      .map(({ element }) => {
        const displayW = element.offsetWidth || parseFloat(element.style.width) || 100;
        const naturalW = element.naturalWidth || displayW;
        return naturalW / displayW;
      })
      .filter(v => Number.isFinite(v) && v > 0);

    return Math.min(MAX_EXPORT_SCALE, Math.max(base, ...ratios));
  }

  function getClipFromRegion(region) {
    return {
      x: region.x * camera.scale + camera.x,
      y: region.y * camera.scale + camera.y,
      w: region.w * camera.scale,
      h: region.h * camera.scale
    };
  }

  function getRegionSceneRect(region) {
    return {
      left: region.x,
      top: region.y,
      right: region.x + region.w,
      bottom: region.y + region.h
    };
  }

  function getImageSceneRect(item) {
    const pos = getImagePosition(item.element);

    const width =
      item.element.offsetWidth ||
      parseFloat(item.element.style.width) ||
      0;

    const height =
      item.element.offsetHeight ||
      (item.element.naturalWidth
        ? (width * item.element.naturalHeight) / item.element.naturalWidth
        : 0);

    return {
      left: pos.x,
      top: pos.y,
      right: pos.x + width,
      bottom: pos.y + height,
      width,
      height
    };
  }

  function rectIntersectionArea(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);

    const w = right - left;
    const h = bottom - top;

    if (w <= 0 || h <= 0) return 0;
    return w * h;
  }

  function pointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function collectImagesInsideRegion(region) {
    const regionRect = getRegionSceneRect(region);

    return droppedImages
      // 已编组的素材代表用户刻意摆好的空间关系，移动取景框时不应打乱它们
      .filter(item => !item.groupId)
      .filter(item => {
        const imageRect = getImageSceneRect(item);
        const overlapArea = rectIntersectionArea(imageRect, regionRect);
        const imageArea = Math.max(1, imageRect.width * imageRect.height);

        const centerX = imageRect.left + imageRect.width / 2;
        const centerY = imageRect.top + imageRect.height / 2;
        const centerInside = pointInRect(centerX, centerY, regionRect);

        // 更宽松的归属规则：
        // 1. 中心点在 region 内，或者
        // 2. 有可见重叠面积（>= 图片面积的 8%），或者
        // 3. 有至少 24px*24px 的重叠
        return (
          centerInside ||
          overlapArea / imageArea >= 0.08 ||
          overlapArea >= 24 * 24
        );
      })
      .map(item => ({
        item,
        startPos: getImagePosition(item.element)
      }));
  }

  function captureMaskRegionForDrag(region) {
    if (!maskSceneCanvas || !maskSceneCtx) return null;

    const sx = Math.round(region.x + MASK_SCENE_ORIGIN);
    const sy = Math.round(region.y + MASK_SCENE_ORIGIN);
    const sw = Math.max(1, Math.round(region.w));
    const sh = Math.max(1, Math.round(region.h));

    const snapshot = document.createElement('canvas');
    snapshot.width = sw;
    snapshot.height = sh;

    const sctx = snapshot.getContext('2d');
    sctx.drawImage(
      maskSceneCanvas,
      sx, sy, sw, sh,
      0, 0, sw, sh
    );

    // 从旧位置清掉
    maskSceneCtx.clearRect(sx, sy, sw, sh);
    renderMaskViewport();

    const preview = document.createElement('canvas');
    preview.width = sw;
    preview.height = sh;
    preview.style.cssText = `
      position:absolute;
      pointer-events:none;
      z-index:41;
    `;

    const pctx = preview.getContext('2d');
    pctx.drawImage(snapshot, 0, 0);

    drawingBoard.appendChild(preview);

    return {
      snapshot,
      preview,
      startRect: { x: region.x, y: region.y, w: region.w, h: region.h }
    };
  }

  function updateMaskRegionPreview(maskState, region) {
    if (!maskState?.preview) return;

    const topLeft = sceneToScreen(region.x, region.y);

    maskState.preview.style.left = `${topLeft.x}px`;
    maskState.preview.style.top = `${topLeft.y}px`;
    maskState.preview.style.width = `${region.w * camera.scale}px`;
    maskState.preview.style.height = `${region.h * camera.scale}px`;
  }

  function commitMaskRegionDrag(maskState, region) {
    if (!maskState?.snapshot || !maskSceneCtx) return;

    const dx = Math.round(region.x + MASK_SCENE_ORIGIN);
    const dy = Math.round(region.y + MASK_SCENE_ORIGIN);
    const dw = Math.max(1, Math.round(region.w));
    const dh = Math.max(1, Math.round(region.h));

    maskSceneCtx.drawImage(
      maskState.snapshot,
      0, 0,
      maskState.snapshot.width,
      maskState.snapshot.height,
      dx, dy,
      dw, dh
    );

    if (maskState.preview?.parentNode) {
      maskState.preview.parentNode.removeChild(maskState.preview);
    }

    renderMaskViewport();
  }
  function clearMaskRegionDragState(maskState) {
    if (!maskState) return;
    if (maskState.preview?.parentNode) {
      maskState.preview.parentNode.removeChild(maskState.preview);
    }
  }

  function drawMaskClipToContext(ctx, clip) {
    if (!maskSceneCanvas) return;

    const sceneLeft = (clip.x - camera.x) / camera.scale;
    const sceneTop = (clip.y - camera.y) / camera.scale;
    const sceneWidth = clip.w / camera.scale;
    const sceneHeight = clip.h / camera.scale;

    const params = resolveMaskDrawParams(
      sceneLeft,
      sceneTop,
      sceneWidth,
      sceneHeight,
      clip.w,
      clip.h
    );

    if (!params) return;

    ctx.drawImage(
      maskSceneCanvas,
      params.srcX,
      params.srcY,
      params.srcW,
      params.srcH,
      params.dstX,
      params.dstY,
      params.dstW,
      params.dstH
    );
  }

  async function exportCanvasToImage(type, options = {}) {
    if (subCanvases.length > 0) {
      for (let i = 0; i < subCanvases.length; i++) {
        const clip = getClipFromRegion(subCanvases[i]);
        // 第五个参数为该取景框在场景坐标系里的原始 region（可选，仅用于构图记录）
        await exportSingleClip(type, clip, i, options, subCanvases[i]);
      }
      return;
    }

    const fullClip = {
      x: 0,
      y: 0,
      w: drawingBoard.offsetWidth,
      h: drawingBoard.offsetHeight
    };

    await exportSingleClip(type, fullClip, null, options, null);
  }

  async function exportSingleClip(type, clip, index = null, options = {}, region = null) {
    const { c, ctx, scale } = createExportCanvas(clip);

    const finish = (filename, previewText) => {
      const url = c.toDataURL('image/png');
      const suffix = index !== null ? `_${index + 1}` : '';
      const label = `${(options.previewText || previewText)}${suffix}`;

      if (options.download !== false) {
        download(url, `${filename}${suffix}_${Date.now()}.png`);
      }
      if (options.emitToBuffer) {
        let composition = null;
        try {
          composition = buildCompositionRecord(clip, type, index, region);
        } catch (err) {
          // 构图记录是附加能力，失败不应影响导出本身
          console.warn('Failed to build composition record; skipped.', err);
        }
        emitExportToBuffer(url, label, clip, type, index, composition);
      }
    };

    if (type === 'origin') {
      ctx.clearRect(0, 0, clip.w, clip.h);
      const sortedItems = getSortedItems();

      await drawExportItemsInOrder(ctx, sortedItems, clip, scale, {
        includeMask: false
      });

      if (options.includeLabels !== false) {
        drawLabelsToCanvas(ctx, sortedItems.filter(it => it.kind !== 'mask'), clip);
      }

      finish('source', 'Source');
      return;
    }

    if (type === 'combined') {
      ctx.clearRect(0, 0, clip.w, clip.h);
      const sortedItems = getSortedItems();

      await drawExportItemsInOrder(ctx, sortedItems, clip, scale, {
        includeMask: options.includeMask !== false
      });

      if (options.includeLabels !== false) {
        drawLabelsToCanvas(ctx, sortedItems, clip);
      }

      finish('composite', 'Composite');
      return;
    }

    if (type === 'mask') {
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, clip.w, clip.h);
      const sortedItems = getSortedItems();
      await drawExportItemsInOrder(ctx, sortedItems, clip, scale, {
        onlyMask: true
      });
      finish('mask', 'Mask');
      return;
    }

  }

  // ---------------------------------------------------------------------
  // 构图记录（纯附加）
  //
  // 导出取景框时，除了那张拍平的 PNG，额外记录：这个取景框在场景里的位置、
  // 框内有哪些部件、各自在哪、第几层、来自哪个实体文件。
  // 有了它，两个关键帧共享了哪些部件（也就是它们的交集）可以被直接算出来。
  //
  // 所有输出都是新增字段，既有消费方按 key 取值，不受影响。
  // ---------------------------------------------------------------------

  // 屏幕坐标的 clip 反算回场景坐标
  function clipToSceneRect(clip) {
    const scale = camera.scale || 1;
    return {
      x: (clip.x - camera.x) / scale,
      y: (clip.y - camera.y) / scale,
      w: clip.w / scale,
      h: clip.h / scale
    };
  }

  // 部件在场景坐标下的矩形（与 drawExportItem 使用同一套取值方式）
  function getItemSceneRect(item) {
    const pos = getImagePosition(item.element);
    const { w, h } = getItemSize(item);
    return { x: pos.x, y: pos.y, w, h };
  }

  function rectIntersectArea(a, b) {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.w, b.x + b.w);
    const bottom = Math.min(a.y + a.h, b.y + b.h);
    if (right <= left || bottom <= top) return 0;
    return (right - left) * (bottom - top);
  }

  // 从素材 URL 里取出实体文件名，例如
  //   /view?filename=dog_merged_0347c5.png&subfolder=entities  -> dog_merged_0347c5.png
  //   entities/dog_merged_0347c5.png                           -> dog_merged_0347c5.png
  function extractEntityRef(src) {
    if (!src || typeof src !== 'string') return null;
    const byQuery = src.match(/[?&]filename=([^&]+)/);
    if (byQuery) {
      try { return decodeURIComponent(byQuery[1]); } catch (_) { return byQuery[1]; }
    }
    const parts = src.split('?')[0].split('/');
    const last = parts[parts.length - 1];
    return last || null;
  }

  // 生成一个取景框的构图记录
  function buildCompositionRecord(clip, type, index, region) {
    const viewport = region
      ? { x: region.x, y: region.y, w: region.w, h: region.h }
      : clipToSceneRect(clip);

    const items = getSortedItems().map(item => {
      const rect = getItemSceneRect(item);
      const area = rect.w * rect.h;
      const inside = rectIntersectArea(rect, viewport);

      return {
        itemId: item.id,
        kind: item.kind,
        label: item.label || '',
        entityRef: item.kind === 'mask' ? null : extractEntityRef(item.originalSrc),
        sourceUrl: item.kind === 'mask' ? null : (item.originalSrc || null),
        zIndex: item.zIndex,
        flipX: !!item.flipX,
        flipY: !!item.flipY,
        sceneRect: rect,
        // 相对取景框的归一化坐标，便于跨分辨率比较
        rectInViewport: viewport.w > 0 && viewport.h > 0
          ? {
              x: (rect.x - viewport.x) / viewport.w,
              y: (rect.y - viewport.y) / viewport.h,
              w: rect.w / viewport.w,
              h: rect.h / viewport.h
            }
          : null,
        visible: inside > 0,
        coverage: area > 0 ? inside / area : 0
      };
    });

    const visibleItems = items.filter(it => it.visible);

    return {
      schemaVersion: 1,
      sceneSessionId,
      viewportIndex: index,
      exportType: type,
      // 取景框在场景坐标系里的位置。同一 sceneSessionId 下的多个取景框
      // 可以直接做矩形相交，得到关键帧之间的重叠区域。
      viewportSceneRect: viewport,
      cameraAtExport: { x: camera.x, y: camera.y, scale: camera.scale },
      boardSize: { w: drawingBoard.offsetWidth, h: drawingBoard.offsetHeight },
      itemCount: items.length,
      visibleItemCount: visibleItems.length,
      visibleItemIds: visibleItems.map(it => it.itemId),
      visibleEntityRefs: visibleItems.map(it => it.entityRef).filter(Boolean),
      items
    };
  }

  function emitExportToBuffer(url, previewText, clip, type, index = null, composition = null) {
    const suffix = index !== null ? `_${index + 1}` : '';
    const ts = Date.now();

    const exportW = Math.max(1, Math.round(clip.w));
    const exportH = Math.max(1, Math.round(clip.h));

    const bufferClip = {
      nodeId: `canvas-export-${type}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'image',
      thumbnailUrl: url,
      mediaUrl: url,
      filename: `${previewText}${suffix}`,
      name: `${previewText}${suffix}`,
      width: exportW,
      height: exportH,
      aspectRatio: exportW / exportH,
      source: 'canvas-export',
      mediaType: 'image',
      exportType: type,
      createdAt: ts
    };

    // 新增字段：不影响既有消费方
    if (composition) {
      bufferClip.composition = composition;
      bufferClip.sceneSessionId = composition.sceneSessionId;
      bufferClip.viewportIndex = composition.viewportIndex;
      bufferClip.viewportSceneRect = composition.viewportSceneRect;
    }

    window.dispatchEvent(
      new CustomEvent('canvas-export-to-buffer', {
        detail: { clips: [bufferClip] }
      })
    );

    // 独立事件：任何想记录构图的地方都可以监听，不必改动 buffer 链路。
    // 目前没有监听者时为空操作。
    if (composition) {
      window.dispatchEvent(
        new CustomEvent('canvas-composition-record', {
          detail: {
            bufferNodeId: bufferClip.nodeId,
            imageUrl: url,
            composition
          }
        })
      );
    }
  }

  function download(url, name) {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function extractDragData(e) {
    const dt = e.dataTransfer;
    if (!dt) return lastDragData;

    const rawJson = dt.getData('application/json');
    const rawPlain = dt.getData('text/plain');
    const rawUri = dt.getData('text/uri-list');

    const raw = rawJson || rawPlain || rawUri;

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const resolvedUrl = resolveDroppedImageUrl(parsed);

        if (parsed && resolvedUrl) {
          return {
            ...parsed,
            url: resolvedUrl
          };
        }
      } catch (_) {
        const resolvedUrl = normalizeImageUrl(raw.trim());
        if (resolvedUrl) {
          return { url: resolvedUrl };
        }
      }
    }

    return lastDragData;
  }

  function initMaskCanvas() {
    computeMaskSceneSize();

    maskCanvas = document.createElement('canvas');
    maskCanvas.id = 'mask-canvas';
    maskCanvas.style.cssText = `
      position:absolute;
      inset:0;
      z-index:40;
      pointer-events:none;
    `;
    drawingBoard.appendChild(maskCanvas);

    maskSceneCanvas = document.createElement('canvas');
    maskSceneCanvas.width = MASK_SCENE_SIZE;
    maskSceneCanvas.height = MASK_SCENE_SIZE;

    maskSceneCtx = maskSceneCanvas.getContext('2d', { willReadFrequently: true });
    maskSceneCtx.imageSmoothingEnabled = true;
    maskSceneCtx.imageSmoothingQuality = 'high';

    resizeMaskCanvas();
    window.addEventListener('resize', resizeMaskCanvas);
  }

  function resizeMaskCanvas() {
    const prevScene = document.createElement('canvas');
    if (maskSceneCanvas) {
      prevScene.width = maskSceneCanvas.width;
      prevScene.height = maskSceneCanvas.height;
      const prevCtx = prevScene.getContext('2d');
      prevCtx.drawImage(maskSceneCanvas, 0, 0);
    }

    computeMaskSceneSize();

    if (!maskSceneCanvas) {
      maskSceneCanvas = document.createElement('canvas');
    }

    const oldSize = maskSceneCanvas.width || 0;
    const oldOrigin = oldSize / 2;

    maskSceneCanvas.width = MASK_SCENE_SIZE;
    maskSceneCanvas.height = MASK_SCENE_SIZE;

    maskSceneCtx = maskSceneCanvas.getContext('2d', { willReadFrequently: true });
    maskSceneCtx.imageSmoothingEnabled = true;
    maskSceneCtx.imageSmoothingQuality = 'high';

    if (prevScene.width && prevScene.height) {
      // 旧内容平移到新 origin
      const dx = MASK_SCENE_ORIGIN - oldOrigin;
      const dy = MASK_SCENE_ORIGIN - oldOrigin;
      maskSceneCtx.drawImage(prevScene, dx, dy);
    }

    const r = getBoardRect();

    maskCanvas.width = Math.max(1, Math.round(r.width * MASK_DPR));
    maskCanvas.height = Math.max(1, Math.round(r.height * MASK_DPR));
    maskCanvas.style.width = `${r.width}px`;
    maskCanvas.style.height = `${r.height}px`;

    maskCtx = maskCanvas.getContext('2d');
    maskCtx.setTransform(MASK_DPR, 0, 0, MASK_DPR, 0, 0);
    maskCtx.imageSmoothingEnabled = true;
    maskCtx.imageSmoothingQuality = 'high';

    applyBoardCamera();
  }

  function setToolbarButtonActive(btn, active) {
    if (!btn) return;
    btn.classList.toggle('is-active', !!active);
  }

  function syncToolbarState() {
    const selectBtn = document.getElementById('tool-select-btn');
    const regionBtn = document.getElementById('tool-region-btn');
    const paintBtn = document.getElementById('tool-paint-btn');

    setToolbarButtonActive(selectBtn, !drawSubCanvasMode && !paintMode);
    setToolbarButtonActive(regionBtn, drawSubCanvasMode);
    setToolbarButtonActive(paintBtn, paintMode);

    syncBrushSizeControls();
  }

  function deactivatePaintMode() {
    paintMode = false;
    if (maskCanvas) maskCanvas.style.pointerEvents = 'none';
    drawingBoard.style.cursor = 'default';

    destroyActiveColorPicker();

    droppedImages.forEach(i => {
      if (i.element) i.element.style.pointerEvents = 'auto';
    });
  }

  function deactivateRegionMode() {
    drawSubCanvasMode = false;
    drawingBoard.style.cursor = 'default';

    if (tempDrawRect && tempDrawRect.parentNode) {
      tempDrawRect.parentNode.removeChild(tempDrawRect);
    }
    tempDrawRect = null;
  }

  function bindToolbarControls() {
    const selectBtn = document.getElementById('tool-select-btn');
    const regionBtn = document.getElementById('tool-region-btn');
    const paintBtn = document.getElementById('tool-paint-btn');
    const paintDecreaseBtn = document.getElementById('tool-paint-decrease-btn');
    const paintIncreaseBtn = document.getElementById('tool-paint-increase-btn');
    const paintSizeIndicator = document.getElementById('tool-paint-size-indicator');
    const labelBtn = document.getElementById('tool-label-btn');

    const collectBufferBtn = document.getElementById('collect-buffer-btn');
    const exportSourceBtn = document.getElementById('export-source-btn');
    const exportMaskBtn = document.getElementById('export-mask-btn');
    const exportCompositeBtn = document.getElementById('export-composite-btn');

    if (selectBtn) {
      selectBtn.title = '选择：在画布空白处拖拽可框选并组合素材。按住 Ctrl/Command 或空格键（也可用鼠标中键）可平移。';
      selectBtn.onclick = () => {
        deactivateRegionMode();
        deactivatePaintMode();
        updateBoardCursor();
        syncToolbarState();
      };
    }

    if (regionBtn) {
      regionBtn.onclick = () => {
        if (paintMode) deactivatePaintMode();
        drawSubCanvasMode = !drawSubCanvasMode;
        drawingBoard.style.cursor = drawSubCanvasMode ? 'crosshair' : 'default';
        syncToolbarState();
      };

      regionBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openToolbarColorPicker('region', regionBtn);
      });
    }

    if (paintBtn) {
      paintBtn.onclick = () => {
        if (drawSubCanvasMode) deactivateRegionMode();

        paintMode = !paintMode;
        if (paintMode) {
          maskCanvas.style.pointerEvents = 'auto';
          drawingBoard.style.cursor = 'crosshair';
          droppedImages.forEach(i => { i.element.style.pointerEvents = 'none'; });
        } else {
          deactivatePaintMode();
        }

        syncToolbarState();
      };

      paintBtn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openToolbarColorPicker('paint', paintBtn);
      });
    }

    if (paintDecreaseBtn) {
      paintDecreaseBtn.onclick = () => {
        adjustBrushSize(-BRUSH_SIZE_STEP);
      };
    }

    if (paintIncreaseBtn) {
      paintIncreaseBtn.onclick = () => {
        adjustBrushSize(BRUSH_SIZE_STEP);
      };
    }

    if (paintSizeIndicator) {
      paintSizeIndicator.addEventListener('wheel', (e) => {
        e.preventDefault();
        adjustBrushSize(e.deltaY > 0 ? -BRUSH_SIZE_STEP : BRUSH_SIZE_STEP);
      }, { passive: false });
    }

    if (labelBtn) {
      labelBtn.onclick = () => {
        if (!currentSelectedItem) return;
        const text = prompt('输入图像标签', currentSelectedItem.label || '');
        if (text !== null) {
          setItemLabel(currentSelectedItem, text);
        }
      };
    }

    if (collectBufferBtn) {
      collectBufferBtn.onclick = () => exportCanvasToImage('combined', {
        download: false,
        emitToBuffer: true,
        previewText: 'Canvas',
        includeLabels: false
      });
    }

    if (exportSourceBtn) {
      exportSourceBtn.onclick = () => exportCanvasToImage('origin', {
        download: true,
        emitToBuffer: false
      });
    }

    if (exportMaskBtn) {
      exportMaskBtn.onclick = () => exportCanvasToImage('mask', {
        download: true,
        emitToBuffer: false
      });
    }

    if (exportCompositeBtn) {
      exportCompositeBtn.onclick = () => exportCanvasToImage('combined', {
        download: true,
        emitToBuffer: false,
        includeMask: false
      });
    }

    syncToolbarState();
    syncBrushSizeControls();
  }

  function bindClearButton() {
    const btn = document.getElementById('clear-canvas-btn');
    if (!btn) return;

    activePaintStroke = null;

    btn.onclick = () => {
      destroyActiveColorPicker();
      hideRegionOverlapFeedback();
      hideRegionAlignmentGuides();
      clearMaskRegionDragState(regionDragMaskState);
      regionDragMaskState = null;
      regionDragAttachedImages = [];
      droppedImages.forEach(item => {
        clearDeleteTimers(item);
        if (item.deleteBtn) item.deleteBtn.remove();
        if (item.element) item.element.remove();
        if (item.labelEl) item.labelEl.remove();
      });

      droppedImages = [];
      highlightedItemIds.clear();
      srCache.clear();
      layerSeed = 0;
      clearSelection();
      hideLayerMenu();

      if (maskCtx && maskCanvas) {
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      }
      if (maskSceneCtx && maskSceneCanvas) {
        maskSceneCtx.clearRect(0, 0, maskSceneCanvas.width, maskSceneCanvas.height);
      }

      subCanvases.forEach(region => {
        clearDeleteTimers(region);
        if (region.deleteBtn) region.deleteBtn.remove();
        if (region.element && region.element.parentNode) {
          region.element.parentNode.removeChild(region.element);
        }
      });

      subCanvases = [];
      activeRegionId = null;

      if (tempDrawRect && tempDrawRect.parentNode) {
        tempDrawRect.parentNode.removeChild(tempDrawRect);
      }

      tempDrawRect = null;
      deactivateRegionMode();
      deactivatePaintMode();
      syncToolbarState();
      syncBoardContentState();

      resetBoardDragState();
    };
  }

  function createImageItem(img, data, x, y) {
    img.style.cssText = `
      position:absolute;
      left:0;
      top:0;
      width:100px;
      height:auto;
      display:block;
      border:0.5px solid rgba(100,116,139,0.32);
      border-radius:4px;
      cursor:grab;
      z-index:10;
      user-select:none;
      will-change:transform;
      transform:translate3d(0,0,0);
      background: transparent;
    `;
    img.style.backgroundColor = 'transparent';
    img.style.objectFit = 'contain';
    img.style.boxSizing = 'border-box';

    img.dataset.scale = '1';
    img.dataset.x = '0';
    img.dataset.y = '0';
    img.draggable = false;

    drawingScene.appendChild(img);

    const item = {
      kind: 'image',
      id: `canvas_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      element: img,
      originalSrc: resolveDroppedImageUrl(data),
      zIndex: ++layerSeed,
      label: '',
      labelEl: null,
      deleteBtn: null,
      deleteHovering: false,
      showDeleteTimer: null,
      hideDeleteTimer: null,
      flipX: false,
      flipY: false
    };

    droppedImages.push(item);
    applyItemVisualLayer(item);
    ensureHitCanvas(item);
    syncBoardContentState();

    const pos = clampImagePosition(img, x, y);
    setImagePosition(img, pos.x, pos.y);

    bindSceneItemInteractions(item);
    selectItem(item);
  }

  function createMaskItem(sourceCanvas, x, y) {
    const canvas = document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;

    const cctx = canvas.getContext('2d');
    cctx.drawImage(sourceCanvas, 0, 0);

    canvas.style.cssText = `
      position:absolute;
      left:0;
      top:0;
      width:${sourceCanvas.width}px;
      height:${sourceCanvas.height}px;
      display:block;
      border:none;
      border-radius:4px;
      cursor:grab;
      z-index:10;
      user-select:none;
      will-change:transform;
      background:transparent;
      pointer-events:auto;
    `;

    canvas.dataset.x = '0';
    canvas.dataset.y = '0';

    drawingScene.appendChild(canvas);

    const item = {
      kind: 'mask',
      id: `mask_item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      element: canvas,
      sourceCanvas: canvas,
      zIndex: ++layerSeed,
      label: '',
      labelEl: null,
      deleteBtn: null,
      deleteHovering: false,
      showDeleteTimer: null,
      hideDeleteTimer: null,
      flipX: false,
      flipY: false
    };

    droppedImages.push(item);
    applyItemVisualLayer(item);
    ensureHitCanvas(item);
    setSceneItemPosition(item, x, y);
    bindSceneItemInteractions(item);
    normalizeLayerOrder();
    selectItem(item);
    syncBoardContentState();

    return item;
  }

  function bindEvents() {
    drawingBoard.addEventListener('contextmenu', e => {
      e.preventDefault();
    });

  drawingBoard.addEventListener('dragenter', e => {
    e.preventDefault();
    boardDragDepth += 1;
    setBoardDragVisual(true);
  });

  drawingBoard.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    setBoardDragVisual(true);
  });

  drawingBoard.addEventListener('dragleave', e => {
    e.preventDefault();

    boardDragDepth = Math.max(0, boardDragDepth - 1);

    // 只有真正离开 board 才重置
    const related = e.relatedTarget;
    if (!drawingBoard.contains(related) && boardDragDepth === 0) {
      resetBoardDragState();
    }
  });

  drawingBoard.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    resetBoardDragState();

    const data = extractDragData(e);
    if (!data || !data.url) {
      console.warn('Drop did not yield a usable image URL.', e.dataTransfer?.types);
      return;
    }

    const scenePoint = screenToScene(e.clientX, e.clientY);
    const x = scenePoint.x - 50;
    const y = scenePoint.y - 50;

    const resolvedUrl = resolveDroppedImageUrl(data);
    if (!resolvedUrl) {
      console.error('No usable image URL:', data);
      return;
    }

    const img = new Image();
    img.onload = () => {
      createImageItem(img, { ...data, url: resolvedUrl }, x, y);
      applyBoardCamera();
    };
    img.onerror = () => {
      console.error('Image failed to load:', resolvedUrl);
    };
    img.src = resolvedUrl;
  });

    drawingBoard.addEventListener('mousedown', e => {
      if (!drawSubCanvasMode) return;

      const isEmptyTarget =
        e.target === drawingBoard ||
        e.target === drawingScene;

      if (!isEmptyTarget) return;

      e.preventDefault();

      subCanvasStart = screenToScene(e.clientX, e.clientY);

      tempDrawRect = document.createElement('div');
      tempDrawRect.style.cssText = `
        position:absolute;
        left:${subCanvasStart.x}px;
        top:${subCanvasStart.y}px;
        width:0;
        height:0;
        pointer-events:none;
        z-index:999;
      `;
      applyRegionStyle(tempDrawRect, { temp: true });
      drawingScene.appendChild(tempDrawRect);
    });

    drawingBoard.addEventListener('mousemove', e => {
      if (!tempDrawRect) return;

      const scenePoint = screenToScene(e.clientX, e.clientY);
      // 按住 Alt 临时关闭比例吸附，允许自由画
      const rect = e.altKey
        ? (() => {
            const w = Math.abs(scenePoint.x - subCanvasStart.x);
            const h = Math.abs(scenePoint.y - subCanvasStart.y);
            return {
              l: Math.min(subCanvasStart.x, scenePoint.x),
              t: Math.min(subCanvasStart.y, scenePoint.y),
              w,
              h,
              snapped: false,
              label: h > 0 ? `${(w / h).toFixed(2)}:1` : ''
            };
          })()
        : snapRectToAspect(subCanvasStart.x, subCanvasStart.y, scenePoint.x, scenePoint.y);

      tempDrawRect.style.left = `${rect.l}px`;
      tempDrawRect.style.top = `${rect.t}px`;
      tempDrawRect.style.width = `${rect.w}px`;
      tempDrawRect.style.height = `${rect.h}px`;

      updateAspectFeedback(rect);
      updateRegionOverlapFeedback({ x: rect.l, y: rect.t, w: rect.w, h: rect.h });
      lastRegionDrawRect = rect;
    });

    drawingBoard.addEventListener('mouseup', e => {
      if (!tempDrawRect) return;

      const scenePoint = screenToScene(e.clientX, e.clientY);
      const rect = e.altKey
        ? (() => {
            const w = Math.abs(scenePoint.x - subCanvasStart.x);
            const h = Math.abs(scenePoint.y - subCanvasStart.y);
            return {
              l: Math.min(subCanvasStart.x, scenePoint.x),
              t: Math.min(subCanvasStart.y, scenePoint.y),
              w,
              h
            };
          })()
        : snapRectToAspect(subCanvasStart.x, subCanvasStart.y, scenePoint.x, scenePoint.y);

      hideAspectFeedback();
      hideRegionOverlapFeedback();
      lastRegionDrawRect = null;

      if (rect.w < 50 || rect.h < 50) {
        drawingScene.removeChild(tempDrawRect);
        tempDrawRect = null;
        return;
      }

      createRegionBox(rect.l, rect.t, rect.w, rect.h);
      drawingScene.removeChild(tempDrawRect);
      tempDrawRect = null;
      reportRegionAspectMismatch();

      // 单次画框完成后回到 Select；触发真实按钮点击以同步 Vue 高亮和画布内部状态。
      document.getElementById('tool-select-btn')?.click();
    });

    document.addEventListener('mousemove', e => {
      if (paintMode) return;

      if (!draggingImg && dragCandidate) {
        const dx0 = e.clientX - dragCandidate.startMouse.x;
        const dy0 = e.clientY - dragCandidate.startMouse.y;
        const moved = Math.hypot(dx0, dy0);

        if (moved >= DRAG_THRESHOLD) {
          draggingImg = dragCandidate.img;
          dragStartMouse = { ...dragCandidate.startMouse };
          dragStartPos = { ...dragCandidate.startPos };

          // 若被拖的素材属于某个编组，记下同组其它成员的起始位置，一起移动
          const draggedItem = getItemByElement(draggingImg);
          const group = getGroupOfItem(draggedItem);
          dragGroupRef = group || null;
          dragGroupSiblings = group
            ? getGroupMembers(group)
                .filter(it => it !== draggedItem)
                .map(it => ({ item: it, startPos: getImagePosition(it.element) }))
            : null;

          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';

          draggingImg.style.pointerEvents = 'none';
          draggingImg.style.cursor = 'grabbing';
        }
      }

      if (!draggingRegion && regionDragCandidate) {
        const dx0 = e.clientX - regionDragCandidate.startMouse.x;
        const dy0 = e.clientY - regionDragCandidate.startMouse.y;
        const moved = Math.hypot(dx0, dy0);

        if (moved >= DRAG_THRESHOLD) {
          draggingRegion = regionDragCandidate.item;
          regionDragStartMouse = { ...regionDragCandidate.startMouse };
          regionDragStartPos = { ...regionDragCandidate.startPos };

          regionDragAttachedImages = collectImagesInsideRegion(draggingRegion);
          regionDragMaskState = captureMaskRegionForDrag(draggingRegion);

          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';

          if (draggingRegion.gripEl) {
            draggingRegion.gripEl.style.cursor = 'grabbing';
          }
        }
      }

      if (!draggingImg && !draggingRegion && boardPanCandidate && !boardPanActive) {
        const dx0 = e.clientX - boardPanCandidate.startMouse.x;
        const dy0 = e.clientY - boardPanCandidate.startMouse.y;
        const moved = Math.hypot(dx0, dy0);

        if (moved >= DRAG_THRESHOLD) {
          boardPanActive = true;
          boardPanMoved = true;
          drawingBoard.classList.add('is-panning');
          document.body.style.userSelect = 'none';
          document.body.style.webkitUserSelect = 'none';
        }
      }

      if (boardPanActive && boardPanCandidate) {
        camera.x = boardPanCandidate.startCamera.x + (e.clientX - boardPanCandidate.startMouse.x);
        camera.y = boardPanCandidate.startCamera.y + (e.clientY - boardPanCandidate.startMouse.y);
        applyBoardCamera();
      }

      if (draggingRegion) {
        const pointerDx = (e.clientX - regionDragStartMouse.x) / camera.scale;
        const pointerDy = (e.clientY - regionDragStartMouse.y) / camera.scale;
        const aligned = alignDraggedRegion(
          draggingRegion,
          regionDragStartPos.x + pointerDx,
          regionDragStartPos.y + pointerDy
        );
        const dx = aligned.x - regionDragStartPos.x;
        const dy = aligned.y - regionDragStartPos.y;

        setRegionPosition(
          draggingRegion,
          aligned.x,
          aligned.y
        );

        regionDragAttachedImages.forEach(({ item, startPos }) => {
          setImagePosition(
            item.element,
            startPos.x + dx,
            startPos.y + dy
          );
        });

        if (regionDragMaskState) {
          updateMaskRegionPreview(regionDragMaskState, draggingRegion);
        }

        updateRegionOverlapFeedback(draggingRegion);

        return;
      }

      if (!draggingImg) return;

      const dx = (e.clientX - dragStartMouse.x) / camera.scale;
      const dy = (e.clientY - dragStartMouse.y) / camera.scale;

      const next = clampImagePosition(
        draggingImg,
        dragStartPos.x + dx,
        dragStartPos.y + dy
      );

      pendingDragPos = next;

      if (dragRAF) return;

      dragRAF = requestAnimationFrame(() => {
        if (draggingImg && pendingDragPos) {
          setImagePosition(draggingImg, pendingDragPos.x, pendingDragPos.y);

          // 同组成员按相同位移跟随，保持它们之间的相对位置
          if (dragGroupSiblings) {
            dragGroupSiblings.forEach(({ item, startPos }) => {
              setImagePosition(item.element, startPos.x + dx, startPos.y + dy);
            });
            // 外框按同一位移平移即可，不必重新测量，避免拖动中的抖动与拖影
            if (dragGroupRef) applyGroupTransform(dragGroupRef, dx, dy);
          }
        }
        dragRAF = null;
      });
    });

    document.addEventListener('mouseup', () => {
      if (dragRAF) {
        cancelAnimationFrame(dragRAF);
        dragRAF = null;
      }

      if (draggingImg) {
        draggingImg.style.pointerEvents = 'auto';
        draggingImg.style.cursor = 'grab';
      }

      // 拖动过程中外框只是临时平移，结束后按成员实际位置重新测量一次
      if (dragGroupRef) {
        refreshGroupVisual(dragGroupRef);
        setGroupSelected(dragGroupRef, dragGroupRef === selectedGroup);
        dragGroupRef = null;
      }
      dragGroupSiblings = null;

      if (draggingRegion?.gripEl) {
        draggingRegion.gripEl.style.cursor = 'grab';
      }

      if (draggingRegion && regionDragMaskState) {
        commitMaskRegionDrag(regionDragMaskState, draggingRegion);
      }

      clearMaskRegionDragState(regionDragMaskState);
      hideRegionOverlapFeedback();
      hideRegionAlignmentGuides();

      drawingBoard.classList.remove('is-panning');
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';

      draggingImg = null;
      dragCandidate = null;
      pendingDragPos = null;

      draggingRegion = null;
      regionDragCandidate = null;
      regionDragAttachedImages = [];
      regionDragMaskState = null;

      boardPanCandidate = null;
      boardPanActive = false;
      isPainting = false;
    });

  maskCanvas.addEventListener('mousedown', e => {
    if (!paintMode) return;

    isPainting = true;

    const scenePoint = clientToScenePoint(e.clientX, e.clientY);
    const boardPoint = getBoardPoint(e.clientX, e.clientY);

    beginPaintStroke(scenePoint, boardPoint);

    paintLastScenePoint = scenePoint;
    paintLastBoardPoint = boardPoint;
  });

  maskCanvas.addEventListener('mousemove', e => {
    if (!isPainting || !activePaintStroke) return;

    const scenePoint = clientToScenePoint(e.clientX, e.clientY);
    const boardPoint = getBoardPoint(e.clientX, e.clientY);

    if (!paintLastScenePoint || !paintLastBoardPoint) {
      paintStrokeDot(activePaintStroke, scenePoint, boardPoint);
    } else {
      paintStrokeSegment(
        activePaintStroke,
        paintLastScenePoint,
        scenePoint,
        paintLastBoardPoint,
        boardPoint
      );
    }

    paintLastScenePoint = scenePoint;
    paintLastBoardPoint = boardPoint;
  });

  maskCanvas.addEventListener('mouseup', () => {
    if (isPainting) {
      commitPaintStrokeToItem();
    }
    isPainting = false;
    paintLastScenePoint = null;
    paintLastBoardPoint = null;
  });

  maskCanvas.addEventListener('mouseleave', () => {
    if (isPainting) {
      commitPaintStrokeToItem();
    }
    isPainting = false;
    paintLastScenePoint = null;
    paintLastBoardPoint = null;
  });

    drawingBoard.addEventListener('mousedown', e => {
      const isEmptyTarget =
        e.target === drawingBoard ||
        e.target === drawingScene ||
        e.target === maskCanvas;

      if (!isEmptyTarget) return;
      handleEmptyAreaMouseDown(e);
    });

    // --- 编组框选的拖拽流程（附加） ---

    document.addEventListener('mousemove', e => {
      if (!groupMarqueeEl || !groupMarqueeStart) return;
      const p = screenToScene(e.clientX, e.clientY);
      const l = Math.min(groupMarqueeStart.x, p.x);
      const t = Math.min(groupMarqueeStart.y, p.y);
      const w = Math.abs(p.x - groupMarqueeStart.x);
      const h = Math.abs(p.y - groupMarqueeStart.y);

      groupMarqueeEl.style.left = `${l}px`;
      groupMarqueeEl.style.top = `${t}px`;
      groupMarqueeEl.style.width = `${w}px`;
      groupMarqueeEl.style.height = `${h}px`;
    });

    document.addEventListener('mouseup', e => {
      if (!groupMarqueeEl || !groupMarqueeStart) return;

      const p = screenToScene(e.clientX, e.clientY);
      const marquee = {
        x: Math.min(groupMarqueeStart.x, p.x),
        y: Math.min(groupMarqueeStart.y, p.y),
        w: Math.abs(p.x - groupMarqueeStart.x),
        h: Math.abs(p.y - groupMarqueeStart.y)
      };

      groupMarqueeEl.remove();
      groupMarqueeEl = null;
      groupMarqueeStart = null;

      if (marquee.w < 20 || marquee.h < 20) return;
      finishGroupMarquee(marquee);
    });

    drawingBoard.addEventListener('wheel', e => {
      if (paintMode) return;
      if (e.target && e.target.tagName === 'IMG') return;

      e.preventDefault();
      zoomBoardAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.92 : 1.08);
    }, { passive: false });

    drawingBoard.addEventListener('click', e => {
      if (boardPanMoved) {
        boardPanMoved = false;
        return;
      }

      if (
        e.target === drawingBoard ||
        e.target === drawingScene ||
        e.target === maskCanvas
      ) {
        clearSelection();
        hideLayerMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key !== 'Delete' && e.key !== 'Backspace') return;

      if (currentSelectedItem) {
        removeImageItem(currentSelectedItem);
        return;
      }

      const activeRegion = subCanvases.find(it => it.id === activeRegionId);
      if (activeRegion) {
        removeRegionItem(activeRegion);
      }
    });

    document.addEventListener('dragend', () => {
      resetBoardDragState();
    }, true);

    document.addEventListener('drop', () => {
      resetBoardDragState();
    }, true);

    window.addEventListener('blur', () => {
      resetBoardDragState();
    });

  }

  function initTools() {
    bindToolbarControls();
    createLayerMenu();
    bindClearButton();
    bindSpacePanKeys();
  }

  initMaskCanvas();
  initTools();
  bindEvents();
  window.__canvasAPI = { highlightByLabels, clearHighlight };
  syncBoardContentState();
  refreshRegionStyles();
  updateToolbarColorIndicators();
  applyBoardCamera();
}

window.initCanvasDrag = initCanvasDrag;

