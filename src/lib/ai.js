/**
 * A very small OpenAI-compatible client.
 *
 * Works with OpenAI, DeepSeek, 通义千问, 智谱, Ollama, LM Studio, vLLM …
 * because they all speak /v1/chat/completions. No SDK, just fetch.
 */

const TASKS = {
  title: {
    label: '生成标题',
    prompt: (body) => [
      '为下面这篇博客文章拟定 5 个中文标题，每个不超过 24 个字，风格各异但都要贴切。',
      '每行一个，不要编号，不要解释。',
      '',
      '正文：',
      body.slice(0, 3000),
    ].join('\n'),
  },
  summary: {
    label: '写摘要',
    prompt: (body) => [
      '为下面这篇文章写一段 60–140 字的摘要，用于 meta description 和订阅源。',
      '直接给正文，不要标题。',
      '',
      '正文：',
      body.slice(0, 4000),
    ].join('\n'),
  },
  tags: {
    label: '推荐标签',
    prompt: (body) => [
      '为下面这篇文章推荐 3–6 个中文标签，用英文逗号分隔，不要其他文字。',
      '',
      '正文：',
      body.slice(0, 2500),
    ].join('\n'),
  },
  outline: {
    label: '列提纲',
    prompt: (body) => [
      '根据下面已有内容，列出这篇文章接下来可以展开的 4–6 个小标题（Markdown 二级标题，每行一个）。',
      '',
      '已有内容：',
      body.slice(0, 3000) || '（还没有内容）',
    ].join('\n'),
  },
  polish: {
    label: '润色',
    prompt: (body) => [
      '润色下面这段中文，修正错别字与语病，保持 Markdown 语法、原意和长度，不要添加新内容。',
      '只输出润色后的文字。',
      '',
      body.slice(0, 4000),
    ].join('\n'),
  },
  describe: {
    label: '看图说明',
    vision: true,
    prompt: () => ['用中文描述这张图，重点说清它表达的信息。如果是文档截图，请把文字转写出来。', '最多 200 字。'].join('\n'),
  },
  caption: {
    label: '写图注 (alt)',
    vision: true,
    prompt: () => ['为这张图写一句 alt 文本，20 字以内，直接输出，不要解释。'].join('\n'),
  },
};

export const AI_TASKS = Object.entries(TASKS).map(([key, def]) => ({ key, label: def.label, vision: !!def.vision }));

export function aiReady(config) {
  const ai = config?.ai || {};
  return Boolean(ai.enabled && ai.apiKey && ai.baseUrl && ai.model);
}

export function aiConfigError(config) {
  const ai = config?.ai || {};
  if (!ai.enabled) return 'AI 还没启用';
  if (!ai.baseUrl) return 'AI 缺少 baseUrl';
  if (!ai.apiKey) return 'AI 缺少 apiKey';
  if (!ai.model) return 'AI 缺少 model';
  return null;
}

function endpoint(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v\d+$/.test(base)) return base + '/chat/completions';
  return base + '/v1/chat/completions';
}

/**
 * @param {object} config site config (ai block)
 * @param {{ task?: string, body: string, instruction?: string, image?: string }} input
 * @returns {Promise<{ text: string, model: string }>}
 */
export function visionEnabled(config) {
  return Boolean(config?.ai?.enabled && config?.ai?.vision);
}

export async function ask(config, input) {
  const problem = aiConfigError(config);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });

  const ai = config.ai;
  const task = TASKS[input.task] ? input.task : 'summary';
  const userMessage = input.instruction
    ? [input.instruction, '', input.body.slice(0, 4000)].join('\n')
    : TASKS[task].prompt(String(input.body || ''));

  const messages = [{ role: 'system', content: '你是一个中文博客编辑助手，回答简洁、直接，不要客套话。' }];
  const image = visionEnabled(config) ? String(input.image || '') : '';
  if (image && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image)) {
    // multimodal content part (OpenAI vision format)
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userMessage },
        { type: 'image_url', image_url: { url: image } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  // maxTokens is optional: 0 (or empty) means we do not send the field at
  // all, so the model answers as long as it wants to.
  const cap = Number(ai.maxTokens || 0);
  const payload = {
    model: ai.model,
    messages,
    stream: false,
  };
  if (ai.temperature !== undefined && ai.temperature !== null && ai.temperature !== '') {
    payload.temperature = Number(ai.temperature);
  }
  if (cap > 0) payload.max_tokens = cap;

  const started = Date.now();
  const res = await fetch(endpoint(ai.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + ai.apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(ai.timeoutMs || 180000)),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error('AI 请求失败 ' + res.status + '：' + body.slice(0, 200)), { status: 502 });
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.message?.content
    || '';
  return {
    text: String(text).trim(),
    model: data?.model || ai.model,
    ms: Date.now() - started,
  };
}

export { TASKS };
