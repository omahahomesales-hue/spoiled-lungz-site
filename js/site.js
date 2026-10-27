(function(){
  "use strict";
  var cfg = window.SL_CONFIG || {};
  var sb = (cfg.supabaseUrl && cfg.supabaseKey && window.supabase) ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;
  window.SL_SB = sb;

  /* ---------- Fallback content (used until Supabase is connected) ---------- */
  var FALLBACK = {
    locations: [
      {id:"l1", name:"Plant'd Farma Wellness Boutique", street:"1207 Harney St", city_state_zip:"Omaha, NE 68102", area:"Downtown Omaha"},
      {id:"l2", name:"Tree Haus Cannabis Boutique", street:"3863 Farnam St Ste 3", city_state_zip:"Omaha, NE 68131", area:"Midtown Omaha"}
    ],
    products: [],
    merch: []
  };

  var CATS = {
    flower:{label:"Flower", color:"var(--lime)", blurb:"Dense, frosty, and hand-selected. Our flower is chosen for flavor, bag appeal, and an experience worth bragging about."},
    edibles:{label:"Edibles", color:"var(--pink)", blurb:"Candy-shop flavors with consistent, carefully measured doses. Sweet first, then exactly what you came for."},
    concentrates:{label:"Concentrates", color:"var(--gold)", blurb:"Golden, sticky, and potent. Small-batch concentrates for people who know exactly what they're looking for."},
    vapes:{label:"Vapes", color:"var(--berry)", blurb:"Smooth pulls and true-to-strain flavor in a discreet, grab-and-go format."}
  };

  var DATA = {locations:FALLBACK.locations, products:FALLBACK.products, merch:FALLBACK.merch};

  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function safeUrl(u){ return /^https:\/\//i.test(u||"") ? u : ""; }
  function money(c){ return (c==null) ? "" : "$" + (c/100).toFixed(c%100 ? 2 : 0); }
  function locName(id){ for(var i=0;i<DATA.locations.length;i++){ if(DATA.locations[i].id===id) return DATA.locations[i].name; } return null; }

  /* ---------- Locations ---------- */
  function mapUrl(l){ return "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(l.name+" "+l.street+" "+l.city_state_zip); }
  function locCard(l){
    return '<article class="loc">'+(l.area?'<span class="tag">'+esc(l.area)+'</span>':'')+'<h3>'+esc(l.name)+'</h3>'+
      '<address>'+esc(l.street)+'<br>'+esc(l.city_state_zip)+'<br>United States</address>'+
      (l.hours?'<p class="loc-meta">'+esc(l.hours)+'</p>':'')+
      (l.phone?'<p class="loc-meta">'+esc(l.phone)+'</p>':'')+
      '<a class="btn btn-ghost" href="'+mapUrl(l)+'" target="_blank" rel="noopener">Get directions &rarr;</a></article>';
  }
  function renderLocations(){
    document.querySelectorAll("[data-locs]").forEach(function(el){ el.innerHTML = DATA.locations.map(locCard).join(""); });
    var foot=document.getElementById("foot-locs");
    if(foot) foot.innerHTML = DATA.locations.map(function(l){ return '<li>'+esc(l.name)+'<br>'+esc(l.street)+', '+esc(l.city_state_zip.split(",")[0])+'</li>'; }).join("");
  }

  /* ---------- Merch ---------- */
  function renderMerch(){
    var grid=document.getElementById("merch-grid"), note=document.getElementById("merch-note");
    if(!DATA.merch.length){
      var demo=[["Logo Tee","Heavyweight cotton"],["Drip Hoodie","Embroidered wordmark"],["Snapback","Gold script patch"],["Rolling Tray","Full-color artwork"]];
      grid.innerHTML = demo.map(function(m){ return '<article class="card" style="--c:var(--pink)"><div class="ph">Photo coming soon</div><div class="card-body"><strong>'+m[0]+'</strong><span>'+m[1]+'</span></div></article>'; }).join("");
      note.hidden=false; return;
    }
    note.hidden=true;
    grid.innerHTML = DATA.merch.map(function(m){
      var img = safeUrl(m.image_url) ? '<img class="card-img" src="'+esc(m.image_url)+'" alt="'+esc(m.name)+'" loading="lazy">' : '<div class="ph">Photo coming soon</div>';
      var buy = m.sold_out ? '<span class="pill pill-out">Sold out</span>'
        : safeUrl(m.buy_url) ? '<a class="btn btn-gold btn-sm" href="'+esc(m.buy_url)+'" target="_blank" rel="noopener">Buy now</a>'
        : '<span class="pill">Coming soon</span>';
      return '<article class="card" style="--c:var(--pink)">'+img+'<div class="card-body"><div class="card-row"><strong>'+esc(m.name)+'</strong><span class="price">'+money(m.price_cents)+'</span></div>'+
        (m.description?'<span>'+esc(m.description)+'</span>':'')+'<div class="card-actions">'+buy+'</div></div></article>';
    }).join("");
  }

  /* ---------- Products ---------- */
  var panel=document.getElementById("cat-panel"), currentCat="flower";
  function productCard(p, c){
    var img = safeUrl(p.image_url) ? '<img class="card-img" src="'+esc(p.image_url)+'" alt="'+esc(p.name)+'" loading="lazy">' : '<div class="ph">Product photo<br>coming soon</div>';
    var where = (p.available_at||[]).map(locName).filter(Boolean);
    return '<article class="card">'+(p.members_only?'<span class="badge badge-members">Members only</span>':p.is_new?'<span class="badge">New drop</span>':'')+img+
      '<div class="card-body"><strong>'+esc(p.name)+'</strong>'+(p.subtitle?'<span class="sub">'+esc(p.subtitle)+'</span>':'')+
      (p.description?'<p class="desc">'+esc(p.description)+'</p>':'')+
      '<span class="where">'+(where.length? 'At '+where.map(esc).join(' · ') : c.label+' · Available in store')+'</span></div></article>';
  }
  function showCat(key){
    if(!CATS[key]) key="flower"; currentCat=key; var c=CATS[key];
    document.querySelectorAll(".subtab").forEach(function(b){ b.setAttribute("aria-selected", b.dataset.cat===key?"true":"false"); });
    panel.style.setProperty("--c", c.color);
    panel.setAttribute("aria-labelledby","st-"+key);
    var items = DATA.products.filter(function(p){ return p.category===key; });
    var grid = items.length ? items.map(function(p){ return productCard(p,c); }).join("")
      : ["Drop #1","Drop #2","Drop #3","Drop #4"].map(function(n){ return '<article class="card"><div class="ph">Product photo<br>coming soon</div><div class="card-body"><strong>'+n+'</strong><span class="where">'+c.label+' · Available in store</span></div></article>'; }).join("");
    panel.innerHTML =
      '<div class="cat-intro"><div><span class="eyebrow">Category</span><h2>'+c.label+'</h2><p>'+c.blurb+'</p></div>'+
      '<a class="btn btn-gold" href="#locations" data-go="locations">Find it in store</a></div>'+
      '<div class="grid">'+grid+'</div>'+
      '<div class="note"><b>Heads up</b> '+(items.length?'Menu changes often and availability varies by boutique. Call ahead for the latest.':'New products are on the way. Availability varies by boutique.')+'</div>';
  }
  document.querySelectorAll(".subtab").forEach(function(b){ b.addEventListener("click",function(){ showCat(b.dataset.cat); }); });

  /* ---------- Featured on home ---------- */
  function renderFeatured(){
    var wrap=document.getElementById("featured"), grid=document.getElementById("featured-grid");
    var f = DATA.products.filter(function(p){ return p.featured; }).slice(0,4);
    if(!f.length){ wrap.hidden=true; return; }
    wrap.hidden=false;
    grid.innerHTML = f.map(function(p){ return productCard(p, CATS[p.category]||CATS.flower); }).join("");
  }

  /* ---------- Routing ---------- */
  var PAGES=["home","products","merch","locations","about","members","contact"];
  function go(page, cat, push){
    if(PAGES.indexOf(page)<0) page="home";
    document.querySelectorAll("section.page").forEach(function(s){ s.hidden = s.dataset.page!==page; });
    document.querySelectorAll(".tab").forEach(function(t){ if(t.dataset.go===page) t.setAttribute("aria-current","page"); else t.removeAttribute("aria-current"); });
    if(page==="products") showCat(cat||currentCat);
    var active=document.querySelector('.tab[aria-current="page"]'); if(active&&active.scrollIntoView) active.scrollIntoView({block:"nearest",inline:"nearest"});
    window.scrollTo(0,0);
    if(push!==false){ try{ history.replaceState(null,"","#"+(page==="products"&&cat?cat:page)); }catch(e){} }
    try{ document.dispatchEvent(new CustomEvent("sl:page",{detail:page})); }catch(e){}
  }
  window.SL_GO = go;
  document.addEventListener("click",function(e){
    var el=e.target.closest("[data-go]"); if(!el) return;
    e.preventDefault(); go(el.dataset.go, el.dataset.cat);
  });
  function fromHash(){
    var h=(location.hash||"").replace("#","");
    if(/access_token|error_description|type=/.test(h)) return;
    if(CATS[h]) go("products",h,false); else go(h||"home",null,false);
  }
  window.addEventListener("hashchange",fromHash);

  function renderAll(){ renderLocations(); renderMerch(); renderFeatured(); fromHash(); }
  renderAll();

  /* ---------- Load live content ---------- */
  function loadLive(){
    if(!sb) return;
    Promise.all([
      sb.from("locations").select("*").eq("published",true).order("sort").order("created_at"),
      sb.from("products").select("*").eq("published",true).order("sort").order("created_at",{ascending:false}),
      sb.from("merch").select("*").eq("published",true).order("sort").order("created_at",{ascending:false})
    ]).then(function(r){
      if(!r[0].error && r[0].data.length) DATA.locations=r[0].data;
      if(!r[1].error) DATA.products=r[1].data;
      if(!r[2].error) DATA.merch=r[2].data;
      renderAll();
    }).catch(function(){ /* keep fallback content */ });
  }
  window.SL_RELOAD = loadLive;
  loadLive();

  /* ---------- Age gate ---------- */
  var gate=document.getElementById("gate"), KEY="sl_age_ok";
  var ok=false; try{ ok = localStorage.getItem(KEY)==="1"; }catch(e){}
  function unlock(){ gate.hidden=true; document.body.classList.remove("locked"); }
  if(ok) unlock(); else { document.body.classList.add("locked"); document.getElementById("gate-yes").focus(); }
  document.getElementById("gate-yes").addEventListener("click",function(){ try{localStorage.setItem(KEY,"1");}catch(e){} unlock(); });
  document.getElementById("gate-no").addEventListener("click",function(){
    document.getElementById("gate-btns").hidden=true; document.getElementById("gate-deny").hidden=false;
  });

  /* ---------- Contact form ---------- */
  var form=document.getElementById("contact-form"), status=document.getElementById("cf-status"), sendBtn=form.querySelector('button[type="submit"]');
  function say(msg, bad){ status.hidden=false; status.style.color = bad ? "var(--pink)" : ""; status.textContent=msg; }
  form.addEventListener("submit",function(e){
    e.preventDefault();
    if(form.website && form.website.value) return; // honeypot
    if(!form.checkValidity()){ say("Please add your name, a valid email, and a message.", true); return; }
    var row={ name:form.name.value.trim(), email:form.email.value.trim(), topic:form.topic.value, body:form.message.value.trim() };
    if(!sb){ say("Thanks! (Preview only: messages start arriving once the site is connected.)"); form.reset(); return; }
    sendBtn.disabled=true; say("Sending…");
    sb.from("messages").insert(row).then(function(res){
      sendBtn.disabled=false;
      if(res.error){ say("Your message didn't send. Check your connection and try again.", true); return; }
      say("Message sent. The Spoiled Lungz team will get back to you soon."); form.reset();
    });
  });
  document.getElementById("yr").textContent=new Date().getFullYear();
})();
