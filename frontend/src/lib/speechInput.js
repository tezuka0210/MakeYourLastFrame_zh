export function isSpeechInputSupported() {
  return typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== 'undefined'
}

export const speechTimingRecords = []

let speechTimingTestId = 0

function roundTiming(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Number(value.toFixed(2))
    : null
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now()
}

function waitForNextFrame() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

function appendSpeechTimingRecord(record) {
  const nextRecord = {
    testId: ++speechTimingTestId,
    timestamp: new Date().toISOString(),
    ...record
  }
  speechTimingRecords.push(nextRecord)
  return nextRecord
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function formatCsvTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

export function exportSpeechTimingRecordsCsv() {
  if (!speechTimingRecords.length) {
    window.alert('暂无可导出的语音测试数据。')
    return
  }

  const fields = [
    'testId',
    'timestamp',
    'recognizedText',
    'recordingDurationMs',
    'audioPreparationTimeMs',
    'requestRoundTripTimeMs',
    'textRenderTimeMs',
    'userWaitLatencyMs',
    'audioDurationMs',
    'audioProcessingTimeMs',
    'whisperInferenceTimeMs',
    'resultProcessingTimeMs',
    'backendTotalTimeMs',
    'success',
    'errorMessage'
  ]
  const rows = [
    fields.join(','),
    ...speechTimingRecords.map(record => fields.map(field => csvEscape(record[field])).join(','))
  ]
  const csv = `\uFEFF${rows.join('\r\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `speech-timing-records-${formatCsvTimestamp()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function logSpeechTiming(record, backendTiming) {
  const summary = {
    recordingDurationMs: record.recordingDurationMs,
    audioPreparationTimeMs: record.audioPreparationTimeMs,
    requestRoundTripTimeMs: record.requestRoundTripTimeMs,
    textRenderTimeMs: record.textRenderTimeMs,
    userWaitLatencyMs: record.userWaitLatencyMs,
    backendTiming
  }
  console.log('[Speech Recognition Timing]', summary)
  console.table([{
    metric: '录音时长',
    valueMs: record.recordingDurationMs
  }, {
    metric: '音频准备耗时',
    valueMs: record.audioPreparationTimeMs
  }, {
    metric: '请求往返耗时',
    valueMs: record.requestRoundTripTimeMs
  }, {
    metric: '后端总耗时',
    valueMs: record.backendTotalTimeMs
  }, {
    metric: 'Whisper 推理耗时',
    valueMs: record.whisperInferenceTimeMs
  }, {
    metric: '文本渲染耗时',
    valueMs: record.textRenderTimeMs
  }, {
    metric: '用户等待延迟',
    valueMs: record.userWaitLatencyMs
  }])
}


function postInteractionMetric(payload) {
  try {
    fetch('/api/metrics/record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(err => {
      console.warn('[Interaction Metrics] Failed to save speech metric', err)
    })
  } catch (err) {
    console.warn('[Interaction Metrics] Failed to save speech metric', err)
  }
}

function appendText(baseText, addition) {
  const base = String(baseText || '').trim()
  const next = String(addition || '').trim()
  if (!base) return next
  if (!next) return base
  return `${base}${/[\uFF0C\u3002\uFF01\uFF1F?.!]$/.test(base) ? '' : ' '}${next}`
}

export async function polishSpeechText(text) {
  const rawText = String(text || '').trim()
  if (!rawText) return rawText
  if (import.meta.env.VITE_ENABLE_SPEECH_POLISH !== 'true') return rawText

  try {
    const res = await fetch('/api/speech/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: rawText })
    })

    if (!res.ok) return rawText
    const data = await res.json()
    return String(data.polished_text || rawText).trim()
  } catch (err) {
    console.warn('Speech polish failed:', err)
    return rawText
  }
}

function getAudioMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''

  const supportedTypes = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ]

  return supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || ''
}

function getAudioFilename(mimeType) {
  if (mimeType.includes('mp4')) return 'speech.mp4'
  if (mimeType.includes('ogg')) return 'speech.ogg'
  return 'speech.webm'
}

async function transcribeSpeechAudio(audioBlob, lang, timingState) {
  const formData = new FormData()
  formData.append('audio', audioBlob, getAudioFilename(audioBlob.type || 'audio/webm'))
  if (lang) formData.append('language', lang)

  timingState.requestStartTime = nowMs()
  const res = await fetch('/api/speech/transcribe', {
    method: 'POST',
    body: formData
  })

  const data = await res.json().catch(() => ({}))
  timingState.responseReceivedTime = nowMs()
  if (!res.ok) {
    throw new Error(data.error || `Speech transcription failed: ${res.status}`)
  }

  return {
    text: String(data.text || '').trim(),
    timing: data.timing || null
  }
}

