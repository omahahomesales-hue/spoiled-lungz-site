(function(){
  "use strict";
  var cfg = window.SL_CONFIG || {};
  var $ = function(id){ return document.getElementById(id); };
  if(!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase){ $("noconfig").hidden=false; return; }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  var CATEGORIES = [["flower","Flower"],["edibles","Edibles"],["concentrates","Concentrates"],["vapes","Vapes"]];
  var ORDER_STATUS = { new:"New", confirmed:"Confirmed", out_for_delivery:"Out for delivery", ready_for_pickup:"Ready for pickup", completed:"Completed", cancelled:"Cancelled" };
  var ORDER_CHIP = { new:"new-order", confirmed:"confirmed", out_for_delivery:"out", ready_for_pickup:"ready", completed:"done", cancelled:"cancelled" };
  var MEMBER_STATUS = { pending:"Pending", approved:"Approved", denied:"Denied", revoked:"Revoked" };
  var OPEN = ["new","confirmed","out_for_delivery","ready_for_pickup"];
  var state = { role:null, email:"", tab:"orders", rows:{products:[],merch:[],locations:[],messages:[],members:[],orders:[],staff:[]}, sel:null, filter:"all" };

  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function money(c){ return c==null ? "—" : "$"+(c/100).toFixed(2); }
  function when(t){ return new Date(t).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); }
  var toastT;
  function toast(msg, bad){ var t=$("toast"); t.textContent=msg; t.className="toast"+(bad?" bad":""); t.hidden=false; clearTimeout(toastT); toastT=setTimeout(function(){t.hidden=true;}, bad?5000:2500); }
  function catLabel(k){ for(var i=0;i<CATEGORIES.length;i++) if(CATEGORIES[i][0]===k) return CATEGORIES[i][1]; return k; }
  function cleanErr(m){ m=String(m||""); if(m.indexOf("row-level security")>-1) return "This account isn't allowed to make that change."; return m; }
  function age(dob){ if(!dob) return ""; var d=new Date(dob+"T12:00:00"), n=new Date(), a=n.getFullYear()-d.getFullYear(); if(n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate())) a--; return a; }
  function locName(id){ var l=state.rows.locations.filter(function(x){return x.id===id;})[0]; return l?l.name:"boutique"; }

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
    state.email=(session.user.email||"").toLowerCase();
    $("who").textContent=session.user.email;
    sb.rpc("my_staff_role").then(function(r){
      state.role = r.data || null;
      if(!state.role){ $("not-admin").hidden=false; $("not-admin").textContent="This account isn't on the staff list, so you can't see or change anything here. Ask the owner to add your email under Staff & drivers."; return; }
      if(state.role==="driver"){
        document.querySelectorAll(".tab").forEach(function(b){ if(b.dataset.t!=="orders") b.hidden=true; });
        document.querySelector('.tab[data-t="orders"]').firstChild.textContent="My deliveries";
        document.querySelector(".bar h2").textContent="Deliveries";
        load("orders").then(function(){ switchTab("orders"); });
      } else {
        loadAll().then(function(){ switchTab(state.rows.members.some(function(m){return m.status==="pending";}) && !state.rows.orders.some(function(o){return o.status==="new";}) ? "members" : "orders"); });
      }
      setInterval(function(){ if(document.hidden) return; load("orders").then(function(){ if(state.tab==="orders") renderList(); }); if(state.role==="admin") load("members").then(function(){ if(state.tab==="members") renderList(); }); }, 60000);
    });
  }

  /* ---------- Data ---------- */
  function load(table){
    var q;
    if(table==="orders") q = sb.from("orders").select("*, order_items(*)").order("created_at",{ascending:false}).limit(300);
    else if(table==="members") q = sb.from("members").select("*").order("created_at",{ascending:false});
    else if(table==="staff") q = sb.from("admins").select("*").order("role").order("email");
    else if(table==="messages") q = sb.from("messages").select("*").order("created_at",{ascending:false});
    else q = sb.from(table).select("*").order("sort").order("created_at",{ascending:false});
    return q.then(function(r){
      if(r.error){ toast("Couldn't load "+table+": "+r.error.message, true); return; }
      state.rows[table] = table==="staff" ? r.data.map(function(x){ x.id=x.email; return x; }) : r.data;
      updateCounts();
    });
  }
  function loadAll(){ return Promise.all(["locations","products","merch","messages","members","orders","staff"].map(load)); }
  function setCount(id, text, hot){ var el=$(id); if(!el) return; el.textContent=text; el.className="count"+(hot?" hot":""); }
  function updateCounts(){
    var newOrders=state.rows.orders.filter(function(o){return o.status==="new";}).length;
    var open=state.rows.orders.filter(function(o){return OPEN.indexOf(o.status)>-1;}).length;
    setCount("c-orders", newOrders ? newOrders+" new" : (open||""), !!newOrders);
    var pend=state.rows.members.filter(function(m){return m.status==="pending";}).length;
    setCount("c-members", pend ? pend+" to review" : (state.rows.members.length||""), !!pend);
    setCount("c-products", state.rows.products.length);
    setCount("c-merch", state.rows.merch.length);
    setCount("c-locations", state.rows.locations.length);
    var unread=state.rows.messages.filter(function(m){return !m.handled;}).length;
    setCount("c-messages", unread ? unread+" new" : "", !!unread);
  }

  /* ---------- Tabs ---------- */
  document.querySelectorAll(".tab").forEach(function(b){ b.addEventListener("click", function(){ switchTab(b.dataset.t); }); });
  function switchTab(t){
    state.tab=t; state.sel=null;
    state.filter = t==="orders" ? "open" : t==="members" ? "pending" : "all";
    document.querySelectorAll(".tab").forEach(function(b){ b.setAttribute("aria-selected", b.dataset.t===t?"true":"false"); });
    var isMsg = t==="messages";
    $("work").hidden=isMsg; $("messages-panel").hidden=!isMsg;
    $("add").hidden = (t==="orders" || t==="members");
    if(isMsg){ renderMessages(); return; }
    renderFilters(); renderList(); renderEditor(null);
  }

  function selectFilter(opts){
    return '<label for="f-sel" class="hint" style="display:flex;align-items:center;gap:8px">Show<select id="f-sel">'+opts.map(function(o){return '<option value="'+o[0]+'">'+o[1]+'</option>';}).join("")+'</select></label>';
  }
  function renderFilters(){
    var f=$("filters"), t=state.tab;
    if(t==="products") f.innerHTML=selectFilter([["all","All categories"]].concat(CATEGORIES));
    else if(t==="orders") f.innerHTML=selectFilter([["open","Open orders"],["new","New"],["delivery","Open deliveries"],["pickup","Open pickups"],["completed","Completed"],["cancelled","Cancelled"],["all","All orders"]]);
    else if(t==="members") f.innerHTML=selectFilter([["pending","Waiting for approval"],["approved","Approved"],["denied","Denied"],["revoked","Revoked"],["all","Everyone"]]);
    else { f.innerHTML='<strong style="font-size:1rem">'+({merch:"Merch items",locations:"Boutique locations",staff:"Staff & drivers"}[t]||"")+'</strong>'; return; }
    $("f-sel").value=state.filter;
    $("f-sel").addEventListener("change", function(e){ state.filter=e.target.value; renderList(); });
  }

  function filtered(){
    var rows=state.rows[state.tab], f=state.filter;
    if(state.tab==="products" && f!=="all") return rows.filter(function(r){return r.category===f;});
    if(state.tab==="orders"){
      if(f==="open") return rows.filter(function(o){return OPEN.indexOf(o.status)>-1;});
      if(f==="delivery"||f==="pickup") return rows.filter(function(o){return o.fulfillment===f && OPEN.indexOf(o.status)>-1;});
      if(f!=="all") return rows.filter(function(o){return o.status===f;});
    }
    if(state.tab==="members" && f!=="all") return rows.filter(function(m){return m.status===f;});
    return rows;
  }

  function renderList(){
    var rows=filtered(), t=state.tab;
    if(!rows.length){
      var empty = t==="orders" ? (state.role==="driver" ? "No deliveries assigned to you right now." : "No orders here.")
        : t==="members" ? (state.filter==="pending" ? "No applications waiting. New ones show up here." : "Nobody here.")
        : 'Nothing here yet. Click <b>+ Add new</b> to create the first one.';
      $("list").innerHTML='<p class="empty">'+empty+'</p>'; return;
    }
    $("list").innerHTML=rows.map(function(r){
      var thumb, title, sub, chips;
      if(t==="orders"){
        thumb='<div class="thumb" style="display:grid;place-items:center;font-weight:900;color:var(--gold);font-size:.85rem">#'+r.order_number+'</div>';
        title=esc(r.customer_name||r.customer_email||"Member");
        sub=(r.fulfillment==="delivery"?"Delivery":"Pickup · "+esc(locName(r.pickup_location_id)))+" · "+money(r.subtotal_cents)+" · "+when(r.created_at)+(r.driver_email&&state.role==="admin"?" · 🚗 "+esc(r.driver_email.split("@")[0]):"");
        chips='<span class="chip '+ORDER_CHIP[r.status]+'">'+ORDER_STATUS[r.status]+'</span>'+(r.payment_status==="paid"?' <span class="chip done">Paid</span>':'');
      } else if(t==="members"){
        thumb='<div class="thumb" style="display:grid;place-items:center;color:var(--gold);font-weight:900">'+esc((r.full_name||"?")[0])+'</div>';
        title=esc(r.full_name); sub=esc(r.email)+" · applied "+when(r.created_at)+(r.id_photo_path?" · ID on file":"");
        chips='<span class="chip '+r.status+'">'+MEMBER_STATUS[r.status]+'</span>';
      } else if(t==="staff"){
        thumb='<div class="thumb" style="display:grid;place-items:center;color:var(--gold);font-weight:900">'+esc((r.name||r.email||"?")[0].toUpperCase())+'</div>';
        title=esc(r.name||r.email); sub=esc(r.email);
        chips='<span class="chip '+(r.role==="admin"?"done":"ready")+'">'+(r.role==="admin"?"Admin":"Driver")+'</span>';
      } else {
        sub = t==="products" ? catLabel(r.category)+(r.price_cents!=null?" · "+money(r.price_cents):"")+(r.stock!=null?" · "+r.stock+" in stock":"")
          : t==="merch" ? (r.price_cents!=null?money(r.price_cents):"No price")+(r.buy_url?" · Buy link set":" · No buy link")
          : esc(r.street)+", "+esc(r.city_state_zip);
        thumb = t==="locations" ? '<div class="thumb" style="display:grid;place-items:center;color:var(--gold);font-weight:900">'+esc((r.name||"?")[0])+'</div>'
          : r.image_url ? '<img class="thumb" src="'+esc(r.image_url)+'" alt="">' : '<div class="thumb"></div>';
        title=esc(r.name);
        chips = (r.members_only?'<span class="chip ready">Members</span> ':'')+(r.stock===0?'<span class="chip new">Sold out</span> ':'')+(r.is_new?'<span class="chip new">New</span> ':'')+(r.sold_out?'<span class="chip new">Sold out</span> ':'')+
          (r.published?'<span class="chip live">Live</span>':'<span class="chip">Hidden</span>');
      }
      return '<button type="button" class="row'+(state.sel&&state.sel.id===(r.id||r.user_id)?' sel':'')+'" data-id="'+esc(r.id||r.user_id)+'">'+thumb+
        '<span class="row-main"><strong>'+title+'</strong><span>'+sub+'</span></span><span>'+chips+'</span></button>';
    }).join("");
    $("list").querySelectorAll(".row").forEach(function(b){ b.addEventListener("click", function(){
      var r=state.rows[state.tab].filter(function(x){return (x.id||x.user_id)===b.dataset.id;})[0];
      state.sel=r?{ id:(r.id||r.user_id) }:null; renderList(); renderEditor(r);
      if(window.innerWidth<900) $("editor-panel").scrollIntoView({behavior:"smooth"});
    }); });
  }
  $("add").addEventListener("click", function(){
    state.sel={}; renderList();
    renderEditor(state.tab==="staff" ? { role:"driver" } : { published:true, category: state.filter!=="all"?state.filter:"flower", available_at: state.rows.locations.map(function(l){return l.id;}) });
    if(window.innerWidth<900) $("editor-panel").scrollIntoView({behavior:"smooth"});
  });
  function refreshSel(table, id){
    return load(table).then(function(){ renderList(); var r=state.rows[table].filter(function(x){return (x.id||x.user_id)===id;})[0]; renderEditor(r||null); });
  }

  /* ---------- Editors ---------- */
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
    if(!r){ ed.innerHTML='<p class="empty">'+(state.tab==="orders"?"Pick an order to see details.":state.tab==="members"?"Pick an application to review it.":"Pick an item to edit, or add a new one.")+'</p>'; return; }
    if(state.tab==="orders") return renderOrder(r);
    if(state.tab==="members") return renderMember(r);
    if(state.tab==="staff") return renderStaff(r);
    var isNew=!r.id, t=state.tab, html='<form class="editor" id="e-form"><h2 style="font-size:1.4rem">'+(isNew?"Add ":"Edit ")+(t==="products"?"product":t==="merch"?"merch item":"location")+'</h2>';
    if(t==="products"){
      html+='<div class="two"><label for="e-category">Category<select id="e-category">'+CATEGORIES.map(function(c){return '<option value="'+c[0]+'"'+(r.category===c[0]?" selected":"")+'>'+c[1]+'</option>';}).join("")+'</select></label>'+
        field("e-name","Name",r.name,"text","required maxlength=\"120\"")+'</div>'+
        field("e-subtitle",'Details line <span class="hint">e.g. Hybrid · Gelato x Runtz</span>',r.subtitle,"text","maxlength=\"120\"")+
        area("e-description","Description",r.description,"Flavor, effects, what makes it special")+
        imageField(r.image_url)+
        '<span class="section-label">Members ordering</span>'+
        '<div class="two">'+field("e-price",'Member price (USD) <span class="hint">Blank = not orderable online</span>',r.price_cents!=null?(r.price_cents/100).toFixed(2):"","number",'min="0" step="0.01" inputmode="decimal"')+
        field("e-stock",'Stock on hand <span class="hint">Blank = don\'t track</span>',r.stock!=null?r.stock:"","number",'min="0" step="1" inputmode="numeric"')+'</div>'+
        check("e-members","Members only (hidden from the public site)",r.members_only)+
        '<div class="locs-pick"><span style="font-weight:700;font-size:.85rem">Available at</span>'+state.rows.locations.map(function(l){
          return '<label class="check"><input type="checkbox" class="e-loc" value="'+l.id+'" '+((r.available_at||[]).indexOf(l.id)>-1?"checked":"")+'>'+esc(l.name)+'</label>'; }).join("")+'</div>'+
        '<div class="two">'+check("e-new","Mark as new drop",r.is_new)+check("e-featured","Feature on home page",r.featured)+'</div>';
    } else if(t==="merch"){
      html+=field("e-name","Name",r.name,"text","required maxlength=\"120\"")+
        '<div class="two">'+field("e-price","Price (USD)",r.price_cents!=null?(r.price_cents/100).toFixed(2):"","number",'min="0" step="0.01" inputmode="decimal"')+
        field("e-buy",'Payment link',r.buy_url,"url",'placeholder="https://…"')+'</div>'+
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
          if(res.error){ toast("Delete failed: "+cleanErr(res.error.message), true); return; }
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
        var pr=$("e-price").value; row.price_cents = pr==="" ? null : Math.round(parseFloat(pr)*100);
        var st=$("e-stock").value; row.stock = st==="" ? null : Math.max(0, parseInt(st,10)||0);
        row.members_only=$("e-members").checked;
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
        if(res.error) throw new Error(cleanErr(res.error.message));
        toast(r.id?"Saved":"Created"); state.sel={ id:res.data.id };
        return load(t).then(function(){ renderList(); renderEditor(res.data); });
      });
    }).catch(function(err){ toast(err.message, true); btn.disabled=false; btn.textContent=r.id?"Save changes":"Create"; });
  }

  /* ---------- Members ---------- */
  function renderMember(m){
    var ed=$("editor");
    var btns = {
      pending: [["approved","Approve","btn-gold"],["denied","Deny","btn-danger"]],
      approved: [["revoked","Revoke access","btn-danger"]],
      denied: [["approved","Approve","btn-gold"],["pending","Move back to pending","btn-link"]],
      revoked: [["approved","Restore access","btn-gold"]]
    }[m.status] || [];
    ed.innerHTML='<div class="editor" style="display:grid;gap:14px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><h2 style="font-size:1.4rem">'+esc(m.full_name)+'</h2><span class="chip '+m.status+'">'+MEMBER_STATUS[m.status]+'</span></div>'+
      '<dl class="kv"><dt>Email</dt><dd style="user-select:all">'+esc(m.email)+'</dd><dt>Phone</dt><dd style="user-select:all">'+esc(m.phone||"—")+'</dd>'+
      '<dt>Date of birth</dt><dd>'+esc(m.date_of_birth)+' (age '+age(m.date_of_birth)+')</dd><dt>Applied</dt><dd>'+when(m.created_at)+'</dd>'+
      (m.reviewed_at?'<dt>Last reviewed</dt><dd>'+when(m.reviewed_at)+' by '+esc(m.reviewed_by||"")+'</dd>':'')+'</dl>'+
      '<div style="display:grid;gap:8px"><span class="section-label">Photo ID</span><div id="m-id">'+(m.id_photo_path?'<p class="hint">Loading photo…</p>':'<p class="hint">No ID uploaded. Check ID at first delivery or pickup.</p>')+'</div></div>'+
      area("m-note","Private note",m.admin_note,"Only staff see this")+
      '<div class="actions">'+btns.map(function(b){ return '<button class="btn '+b[2]+'" type="button" data-review="'+b[0]+'">'+b[1]+'</button>'; }).join("")+'</div></div>';
    if(m.id_photo_path){
      sb.storage.from("member-ids").createSignedUrl(m.id_photo_path, 600).then(function(r){
        var box=$("m-id"); if(!box) return;
        box.innerHTML = r.error ? '<p class="err">Couldn\'t load the ID photo.</p>' : '<a href="'+esc(r.data.signedUrl)+'" target="_blank" rel="noopener"><img class="idphoto" src="'+esc(r.data.signedUrl)+'" alt="Photo ID for '+esc(m.full_name)+'"></a>';
      });
    }
    ed.querySelectorAll("[data-review]").forEach(function(b){ b.addEventListener("click", function(){
      b.disabled=true;
      sb.rpc("admin_review_member",{ p_user_id:m.user_id, p_status:b.dataset.review, p_note:$("m-note").value.trim()||null }).then(function(r){
        if(r.error){ b.disabled=false; toast(cleanErr(r.error.message), true); return; }
        toast(b.dataset.review==="approved" ? m.full_name.split(" ")[0]+" is approved. They can sign in and order now." : "Updated");
        refreshSel("members", m.user_id);
      });
    }); });
  }

  /* ---------- Orders ---------- */
  function renderOrder(o){
    var ed=$("editor"), isAdmin=state.role==="admin", drivers=state.rows.staff.filter(function(s){return s.role==="driver";});
    var items=(o.order_items||[]);
    var addr = o.fulfillment==="delivery" ? '<a href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(o.delivery_address||"")+'" target="_blank" rel="noopener">'+esc(o.delivery_address)+'</a>' : 'Pickup at '+esc(locName(o.pickup_location_id));
    var steps=[];
    if(isAdmin){
      if(o.status==="new") steps.push(["confirmed","Confirm order","btn-gold"]);
      if(o.fulfillment==="delivery" && (o.status==="new"||o.status==="confirmed")) steps.push(["out_for_delivery","Out for delivery","btn"]);
      if(o.fulfillment==="pickup" && (o.status==="new"||o.status==="confirmed")) steps.push(["ready_for_pickup","Ready for pickup","btn"]);
      if(OPEN.indexOf(o.status)>-1) steps.push(["completed","Mark completed","btn"]);
      if(OPEN.indexOf(o.status)>-1) steps.push(["cancelled","Cancel order","btn-danger"]);
    } else {
      if(o.status==="confirmed"||o.status==="new") steps.push(["out_for_delivery","Start delivery","btn-gold"]);
      if(o.status==="out_for_delivery") steps.push(["completed","Delivered","btn-gold"]);
    }
    ed.innerHTML='<div class="editor" style="display:grid;gap:14px">'+
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><h2 style="font-size:1.4rem">Order #'+o.order_number+'</h2><span class="chip '+ORDER_CHIP[o.status]+'">'+ORDER_STATUS[o.status]+'</span></div>'+
      '<dl class="kv"><dt>Member</dt><dd>'+esc(o.customer_name||"")+'</dd><dt>Phone</dt><dd style="user-select:all">'+esc(o.customer_phone||"—")+'</dd><dt>Email</dt><dd style="user-select:all">'+esc(o.customer_email||"")+'</dd>'+
      '<dt>'+(o.fulfillment==="delivery"?"Deliver to":"Fulfillment")+'</dt><dd>'+addr+'</dd>'+(o.notes?'<dt>Notes</dt><dd>'+esc(o.notes)+'</dd>':'')+
      '<dt>Placed</dt><dd>'+when(o.created_at)+'</dd><dt>Payment</dt><dd>'+(o.payment_status==="paid"?'<span class="chip done">Paid</span>':o.payment_status==="refunded"?'Refunded':'Collect '+money(o.subtotal_cents)+' at handoff')+'</dd></dl>'+
      '<table class="items"><tbody>'+items.map(function(i){ return '<tr><td>'+esc(i.name)+' × '+i.quantity+'</td><td>'+money(i.unit_price_cents*i.quantity)+'</td></tr>'; }).join("")+'<tr><td>Total</td><td>'+money(o.subtotal_cents)+'</td></tr></tbody></table>'+
      '<p class="hint">Check the member\'s ID at handoff.</p>'+
      (steps.length?'<div class="actions">'+steps.map(function(s){ return '<button class="btn '+s[2]+'" type="button" data-step="'+s[0]+'">'+s[1]+'</button>'; }).join("")+'</div>':'')+
      (o.payment_status!=="paid" && o.status!=="cancelled" ? '<div class="actions"><button class="btn" type="button" id="o-paid">Mark paid</button></div>' : (isAdmin && o.payment_status==="paid" ? '<div class="actions"><button class="btn btn-link" type="button" id="o-unpaid">Mark unpaid</button></div>' : ''))+
      (isAdmin && o.fulfillment==="delivery" && OPEN.indexOf(o.status)>-1 ? '<div style="display:grid;gap:8px"><span class="section-label">Driver</span>'+
        (drivers.length ? '<div class="actions"><select id="o-driver" style="width:auto;min-width:200px"><option value="">Not assigned</option>'+drivers.map(function(d){ return '<option value="'+esc(d.email)+'"'+((o.driver_email||"").toLowerCase()===d.email.toLowerCase()?" selected":"")+'>'+esc(d.name||d.email)+'</option>'; }).join("")+'</select><button class="btn" type="button" id="o-assign">Assign</button></div>'
          : '<p class="hint">No drivers yet. Add one under Staff &amp; drivers.</p>')+'</div>' : '')+
      '<div id="o-confirm"></div></div>';

    ed.querySelectorAll("[data-step]").forEach(function(b){ b.addEventListener("click", function(){
      var step=b.dataset.step;
      if(step==="cancelled" && b.dataset.sure!=="1"){ b.dataset.sure="1"; b.textContent="Tap again to cancel (stock goes back)"; return; }
      b.disabled=true;
      sb.rpc("set_order_status",{ p_order:o.id, p_status:step }).then(function(r){
        if(r.error){ b.disabled=false; toast(cleanErr(r.error.message), true); return; }
        toast("Order #"+o.order_number+": "+ORDER_STATUS[step]);
        if(step==="cancelled") load("products");
        refreshSel("orders", o.id);
      });
    }); });
    if($("o-paid")) $("o-paid").addEventListener("click", function(){
      this.disabled=true;
      sb.rpc("driver_mark_paid",{ p_order:o.id }).then(function(r){ if(r.error){ toast(cleanErr(r.error.message), true); return; } toast("Marked paid"); refreshSel("orders", o.id); });
    });
    if($("o-unpaid")) $("o-unpaid").addEventListener("click", function(){
      sb.from("orders").update({ payment_status:"unpaid" }).eq("id",o.id).then(function(r){ if(r.error){ toast(cleanErr(r.error.message), true); return; } refreshSel("orders", o.id); });
    });
    if($("o-assign")) $("o-assign").addEventListener("click", function(){
      var v=$("o-driver").value||null;
      sb.from("orders").update({ driver_email:v }).eq("id",o.id).then(function(r){
        if(r.error){ toast(cleanErr(r.error.message), true); return; }
        toast(v ? "Assigned. It now shows on their Deliveries screen." : "Driver removed"); refreshSel("orders", o.id);
      });
    });
  }

  /* ---------- Staff & drivers ---------- */
  function renderStaff(s){
    var ed=$("editor"), isNew=!s.email, self=(s.email||"").toLowerCase()===state.email;
    if(isNew){
      ed.innerHTML='<form class="editor" id="s-form"><h2 style="font-size:1.4rem">Add staff</h2>'+
        '<p class="hint">Drivers only see deliveries you assign to them. Admins can do everything, including this screen.</p>'+
        field("s-name","Name","", "text","required maxlength=\"80\"")+field("s-email","Email","","email","required autocomplete=\"off\"")+
        '<label for="s-role">Role<select id="s-role"><option value="driver">Driver (deliveries only)</option><option value="admin">Admin (full access)</option></select></label>'+
        field("s-pass",'Temporary password <span class="hint">Leave blank if they already have a login</span>',"","text",'minlength="8" autocomplete="off"')+
        '<p class="hint">Give them the email and temporary password. They sign in at this same /admin page and can change the password with Forgot password. If your project requires email confirmation, they\'ll get a confirmation email first.</p>'+
        '<div class="actions"><button class="btn btn-gold" type="submit" id="s-save">Add</button><button class="btn btn-link" type="button" id="s-cancel">Cancel</button></div></form>';
      $("s-cancel").addEventListener("click", function(){ state.sel=null; renderList(); renderEditor(null); });
      $("s-form").addEventListener("submit", function(e){
        e.preventDefault();
        var name=$("s-name").value.trim(), email=$("s-email").value.trim().toLowerCase(), role=$("s-role").value, pass=$("s-pass").value;
        if(!name || !email){ toast("Add a name and email.", true); return; }
        if(pass && pass.length<8){ toast("Temporary password needs at least 8 characters.", true); return; }
        var btn=$("s-save"); btn.disabled=true; btn.textContent="Adding…";
        var makeLogin = pass ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false, storageKey:"sl-staff-tmp" } })
            .auth.signUp({ email:email, password:pass, options:{ emailRedirectTo: location.origin+"/admin", data:{ staff_name:name } } })
          : Promise.resolve({});
        makeLogin.then(function(r){
          if(r && r.error && !/already registered/i.test(r.error.message)) throw new Error(r.error.message);
          return sb.from("admins").insert({ email:email, role:role, name:name });
        }).then(function(r){
          if(r.error) throw new Error(/duplicate/i.test(r.error.message) ? "That email is already on the staff list." : cleanErr(r.error.message));
          toast(name+" added as "+(role==="admin"?"an admin":"a driver"));
          state.sel={ id:email }; refreshSel("staff", email);
        }).catch(function(err){ btn.disabled=false; btn.textContent="Add"; toast(err.message, true); });
      });
      return;
    }
    ed.innerHTML='<div class="editor" style="display:grid;gap:14px"><h2 style="font-size:1.4rem">'+esc(s.name||s.email)+'</h2>'+
      '<dl class="kv"><dt>Email</dt><dd style="user-select:all">'+esc(s.email)+'</dd><dt>Role</dt><dd>'+(s.role==="admin"?"Admin (full access)":"Driver (assigned deliveries only)")+'</dd><dt>Added</dt><dd>'+when(s.created_at)+'</dd></dl>'+
      (self ? '<p class="hint">This is you. Another admin would have to change or remove your access.</p>' :
      '<div class="actions"><button class="btn" type="button" id="s-swap">Make '+(s.role==="admin"?"driver":"admin")+'</button><button class="btn btn-danger" type="button" id="s-remove">Remove access</button></div>')+'</div>';
    if($("s-swap")) $("s-swap").addEventListener("click", function(){
      sb.from("admins").update({ role: s.role==="admin"?"driver":"admin" }).eq("email", s.email).then(function(r){
        if(r.error){ toast(cleanErr(r.error.message), true); return; } toast("Role updated"); refreshSel("staff", s.email);
      });
    });
    if($("s-remove")) $("s-remove").addEventListener("click", function(){
      var b=this; if(b.dataset.sure!=="1"){ b.dataset.sure="1"; b.textContent="Tap again to remove"; return; }
      sb.from("admins").delete().eq("email", s.email).then(function(r){
        if(r.error){ toast(cleanErr(r.error.message), true); return; } toast("Access removed"); state.sel=null; load("staff").then(function(){ renderList(); renderEditor(null); });
      });
    });
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
