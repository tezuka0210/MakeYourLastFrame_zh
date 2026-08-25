<template>
  <div class="stitch-card">
    <div
      id="stitching-panel-wrapper"
      class="stitching-panel-wrapper flex-1 min-h-0"
      @wheel.prevent="handleZoom"
      @scroll="handleTimelineScroll"
    >
      <!-- Buffer strip -->
      <div id="buffer-strip" ref="bufferStripRef">
        <div
          v-for="(clip, index) in bufferClips"
          :key="`buffer-${clip.nodeId}-${index}`"
          :class="[
            'buffer-item',
            clip.type === 'image'
              ? 'buffer-item--image'
              : clip.type === 'video'
                ? 'buffer-item--video'
                : 'buffer-item--audio',
            {
              'insert-before': isInsertBefore(index),
              'insert-after': isInsertAfter(index)
            }
          ]"
          :style="getBufferItemStyle(clip)"
          :title="clip.filename || clip.name || clip.nodeId || '暂存素材'"
          draggable="true"
          @dragstart="handleDragStart('buffer', index, $event)"
          @dragover.prevent="onBufferDragOver(index, $event)"
          @dragleave="onBufferDragLeave"
          @drop.prevent.stop="onBufferDrop(index, $event)"
          @dragend="handleDragEnd"
        >
          <template v-if="clip.type === 'image'">
            <img :src="clip.thumbnailUrl" class="buffer-thumb" draggable="false" />
          </template>

          <template v-else-if="clip.type === 'video'">
            <video
              :src="clip.thumbnailUrl"
              class="buffer-thumb"
              autoplay
              loop
              muted
              playsinline
              preload="metadata"
              draggable="false"
            ></video>
          </template>

          <template v-else>
            <div class="buffer-audio-icon">♪</div>
          </template>

          <div class="buffer-meta">
            {{ getBufferMeta(clip) }}
          </div>

          <span
            class="remove-btn buffer-remove-btn"
            @mousedown.stop.prevent
            @click.stop="removeBuffer(index)"
          >
            ×
          </span>
        </div>

        <span
          v-if="bufferClips.length === 0"
          class="buffer-placeholder"
        >
          素材可以先收集到这里...
        </span>
      </div>

      <!-- Timeline -->
      <div
        id="timeline-ruler"
        @mousedown="handleTimelineMouseDown"
        @mousemove="handleTimelineMouseMove"
        @mouseup="handleTimelineMouseUp"
        @mouseleave="handleTimelineMouseUp"
      ></div>

      <!-- Video track -->
      <div
        id="stitching-panel"
        class="track-panel track-panel-video"
        :class="{ 'drag-over': isDraggingOverContainer === 'video' }"
        @dragover.prevent="handleDragOverContainer('video')"
        @dragleave="handleDragLeaveContainer"
        @drop="handleDropContainer('video')"
      >
        <div id="clips-container">
          <div
            v-for="(clip, index) in clips"
            :key="`${clip.nodeId}-${pixelsPerSecond}`"
            class="clip-item"
            :class="[
              clip.type === 'image' ? 'clip-item-image' : 'clip-item-video',
              { dragging: draggedClip?.track === 'video' && draggedClip?.index === index }
            ]"
            :style="{ width: videoClipWidths[index] }"
            draggable="true"
            @dragstart="handleDragStart('video', index, $event)"
            @dragover.prevent="handleDragOverItem('video', index)"
            @dragleave="handleDragLeaveItem"
            @drop.prevent.stop="handleDropOnItem('video', index)"
            @dragend="handleDragEnd"
          >
            <img
              v-if="clip.type === 'image'"
              :src="clip.thumbnailUrl"
              class="thumb"
              draggable="false"
            />
            <video
              v-else
              :src="clip.thumbnailUrl"
              class="thumb"
              autoplay
              loop
              muted
              playsinline
              preload="metadata"
              draggable="false"
            ></video>

            <div class="clip-meta">
              <div class="clip-meta-left">
                <span class="clip-name">{{ getClipName(clip) }}</span>
              </div>
              <span class="clip-duration">{{ formatClipDuration(clip.duration) }}</span>
            </div>

            <span class="remove-btn" @click.stop="removeVideo(index)">×</span>

            <!-- <div
              v-if="draggedOver?.track === 'video' && draggedOver?.index === index"
              class="absolute inset-0 bg-blue-500 opacity-50 border-2 border-blue-700 pointer-events-none"
              style="border-radius: 4px"
            ></div> -->
          </div>

          <span
            v-if="clips.length === 0"
            id="clips-placeholder"
            class="track-placeholder"
          >
            将视频/图像节点拖到这里...
          </span>
        </div>
      </div>

      <!-- Audio track -->
      <div
        id="audio-stitching-panel"
        class="track-panel track-panel-audio"
        :class="{ 'drag-over': isDraggingOverContainer === 'audio' }"
        @dragover.prevent="handleDragOverContainer('audio')"
        @dragleave="handleDragLeaveContainer"
        @drop="handleDropContainer('audio')"
      >
        <div id="audio-clips-container">
          <div
            v-for="(clip, index) in audioClips"
            :key="clip.nodeId"
            class="audio-clip-item"
            :class="{ dragging: draggedClip?.track === 'audio' && draggedClip?.index === index }"
            :style="{ width: audioClipWidths[index] }"
            draggable="true"
            @dragstart="handleDragStart('audio', index, $event)"
            @dragover.prevent="handleDragOverItem('audio', index)"
            @dragleave="handleDragLeaveItem"
            @drop.prevent.stop="handleDropOnItem('audio', index)"
            @dragend="handleDragEnd"
          >
            <div class="audio-thumb">
              <span class="audio-clip-name">
                {{ clip.nodeId.substring(0, 8) }}...
              </span>
              <span class="audio-clip-duration">{{ Number(clip.duration || 0).toFixed(1) }}s</span>
            </div>

            <span class="remove-btn" @click.stop="removeAudio(index)">×</span>

            <!-- <div
              v-if="draggedOver?.track === 'audio' && draggedOver?.index === index"
              class="absolute inset-0 bg-blue-500 opacity-50 border-2 border-blue-700 pointer-events-none"
              style="border-radius: 4px"
            ></div> -->
          </div>

          <span
            v-if="audioClips.length === 0"
            id="audio-clips-placeholder"
            class="track-placeholder"
          >
            将音频节点拖到这里...
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref, nextTick, type PropType, type CSSProperties } from 'vue'
import { useStitching } from '@/lib/useStitching.js'
import WaveSurfer from 'wavesurfer.js'

