const els = {
  sourceUrl: document.querySelector('#sourceUrl'),
  ownershipConfirmed: document.querySelector('#ownershipConfirmed'),
  videoFile: document.querySelector('#videoFile'),
  modelName: document.querySelector('#modelName'),
  processBtn: document.querySelector('#processBtn'),
  installBtn: document.querySelector('#installBtn'),
  progressFill: document.querySelector('#progressFill'),
  statusText: document.querySelector('#statusText'),
  transcript: document.querySelector('#transcript'),
  copyBtn: document.querySelector('#copyBtn')
};

const state = {
  ffmpeg: null,
  transcribers: new Map(),
  installPrompt: null,
  sharedFile: null,
  dependencyPromise: null
};

const APP_VERSION = '20260617-fix5';
const TRANSFORMERS_URL =
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.web.js';

window.addEventListener('error', (event) => {
  reportError(event.error || event.message || '页面脚本加载失败。');
});

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason || '处理任务异常中断。');
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  els.installBtn.hidden = false;
});

els.installBtn.addEventListener('click', async () => {
  if (!state.installPrompt) {
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  els.installBtn.hidden = true;
});

els.processBtn.addEventListener('click', processVideo);
els.copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.transcript.value);
  setStatus('文案已复制。', 100);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

loadSharedFile();

async function processVideo() {
  setStatus('已收到任务，正在检查文件...', 3);
  showMessage('');

  if (!els.ownershipConfirmed.checked) {
    showMessage('请先确认该视频为自有或已授权内容。');
    setStatus('等待确认授权。', 0);
    return;
  }

  const file = state.sharedFile || els.videoFile.files[0];
  if (!file) {
    showMessage('请选择视频或音频文件。');
    setStatus('等待上传视频。', 0);
    return;
  }

  setBusy(true);

  try {
    setStatus('准备音频...', 8);
    const audio = await getAudioSamples(file);

    setStatus('加载识别模型，首次会慢一些...', 45);
    const transcriber = await getTranscriber(els.modelName.value);

    setStatus('正在识别文案...', 70);
    const result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      language: 'chinese',
      task: 'transcribe'
    });

    const text = Array.isArray(result)
      ? result.map((item) => item.text).join('\n')
      : result.text || '';

    showMessage(text.trim() || '没有识别到文案。');
    setStatus('提取完成。', 100);
  } catch (error) {
    showMessage(toFriendlyError(error));
    setStatus('处理失败。', 0);
  } finally {
    setBusy(false);
  }
}

async function getAudioSamples(file) {
  try {
    setStatus('尝试直接读取音轨...', 16);
    return await decodeAudioFile(file);
  } catch {
    setStatus('正在从视频中抽取音频...', 22);
    const wavBlob = await extractWavWithFfmpeg(file);
    return decodeAudioFile(wavBlob);
  }
}

async function decodeAudioFile(fileOrBlob) {
  const context = new AudioContext({ sampleRate: 16000 });
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const audioBuffer = await context.decodeAudioData(arrayBuffer);
  const mono = mixToMono(audioBuffer);
  await context.close();
  return resampleLinear(mono, audioBuffer.sampleRate, 16000);
}

async function extractWavWithFfmpeg(file) {
  const ffmpeg = await getFfmpeg();
  const { fetchFile } = await loadDependencies();
  const inputName = `input-${Date.now()}.${extensionFor(file)}`;
  const outputName = 'audio.wav';

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec([
    '-i',
    inputName,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'wav',
    outputName
  ]);

  const data = await ffmpeg.readFile(outputName);
  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});
  return new Blob([data.buffer], { type: 'audio/wav' });
}

async function getFfmpeg() {
  if (state.ffmpeg) {
    return state.ffmpeg;
  }

  const { FFmpeg, toBlobURL } = await loadDependencies();
  const ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.max(25, Math.min(42, Math.round(progress * 42)));
    setStatus('正在抽取音频...', pct);
  });

  const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
  });

  state.ffmpeg = ffmpeg;
  return ffmpeg;
}

