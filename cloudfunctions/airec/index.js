// cloudfunctions/airec/index.js - AI 菜品识别（独立云函数，长超时 60s）
// 与 dish 函数解耦：CRUD 保持默认超时，AI 长调用单独承载
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const MAX_LIMIT = 100;

const ok = (data) => ({ code: 0, data });
const fail = (msg, code = 1) => ({ code, msg });

// 单次模型请求超时（ms）。预算：2 模型 × 2 次尝试 × 10s = 40s + 下载 < 60s
const AI_REQUEST_TIMEOUT = 10000;
const AI_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('无法识别用户身份');
  try {
    return await recognizeDish({ openid: OPENID, event });
  } catch (err) {
    console.error('[airec] recognizeDish error:', err);
    return fail(err.message || '服务端异常');
  }
};

/** 模型链：控制台环境变量 AI_MODELS 优先（JSON 数组字符串，不进代码/部署包）；
 *  缺失或解析失败时回退 ai-config.json（本地联调用）；两者皆空 = mock 模式 */
function getAiModels() {
  // 1) 环境变量（云开发控制台「函数配置 → 环境变量」维护）
  if (process.env.AI_MODELS) {
    try {
      const arr = JSON.parse(process.env.AI_MODELS);
      if (Array.isArray(arr)) {
        const models = arr.filter(m => m && m.url && m.apiKey && m.name);
        if (models.length) return models;
      }
      console.warn('[airec] AI_MODELS 环境变量格式非法（应为 JSON 数组），回退文件配置');
    } catch (e) {
      console.warn('[airec] AI_MODELS 环境变量解析失败，回退文件配置');
    }
  }
  // 2) 文件兜底
  try {
    const cfg = JSON.parse(
      require('fs').readFileSync(require('path').join(__dirname, 'ai-config.json'), 'utf8')
    );
    if (Array.isArray(cfg.models)) {
      return cfg.models.filter(m => m && m.url && m.apiKey && m.name);
    }
    if (cfg.apiKey) {
      return [{
        name: 'qwen-vl-plus',
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        apiKey: cfg.apiKey
      }];
    }
    return [];
  } catch (e) {
    return [];
  }
}

/** Node 内置 https 封装的 POST JSON（云函数 runtime 不保证有全局 fetch） */
function httpsPostJson(url, bodyObj, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(bodyObj);
    const req = require('https').request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }, headers)
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = raw;
        try { body = JSON.parse(raw); } catch (e) { /* 保留原始串 */ }
        resolve({ status: res.statusCode, body });
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('TIMEOUT')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** 容错解析模型输出：去 markdown 围栏 + 截取首尾大括号 */
function parseAiJson(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { return null; }
}

/** mock 模式固定结果（未配置模型时，便于联调 UI） */
function mockRecognizeResult(categoryNames) {
  const matched = categoryNames.indexOf('家常菜') >= 0 ? '家常菜' : null;
  return {
    isFood: true,
    mock: true,
    name: '番茄牛腩煲',
    matchedCategoryName: matched,
    suggestedCategory: matched ? null : (categoryNames.length ? null : '家常菜'),
    priceYuan: 48,
    description: '【mock】浓郁番茄汤底，牛腩炖到软烂。番茄要多炒出沙。',
    tags: ['家常', '炖菜'],
    confidence: 0.9
  };
}

function buildSystemPrompt(categoryNames) {
  const list = categoryNames.length ? categoryNames.join('、') : '（用户暂无分类）';
  return [
    '你是「Yuki小厨房」点菜小程序的菜品信息提取助手。用户会给你一张照片，请判断它是否为食物/菜品，并提取菜品信息。',
    '',
    '输出要求（极其重要）：',
    '1. 只输出一个合法的 JSON 对象，不要输出 markdown 代码块、注释或任何解释文字。',
    '2. JSON 字段如下：',
    '   - isFood: 布尔值。照片主体不是可食用的菜品/食物（如风景、人物、文档、屏幕截图）时为 false，此时其余字段除 confidence 外均输出 null 或空。',
    '   - name: 字符串，菜品名称，简体中文，不超过 15 字，不带店名、价格、emoji。无法确定时给出最可能的通用菜名。',
    '   - category: 字符串或 null。必须严格从下面的候选分类中选择最匹配的一个；候选分类都不匹配时输出 null。禁止自创、改写、加空格。',
    '     候选分类：【' + list + '】',
    '   - suggestedCategory: 字符串或 null。仅当 category 为 null 时，给出一个不超过 6 字的新分类建议（如「汤羹炖品」「西式简餐」）；category 非 null 时输出 null。',
    '   - priceYuan: 数字或 null。仅当图中有明确可见的价格（菜单价签、小票）时输出该价格，单位元；无明确价格时输出 null，禁止凭空估价。',
    '   - description: 字符串，不超过 80 字，描述这道菜的食材、做法或口味特点，口吻亲切自然，像家庭菜谱备注。',
    '   - tags: 字符串数组，最多 4 个，每个不超过 6 字，如「辣」「快手」「家常」「低卡」。',
    '   - confidence: 0 到 1 的数字，表示你对 name 判断的置信度。',
    '3. 所有文本字段使用简体中文。'
  ].join('\n');
}

const AI_USER_PROMPT = '请分析这张照片并按系统要求输出 JSON。';
const AI_RETRY_HINT = '上次输出不是合法 JSON，这次只输出 JSON 对象本身。';