type WaveSurferInstance = ReturnType<typeof WaveSurfer.create>

interface TimelineClip {
  nodeId: string
  mediaPath?: string
  thumbnailUrl?: string
  mediaUrl?: string
  media_url?: string
  audioUrl?: string
  filename?: string
  name?: string
  type: 'image' | 'video' | 'audio'
  duration: number
  width?: number
  height?: number
  naturalWidth?: number
  naturalHeight?: number
  exportWidth?: number
  exportHeight?: number
  resolution?: string
  sampleRate?: number
}

const props = defineProps({
  clips:           { type: Array as PropType<TimelineClip[]>,  required: true },
  audioClips:      { type: Array as PropType<TimelineClip[]>,  required: true },
  bufferClips:     { type: Array as PropType<TimelineClip[]>, default: () => [] },
  isStitching:     { type: Boolean, default: false },
  stitchResultUrl: { type: [String, null] }
})

const emit = defineEmits([
  'update:clips',
  'update:audioClips',
  'update:bufferClips',
  'stitch',
  'remove-clip',
  'remove-audio-clip'
])

const {
  pixelsPerSecond,
  videoClipWidths,
  audioClipWidths,
  draggedClip,
  draggedOver,
  isDraggingOverContainer,
  handleZoom,
  handleDragStart,
  handleDragOverItem,
  handleDragLeaveItem,
  handleDropOnItem,
  handleDragEnd,
  handleDragOverContainer,
  handleDragLeaveContainer,
  handleDropContainer,
  drawTimeline,
  handleTimelineScroll,
  handleTimelineMouseDown,
  handleTimelineMouseMove,
  handleTimelineMouseUp
} = useStitching(props, emit)

