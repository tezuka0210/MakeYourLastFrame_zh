<template>
  <div id="workflow-form" class="space-y-4">
    <!-- 父节点提示 -->
    <div v-if="props.selectedIds.length === 0">
      <label class="block text-sm font-medium text-gray-600 mb-1">父节点</label>
      <input
        type="text"
        value="未选择 (将创建根节点)"
        class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
        readonly
      >
    </div>

    <div v-else-if="props.selectedIds.length === 1">
      <label class="block text-sm font-medium text-gray-600 mb-1">父节点：</label>
      <input
        type="text"
        :value="`节点: ${parentNode1Id?.substring(0, 8)}...`"
        class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
        readonly
      >
    </div>

    <div v-else-if="props.selectedIds.length === 2" class="space-y-2">
      <p v-if="moduleId === 'ImageMerging'" class="text-xs font-medium text-green-600">已准备合并</p>
      <div>
        <label class="block text-sm font-medium text-gray-600 mb-1">父节点 1：</label>
        <input
          type="text"
          :value="`节点: ${parentNode1Id?.substring(0, 8)}...`"
          class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
          readonly
        >
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-600 mb-1">父节点 2：</label>
        <input
          type="text"
          :value="`节点: ${parentNode2Id?.substring(0, 8)}...`"
          class="w-full bg-gray-100 border border-gray-300 rounded-md p-2 text-gray-500 text-sm"
          readonly
        >
      </div>
    </div>

    <!-- 模块选择 -->
    <div>
      <label for="module-select" class="block text-sm font-medium text-gray-600 mb-1">选择模块</label>
      <select
        id="module-select"
        v-model="moduleId"
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      >
        <option
          v-for="module in availableModules"
          :key="module.id"
          :value="module.id"
        >
          {{ module.name }}
        </option>
      </select>
    </div>

    <!-- 动态参数 -->
    <div
      v-for="param in currentParameters"
      :key="param.id"
      class="parameter-item"
    >
      <label :for="param.id" class="block text-sm font-medium text-gray-600 mb-1">
        {{ param.label }}
      </label>

      <input
        v-if="param.type === 'number'"
        type="number"
        :id="param.id"
        v-model.number="parameterValues[param.id]"
        :step="param.step"
        :min="param.min"
        :max="param.max"
        :placeholder="param.placeholder"
        @keydown.enter.prevent
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      />

      <input
        v-else-if="param.type === 'text'"
        type="text"
        :id="param.id"
        v-model="parameterValues[param.id]"
        :placeholder="param.placeholder"
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      />

      <div v-else-if="param.type === 'textarea'" class="relative">
        <textarea
          :id="param.id"
          rows="4"
          v-model="parameterValues[param.id]"
          :placeholder="param.placeholder"
          class="w-full bg-white border border-gray-300 rounded-md p-2 pr-24"
        ></textarea>
        <button
          type="button"
          class="absolute top-2 right-14 h-7 min-w-7 rounded-full border border-gray-300 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50"
          title="导出语音测试数据"
          @click="exportSpeechTimingRecordsCsv"
        >
          CSV
        </button>
        <button
          type="button"
          class="absolute top-2 right-2 h-7 min-w-7 rounded-full border border-gray-300 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          :title="speechButtonTitle(param.id)"
          :disabled="!speechSupported || polishingParamId === param.id"
          @click="toggleSpeechInput(param.id)"
        >
          {{ speechButtonText(param.id) }}
        </button>
      </div>

      <select
        v-else-if="param.type === 'select'"
        :id="param.id"
        v-model="parameterValues[param.id]"
        class="w-full bg-white border border-gray-300 rounded-md p-2"
      >
        <option
          v-for="option in param.options"
          :key="option"
          :value="option"
        >
          {{ option }}
        </option>
      </select>
    </div>

    <!-- 图片上传 -->
    <div>
      <label for="image-upload" class="block text-sm font-medium text-gray-600 mb-1">图像输入（可选）</label>
      <input
        type="file"
        id="image-upload"
        ref="fileInputRef"
        :disabled="isGenerating"
        @change="onFileChange"
        accept="image/*"
        class="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-100 file:text-blue-700 hover:file:bg-blue-200"
      >
      <p class="text-xs text-gray-500 mt-1">提示：上传新图像会替换父节点的图像输入。</p>
    </div>

    <!-- 生成按钮 -->
    <div class="pt-2">
      <button
        id="generate-btn"
        :disabled="isGenerating"
        @click="onGenerateClick"
        class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-400"
      >
        <span id="button-text">{{ isGenerating ? '生成中...' : '生成' }}</span>
        <div
          id="button-loader"
          :class="['loader ease-linear rounded-full border-4 border-t-4 border-gray-200 h-6 w-6 ml-3', { 'hidden': !isGenerating }]"
        ></div>
      </button>
    </div>
  </div>
