/**
 * Predict Widget v5
 * نظام توقعات كأس العالم مع حسابات كاملة
 * جوال + كلمة سر + ليدربورد + حسابي
 */
(function () {
  'use strict';

  var CFG = Object.assign({
    supabaseUrl:  '',
    supabaseKey:  '',
    storeId:      'default',
    trigger:      'auto',
    delaySeconds: 8,
    couponValue:  '10%',
    pointsForCoupon: 50,
    primaryColor: '#0a4f2e',
  }, window.WCP_CONFIG || {});

  var matches     = [];
  var currentIdx  = 0;
  var predictions = {};
  var isOpen      = false;
  var dataReady   = false;
  var activeTab   = 'predict';
  var countdownTimer = null;
  var currentUser = null; // { id, name, phone, favorite_team, total_points }

  var TEAMS = [
    {name:'السعودية',flag:'🇸🇦'},{name:'الأرجنتين',flag:'🇦🇷'},
    {name:'فرنسا',flag:'🇫🇷'},{name:'البرازيل',flag:'🇧🇷'},
    {name:'إنجلترا',flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿'},{name:'إسبانيا',flag:'🇪🇸'},
    {name:'ألمانيا',flag:'🇩🇪'},{name:'البرتغال',flag:'🇵🇹'},
    {name:'المغرب',flag:'🇲🇦'},{name:'مصر',flag:'🇪🇬'},
    {name:'اليابان',flag:'🇯🇵'},{name:'هولندا',flag:'🇳🇱'},
  ];

  /* ---- Supabase ---- */
  async function sb(path, opts) {
    opts = opts || {};
    var res = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, Object.assign({}, opts, {
      headers: Object.assign({
        'apikey': CFG.supabaseKey,
        'Authorization': 'Bearer ' + CFG.supabaseKey,
        'Content-Type': 'application/json',
        'Prefer': opts.prefer || 'return=representation',
      }, opts.headers || {}),
    }));
    if (opts.raw) return res;
    try { return await res.json(); } catch(e) { return null; }
  }

  /* ---- Simple hash (بدون bcrypt — للبساطة) ---- */
  async function hashPass(pass) {
    var enc = new TextEncoder();
    var buf = await crypto.subtle.digest('SHA-256', enc.encode(pass + 'predict_salt_2026'));
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }

  /* ---- Auth ---- */
  async function register(phone, name, pass, team) {
    var hash = await hashPass(pass);
    var res = await sb('users', {
      method: 'POST',
      body: JSON.stringify({ phone: phone, name: name, password_hash: hash, favorite_team: team||null }),
      prefer: 'return=representation',
      raw: true,
    });
    if (res.status === 201) {
      var data = await res.json();
      return { ok: true, user: data[0] };
    } else if (res.status === 409) {
      return { ok: false, error: 'رقم الجوال مسجّل مسبقاً — سجّل دخول' };
    }
    return { ok: false, error: 'حدث خطأ، حاول مرة ثانية' };
  }

  async function login(phone, pass) {
    var hash = await hashPass(pass);
    var data = await sb('users?phone=eq.'+phone+'&password_hash=eq.'+hash+'&select=*');
    if (Array.isArray(data) && data.length > 0) {
      return { ok: true, user: data[0] };
    }
    return { ok: false, error: 'رقم الجوال أو كلمة السر غلط' };
  }

  function saveSession(user) {
    currentUser = user;
    try { localStorage.setItem('wcp_user_'+CFG.storeId, JSON.stringify(user)); } catch(e) {}
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem('wcp_user_'+CFG.storeId);
      if (raw) currentUser = JSON.parse(raw);
    } catch(e) {}
  }

  function logout() {
    currentUser = null;
    try { localStorage.removeItem('wcp_user_'+CFG.storeId); } catch(e) {}
  }

  /* ---- Data ---- */
  async function loadMatches() {
    var now  = new Date().toISOString();
    var plus3= new Date(Date.now() + 3*24*60*60*1000).toISOString();
    var data = await sb('matches?status=eq.upcoming&match_date=gte.'+now+'&match_date=lte.'+plus3+'&order=match_date.asc&limit=15');
    matches = Array.isArray(data) ? data : [];
    if (currentUser && currentUser.favorite_team) sortByFavorite();
  }

  async function loadUserPredictions() {
    if (!currentUser) return [];
    var data = await sb('predictions?store_id=eq.'+CFG.storeId+'&user_id=eq.'+currentUser.id+'&order=created_at.desc&limit=20');
    return Array.isArray(data) ? data : [];
  }

  async function loadLeaderboard() {
    var data = await sb('predictions?store_id=eq.'+CFG.storeId+'&select=user_id,phone,points&limit=500');
    if (!Array.isArray(data)) return [];
    var map = {};
    data.forEach(function(p) {
      if (!p.user_id) return;
      if (!map[p.user_id]) map[p.user_id] = { user_id: p.user_id, phone: p.phone||'', total: 0, name: '—', team: '' };
      map[p.user_id].total += (p.points || 0);
    });
    var ids = Object.keys(map);
    if (!ids.length) return [];
    var users = await sb('users?select=id,name,favorite_team&limit=200');
    if (Array.isArray(users)) {
      users.forEach(function(u) {
        if (map[u.id]) { map[u.id].name = u.name||'—'; map[u.id].team = u.favorite_team||''; }
      });
    }
    return Object.values(map).sort(function(a,b){return b.total-a.total;}).slice(0,10);
  }

  async function loadSavedPredictions() {
    if (!currentUser) return {};
    var data = await sb('predictions?store_id=eq.'+CFG.storeId+'&user_id=eq.'+currentUser.id+'&select=match_id,prediction,home_score,away_score,points');
    var map = {};
    if (Array.isArray(data)) data.forEach(function(p){ map[p.match_id]=p; });
    return map;
  }

  function sortByFavorite() {
    var team = currentUser.favorite_team;
    matches.sort(function(a,b){
      var af=a.home_team===team||a.away_team===team?0:1;
      var bf=b.home_team===team||b.away_team===team?0:1;
      return af-bf;
    });
  }

  function isMatchLocked(iso) { return new Date(iso)<=new Date(); }

  function getCountdown(iso) {
    var diff=new Date(iso)-new Date();
    if(diff<=0)return null;
    var h=Math.floor(diff/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);
    if(h>=24)return Math.floor(h/24)+' يوم '+Math.floor(h%24)+' ساعة';
    return ('0'+h).slice(-2)+':'+('0'+m).slice(-2)+':'+('0'+s).slice(-2);
  }

  function startCountdown(iso) {
    if(countdownTimer)clearInterval(countdownTimer);
    countdownTimer=setInterval(function(){
      var el=document.getElementById('wcp-countdown');
      if(!el){clearInterval(countdownTimer);return;}
      var cd=getCountdown(iso);
      if(!cd){el.textContent='🔴 بدأت المباراة';el.style.background='#fdf0ee';el.style.color='#c0392b';clearInterval(countdownTimer);}
      else el.textContent='⏱ يغلق التوقع: '+cd;
    },1000);
  }

  function formatDate(iso){
    var d=new Date(iso);
    var days=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    var months=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()]+' '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
  }

  function wasDismissedToday(){
    try{return localStorage.getItem('wcp_dismissed_'+CFG.storeId)===new Date().toDateString();}catch(e){return false;}
  }

  /* ---- DOM ---- */
  function buildHTML() {
    var overlay=document.createElement('div');
    overlay.id='wcp-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(10,20,14,0.6);z-index:99998;opacity:0;transition:opacity 0.25s;pointer-events:none;display:none;backdrop-filter:blur(3px);';
    overlay.addEventListener('click',closeWidget);
    document.body.appendChild(overlay);

    var modal=document.createElement('div');
    modal.id='wcp-modal';
    modal.style.cssText='display:none;pointer-events:none;';
    modal.innerHTML=
      '<div class="wcp-inner">'+
        '<div class="wcp-header">'+
          '<div class="wcp-header-icon">⚽</div>'+
          '<div class="wcp-header-text"><h2>تحدي التوقعات 🇸🇦</h2><p id="wcp-header-sub">توقع واربح '+CFG.couponValue+' خصم</p></div>'+
          '<button type="button" class="wcp-close" id="wcp-close-btn">✕</button>'+
        '</div>'+
        '<div class="wcp-tabs" id="wcp-tabs" style="display:none;">'+
          '<button type="button" class="wcp-tab wcp-tab-active" id="tab-predict" onclick="window._wcpTab(\'predict\')">⚽ التوقعات</button>'+
          '<button type="button" class="wcp-tab" id="tab-board" onclick="window._wcpTab(\'board\')">🏆 الترتيب</button>'+
          '<button type="button" class="wcp-tab" id="tab-account" onclick="window._wcpTab(\'account\')">👤 حسابي</button>'+
        '</div>'+
        '<div class="wcp-body" id="wcp-body"></div>'+
        '<div class="wcp-footer">⚡ Predict — تطبيق التوقعات</div>'+
      '</div>';
    document.body.appendChild(modal);
    document.getElementById('wcp-close-btn').addEventListener('click',closeWidget);

    window._wcpTab=function(tab){
      activeTab=tab;
      ['predict','board','account'].forEach(function(t){
        var el=document.getElementById('tab-'+t);
        if(el)el.className='wcp-tab'+(tab===t?' wcp-tab-active':'');
      });
      if(tab==='predict')renderMatches();
      else if(tab==='board')renderLeaderboard();
      else renderAccount();
    };
  }

  /* ---- Open / Close ---- */
  function openWidget(){
    if(isOpen||!dataReady)return;
    isOpen=true;
    var overlay=document.getElementById('wcp-overlay');
    var modal=document.getElementById('wcp-modal');
    overlay.style.display='block';
    modal.style.display='block';
    modal.style.pointerEvents='auto';
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      overlay.style.opacity='1';overlay.style.pointerEvents='auto';
      modal.classList.add('wcp-visible');
    });});
    document.body.style.overflow='hidden';
    if(!currentUser)renderAuth('register');
    else{document.getElementById('wcp-tabs').style.display='flex';renderMatches();}
  }

  function closeWidget(){
    if(!isOpen)return;
    isOpen=false;
    if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}
    try{localStorage.setItem('wcp_dismissed_'+CFG.storeId,new Date().toDateString());}catch(e){}
    var overlay=document.getElementById('wcp-overlay');
    var modal=document.getElementById('wcp-modal');
    overlay.style.opacity='0';overlay.style.pointerEvents='none';
    modal.classList.remove('wcp-visible');modal.style.pointerEvents='none';
    setTimeout(function(){overlay.style.display='none';modal.style.display='none';},300);
    document.body.style.overflow='';
  }

  /* ---- Auth UI ---- */
  function renderAuth(mode) {
    document.getElementById('wcp-tabs').style.display='none';
    var body=document.getElementById('wcp-body');
    var isReg = mode==='register';

    var teamBtns = isReg ? TEAMS.map(function(t){
      return '<button type="button" class="wcp-team-btn" data-name="'+t.name+'" onclick="window._wcpPickTeam(this)">'+
        '<span style="font-size:18px;display:block;">'+t.flag+'</span>'+
        '<span style="font-size:10px;margin-top:2px;display:block;">'+t.name+'</span>'+
      '</button>';
    }).join('') : '';

    body.innerHTML=
      '<div style="text-align:center;margin-bottom:14px;">'+
        '<div style="font-size:16px;font-weight:700;color:#1a1a18;">'+
          (isReg?'إنشاء حساب جديد':'تسجيل الدخول')+
        '</div>'+
        '<div style="font-size:12px;color:#9e9e98;margin-top:4px;">'+
          (isReg?'حساب واحد لكل مبارياتك':'أدخل رقم جوالك وكلمة السر')+
        '</div>'+
      '</div>'+
      (isReg?'<div class="wcp-email-group"><label class="wcp-email-label">اسمك</label><input class="wcp-email-input" type="text" id="wcp-name" placeholder="محمد العتيبي"></div>':'')+
      '<div class="wcp-email-group"><label class="wcp-email-label">رقم الجوال</label><input class="wcp-email-input" type="tel" id="wcp-phone" placeholder="05XXXXXXXX" style="direction:ltr;text-align:right;"></div>'+
      '<div class="wcp-email-group"><label class="wcp-email-label">كلمة السر</label><input class="wcp-email-input" type="password" id="wcp-pass" placeholder="•••••••• (8 أحرف على الأقل)"></div>'+
      (isReg?
        '<div style="font-size:12px;font-weight:500;color:#5a5a56;margin:10px 0 8px;">فريقك المفضل (اختياري)</div>'+
        '<div id="wcp-teams-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:12px;">'+teamBtns+'</div>'
      :'')+
      '<div class="wcp-error" id="wcp-err" style="margin-bottom:8px;"></div>'+
      '<button type="button" class="wcp-submit" id="wcp-auth-btn" onclick="window._wcpAuthSubmit(\''+mode+'\')">'+
        (isReg?'⚽ إنشاء الحساب':'🔑 دخول')+
      '</button>'+
      '<div style="text-align:center;margin-top:12px;font-size:12px;color:#5a5a56;">'+
        (isReg?
          'عندك حساب؟ <button type="button" onclick="window._wcpAuthMode(\'login\')" style="background:none;border:none;color:#0a4f2e;font-weight:600;cursor:pointer;font-size:12px;font-family:inherit;">سجّل دخول</button>':
          'ما عندك حساب؟ <button type="button" onclick="window._wcpAuthMode(\'register\')" style="background:none;border:none;color:#0a4f2e;font-weight:600;cursor:pointer;font-size:12px;font-family:inherit;">إنشاء حساب</button>'
        )+
      '</div>';

    window._wcpPickTeam=function(btn){
      document.querySelectorAll('#wcp-teams-grid .wcp-team-btn').forEach(function(b){b.classList.remove('wcp-team-sel');});
      btn.classList.add('wcp-team-sel');
    };

    window._wcpAuthMode=function(m){ renderAuth(m); };

    window._wcpAuthSubmit=async function(m){
      var phone=(document.getElementById('wcp-phone')||{}).value||''; phone=phone.trim();
      var pass=(document.getElementById('wcp-pass')||{}).value||'';
      var err=document.getElementById('wcp-err');
      if(!/^05\d{8}$/.test(phone)){showErr(err,'أدخل رقم جوال صحيح');return;}
      if(pass.length<6){showErr(err,'كلمة السر 6 أحرف على الأقل');return;}
      var btn=document.getElementById('wcp-auth-btn');
      btn.disabled=true; btn.textContent='⏳ جاري...';
      var result;
      if(m==='register'){
        var name=(document.getElementById('wcp-name')||{}).value||''; name=name.trim();
        if(!name){showErr(err,'أدخل اسمك');btn.disabled=false;btn.textContent='⚽ إنشاء الحساب';return;}
        var teamBtn=document.querySelector('#wcp-teams-grid .wcp-team-sel');
        var team=teamBtn?teamBtn.dataset.name:'';
        result=await register(phone,name,pass,team);
      } else {
        result=await login(phone,pass);
      }
      if(result.ok){
        saveSession(result.user);
        if(currentUser.favorite_team)sortByFavorite();
        var savedMap=await loadSavedPredictions();
        predictions=savedMap;
        document.getElementById('wcp-tabs').style.display='flex';
        renderMatches();
      } else {
        showErr(err,result.error);
        btn.disabled=false;
        btn.textContent=m==='register'?'⚽ إنشاء الحساب':'🔑 دخول';
      }
    };
  }

  /* ---- التوقعات ---- */
  async function renderMatches() {
    activeTab='predict';
    ['predict','board','account'].forEach(function(t){
      var el=document.getElementById('tab-'+t);
      if(el)el.className='wcp-tab'+(t==='predict'?' wcp-tab-active':'');
    });
    var body=document.getElementById('wcp-body');
    if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}

    if(!matches.length){
      body.innerHTML='<div style="text-align:center;padding:32px;"><div style="font-size:40px;">🏆</div><p style="color:#5a5a56;font-size:14px;margin-top:12px;">لا توجد مباريات خلال 3 أيام القادمة</p></div>';
      return;
    }

    var m=matches[currentIdx];
    var pred=predictions[m.id]||{};
    var total=matches.length;
    var locked=isMatchLocked(m.match_date);
    var alreadyVoted=!!predictions[m.id]&&predictions[m.id].prediction;
    var cd=getCountdown(m.match_date);
    var stages={group:'دور المجموعات',r32:'دور الـ 32',qf:'ربع النهائي',sf:'نصف النهائي',final:'النهائي'};

    body.innerHTML=
      '<div class="wcp-match-nav">'+
        '<button type="button" class="wcp-nav-btn"'+(currentIdx===0?' disabled':'')+' onclick="window._wcpNav(-1)">&#8250;</button>'+
        '<span class="wcp-match-counter">مباراة '+(currentIdx+1)+' من '+total+'</span>'+
        '<button type="button" class="wcp-nav-btn"'+(currentIdx===total-1?' disabled':'')+' onclick="window._wcpNav(1)">&#8249;</button>'+
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
        (locked?'🔴 بدأت المباراة — التوقع مغلق':(cd?'⏱ يغلق التوقع: '+cd:''))+
      '</div>'+
      (alreadyVoted?
        '<div class="wcp-already">'+
          '<strong>✅ سجّلت توقعك!</strong>'+
          'توقعك: '+({home:'فوز '+m.home_team,draw:'تعادل',away:'فوز '+m.away_team}[pred.prediction]||'—')+'<br>'+
          (pred.points>0?'<span style="color:#0a4f2e;font-weight:600;">🏆 حصلت على '+pred.points+' نقطة!</span>':'سنحسب نقاطك بعد المباراة')+
        '</div>'
      : locked?
        '<div style="text-align:center;padding:12px;color:#5a5a56;font-size:13px;">انتهى وقت التوقع لهذه المباراة</div>'
      :
        '<div class="wcp-predict-label">من سيفوز؟</div>'+
        '<div class="wcp-predict-row">'+
          '<button type="button" class="wcp-pred-btn'+(pred.prediction==='home'?' wcp-selected':'')+'" onclick="window._wcpPick(\''+m.id+'\',\'home\',this)"><span class="wcp-btn-flag">'+(m.home_flag||'🏳️')+'</span>'+m.home_team+'</button>'+
          '<button type="button" class="wcp-pred-btn'+(pred.prediction==='draw'?' wcp-selected':'')+'" onclick="window._wcpPick(\''+m.id+'\',\'draw\',this)"><span class="wcp-btn-flag">🤝</span>تعادل</button>'+
          '<button type="button" class="wcp-pred-btn'+(pred.prediction==='away'?' wcp-selected':'')+'" onclick="window._wcpPick(\''+m.id+'\',\'away\',this)"><span class="wcp-btn-flag">'+(m.away_flag||'🏳️')+'</span>'+m.away_team+'</button>'+
        '</div>'+
        '<div class="wcp-score-label">نتيجة تفصيلية (اختياري +15 نقطة)</div>'+
        '<div class="wcp-score-row">'+
          '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.home_flag||'🏳️')+'</div><input class="wcp-score-input" type="number" id="wcp-hs" min="0" max="20" placeholder="0" oninput="window._wcpScore(\''+m.id+'\',\'h\',this.value)"></div>'+
          '<div class="wcp-score-dash">—</div>'+
          '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.away_flag||'🏳️')+'</div><input class="wcp-score-input" type="number" id="wcp-as" min="0" max="20" placeholder="0" oninput="window._wcpScore(\''+m.id+'\',\'a\',this.value)"></div>'+
        '</div>'+
        '<div id="wcp-score-err" style="font-size:11px;color:#c0392b;text-align:center;margin-bottom:8px;display:none;"></div>'+
        '<div class="wcp-points-hint">'+
          '<div class="wcp-point-pill"><strong>+10</strong><span>فائز صح</span></div>'+
          '<div class="wcp-point-pill"><strong>+25</strong><span>نتيجة تفصيلية</span></div>'+
          '<div class="wcp-point-pill"><strong>'+CFG.couponValue+'</strong><span>جائزة عند '+CFG.pointsForCoupon+' نقطة</span></div>'+
        '</div>'+
        '<button type="button" class="wcp-submit" onclick="window._wcpSubmit()"><span>⚽</span> سجّل توقعي</button>'
      );

    if(!locked&&cd)startCountdown(m.match_date);

    window._wcpNav=function(dir){currentIdx+=dir;renderMatches();};
    window._wcpPick=function(mid,val,btn){
      document.querySelectorAll('#wcp-body .wcp-pred-btn').forEach(function(b){b.classList.remove('wcp-selected');});
      btn.classList.add('wcp-selected');
      predictions[mid]=Object.assign({},predictions[mid]||{},{prediction:val});
      var err=document.getElementById('wcp-score-err');if(err)err.style.display='none';
    };
    window._wcpScore=function(mid,side,val){
      predictions[mid]=Object.assign({},predictions[mid]||{});
      predictions[mid][side==='h'?'home_score':'away_score']=parseInt(val)||null;
      validateScores(mid);
    };
    window._wcpSubmit=function(){if(!validateScores(m.id))return;submitPrediction(m);};
  }

  function validateScores(mid){
    var pred=predictions[mid]||{};
    var w=pred.prediction,hs=pred.home_score||0,as=pred.away_score||0;
    var err=document.getElementById('wcp-score-err');
    if(!w||(!hs&&!as)){if(err)err.style.display='none';return true;}
    var bad=(w==='home'&&hs<=as)||(w==='away'&&as<=hs)||(w==='draw'&&hs!==as);
    if(bad&&err){err.textContent='⚠️ '+(w==='draw'?'التعادل يعني النتيجتين متساويتين':'النتيجة لا تتوافق مع اختيارك');err.style.display='block';return false;}
    if(err)err.style.display='none';return true;
  }

  async function submitPrediction(m){
    var pred=predictions[m.id]||{};
    var btn=document.querySelector('#wcp-body .wcp-submit');
    var err=document.getElementById('wcp-score-err');
    if(!pred.prediction){if(err){err.textContent='اختر أولاً من سيفوز';err.style.display='block';}return;}
    if(!currentUser){renderAuth('login');return;}
    if(btn){btn.disabled=true;btn.innerHTML='<span>⏳</span> جاري الحفظ...';}
    try{
      var res=await sb('predictions',{
        method:'POST',
        body:JSON.stringify({match_id:m.id,store_id:CFG.storeId,user_id:currentUser.id,phone:currentUser.phone,prediction:pred.prediction,home_score:pred.home_score||null,away_score:pred.away_score||null}),
        prefer:'return=minimal',raw:true,
      });
      if(res.status===201||res.status===200){
        predictions[m.id]=Object.assign({},pred,{submitted:true});
        renderMatches();
      } else if(res.status===409){
        predictions[m.id]=Object.assign({},pred,{submitted:true});
        renderMatches();
      } else {
        if(btn){btn.disabled=false;btn.innerHTML='<span>⚽</span> سجّل توقعي';}
        if(err){err.textContent='حدث خطأ';err.style.display='block';}
      }
    }catch(e){if(btn){btn.disabled=false;btn.innerHTML='<span>⚽</span> سجّل توقعي';}}
  }

  /* ---- الليدربورد ---- */
  async function renderLeaderboard(){
    activeTab='board';
    var body=document.getElementById('wcp-body');
    body.innerHTML='<div style="text-align:center;padding:20px;color:#9e9e98;font-size:13px;">⏳ جاري تحميل الترتيب...</div>';
    var board=await loadLeaderboard();
    if(!board.length){body.innerHTML='<div style="text-align:center;padding:24px;color:#9e9e98;font-size:13px;">لا توجد توقعات بعد</div>';return;}
    var medals=['🥇','🥈','🥉'];
    var myRank=-1;
    var rows=board.map(function(u,i){
      var isMe=currentUser&&u.user_id===currentUser.id;
      if(isMe)myRank=i+1;
      var team=TEAMS.find(function(t){return t.name===u.team;});
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:0.5px solid #e8e8e4;'+(isMe?'background:#e8f5ef;margin:0 -16px;padding:10px 16px;border-radius:8px;':'')+'">'+
        '<div style="width:28px;text-align:center;font-size:'+(i<3?'18':'13')+'px;font-weight:600;color:#9e9e98;">'+(medals[i]||i+1)+'</div>'+
        '<div style="font-size:16px;">'+(team?team.flag:'⚽')+'</div>'+
        '<div style="flex:1;">'+
          '<div style="font-size:13px;font-weight:'+(isMe?'700':'500')+';">'+u.name+'</div>'+
          '<div style="font-size:10px;color:#9e9e98;">'+(u.team||'')+'</div>'+
        '</div>'+
        '<div style="font-size:15px;font-weight:700;color:'+(isMe?'#0a4f2e':'#1a1a18')+';">'+u.total+' <span style="font-size:10px;font-weight:400;color:#9e9e98;">نقطة</span></div>'+
      '</div>';
    }).join('');
    body.innerHTML=
      '<div style="font-size:14px;font-weight:700;color:#1a1a18;margin-bottom:12px;">🏆 أفضل 10 متوقعين</div>'+
      rows+
      (myRank>0?'<div style="text-align:center;margin-top:12px;font-size:12px;color:#0a4f2e;font-weight:600;">مرتبتك: #'+myRank+'</div>':'');
  }

  /* ---- حسابي ---- */
  async function renderAccount(){
    activeTab='account';
    var body=document.getElementById('wcp-body');
    if(!currentUser){renderAuth('login');return;}
    body.innerHTML='<div style="text-align:center;padding:20px;color:#9e9e98;font-size:13px;">⏳ جاري تحميل حسابك...</div>';

    var preds=await loadUserPredictions();
    var total=preds.length;
    var correct=preds.filter(function(p){return p.points>0;}).length;
    var totalPts=preds.reduce(function(s,p){return s+(p.points||0);},0);
    var coupons=preds.filter(function(p){return p.coupon_sent;}).length;
    var teamObj=TEAMS.find(function(t){return t.name===currentUser.favorite_team;})||{};
    var needPts=Math.max(0,CFG.pointsForCoupon-totalPts);

    var histRows=preds.slice(0,8).map(function(p){
      var lbl={home:'🏠 فوز مضيف',draw:'🤝 تعادل',away:'✈️ فوز ضيف'};
      var st=p.points>0?'✅':'p.points===0&&p.points!==null'?'❌':'⏳';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid #e8e8e4;font-size:12px;">'+
        '<div>'+
          '<div style="font-weight:500;color:#1a1a18;font-size:11px;">'+p.match_id.replace(/_2026/,'').replace(/_/,' vs ').toUpperCase()+'</div>'+
          '<div style="color:#9e9e98;font-size:10px;">'+(lbl[p.prediction]||'—')+'</div>'+
        '</div>'+
        '<div style="text-align:left;">'+
          (p.points>0?'<div style="color:#0a4f2e;font-weight:700;">+'+p.points+' نقطة ✅</div>':'<div style="color:#9e9e98;">⏳ انتظار</div>')+
        '</div>'+
      '</div>';
    }).join('');

    body.innerHTML=
      '<div style="background:linear-gradient(135deg,#0a4f2e,#0f6b3e);border-radius:12px;padding:16px;margin-bottom:14px;color:white;">'+
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">'+
          '<div style="width:46px;height:46px;background:rgba(255,255,255,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;">'+(teamObj.flag||'👤')+'</div>'+
          '<div style="flex:1;">'+
            '<div style="font-size:15px;font-weight:700;">'+currentUser.name+'</div>'+
            '<div style="font-size:11px;opacity:0.7;">'+currentUser.phone+'</div>'+
            (currentUser.favorite_team?'<div style="font-size:10px;opacity:0.6;">❤️ '+currentUser.favorite_team+'</div>':'')+
          '</div>'+
          '<button type="button" onclick="window._wcpLogout()" style="background:rgba(255,255,255,0.15);border:none;border-radius:6px;color:white;font-size:11px;padding:5px 10px;cursor:pointer;font-family:inherit;">خروج</button>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center;">'+
          '<div><div style="font-size:22px;font-weight:800;">'+totalPts+'</div><div style="font-size:9px;opacity:0.7;">نقطة</div></div>'+
          '<div><div style="font-size:22px;font-weight:800;">'+total+'</div><div style="font-size:9px;opacity:0.7;">توقع</div></div>'+
          '<div><div style="font-size:22px;font-weight:800;">'+correct+'</div><div style="font-size:9px;opacity:0.7;">صح</div></div>'+
          '<div><div style="font-size:22px;font-weight:800;">'+coupons+'</div><div style="font-size:9px;opacity:0.7;">جائزة</div></div>'+
        '</div>'+
      '</div>'+
      (needPts===0?
        '<div style="background:#fdf6e3;border:1px solid rgba(201,168,76,0.4);border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;text-align:center;">🏆 مبروك! تستحق كوبون خصم <strong>'+CFG.couponValue+'</strong><br><span style="font-size:11px;color:#5a5a56;">سنرسله على جوالك قريباً</span></div>':
        '<div style="background:#e8f5ef;border-radius:10px;padding:10px 12px;margin-bottom:12px;">'+
          '<div style="font-size:12px;color:#0a4f2e;font-weight:600;margin-bottom:6px;">🎯 الهدف القادم: كوبون '+CFG.couponValue+'</div>'+
          '<div style="background:#c8e6d5;border-radius:4px;height:6px;overflow:hidden;">'+
            '<div style="background:#0a4f2e;height:100%;width:'+Math.min(100,Math.round(totalPts/CFG.pointsForCoupon*100))+'%;transition:width 0.5s;border-radius:4px;"></div>'+
          '</div>'+
          '<div style="font-size:10px;color:#5a5a56;margin-top:4px;">'+totalPts+' / '+CFG.pointsForCoupon+' نقطة (باقي '+needPts+' نقطة)</div>'+
        '</div>'
      )+
      (total>0?
        '<div style="font-size:13px;font-weight:600;color:#1a1a18;margin-bottom:8px;">آخر توقعاتك</div>'+histRows
      :'<div style="text-align:center;padding:16px;color:#9e9e98;font-size:13px;">لم تتوقع بعد — ابدأ الآن!</div>'
      );

    window._wcpLogout=function(){
      logout();
      document.getElementById('wcp-tabs').style.display='none';
      renderAuth('login');
    };
  }

  function showErr(el,msg){
    if(!el)return;
    el.textContent=msg;el.classList.add('wcp-show');
    setTimeout(function(){el.classList.remove('wcp-show');},3000);
  }

  function buildTrigger(){
    var btn=document.createElement('button');
    btn.id='wcp-trigger';btn.type='button';
    btn.style.display='none';
    btn.innerHTML='<span class="wcp-trigger-icon">⚽</span> توقع واربح <span class="wcp-trigger-badge">جديد</span>';
    btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openWidget();});
    document.body.appendChild(btn);
  }

  async function init(){
    loadSession();
    buildHTML();
    buildTrigger();
    await loadMatches();
    if(currentUser){
      var saved=await loadSavedPredictions();
      predictions=saved;
      if(currentUser.favorite_team)sortByFavorite();
    }
    var f=matches.findIndex(function(m){return !predictions[m.id]||!predictions[m.id].prediction;});
    currentIdx=f===-1?0:f;
    dataReady=true;
    var btn=document.getElementById('wcp-trigger');if(btn)btn.style.display='flex';
    if(CFG.trigger==='auto'&&matches.length>0&&!wasDismissedToday()){
      setTimeout(openWidget,CFG.delaySeconds*1000);
    }
    window.WCPWidget={open:openWidget,close:closeWidget};
  }

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}
  else{init();}
})();