function handleCanvasExportToBuffer(event: Event) {
  const detail = (event as CustomEvent)?.detail
  const incoming = Array.isArray(detail?.clips) ? detail.clips : []

  if (!incoming.length) return

  const next = [...(props.bufferClips as any[]), ...incoming]
  emit('update:bufferClips', next)
}

const bufferStripRef = ref<HTMLElement | null>(null)
const bufferCardHeight = ref(56)
let bufferResizeObserver: ResizeObserver | null = null

function updateBufferCardHeight() {
  const el = bufferStripRef.value
  if (!el) return

  const cs = getComputedStyle(el)
  const pt = parseFloat(cs.paddingTop || '0')
  const pb = parseFloat(cs.paddingBottom || '0')

  const innerH = el.clientHeight - pt - pb
  bufferCardHeight.value = Math.max(40, Math.round(innerH - 4))
}

function getBufferItemStyle(clip: any): CSSProperties {
  const h = bufferCardHeight.value

  if (clip.type === 'audio') {
    return {
      height: `${h}px`,
      width: `${Math.max(96, Math.round(h * 1.55))}px`,
      minWidth: `${Math.max(96, Math.round(h * 1.55))}px`,
      boxSizing: 'border-box',
      flex: '0 0 auto',
    }
  }

  const rawW = Number(clip.width || clip.naturalWidth || clip.exportWidth || 1)
  const rawH = Number(clip.height || clip.naturalHeight || clip.exportHeight || 1)
  const ratio = rawW > 0 && rawH > 0 ? rawW / rawH : 1
  const normalizedRatio = Math.min(3.2, Math.max(0.65, ratio))
  const w = Math.max(60, Math.min(260, Math.round(h * normalizedRatio)))

  return {
    height: `${h}px`,
    width: `${w}px`,
    minWidth: `${w}px`,
    boxSizing: 'border-box',
    flex: '0 0 auto',
  }
}

/* ========= buffer-strip 的插入辅助线状态 ========= */

const bufferInsert = ref<null | { index: number; position: 'before' | 'after' }>(null)

function onBufferDragOver(index: number, e: DragEvent) {
  const target = e.currentTarget as HTMLElement | null
  if (!target) return
  const rect = target.getBoundingClientRect()
  const offsetX = e.clientX - rect.left
  const position: 'before' | 'after' = offsetX < rect.width / 2 ? 'before' : 'after'

  bufferInsert.value = { index, position }
  handleDragOverItem('buffer', index)
}

function onBufferDragLeave() {
  bufferInsert.value = null
  handleDragLeaveItem()
}

function onBufferDrop(index: number, e: DragEvent) {
  let targetIndex = index
  if (
    bufferInsert.value &&
    bufferInsert.value.index === index &&
    bufferInsert.value.position === 'after'
  ) {
    targetIndex = index + 1
  }
  handleDropOnItem('buffer', targetIndex)
  bufferInsert.value = null
}

const isInsertBefore = (i: number) =>
  bufferInsert.value?.index === i && bufferInsert.value?.position === 'before'

const isInsertAfter = (i: number) =>
  bufferInsert.value?.index === i && bufferInsert.value?.position === 'after'

/* ========= buffer 中音频缩略图：WaveSurfer 波形 ========= */

const audioWaveformRefs = ref<HTMLElement[]>([])
const bufferWaveforms = ref<WaveSurferInstance[]>([])

function destroyBufferWaveforms() {
  bufferWaveforms.value.forEach(ws => {
    if (ws) {
      try { ws.destroy() } catch (e) { /* ignore */ }
    }
  })
  bufferWaveforms.value = []
}