</template>

<script setup>

import { ref, computed, onBeforeUnmount } from 'vue'
import { useWorkflowForm } from '@/lib/useWorkflowForm.js'
import { exportSpeechTimingRecordsCsv, isSpeechInputSupported, startBrowserSpeechInput } from '@/lib/speechInput.js'

const props = defineProps({
  selectedIds: { type: Array, default: () => [] },
  isGenerating: { type: Boolean, default: false },
  initialModuleId: { type: [String,undefined] },
  initialWorkflowType: { type: [String,undefined] }
})

const emit = defineEmits(['generate', 'upload'])

/* 逻辑全部委托给 useWorkflowForm */
const {
  moduleId,
  parameterValues,
  availableModules,
  currentParameters
} = useWorkflowForm(props)

const speechSupported = isSpeechInputSupported()
const listeningParamId = ref('')
const polishingParamId = ref('')
let activeSpeechSession = null

function stopSpeechInput () {
  if (activeSpeechSession) {
    activeSpeechSession.stop()
    activeSpeechSession = null
  }
  listeningParamId.value = ''
}

function toggleSpeechInput (paramId) {
  if (!speechSupported) return

  if (listeningParamId.value === paramId) {
    stopSpeechInput()
    return
  }

  stopSpeechInput()

  try {
    activeSpeechSession = startBrowserSpeechInput({
      getValue: () => parameterValues[paramId] || '',
      setValue: (value) => {
        parameterValues[paramId] = value
      },
      onStateChange: (isListening) => {
        listeningParamId.value = isListening ? paramId : ''
        if (!isListening) activeSpeechSession = null
      },
      onPolishingChange: (isPolishing) => {
        polishingParamId.value = isPolishing ? paramId : ''
      },
      onError: (error) => {
        console.warn('Speech input failed:', error)
      }
    })
  } catch (error) {
    console.warn('Speech input is unavailable:', error)
  }
}

function speechButtonText (paramId) {
  if (polishingParamId.value === paramId) return '...'
  return listeningParamId.value === paramId ? '停止' : '语音'
}

function speechButtonTitle (paramId) {
  if (!speechSupported) return '当前浏览器不支持语音输入'
  if (polishingParamId.value === paramId) return '正在润色语音文本'
  return listeningParamId.value === paramId ? '停止语音输入' : '开始语音输入'
}

onBeforeUnmount(() => {
  stopSpeechInput()
})

/* 父节点展示用 */
const parentNode1Id = computed(() => props.selectedIds[0] ?? null)
const parentNode2Id = computed(() => props.selectedIds[1] ?? null)

/* 文件上传 */
const fileInputRef = ref(null)
function onFileChange (e) {
  const file = e.target.files?.[0]
  if (file) emit('upload', file)
  if (fileInputRef.value) fileInputRef.value.value = ''
}

/* 生成按钮 */
function onGenerateClick () {
  /* 把最终 moduleId 与参数 emit 出去 */
  emit('generate', moduleId.value, { ...parameterValues })
}
</script>
