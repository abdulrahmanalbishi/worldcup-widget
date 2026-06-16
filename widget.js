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

  var matches      = [];
  var currentIdx   = 0;
  var predictions  = {};
  var savedPhones  = {};
  var userPhone    = '';
  var userName     = '';
  var userTeam     = '';
  var isOpen       = false;
  var dataReady    = false;
  var activeTab    = 'predict'; // predict | account
  var countdownTimer = null;

  var TEAMS = [
    {name:'السعودية',flag:'🇸🇦'},{name:'الأرجنتين',flag:'🇦🇷'},
    {name:'فرنسا',flag:'🇫🇷'},{name:'البرازيل',flag:'🇧🇷'},
    {name:'إنجلترا',flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿'},{name:'إسبانيا',flag:'🇪🇸'},
    {name:'ألمانيا',flag:'🇩🇪'},{name:'البرتغال',flag:'🇵🇹'},
    {name:'المغرب',flag:'🇲🇦'},{name:'مصر',flag:'🇪🇬'},
    {name:'اليابان',flag:'🇯🇵'},{name:'المكسيك',flag:'🇲🇽'},
  ];

  /* ---- Supabase ---- */
  async function sbFetch(path, opts) {
    opts = opts || {};
    var res = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, Object.assign({}, opts, {
      headers: Object.assign({
        'apikey': CFG.supabaseKey,
        'Authorization': 'Bearer ' + CFG.supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': opts.prefer || 'return=minimal',
      }, opts.headers || {}),
    }));
    if (opts.returnJson === false) return res;
    try { return await res.json(); } catch(e) { return null; }
  }

  async function loadMatches() {
    var now  = new Date().toISOString();
    var plus3= new Date(Date.now() + 3*24*60*60*1000).toISOString();
    var data = await sbFetch('matches?status=eq.upcoming&match_date=gte.'+now+'&match_date=lte.'+plus3+'&order=match_date.asc&limit=15');
    matches  = Array.isArray(data) ? data : [];
    if (userTeam) sortByFavorite();
  }

  async function loadUserPredictions() {
    if (!userPhone) return [];
    var data = await sbFetch('predictions?store_id=eq.'+CFG.storeId+'&phone=eq.'+userPhone+'&order=created_at.desc&limit=50');
    return Array.isArray(data) ? data : [];
  }

  function sortByFavorite() {
    matches.sort(function(a,b){
      var af = a.home_team===userTeam||a.away_team===userTeam?0:1;
      var bf = b.home_team===userTeam||b.away_team===userTeam?0:1;
      return af-bf;
    });
  }

  function loadLocal() {
    try {
      savedPhones = JSON.parse(localStorage.getItem('wcp_phones_'+CFG.storeId)||'{}');
      userPhone   = localStorage.getItem('wcp_phone_'+CFG.storeId)||'';
      userName    = localStorage.getItem('wcp_name_'+CFG.storeId)||'';
      userTeam    = localStorage.getItem('wcp_team_'+CFG.storeId)||'';
    } catch(e) { savedPhones={}; }
  }

  function saveProfile(phone, name, team) {
    userPhone = phone; userName = name; userTeam = team;
    try {
      localStorage.setItem('wcp_phone_'+CFG.storeId, phone);
      localStorage.setItem('wcp_name_'+CFG.storeId, name);
      localStorage.setItem('wcp_team_'+CFG.storeId, team);
    } catch(e) {}
  }

  function saveLocal(matchId, phone) {
    savedPhones[matchId] = phone;
    try { localStorage.setItem('wcp_phones_'+CFG.storeId, JSON.stringify(savedPhones)); } catch(e) {}
  }

  function wasDismissedToday() {
    try { return localStorage.getItem('wcp_dismissed_'+CFG.storeId)===new Date().toDateString(); }
    catch(e) { return false; }
  }

  function formatDate(iso) {
    var d=new Date(iso);
    var days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()]+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
  }

  function getCountdown(iso) {
    var diff = new Date(iso)-new Date();
    if (diff<=0) return null;
    var h=Math.floor(diff/3600000), m=Math.floor((diff%3600000)/60000), s=Math.floor((diff%60000)/1000);
    if (h>=24) return Math.floor(h/24)+' يوم '+Math.floor(h%24)+' ساعة';
    return ('0'+h).slice(-2)+':'+('0'+m).slice(-2)+':'+('0'+s).slice(-2);
  }

  function startCountdown(iso) {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(function(){
      var el=document.getElementById('wcp-countdown');
      if (!el) { clearInterval(countdownTimer); return; }
      var cd=getCountdown(iso);
      if (!cd) { el.textContent='🔴 بدأت المباراة — التوقع مغلق'; el.style.background='#fdf0ee'; el.style.color='#c0392b'; clearInterval(countdownTimer); }
      else el.textContent='⏱ يغلق التوقع خلال: '+cd;
    }, 1000);
  }

  function isMatchLocked(iso) { return new Date(iso)<=new Date(); }

  /* ---- Build DOM ---- */
  function buildHTML() {
    var overlay=document.createElement('div');
    overlay.id='wcp-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(10,20,14,0.55);z-index:99998;opacity:0;transition:opacity 0.25s;pointer-events:none;display:none;backdrop-filter:blur(2px);';
    overlay.addEventListener('click', closeWidget);
    document.body.appendChild(overlay);

    var modal=document.createElement('div');
    modal.id='wcp-modal';
    modal.style.cssText='display:none;pointer-events:none;';
    modal.innerHTML=
      '<div class="wcp-inner">'+
        '<div class="wcp-header">'+
          '<div class="wcp-header-icon">⚽</div>'+
          '<div class="wcp-header-text"><h2>تحدي التوقعات 🇸🇦</h2><p>توقع واربح '+CFG.couponValue+' خصم</p></div>'+
          '<button class="wcp-close" id="wcp-close-btn" aria-label="إغلاق">✕</button>'+
        '</div>'+
        /* التابات */
        '<div class="wcp-tabs" id="wcp-tabs" style="display:none;">'+
          '<button class="wcp-tab wcp-tab-active" id="tab-predict" onclick="window._wcpTab(\'predict\')">⚽ التوقعات</button>'+
          '<button class="wcp-tab" id="tab-account" onclick="window._wcpTab(\'account\')">👤 حسابي</button>'+
        '</div>'+
        '<div class="wcp-body" id="wcp-body"></div>'+
        '<div class="wcp-footer">⚡ مدعوم بـ World Cup Predictor</div>'+
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('wcp-close-btn').addEventListener('click', closeWidget);

    window._wcpTab = function(tab) {
      activeTab = tab;
      document.getElementById('tab-predict').className = 'wcp-tab'+(tab==='predict'?' wcp-tab-active':'');
      document.getElementById('tab-account').className = 'wcp-tab'+(tab==='account'?' wcp-tab-active':'');
      if (tab==='predict') { var f=matches.findIndex(function(m){return !savedPhones[m.id];}); currentIdx=f===-1?0:f; renderMatch(); }
      else renderAccount();
    };
  }

  /* ---- Open / Close ---- */
  function openWidget() {
    if (isOpen||!dataReady) return;
    isOpen=true;
    var overlay=document.getElementById('wcp-overlay');
    var modal=document.getElementById('wcp-modal');
    overlay.style.display='block';
    modal.style.display='block';
    modal.style.pointerEvents='auto';
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      overlay.style.opacity='1'; overlay.style.pointerEvents='auto';
      modal.classList.add('wcp-visible');
    });});
    document.body.style.overflow='hidden';
    if (!userPhone) renderRegisterStep();
    else {
      document.getElementById('wcp-tabs').style.display='flex';
      var f=matches.findIndex(function(m){return !savedPhones[m.id];}); currentIdx=f===-1?0:f;
      renderMatch();
    }
  }

  function closeWidget() {
    if (!isOpen) return;
    isOpen=false;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer=null; }
    try { localStorage.setItem('wcp_dismissed_'+CFG.storeId,new Date().toDateString()); } catch(e){}
    var overlay=document.getElementById('wcp-overlay');
    var modal=document.getElementById('wcp-modal');
    overlay.style.opacity='0'; overlay.style.pointerEvents='none';
    modal.classList.remove('wcp-visible'); modal.style.pointerEvents='none';
    setTimeout(function(){ overlay.style.display='none'; modal.style.display='none'; },300);
    document.body.style.overflow='';
  }

  /* ---- Step 1: تسجيل (اسم + جوال + فريق) ---- */
  function renderRegisterStep() {
    document.getElementById('wcp-tabs').style.display='none';
    var body=document.getElementById('wcp-body');

    var teamBtns=TEAMS.map(function(t){
      return '<button type="button" class="wcp-team-btn" data-name="'+t.name+'" onclick="window._wcpPickTeam(this)">'+
        '<span style="font-size:20px;display:block;line-height:1;">'+t.flag+'</span>'+
        '<span style="font-size:10px;margin-top:3px;display:block;">'+t.name+'</span>'+
      '</button>';
    }).join('');

    body.innerHTML=
      '<div style="font-size:13px;font-weight:600;color:#1a1a18;margin-bottom:10px;">سجّل للمشاركة</div>'+

      '<div class="wcp-email-group">'+
        '<label class="wcp-email-label">اسمك</label>'+
        '<input class="wcp-email-input" type="text" id="wcp-name" placeholder="مثال: محمد العتيبي" value="'+userName+'">'+
      '</div>'+

      '<div class="wcp-email-group">'+
        '<label class="wcp-email-label">رقم جوالك</label>'+
        '<input class="wcp-email-input" type="tel" id="wcp-phone" placeholder="05XXXXXXXX" value="'+userPhone+'" style="direction:ltr;text-align:right;">'+
      '</div>'+

      '<div style="font-size:12px;font-weight:500;color:#5a5a56;margin:12px 0 8px;">فريقك المفضل (اختياري)</div>'+
      '<div id="wcp-teams-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px;">'+teamBtns+'</div>'+

      '<div class="wcp-error" id="wcp-err" style="margin-bottom:8px;"></div>'+
      '<button type="button" class="wcp-submit" id="wcp-reg-btn" onclick="window._wcpRegister()">⚽ ابدأ التوقع</button>';

    /* تحديد الفريق المحفوظ */
    if (userTeam) {
      var btns=body.querySelectorAll('.wcp-team-btn');
      btns.forEach(function(b){ if(b.dataset.name===userTeam) b.classList.add('wcp-team-sel'); });
    }

    window._wcpPickTeam = function(btn) {
      body.querySelectorAll('.wcp-team-btn').forEach(function(b){ b.classList.remove('wcp-team-sel'); });
      btn.classList.add('wcp-team-sel');
      userTeam = btn.dataset.name;
    };

    window._wcpRegister = function() {
      var name  = (document.getElementById('wcp-name')||{}).value||''; name=name.trim();
      var phone = (document.getElementById('wcp-phone')||{}).value||''; phone=phone.trim();
      var err   = document.getElementById('wcp-err');
      if (!name) { showErr(err,'أدخل اسمك'); return; }
      if (!phone||!/^05\d{8}$/.test(phone)) { showErr(err,'أدخل رقم جوال صحيح (05XXXXXXXX)'); return; }
      saveProfile(phone, name, userTeam);
      if (userTeam) sortByFavorite();
      document.getElementById('wcp-tabs').style.display='flex';
      var f=matches.findIndex(function(m){return !savedPhones[m.id];}); currentIdx=f===-1?0:f;
      renderMatch();
    };
  }

  /* ---- Tab: التوقعات ---- */
  function renderMatch() {
    activeTab='predict';
    document.getElementById('tab-predict').className='wcp-tab wcp-tab-active';
    document.getElementById('tab-account').className='wcp-tab';
    var body=document.getElementById('wcp-body');
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer=null; }

    if (!matches.length) {
      body.innerHTML='<div style="text-align:center;padding:32px;"><div style="font-size:40px;">🏆</div><p style="color:#5a5a56;font-size:14px;margin-top:12px;">لا توجد مباريات خلال 3 أيام القادمة</p></div>';
      return;
    }

    var m=matches[currentIdx], pred=predictions[m.id]||{}, total=matches.length;
    var locked=isMatchLocked(m.match_date);
    if (savedPhones[m.id]) { renderAlready(m,body); return; }

    var stages={group:'دور المجموعات',r32:'دور الـ 32',qf:'ربع النهائي',sf:'نصف النهائي',final:'النهائي'};
    var cd=getCountdown(m.match_date);

    body.innerHTML=
      '<div class="wcp-match-nav">'+
        '<button class="wcp-nav-btn" id="wcp-prev"'+(currentIdx===0?' disabled':'')+' onclick="window._wcpNav(-1)">&#8250;</button>'+
        '<span class="wcp-match-counter">مباراة '+(currentIdx+1)+' من '+total+'</span>'+
        '<button class="wcp-nav-btn" id="wcp-next"'+(currentIdx===total-1?' disabled':'')+' onclick="window._wcpNav(1)">&#8249;</button>'+
      '</div>'+
      '<div class="wcp-match-card">'+
        '<div class="wcp-match-meta">'+
          '<span class="wcp-match-date">'+formatDate(m.match_date)+'</span>'+
          '<span class="wcp-match-stage">'+(stages[m.stage]||m.stage)+'</span>'+
        '</div>'+
        '<div style="font-size:10px;color:#9e9e98;text-align:center;margin-bottom:8px;">📍 '+(m.venue||'')+'</div>'+
        '<div class="wcp-teams">'+
          '<div class="wcp-team"><div class="wcp-team-flag">'+(m.home_flag||'🏳️')+'</div><div class="wcp-team-name">'+m.home_team+'</div></div>'+
          '<div class="wcp-vs">VS</div>'+
          '<div class="wcp-team"><div class="wcp-team-flag">'+(m.away_flag||'🏳️')+'</div><div class="wcp-team-name">'+m.away_team+'</div></div>'+
        '</div>'+
      '</div>'+
      '<div id="wcp-countdown" style="text-align:center;font-size:12px;font-weight:600;color:'+(locked?'#c0392b':'#0a4f2e')+';background:'+(locked?'#fdf0ee':'#e8f5ef')+';border-radius:8px;padding:8px;margin-bottom:12px;">'+
        (locked?'🔴 بدأت المباراة — التوقع مغلق':(cd?'⏱ يغلق التوقع خلال: '+cd:''))+
      '</div>'+
      (locked?'<div style="text-align:center;padding:8px;color:#5a5a56;font-size:13px;">انتهى وقت التوقع</div>' :
        '<div class="wcp-predict-label">من سيفوز؟</div>'+
        '<div class="wcp-predict-row">'+
          '<button type="button" class="wcp-pred-btn'+(pred.prediction==='home'?' wcp-selected':'')+'" onclick="window._wcpPick(\''+m.id+'\',\'home\',this)"><span class="wcp-btn-flag">'+(m.home_flag||'🏳️')+'</span>فوز '+m.home_team+'</button>'+
          '<button type="button" class="wcp-pred-btn'+(pred.prediction==='draw'?' wcp-selected':'')+'" onclick="window._wcpPick(\''+m.id+'\',\'draw\',this)"><span class="wcp-btn-flag">🤝</span>تعادل</button>'+
          '<button type="button" class="wcp-pred-btn'+(pred.prediction==='away'?' wcp-selected':'')+'" onclick="window._wcpPick(\''+m.id+'\',\'away\',this)"><span class="wcp-btn-flag">'+(m.away_flag||'🏳️')+'</span>فوز '+m.away_team+'</button>'+
        '</div>'+
        '<div class="wcp-score-label">توقع النتيجة التفصيلية (اختياري +15 نقطة)</div>'+
        '<div class="wcp-score-row">'+
          '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.home_flag||'🏳️')+'</div>'+
          '<input class="wcp-score-input" type="number" id="wcp-hs" min="0" max="20" placeholder="0" value="'+(pred.home_score!=null?pred.home_score:'')+'" oninput="window._wcpScore(\''+m.id+'\',\'h\',this.value)"></div>'+
          '<div class="wcp-score-dash">—</div>'+
          '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.away_flag||'🏳️')+'</div>'+
          '<input class="wcp-score-input" type="number" id="wcp-as" min="0" max="20" placeholder="0" value="'+(pred.away_score!=null?pred.away_score:'')+'" oninput="window._wcpScore(\''+m.id+'\',\'a\',this.value)"></div>'+
        '</div>'+
        '<div id="wcp-score-err" style="font-size:11px;color:#c0392b;text-align:center;margin-bottom:8px;display:none;"></div>'+
        '<div class="wcp-points-hint">'+
          '<div class="wcp-point-pill"><strong>+10</strong><span>فائز صح</span></div>'+
          '<div class="wcp-point-pill"><strong>+25</strong><span>نتيجة تفصيلية</span></div>'+
          '<div class="wcp-point-pill"><strong>'+CFG.couponValue+'</strong><span>جائزة</span></div>'+
        '</div>'+
        '<button type="button" class="wcp-submit" onclick="window._wcpSubmit()"><span>⚽</span> سجّل توقعي</button>'
      );

    if (!locked && cd) startCountdown(m.match_date);

    window._wcpNav = function(dir) { currentIdx+=dir; renderMatch(); };

    window._wcpPick = function(matchId, val, btn) {
      document.querySelectorAll('#wcp-body .wcp-pred-btn').forEach(function(b){ b.classList.remove('wcp-selected'); });
      btn.classList.add('wcp-selected');
      predictions[matchId] = Object.assign({}, predictions[matchId]||{}, {prediction:val});
      var err=document.getElementById('wcp-score-err'); if(err) err.style.display='none';
    };

    window._wcpScore = function(matchId, side, val) {
      var key = side==='h'?'home_score':'away_score';
      predictions[matchId] = Object.assign({}, predictions[matchId]||{}, {});
      predictions[matchId][key] = parseInt(val)||null;
      validateScores(matchId);
    };

    window._wcpSubmit = function() {
      if (!validateScores(m.id)) return;
      submitPrediction(m);
    };
  }

  function validateScores(matchId) {
    var pred=predictions[matchId]||{};
    var winner=pred.prediction;
    var hs=pred.home_score||0, as=pred.away_score||0;
    var err=document.getElementById('wcp-score-err');
    if (!winner||(!hs&&!as)) { if(err)err.style.display='none'; return true; }
    var conflict = (winner==='home'&&hs<=as)||(winner==='away'&&as<=hs)||(winner==='draw'&&hs!==as);
    if (conflict&&err) {
      err.textContent='⚠️ '+(winner==='draw'?'التعادل يعني النتيجتين متساويتين':'النتيجة لا تتوافق مع اختيارك');
      err.style.display='block'; return false;
    }
    if(err)err.style.display='none'; return true;
  }

  function renderAlready(m,body){
    var pred=predictions[m.id]||{};
    var lbl={home:'فوز '+m.home_team,draw:'تعادل',away:'فوز '+m.away_team};
    var next=matches.findIndex(function(x,i){return i>currentIdx&&!savedPhones[x.id];});
    body.innerHTML=
      '<div class="wcp-already">'+
        '<strong>✅ سجّلت توقعك!</strong>'+
        'توقعك: '+(lbl[pred.prediction]||'—')+'<br>سنرسل لك الجائزة إذا أصبت على '+userPhone+
        (next>-1?'<br><br><button type="button" class="wcp-submit" onclick="window._wcpNextMatch('+next+')" style="margin-top:12px;">مباراة أخرى ←</button>':'')+
      '</div>';
    window._wcpNextMatch=function(idx){currentIdx=idx;renderMatch();};
  }

  async function submitPrediction(m){
    var pred=predictions[m.id]||{};
    var btn=document.querySelector('#wcp-body .wcp-submit');
    var err=document.getElementById('wcp-score-err');
    if (!pred.prediction) { if(err){err.textContent='اختر أولاً من سيفوز';err.style.display='block';} return; }
    if (isMatchLocked(m.match_date)) { if(err){err.textContent='انتهى وقت التوقع';err.style.display='block';} return; }
    if(btn){btn.disabled=true;btn.innerHTML='<span>⏳</span> جاري الحفظ...';}
    try {
      var res=await sbFetch('predictions',{
        method:'POST',
        body:JSON.stringify({match_id:m.id,store_id:CFG.storeId,email:userPhone+'@phone.local',phone:userPhone,prediction:pred.prediction,home_score:pred.home_score||null,away_score:pred.away_score||null,favorite_team:userTeam||null}),
        prefer:'return=minimal',returnJson:false,
      });
      if(res.status===201||res.status===200){saveLocal(m.id,userPhone);renderAlready(m,document.getElementById('wcp-body'));}
      else if(res.status===409){saveLocal(m.id,userPhone);renderAlready(m,document.getElementById('wcp-body'));}
      else{if(btn){btn.disabled=false;btn.innerHTML='<span>⚽</span> سجّل توقعي';}if(err){err.textContent='حدث خطأ';err.style.display='block';}}
    }catch(e){if(btn){btn.disabled=false;btn.innerHTML='<span>⚽</span> سجّل توقعي';}}
  }

  /* ---- Tab: حسابي ---- */
  async function renderAccount() {
    activeTab='account';
    document.getElementById('tab-predict').className='wcp-tab';
    document.getElementById('tab-account').className='wcp-tab wcp-tab-active';
    var body=document.getElementById('wcp-body');
    body.innerHTML='<div style="text-align:center;padding:24px;color:#9e9e98;font-size:13px;">⏳ جاري تحميل بياناتك...</div>';

    var preds = await loadUserPredictions();
    var total = preds.length;
    var correct = preds.filter(function(p){return p.points>0;}).length;
    var totalPts = preds.reduce(function(s,p){return s+(p.points||0);},0);
    var coupons = preds.filter(function(p){return p.coupon_sent;}).length;
    var teamFlag = TEAMS.find(function(t){return t.name===userTeam;})||{};

    var historyRows = preds.slice(0,10).map(function(p){
      var lbl={home:'🏠 فوز مضيف',draw:'🤝 تعادل',away:'✈️ فوز ضيف'};
      var status = p.points>0?'✅ صح':p.points===0&&p.points!==null?'❌ خطأ':'⏳ انتظار';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid #e8e8e4;font-size:12px;">'+
        '<div>'+
          '<div style="font-weight:500;color:#1a1a18;">'+p.match_id.replace(/_2026/,'').replace(/_/,' vs ').toUpperCase()+'</div>'+
          '<div style="color:#9e9e98;font-size:10px;margin-top:2px;">'+(lbl[p.prediction]||p.prediction)+'</div>'+
        '</div>'+
        '<div style="text-align:left;">'+
          '<div>'+status+'</div>'+
          (p.points>0?'<div style="color:#0a4f2e;font-size:10px;font-weight:600;">+'+p.points+' نقطة</div>':'')+
        '</div>'+
      '</div>';
    }).join('');

    body.innerHTML=
      /* بطاقة الملف الشخصي */
      '<div style="background:linear-gradient(135deg,#0a4f2e,#0f6b3e);border-radius:12px;padding:16px;margin-bottom:14px;color:white;">'+
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'+
          '<div style="width:44px;height:44px;background:rgba(255,255,255,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;">'+(teamFlag.flag||'👤')+'</div>'+
          '<div>'+
            '<div style="font-size:15px;font-weight:700;">'+(userName||'مجهول')+'</div>'+
            '<div style="font-size:11px;opacity:0.7;">'+(userTeam?'فريقك المفضل: '+userTeam:'لم تختر فريقاً')+'</div>'+
          '</div>'+
          '<button type="button" onclick="window._wcpEditProfile()" style="margin-right:auto;background:rgba(255,255,255,0.15);border:none;border-radius:6px;color:white;font-size:11px;padding:4px 8px;cursor:pointer;font-family:inherit;">تعديل</button>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;">'+
          '<div><div style="font-size:20px;font-weight:700;">'+totalPts+'</div><div style="font-size:10px;opacity:0.7;">نقطة</div></div>'+
          '<div><div style="font-size:20px;font-weight:700;">'+total+'</div><div style="font-size:10px;opacity:0.7;">توقع</div></div>'+
          '<div><div style="font-size:20px;font-weight:700;">'+correct+'</div><div style="font-size:10px;opacity:0.7;">صح</div></div>'+
          '<div><div style="font-size:20px;font-weight:700;">'+coupons+'</div><div style="font-size:10px;opacity:0.7;">جائزة</div></div>'+
        '</div>'+
      '</div>'+
      /* الجوائز */
      (totalPts>=50?
        '<div style="background:#fdf6e3;border:1px solid rgba(201,168,76,0.3);border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;">'+
          '🏆 مبروك! تستحق جائزة بـ '+CFG.couponValue+' خصم. سنرسلها على جوالك '+userPhone+
        '</div>':
        '<div style="background:#e8f5ef;border-radius:10px;padding:12px;margin-bottom:12px;font-size:12px;color:#0a4f2e;">'+
          '🎯 تحتاج '+(50-totalPts)+' نقطة للحصول على كوبون '+CFG.couponValue+' خصم'+
        '</div>'
      )+
      /* سجل التوقعات */
      (total>0?
        '<div style="font-size:13px;font-weight:600;color:#1a1a18;margin-bottom:8px;">آخر توقعاتك</div>'+
        historyRows
      :'<div style="text-align:center;padding:20px;color:#9e9e98;font-size:13px;">ما توقعت بعد — ابدأ الآن!</div>'
      );

    window._wcpEditProfile = function() {
      renderRegisterStep();
      document.getElementById('wcp-tabs').style.display='none';
    };
  }

  function showErr(el,msg){
    if(!el)return;
    el.textContent=msg;
    el.classList.add('wcp-show');
    setTimeout(function(){el.classList.remove('wcp-show');},3000);
  }

  /* ---- Trigger ---- */
  function buildTrigger(){
    var btn=document.createElement('button');
    btn.id='wcp-trigger';
    btn.type='button';
    btn.style.display='none';
    btn.innerHTML='<span class="wcp-trigger-icon">⚽</span> توقع واربح <span class="wcp-trigger-badge">جديد</span>';
    btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openWidget();});
    document.body.appendChild(btn);
  }

  /* ---- Init ---- */
  async function init(){
    loadLocal();
    buildHTML();
    buildTrigger();
    await loadMatches();
    var f=matches.findIndex(function(m){return !savedPhones[m.id];});
    currentIdx=f===-1?0:f;
    dataReady=true;
    var btn=document.getElementById('wcp-trigger');
    if(btn)btn.style.display='flex';
    if(CFG.trigger==='auto'&&matches.length>0&&!wasDismissedToday()){
      setTimeout(openWidget,CFG.delaySeconds*1000);
    }
    window.WCPWidget={open:openWidget,close:closeWidget};
  }

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
  else{init();}
})();