async function getTranscriber(modelName) {
  if (state.transcribers.has(modelName)) {
    return state.transcribers.get(modelName);
  }

  const { pipeline } = await loadDependencies();
  const transcriber = await pipeline('automatic-speech-recognition', modelName, {
    dtype: 'q8',
    progress_callback: (progress) => {
      if (progress.status === 'progress') {
        const pct = 45 + Math.round((progress.progress || 0) * 0.2);
        setStatus(`加载模型：${progress.file || ''}`, Math.min(65, pct));
      }
    }
  });

  state.transcribers.set(modelName, transcriber);
  return transcriber;
}

async function loadDependencies() {
  if (!state.dependencyPromise) {
    setStatus('正在加载浏览器识别引擎...', 32);
    state.dependencyPromise = Promise.all([
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm'),
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm'),
      import(TRANSFORMERS_URL)
    ]).then(([ffmpegModule, utilModule, transformersModule]) => {
      const deps = {
        FFmpeg: ffmpegModule.FFmpeg,
        fetchFile: utilModule.fetchFile,
        toBlobURL: utilModule.toBlobURL,
        pipeline: transformersModule.pipeline
      };

      if (!deps.FFmpeg || !deps.fetchFile || !deps.toBlobURL || !deps.pipeline) {
        throw new Error('识别引擎加载不完整，请刷新后重试。');
      }

      transformersModule.env.allowLocalModels = false;
      const wasmConfig = transformersModule.env.backends?.onnx?.wasm;
      if (wasmConfig) {
        wasmConfig.wasmPaths =
          'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0-dev.20260416-b7804b056c/dist/';
        wasmConfig.numThreads = 1;
      }
      console.info(`Video Copy Assistant ${APP_VERSION}: browser ASR engine loaded.`);

      return deps;
    }).catch((error) => {
      state.dependencyPromise = null;
      throw new Error(`识别引擎加载失败：${error.message || String(error)}`);
    });
  }

  return state.dependencyPromise;
}

function mixToMono(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  for (let channel = 0; channel < channelCount; channel++) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      mono[i] += data[i] / channelCount;
    }
  }

  return mono;
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) {
    return input;
  }

  const ratio = fromRate / toRate;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const weight = position - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }

  return output;
}

function extensionFor(file) {
  const name = file.name || 'video.mp4';
  const ext = name.split('.').pop();
  return ext && ext.length <= 5 ? ext : 'mp4';
}

async function loadSharedFile() {
  if (!('caches' in window)) {
    return;
  }

  const cache = await caches.open('video-copy-share');
  const response = await cache.match('shared-file');
  if (!response) {
    return;
  }

  const blob = await response.blob();
  const fileName = response.headers.get('x-file-name') || 'shared-video.mp4';
  state.sharedFile = new File([blob], fileName, { type: blob.type || 'video/mp4' });
  els.videoFile.disabled = true;
  setStatus(`已接收分享文件：${fileName}`, 0);
  await cache.delete('shared-file');
}

function showMessage(message) {
  els.transcript.value = message;
}

function reportError(error) {
  const message = error?.message || String(error);
  showMessage(toFriendlyError(message));
  setStatus('处理失败。', 0);
  setBusy(false);
}

function toFriendlyError(error) {
  const message = error?.message || String(error);

  if (message.includes('registerBackend') || message.includes('backend')) {
    return [
      '处理失败：当前浏览器的本地 AI 识别引擎初始化失败。',
      '请刷新后重试，或换 Chrome / Edge 浏览器打开；手机端建议先用 1 分钟以内短视频测试。'
    ].join('\n');
  }

  if (message.includes('fetch') || message.includes('Failed to fetch') || message.includes('NetworkError')) {
    return '处理失败：识别模型下载失败，请检查网络后刷新重试。';
  }

  if (message.includes('module specifier')) {
    return '处理失败：浏览器识别依赖加载失败，请关闭旧页面后用最新链接重新打开。';
  }

  if (message.includes('memory') || message.includes('Array buffer allocation failed')) {
    return '处理失败：视频太大或设备内存不足，请先上传 1-5 分钟短视频测试。';
  }

  return `处理失败：${message}`;
}

function setBusy(isBusy) {
  els.processBtn.disabled = isBusy;
  els.modelName.disabled = isBusy;
  els.videoFile.disabled = isBusy || Boolean(state.sharedFile);
}

function setStatus(message, percent) {
  els.statusText.textContent = message;
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}