watch(
  () => props.bufferClips,
  (newClips: any[]) => {
    destroyBufferWaveforms()
    nextTick(() => {
      newClips.forEach((clip, index) => {
        if (clip.type !== 'audio') return
        const el = audioWaveformRefs.value[index]
        if (!el) return

        const audioUrl: string | undefined = clip.mediaUrl || clip.media_url || clip.audioUrl
        if (!audioUrl) return

        const progressColor =
          getComputedStyle(document.documentElement)
            .getPropertyValue('--media-audio')
            .trim() || '#F4A7A8'

        const ws = WaveSurfer.create({
          container: el,
          waveColor: '#9ca3af',
          progressColor,
          height: 36,
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          url: audioUrl
        })

        bufferWaveforms.value[index] = ws
      })
    })
  },
  { immediate: true, deep: true }
)

onBeforeUnmount(() => {
  destroyBufferWaveforms()
  if (bufferResizeObserver) {
    bufferResizeObserver.disconnect()
    bufferResizeObserver = null
  }
  window.removeEventListener(
    'canvas-export-to-buffer',
    handleCanvasExportToBuffer as EventListener
  )
})

onMounted(() => {
  drawTimeline()
  nextTick(() => {
    updateBufferCardHeight()
    if (bufferStripRef.value && typeof ResizeObserver !== 'undefined') {
      bufferResizeObserver = new ResizeObserver(() => {
        updateBufferCardHeight()
      })
      bufferResizeObserver.observe(bufferStripRef.value)
    }
  })
  window.addEventListener(
    'canvas-export-to-buffer',
    handleCanvasExportToBuffer as EventListener
  )
})

watch(
  () => [pixelsPerSecond.value, props.clips, props.audioClips],
  () => {
    drawTimeline()
  },
  { deep: true }
)

watch(
  () => props.bufferClips,
  () => {
    nextTick(() => {
      updateBufferCardHeight()
    })
  },
  { deep: true }
)

watch(
  () => props.stitchResultUrl,
  (newUrl) => {
    if (!newUrl) return
    const a = document.createElement('a')
    a.href = newUrl
    a.download = ''
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
)

const removeVideo = (index: number) => emit('remove-clip', index)
const removeAudio = (index: number) => emit('remove-audio-clip', index)
const stitch = () => emit('stitch')

const removeBuffer = (index: number) => {
  const next = [...(props.bufferClips as any[])]
  next.splice(index, 1)
  emit('update:bufferClips', next)
}

const getClipName = (clip: any) => {
  return clip.filename || clip.name || clip.nodeId || 'Video'
}

const formatClipDuration = (duration: number) => {
  const v = Number(duration) || 0
  return v.toFixed(1) + 's'
}

const getBufferMeta = (clip: any): string => {
  if (clip.type === 'audio') {
    if (clip.duration != null) {
      const v = Number(clip.duration) || 0
      return `${v.toFixed(1)} s`
    }
    if (clip.sampleRate) {
      return `${clip.sampleRate} Hz`
    }
    return '音频'
  }

  if (clip.width && clip.height) {
    return `${clip.width}×${clip.height}`
  }
  if (clip.resolution) {
    return String(clip.resolution)
  }

  if (clip.duration != null) {
    const v = Number(clip.duration) || 0
    return `${v.toFixed(1)} s`
  }

  if (clip.type === 'image') return '图像'
  if (clip.type === 'video') return '视频'
  return '媒体'
}
</script>

<style scoped>
.stitch-card {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
  padding: 0;
  box-sizing: border-box;
}

#stitching-panel-wrapper {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: transparent;
  border: 1px dashed #c7ced8;
  border-radius: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

#buffer-strip {
  flex: 1 1 auto;
  min-height: 74px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px 8px 14px;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  overflow-y: auto;
  overflow-x: visible;
}

.buffer-placeholder {
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
  white-space: normal;
  line-height: 1.35;
}

.buffer-item {
  position: relative;
  align-self: center;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 4px;
  border: 1px solid #d6dde6;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}

.buffer-item--audio {
  justify-content: center;
  background: linear-gradient(180deg, #fff6f6 0%, #ffffff 100%);
}

.buffer-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
}

.buffer-audio-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--media-audio-bg, #F4A7A8) 18%, #ffffff);
  color: #b45309;
  font-size: 16px;
}