/** 服务端字段清洗：模型输出不可信，逐项兜底 */
function sanitizeAiResult(raw, categoryNames) {
  if (!raw || raw.isFood !== true) return { isFood: false };
  const name = String(raw.name || '').trim().slice(0, 30);
  if (!name) return { isFood: false, error: 'EMPTY_NAME' };

  let matched = null;
  const catRaw = String(raw.category || '').trim();
  if (catRaw && categoryNames.indexOf(catRaw) >= 0) matched = catRaw;

  let suggested = null;
  if (!matched) {
    const s = String(raw.suggestedCategory || '').trim().slice(0, 10);
    if (s && categoryNames.indexOf(s) < 0) suggested = s;
  }

  let priceYuan = null;
  const p = Number(raw.priceYuan);
  if (isFinite(p) && p >= 0 && p <= 1000000) priceYuan = Math.round(p * 100) / 100;

  const description = String(raw.description || '').slice(0, 500);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim().slice(0, 8)).slice(0, 5)
    : [];

  let confidence = Number(raw.confidence);
  if (!isFinite(confidence) || confidence < 0 || confidence > 1) confidence = 0.5;

  return {
    isFood: true,
    mock: false,
    name,
    matchedCategoryName: matched,
    suggestedCategory: suggested,
    priceYuan,
    description,
    tags,
    confidence
  };
}

/** 拉取当前用户全部分类（分批，上限 1000） */
async function fetchUserCategories(openid) {
  const col = db.collection('categories');
  let total = 0;
  try {
    const c = await col.where({ openid, deleted: false }).count();
    total = c.total;
  } catch (e) {
    return [];
  }
  const capped = Math.min(total, 1000);
  const batchCount = Math.ceil(capped / MAX_LIMIT);
  const tasks = [];
  for (let i = 0; i < batchCount; i++) {
    tasks.push(col.where({ openid, deleted: false })
      .orderBy('sortOrder', 'asc').skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
  }
  const results = await Promise.all(tasks);
  return results.reduce((acc, r) => acc.concat(r.data), []);
}

/** AI 拍照识别菜品：入参 { fileID } */
async function recognizeDish({ openid, event }) {
  const { fileID } = event;
  if (!fileID || typeof fileID !== 'string' || fileID.indexOf('cloud://') !== 0) {
    return fail('缺少图片文件ID');
  }

  const models = getAiModels();

  // 并行：下载图片 + 拉用户现有分类（服务端自查，不信任前端传参）
  const [dlRes, categories] = await Promise.all([
    cloud.downloadFile({ fileID }),
    fetchUserCategories(openid)
  ]);
  if (!dlRes || !dlRes.fileContent || !dlRes.fileContent.length) return fail('图片读取失败');
  if (dlRes.fileContent.length > AI_MAX_IMAGE_BYTES) return fail('图片过大，请换一张');

  const categoryNames = categories.map(c => c.name);

  // mock 模式：未配置任何模型时返回固定结果，便于联调 UI
  if (!models.length) return ok(mockRecognizeResult(categoryNames));

  // 组 base64 dataURL
  const extMatch = fileID.match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
  const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
  const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
  const dataUrl = `data:${mime};base64,${dlRes.fileContent.toString('base64')}`;

  const systemPrompt = buildSystemPrompt(categoryNames);

  // 模型链：主模型失败切备用；每个模型最多 2 次尝试（第 2 次带 JSON 纠正语）
  let lastErr = null;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    for (let attempt = 0; attempt < 2; attempt++) {
      const userText = attempt === 0 ? AI_USER_PROMPT : AI_USER_PROMPT + AI_RETRY_HINT;
      let resp;
      try {
        resp = await httpsPostJson(model.url, {
          model: model.name,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: userText }
            ] }
          ]
        }, { Authorization: `Bearer ${model.apiKey}` }, AI_REQUEST_TIMEOUT);
      } catch (e) {
        lastErr = e;
        console.warn(`[airec] 模型 ${model.name} 第${attempt + 1}次请求异常:`, e.message);
        continue; // TIMEOUT / 网络错误 → 同模型重试
      }

      if (resp.status === 401 || resp.status === 403) {
        lastErr = new Error(`模型 ${model.name} 鉴权失败`);
        console.warn(`[airec] 模型 ${model.name} 鉴权失败，切换备用`);
        break; // 鉴权失败不重试同模型，直接切下一个
      }
      if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
        lastErr = new Error('HTTP ' + resp.status);
        continue; // 限流/服务端错误 → 同模型重试
      }
      if (resp.status !== 200) {
        lastErr = new Error('HTTP ' + resp.status);
        break; // 其他 4xx → 切下一个模型
      }

      const content = resp.body
        && resp.body.choices
        && resp.body.choices[0]
        && resp.body.choices[0].message
        && resp.body.choices[0].message.content;
      const text = Array.isArray(content)
        ? content.map(c => (c && c.text) || '').join('')
        : String(content || '');

      const parsed = parseAiJson(text);
      if (!parsed) {
        lastErr = new Error('PARSE_FAIL');
        continue; // 非合法 JSON → 同模型重试（带纠正语）
      }

      const cleaned = sanitizeAiResult(parsed, categoryNames);
      if (cleaned.error === 'EMPTY_NAME') return fail('没识别出菜名，请换张图');
      return ok(cleaned);
    }
  }

  console.error('[airec] 全部模型尝试均失败:', lastErr && lastErr.message);
  return fail('识别服务暂时不可用，请稍后再试或手动填写');
}
