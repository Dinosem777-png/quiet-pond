from pathlib import Path

worker = Path('xi-coin-v4/cloudflare-worker/src/index.js')
s = worker.read_text()

repls = [
('passpremium: { title: "Премиум-пропуск Xi Coin", description: "Премиум-линия наград сезона", stars: 150 }','passpremium: { title: "Премиум-пропуск Xi Coin", description: "Премиум-линия наград сезона", stars: 150 },\n  factioncreate: { title: "Создание фракции", description: "Создание собственной фракции Xi Coin", stars: 20 }'),
('const member = await db.prepare("SELECT f.id, f.name FROM faction_members m JOIN factions f ON f.id=m.faction_id WHERE m.user_id=?").bind(u.id).first();','const member = await db.prepare("SELECT f.id, f.name, f.owner_id, f.level FROM faction_members m JOIN factions f ON f.id=m.faction_id WHERE m.user_id=?").bind(u.id).first();'),
('const factions = await db.prepare("SELECT f.id,f.name,COUNT(m.user_id) AS members FROM factions f LEFT JOIN faction_members m ON m.faction_id=f.id GROUP BY f.id ORDER BY members DESC LIMIT 20").all();','const factions = await db.prepare("SELECT f.id,f.name,f.level,COUNT(m.user_id) AS members FROM factions f LEFT JOIN faction_members m ON m.faction_id=f.id GROUP BY f.id ORDER BY members DESC LIMIT 20").all();'),
('const baseHourly=(mineList.results||[]).reduce((s,m)=>s+(rates[m.miner_key]||0)*(1+0.1*(Number(m.level||1)-1)),0); const levelBonus=','const baseHourly=(mineList.results||[]).reduce((s,m)=>s+(rates[m.miner_key]||0)*(1+0.1*(Number(m.level||1)-1)),0); const factionBonus=member?Math.max(0,Math.min(10,Number(member.level||1)))/100:0; const levelBonus='),
('const hourlyIncome=baseHourly*Number(u.vip_multiplier||1)*(1+levelBonus);','const hourlyIncome=baseHourly*Number(u.vip_multiplier||1)*(1+levelBonus)*(1+factionBonus);'),
('miners:mineList.results||[], faction:member||null, factions:factions.results||[],','miners:mineList.results||[], faction:member?{...member,bonusPercent:Number(member.level||1),upgradeCost:Number(member.level||1)<10?1000*Math.pow(2,Number(member.level||1)-1):null}:null, factionBonusPercent:factionBonus*100, factions:factions.results||[],'),
('reward*=Number(u.vip_multiplier||1)*(1+levelBonus);','const faction=await db.prepare("SELECT f.level FROM faction_members m JOIN factions f ON f.id=m.faction_id WHERE m.user_id=?").bind(u.id).first();\n    const factionBonus=faction?Math.max(0,Math.min(10,Number(faction.level||1)))/100;\n    reward*=Number(u.vip_multiplier||1)*(1+levelBonus)*(1+factionBonus);')]
for old,new in repls:
    if old not in s: raise SystemExit('worker replacement not found: '+old[:70])
    s=s.replace(old,new)

old='''  if (url.pathname === "/api/faction-create" && method === "POST") {
    const u=await getUser(db,tg); const name=String(body.name||"").trim();
    if(name.length<3||name.length>20) return json({error:"Название: от 3 до 20 символов"},400);
    const has=await db.prepare("SELECT faction_id FROM faction_members WHERE user_id=?").bind(u.id).first();
    if(has) return json({error:"Ты уже состоишь во фракции"},400);
    try { const r=await db.prepare("INSERT INTO factions(name,owner_id) VALUES(?,?)").bind(name,u.id).run(); await db.prepare("INSERT INTO faction_members(faction_id,user_id) VALUES(?,?)").bind(r.meta.last_row_id,u.id).run(); }
    catch(e){return json({error:"Такое название уже занято"},400)}
    return json({ok:true});
  }
'''
new='''  if (url.pathname === "/api/faction-create" && method === "POST") {
    const u=await getUser(db,tg); const name=String(body.name||"").trim();
    if(name.length<3||name.length>20) return json({error:"Название: от 3 до 20 символов"},400);
    const has=await db.prepare("SELECT faction_id FROM faction_members WHERE user_id=?").bind(u.id).first();
    if(has) return json({error:"Ты уже состоишь во фракции"},400);
    const duplicate=await db.prepare("SELECT id FROM factions WHERE lower(name)=lower(?)").bind(name).first();
    if(duplicate) return json({error:"Такое название уже занято"},400);
    await db.prepare("INSERT INTO faction_creation_requests(user_id,name) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,created_at=CURRENT_TIMESTAMP").bind(u.id,name).run();
    try { const payload="xi4:factioncreate:"+tg.id+":"+crypto.randomUUID(); const invoice=await telegram(env,"createInvoiceLink",{title:ITEMS.factioncreate.title,description:ITEMS.factioncreate.description,payload,currency:"XTR",prices:[{label:ITEMS.factioncreate.title,amount:ITEMS.factioncreate.stars}]}); return json({url:invoice}); }
    catch(e) { return json({error:e.message},500); }
  }
  if (url.pathname === "/api/faction-upgrade" && method === "POST") {
    const u=await getUser(db,tg); const member=await db.prepare("SELECT f.id,f.owner_id,f.level FROM faction_members m JOIN factions f ON f.id=m.faction_id WHERE m.user_id=?").bind(u.id).first();
    if(!member)return json({error:"Сначала вступи во фракцию"},400);
    if(Number(member.owner_id)!==Number(u.id))return json({error:"Улучшать фракцию может только создатель"},403);
    const level=Math.max(1,Number(member.level||1)); if(level>=10)return json({error:"Фракция уже достигла максимального уровня"},400);
    const cost=1000*Math.pow(2,level-1); const debit=await db.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(cost,u.id,cost).run();
    if(!debit.meta.changes)return json({error:"Недостаточно XI. Нужно "+cost+" XI"},400);
    const upgraded=await db.prepare("UPDATE factions SET level=level+1 WHERE id=? AND level=?").bind(member.id,level).run();
    if(!upgraded.meta.changes){await db.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(cost,u.id).run();return json({error:"Фракция уже была улучшена"},409);}
    return json({ok:true,level:level+1,cost,bonus:level+1});
  }
'''
if old not in s: raise SystemExit('faction create block not found')
s=s.replace(old,new)

