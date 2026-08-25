import { ref, reactive, computed, watch } from 'vue'

/* 全部模块 */
const allModules = [
  // { id: 'AddText',name:'Text',type:'util'},
  // { id: 'AddWorkflow',name:'AddWorkflow',type:'util'},
  { id: 'ImageCanny', name: '边缘检测', type: 'preprocess' },
  { id: 'RemoveBackground', name: '移除背景', type: 'preprocess' },
  { id: 'ImageMerging', name: '图像拼接', type: 'preprocess' },
  { id: 'TextGenerateImage', name: '文生图', type: 'image' },
  { id: 'ImageGenerateImage', name: '图生图', type: 'image' },
 
  { id: 'ImageHDRestoration', name: '高清修复', type: 'image' },
  { id: 'Put_It_Here', name: '对象迁移', type: 'image' },
  { id: 'TextGenerateVideo', name: '文生视频', type: 'video' },
  { id: 'ImageGenerateVideo', name: '图生视频', type: 'video' },
  { id: 'CameraControl', name: '镜头控制', type: 'video' },
  { id: 'FrameInterpolation', name: '补帧', type: 'video' },
  { id: 'FLFrameToVideo', name: '首尾帧控制', type: 'video' },
  { id: 'TextToAudio',name:'文生音频',type:'audio'},
  { id: 'ImageInpainting',name:'局部重绘',type:'image'},
  { id: 'SegmentElement', name:'实体分割',type:'image'}
]

