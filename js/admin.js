(function(){
  "use strict";
  var cfg = window.SL_CONFIG || {};
  var $ = function(id){ return document.getElementById(id); };
  if(!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase){ $("noconfig").hidden=false; return; }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  var CATEGORIES = [["flower","Flower"],["edibles","Edibles"],["concentrates","Concentrates"],["vapes","Vapes"]];
  var state = { tab:"products", rows:{products:[],merch:[],locations:[],messages:[]}, sel:null, filter:"all" };

  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  var toastT;
  function toast(msg, bad){ var t=$("toast"); t.textContent=msg; t.className="toast"+(bad?" bad":""); t.hidden=false; clearTimeout(toastT); toastT=setTimeout(function(){t.hidden=true;}, bad?5000:2500); }
  function catLabel(k){ for(var i=0;i<CATEGORIES.length;i++) if(CATEGORIES[i][0]===k) return CATEGORIES[i][1]; return k; }

  /* ---------- Auth ---------- */
  $("login-form").addEventListener("submit", function(e){
    e.preventDefault(); $("login-err").textContent="";
    var btn=e.target.querySelector("button"); btn.disabled=true;
    sb.auth.signInWithPassword({ email:$("li-email").value.trim(), password:$("li-pass").value }).then(function(r){
      btn.disabled=false;
      if(r.error){ $("login-err").textContent="That email and password didn't match. Try again."; return; }
      boot(r.data.session);
    });
  });
  $("signout").addEventListener("click", function(){ sb.auth.signOut().then(function(){ location.reload(); }); });

  $("forgot").addEventListener("click", function(){
    var email=$("li-email").value.trim();
    $("login-err").textContent=""; $("login-ok").hidden=true;
    if(!email){ $("login-err").textContent="Type your email above first, then click Forgot password."; return; }
    var btn=this; btn.disabled=true;
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/admin" }).then(function(r){
      btn.disabled=false;
      if(r.error){ $("login-err").textContent = /rate|seconds/i.test(r.error.message) ? "Too many reset emails. Wait a few minutes and try again." : r.error.message; return; }
      $("login-ok").hidden=false; $("login-ok").textContent="Check your email for a reset link. It opens this page so you can pick a new password.";
    });
  });

  var recovering = /type=recovery/.test(location.hash);
  function showSetPass(){ recovering=true; $("login").hidden=true; $("app").hidden=true; $("setpass").hidden=false; $("sp-pass").focus(); }
  sb.auth.onAuthStateChange(function(event){ if(event==="PASSWORD_RECOVERY") showSetPass(); });
  $("setpass-form").addEventListener("submit", function(e){
    e.preventDefault(); $("setpass-err").textContent="";
    var p1=$("sp-pass").value, p2=$("sp-pass2").value;
    if(p1.length<8){ $("setpass-err").textContent="Use at least 8 characters."; return; }
    if(p1!==p2){ $("setpass-err").textContent="The two passwords don't match."; return; }
    var btn=e.target.querySelector("button"); btn.disabled=true;
    sb.auth.updateUser({ password:p1 }).then(function(r){
      btn.disabled=false;
      if(r.error){ $("setpass-err").textContent = /expired|invalid|session/i.test(r.error.message) ? "This reset link has expired. Go back to sign in and click Forgot password again." : r.error.message; return; }
      try{ history.replaceState(null,"",location.pathname); }catch(_){}
      recovering=false; $("setpass").hidden=true; toast("Password saved");
      sb.auth.getSession().then(function(s){ if(s.data.session) boot(s.data.session); else $("login").hidden=false; });
    });
  });

  sb.auth.getSession().then(function(r){
    if(recovering){ if(r.data.session) showSetPass(); else { $("login").hidden=false; $("login-err").textContent="This reset link has expired. Click Forgot password to get a new one."; } return; }
    if(r.data.session) boot(r.data.session); else $("login").hidden=false;
  });

  function boot(session){
    $("login").hidden=true; $("app").hidden=false;
    $("who").textContent=session.user.email;
    sb.rpc("is_admin").then(function(r){ $("not-admin").hidden = !!r.data; });
    loadAll().then(function(){ switchTab("products"); });
  }

  /* ---------- Data ---------- */
  function load(table){
    var q = sb.from(table).select("*");
    q = table==="messages" ? q.order("created_at",{ascending:false}) : q.order("sort").order("created_at",{ascending:false});
    return q.then(function(r){ if(r.error){ toast("Couldn't load "+table+": "+r.error.message, true); return; } state.rows[table]=r.data; updateCounts(); });
  }
  function loadAll(){ return Promise.all(["locations","products","merch","messages"].map(load)); }
  function updateCounts(){
    $("c-products").textContent=state.rows.products.length;
    $("c-merch").textContent=state.rows.merch.length;
    $("c-locations").textContent=state.rows.locations.length;
    var unread=state.rows.messages.filter(function(m){return !m.handled;}).length;
    $("c-messages").textContent= unread ? unread+" new" : "";
  }

  /* ---------- Tabs ---------- */
  document.querySelectorAll(".tab").forEach(function(b){ b.addEventListener("click", function(){ switchTab(b.dataset.t); }); });
  function switchTab(t){
    state.tab=t; state.sel=null; state.filter="all";
    document.querySelectorAll(".tab").forEach(function(b){ b.setAttribute("aria-selected", b.dataset.t===t?"true":"false"); });
    var isMsg = t==="messages";
    $("work").hidden=isMsg; $("messages-panel").hidden=!isMsg;
    if(isMsg){ renderMessages(); return; }
    renderFilters(); renderList(); renderEditor(null);
  }

  function renderFilters(){
    var f=$("filters");
    if(state.tab!=="products"){ f.innerHTML='<strong style="font-size:1rem">'+(state.tab==="merch"?"Merch items":"Boutique locations")+'</strong>'; return; }
    f.innerHTML='<label for="f-cat" class="hint" style="display:flex;align-items:center;gap:8px">Show<select id="f-cat"><option value="all">All categories</option>'+
      CATEGORIES.map(function(c){return '<option value="'+c[0]+'">'+c[1]+'</option>';}).join("")+'</select></label>';
    $("f-cat").value=state.filter;
    $("f-cat").addEventListener("change", function(e){ state.filter=e.target.value; renderList(); });
  }

  function renderList(){
    var rows=state.rows[state.tab];
    if(state.tab==="products" && state.filter!=="all") rows=rows.filter(function(r){return r.category===state.filter;});
    if(!rows.length){ $("list").innerHTML='<p class="empty">Nothing here yet. Click <b>+ Add new</b> to create the first one.</p>'; return; }
    $("list").innerHTML=rows.map(function(r){
      var sub = state.tab==="products" ? catLabel(r.category)+(r.subtitle?" · "+esc(r.subtitle):"")
        : state.tab==="merch" ? (r.price_cents!=null?"$"+(r.price_cents/100).toFixed(2):"No price")+(r.buy_url?" · Buy link set":" · No buy link")
        : esc(r.street)+", "+esc(r.city_state_zip);
      var thumb = state.tab==="locations" ? '<div class="thumb" style="display:grid;place-items:center;color:var(--gold);font-weight:900">'+esc((r.name||"?")[0])+'</div>'
        : r.image_url ? '<img class="thumb" src="'+esc(r.image_url)+'" alt="">' : '<div class="thumb"></div>';
      var chips = (r.is_new?'<span class="chip new">New</span> ':'')+(r.sold_out?'<span class="chip new">Sold out</span> ':'')+
        (r.published?'<span class="chip live">Live</span>':'<span class="chip">Hidden</span>');
      return '<button type="button" class="row'+(state.sel&&state.sel.id===r.id?' sel':'')+'" data-id="'+r.id+'">'+thumb+
        '<span class="row-main"><strong>'+esc(r.name)+'</strong><span>'+sub+'</span></span><span>'+chips+'</span></button>';
    }).join("");
    $("list").querySelectorAll(".row").forEach(function(b){ b.addEventListener("click", function(){
      var r=state.rows[state.tab].filter(function(x){return x.id===b.dataset.id;})[0]; state.sel=r; renderList(); renderEditor(r);
      if(window.innerWidth<900) $("editor-panel").scrollIntoView({behavior:"smooth"});
    }); });
  }
  $("add").addEventListener("click", function(){
    state.sel={}; renderList();
    renderEditor({ published:true, category: state.filter!=="all"?state.filter:"flower", available_at: state.rows.locations.map(function(l){return l.id;}) });
    if(window.innerWidth<900) $("editor-panel").scrollIntoView({behavior:"smooth"});
  });

  /* ---------- Editor ---------- */
  function field(id,label,val,type,extra){ return '<label for="'+id+'">'+label+'<input id="'+id+'" type="'+(type||"text")+'" value="'+esc(val)+'" '+(extra||"")+'></label>'; }
  function area(id,label,val,hint){ return '<label for="'+id+'">'+label+(hint?' <span class="hint">'+hint+'</span>':'')+'<textarea id="'+id+'">'+esc(val)+'</textarea></label>'; }
  function check(id,label,val){ return '<label class="check" for="'+id+'"><input id="'+id+'" type="checkbox" '+(val?"checked":"")+'>'+label+'</label>'; }
  function imageField(url){
    return '<div style="display:grid;gap:8px"><span style="font-weight:700;font-size:.85rem">Photo <span class="hint">Square photos look best. JPG, PNG or WebP under 10 MB.</span></span>'+
      '<img class="preview" id="e-preview" alt="" '+(url?'src="'+esc(url)+'"':'hidden')+'>'+
      '<input id="e-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif">'+
      '<input id="e-image" type="hidden" value="'+esc(url)+'">'+
      (url?'<button type="button" class="btn btn-link" id="e-clear-img" style="justify-self:start">Remove photo</button>':'')+'</div>';
  }

  function renderEditor(r){
    var ed=$("editor");
    if(!r){ ed.innerHTML='<p class="empty">Pick an item to edit, or add a new one.</p>'; return; }
    var isNew=!r.id, t=state.tab, html='<form class="editor" id="e-form"><h2 style="font-size:1.4rem">'+(isNew?"Add ":"Edit ")+(t==="products"?"product":t==="merch"?"merch item":"location")+'</h2>';
    if(t==="products"){
      html+='<div class="two"><label for="e-category">Category<select id="e-category">'+CATEGORIES.map(function(c){return '<option value="'+c[0]+'"'+(r.category===c[0]?" selected":"")+'>'+c[1]+'</option>';}).join("")+'</select></label>'+
        field("e-name","Name",r.name,"text","required maxlength=\"120\"")+'</div>'+
        field("e-subtitle",'Details line <span class="hint">e.g. Hybrid · Gelato x Runtz</span>',r.subtitle,"text","maxlength=\"120\"")+
        area("e-description","Description",r.description,"Flavor, effects, what makes it special")+
        imageField(r.image_url)+
        '<div class="locs-pick"><span style="font-weight:700;font-size:.85rem">Available at</span>'+state.rows.locations.map(function(l){
          return '<label class="check"><input type="checkbox" class="e-loc" value="'+l.id+'" '+((r.available_at||[]).indexOf(l.id)>-1?"checked":"")+'>'+esc(l.name)+'</label>'; }).join("")+'</div>'+
        '<div class="two">'+check("e-new","Mark as new drop",r.is_new)+check("e-featured","Feature on home page",r.featured)+'</div>';
    } else if(t==="merch"){
      html+=field("e-name","Name",r.name,"text","required maxlength=\"120\"")+
        '<div class="two">'+field("e-price","Price (USD)",r.price_cents!=null?(r.price_cents/100).toFixed(2):"","number",'min="0" step="0.01" inputmode="decimal"')+
        field("e-buy",'Stripe payment link',r.buy_url,"url",'placeholder="https://buy.stripe.com/…"')+'</div>'+
        area("e-description","Description",r.description)+imageField(r.image_url)+check("e-soldout","Sold out",r.sold_out);
    } else {
      html+=field("e-name","Boutique name",r.name,"text","required")+field("e-street","Street",r.street,"text","required")+
        field("e-city","City, state, ZIP",r.city_state_zip,"text",'required placeholder="Omaha, NE 68102"')+
        '<div class="two">'+field("e-area",'Area label <span class="hint">e.g. Midtown Omaha</span>',r.area)+field("e-phone","Phone",r.phone,"tel")+'</div>'+
        field("e-hours",'Hours <span class="hint">e.g. Mon–Sat 10am–9pm</span>',r.hours);
    }
    html+='<div class="two">'+check("e-published","Show on website",r.published)+field("e-sort",'Sort order <span class="hint">Lower shows first</span>',r.sort||0,"number")+'</div>'+
      '<div class="actions"><button class="btn btn-gold" type="submit" id="e-save">'+(isNew?"Create":"Save changes")+'</button>'+
      (isNew?'':'<button class="btn btn-danger" type="button" id="e-del">Delete</button>')+
      '<button class="btn btn-link" type="button" id="e-cancel">Cancel</button></div><div id="e-confirm"></div></form>';
    ed.innerHTML=html;

    var file=$("e-file");
    if(file) file.addEventListener("change", function(){
      var f=file.files[0]; if(!f) return;
      if(f.size>10485760){ toast("That photo is over 10 MB. Pick a smaller one.", true); file.value=""; return; }
      var p=$("e-preview"); p.src=URL.createObjectURL(f); p.hidden=false;
    });
    if($("e-clear-img")) $("e-clear-img").addEventListener("click", function(){ $("e-image").value=""; $("e-preview").hidden=true; if(file) file.value=""; this.remove(); });
    $("e-cancel").addEventListener("click", function(){ state.sel=null; renderList(); renderEditor(null); });
    if($("e-del")) $("e-del").addEventListener("click", function(){
      $("e-confirm").innerHTML='<div class="confirm">Delete "'+esc(r.name)+'" permanently? <button type="button" class="btn btn-danger" id="e-del-yes">Yes, delete</button><button type="button" class="btn btn-link" id="e-del-no">Keep it</button></div>';
      $("e-del-no").onclick=function(){ $("e-confirm").innerHTML=""; };
      $("e-del-yes").onclick=function(){
        sb.from(t).delete().eq("id",r.id).then(function(res){
          if(res.error){ toast("Delete failed: "+res.error.message, true); return; }
          toast("Deleted"); state.sel=null; load(t).then(function(){ renderList(); renderEditor(null); });
        });
      };
    });
    $("e-form").addEventListener("submit", function(e){ e.preventDefault(); save(r); });
  }

  function uploadIfNeeded(){
    var file=$("e-file"), current=$("e-image") ? $("e-image").value : null;
    if(!file || !file.files[0]) return Promise.resolve(current||null);
    var f=file.files[0], ext=(f.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
    var path=state.tab+"/"+Date.now()+"-"+Math.random().toString(36).slice(2,8)+"."+ext;
    return sb.storage.from("media").upload(path, f, { cacheControl:"31536000", contentType:f.type }).then(function(r){
      if(r.error) throw new Error("Photo upload failed: "+r.error.message);
      return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
    });
  }

  function save(r){
    var t=state.tab, btn=$("e-save"); btn.disabled=true; btn.textContent="Saving…";
    uploadIfNeeded().then(function(imageUrl){
      var row={ name:$("e-name").value.trim(), published:$("e-published").checked, sort:parseInt($("e-sort").value,10)||0 };
      if(t==="products"){
        row.category=$("e-category").value; row.subtitle=$("e-subtitle").value.trim()||null; row.description=$("e-description").value.trim()||null;
        row.image_url=imageUrl; row.is_new=$("e-new").checked; row.featured=$("e-featured").checked;
        row.available_at=[].slice.call(document.querySelectorAll(".e-loc:checked")).map(function(c){return c.value;});
      } else if(t==="merch"){
        var p=$("e-price").value; row.price_cents = p==="" ? null : Math.round(parseFloat(p)*100);
        var u=$("e-buy").value.trim(); if(u && !/^https:\/\//i.test(u)) throw new Error("The payment link has to start with https://");
        row.buy_url=u||null; row.description=$("e-description").value.trim()||null; row.image_url=imageUrl; row.sold_out=$("e-soldout").checked;
      } else {
        row.street=$("e-street").value.trim(); row.city_state_zip=$("e-city").value.trim(); row.area=$("e-area").value.trim()||null;
        row.phone=$("e-phone").value.trim()||null; row.hours=$("e-hours").value.trim()||null;
      }
      if(!row.name) throw new Error("Add a name before saving.");
      var q = r.id ? sb.from(t).update(row).eq("id",r.id).select().single() : sb.from(t).insert(row).select().single();
      return q.then(function(res){
        if(res.error) throw new Error(res.error.message.indexOf("row-level security")>-1 ? "This account isn't allowed to make changes." : res.error.message);
        toast(r.id?"Saved":"Created"); state.sel=res.data;
        return load(t).then(function(){ renderList(); renderEditor(res.data); });
      });
    }).catch(function(err){ toast(err.message, true); btn.disabled=false; btn.textContent=r.id?"Save changes":"Create"; });
  }

  /* ---------- Messages ---------- */
  function renderMessages(){
    var m=state.rows.messages;
    if(!m.length){ $("messages").innerHTML='<p class="empty">No messages yet. Contact form submissions will show up here.</p>'; return; }
    $("messages").innerHTML=m.map(function(x){
      return '<article class="msg" style="'+(x.handled?'opacity:.6':'')+'"><header><strong>'+esc(x.name)+' &middot; <span style="user-select:all">'+esc(x.email)+'</span></strong>'+
        '<span class="meta">'+esc(x.topic||"")+' · '+new Date(x.created_at).toLocaleString()+'</span></header><p>'+esc(x.body)+'</p>'+
        '<div class="actions"><button class="btn btn-link" data-h="'+x.id+'">'+(x.handled?"Mark as new":"Mark handled")+'</button></div></article>';
    }).join("");
    $("messages").querySelectorAll("[data-h]").forEach(function(b){ b.addEventListener("click", function(){
      var x=m.filter(function(y){return y.id===b.dataset.h;})[0];
      sb.from("messages").update({handled:!x.handled}).eq("id",x.id).then(function(res){
        if(res.error){ toast(res.error.message, true); return; }
        load("messages").then(renderMessages);
      });
    }); });
  }
})();
