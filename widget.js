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
  var savedPhones = {};
  var userPhone   = '';
  var userTeam    = '';
  var isOpen      = false;
  var dataReady   = false;
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
        'apikey':        CFG.supabaseKey,
        'Authorization': 'Bearer ' + CFG.supabaseKey,
        'Content-Type':  'application/json',
        'Prefer':        opts.prefer || 'return=minimal',
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
      userTeam    = localStorage.getItem('wcp_team_'+CFG.storeId)||'';
    } catch(e) { savedPhones={}; }
  }

  function saveLocal(matchId, phone) {
    savedPhones[matchId] = phone;
    try {
      localStorage.setItem('wcp_phones_'+CFG.storeId, JSON.stringify(savedPhones));
      localStorage.setItem('wcp_phone_'+CFG.storeId, phone);
    } catch(e) {}
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

  /* ---- عداد تنازلي ---- */
  function getCountdown(iso) {
    var diff = new Date(iso) - new Date();
    if (diff <= 0) return null;
    var h = Math.floor(diff/3600000);
    var m = Math.floor((diff%3600000)/60000);
    var s = Math.floor((diff%60000)/1000);
    if (h >= 24) {
      var days = Math.floor(h/24);
      return days+' يوم '+Math.floor(h%24)+' ساعة';
    }
    return ('0'+h).slice(-2)+':'+('0'+m).slice(-2)+':'+('0'+s).slice(-2);
  }

  function startCountdown(iso) {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(function(){
      var el = document.getElementById('wcp-countdown');
      if (!el) { clearInterval(countdownTimer); return; }
      var cd = getCountdown(iso);
      if (!cd) { el.textContent = '🔴 بدأت المباراة — التوقع مغلق'; clearInterval(countdownTimer); return; }
      el.textContent = '⏱ يغلق التوقع خلال: '+cd;
    }, 1000);
  }

  /* ---- Build DOM ---- */
  function buildHTML() {
    var overlay = document.createElement('div');
    overlay.id = 'wcp-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,20,14,0.55);z-index:99998;opacity:0;transition:opacity 0.25s;pointer-events:none;display:none;';
    overlay.addEventListener('click', closeWidget);
    document.body.appendChild(overlay);

    var modal = document.createElement('div');
    modal.id = 'wcp-modal';
    modal.style.cssText = 'display:none;pointer-events:none;';
    modal.innerHTML =
      '<div class="wcp-inner">'+
        '<div class="wcp-header">'+
          '<div class="wcp-header-icon">⚽</div>'+
          '<div class="wcp-header-text"><h2>تحدي التوقعات 🇸🇦</h2><p>توقع واربح '+CFG.couponValue+' خصم</p></div>'+
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
    if (isOpen||!dataReady) return;
    isOpen = true;
    var overlay=document.getElementById('wcp-overlay');
    var modal=document.getElementById('wcp-modal');
    overlay.style.display='block';
    modal.style.display='block';
    modal.style.pointerEvents='auto';
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      overlay.style.opacity='1';
      overlay.style.pointerEvents='auto';
      modal.classList.add('wcp-visible');
    });});
    document.body.style.overflow='hidden';
    if (!userPhone) renderTeamStep();
    else { var f=matches.findIndex(function(m){return !savedPhones[m.id];}); currentIdx=f===-1?0:f; renderMatch(); }
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

  /* ---- Step 1: الفريق والجوال ---- */
  function renderTeamStep() {
    var body=document.getElementById('wcp-body');
    var html=TEAMS.map(function(t){
      return '<button class="wcp-team-btn'+(userTeam===t.name?' wcp-team-sel':'')+'" data-name="'+t.name+'">'+
        '<span style="font-size:20px;display:block;">'+t.flag+'</span>'+
        '<span style="font-size:10px;margin-top:2px;display:block;">'+t.name+'</span>'+
      '</button>';
    }).join('');

    body.innerHTML=
      '<div style="padding:4px 0 10px;font-size:13px;font-weight:600;color:var(--wcp-text);">اختر فريقك المفضل</div>'+
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px;">'+html+'</div>'+
      '<div class="wcp-email-group">'+
        '<label class="wcp-email-label">رقم جوالك (لاستلام الجائزة)</label>'+
        '<input class="wcp-email-input" type="tel" id="wcp-phone" placeholder="05XXXXXXXX" value="'+userPhone+'" style="direction:ltr;text-align:right;">'+
        '<div class="wcp-error" id="wcp-err"></div>'+
      '</div>'+
      '<button class="wcp-submit" id="wcp-step1-next">➡️ التالي — توقع المباريات</button>';

    /* اختيار الفريق — تفعيل فعلي */
    body.querySelectorAll('.wcp-team-btn').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        body.querySelectorAll('.wcp-team-btn').forEach(function(b){b.classList.remove('wcp-team-sel');});
        btn.classList.add('wcp-team-sel');
        userTeam=btn.dataset.name;
      });
    });

    document.getElementById('wcp-step1-next').addEventListener('click', function(){
      var phone=(document.getElementById('wcp-phone')||{}).value||'';
      phone=phone.trim();
      var err=document.getElementById('wcp-err');
      if (!phone||!/^05\d{8}$/.test(phone)){ showErr(err,'أدخل رقم جوال صحيح (05XXXXXXXX)'); return; }
      userPhone=phone;
      try {
        localStorage.setItem('wcp_phone_'+CFG.storeId,phone);
        if(userTeam) localStorage.setItem('wcp_team_'+CFG.storeId,userTeam);
      } catch(e){}
      if(userTeam) sortByFavorite();
      var f=matches.findIndex(function(m){return !savedPhones[m.id];});
      currentIdx=f===-1?0:f;
      renderMatch();
    });
  }

  /* ---- Step 2: التوقع ---- */
  function isMatchLocked(iso) {
    return new Date(iso) <= new Date();
  }

  function renderMatch() {
    var body=document.getElementById('wcp-body');
    if (!body) return;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer=null; }

    if (!matches.length) {
      body.innerHTML='<div style="text-align:center;padding:32px;"><div style="font-size:40px;">🏆</div><p style="color:#5a5a56;font-size:14px;margin-top:12px;">لا توجد مباريات خلال 3 أيام القادمة</p></div>';
      return;
    }

    var m=matches[currentIdx];
    var pred=predictions[m.id]||{};
    var total=matches.length;
    var locked=isMatchLocked(m.match_date);

    if (savedPhones[m.id]) { renderAlready(m,body); return; }

    var stages={group:'دور المجموعات',r32:'دور الـ 32',qf:'ربع النهائي',sf:'نصف النهائي',final:'النهائي'};
    var cd=getCountdown(m.match_date);

    body.innerHTML=
      '<div class="wcp-match-nav">'+
        '<button class="wcp-nav-btn" id="wcp-prev"'+(currentIdx===0?' disabled':'')+'>&#8250;</button>'+
        '<span class="wcp-match-counter">مباراة '+(currentIdx+1)+' من '+total+'</span>'+
        '<button class="wcp-nav-btn" id="wcp-next"'+(currentIdx===total-1?' disabled':'')+'>&#8249;</button>'+
      '</div>'+
      '<div class="wcp-match-card">'+
        '<div class="wcp-match-meta">'+
          '<span class="wcp-match-date">'+formatDate(m.match_date)+'</span>'+
          '<span class="wcp-match-stage">'+(stages[m.stage]||m.stage)+'</span>'+
        '</div>'+
        '<div style="font-size:10px;color:#9e9e98;margin-bottom:8px;text-align:center;">📍 '+(m.venue||'')+'</div>'+
        '<div class="wcp-teams">'+
          '<div class="wcp-team"><div class="wcp-team-flag">'+(m.home_flag||'🏳️')+'</div><div class="wcp-team-name">'+m.home_team+'</div></div>'+
          '<div class="wcp-vs">VS</div>'+
          '<div class="wcp-team"><div class="wcp-team-flag">'+(m.away_flag||'🏳️')+'</div><div class="wcp-team-name">'+m.away_team+'</div></div>'+
        '</div>'+
      '</div>'+
      /* عداد تنازلي */
      '<div id="wcp-countdown" style="text-align:center;font-size:12px;font-weight:600;color:'+(locked?'#c0392b':'#0a4f2e')+';background:'+(locked?'#fdf0ee':'#e8f5ef')+';border-radius:8px;padding:8px;margin-bottom:12px;">'+
        (locked?'🔴 بدأت المباراة — التوقع مغلق':(cd?'⏱ يغلق التوقع خلال: '+cd:''))+
      '</div>'+
      (locked?
        '<div style="text-align:center;padding:12px;color:#5a5a56;font-size:13px;">انتهى وقت التوقع لهذه المباراة</div>'
      :
        '<div class="wcp-predict-label">من سيفوز؟</div>'+
        '<div class="wcp-predict-row">'+
          '<button class="wcp-pred-btn'+(pred.prediction==='home'?' wcp-selected':'')+'" data-val="home"><span class="wcp-btn-flag">'+(m.home_flag||'🏳️')+'</span>فوز '+m.home_team+'</button>'+
          '<button class="wcp-pred-btn'+(pred.prediction==='draw'?' wcp-selected':'')+'" data-val="draw"><span class="wcp-btn-flag">🤝</span>تعادل</button>'+
          '<button class="wcp-pred-btn'+(pred.prediction==='away'?' wcp-selected':'')+'" data-val="away"><span class="wcp-btn-flag">'+(m.away_flag||'🏳️')+'</span>فوز '+m.away_team+'</button>'+
        '</div>'+
        '<div class="wcp-score-label">توقع النتيجة التفصيلية (اختياري +15 نقطة)</div>'+
        '<div class="wcp-score-row">'+
          '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.home_flag||'🏳️')+'</div>'+
          '<input class="wcp-score-input" type="number" id="wcp-hs" min="0" max="20" placeholder="0" value="'+(pred.home_score!=null?pred.home_score:'')+'"></div>'+
          '<div class="wcp-score-dash">—</div>'+
          '<div class="wcp-score-team"><div class="wcp-score-flag">'+(m.away_flag||'🏳️')+'</div>'+
          '<input class="wcp-score-input" type="number" id="wcp-as" min="0" max="20" placeholder="0" value="'+(pred.away_score!=null?pred.away_score:'')+'"></div>'+
        '</div>'+
        '<div id="wcp-score-err" style="font-size:11px;color:#c0392b;margin-bottom:8px;text-align:center;display:none;"></div>'+
        '<div class="wcp-points-hint">'+
          '<div class="wcp-point-pill"><strong>+10</strong><span>فائز صح</span></div>'+
          '<div class="wcp-point-pill"><strong>+25</strong><span>نتيجة تفصيلية</span></div>'+
          '<div class="wcp-point-pill"><strong>'+CFG.couponValue+'</strong><span>جائزة</span></div>'+
        '</div>'+
        '<button class="wcp-submit" id="wcp-submit"><span>⚽</span> سجّل توقعي</button>'
      );

    /* تشغيل العداد فقط لو المباراة لم تبدأ */
    if (!locked && cd) startCountdown(m.match_date);

    body.querySelectorAll('.wcp-pred-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        body.querySelectorAll('.wcp-pred-btn').forEach(function(b){b.classList.remove('wcp-selected');});
        btn.classList.add('wcp-selected');
        predictions[m.id]=Object.assign({},predictions[m.id]||{},{prediction:btn.dataset.val});
        validateScores(m);
      });
    });

    var hsEl=document.getElementById('wcp-hs');
    var asEl=document.getElementById('wcp-as');
    if(hsEl) hsEl.addEventListener('input',function(e){
      predictions[m.id]=Object.assign({},predictions[m.id]||{},{home_score:parseInt(e.target.value)||null});
      validateScores(m);
    });
    if(asEl) asEl.addEventListener('input',function(e){
      predictions[m.id]=Object.assign({},predictions[m.id]||{},{away_score:parseInt(e.target.value)||null});
      validateScores(m);
    });

    var pv=document.getElementById('wcp-prev');
    var nx=document.getElementById('wcp-next');
    if(pv) pv.addEventListener('click',function(){currentIdx--;renderMatch();});
    if(nx) nx.addEventListener('click',function(){currentIdx++;renderMatch();});

    var sb=document.getElementById('wcp-submit');
    if(sb) sb.addEventListener('click',function(){
      if(!validateScores(m)) return;
      submitPrediction(m);
    });
  }

  function validateScores(m) {
    var pred=predictions[m.id]||{};
    var winner=pred.prediction;
    var hs=parseInt((document.getElementById('wcp-hs')||{}).value)||0;
    var as=parseInt((document.getElementById('wcp-as')||{}).value)||0;
    var err=document.getElementById('wcp-score-err');
    if(!winner||(!hs&&!as)){if(err)err.style.display='none';return true;}
    var conflict=false;
    if(winner==='home'&&hs<=as) conflict=true;
    if(winner==='away'&&as<=hs) conflict=true;
    if(winner==='draw'&&hs!==as) conflict=true;
    if(conflict&&err){
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
        'توقعك: '+(lbl[pred.prediction]||'—')+'<br>سنرسل لك الجائزة إذا أصبت'+
        (next>-1?'<br><br><button class="wcp-submit" id="wcp-nm" style="margin-top:12px;">مباراة أخرى ←</button>':'')+
      '</div>';
    var nb=document.getElementById('wcp-nm');
    if(nb)nb.addEventListener('click',function(){currentIdx=next;renderMatch();});
  }

  async function submitPrediction(m){
    var pred=predictions[m.id]||{};
    var btn=document.getElementById('wcp-submit');
    var err=document.getElementById('wcp-score-err');
    if(!pred.prediction){if(err){err.textContent='اختر أولاً من سيفوز';err.style.display='block';}return;}
    if(isMatchLocked(m.match_date)){if(err){err.textContent='انتهى وقت التوقع';err.style.display='block';}return;}
    btn.disabled=true; btn.innerHTML='<span>⏳</span> جاري الحفظ...';
    try{
      var res=await sbFetch('predictions',{
        method:'POST',
        body:JSON.stringify({match_id:m.id,store_id:CFG.storeId,email:userPhone+'@phone.local',phone:userPhone,prediction:pred.prediction,home_score:pred.home_score||null,away_score:pred.away_score||null,favorite_team:userTeam||null}),
        prefer:'return=minimal',returnJson:false,
      });
      if(res.status===201||res.status===200){saveLocal(m.id,userPhone);renderSuccess(m,pred);}
      else if(res.status===409){saveLocal(m.id,userPhone);renderAlready(m,document.getElementById('wcp-body'));}
      else{btn.disabled=false;btn.innerHTML='<span>⚽</span> سجّل توقعي';if(err){err.textContent='حدث خطأ';err.style.display='block';}}
    }catch(e){btn.disabled=false;btn.innerHTML='<span>⚽</span> سجّل توقعي';}
  }

  function renderSuccess(m,pred){
    var body=document.getElementById('wcp-body');
    var pts=(pred.home_score!=null&&pred.away_score!=null)?25:10;
    body.innerHTML=
      '<div class="wcp-success">'+
        '<span class="wcp-success-icon">🎉</span>'+
        '<h3>تم تسجيل توقعك!</h3>'+
        '<p>إذا أصبت، نرسل لك كود خصم <strong>'+CFG.couponValue+'</strong><br>على جوالك <strong>'+userPhone+'</strong></p>'+
        '<div class="wcp-success-pts">تستحق حتى '+pts+' نقطة</div>'+
        '<button class="wcp-submit" id="wcp-fin">متابعة التسوق</button>'+
      '</div>';
    var fb=document.getElementById('wcp-fin');
    if(fb)fb.addEventListener('click',closeWidget);
  }

  function showErr(el,msg){if(!el)return;el.textContent=msg;el.classList.add('wcp-show');setTimeout(function(){el.classList.remove('wcp-show');},3000);}

  function buildTrigger(){
    var btn=document.createElement('button');
    btn.id='wcp-trigger';
    btn.style.display='none';
    btn.innerHTML='<span class="wcp-trigger-icon">⚽</span> توقع واربح <span class="wcp-trigger-badge">جديد</span>';
    btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openWidget();});
    document.body.appendChild(btn);
  }

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
