(function () {
  'use strict';

  const CFG = Object.assign({
    supabaseUrl:  '',
    supabaseKey:  '',
    storeId:      'default',
    trigger:      'auto',
    delaySeconds: 8,
    couponValue:  '10%',
  }, window.WCP_CONFIG || {});

  let matches     = [];
  let currentIdx  = 0;
  let predictions = {};
  let savedEmails = {};
  let isOpen      = false;
  let isLoaded    = false;

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

  async function loadMatches() {
    const now   = new Date().toISOString();
    const plus3 = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const data  = await sbFetch(
      'matches?status=eq.upcoming&match_date=gte.' + now + '&match_date=lte.' + plus3 + '&order=match_date.asc&limit=5'
    );
    matches = Array.isArray(data) ? data : [];
    return matches;
  }

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

  function formatDate(iso) {
    const d = new Date(iso);
    const days   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' — ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  function buildHTML() {
    // Overlay — pointer-events none افتراضياً عشان ما يعطّل المتجر
    var overlay = document.createElement('div');
    overlay.id = 'wcp-overlay';
    overlay.style.pointerEvents = 'none';
    overlay.addEventListener('click', closeWidget);
    document.body.appendChild(overlay);

    // Modal
    var modal = document.createElement('div');
    modal.id = 'wcp-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="wcp-inner"><div class="wcp-header"><div class="wcp-header-icon">⚽</div><div class="wcp-header-text"><h2>تحدي التوقعات 🇸🇦</h2><p>توقع واربح ' + CFG.couponValue + ' خصم على طلبك</p></div><button class="wcp-close" id="wcp-close-btn" aria-label="إغلاق">✕</button></div><div class="wcp-body" id="wcp-body"><div style="text-align:center;padding:32px;color:#9e9e98;font-size:13px;">جاري تحميل المباريات...</div></div><div class="wcp-footer">⚡ مدعوم بـ World Cup Predictor</div></div>';
    document.body.appendChild(modal);

    document.getElementById('wcp-close-btn').addEventListener('click', closeWidget);
    isLoaded = true;
  }

  function renderMatch() {
    const body = document.getElementById('wcp-body');
    if (!body) return;

    if (matches.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:32px 20px;"><div style="font-size:40px;margin-bottom:12px;">🏆</div><p style="color:#5a5a56;font-size:14px;line-height:1.6;">لا توجد مباريات خلال الـ 3 أيام القادمة.<br>ترقب المباريات القادمة!</p></div>';
      return;
    }

    const m     = matches[currentIdx];
    const pred  = predictions[m.id] || {};
    const total = matches.length;

    if (savedEmails[m.id]) { renderAlready(m, body); return; }

    const stageMap = { group:'دور المجموعات', r32:'دور الـ 32', qf:'ربع النهائي', sf:'نصف النهائي', final:'النهائي' };

    body.innerHTML =
      '<div class="wcp-match-nav">' +
        '<button class="wcp-nav-btn" id="wcp-prev" ' + (currentIdx === 0 ? 'disabled' : '') + '>&#8250;</button>' +
        '<span class="wcp-match-counter">مباراة ' + (currentIdx+1) + ' من ' + total + '</span>' +
        '<button class="wcp-nav-btn" id="wcp-next" ' + (currentIdx === total-1 ? 'disabled' : '') + '>&#8249;</button>' +
      '</div>' +
      '<div class="wcp-match-card">' +
        '<div class="wcp-match-meta">' +
          '<span class="wcp-match-date">' + formatDate(m.match_date) + ' — ' + (m.venue||'') + '</span>' +
          '<span class="wcp-match-stage">' + (stageMap[m.stage]||m.stage) + '</span>' +
        '</div>' +
        '<div class="wcp-teams">' +
          '<div class="wcp-team"><div class="wcp-team-flag">' + (m.home_flag||'🏳️') + '</div><div class="wcp-team-name">' + m.home_team + '</div></div>' +
          '<div class="wcp-vs">VS</div>' +
          '<div class="wcp-team"><div class="wcp-team-flag">' + (m.away_flag||'🏳️') + '</div><div class="wcp-team-name">' + m.away_team + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="wcp-predict-label">من سيفوز؟</div>' +
      '<div class="wcp-predict-row">' +
        '<button class="wcp-pred-btn ' + (pred.prediction==='home'?'wcp-selected':'') + '" data-val="home"><span class="wcp-btn-flag">' + (m.home_flag||'🏳️') + '</span>فوز ' + m.home_team + '</button>' +
        '<button class="wcp-pred-btn ' + (pred.prediction==='draw'?'wcp-selected':'') + '" data-val="draw"><span class="wcp-btn-flag">🤝</span>تعادل</button>' +
        '<button class="wcp-pred-btn ' + (pred.prediction==='away'?'wcp-selected':'') + '" data-val="away"><span class="wcp-btn-flag">' + (m.away_flag||'🏳️') + '</span>فوز ' + m.away_team + '</button>' +
      '</div>' +
      '<div class="wcp-score-label">توقع النتيجة التفصيلية (اختياري +15 نقطة)</div>' +
      '<div class="wcp-score-row">' +
        '<div class="wcp-score-team"><div class="wcp-score-flag">' + (m.home_flag||'🏳️') + '</div><input class="wcp-score-input" type="number" id="wcp-hs" min="0" max="20" placeholder="0"></div>' +
        '<div class="wcp-score-dash">—</div>' +
        '<div class="wcp-score-team"><div class="wcp-score-flag">' + (m.away_flag||'🏳️') + '</div><input class="wcp-score-input" type="number" id="wcp-as" min="0" max="20" placeholder="0"></div>' +
      '</div>' +
      '<div class="wcp-points-hint">' +
        '<div class="wcp-point-pill"><strong>+10</strong><span>فائز صح</span></div>' +
        '<div class="wcp-point-pill"><strong>+25</strong><span>نتيجة تفصيلية</span></div>' +
        '<div class="wcp-point-pill"><strong>' + CFG.couponValue + '</strong><span>جائزة الفائز</span></div>' +
      '</div>' +
      '<div class="wcp-email-group">' +
        '<label class="wcp-email-label" for="wcp-email">إيميلك لاستلام الجائزة</label>' +
        '<input class="wcp-email-input" type="email" id="wcp-email" placeholder="example@email.com">' +
        '<div class="wcp-error" id="wcp-err"></div>' +
      '</div>' +
      '<button class="wcp-submit" id="wcp-submit"><span>⚽</span> سجّل توقعي</button>';

    body.querySelectorAll('.wcp-pred-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        body.querySelectorAll('.wcp-pred-btn').forEach(function(b){ b.classList.remove('wcp-selected'); });
        btn.classList.add('wcp-selected');
        predictions[m.id] = Object.assign({}, predictions[m.id]||{}, { prediction: btn.dataset.val });
      });
    });

    var hsEl = document.getElementById('wcp-hs');
    var asEl = document.getElementById('wcp-as');
    if (hsEl) hsEl.addEventListener('input', function(e){ predictions[m.id] = Object.assign({}, predictions[m.id]||{}, { home_score: parseInt(e.target.value)||null }); });
    if (asEl) asEl.addEventListener('input', function(e){ predictions[m.id] = Object.assign({}, predictions[m.id]||{}, { away_score: parseInt(e.target.value)||null }); });

    var prevBtn = document.getElementById('wcp-prev');
    var nextBtn = document.getElementById('wcp-next');
    if (prevBtn) prevBtn.addEventListener('click', function(){ currentIdx--; renderMatch(); });
    if (nextBtn) nextBtn.addEventListener('click', function(){ currentIdx++; renderMatch(); });

    var submitBtn = document.getElementById('wcp-submit');
    if (submitBtn) submitBtn.addEventListener('click', function(){ submitPrediction(m); });
  }

  function renderAlready(m, body) {
    var pred = predictions[m.id] || {};
    var labelMap = { home: 'فوز '+m.home_team, draw: 'تعادل', away: 'فوز '+m.away_team };
    var nextUnvoted = matches.findIndex(function(x,i){ return i > currentIdx && !savedEmails[x.id]; });
    body.innerHTML =
      '<div class="wcp-already">' +
        '<strong>✅ سجّلت توقعك!</strong>' +
        'توقعك: ' + (labelMap[pred.prediction]||'—') + '<br>سنرسل لك الجائزة إذا أصبت' +
        (nextUnvoted > -1 ? '<br><br><button class="wcp-submit" id="wcp-next-match" style="margin-top:12px;">مباراة أخرى ←</button>' : '') +
      '</div>';
    var nb = document.getElementById('wcp-next-match');
    if (nb) nb.addEventListener('click', function(){ currentIdx = nextUnvoted; renderMatch(); });
  }

  async function submitPrediction(m) {
    var pred   = predictions[m.id] || {};
    var email  = (document.getElementById('wcp-email')||{}).value;
    if (email) email = email.trim();
    var errEl  = document.getElementById('wcp-err');
    var btn    = document.getElementById('wcp-submit');

    if (!pred.prediction) { showErr(errEl, 'اختر أولاً من سيفوز'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(errEl, 'أدخل إيميل صحيح'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> جاري الحفظ...';

    try {
      var res = await sbFetch('predictions', {
        method: 'POST',
        body: JSON.stringify({ match_id: m.id, store_id: CFG.storeId, email: email, prediction: pred.prediction, home_score: pred.home_score||null, away_score: pred.away_score||null }),
        prefer: 'return=minimal',
        returnJson: false,
      });

      if (res.status === 201 || res.status === 200) {
        saveLocal(m.id, email);
        predictions[m.id] = Object.assign({}, pred, { email: email });
        renderSuccess(m, pred, email);
      } else if (res.status === 409) {
        saveLocal(m.id, email);
        renderAlready(m, document.getElementById('wcp-body'));
      } else {
        showErr(errEl, 'حدث خطأ، حاول مرة ثانية');
        btn.disabled = false;
        btn.innerHTML = '<span>⚽</span> سجّل توقعي';
      }
    } catch(e) {
      showErr(errEl, 'تحقق من اتصالك بالإنترنت');
      btn.disabled = false;
      btn.innerHTML = '<span>⚽</span> سجّل توقعي';
    }
  }

  function renderSuccess(m, pred, email) {
    var body = document.getElementById('wcp-body');
    var pts  = (pred.home_score !== null && pred.away_score !== null) ? 25 : 10;
    body.innerHTML =
      '<div class="wcp-success">' +
        '<span class="wcp-success-icon">🎉</span>' +
        '<h3>تم تسجيل توقعك!</h3>' +
        '<p>إذا أصبت، نرسل لك كود خصم <strong>' + CFG.couponValue + '</strong><br>على إيميل <strong>' + email + '</strong></p>' +
        '<div class="wcp-success-pts">تستحق حتى ' + pts + ' نقطة</div>' +
        '<button class="wcp-submit" id="wcp-finish">متابعة التسوق</button>' +
      '</div>';
    var fb = document.getElementById('wcp-finish');
    if (fb) fb.addEventListener('click', closeWidget);
  }

  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.add('wcp-show');
    setTimeout(function(){ el.classList.remove('wcp-show'); }, 3000);
  }

  function openWidget() {
    if (!isLoaded) return;
    if (isOpen) return;
    isOpen = true;
    var modal   = document.getElementById('wcp-modal');
    var overlay = document.getElementById('wcp-overlay');
    if (modal)   modal.classList.add('wcp-visible');
    if (overlay) {
      overlay.classList.add('wcp-visible');
      overlay.style.pointerEvents = 'auto'; // فقط لما البوب أب مفتوح
    }
    document.body.style.overflow = 'hidden';
    renderMatch();
  }

  function closeWidget() {
    isOpen = false;
    var modal   = document.getElementById('wcp-modal');
    var overlay = document.getElementById('wcp-overlay');
    if (modal)   modal.classList.remove('wcp-visible');
    if (overlay) {
      overlay.classList.remove('wcp-visible');
      overlay.style.pointerEvents = 'none'; // يرجع لا يعطّل المتجر
    }
    document.body.style.overflow = '';
  }

  function buildTrigger() {
    var btn = document.createElement('button');
    btn.id = 'wcp-trigger';
    btn.innerHTML = '<span class="wcp-trigger-icon">⚽</span> توقع واربح <span class="wcp-trigger-badge">جديد</span>';
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      openWidget();
    });
    document.body.appendChild(btn);
  }

  async function init() {
    loadLocal();
    buildHTML();
    buildTrigger();
    await loadMatches();
    var firstFresh = matches.findIndex(function(m){ return !savedEmails[m.id]; });
    currentIdx = firstFresh === -1 ? 0 : firstFresh;

    if (CFG.trigger === 'auto') {
      setTimeout(openWidget, CFG.delaySeconds * 1000);
    }

    window.WCPWidget = { open: openWidget, close: closeWidget };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
