(function(){
  "use strict";
  var sb = window.SL_SB;
  var root = document.getElementById("m-root");
  if(!root) return;
  if(!sb){ root.innerHTML = '<p class="lede">Members sign-in is not connected yet.</p>'; return; }

  var authRedirect = /access_token|error_description|type=(signup|recovery|magiclink|invite)/.test(location.hash);
  var state = { session:null, member:null, staffRole:null, products:[], locations:[], orders:[], cart:{}, view:"shop", filter:"all", recovering:false, loaded:false };
  var CATS = [["all","All"],["flower","Flower"],["edibles","Edibles"],["concentrates","Concentrates"],["vapes","Vapes"]];
  var STATUS = { new:"Received", confirmed:"Confirmed", out_for_delivery:"Out for delivery", ready_for_pickup:"Ready for pickup", completed:"Completed", cancelled:"Cancelled" };

  function esc(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
  function money(c){ return "$"+(c/100).toFixed(2); }
  function safeUrl(u){ return /^https:\/\//i.test(u||"") ? u : ""; }
  function $(id){ return document.getElementById(id); }
  function friendly(err){
    var m = (err && (err.message||err.error_description)) || String(err||"");
    if(/Invalid login/i.test(m)) return "That email and password didn't match.";
    if(/Email not confirmed/i.test(m)) return "Confirm your email first. Check your inbox for the link we sent.";
    if(/already registered|already been registered/i.test(m)) return "That email already has an account. Sign in instead.";
    if(/21 or older/i.test(m)) return "Members must be 21 or older.";
    if(/Database error saving new user/i.test(m)) return "We couldn't create your application. Check your date of birth (21+) and try again.";
    if(/rate limit|seconds/i.test(m)) return "Too many attempts. Wait a minute and try again.";
    if(/Password should be/i.test(m)) return "Use a password with at least 8 characters.";
    return m.replace(/^.*?ERROR:\s*/,"") || "Something went wrong. Try again.";
  }

  /* ---------- cart (per member, kept in this browser) ---------- */
  function cartKey(){ return "sl_cart_"+(state.session ? state.session.user.id : "x"); }
  function loadCart(){ try{ state.cart = JSON.parse(localStorage.getItem(cartKey())||"{}")||{}; }catch(e){ state.cart={}; } }
  function saveCart(){ try{ localStorage.setItem(cartKey(), JSON.stringify(state.cart)); }catch(e){} }

  /* ---------- auth state ---------- */
  function refresh(){
    return sb.auth.getSession().then(function(r){
      state.session = r.data.session;
      if(!state.session){ state.member=null; state.staffRole=null; return; }
      return Promise.all([
        sb.from("members").select("*").eq("user_id", state.session.user.id).maybeSingle(),
        sb.rpc("my_staff_role")
      ]).then(function(res){
        state.member = res[0].data || null;
        state.staffRole = res[1].data || null;
        loadCart();
        if(state.member && state.member.status==="approved") return loadShop();
      });
    });
  }
  function loadShop(){
    return Promise.all([
      sb.from("products").select("*").eq("published",true).order("sort").order("created_at",{ascending:false}),
      sb.from("locations").select("id,name,street,city_state_zip").eq("published",true).order("sort"),
      sb.from("orders").select("*, order_items(*)").order("created_at",{ascending:false}).limit(50)
    ]).then(function(r){
      state.products = r[0].data || [];
      state.locations = r[1].data || [];
      state.orders = r[2].data || [];
      // drop cart lines that are no longer orderable
      Object.keys(state.cart).forEach(function(id){ if(!productById(id) || productById(id).price_cents==null) delete state.cart[id]; });
      saveCart();
    });
  }
  function productById(id){ for(var i=0;i<state.products.length;i++) if(state.products[i].id===id) return state.products[i]; return null; }

  var lastUid = null;
  sb.auth.getSession().then(function(r){ lastUid = r.data.session ? r.data.session.user.id : null; });
  sb.auth.onAuthStateChange(function(event, session){
    if(event==="PASSWORD_RECOVERY"){ state.recovering=true; window.SL_GO && window.SL_GO("members"); render(); return; }
    if(event==="SIGNED_IN" || event==="SIGNED_OUT" || event==="USER_UPDATED"){
      var uid = session && session.user ? session.user.id : null;
      if(event==="SIGNED_IN" && uid && uid===lastUid) return; // same person (tab refocus); don't wipe what they're doing
      lastUid = uid;
      setTimeout(function(){
        refresh().then(function(){
          render();
          if(window.SL_RELOAD) window.SL_RELOAD();
          if(event==="SIGNED_IN" && authRedirect){ authRedirect=false; try{ history.replaceState(null,"",location.pathname+"#members"); }catch(e){} window.SL_GO && window.SL_GO("members"); }
        });
      },0);
    }
  });

  document.addEventListener("sl:page", function(e){ if(e.detail==="members" && !state.loaded){ state.loaded=true; refresh().then(render); } else if(e.detail==="members"){ render(); } });
  if(/#members/.test(location.hash) || authRedirect){ state.loaded=true; refresh().then(function(){ render(); if(authRedirect && state.session){ window.SL_GO && window.SL_GO("members"); } }); }
  if(/error_description/.test(location.hash)){
    window.SL_GO && window.SL_GO("members");
    setTimeout(function(){ var m=$("si-err"); if(m) m.textContent="That link has expired or was already used. Sign in, or use Forgot password to get a new one."; },300);
  }

  /* ---------- views ---------- */
  function render(){
    if(state.recovering) return renderSetPassword();
    if(!state.session) return renderSignedOut();
    var m = state.member;
    if(!m){
      root.innerHTML = head("Members", "You're signed in as "+esc(state.session.user.email)+".") +
        '<div class="m-panel"><h2>'+(state.staffRole ? "Staff account" : "No member application")+'</h2>'+
        '<p>'+(state.staffRole ? 'This is a staff login. Manage members, orders and inventory in the admin.' : 'This account hasn\'t applied for membership. Sign out and apply with the form, or contact us.')+'</p>'+
        '<div class="hero-cta">'+(state.staffRole?'<a class="btn btn-gold" href="/admin">Open admin</a>':'')+'<button class="btn btn-ghost" type="button" data-act="signout">Sign out</button></div></div>';
      return;
    }
    if(m.status==="pending") return renderPending();
    if(m.status==="denied" || m.status==="revoked"){
      root.innerHTML = head("Membership", "") + '<div class="m-panel"><h2>'+(m.status==="denied"?"Application not approved":"Membership inactive")+'</h2>'+
        '<p>Your membership isn\'t active right now. If you think this is a mistake, reach out through Contact Us.</p>'+
        '<div class="hero-cta"><a class="btn btn-ghost" href="#contact" data-go="contact">Contact us</a><button class="btn btn-ghost" type="button" data-act="signout">Sign out</button></div></div>';
      return;
    }
    renderShop();
  }

  function head(title, sub){
    return '<div class="m-head"><div><span class="eyebrow">Spoiled Lungz Members</span><h1>'+title+'</h1>'+(sub?'<p class="lede" style="margin-top:8px">'+sub+'</p>':'')+'</div></div>';
  }

  function renderSignedOut(){
    var maxDob = new Date(); maxDob.setFullYear(maxDob.getFullYear()-21);
    var maxStr = maxDob.toISOString().slice(0,10);
    root.innerHTML = head("Members", "Members get the full menu with prices, members-only drops, and ordering for delivery or boutique pickup. Every application is reviewed by our team.") +
      '<div class="m-split">'+
      '<form id="apply-form" novalidate>'+
        '<h2>Apply for membership</h2><p>Must be 21 or older. You\'ll get access as soon as we approve you.</p>'+
        '<label for="ap-name">Full name<input id="ap-name" autocomplete="name" required maxlength="120"></label>'+
        '<div class="row2"><label for="ap-email">Email<input id="ap-email" type="email" autocomplete="email" required></label>'+
        '<label for="ap-phone">Mobile phone<input id="ap-phone" type="tel" autocomplete="tel" required maxlength="40"></label></div>'+
        '<label for="ap-dob">Date of birth<input id="ap-dob" type="date" required max="'+maxStr+'"></label>'+
        '<label for="ap-pass">Create a password <span class="p-stock">At least 8 characters</span><input id="ap-pass" type="password" autocomplete="new-password" minlength="8" required></label>'+
        '<label class="check-row" for="ap-agree"><input id="ap-agree" type="checkbox" required><span>I confirm I am 21 or older and the information above is accurate. I may be asked for ID at delivery or pickup.</span></label>'+
        '<button class="btn btn-gold" type="submit" style="justify-self:start">Submit application</button>'+
        '<p class="m-err" id="ap-err" role="alert"></p></form>'+
      '<form id="signin-form" novalidate>'+
        '<h2>Member sign in</h2><p>Already applied? Sign in to check your status or place an order.</p>'+
        '<label for="si-email">Email<input id="si-email" type="email" autocomplete="username" required></label>'+
        '<label for="si-pass">Password<input id="si-pass" type="password" autocomplete="current-password" required></label>'+
        '<button class="btn btn-gold" type="submit" style="justify-self:start">Sign in</button>'+
        '<button class="linkbtn" type="button" id="si-forgot">Forgot password?</button>'+
        '<p class="m-err" id="si-err" role="alert"></p><p class="m-ok" id="si-ok" role="status" hidden></p></form>'+
      '</div>';

    $("apply-form").addEventListener("submit", function(e){
      e.preventDefault(); var err=$("ap-err"); err.textContent="";
      var name=$("ap-name").value.trim(), email=$("ap-email").value.trim(), phone=$("ap-phone").value.trim(), dob=$("ap-dob").value, pass=$("ap-pass").value;
      if(!name || !email || !phone || !dob || !pass){ err.textContent="Fill in every field."; return; }
      if(dob > maxStr){ err.textContent="Members must be 21 or older."; return; }
      if(pass.length<8){ err.textContent="Use a password with at least 8 characters."; return; }
      if(!$("ap-agree").checked){ err.textContent="Check the box to confirm you're 21 or older."; return; }
      var btn=e.target.querySelector('button[type="submit"]'); btn.disabled=true; btn.textContent="Submitting…";
      sb.auth.signUp({ email:email, password:pass, options:{ emailRedirectTo: location.origin + "/#members",
        data:{ member_application:"true", full_name:name, phone:phone, date_of_birth:dob } } }).then(function(r){
        btn.disabled=false; btn.textContent="Submit application";
        if(r.error){ err.textContent=friendly(r.error); return; }
        if(r.data && r.data.session) return; // signed in right away; auth listener renders the pending screen
        root.innerHTML = head("Application received", "") + '<div class="m-panel"><h2>Check your email</h2>'+
          '<p>We sent a confirmation link to <strong>'+esc(email)+'</strong>. Click it to confirm your email, then sign in here to see your status. Our team reviews every application, and you\'ll have full access as soon as you\'re approved.</p>'+
          '<button class="btn btn-ghost" type="button" data-act="back">Back to sign in</button></div>';
      });
    });
    $("signin-form").addEventListener("submit", function(e){
      e.preventDefault(); var err=$("si-err"); err.textContent=""; $("si-ok").hidden=true;
      var btn=e.target.querySelector('button[type="submit"]'); btn.disabled=true;
      sb.auth.signInWithPassword({ email:$("si-email").value.trim(), password:$("si-pass").value }).then(function(r){
        btn.disabled=false; if(r.error) err.textContent=friendly(r.error);
      });
    });
    $("si-forgot").addEventListener("click", function(){
      var email=$("si-email").value.trim(), err=$("si-err"), ok=$("si-ok"); err.textContent=""; ok.hidden=true;
      if(!email){ err.textContent="Type your email above first, then click Forgot password."; return; }
      sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/#members" }).then(function(r){
        if(r.error){ err.textContent=friendly(r.error); return; }
        ok.hidden=false; ok.textContent="Check your email for a link to set a new password.";
      });
    });
  }

  function renderSetPassword(){
    root.innerHTML = head("Set a new password","") + '<form id="sp-form" class="m-panel" novalidate>'+
      '<label for="sp-pass">New password <span class="p-stock">At least 8 characters</span><input id="sp-pass" type="password" autocomplete="new-password" minlength="8" required></label>'+
      '<label for="sp-pass2">Confirm new password<input id="sp-pass2" type="password" autocomplete="new-password" required></label>'+
      '<button class="btn btn-gold" type="submit" style="justify-self:start">Save password</button><p class="m-err" id="sp-err" role="alert"></p></form>';
    $("sp-form").addEventListener("submit", function(e){
      e.preventDefault(); var p1=$("sp-pass").value, p2=$("sp-pass2").value, err=$("sp-err");
      if(p1.length<8){ err.textContent="Use at least 8 characters."; return; }
      if(p1!==p2){ err.textContent="The two passwords don't match."; return; }
      sb.auth.updateUser({ password:p1 }).then(function(r){
        if(r.error){ err.textContent=friendly(r.error); return; }
        state.recovering=false; try{ history.replaceState(null,"",location.pathname+"#members"); }catch(_){}
        refresh().then(render);
      });
    });
  }

  function renderPending(){
    var m=state.member;
    root.innerHTML = head("You're on the list", "Thanks, "+esc(m.full_name.split(" ")[0]||"")+". Your application is waiting for approval.") +
      '<div class="m-panel"><h2>Application pending</h2>'+
      '<p>Our team reviews every application. As soon as you\'re approved, sign in here to see the full menu and place orders.</p>'+
      '<div style="display:grid;gap:10px;border-top:1px solid var(--line);padding-top:14px">'+
        '<strong>Speed up approval (optional)</strong>'+
        (m.id_photo_path ? '<p class="m-ok">Your photo ID is uploaded. Thanks!</p>' :
        '<p>Upload a photo of your driver\'s license or state ID. Only the Spoiled Lungz team can see it.</p>'+
        '<label for="id-file" class="btn btn-ghost" style="justify-self:start;cursor:pointer">Choose photo<input id="id-file" type="file" accept="image/*" hidden></label>')+
        '<p class="m-err" id="id-err" role="alert"></p>'+
      '</div>'+
      '<div class="hero-cta"><button class="btn btn-ghost" type="button" data-act="recheck">Check status</button><button class="btn btn-ghost" type="button" data-act="signout">Sign out</button></div></div>';
    var f=$("id-file");
    if(f) f.addEventListener("change", function(){
      var file=f.files[0], err=$("id-err"); err.textContent=""; if(!file) return;
      if(file.size>10485760){ err.textContent="That photo is over 10 MB. Pick a smaller one."; return; }
      var ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
      var path=state.session.user.id+"/id-"+Date.now()+"."+ext;
      err.style.color="var(--muted)"; err.textContent="Uploading…";
      sb.storage.from("member-ids").upload(path, file, { contentType:file.type||"image/jpeg" }).then(function(r){
        if(r.error){ err.style.color=""; err.textContent="Upload failed: "+friendly(r.error); return; }
        return sb.rpc("member_set_id_photo",{ p_path:path }).then(function(r2){
          if(r2.error){ err.style.color=""; err.textContent=friendly(r2.error); return; }
          state.member.id_photo_path=path; renderPending();
        });
      });
    });
  }

  /* ---------- approved member: shop + orders ---------- */
  function cartLines(){
    return Object.keys(state.cart).map(function(id){ var p=productById(id); return p ? { p:p, q:state.cart[id] } : null; }).filter(Boolean);
  }
  function cartTotal(){ return cartLines().reduce(function(s,l){ return s + l.p.price_cents*l.q; },0); }
  function maxQty(p){ return p.stock==null ? 20 : Math.min(20, p.stock); }

  function renderShop(){
    var m=state.member, first=esc(m.full_name.split(" ")[0]||"");
    var open = state.orders.filter(function(o){ return o.status!=="completed" && o.status!=="cancelled"; }).length;
    root.innerHTML = '<div class="m-head"><div><span class="eyebrow">Spoiled Lungz Members</span><h1>Welcome, '+first+'</h1></div>'+
      '<div class="m-tabs">'+
        '<button class="subtab" type="button" data-view="shop" aria-selected="'+(state.view==="shop")+'" style="--c:var(--gold)"><i></i>Menu</button>'+
        '<button class="subtab" type="button" data-view="orders" aria-selected="'+(state.view==="orders")+'" style="--c:var(--lime)"><i></i>My orders'+(open?' ('+open+')':'')+'</button>'+
        '<button class="btn btn-ghost" type="button" data-act="signout" style="padding:12px 18px">Sign out</button>'+
      '</div></div><div id="m-view"></div>';
    if(state.view==="orders") renderOrders(); else renderMenu();
  }

  function renderMenu(){
    var list = state.products.filter(function(p){ return state.filter==="all" || p.category===state.filter; });
    var html = '<div class="shop"><div style="min-width:0">'+
      '<div class="shop-filters">'+CATS.map(function(c){ return '<button class="subtab" type="button" data-filter="'+c[0]+'" aria-selected="'+(state.filter===c[0])+'" style="--c:var(--gold)">'+c[1]+'</button>'; }).join("")+'</div>'+
      (list.length ? '<div class="shop-grid">'+list.map(menuCard).join("")+'</div>' : '<div class="note">Nothing in this category right now. Check back soon.</div>')+
      '</div><aside class="cart" id="cart" aria-label="Your order"></aside></div>'+
      (cartLines().length ? '<button class="btn btn-gold cart-jump" type="button" data-act="jump"><span>Review order ('+cartLines().reduce(function(s,l){return s+l.q;},0)+')</span><span>'+money(cartTotal())+'</span></button>' : '');
    $("m-view").innerHTML = html;
    renderCart();
  }

  function menuCard(p){
    var img = safeUrl(p.image_url) ? '<img class="card-img" src="'+esc(p.image_url)+'" alt="'+esc(p.name)+'" loading="lazy">' : '<div class="ph">Photo coming soon</div>';
    var inCart = state.cart[p.id]||0, orderable = p.price_cents!=null && (p.stock==null || p.stock>0);
    var stock = p.stock==null ? '' : p.stock===0 ? '<span class="p-stock low">Sold out</span>' : p.stock<=5 ? '<span class="p-stock low">Only '+p.stock+' left</span>' : '<span class="p-stock">'+p.stock+' in stock</span>';
    var action = p.price_cents==null ? '<span class="p-stock">Price coming soon</span>'
      : !orderable ? '' : inCart ? '<div class="qty" aria-label="Quantity"><button type="button" data-dec="'+p.id+'" aria-label="Remove one">−</button><span>'+inCart+'</span><button type="button" data-inc="'+p.id+'" aria-label="Add one"'+(inCart>=maxQty(p)?' disabled':'')+'>+</button></div>'
      : '<button class="btn btn-gold btn-sm" type="button" data-inc="'+p.id+'">Add</button>';
    return '<article class="card">'+(p.members_only?'<span class="badge badge-members">Members only</span>':p.is_new?'<span class="badge">New drop</span>':'')+img+
      '<div class="card-body"><div class="card-row"><strong>'+esc(p.name)+'</strong>'+(p.price_cents!=null?'<span class="p-price">'+money(p.price_cents)+'</span>':'')+'</div>'+
      (p.subtitle?'<span class="sub">'+esc(p.subtitle)+'</span>':'')+
      '<span class="where">'+esc((CATS.filter(function(c){return c[0]===p.category;})[0]||["",""])[1])+'</span>'+stock+
      '<div class="card-actions">'+action+'</div></div></article>';
  }

  function renderCart(){
    var el=$("cart"); if(!el) return;
    var lines=cartLines();
    if(!lines.length){ el.innerHTML='<h2>Your order</h2><p class="p-stock" style="font-size:.92rem">Add items from the menu to start an order.</p>'; return; }
    var deliveryChecked = (state.fulfillment||"delivery")==="delivery";
    el.innerHTML = '<h2>Your order</h2>'+
      lines.map(function(l){ return '<div class="cart-line"><strong>'+esc(l.p.name)+'</strong><span class="p-stock">×'+l.q+'</span><span class="p-price">'+money(l.p.price_cents*l.q)+'</span></div>'; }).join("")+
      '<div class="cart-total"><span>Subtotal</span><span>'+money(cartTotal())+'</span></div>'+
      '<form id="co-form" novalidate>'+
        '<div class="seg" role="radiogroup" aria-label="Delivery or pickup">'+
          '<label><input type="radio" name="ful" value="delivery" '+(deliveryChecked?'checked':'')+'><span>Delivery</span></label>'+
          '<label><input type="radio" name="ful" value="pickup" '+(!deliveryChecked?'checked':'')+'><span>Pickup</span></label></div>'+
        (deliveryChecked
          ? '<label for="co-addr">Delivery address<textarea id="co-addr" rows="2" style="min-height:70px" autocomplete="street-address" placeholder="Street, apt, city, ZIP">'+esc(state.addr||"")+'</textarea></label>'
          : '<label for="co-loc">Pickup boutique<select id="co-loc">'+state.locations.map(function(l){ return '<option value="'+l.id+'"'+(state.loc===l.id?' selected':'')+'>'+esc(l.name)+'</option>'; }).join("")+'</select></label>')+
        '<label for="co-phone">Phone<input id="co-phone" type="tel" autocomplete="tel" value="'+esc(state.phone!=null?state.phone:(state.member.phone||""))+'"></label>'+
        '<label for="co-notes">Notes <span class="p-stock">Optional</span><input id="co-notes" maxlength="300" placeholder="Gate code, timing…" value="'+esc(state.notes||"")+'"></label>'+
        '<p class="p-stock" style="font-size:.85rem">Payment is collected at '+(deliveryChecked?'delivery':'pickup')+'. Have your ID ready; we check it every time.</p>'+
        '<button class="btn btn-gold" type="submit">Place order · '+money(cartTotal())+'</button>'+
        '<p class="m-err" id="co-err" role="alert"></p></form>';
    el.querySelectorAll('input[name="ful"]').forEach(function(r){ r.addEventListener("change", function(){ keepForm(); state.fulfillment=r.value; renderCart(); }); });
    $("co-form").addEventListener("submit", placeOrder);
  }
  function keepForm(){
    if($("co-addr")) state.addr=$("co-addr").value;
    if($("co-loc")) state.loc=$("co-loc").value;
    if($("co-phone")) state.phone=$("co-phone").value;
    if($("co-notes")) state.notes=$("co-notes").value;
  }

  function placeOrder(e){
    e.preventDefault(); keepForm();
    var err=$("co-err"); err.textContent="";
    var ful=state.fulfillment||"delivery";
    if(ful==="delivery" && (state.addr||"").trim().length<8){ err.textContent="Add your full delivery address."; return; }
    if(!(state.phone||"").trim()){ err.textContent="Add a phone number so we can reach you."; return; }
    var items=cartLines().map(function(l){ return { product_id:l.p.id, quantity:l.q }; });
    var btn=e.target.querySelector('button[type="submit"]'); btn.disabled=true; btn.textContent="Placing order…";
    sb.rpc("place_order", { p_items:items, p_fulfillment:ful, p_address: ful==="delivery"?state.addr:null,
      p_pickup_location: ful==="pickup"?(state.loc||(state.locations[0]&&state.locations[0].id)):null, p_phone:state.phone, p_notes:state.notes||null }).then(function(r){
      if(r.error){ btn.disabled=false; btn.textContent="Place order · "+money(cartTotal()); err.textContent=friendly(r.error); loadShop().then(function(){ renderMenu(); var e2=$("co-err"); if(e2) e2.textContent=friendly(r.error); }); return; }
      state.cart={}; saveCart(); state.notes="";
      state.justPlaced = r.data;
      loadShop().then(function(){ state.view="orders"; renderShop(); window.scrollTo(0,0); });
    });
  }

  function renderOrders(){
    var placed = state.justPlaced; state.justPlaced=null;
    var html = placed ? '<div class="note" style="border-style:solid;border-color:var(--lime);margin-bottom:16px"><b style="color:var(--lime)">Order #'+placed.order_number+' received.</b> We\'ll confirm it shortly. Payment of '+money(placed.subtotal_cents)+' is collected at handoff.</div>' : '';
    if(!state.orders.length){ $("m-view").innerHTML = html+'<div class="note">No orders yet. Head to the menu to place your first one.</div>'; return; }
    html += '<div class="orders">'+state.orders.map(function(o){
      var loc = o.pickup_location_id ? (state.locations.filter(function(l){return l.id===o.pickup_location_id;})[0]||{}).name : null;
      return '<article class="order"><div class="order-top"><strong>Order #'+o.order_number+'</strong><span class="st st-'+o.status+'">'+(STATUS[o.status]||o.status)+'</span></div>'+
        '<div class="order-meta">'+new Date(o.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+' · '+
          (o.fulfillment==="delivery" ? 'Delivery to '+esc(o.delivery_address||"") : 'Pickup at '+esc(loc||"boutique"))+'</div>'+
        '<div>'+(o.order_items||[]).map(function(i){ return esc(i.name)+' ×'+i.quantity; }).join(", ")+'</div>'+
        '<div class="order-top"><span class="p-price">'+money(o.subtotal_cents)+'</span><span class="order-meta">'+(o.payment_status==="paid"?"Paid":"Pay at handoff")+'</span></div>'+
        (o.status==="new" ? '<button class="linkbtn" type="button" data-cancel="'+o.id+'">Cancel this order</button>' : '')+
        '</article>';
    }).join("")+'</div>';
    $("m-view").innerHTML = html;
  }

  /* ---------- clicks ---------- */
  root.addEventListener("click", function(e){
    var t=e.target.closest("button,[data-act]"); if(!t) return;
    if(t.dataset.act==="signout"){ sb.auth.signOut(); return; }
    if(t.dataset.act==="back"){ renderSignedOut(); return; }
    if(t.dataset.act==="jump"){ var c=$("cart"); if(c) c.scrollIntoView({behavior:"smooth",block:"start"}); return; }
    if(t.dataset.act==="recheck"){ t.disabled=true; refresh().then(render); return; }
    if(t.dataset.view){ state.view=t.dataset.view; if(state.view==="orders"){ loadShop().then(renderShop); } else renderShop(); return; }
    if(t.dataset.filter){ state.filter=t.dataset.filter; renderMenu(); return; }
    if(t.dataset.inc){ var p=productById(t.dataset.inc); if(!p) return; keepForm(); state.cart[p.id]=Math.min(maxQty(p),(state.cart[p.id]||0)+1); saveCart(); renderMenu(); return; }
    if(t.dataset.dec){ keepForm(); var q=(state.cart[t.dataset.dec]||0)-1; if(q<=0) delete state.cart[t.dataset.dec]; else state.cart[t.dataset.dec]=q; saveCart(); renderMenu(); return; }
    if(t.dataset.cancel){
      if(t.dataset.confirm!=="1"){ t.dataset.confirm="1"; t.textContent="Tap again to cancel order"; return; }
      t.disabled=true;
      sb.rpc("cancel_my_order",{ p_order:t.dataset.cancel }).then(function(r){
        if(r.error){ t.disabled=false; t.textContent=friendly(r.error); return; }
        loadShop().then(renderShop);
      });
    }
  });
})();