export function startBrowserSpeechInput({
  getValue,
  setValue,
  onStateChange,
  onError,
  onPolishingChange,
  // Let the backend/model preserve the language that was actually spoken.
  // Callers may pass `en-US` or `zh-CN` to force one language when needed.
  lang = import.meta.env.VITE_SPEECH_INPUT_LANGUAGE || 'auto'
}) {
  if (!isSpeechInputSupported()) {
    throw new Error('当前浏览器不支持语音输入')
  }

  const baseText = getValue ? getValue() : ''
  const timingState = {
    recordingStartTime: nowMs(),
    recordingStopTime: null,
    requestStartTime: null,
    responseReceivedTime: null,
    textDisplayedTime: null
  }
  let stopped = false
  let pendingStart = true
  let mediaRecorder = null
  let stream = null
  let chunks = []

  function buildTimingRecord({ text = '', success = true, errorMessage = null, backendTiming = null }) {
    const responseEndTime = timingState.responseReceivedTime || nowMs()
    const displayTime = timingState.textDisplayedTime || responseEndTime
    const stopTime = timingState.recordingStopTime || timingState.recordingStartTime
    const requestStart = timingState.requestStartTime || responseEndTime

    return {
      recognizedText: text,
      recordingDurationMs: roundTiming(stopTime - timingState.recordingStartTime),
      audioPreparationTimeMs: roundTiming(requestStart - stopTime),
      requestRoundTripTimeMs: roundTiming(responseEndTime - requestStart),
      textRenderTimeMs: roundTiming(displayTime - responseEndTime),
      userWaitLatencyMs: roundTiming(displayTime - stopTime),
      audioDurationMs: roundTiming(backendTiming?.audioDurationMs),
      audioProcessingTimeMs: roundTiming(backendTiming?.audioProcessingTimeMs),
      whisperInferenceTimeMs: roundTiming(backendTiming?.whisperInferenceTimeMs),
      resultProcessingTimeMs: roundTiming(backendTiming?.resultProcessingTimeMs),
      backendTotalTimeMs: roundTiming(backendTiming?.backendTotalTimeMs),
      success,
      errorMessage
    }
  }

  function stopStream() {
    if (!stream) return
    stream.getTracks().forEach(track => track.stop())
    stream = null
  }

  async function finishRecording() {
    if (pendingStart) return

    stopStream()
    if (onStateChange) onStateChange(false)

    const mimeType = mediaRecorder?.mimeType || getAudioMimeType() || 'audio/webm'
    const audioBlob = new Blob(chunks, { type: mimeType })
    chunks = []

    if (!audioBlob.size) return

    if (onPolishingChange) onPolishingChange(true)

    try {
      const result = await transcribeSpeechAudio(audioBlob, lang, timingState)
      const transcript = result.text
      const mergedText = appendText(baseText, transcript)
      const polished = await polishSpeechText(mergedText)
      if (setValue) {
        setValue(polished)
        await waitForNextFrame()
        timingState.textDisplayedTime = nowMs()
      }
      const record = appendSpeechTimingRecord(buildTimingRecord({
        text: polished,
        success: true,
        backendTiming: result.timing
      }))
      postInteractionMetric({
        event_type: 'speech_input',
        prompt_input_view: 'speech',
        prompt_text: polished,
        speech_timing: record,
        payload: {
          backendTiming: result.timing
        }
      })
      logSpeechTiming(record, result.timing)
    } catch (err) {
      timingState.responseReceivedTime = timingState.responseReceivedTime || nowMs()
      timingState.textDisplayedTime = nowMs()
      const errorMessage = err?.message || 'speech-transcription-error'
      const record = appendSpeechTimingRecord(buildTimingRecord({
        text: '',
        success: false,
        errorMessage
      }))
      postInteractionMetric({
        event_type: 'speech_input',
        prompt_input_view: 'speech',
        speech_timing: record,
        payload: {
          errorMessage
        }
      })
      logSpeechTiming(record, null)
      if (onError) onError(err?.message || 'speech-transcription-error')
    } finally {
      if (onPolishingChange) onPolishingChange(false)
    }
  }

  async function startAfterMicPermission() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      if (stopped) {
        stopStream()
        return
      }

      const mimeType = getAudioMimeType()
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data)
      }
      mediaRecorder.onerror = (event) => {
        if (onError) onError(event.error?.message || 'media-recorder-error')
      }
      mediaRecorder.onstop = finishRecording

      pendingStart = false
      mediaRecorder.start()
      if (onStateChange) onStateChange(true)
    } catch (err) {
      pendingStart = false
      stopStream()
      if (onStateChange) onStateChange(false)
      if (onError) onError(err?.name || err?.message || 'microphone-permission-error')
    }
  }

  startAfterMicPermission()

  return {
    stop() {
      stopped = true
      timingState.recordingStopTime = nowMs()

      if (pendingStart) {
        stopStream()
        return
      }

      try {
        if (mediaRecorder?.state === 'recording') {
          mediaRecorder.stop()
        } else {
          stopStream()
          if (onStateChange) onStateChange(false)
        }
      } catch (err) {
        stopStream()
        if (onStateChange) onStateChange(false)
        console.warn('Speech recording stop failed:', err)
      }
    }
  }
}
