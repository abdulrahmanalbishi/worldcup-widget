(function () {
  'use strict';

  var CFG = Object.assign({
    supabaseUrl:  '',
    supabaseKey:  '',
    storeId:      'default',
    trigger:      'auto',
    delaySeconds: 8,
    couponValue:  '10%',
  }, window.WCP_CONFIG || {});

  var matches     = [];
  var currentIdx  = 0;
  var predictions = {};
  var savedEmails = {};
  var isOpen      = false;
  var dataReady   = false;

  /* ---- Supabase ---- */
  async function sbFetch(path, opts) {
    opts = opts || {};
    var res = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, Object.assign({}, opts, {
      headers: Object.assign({
        'apikey':        CFG.supabaseKey,
        'Authorization': 'Bearer ' + CFG.supabaseKey,
        'Content-Type':  'application/json',
        'Prefer':        opts.prefer || 'return=minimal',
      }, opts.headers || {}),
    }));
    if (opts.returnJson === false) return res;
    try { return await res.json(); } catch { return null; }
  }

  async function loadMatches() {
    var now  = new Date().toISOString();
    var plus3= new Date(Date.now() + 3*24*60*60*1000).toISOString();
    var data = await sbFetch('matches?status=eq.upcoming&match_date=gte.'+now+'&match_date=lte.'+plus3+'&order=match_date.asc&limit=5');
    matches  = Array.isArray(data) ? data : [];
  }

  function loadLocal() {
    try { savedEmails = JSON.parse(localStorage.getItem('wcp_'+CFG.storeId)||'{}'); }
    catch(e) { savedEmails = {}; }
  }

  function saveLocal(id, email) {
    savedEmails[id] = email;
    try { localStorage.setItem('wcp_'+CFG.storeId, JSON.stringify(savedEmails)); } catch(e) {}
  }

  function formatDate(iso) {
    var d = new Date(iso);
    var days   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()]+' — '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
  }

  /* ---- Build DOM — كل شيء مخفي في البداية ---- */
  function buildHTML() {
    var overlay = document.createElement('div');
    overlay.id = 'wcp-overlay';
    /* مهم: pointer-events none دايماً حتى لما يكون مرئي — بس لما يكون active نشغّله */
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,14,0.55);z-index:99998;opacity:0;transition:opacity 0.25s;pointer-events:none;backdrop-filter:blur(2px);display:none;';
    overlay.addEventListener('click', closeWidget);
    document.body.appendChild(overlay);

    var modal = document.createElement('div');
    modal.id = 'wcp-modal';
    modal.setAttribute('role','dialog');
    modal.style.cssText = 'display:none;';
    modal.innerHTML =
      '<div class="wcp-inner">'+
        '<div class="wcp-header">'+
          '<div class="wcp-header-icon">⚽</div>'+
          '<div class="wcp-header-text"><h2>تحدي التوقعات 🇸🇦</h2><p>توقع واربح '+CFG.couponValue+' خصم على طلبك</p></div>'+
          '<button class="wcp-close" id="wcp-close-btn" aria-label="إغلاق">✕</button>'+
        '</div>'+
        '<div class="wcp-body" id="wcp-body"></div>'+
        '<div class="wcp-footer">⚡ مدعوم بـ World Cup Predictor</div>'+
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('wcp-close-btn').addEventListener('click', closeWidget);
  }

  /* ---- Open / Close ---- */
  function openWidget() {
    if (isOpen || !dataReady) return;
    isOpen = true;

    var overlay = document.getElementById('wcp-overlay');
    var modal   = document.getElementById('wcp-modal');

    overlay.style.display = 'block';
    modal.style.display   = 'block';

    /* أضف كلاس بعد frame عشان التراNSition يشتغل */
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        overlay.style.opacity       = '1';
        overlay.style.pointerEvents = 'auto';
        modal.classList.add('wcp-visible');
      });
    });

    document.body.style.overflow = 'hidden';
    renderMatch();
  }

  function closeWidget() {
    if (!isOpen) return;
    isOpen = false;

    var overlay = document.getElementById('wcp-overlay');
    var modal   = document.getElementById('wcp-modal');

    overlay.style.opacity       = '0';
    overlay.style.pointerEvents = 'none';
    modal.classList.remove('wcp-visible');

    setTimeout(function() {
      overlay.style.display = 'none';
      modal.style.display   = 'none';
    }, 300);

    document.body.style.overflow = '';
  }

  /* ---- Trigger button — يظهر فقط بعد تحميل البيانات ---- */
  function buildTrigger() {
    var btn = document.createElement('button');
    btn.id = 'wcp-trigger';
    btn.style.display = 'none'; /* مخفي حتى تجهز البيانات */
    btn.innerHTML = '<span class="wcp-trigger-icon">⚽</span> توقع واربح <span class="wcp-trigger-badge">جديد</span>';
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      openWidget();
    });
    document.body.appendChild(btn);
  }

  function showTrigger() {
    var btn = document.getElementById('wcp-trigger');
    if (btn) btn.style.display = 'flex';
  }

  /* ---- Render ---- */
  function renderMatch() {
    var body = document.getElementById('wcp-body');
    if (!body) return;

    if (!matches.length) {
      body.innerHTML = '<div style="text-align:center;padding:32px 20px;"><div style="font-size:40px;margin-bottom:12px;">🏆</div><p style="color:#5a5a56;font-size:14px;line-height:1.6;">لا توجد مباريات قادمة خلال 3 أيام.</p></div>';
      return;
    }

    var m     = matches[currentIdx];
    var pred  = predictions[m.id] || {};
    var total = matches.length;

    if (savedEmails[m.id]) { renderAlready(m, body); return; }

    var stages = {group:'دور المجموعات',r32:'دور الـ 32',qf:'ربع النهائي',sf:'نصف النهائي',final:'النهائي'};

    body.innerHTML =
      '<div class="wcp-match-nav">'+
        '<button class="wcp-nav-btn" id="wcp-prev"'+(currentIdx===0?' disabled':'')+'>&#8250;</button>'+
        '<span class="wcp-match-counter">مباراة '+(currentIdx+1)+' من '+total+'</span>'+
        '<button class="wcp-nav-btn" id="wcp-next"'+(currentIdx===total-1?' disabled':'')+'>&#8249;</button>'+
      '</div>'+
      '<div class="wcp-match-card">'+
        '<div class="wcp-match-meta">'+
          '<span class="wcp-match-date">'+formatDate(m.match_date)+' — '+(m.venue||'')+'</span>'+
          '<span class="wcp-match-stage">'+(stages[m.stage]||m.stage)+'</span>'+
        '</div>'+
        '<div class="wcp-teams">'+
          '<div class="wcp-team"><div class="wcp-team-flag">'+(m.home_flag||'🏳️')+'</div><div class="wcp-team-name">'+m.home_team+'</div></div>'+
          '<div class="wcp-vs">VS</div>'+
          '<div class="wcp-team"><div class="wcp-team-flag">'+(m.away_flag||'🏳️')+'</div><div class="wcp-team-name">'+m.away_team+'</div></div>'+
        '</div>'+
      '</div>'+
      '<div class="wcp-predict-label">من سيفوز؟</div>'+
      '<div class="wcp-predict-row">'+
        '<button class="wcp-pred-btn'+(pred.prediction==='home'?' wcp-selected':'')+'" data-val="home"><span class="wcp-btn-flag">'+(m.home_flag||'🏳️')+'</span>فوز '+m.home_team+'</button>'+
        '<button class="wcp-pred-btn'+(pred.prediction==='draw'?' wcp-selected':'')+'" data-val="draw"><span class="wcp-btn-flag">🤝</span>تعادل</button>'+
        '<button class="wcp-pred-btn'+(pred.prediction==='away'?' wcp-selected':'')+'" data-val="away"><span class="wcp-btn-flag">'+(m.away_flag||'🏳️')+'</span>فوز '+m.away_team+'</button>'+
      '</div>'+
      '<div class="wcp-score-label">توقع النتيجة التفصيلية (اختياري +15 نقطة)</div>'+
      '<div class="wcp-score-row">'+
        '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.home_flag||'🏳️')+'</div><input class="wcp-score-input" type="number" id="wcp-hs" min="0" max="20" placeholder="0"></div>'+
        '<div class="wcp-score-dash">—</div>'+
        '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.away_flag||'🏳️')+'</div><input class="wcp-score-input" type="number" id="wcp-as" min="0" max="20" placeholder="0"></div>'+
      '</div>'+
      '<div class="wcp-points-hint">'+
        '<div class="wcp-point-pill"><strong>+10</strong><span>فائز صح</span></div>'+
        '<div class="wcp-point-pill"><strong>+25</strong><span>نتيجة تفصيلية</span></div>'+
        '<div class="wcp-point-pill"><strong>'+CFG.couponValue+'</strong><span>جائزة الفائز</span></div>'+
      '</div>'+
      '<div class="wcp-email-group">'+
        '<label class="wcp-email-label" for="wcp-email">إيميلك لاستلام الجائزة</label>'+
        '<input class="wcp-email-input" type="email" id="wcp-email" placeholder="example@email.com">'+
        '<div class="wcp-error" id="wcp-err"></div>'+
      '</div>'+
      '<button class="wcp-submit" id="wcp-submit"><span>⚽</span> سجّل توقعي</button>';

    body.querySelectorAll('.wcp-pred-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        body.querySelectorAll('.wcp-pred-btn').forEach(function(b){ b.classList.remove('wcp-selected'); });
        btn.classList.add('wcp-selected');
        predictions[m.id] = Object.assign({}, predictions[m.id]||{}, {prediction: btn.dataset.val});
      });
    });

    var hs = document.getElementById('wcp-hs');
    var as = document.getElementById('wcp-as');
    if (hs) hs.addEventListener('input', function(e){ predictions[m.id] = Object.assign({}, predictions[m.id]||{}, {home_score: parseInt(e.target.value)||null}); });
    if (as) as.addEventListener('input', function(e){ predictions[m.id] = Object.assign({}, predictions[m.id]||{}, {away_score: parseInt(e.target.value)||null}); });

    var pv = document.getElementById('wcp-prev');
    var nx = document.getElementById('wcp-next');
    if (pv) pv.addEventListener('click', function(){ currentIdx--; renderMatch(); });
    if (nx) nx.addEventListener('click', function(){ currentIdx++; renderMatch(); });

    var sb = document.getElementById('wcp-submit');
    if (sb) sb.addEventListener('click', function(){ submitPrediction(m); });
  }

  function renderAlready(m, body) {
    var pred = predictions[m.id] || {};
    var lbl  = {home:'فوز '+m.home_team, draw:'تعادل', away:'فوز '+m.away_team};
    var next = matches.findIndex(function(x,i){ return i>currentIdx && !savedEmails[x.id]; });
    body.innerHTML =
      '<div class="wcp-already">'+
        '<strong>✅ سجّلت توقعك!</strong>'+
        'توقعك: '+(lbl[pred.prediction]||'—')+'<br>سنرسل لك الجائزة إذا أصبت'+
        (next>-1?'<br><br><button class="wcp-submit" id="wcp-nm" style="margin-top:12px;">مباراة أخرى ←</button>':'')+
      '</div>';
    var nb = document.getElementById('wcp-nm');
    if (nb) nb.addEventListener('click', function(){ currentIdx=next; renderMatch(); });
  }

  async function submitPrediction(m) {
    var pred  = predictions[m.id] || {};
    var email = (document.getElementById('wcp-email')||{}).value||'';
    email = email.trim();
    var errEl = document.getElementById('wcp-err');
    var btn   = document.getElementById('wcp-submit');

    if (!pred.prediction) { showErr(errEl,'اختر أولاً من سيفوز'); return; }
    if (!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr(errEl,'أدخل إيميل صحيح'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span>⏳</span> جاري الحفظ...';

    try {
      var res = await sbFetch('predictions', {
        method:'POST',
        body: JSON.stringify({match_id:m.id, store_id:CFG.storeId, email:email, prediction:pred.prediction, home_score:pred.home_score||null, away_score:pred.away_score||null}),
        prefer:'return=minimal',
        returnJson:false,
      });
      if (res.status===201||res.status===200) {
        saveLocal(m.id, email);
        renderSuccess(m, pred, email);
      } else if (res.status===409) {
        saveLocal(m.id, email);
        renderAlready(m, document.getElementById('wcp-body'));
      } else {
        showErr(errEl,'حدث خطأ، حاول مرة ثانية');
        btn.disabled=false; btn.innerHTML='<span>⚽</span> سجّل توقعي';
      }
    } catch(e) {
      showErr(errEl,'تحقق من اتصالك');
      btn.disabled=false; btn.innerHTML='<span>⚽</span> سجّل توقعي';
    }
  }

  function renderSuccess(m, pred, email) {
    var body = document.getElementById('wcp-body');
    var pts  = (pred.home_score!=null&&pred.away_score!=null)?25:10;
    body.innerHTML =
      '<div class="wcp-success">'+
        '<span class="wcp-success-icon">🎉</span>'+
        '<h3>تم تسجيل توقعك!</h3>'+
        '<p>إذا أصبت، نرسل لك كود خصم <strong>'+CFG.couponValue+'</strong><br>على إيميل <strong>'+email+'</strong></p>'+
        '<div class="wcp-success-pts">تستحق حتى '+pts+' نقطة</div>'+
        '<button class="wcp-submit" id="wcp-fin">متابعة التسوق</button>'+
      '</div>';
    var fb = document.getElementById('wcp-fin');
    if (fb) fb.addEventListener('click', closeWidget);
  }

  function showErr(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.add('wcp-show');
    setTimeout(function(){ el.classList.remove('wcp-show'); }, 3000);
  }

  /* ---- Init ---- */
  async function init() {
    loadLocal();
    buildHTML();
    buildTrigger();

    /* حمّل البيانات أولاً — بعدين أظهر الزر فقط */
    await loadMatches();

    var firstFresh = matches.findIndex(function(m){ return !savedEmails[m.id]; });
    currentIdx = firstFresh===-1 ? 0 : firstFresh;

    dataReady = true;
    showTrigger(); /* الزر يظهر فقط بعد ما البيانات جاهزة */

    if (CFG.trigger==='auto' && matches.length>0) {
      setTimeout(openWidget, CFG.delaySeconds*1000);
    }

    window.WCPWidget = { open: openWidget, close: closeWidget };
  }

  if (document.readyState==='loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
