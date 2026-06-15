/**
 * World Cup Predictor Widget — widget.js
 * ==========================================
 * كيفية الاستخدام في أي متجر (Zid / Salla / Shopify):
 *
 * 1. ارفع widget.css في إعدادات CSS المخصص
 * 2. أضف هذا في نهاية <body> أو custom JS:
 *
 *   <script>
 *     window.WCP_CONFIG = {
 *       supabaseUrl:  'https://XXXX.supabase.co',
 *       supabaseKey:  'your-anon-public-key',
 *       storeId:      'capsone',           // معرّف متجرك (أي نص)
 *       trigger:      'auto',              // 'auto' | 'manual' | 'button'
 *       delaySeconds: 8,                   // تأخير ظهور البوب أب (auto فقط)
 *       couponValue:  '15%',              // قيمة الجائزة المعروضة للعميل
 *     };
 *   </script>
 *   <script src="https://your-cdn.com/widget.js"></script>
 *
 * ==========================================
 */

(function () {
  'use strict';

  /* ---- Config ---- */
  const CFG = Object.assign({
    supabaseUrl:  '',
    supabaseKey:  '',
    storeId:      'default',
    trigger:      'auto',
    delaySeconds: 8,
    couponValue:  '10%',
  }, window.WCP_CONFIG || {});

  /* ---- State ---- */
  let matches      = [];
  let currentIdx   = 0;
  let predictions  = {};   // matchId -> { prediction, home, away }
  let savedEmails  = {};   // matchId -> email (localStorage)
  let isOpen       = false;

  /* ---- Supabase REST helper ---- */
  async function sbFetch(path, opts = {}) {
    const res = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, {
      ...opts,
      headers: {
        'apikey':        CFG.supabaseKey,
        'Authorization': 'Bearer ' + CFG.supabaseKey,
        'Content-Type':  'application/json',
        'Prefer':        opts.prefer || 'return=minimal',
        ...(opts.headers || {}),
      },
    });
    if (opts.returnJson !== false) {
      try { return await res.json(); } catch { return null; }
    }
    return res;
  }

  /* ---- Load upcoming matches (next 3 days) ---- */
  async function loadMatches() {
    const now    = new Date().toISOString();
    const plus3  = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const data   = await sbFetch(
      `matches?status=eq.upcoming&match_date=gte.${now}&match_date=lte.${plus3}&order=match_date.asc&limit=5`
    );
    matches = Array.isArray(data) ? data : [];
    return matches;
  }

  /* ---- Load saved state from localStorage ---- */
  function loadLocal() {
    try {
      const raw = localStorage.getItem('wcp_' + CFG.storeId);
      savedEmails = raw ? JSON.parse(raw) : {};
    } catch { savedEmails = {}; }
  }

  function saveLocal(matchId, email) {
    savedEmails[matchId] = email;
    try { localStorage.setItem('wcp_' + CFG.storeId, JSON.stringify(savedEmails)); } catch {}
  }

  /* ---- Format date in Arabic ---- */
  function formatDate(iso) {
    const d = new Date(iso);
    const days  = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    const months= ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                   'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    const day   = days[d.getDay()];
    const date  = d.getDate();
    const month = months[d.getMonth()];
    const hr    = d.getHours().toString().padStart(2,'0');
    const mn    = d.getMinutes().toString().padStart(2,'0');
    return `${day} ${date} ${month} — ${hr}:${mn}`;
  }

  /* ---- Build HTML ---- */
  function buildHTML() {
    const el = document.createElement('div');
    el.innerHTML = `
      <div id="wcp-overlay"></div>
      <div id="wcp-modal" role="dialog" aria-modal="true" aria-label="توقعات كأس العالم">
        <div class="wcp-inner">
          <div class="wcp-header">
            <div class="wcp-header-icon">⚽</div>
            <div class="wcp-header-text">
              <h2>تحدي التوقعات 🇸🇦</h2>
              <p>توقع واربح ${CFG.couponValue} خصم على طلبك</p>
            </div>
            <button class="wcp-close" id="wcp-close-btn" aria-label="إغلاق">✕</button>
          </div>
          <div class="wcp-body" id="wcp-body">
            <div id="wcp-loading" style="text-align:center;padding:32px;color:#9e9e98;font-size:13px;">
              جاري تحميل المباريات...
            </div>
          </div>
          <div class="wcp-footer">⚡ مدعوم بـ World Cup Predictor</div>
        </div>
      </div>
    `;
    document.body.appendChild(el.children[0]); // overlay
    document.body.appendChild(el.children[0]); // modal

    document.getElementById('wcp-close-btn').addEventListener('click', closeWidget);
    document.getElementById('wcp-overlay').addEventListener('click', closeWidget);
  }

  /* ---- Render match ---- */
  function renderMatch() {
    const body = document.getElementById('wcp-body');
    if (!body) return;

    if (matches.length === 0) {
      body.innerHTML = `
        <div style="text-align:center;padding:32px 20px;">
          <div style="font-size:40px;margin-bottom:12px;">🏆</div>
          <p style="color:#5a5a56;font-size:14px;line-height:1.6;">
            لا توجد مباريات خلال الـ 3 أيام القادمة.<br>ترقب المباريات القادمة!
          </p>
        </div>`;
      return;
    }

    const m      = matches[currentIdx];
    const pred   = predictions[m.id] || {};
    const alreadyVoted = !!savedEmails[m.id];
    const total  = matches.length;

    if (alreadyVoted) {
      renderAlready(m, body);
      return;
    }

    const stageMap = { group: 'دور المجموعات', r32: 'دور الـ 32', qf: 'ربع النهائي', sf: 'نصف النهائي', final: 'النهائي' };

    body.innerHTML = `
      <div class="wcp-match-nav">
        <button class="wcp-nav-btn" id="wcp-prev" ${currentIdx === 0 ? 'disabled' : ''}>&#8250;</button>
        <span class="wcp-match-counter">مباراة ${currentIdx + 1} من ${total}</span>
        <button class="wcp-nav-btn" id="wcp-next" ${currentIdx === total - 1 ? 'disabled' : ''}>&#8249;</button>
      </div>

      <div class="wcp-match-card">
        <div class="wcp-match-meta">
          <span class="wcp-match-date">${formatDate(m.match_date)} — ${m.venue || ''}</span>
          <span class="wcp-match-stage">${stageMap[m.stage] || m.stage}</span>
        </div>
        <div class="wcp-teams">
          <div class="wcp-team">
            <div class="wcp-team-flag">${m.home_flag || '🏳️'}</div>
            <div class="wcp-team-name">${m.home_team}</div>
          </div>
          <div class="wcp-vs">VS</div>
          <div class="wcp-team">
            <div class="wcp-team-flag">${m.away_flag || '🏳️'}</div>
            <div class="wcp-team-name">${m.away_team}</div>
          </div>
        </div>
      </div>

      <div class="wcp-predict-label">من سيفوز؟</div>
      <div class="wcp-predict-row">
        <button class="wcp-pred-btn ${pred.prediction === 'home' ? 'wcp-selected' : ''}"
          data-val="home">
          <span class="wcp-btn-flag">${m.home_flag || '🏳️'}</span>
          فوز ${m.home_team}
        </button>
        <button class="wcp-pred-btn ${pred.prediction === 'draw' ? 'wcp-selected' : ''}"
          data-val="draw">
          <span class="wcp-btn-flag">🤝</span>
          تعادل
        </button>
        <button class="wcp-pred-btn ${pred.prediction === 'away' ? 'wcp-selected' : ''}"
          data-val="away">
          <span class="wcp-btn-flag">${m.away_flag || '🏳️'}</span>
          فوز ${m.away_team}
        </button>
      </div>

      <div class="wcp-score-label">توقع النتيجة التفصيلية (اختياري +15 نقطة)</div>
      <div class="wcp-score-row">
        <div class="wcp-score-team">
          <div class="wcp-score-flag">${m.home_flag || '🏳️'}</div>
          <input class="wcp-score-input" type="number" id="wcp-hs" min="0" max="20"
            placeholder="0" value="${pred.home_score ?? ''}">
        </div>
        <div class="wcp-score-dash">—</div>
        <div class="wcp-score-team">
          <div class="wcp-score-flag">${m.away_flag || '🏳️'}</div>
          <input class="wcp-score-input" type="number" id="wcp-as" min="0" max="20"
            placeholder="0" value="${pred.away_score ?? ''}">
        </div>
      </div>

      <div class="wcp-points-hint">
        <div class="wcp-point-pill">
          <strong>+10</strong><span>فائز صح</span>
        </div>
        <div class="wcp-point-pill">
          <strong>+25</strong><span>نتيجة تفصيلية</span>
        </div>
        <div class="wcp-point-pill">
          <strong>${CFG.couponValue}</strong><span>جائزة الفائز</span>
        </div>
      </div>

      <div class="wcp-email-group">
        <label class="wcp-email-label" for="wcp-email">إيميلك لاستلام الجائزة</label>
        <input class="wcp-email-input" type="email" id="wcp-email"
          placeholder="example@email.com" autocomplete="email">
        <div class="wcp-error" id="wcp-err"></div>
      </div>

      <button class="wcp-submit" id="wcp-submit">
        <span>⚽</span> سجّل توقعي
      </button>
    `;

    /* Events */
    body.querySelectorAll('.wcp-pred-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        body.querySelectorAll('.wcp-pred-btn').forEach(b => b.classList.remove('wcp-selected'));
        btn.classList.add('wcp-selected');
        predictions[m.id] = { ...(predictions[m.id] || {}), prediction: btn.dataset.val };
      });
    });

    document.getElementById('wcp-hs')?.addEventListener('input', e => {
      predictions[m.id] = { ...(predictions[m.id] || {}), home_score: parseInt(e.target.value) || null };
    });
    document.getElementById('wcp-as')?.addEventListener('input', e => {
      predictions[m.id] = { ...(predictions[m.id] || {}), away_score: parseInt(e.target.value) || null };
    });

    document.getElementById('wcp-prev')?.addEventListener('click', () => { currentIdx--; renderMatch(); });
    document.getElementById('wcp-next')?.addEventListener('click', () => { currentIdx++; renderMatch(); });
    document.getElementById('wcp-submit')?.addEventListener('click', () => submitPrediction(m));
  }

  /* ---- Already voted state ---- */
  function renderAlready(m, body) {
    const pred = predictions[m.id] || {};
    const labelMap = { home: `فوز ${m.home_team}`, draw: 'تعادل', away: `فوز ${m.away_team}` };
    body.innerHTML = `
      <div class="wcp-already">
        <strong>✅ سجّلت توقعك!</strong>
        توقعك: ${labelMap[pred.prediction] || '—'}<br>
        سنرسل لك الجائزة إذا أصبت
        ${matches.length > 1 ? `<br><br><button class="wcp-submit" id="wcp-next-match" style="margin-top:12px;">
          مباراة أخرى ←
        </button>` : ''}
      </div>`;
    document.getElementById('wcp-next-match')?.addEventListener('click', () => {
      const next = matches.findIndex((x, i) => i > currentIdx && !savedEmails[x.id]);
      if (next > -1) { currentIdx = next; renderMatch(); }
    });
  }

  /* ---- Submit ---- */
  async function submitPrediction(m) {
    const pred    = predictions[m.id] || {};
    const email   = document.getElementById('wcp-email')?.value?.trim();
    const errEl   = document.getElementById('wcp-err');
    const btn     = document.getElementById('wcp-submit');

    /* Validate */
    if (!pred.prediction) {
      showErr(errEl, 'اختر أولاً من سيفوز'); return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showErr(errEl, 'أدخل إيميل صحيح'); return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> جاري الحفظ...';

    const payload = {
      match_id:   m.id,
      store_id:   CFG.storeId,
      email:      email,
      prediction: pred.prediction,
      home_score: pred.home_score ?? null,
      away_score: pred.away_score ?? null,
    };

    try {
      const res = await sbFetch('predictions', {
        method: 'POST',
        body: JSON.stringify(payload),
        prefer: 'return=minimal',
        returnJson: false,
      });

      if (res.status === 201 || res.status === 200) {
        saveLocal(m.id, email);
        predictions[m.id] = { ...pred, email };
        renderSuccess(m, pred, email);
      } else if (res.status === 409) {
        saveLocal(m.id, email);
        renderAlready(m, document.getElementById('wcp-body'));
      } else {
        showErr(errEl, 'حدث خطأ، حاول مرة ثانية');
        btn.disabled = false;
        btn.innerHTML = '<span>⚽</span> سجّل توقعي';
      }
    } catch {
      showErr(errEl, 'تحقق من اتصالك بالإنترنت');
      btn.disabled = false;
      btn.innerHTML = '<span>⚽</span> سجّل توقعي';
    }
  }

  /* ---- Success screen ---- */
  function renderSuccess(m, pred, email) {
    const body = document.getElementById('wcp-body');
    const pts  = (pred.home_score !== null && pred.away_score !== null) ? 25 : 10;
    body.innerHTML = `
      <div class="wcp-success">
        <span class="wcp-success-icon">🎉</span>
        <h3>تم تسجيل توقعك!</h3>
        <p>إذا أصبت، نرسل لك كود خصم <strong>${CFG.couponValue}</strong><br>على إيميل <strong>${email}</strong></p>
        <div class="wcp-success-pts">تستحق حتى ${pts} نقطة</div>
        <button class="wcp-submit" onclick="document.getElementById('wcp-modal').classList.remove('wcp-visible');document.getElementById('wcp-overlay').classList.remove('wcp-visible');">
          متابعة التسوق
        </button>
      </div>`;
  }

  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.add('wcp-show');
    setTimeout(() => el.classList.remove('wcp-show'), 3000);
  }

  /* ---- Open / Close ---- */
  function openWidget() {
    if (isOpen) return;
    isOpen = true;
    const modal   = document.getElementById('wcp-modal');
    const overlay = document.getElementById('wcp-overlay');
    if (modal) modal.classList.add('wcp-visible');
    if (overlay) overlay.classList.add('wcp-visible');
    document.body.style.overflow = 'hidden';
    renderMatch();
  }

  function closeWidget() {
    isOpen = false;
    const modal   = document.getElementById('wcp-modal');
    const overlay = document.getElementById('wcp-overlay');
    if (modal) modal.classList.remove('wcp-visible');
    if (overlay) overlay.classList.remove('wcp-visible');
    document.body.style.overflow = '';
  }

  /* ---- Floating trigger button ---- */
  function buildTrigger() {
    const btn = document.createElement('button');
    btn.id = 'wcp-trigger';
    btn.innerHTML = `<span class="wcp-trigger-icon">⚽</span> توقع واربح <span class="wcp-trigger-badge">جديد</span>`;
    btn.addEventListener('click', openWidget);
    document.body.appendChild(btn);
  }

  /* ---- Init ---- */
  async function init() {
    loadLocal();
    buildHTML();

    /* Load matches */
    const body = document.getElementById('wcp-body');
    await loadMatches();
    if (body) body.innerHTML = '';

    /* Restore predictions from local for already-voted matches */
    matches.forEach(m => {
      if (savedEmails[m.id]) {
        /* mark them but don't override */
      }
    });

    /* Skip to first non-voted match */
    const firstFresh = matches.findIndex(m => !savedEmails[m.id]);
    currentIdx = firstFresh === -1 ? 0 : firstFresh;

    if (CFG.trigger === 'auto') {
      setTimeout(openWidget, CFG.delaySeconds * 1000);
      buildTrigger();
    } else if (CFG.trigger === 'button') {
      buildTrigger();
    }
    /* trigger === 'manual': expose window.WCPWidget.open() only */

    /* Public API */
    window.WCPWidget = { open: openWidget, close: closeWidget };
  }

  /* ---- Boot ---- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