.buffer-meta {
  position: absolute;
  left: 6px;
  bottom: 5px;
  max-width: calc(100% - 28px);
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #6b7280;
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
}

.buffer-remove-btn {
  top: 4px;
  right: 4px;
}

.buffer-item.insert-before::before,
.buffer-item.insert-after::after {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: #94a3b8;
  border-radius: 999px;
}

.buffer-item.insert-before::before {
  left: -2px;
}

.buffer-item.insert-after::after {
  right: -2px;
}

#timeline-ruler {
  flex: 0 0 30px;
  height: 30px;
  min-height: 30px;
  max-height: 30px;
  box-sizing: border-box;
  background: #ffffff;
  border: 0;
  box-shadow: inset 0 1px 0 #d1d5db, inset 0 -1px 0 #d1d5db;
}

.track-panel,
#stitching-panel,
#audio-stitching-panel {
  flex-grow: 0;
  flex-shrink: 0;
  min-width: max-content;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  overflow: hidden;
  box-sizing: border-box;
}

#stitching-panel {
  flex-basis: 76px;
  height: 76px;
  min-height: 76px;
  max-height: 76px;
  padding: 6px 0;
  box-shadow: inset 0 1px 0 #d1d5db;
}

#audio-stitching-panel {
  flex-basis: 54px;
  height: 54px;
  min-height: 54px;
  max-height: 54px;
  padding: 6px 0;
  box-shadow: inset 0 1px 0 #d1d5db;
}

#clips-container,
#audio-clips-container {
  height: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  box-sizing: border-box;
  background: transparent;
}

.track-placeholder {
  display: flex;
  align-items: center;
  height: 100%;
  min-height: 0;
  font-size: 12px;
  color: #9ca3af;
  font-style: italic;
  white-space: normal;
  line-height: 1.35;
}

#clips-placeholder,
#audio-clips-placeholder {
  display: flex;
  align-items: center;
  height: 100%;
  min-height: 0;
}

.clip-item,
.audio-clip-item {
  position: relative;
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 8px;
  box-sizing: border-box;
}

.clip-item {
  padding: 4px;
  border: 1px solid #dbe2ea;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}

.clip-item-image,
.clip-item-video {
  justify-content: center;
}

.thumb {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  border-radius: 6px;
  background: #f8fafc;
}

.clip-meta {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  font-size: 10px;
  color: #475569;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
}

.clip-meta-left {
  min-width: 0;
}

.clip-name,
.clip-duration {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.audio-clip-item {
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--media-audio-bg, #F4A7A8);
  background: color-mix(in srgb, var(--media-audio-bg, #F4A7A8) 16%, #ffffff);
}

.audio-thumb {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-width: 0;
  font-size: 11px;
  color: #6b7280;
}

.audio-clip-name,
.audio-clip-duration {
  white-space: nowrap;
}

.audio-clip-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #64748b;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.clip-item.dragging,
.audio-clip-item.dragging,
.buffer-item.dragging {
  opacity: 0.55;
}

@media (max-height: 820px) {
  #buffer-strip {
    min-height: 66px;
    padding: 10px 12px 6px 12px;
  }

  #timeline-ruler {
    flex-basis: 26px;
    height: 26px;
    min-height: 26px;
    max-height: 26px;
  }

  #stitching-panel {
    flex-basis: 68px;
    height: 68px;
    min-height: 68px;
    max-height: 68px;
    padding: 4px 0;
  }

  #audio-stitching-panel {
    flex-basis: 48px;
    height: 48px;
    min-height: 48px;
    max-height: 48px;
    padding: 4px 0;
  }

  #clips-container,
  #audio-clips-container {
    padding: 0 12px;
    gap: 6px;
  }

  .buffer-placeholder,
  .track-placeholder {
    font-size: 11px;
  }
}
</style>
