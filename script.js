(()=>{
  const $=s=>document.querySelector(s);
  const files=$('#files'), analyzeBtn=$('#analyzeBtn'), tickets=$('#tickets'), det=$('#det'), logEl=$('#log'), state=$('#state'), postureSel=$('#posture');
  const priceEl=$('#price'), atrEl=$('#atr');
  const log=m=>{ logEl.textContent+=m+'\n'; logEl.scrollTop=logEl.scrollHeight; };

  let images=[];
  files.addEventListener('change', async e=>{
    images=[];
    for(const f of e.target.files){ const u=URL.createObjectURL(f); const im=new Image(); im.src=u; await im.decode(); images.push(im); }
    log(`Loaded ${images.length} image(s).`);
    run(); // auto analyze on upload
  });

  const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900; const ctx=canvas.getContext('2d');
  function drawFit(img){const sc=Math.min(canvas.width/img.width,canvas.height/img.height);const w=img.width*sc,h=img.height*sc,x=(canvas.width-w)/2,y=(canvas.height-h)/2;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#0b0f14';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,x,y,w,h);return {x,y,w,h};}
  function crop(r){const t=document.createElement('canvas'); t.width=r.w; t.height=r.h; const g=t.getContext('2d'); g.drawImage(canvas,r.x,r.y,r.w,r.h,0,0,r.w,r.h); return t.toDataURL('image/png');}

  async function ocr(data,label){ try{ if(!window.Tesseract){ log('Tesseract missing'); return ''; } const {data:{text}}=await Tesseract.recognize(data,'eng'); log(`OCR ${label}: `+text.replace(/\s+/g,' ').slice(0,110)); return text; } catch(e){ log('OCR error '+label+': '+e); return ''; } }
  const nums=t=>(t.match(/\d{3,5}(?:\.\d+)?/g)||[]).map(Number).filter(v=>v>100&&v<10000);
  const num=(re,txt)=>{ const m=txt.match(re); return m? parseFloat(m[1]):null; };

  function parseMACDPair(txt){
    // handles patterns like "MACD(12,26,9) -0.802 -0.910"
    const m = txt.match(/MACD\s*\(\s*12\s*,\s*26\s*,\s*9\s*\)\s*([\-\+]?\d+(?:\.\d+)?)\s+([\-\+]?\d+(?:\.\d+)?)/i);
    if(m){ return {main:parseFloat(m[1]), signal:parseFloat(m[2]), delta:parseFloat(m[1])-parseFloat(m[2])}; }
    // fallback: any two signed floats after 'MACD'
    const m2 = txt.match(/MACD[^\d\-\+]*([\-\+]?\d+(?:\.\d+)?)\s+([\-\+]?\d+(?:\.\d+)?)/i);
    return m2? {main:parseFloat(m2[1]), signal:parseFloat(m2[2]), delta:parseFloat(m2[1])-parseFloat(m2[2])} : {main:null,signal:null,delta:null};
  }

  async function readOne(img){
    const fit=drawFit(img);
    const full=await ocr(canvas.toDataURL('image/png'),'full');
    const tf=((full.match(/\b(M5|M15|H1|H4)\b/i)||[])[1]||'M15').toUpperCase();

    const strip=Math.round(fit.w*0.12);
    const leftTxt=await ocr(crop({x:fit.x,y:fit.y,w:strip,h:fit.h}),'axisL');
    const rightTxt=await ocr(crop({x:fit.x+fit.w-strip,y:fit.y,w:strip,h:fit.h}),'axisR');
    const ln=nums(leftTxt), rn=nums(rightTxt);
    const pxList=(rn.length>=ln.length? rn:ln).sort((a,b)=>a-b);
    const px=pxList.length? pxList[Math.floor(pxList.length*0.6)]:null;

    const atr = num(/ATR\s*\(\s*14\s*\)\s*([0-9]+(?:\.\d+)?)/i, full) || num(/ATR[^0-9]*([0-9]+(?:\.\d+)?)/i, full);
    const rsi = num(/RSI\s*\(\s*14\s*\)\s*([0-9]+(?:\.\d+)?)/i, full) || num(/RSI[^0-9]*([0-9]+(?:\.\d+)?)/i, full);
    const {main:macdMain, signal:macdSig, delta:macdDelta} = parseMACDPair(full);

    // Close slope proxy
    const box={x:fit.x+Math.round(fit.w*0.22), y:fit.y+Math.round(fit.h*0.14), w:Math.round(fit.w*0.56), h:Math.round(fit.h*0.52)};
    const bg=ctx.getImageData(box.x+2,box.y+2,1,1).data; const dC=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
    const step=Math.max(2,Math.floor(box.w/240)); const C=[];
    for(let xi=box.x; xi<box.x+box.w; xi+=step){
      let lo=null; for(let yi=box.y+box.h-1; yi>=box.y; yi--){ const p=ctx.getImageData(xi,yi,1,1).data; if(dC(p,bg)>28){ lo=yi; break; } }
      if(lo==null) continue; C.push(lo-2);
    }
    const sc=100/(C.at(-1)||100), cl=C.map(v=>v*sc); const x=[...Array(cl.length).keys()], n=x.length||1;
    const sx=x.reduce((a,b)=>a+b,0), sxx=x.reduce((a,b)=>a+b*b,0), sy=cl.reduce((a,b)=>a+b,0), sxy=cl.reduce((a,b,i)=>a+b*cl[i],0);
    const d=n*sxx-sx*sx||1e-6, slope=(n*sxy-sx*sy)/d;

    const conf=(px?1:0)+(atr?1:0)+(rsi?1:0)+(macdDelta!=null?1:0);
    const baseW= tf==='H4'?0.35: tf==='H1'?0.30: tf==='M15'?0.20: 0.15;
    const weight= baseW*(1+0.1*conf);

    return {tf,weight,px,atr,rsi,macdMain,macdSig,macdDelta,slope,conf};
  }

  function median(a){ const s=a.slice().sort((x,y)=>x-y); const n=s.length; if(!n) return null; return n%2? s[(n-1)>>1] : (s[n>>1]-0+s[(n>>1)-1])/2; }

  function aggregate(rows, manualPx, manualAtr){
    const pxVals=rows.map(r=>r.px).filter(v=>v>0), atrVals=rows.map(r=>r.atr).filter(v=>v>0);
    const anchor = manualPx>0? manualPx : (median(pxVals)||manualPx||0);
    const atr = manualAtr>0? manualAtr : (median(atrVals)||10);
    const W=rows.reduce((s,r)=>s+r.weight,0)||1;
    const slope=rows.reduce((s,r)=>s+r.slope*r.weight,0)/W;
    const rsi=rows.reduce((s,r)=>s+((r.rsi??50)*r.weight),0)/W;
    const macdD=rows.reduce((s,r)=>s+((r.macdDelta??0)*r.weight),0)/W;

    // Day bias
    let db='SHORT';
    if( (slope>0 && macdD>=0) || rsi>52 ) db='LONG';
    if( (slope<0 && macdD<=0) || rsi<48 ) db='SHORT';

    // Score 0..100
    let score=50;
    score += Math.max(-10, Math.min(10, slope*25));
    score += Math.max(-10, Math.min(10, (rsi-50)/2));
    score += Math.max(-10, Math.min(10, macdD*12));
    score = Math.round(Math.max(35, Math.min(85, score)));
    const P = Math.max(20, Math.min(80, Math.round(25 + (score-50)*0.9)));

    return {anchor,atr,db,score,P,rsi,macdD,slope};
  }

  function decideDir(dayBias, mode){
    if(mode==='breakout'||mode==='continuation') return dayBias;
    if(mode==='reversion') return dayBias==='LONG'?'SHORT':'LONG';
    return dayBias;
  }

  function mkTicket(anchor, atr, dayBias, posture, range, label, mode, baseScore, baseP){
    const dir = decideDir(dayBias, mode);
    const mult= posture==='aggr'?1.2: posture==='safe'?0.8:1.0;
    const a=(atr||10)*mult;
    const mods = mode==='breakout'? +5 : mode==='reversion'? -3 : 0;
    const score = Math.max(30, Math.min(95, Math.round(baseScore + mods)));
    const P = Math.max(10, Math.min(90, Math.round(baseP + (mods*0.8))));

    let base=anchor||3335.00;
    if(dir==='LONG') base+=0.08; else base-=0.08;

    // Entry band tied to ATR for precision
    const band = Math.max(0.02, Math.min(0.25, (atr||10)*0.04*mult));
    const entryA=(base-band).toFixed(2), entryB=(base+band).toFixed(2);
    const side= dir==='LONG'?'BUY':'SELL';

    const k1 = mode==='reversion'?0.6:0.8, k2=mode==='reversion'?1.2:1.6, ks=mode==='reversion'?0.8:1.0;
    const tp1=(dir==='LONG'? base+k1*a : base-k1*a).toFixed(2);
    const tp2=(dir==='LONG'? base+k2*a : base-k2*a).toFixed(2);
    const sl =(dir==='LONG'? base-ks*a : base+ks*a).toFixed(2);

    return {range,label,dir,side,entry:`${entryA} – ${entryB}`,tp1,tp2,sl,score,P,mode};
  }

  function render(rows, agg){
    det.innerHTML='<tr><th>TF</th><th>Price</th><th>ATR</th><th>RSI</th><th>MACDΔ</th><th>Slope</th><th>Conf</th></tr>';
    const order={'H4':1,'H1':2,'M15':3,'M5':4};
    rows.sort((a,b)=>(order[a.tf]||9)-(order[b.tf]||9)).forEach(r=>{
      det.innerHTML += `<tr><td><span class="badge">${r.tf}</span></td><td>${r.px? r.px.toFixed(2):'—'}</td><td>${r.atr? r.atr.toFixed(2):'—'}</td><td>${r.rsi??'—'}</td><td>${(r.macdDelta??0).toFixed(2)}</td><td>${r.slope>0?'↑':r.slope<0?'↓':'→'}</td><td>${r.conf}</td></tr>`;
    });

    const posture=postureSel.value;
    const schedule=[
      ['00:00–02:00','Asia Early','continuation'],
      ['02:00–04:00','Asia Mid','continuation'],
      ['04:00–06:00','Asia Late','continuation'],
      ['06:00–08:00','Pre‑London','reversion'],
      ['08:00–10:00','London Open','breakout'],
      ['10:00–12:00','London Mid','continuation'],
      ['12:00–13:00','EU Lunch','reversion'],
      ['13:00–15:00','US Pre‑data','continuation'],
      ['15:00–16:00','US Data','breakout'],
      ['16:00–17:00','London Close','reversion'],
      ['17:00–19:00','US Mid','continuation'],
      ['19:00–21:00','US Late','continuation'],
      ['21:00–23:00','Asia Pre‑open','reversion'],
      ['23:00–00:00','Roll','reversion']
    ];

    tickets.innerHTML='';
    for(const [range,label,mode] of schedule){
      const t=mkTicket(agg.anchor, agg.atr, agg.db, posture, range, label, mode, agg.score, agg.P);
      const el=document.createElement('div'); el.className='card';
      el.innerHTML = `
        <div class="row">
          <div class="time">${t.range} → <span class="dir ${t.dir==='LONG'?'long':'short'}">${t.dir}</span></div>
          <div class="pill">${t.label} • Score ${t.score} • P≈${t.P}%</div>
        </div>
        <div class="order ${t.side==='BUY'?'buy':'sell'}">${t.side}</div>
        <div class="entry">Entry: ${t.entry}</div>
        <div class="tp">TP1: ${t.tp1} | TP2: ${t.tp2}</div>
        <div class="stop">Stop: ${t.sl}</div>
        <div class="rule"></div>
        <div class="note">Mode: ${t.mode}. Absolute prices. Provide Price/ATR if OCR misses.</div>
      `;
      tickets.appendChild(el);
    }
  }

  async function run(){
    try{
      state.textContent='Analyzing…'; log('Analyze start');
      const manualPx=parseFloat(priceEl.value||'0'), manualAtr=parseFloat(atrEl.value||'0');
      const rows=[];
      for(const im of images){ rows.push(await readOne(im)); }
      if(rows.length===0){ rows.push({tf:'M15',weight:1,px:manualPx||3335.0,atr:manualAtr||10,rsi:50,macdDelta:0,slope:0,conf:0}); }
      const agg=aggregate(rows, manualPx, manualAtr);
      render(rows, agg);
      state.textContent='Done'; log('Done');
    }catch(e){ state.textContent='Error'; log('Error '+(e?.message||e)); }
  }

  document.getElementById('analyzeBtn').addEventListener('click', run);
})();