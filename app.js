const els = {
  apiBase: document.querySelector('#apiBase'),
  sourceUrl: document.querySelector('#sourceUrl'),
  ownershipConfirmed: document.querySelector('#ownershipConfirmed'),
  videoFile: document.querySelector('#videoFile'),
  processBtn: document.querySelector('#processBtn'),
  transcript: document.querySelector('#transcript'),
  copyBtn: document.querySelector('#copyBtn')
};

els.apiBase.value = localStorage.getItem('apiBase') || '';

els.processBtn.addEventListener('click', processVideo);
els.copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(els.transcript.value);
});

async function processVideo() {
  const apiBase = els.apiBase.value.trim().replace(/\/$/, '');
  localStorage.setItem('apiBase', apiBase);

  if (!apiBase) {
    showMessage('请先填写已部署的 HTTPS 后端地址。');
    return;
  }
  if (!els.ownershipConfirmed.checked) {
    showMessage('请先确认该视频为自有或已授权内容。');
    return;
  }
  if (!els.videoFile.files.length) {
    showMessage('请选择视频或音频文件。');
    return;
  }

  const form = new FormData();
  form.append('video', els.videoFile.files[0]);
  form.append('sourceUrl', els.sourceUrl.value.trim());
  form.append('ownershipConfirmed', 'true');

  setBusy(true);
  showMessage('上传中，请稍候...');

  try {
    const uploadResponse = await fetch(`${apiBase}/api/tasks/upload`, {
      method: 'POST',
      body: form
    });
    const uploadPayload = await uploadResponse.json();
    if (!uploadResponse.ok || !uploadPayload.task) {
      throw new Error(uploadPayload.error || '上传失败。');
    }

    await pollTask(apiBase, uploadPayload.task.id);
  } catch (error) {
    showMessage(error.message || String(error));
  } finally {
    setBusy(false);
  }
}

async function pollTask(apiBase, taskId) {
  for (;;) {
    const response = await fetch(`${apiBase}/api/tasks/${taskId}`);
    const payload = await response.json();
    if (!response.ok || !payload.task) {
      throw new Error(payload.error || '任务读取失败。');
    }

    const task = payload.task;
    if (task.status === 'done') {
      const notes = Array.isArray(task.notes) && task.notes.length ? `\n\n[提示]\n${task.notes.join('\n')}` : '';
      showMessage(`${task.transcript || ''}${notes}`);
      return;
    }
    if (task.status === 'failed') {
      throw new Error(task.message || '处理失败。');
    }

    showMessage('处理中，请稍候...');
    await wait(1600);
  }
}

function showMessage(message) {
  els.transcript.value = message;
}

function setBusy(isBusy) {
  els.processBtn.disabled = isBusy;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