old='''        if (key === "passpremium") { const buyer=await env.DB.prepare("SELECT id FROM users WHERE tg_id=?").bind(tgId).first(); if(buyer){await env.DB.prepare("INSERT OR IGNORE INTO pass_progress(user_id,season,xp,claimed_level,premium) VALUES(?,'2026-11',0,0,0)").bind(buyer.id).run();await env.DB.prepare("UPDATE pass_progress SET premium=1 WHERE user_id=? AND season='2026-11'").bind(buyer.id).run();} }
'''
new=old+'''        if (key === "factioncreate") { const buyer=await env.DB.prepare("SELECT id FROM users WHERE tg_id=?").bind(tgId).first(); if(buyer){ const has=await env.DB.prepare("SELECT faction_id FROM faction_members WHERE user_id=?").bind(buyer.id).first(); const req=await env.DB.prepare("SELECT name FROM faction_creation_requests WHERE user_id=?").bind(buyer.id).first(); if(!has&&req){ try{ const f=await env.DB.prepare("INSERT INTO factions(name,owner_id,level) VALUES(?,?,1)").bind(req.name,buyer.id).run(); await env.DB.prepare("INSERT INTO faction_members(faction_id,user_id) VALUES(?,?)").bind(f.meta.last_row_id,buyer.id).run(); await env.DB.prepare("DELETE FROM faction_creation_requests WHERE user_id=?").bind(buyer.id).run(); }catch(e){} } } }
'''
if old not in s: raise SystemExit('payment block not found')
s=s.replace(old,new)
worker.write_text(s)

front=Path('xi-coin-v4/index.html'); h=front.read_text()
h=h.replace('<button class="btn" id="createFaction">Создать фракцию</button>','<button class="btn" id="createFaction">Создать фракцию · 20 ⭐</button>')
old="document.getElementById('myFaction').textContent=j.faction?'Твоя фракция: '+j.faction.name:'Ты пока не во фракции';document.getElementById('factionList').innerHTML=(j.factions||[]).map(f=>'<div class=\"list\">'+f.name+' · '+f.members+' игроков <button class=\"btn secondary\" data-join=\"'+f.id+'\">Вступить</button></div>').join('');"
new="document.getElementById('myFaction').innerHTML=j.faction?('<b>🛡️ '+j.faction.name+'</b><div class=\"small\">Уровень '+Number(j.faction.level||1)+'/10 · +'+Number(j.faction.bonusPercent||1)+'% к майнингу</div>'+(Number(j.faction.owner_id)===Number(user.id)?'<button class=\"btn secondary\" id=\"upgradeFaction\" '+(Number(j.faction.level||1)>=10?'disabled':'')+'>Улучшить · '+(j.faction.upgradeCost?Number(j.faction.upgradeCost).toLocaleString('ru-RU')+' XI':'МАКС.')+'</button>':'')):'Ты пока не во фракции';document.getElementById('factionList').innerHTML=(j.factions||[]).map(f=>'<div class=\"list\">'+f.name+' · ур. '+Number(f.level||1)+'/10 · +'+Number(f.level||1)+'% · '+f.members+' игроков <button class=\"btn secondary\" data-join=\"'+f.id+'\" '+(j.faction?'disabled':'')+'>Вступить</button></div>').join('');if(document.getElementById('upgradeFaction'))document.getElementById('upgradeFaction').onclick=async()=>{try{const x=await api('/api/faction-upgrade',{});toast('🛡️ Фракция улучшена до уровня '+x.level);loadEconomy()}catch(e){toast(e.message)}};"
if old not in h: raise SystemExit('frontend faction block not found')
h=h.replace(old,new)
old="document.getElementById('createFaction').onclick=async()=>{try{await api('/api/faction-create',{name:document.getElementById('factionName').value});toast('Фракция создана');loadEconomy()}catch(e){toast(e.message)}};"
new="document.getElementById('createFaction').onclick=async()=>{try{const name=document.getElementById('factionName').value.trim();if(!name)return toast('Введи название фракции');const x=await api('/api/faction-create',{name});if(tg?.openInvoice)tg.openInvoice(x.url,status=>{if(status==='paid'){setTimeout(loadEconomy,1500);toast('🛡️ Фракция создана!')}});else location.href=x.url}catch(e){toast(e.message)}};"
if old not in h: raise SystemExit('frontend create handler not found')
h=h.replace(old,new); front.write_text(h)
print('patch ok')
