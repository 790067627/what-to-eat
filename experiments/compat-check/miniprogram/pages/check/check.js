// 抽卡动画移植前兼容性验证页
// 关键兼容点：小程序逻辑层没有全局 requestAnimationFrame / wx.requestAnimationFrame！
// 官方只有 canvas(type=2d) 节点上的 requestAnimationFrame（基础库 2.24.0+）。
// 因此统一帧调度器：canvas 节点 raf 优先，setTimeout(16) 降级；全链路 try/catch 防白屏。
const E = {
  outBack: k => { const c = 2.0; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); }
};

Page({
  data: {
    env: {},
    degA: 180,        // A：JS 驱动的旋转角
    playB: false,     // B：CSS 动画开关
    sxC: 1, faceC: 0, // C：2D 降级
    rafStopped: true, // D：粒子是否已静止
    rafMode: '-',     // 帧调度器实际模式（真机可见，验证降级路径）
    perf: { fpsA: '-', jankA: '-', fpsD: '-', jankD: '-', setMs: '-', stress: '-' },
    tFirst: '-', tSwap: '-',
    marks: { A: '', B: '', C: '', D: '', E: '', G: '' },
    summary: ''
  },

  onLoad() {
    try {
      // 信标回读：boot=onLaunch 时间戳；err=全局错误列表（黄卡展示，不弹窗）
      const boot = wx.getStorageSync('__cc_boot');
      const errs = wx.getStorageSync('__cc_err') || [];
      this.setData({ bootInfo: 'onLaunch@' + (boot || '无') + (errs.length ? ' | 错误: ' + errs.join(' ;; ') : ' | 无全局错误') });
    } catch (e) { this.setData({ bootInfo: '信标读取异常: ' + e }); }
    try {
      const di = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync();
      const bi = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
      this.setData({
        env: {
          platform: di.platform, brand: di.brand || '', model: di.model || '',
          system: di.system, sdk: bi.SDKVersion || '', wechat: bi.version || ''
        }
      });
    } catch (e) {
      this.setData({ env: { platform: 'unknown', system: 'unknown', sdk: '?', wechat: '?' } });
    }
  },

  onReady() {
    this.initCanvas();
    // F：时序实测延后到 onReady，且不阻塞首屏
    setTimeout(() => { try { this.measureChain(); } catch (e) { this.setData({ tFirst: 'err' }); } }, 600);
    setTimeout(() => { try { this.playA(); } catch (e) {} }, 900);
  },

  onUnload() {
    this._alive = false;
  },

  /* ---------- 帧调度器：canvas 节点 raf 优先，setTimeout(16) 降级 ---------- */
  raf(cb) {
    if (this._cv && typeof this._cv.requestAnimationFrame === 'function') {
      if (this.data.rafMode !== 'canvas-raf') this.setData({ rafMode: 'canvas-raf' });
      return { kind: 'c', id: this._cv.requestAnimationFrame(cb) };
    }
    if (this.data.rafMode !== 'timeout16') this.setData({ rafMode: 'timeout16' });
    return { kind: 't', id: setTimeout(() => cb(Date.now()), 16) };
  },
  caf(h) {
    if (!h) return;
    if (h.kind === 'c') { if (this._cv && this._cv.cancelAnimationFrame) this._cv.cancelAnimationFrame(h.id); }
    else clearTimeout(h.id);
  },

  /* ---------- G：帧率/setData 开销实测 ---------- */
  _pBegin(key) { this._perf = { key, t0: Date.now(), last: Date.now(), frames: 0, jank: 0, maxGap: 0 }; },
  _pTick() {
    const p = this._perf; if (!p) return;
    const now = Date.now(), gap = now - p.last;
    p.last = now; p.frames++;
    if (gap > p.maxGap) p.maxGap = gap;
    if (gap > 34) p.jank++;           // >2 帧(60Hz) 视为掉帧
  },
  _pEnd() {
    const p = this._perf; if (!p) return null;
    const span = Date.now() - p.t0;
    const r = { fps: Math.round(p.frames * 1000 / Math.max(span, 1)), jank: p.jank, frames: p.frames, maxGap: p.maxGap };
    this._perf = null; return r;
  },
  /** setData 单次调用开销（逻辑层序列化+IPC 发送，同步返回耗时） */
  measureSetData(done) {
    const N = 60, t0 = Date.now();
    for (let i = 0; i < N; i++) this.setData({ _probe: i });
    const avg = (Date.now() - t0) / N;
    done(Math.round(avg * 100) / 100);
  },
  /** 连续 10 次翻牌压测（模拟连点换一道的最坏节奏） */
  stressFlip(done) {
    this._alive = true;
    this.caf(this._rafA);
    this._pBegin('stress');
    let n = 0;
    const one = () => {
      const dur = 450, t0 = Date.now();
      const step = () => {
        if (this._alive === false) return;
        this._pTick();
        const k = Math.min((Date.now() - t0) / dur, 1);
        this.setData({ degA: 180 * (1 - E.outBack(k)) });
        if (k < 1) this._rafA = this.raf(step);
        else if (++n < 10) one();
        else { const r = this._pEnd(); done(r); }
      };
      this._rafA = this.raf(step);
    };
    one();
  },
  runPerf() {
    this.measureSetData(ms => {
      const perf = Object.assign({}, this.data.perf, { setMs: ms + 'ms' });
      this.setData({ perf });
      this.stressFlip(r => {
        const perf2 = Object.assign({}, this.data.perf, { stress: r.fps + 'fps/掉' + r.jank });
        this.setData({ perf: perf2 });
        this.buildSummary();
      });
    });
  },

  /* ---------- A：3D 翻牌（逐帧 setData，移植方案） ---------- */
  playA() {
    this._alive = true;
    this.caf(this._rafA);
    this._pBegin('A');
    const dur = 450, t0 = Date.now();
    const step = () => {
      if (this._alive === false) return;
      this._pTick();
      const k = Math.min((Date.now() - t0) / dur, 1);
      const e = E.outBack(k);
      this.setData({ degA: 180 * (1 - e) });
      if (k < 1) this._rafA = this.raf(step);
      else {
        this._rafA = null;
        const r = this._pEnd();
        if (r) this.setData({ perf: Object.assign({}, this.data.perf, { fpsA: r.fps + 'fps', jankA: '掉' + r.jank + '/' + r.frames + '帧 最大间隔' + r.maxGap + 'ms' }) });
      }
    };
    this._rafA = this.raf(step);
  },

  /* ---------- B：CSS 动画对照 ---------- */
  playB() {
    this.setData({ playB: false });
    setTimeout(() => this.setData({ playB: true }), 60);
  },

  /* ---------- C：2D 降级（scaleX 换面） ---------- */
  playC() {
    this._alive = true;
    this.caf(this._rafA);
    const dur = 420, t0 = Date.now();
    this.setData({ faceC: 0 });
    const step = () => {
      if (this._alive === false) return;
      const k = Math.min((Date.now() - t0) / dur, 1);
      let sx, face;
      if (k < 0.5) { sx = 1 - k * 2; face = 0; }
      else { sx = (k - 0.5) * 2; face = 1; }
      this.setData({ sxC: Math.max(sx, 0.02), faceC: face });
      if (k < 1) this._rafA = this.raf(step);
      else { this.setData({ sxC: 1 }); this._rafA = null; }
    };
    this._rafA = this.raf(step);
  },

  /* ---------- D：Canvas 2D 粒子 ---------- */
  initCanvas() {
    try {
      wx.createSelectorQuery().in(this).select('#fx').fields({ node: true, size: true }).exec(res => {
        if (!res || !res[0] || !res[0].node) return;
        const cv = res[0].node, ctx = cv.getContext('2d');
        const dpr = Math.min((wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2, 3);
        cv.width = res[0].width * dpr; cv.height = res[0].height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._cv = cv; this._ctx = ctx; this._cw = res[0].width; this._ch = res[0].height;
      });
    } catch (e) { /* canvas 不可用时 D 项标记异常即可 */ }
  },
  playD() {
    this._dtry = (this._dtry || 0) + 1;
    if (!this._ctx) {
      if (this._dtry > 10) { wx.showToast({ title: 'canvas 初始化失败', icon: 'none' }); return; }
      setTimeout(() => this.playD(), 300); return;
    }
    this._alive = true;
    const ctx = this._ctx, cx = this._cw / 2, cy = this._ch / 2;
    const ps = [], rings = [];
    const colors = ['#FFD6E7', '#FF8FB8', '#FFF3F8', '#FFC9DE', '#FFD98A'];
    for (let i = 0; i < 52; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2.2 + Math.random() * 6;
      ps.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
        s: 1.5 + Math.random() * 3, life: 1, d: .014 + Math.random() * .016,
        c: colors[(Math.random() * colors.length) | 0], star: Math.random() < .6,
        rot: Math.random() * Math.PI, spin: (Math.random() - .5) * .26 });
    }
    rings.push({ r: 8, max: 150, life: 1, d: .03, w: 4 });
    rings.push({ r: 3, max: 100, life: 1, d: .045, w: 2.5 });
    this.setData({ rafStopped: false });
    this._pBegin('D');
    const tick = () => {
      if (this._alive === false) return;
      this._pTick();
      ctx.clearRect(0, 0, this._cw, this._ch);
      let alive = false;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]; p.life -= p.d;
        if (p.life <= 0) { ps.splice(i, 1); continue; }
        alive = true;
        p.x += p.vx; p.y += p.vy; p.vy += .07; p.vx *= .985; p.vy *= .985; p.rot += p.spin;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = p.life; ctx.fillStyle = p.c;
        ctx.shadowColor = p.c; ctx.shadowBlur = 6 * p.life;
        if (p.star) {
          const s = p.s * 1.7;
          ctx.beginPath();
          ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * .18, -s * .18, s, 0);
          ctx.quadraticCurveTo(s * .18, s * .18, 0, s);
          ctx.quadraticCurveTo(-s * .18, s * .18, -s, 0);
          ctx.quadraticCurveTo(-s * .18, -s * .18, 0, -s);
          ctx.fill();
        } else { ctx.beginPath(); ctx.arc(0, 0, p.s, 0, 7); ctx.fill(); }
        ctx.restore();
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.life -= r.d;
        if (r.life <= 0) { rings.splice(i, 1); continue; }
        alive = true;
        r.r += (r.max - r.r) * .09;
        ctx.save(); ctx.globalAlpha = r.life * .8;
        ctx.strokeStyle = 'rgba(255,182,213,1)'; ctx.lineWidth = r.w * r.life;
        ctx.shadowColor = 'rgba(255,182,213,.9)'; ctx.shadowBlur = 12 * r.life;
        ctx.beginPath(); ctx.arc(cx, cy, r.r, 0, 7); ctx.stroke(); ctx.restore();
      }
      if (alive) this._rafD = this.raf(tick);
      else {
        this._rafD = null; ctx.clearRect(0, 0, this._cw, this._ch);
        const r = this._pEnd();
        this.setData({ rafStopped: true, perf: r ? Object.assign({}, this.data.perf, { fpsD: r.fps + 'fps', jankD: '掉' + r.jank + '/' + r.frames + '帧' }) : this.data.perf });
      }
    };
    this._rafD = this.raf(tick);
  },

  /* ---------- F：时序实测（用调度器，含 setData 每帧开销） ---------- */
  measureChain() {
    const chain = (segs, done) => {
      const t0 = Date.now();
      let idx = 0;
      const runSeg = () => {
        if (idx >= segs.length) { done(Date.now() - t0); return; }
        const dur = segs[idx++], s0 = Date.now();
        const step = () => {
          this.setData({ _tick: Date.now() });
          if (Date.now() - s0 < dur) this._rafF = this.raf(step);
          else runSeg();
        };
        this._rafF = this.raf(step);
      };
      runSeg();
    };
    chain([650, 450, 420], ms => {
      this.setData({ tFirst: ms });
      chain([240, 420], ms2 => this.setData({ tSwap: ms2 }));
    });
  },

  /* ---------- 标记与汇总 ---------- */
  mark(e) {
    const { k, v } = e.currentTarget.dataset;
    const marks = Object.assign({}, this.data.marks);
    marks[k] = (v === '1' || v === 'back') ? '✓通过' : (v === '0' ? '✗异常' : v);
    this.setData({ marks });
    this.buildSummary();
  },
  buildSummary() {
    const m = this.data.marks, env = this.data.env, pf = this.data.perf;
    this.setData({
      summary:
        '[抽卡动画兼容验证] ' + env.platform + '/' + env.model + '/' + env.system + ' 基础库' + env.sdk +
        ' 帧调度:' + this.data.rafMode + '\n' +
        'A 3D翻牌(逐帧setData): ' + (m.A || '未测') + '\n' +
        'B CSS动画对照: ' + (m.B || '未测') + '\n' +
        'C 2D降级: ' + (m.C || '未测') + '\n' +
        'D Canvas粒子: ' + (m.D || '未测') + '\n' +
        'E 背景模糊: ' + (m.E || '未测') + '\n' +
        'F 首抽链实测 ' + this.data.tFirst + 'ms / 换一道 ' + this.data.tSwap + 'ms\n' +
        'G 翻牌 ' + pf.fpsA + ' ' + pf.jankA + ' | 粒子 ' + pf.fpsD + ' ' + pf.jankD +
        ' | setData ' + pf.setMs + ' | 压测 ' + pf.stress
    });
  },
  copySum() {
    this.buildSummary();
    wx.setClipboardData({ data: this.data.summary, success: () => wx.showToast({ title: '已复制', icon: 'success' }) });
  }
});