/* 各模块参数定义 */
export const workflowParameters = {
 
  TextToAudio: [
    { id: 'text', label: '音频提示词', type: 'textarea', defaultValue: '', placeholder: '输入要转换为音频的描述...' },
    { id: 'audio_seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'seconds', label: '时长（秒）', type: 'number', defaultValue: 5.0, step:0.1, min:1.0, max:20.0 }
  ],
  LayerStacking:[
    { id: 'position', label: '位置', type: 'number', defaultValue: 0.5, step: 0.01, min: 0, max: 1 }
  ],
  ImageCanny: [
    { id: 'low_threshold', label: '低阈值', type: 'number', defaultValue: 0.1, step: 0.01, min: 0, max: 1 },
    { id: 'high_threshold', label: '高阈值', type: 'number', defaultValue: 0.8, step: 0.01, min: 0, max: 1 }
  ],
  RemoveBackground: [
    { id: 'model', label: '模型', type: 'select', options: ['u2net', 'u2netp', 'silueta', 'isnet-general-use', 'isnet-anime'], defaultValue: 'u2net' },
    { id: 'foreground_threshold', label: '前景阈值', type: 'number', defaultValue: 240 },
    { id: 'background_threshold', label: '背景阈值', type: 'number', defaultValue: 10 },
    { id: 'erode_size', label: '腐蚀尺寸', type: 'number', defaultValue: 10 }
  ],
  ImageMerging: [
    { id: 'stitch', label: '拼接方向', type: 'select', options: ['top', 'left', 'bottom', 'right'], defaultValue: 'right' }
  ],
  TextGenerateImage: [
    { id: 'positive_prompt', label: '提示词', type: 'textarea', defaultValue: '', placeholder: '输入你的创意提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'steps', label: '步数', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: '引导强度', type: 'number', defaultValue: 7.5, step: 0.1 },
    { id: 'width', label: '宽度', type: 'number', defaultValue: 1280 },
    { id: 'height', label: '高度', type: 'number', defaultValue: 720 },
    { id: 'batch_size', label: '批量数量', type: 'number', defaultValue: 1 }
  ],
  ImageGenerateImage_Basic: [
    { id: 'positive_prompt', label: '提示词', type: 'textarea', defaultValue: '', placeholder: '输入你的创意提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'steps', label: '步数', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: '引导强度', type: 'number', defaultValue: 7.5, step: 0.1 },
    { id: 'width', label: '宽度', type: 'number', defaultValue: 1280 },
    { id: 'height', label: '高度', type: 'number', defaultValue: 720 },
    { id: 'batch_size', label: '批量数量', type: 'number', defaultValue: 1 }
  ],
  ImageGenerateImage_Canny: [
    { id: 'positive_prompt', label: '提示词', type: 'textarea', defaultValue: '', placeholder: '输入你的创意提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'steps', label: '步数', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: '引导强度', type: 'number', defaultValue: 7.5, step: 0.1 },
    { id: 'width', label: '宽度', type: 'number', defaultValue: 1280 },
    { id: 'height', label: '高度', type: 'number', defaultValue: 720 },
    { id: 'batch_size', label: '批量数量', type: 'number', defaultValue: 1 }
  ],
  ImageHDRestoration: [
    { id: 'positive_prompt', label: '正向提示词', type: 'textarea', defaultValue: '', placeholder: '输入正向提示词...' },
    { id: 'negative_prompt', label: '负向提示词', type: 'textarea', defaultValue: '', placeholder: '输入负向提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'denoise', label: '重绘强度', type: 'number', defaultValue: 0.1, step: 0.01 }
  ],
  ImageInpainting: [
    { id: 'positive_prompt', label: '提示词', type: 'textarea', defaultValue: '', placeholder: '输入正向提示词...' },
    { id: 'negative_prompt', label: '负向提示词', type: 'textarea', defaultValue: '', placeholder: '输入负向提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'steps', label: '步数', type: 'number', defaultValue: 20 },
    { id: 'guidance', label: '引导强度', type: 'number', defaultValue: 7.5, step: 0.1 }
  ],
  TextGenerateVideo: [
    { id: 'positive_prompt', label: '正向提示词', type: 'textarea', defaultValue: '', placeholder: '输入正向提示词...' },
    { id: 'negative_prompt', label: '负向提示词', type: 'textarea', defaultValue: '', placeholder: '输入负向提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'fps', label: '帧率', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: '宽度', type: 'number', defaultValue: 1280 },
    { id: 'height', label: '高度', type: 'number', defaultValue: 720 },
    // { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: '批量数量', type: 'number', defaultValue: 1 },
    { id: 'time', label: '时长', type:'number', defaultValue: 5}
  ],
  ImageGenerateVideo: [
    { id: 'positive_prompt', label: '正向提示词', type: 'textarea', defaultValue: '', placeholder: '输入正向提示词...' },
    { id: 'negative_prompt', label: '负向提示词', type: 'textarea', defaultValue: '', placeholder: '输入负向提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'fps', label: '帧率', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: '宽度', type: 'number', defaultValue: 1280 },
    { id: 'height', label: '高度', type: 'number', defaultValue: 720 },
    // { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: '批量数量', type: 'number', defaultValue: 1 },
    { id: 'time', label: '时长', type:'number', defaultValue: 5}
  ],
  FLFrameToVideo: [
    { id: 'positive_prompt', label: '正向提示词', type: 'textarea', defaultValue: '', placeholder: '输入正向提示词...' },
    { id: 'negative_prompt', label: '负向提示词', type: 'textarea', defaultValue: '', placeholder: '输入负向提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'fps', label: '帧率', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: '宽度', type: 'number', defaultValue: 1280 },
    { id: 'height', label: '高度', type: 'number', defaultValue: 720 },
    // { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: '批量数量', type: 'number', defaultValue: 1 },
    { id: 'time', label: '时长', type:'number', defaultValue: 5}
  ],
  CameraControl: [
    { id: 'positive_prompt', label: '正向提示词', type: 'textarea', defaultValue: '', placeholder: '输入正向提示词...' },
    { id: 'negative_prompt', label: '负向提示词', type: 'textarea', defaultValue: '', placeholder: '输入负向提示词...' },
    { id: 'seed', label: '随机种子', type: 'number', defaultValue: null, placeholder: '随机' },
    { id: 'camera_pose', label: '镜头运动', type: 'select', options: ['Pan Up', 'Pan Down', 'Pan Left', 'Pan Right', 'Zoom In', 'Zoom Out', 'Anti Clockwise (ACW)', 'ClockWise (CW)'], defaultValue: 'Pan Up' },
    { id: 'fps', label: '帧率', type: 'number', defaultValue: 16, step: 1 },
    { id: 'width', label: '宽度', type: 'number', defaultValue: 1280 },
    { id: 'height', label: '高度', type: 'number', defaultValue: 720 },
    // { id: 'length', label: 'length', type: 'number', defaultValue: 41, step: 8 },
    { id: 'batch_size', label: '批量数量', type: 'number', defaultValue: 1 },
    { id: 'time', label: '时长', type:'number', defaultValue: 5}
  ],
  FrameInterpolation: [
    { id: 'multiplier', label: '倍数', type: 'number', defaultValue: 2 },
    { id: 'fps', label: '帧率', type: 'number', defaultValue: 16, step: 1 }
  ],
  SegmentElement: [
    { id: 'positive_prompt', label: '实体', type: 'textarea', defaultValue: '', placeholder: '女孩，狗，椅子' },
    { id: 'background_prompt', label: '背景提示词', type: 'textarea', defaultValue: '', placeholder: '将背景替换为...' }
  ]
}

/* 主函数：useWorkflowForm */
export function useWorkflowForm (props) {
  const moduleId = ref('')
  const parameterValues = reactive({})

  /* 计算属性 */
  const availableModules = computed(() => {
    if (!props.initialWorkflowType) return allModules
    return allModules.filter(m => m.type === props.initialWorkflowType)
  })

  const currentParameters = computed(() => {
    return workflowParameters[moduleId.value] || []
  })

  /* 方法 */
  function resetParameterValues (id) {
    Object.keys(parameterValues).forEach(k => delete parameterValues[k])
    const params = workflowParameters[id] || []
    params.forEach(p => { parameterValues[p.id] = p.defaultValue })
  }

  /* 监听 */
  watch(() => props.initialModuleId, (val) => {
    if (val && val !== moduleId.value) moduleId.value = val
    else if (!val && availableModules.value.length) {
      const first = availableModules.value[0]
      if (first) moduleId.value = first.id
    }
  }, { immediate: true })

  watch(moduleId, (newId, oldId) => {
    if (newId && newId !== oldId) resetParameterValues(newId)
  }, { immediate: true })

  
  return {
    moduleId,
    parameterValues,
    availableModules,
    currentParameters,
    resetParameterValues,
    workflowParameters
  }
}
