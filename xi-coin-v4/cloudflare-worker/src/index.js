const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors }
  });
}
function hex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}
async function verifyTelegram(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date") || 0);
  if (!hash || !authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
  const check = [...params.entries()].filter(([k]) => k !== "hash").sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => k + "=" + v).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const expected = hex(await hmac(secret, check));
  if (expected.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= expected.charCodeAt(i) ^ hash.toLowerCase().charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const user = JSON.parse(params.get("user") || "{}");
    return user.id ? user : null;
  } catch { return null; }
}
const ITEMS = {
  power: { title: "Xi Power +0.010", description: "Permanent +0.010 XI per click", stars: 75 },
  energy: { title: "Energy +5000", description: "Permanent +5000 maximum energy", stars: 40 },
  boost: { title: "VIP x2 навсегда", description: "VIP: x2 к майнингу, энергии и кликам навсегда", stars: 150 },
  coins10: { title: "12 XI", description: "Покупка 12 игровых монет Xi Coin", stars: 10, coins: 12 },
  coins50: { title: "155 XI", description: "Покупка 155 игровых монет Xi Coin", stars: 50, coins: 155 },
  coins100: { title: "210 XI", description: "Покупка 210 игровых монет Xi Coin", stars: 100, coins: 210 },
  coins300: { title: "840 XI", description: "Покупка 840 игровых монет Xi Coin", stars: 300, coins: 840 },
  coins900: { title: "5500 XI", description: "Покупка 5500 игровых монет Xi Coin", stars: 900, coins: 5500 },
  passpremium: { title: "Премиум-пропуск Xi Coin", description: "Премиум-линия наград сезона", stars: 150 }
};
async function telegram(env, method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || "Telegram API error");
  return j.result;
}
async function issueCoins(db, userId, amount) {
  amount=Number(amount);
  if(!Number.isFinite(amount)||amount<=0)return true;
  const state=await db.prepare("UPDATE economy_state SET minted=minted+? WHERE id=1 AND minted+?<=max_supply RETURNING minted").bind(amount,amount).first();
  if(!state)return false;
  await db.prepare("UPDATE users SET balance=balance+? WHERE id=?").bind(amount,userId).run();
  return true;
}
async function bumpTask(db,userId,key,amount=1) {
  await db.prepare("INSERT INTO daily_task_progress(user_id,day,task_key,progress) VALUES(?,?,?,?) ON CONFLICT(user_id,day,task_key) DO UPDATE SET progress=progress+excluded.progress").bind(userId,utcDay(),key,amount).run();
}
async function recordAd(db,u,tgId,day) {
  await db.prepare("INSERT INTO ads(tg_id,day) VALUES(?,?)").bind(String(tgId),day).run();
  await db.prepare("INSERT INTO ad_progress(user_id,energy_progress) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET energy_progress=energy_progress+1").bind(u.id).run();
  const total=await db.prepare("SELECT COUNT(*) AS n FROM ads WHERE tg_id=?").bind(String(tgId)).first();
  const n=Number(total.n)||0;
  for(const [key,threshold,rate] of [["ad50",50,0.05],["ad100",100,0.1]]) {
    const target=Math.floor(n/threshold);
    const owned=await db.prepare("SELECT COUNT(*) AS n FROM miners WHERE user_id=? AND miner_key=?").bind(u.id,key).first();
    for(let i=Number(owned.n)||0;i<target;i++)await db.prepare("INSERT INTO miners(user_id,miner_key,last_claim_at) VALUES(?,?,?)").bind(u.id,key,new Date().toISOString()).run();
  }
  return {totalAds:n,energyProgress:Math.min(5,(await db.prepare("SELECT energy_progress FROM ad_progress WHERE user_id=?").bind(u.id).first()).energy_progress)};
}
async function getUser(db, tg, ref) {
  let u = await db.prepare("SELECT * FROM users WHERE tg_id = ?").bind(String(tg.id)).first();
  if (u) return u;
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  let referrerId = null;
  if (ref) {
    const referrer = await db.prepare("SELECT id FROM users WHERE ref_code = ?").bind(ref).first();
    referrerId = referrer?.id ?? null;
  }
  const inserted = await db.prepare("INSERT OR IGNORE INTO users (tg_id, username, ref_code, referrer_id) VALUES (?, ?, ?, ?)")
    .bind(String(tg.id), tg.username || "", code, referrerId).run();
  if (inserted.meta.changes) {
    // Welcome gift: one free Nano ASIC and 5 XI, granted only once at registration.
    await issueCoins(db, inserted.meta.last_row_id, 5);
    await db.prepare("INSERT INTO miners (user_id, miner_key, last_claim_at) VALUES (?, 'nano', ?)")
      .bind(inserted.meta.last_row_id, new Date().toISOString()).run();
    if (referrerId) {
      await issueCoins(db, referrerId, 1);
      await db.prepare("UPDATE users SET referral_paid = 1 WHERE tg_id = ?").bind(String(tg.id)).run();
    }
  }
  return await db.prepare("SELECT * FROM users WHERE tg_id = ?").bind(String(tg.id)).first();
}
async function regenerateEnergy(db, u) {
  const now = Date.now();
  const raw = u.energy_updated_at;
  const last = raw
    ? Date.parse(String(raw).replace(" ", "T") + (String(raw).includes("Z") ? "" : "Z"))
    : now;
  const elapsed = Math.max(0, now - (Number.isFinite(last) ? last : now));
  const gained = Math.floor(elapsed / 20000);
  const energy = Math.min(Number(u.max_energy), Number(u.energy) + gained);
  if (!raw || gained > 0 || Number(u.energy) > Number(u.max_energy)) {
    const stamp = raw && gained === 0 ? raw : new Date(now).toISOString();
    await db.prepare("UPDATE users SET energy = ?, energy_updated_at = ? WHERE id = ?")
      .bind(energy, stamp, u.id).run();
    u = { ...u, energy, energy_updated_at: stamp };
  }
  return u;
}
function progressionStats(totalXp) {
  const cap = 1000 * 999 + 250 * 999 * 998;
  let xp = Math.max(0, Math.min(cap, Math.floor(Number(totalXp) || 0)));
  let level = 1;
  let remaining = xp;
  let needed = 1000;
  while (level < 1000 && remaining >= needed) {
    remaining -= needed;
    level++;
    needed = 1000 + (level - 1) * 500;
  }
  return { level, xpIntoLevel: level >= 1000 ? needed : remaining, xpNeeded: needed, xpGainForClick: null };
}
function utcDay(date = new Date()) { return date.toISOString().slice(0, 10); }
function previousDay(day) { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1); return utcDay(d); }
async function requireUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const initData = auth.replace(/^tma\s+/i, "");
  return await verifyTelegram(initData, env.BOT_TOKEN);
}
async function api(request, env, url, tg) {
  const db = env.DB;
  if (!db) return json({ error: "D1 не подключена. Настрой binding DB." }, 500);
  const method = request.method;
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};
  if (url.pathname === "/api/me" && method === "GET") {
    let u = await getUser(db, tg, url.searchParams.get("ref"));
    u = await regenerateEnergy(db, u);
    const rating = await db.prepare("SELECT username, balance FROM users ORDER BY balance DESC LIMIT 20").all();
    const refs = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE referrer_id = ?").bind(u.id).first();
    const today = utcDay();
    const adCount = await db.prepare("SELECT COUNT(*) AS n FROM ads WHERE tg_id = ? AND day = ?").bind(String(tg.id), today).first();
    return json({ user: u, rating: rating.results || [], referrals: refs.n, adCount: adCount.n, dailyStreak: u.daily_streak || 0, dailyAvailable: u.last_daily_day !== today, items: ITEMS });
  }
  if (url.pathname === "/api/click" && method === "POST") {
    let u = await getUser(db, tg, body.ref);
    u = await regenerateEnergy(db, u);
    const currentLevel = Number(u.player_level || 1);
    const levelBonus = Math.max(0, Math.min(1, (currentLevel - 1) / 999));
    const gain = (Number(u.click_power) / 3) * Number(u.vip_multiplier || 1) * (1 + levelBonus);
    const changed = await db.prepare("UPDATE users SET energy=energy-1,energy_updated_at=? WHERE id=? AND energy>0").bind(new Date().toISOString(),u.id).run();
    if(!changed.meta.changes)return json({error:"Нет энергии"},400);
    if(!(await issueCoins(db,u.id,gain))){await db.prepare("UPDATE users SET energy=energy+1 WHERE id=?").bind(u.id).run();return json({error:"Все 10 000 000 XI уже добыты. Произойдёт чудо! ✨"},400);}
    const xpPerClick = 1 + (Math.max(0, Math.min(1000, Number(u.level || 1) - 1)) * 0.1);
    const xpCap = 1000 * 999 + 250 * 999 * 998;
    const nextXp = Math.min(xpCap, Number(u.xp || 0) + xpPerClick);
    const nextProgress = progressionStats(nextXp);
    const nextLevel = nextProgress.level;
    const nextBonus = Math.max(0, Math.min(1, (nextLevel - 1) / 999));
    const energyScale = (1 + nextBonus) / (1 + levelBonus);
    const levelReward = nextLevel > currentLevel ? nextLevel : 0;
    if(levelReward > 0) await issueCoins(db,u.id,levelReward);
    await db.prepare("UPDATE users SET total_clicks=total_clicks+1,xp=?,player_level=?,max_energy=CAST(ROUND(max_energy*?) AS INTEGER) WHERE id=?")
      .bind(nextXp,nextLevel,energyScale,u.id).run();
    await bumpTask(db,u.id,"clicks",1);
    await db.prepare("INSERT INTO pass_progress(user_id,season,xp,claimed_level,premium) VALUES(?,'2026-11',1,0,0) ON CONFLICT(user_id,season) DO UPDATE SET xp=xp+1").bind(u.id).run();
    if(u.referrer_id)await issueCoins(db,u.referrer_id,gain*0.05);
    return json({user:await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first(),gain,earnedCoins:gain,xpGain:xpPerClick,levelReward,newLevel:nextLevel>currentLevel?nextLevel:null});
  }
  if (url.pathname === "/api/upgrade" && method === "POST") {
    const u = await getUser(db, tg);
    if (body.type === "click") {
      const cost = Math.max(0.033333, (0.1 * Math.pow(1.7, u.level - 1)) / 3);
      const r = await db.prepare("UPDATE users SET balance = balance - ?, click_power = click_power + 0.000333333, level = level + 1 WHERE id = ? AND balance >= ?").bind(cost, u.id, cost).run();
      if (!r.meta.changes) return json({ error: "Недостаточно XI" }, 400);
    } else {
      const cost = Math.max(0.05, (0.15 * Math.pow(1.7, u.level - 1)) / 3);
      const r = await db.prepare("UPDATE users SET balance = balance - ?, max_energy = max_energy + 500, energy = energy + 500 WHERE id = ? AND balance >= ?").bind(cost, u.id, cost).run();
      if (!r.meta.changes) return json({ error: "Недостаточно XI" }, 400);
    }
    return json({ user: await db.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first() });
  }
  if (url.pathname === "/api/transfer" && method === "POST") {
    const u = await getUser(db, tg);
    const to = String(body.to || "").replace(/^@/, "").trim();
    const amount = Number(body.amount);
    if (!to || !Number.isFinite(amount) || amount < 1000 || amount > 1e12) return json({ error: "Минимальный перевод — 1000 XI. Проверь получателя и сумму" }, 400);
    const receiver = await db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").bind(to).first();
    if (!receiver || receiver.id === u.id) return json({ error: "Проверь получателя и сумму" }, 400);
    const debit = await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?").bind(amount, u.id, amount).run();
    if (!debit.meta.changes) return json({ error: "Недостаточно XI" }, 400);
    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").bind(amount, receiver.id).run();
    await db.prepare("INSERT INTO transfers (sender_id, receiver_id, amount) VALUES (?, ?, ?)").bind(u.id, receiver.id, amount).run();
    return json({ user: await db.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first() });
  }
  if (url.pathname === "/api/daily" && method === "POST") {
    const u = await getUser(db, tg);
    const day = utcDay();
    const yesterday = previousDay(day);
    const streak = u.last_daily_day === yesterday ? Math.min(7, Number(u.daily_streak || 0) + 1) : 1;
    const rewards = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
    const reward = rewards[streak - 1];
    const claimed = await db.prepare("INSERT OR IGNORE INTO daily (user_id, day) VALUES (?, ?)").bind(u.id, day).run();
    if (!claimed.meta.changes) return json({ error: "Сегодня бонус уже получен" }, 400);
    if(!(await issueCoins(db,u.id,reward))){await db.prepare("DELETE FROM daily WHERE user_id=? AND day=?").bind(u.id,day).run();return json({error:"Лимит 10 000 000 XI достигнут"},400);}
    await db.prepare("UPDATE users SET daily_streak=?,last_daily_day=? WHERE id=?").bind(streak,day,u.id).run();
    await bumpTask(db,u.id,"daily",1);
    return json({user:await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first(),dailyReward:reward});
  }
  if (url.pathname === "/api/ad-reward" && method === "POST") {
    const u = await getUser(db, tg);
    const day = new Date().toISOString().slice(0, 10);
    let adInfo;try{adInfo=await recordAd(db,u,tg.id,day)}catch(e){return json({error:e.message},429)}
    if(!(await issueCoins(db,u.id,1)))return json({error:"Лимит 10 000 000 XI достигнут"},400);
    await bumpTask(db,u.id,"ads",1);
    return json({user:await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first(),reward:1,...adInfo});
  }
  if(url.pathname==="/api/energy-ad-refill"&&method==="POST"){
    const u=await getUser(db,tg);
    const p=await db.prepare("SELECT energy_progress FROM ad_progress WHERE user_id=?").bind(u.id).first();
    if(!p||Number(p.energy_progress)<5)return json({error:"Нужно посмотреть ещё рекламу: "+Math.max(0,5-Number(p?.energy_progress||0))},400);
    const used=await db.prepare("UPDATE ad_progress SET energy_progress=energy_progress-5 WHERE user_id=? AND energy_progress>=5").bind(u.id).run();
    if(!used.meta.changes)return json({error:"Недостаточно просмотров"},400);
    await db.prepare("UPDATE users SET energy=max_energy,energy_updated_at=? WHERE id=?").bind(new Date().toISOString(),u.id).run();
    return json({ok:true,user:await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first()});
  }
  if(url.pathname==="/api/roulette-spin"&&method==="POST"){
    const u=await getUser(db,tg),day=utcDay();
    let adInfo;try{adInfo=await recordAd(db,u,tg.id,day)}catch(e){return json({error:e.message},429)}
    const roll=Math.random()*100;let reward=1;
    if(roll<70)reward=1;else if(roll<90)reward=2;else if(roll<95)reward=5;else if(roll<97)reward=10;else if(roll<99)reward=50;else reward=100;
    if(!(await issueCoins(db,u.id,reward)))return json({error:"Лимит 10 000 000 XI достигнут"},400);
    await db.prepare("INSERT INTO roulette_spins(user_id,reward) VALUES(?,?)").bind(u.id,reward).run();
    return json({ok:true,reward,...adInfo,user:await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first()});
  }

  if (url.pathname === "/api/pass" && method === "GET") {
    const u=await getUser(db,tg),season="2026-11";
    const row=await db.prepare("SELECT xp,claimed_level,premium FROM pass_progress WHERE user_id=? AND season=?").bind(u.id,season).first();
    const xp=Number(row?.xp||0);
    return json({season,xp,level:Math.min(30,Math.floor(xp/100)+1),claimedLevel:Number(row?.claimed_level||0),premium:!!Number(row?.premium||0)});
  }
  if (url.pathname === "/api/pass-claim" && method === "POST") {
    const u=await getUser(db,tg),season="2026-11",level=Math.max(1,Math.min(30,Number(body.level)||0));
    const row=await db.prepare("SELECT xp,claimed_level,premium FROM pass_progress WHERE user_id=? AND season=?").bind(u.id,season).first();
    if(!row||Math.floor(Number(row.xp||0)/100)+1<level)return json({error:"Уровень пропуска ещё не достигнут"},400);
    if(Number(row.claimed_level||0)>=level)return json({error:"Награда уже получена"},400);
    const rare=level===10?"rare":level===20?"epic":level===30?"legendary":null;
    const reward=Number((level*0.1).toFixed(2));
    if(!(await issueCoins(db,u.id,reward)))return json({error:"Лимит XI достигнут"},400);
    if(Number(row.premium)&&rare)await db.prepare("INSERT INTO miners(user_id,miner_key,last_claim_at) VALUES(?,?,?)").bind(u.id,rare,new Date().toISOString()).run();
    await db.prepare("UPDATE pass_progress SET claimed_level=? WHERE user_id=? AND season=? AND claimed_level<?").bind(level,u.id,season,level).run();
    return json({ok:true,reward,rareMiner:Number(row.premium)?rare:null});
  }
  if (url.pathname === "/api/miner-upgrade" && method === "POST") {
    const u=await getUser(db,tg),id=Number(body.id);
    const owned=await db.prepare("SELECT id FROM miners WHERE id=? AND user_id=?").bind(id,u.id).first();
    if(!owned)return json({error:"ASIC не найден"},404);
    const old=await db.prepare("SELECT level FROM miner_levels WHERE miner_id=?").bind(id).first();
    const level=Number(old?.level||1);
    if(level>=10)return json({error:"Максимальный уровень ASIC"},400);
    const cost=Math.round(100*Math.pow(2,level-1));
    const debit=await db.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(cost,u.id,cost).run();
    if(!debit.meta.changes)return json({error:"Недостаточно XI. Нужно "+cost+" XI"},400);
    await db.prepare("INSERT INTO miner_levels(user_id,miner_id,level) VALUES(?,?,?) ON CONFLICT(miner_id) DO UPDATE SET level=excluded.level").bind(u.id,id,level+1).run();
    return json({ok:true,level:level+1,cost});
  }
  if (url.pathname === "/api/buy" && method === "POST") {
    const item = ITEMS[String(body.item || "")];
    if (!item || !env.BOT_TOKEN) return json({ error: "Покупки пока не настроены" }, 400);
    const payload = "xi4:" + body.item + ":" + tg.id + ":" + crypto.randomUUID();
    try {
      const invoice = await telegram(env, "createInvoiceLink", {
        title: item.title, description: item.description, payload, currency: "XTR",
        prices: [{ label: item.title, amount: item.stars }]
      });
      return json({ url: invoice });
    } catch (e) { return json({ error: e.message }, 500); }
  }
  if (url.pathname === "/api/economy" && method === "GET") {
    const u = await getUser(db, tg);
    const miners = await db.prepare("SELECT miner_key, COUNT(*) AS count FROM miners WHERE user_id = ? GROUP BY miner_key").bind(u.id).all();
    const mineList = await db.prepare("SELECT id, miner_key, last_claim_at FROM miners WHERE user_id = ?").bind(u.id).all();
    const member = await db.prepare("SELECT f.id, f.name FROM faction_members m JOIN factions f ON f.id=m.faction_id WHERE m.user_id=?").bind(u.id).first();
    const factions = await db.prepare("SELECT f.id,f.name,COUNT(m.user_id) AS members FROM factions f LEFT JOIN faction_members m ON m.faction_id=f.id GROUP BY f.id ORDER BY members DESC LIMIT 20").all();
    const chat = await db.prepare("SELECT c.message,c.username,c.created_at FROM chat_messages c ORDER BY c.id DESC LIMIT 30").all();
    const adsTotal=await db.prepare("SELECT COUNT(*) AS n FROM ads WHERE tg_id=?").bind(String(tg.id)).first(); const adProg=await db.prepare("SELECT energy_progress FROM ad_progress WHERE user_id=?").bind(u.id).first(); const ad50=await db.prepare("SELECT COUNT(*) AS n FROM miners WHERE user_id=? AND miner_key='ad50'").bind(u.id).first(); const ad100=await db.prepare("SELECT COUNT(*) AS n FROM miners WHERE user_id=? AND miner_key='ad100'").bind(u.id).first(); const rates={nano:0.005,pocket:0.02,starter:0.06,basic:0.08,pro:0.6,farm:5,ad50:0.05,ad100:0.1,rare:0.25,epic:1,legendary:4}; const baseHourly=(mineList.results||[]).reduce((s,m)=>s+(rates[m.miner_key]||0),0); const levelBonus=Math.max(0,Math.min(1,(Number(u.player_level||1)-1)/999)); const hourlyIncome=baseHourly*Number(u.vip_multiplier||1)*(1+levelBonus);
    return json({baseHourly,hourlyIncome,vip: Number(u.vip_multiplier||1)>=2,level:Number(u.player_level||1),levelBonus:levelBonus*100,totalAds:adsTotal.n,energyProgress:adProg?.energy_progress||0,ad50:ad50.n,ad100:ad100.n,miners:mineList.results||[], faction:member||null, factions:factions.results||[], chat:(chat.results||[]).reverse(), catalog:[
      {key:"nano",name:"ASIC Nano",price:100,rate:0.005},
      {key:"pocket",name:"ASIC Pocket",price:500,rate:0.02},
      {key:"starter",name:"ASIC Starter",price:1500,rate:0.06},
      {key:"basic",name:"ASIC Mini",price:2500,rate:0.08},
      {key:"pro",name:"ASIC Pro",price:15000,rate:0.6},
      {key:"farm",name:"ASIC Farm",price:100000,rate:5},{key:"ad50",name:"Рекламный ASIC 50",price:0,rate:0.05},{key:"ad100",name:"Рекламный ASIC 100",price:0,rate:0.1}
    ]});
  }
  if(url.pathname==="/api/progression"&&method==="GET"){
    const u=await getUser(db,tg);
    const supply=await db.prepare("SELECT minted,max_supply FROM economy_state WHERE id=1").first();
    const players=await db.prepare("SELECT username,balance FROM users ORDER BY balance DESC LIMIT 20").all();
    const factions=await db.prepare("SELECT f.name,COUNT(m.user_id) AS members,COALESCE(SUM(u.balance),0) AS score FROM factions f LEFT JOIN faction_members m ON m.faction_id=f.id LEFT JOIN users u ON u.id=m.user_id GROUP BY f.id ORDER BY score DESC LIMIT 20").all();
    const tasks=await db.prepare("SELECT task_key,progress,claimed FROM daily_task_progress WHERE user_id=? AND day=?").bind(u.id,utcDay()).all();
    const miners=await db.prepare("SELECT COUNT(*) AS n FROM miners WHERE user_id=?").bind(u.id).first();
    const refs=await db.prepare("SELECT COUNT(*) AS n FROM users WHERE referrer_id=?").bind(u.id).first();
    const defs=[["first_click","Первый клик","Сделай первый клик",Number(u.total_clicks)>=1],["click_100","Кликер","Сделай 100 кликов",Number(u.total_clicks)>=100],["click_1000","Мастер кликов","Сделай 1000 кликов",Number(u.total_clicks)>=1000],["first_miner","Первая ферма","Купи первый ASIC",Number(miners.n)>0],["ref_5","Вербовщик","Пригласи 5 игроков",Number(refs.n)>=5]];
    for(const a of defs)if(a[3])await db.prepare("INSERT OR IGNORE INTO achievements(user_id,achievement_key) VALUES(?,?)").bind(u.id,a[0]).run();
    const achievements=await db.prepare("SELECT achievement_key,unlocked_at FROM achievements WHERE user_id=?").bind(u.id).all();
    const prog=progressionStats(u.xp||0);
    return json({supply,userLevel:prog.level,xp:Number(u.xp||0),xpIntoLevel:prog.xpIntoLevel,xpNeeded:prog.xpNeeded,xpPerClick:1+(Math.max(0,Math.min(1000,Number(u.level||1)-1))*0.1),levelBonus:Math.max(0,Math.min(100,(prog.level-1)*100/999)),players:players.results||[],factions:factions.results||[],tasks:tasks.results||[],achievements:achievements.results||[],achievementDefs:defs.map(a=>({key:a[0],name:a[1],description:a[2],unlocked:a[3]}))});
  }
  if(url.pathname==="/api/task-claim"&&method==="POST"){
    const u=await getUser(db,tg),defs={clicks:{goal:50,reward:0.5},daily:{goal:1,reward:0.25},ads:{goal:1,reward:0.5},miners:{goal:1,reward:0.5}};
    const key=String(body.task||""),def=defs[key];if(!def)return json({error:"Задание не найдено"},400);
    const row=await db.prepare("SELECT progress,claimed FROM daily_task_progress WHERE user_id=? AND day=? AND task_key=?").bind(u.id,utcDay(),key).first();
    if(!row||row.progress<def.goal)return json({error:"Задание ещё не выполнено"},400);
    const claim=await db.prepare("UPDATE daily_task_progress SET claimed=1 WHERE user_id=? AND day=? AND task_key=? AND claimed=0").bind(u.id,utcDay(),key).run();
    if(!claim.meta.changes)return json({error:"Награда уже получена"},400);
    if(!(await issueCoins(db,u.id,def.reward)))return json({error:"Лимит XI достигнут"},400);
    return json({ok:true,reward:def.reward});
  }
  if (url.pathname === "/api/miner-buy" && method === "POST") {
    const u=await getUser(db,tg);
    const catalog={nano:{price:100},pocket:{price:500},starter:{price:1500},basic:{price:2500},pro:{price:15000},farm:{price:100000}};
    const item=catalog[String(body.miner||"")];
    if(!item) return json({error:"Неизвестный ASIC"},400);
    const debit=await db.prepare("UPDATE users SET balance=balance-? WHERE id=? AND balance>=?").bind(item.price,u.id,item.price).run();
    if(!debit.meta.changes) return json({error:"Недостаточно XI"},400);
    await db.prepare("INSERT INTO miners(user_id,miner_key,last_claim_at) VALUES(?,?,?)").bind(u.id,body.miner,new Date().toISOString()).run();
    return json({ok:true});
  }
  if (url.pathname === "/api/miner-claim" && method === "POST") {
    const u=await getUser(db,tg);
    const rates={nano:0.005,pocket:0.02,starter:0.06,basic:0.08,pro:0.6,farm:5,ad50:0.05,ad100:0.1};
    const owned=await db.prepare("SELECT id,miner_key,last_claim_at FROM miners WHERE user_id=?").bind(u.id).all();
    let reward=0;
    for(const m of owned.results||[]){
      const last=Date.parse(String(m.last_claim_at).replace(" ","T")+(String(m.last_claim_at).includes("Z")?"":"Z"));
      const hours=Math.min(24,Math.max(0,(Date.now()-(Number.isFinite(last)?last:Date.now()))/3600000));
      const ml=await db.prepare("SELECT level FROM miner_levels WHERE miner_id=?").bind(m.id).first(); reward+=hours*(rates[m.miner_key]||0)*Number(ml?.level||1);
    }
    const levelBonus=Math.max(0,Math.min(1,(Number(u.player_level||1)-1)/999));
    reward*=Number(u.vip_multiplier||1)*(1+levelBonus);
    if(reward>0&&!(await issueCoins(db,u.id,reward)))return json({error:"Лимит XI достигнут"},400);
    for(const m of owned.results||[])await db.prepare("UPDATE miners SET last_claim_at=? WHERE id=?").bind(new Date().toISOString(),m.id).run();
    if(reward>0){await bumpTask(db,u.id,"miners",1);await db.prepare("INSERT INTO pass_progress(user_id,season,xp,claimed_level,premium) VALUES(?,'2026-11',10,0,0) ON CONFLICT(user_id,season) DO UPDATE SET xp=xp+10").bind(u.id).run();}
    return json({reward,user:await db.prepare("SELECT * FROM users WHERE id=?").bind(u.id).first()});
  }
  if (url.pathname === "/api/faction-create" && method === "POST") {
    const u=await getUser(db,tg); const name=String(body.name||"").trim();
    if(name.length<3||name.length>20) return json({error:"Название: от 3 до 20 символов"},400);
    const has=await db.prepare("SELECT faction_id FROM faction_members WHERE user_id=?").bind(u.id).first();
    if(has) return json({error:"Ты уже состоишь во фракции"},400);
    try { const r=await db.prepare("INSERT INTO factions(name,owner_id) VALUES(?,?)").bind(name,u.id).run(); await db.prepare("INSERT INTO faction_members(faction_id,user_id) VALUES(?,?)").bind(r.meta.last_row_id,u.id).run(); }
    catch(e){return json({error:"Такое название уже занято"},400)}
    return json({ok:true});
  }
  if (url.pathname === "/api/faction-join" && method === "POST") {
    const u=await getUser(db,tg); const has=await db.prepare("SELECT faction_id FROM faction_members WHERE user_id=?").bind(u.id).first();
    if(has) return json({error:"Ты уже состоишь во фракции"},400);
    const f=await db.prepare("SELECT id FROM factions WHERE id=?").bind(Number(body.id)).first();
    if(!f) return json({error:"Фракция не найдена"},404);
    await db.prepare("INSERT INTO faction_members(faction_id,user_id) VALUES(?,?)").bind(f.id,u.id).run(); return json({ok:true});
  }
  if (url.pathname === "/api/chat-send" && method === "POST") {
    const u=await getUser(db,tg); const message=String(body.message||"").trim();
    if(!message||message.length>300) return json({error:"Сообщение: до 300 символов"},400);
    await db.prepare("INSERT INTO chat_messages(user_id,username,message) VALUES(?,?,?)").bind(u.id,u.username||"Игрок",message).run();
    return json({ok:true});
  }
  return json({ error: "Not found" }, 404);
}
async function webhook(request, env) {
  if (!env.BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN is missing" }, 500);
  if (env.TELEGRAM_WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET)
    return json({ ok: false }, 403);
  const update = await request.json().catch(() => ({}));
  try {
    if (update.pre_checkout_query) {
      await telegram(env, "answerPreCheckoutQuery", { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
      return json({ ok: true });
    }
    if (update.message?.text?.trim().startsWith("/start")) {
      await telegram(env, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "Добро пожаловать в Xi Coin! Чтобы открыть игру, нажми кнопку Menu внизу чата."
      });
      return json({ ok: true });
    }
    const payment = update.message?.successful_payment;
    if (payment) {
      const tgId = String(update.message.from.id);
      const [prefix, key, payloadUserId] = String(payment.invoice_payload).split(":");
      const item = ITEMS[key];
      if (prefix !== "xi4" || payloadUserId !== tgId || payment.currency !== "XTR" || !item || Number(payment.total_amount) !== item.stars)
        return json({ ok: false, error: "Invalid payment" }, 400);
      const exists = await env.DB.prepare("SELECT id FROM purchases WHERE payload = ?").bind(payment.invoice_payload).first();
      if (!exists) {
        await env.DB.prepare("INSERT OR IGNORE INTO purchases (tg_id, payload, stars, item) VALUES (?, ?, ?, ?)")
          .bind(tgId, payment.invoice_payload, payment.total_amount, key).run();
        if (item.coins) {
          const buyer = await env.DB.prepare("SELECT id FROM users WHERE tg_id = ?").bind(tgId).first();
          if (buyer) await issueCoins(env.DB,buyer.id,item.coins);
        }
        if (key === "power") await env.DB.prepare("UPDATE users SET click_power = click_power + 0.010 WHERE tg_id = ?").bind(tgId).run();
        if (key === "energy") await env.DB.prepare("UPDATE users SET max_energy = max_energy + 5000, energy = energy + 5000 WHERE tg_id = ?").bind(tgId).run();
        if (key === "boost") await env.DB.prepare("UPDATE users SET vip_multiplier = 2, max_energy = CASE WHEN vip_multiplier < 2 THEN max_energy * 2 ELSE max_energy END, energy = CASE WHEN vip_multiplier < 2 THEN MIN(max_energy * 2, energy * 2) ELSE energy END WHERE tg_id = ?").bind(tgId).run();
        if (key === "passpremium") await env.DB.prepare("UPDATE pass_progress SET premium=1 WHERE user_id=(SELECT id FROM users WHERE tg_id=?) AND season='2026-11'").bind(tgId).run();
      }
    }
    return json({ ok: true });
  } catch (e) { console.error("Xi Coin Telegram webhook error:", e?.stack || e?.message || String(e)); return json({ ok: false, error: e?.message || "Webhook error" }, 500); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/telegram/diagnostics" && request.method === "GET") {
      if (!env.BOT_TOKEN) return json({ botTokenConfigured: false });
      const [meRes, hookRes] = await Promise.all([
        fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/getMe"),
        fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/getWebhookInfo")
      ]);
      const [me, hook] = await Promise.all([meRes.json(), hookRes.json()]);
      return json({
        botTokenConfigured: true,
        botApiOk: !!me.ok,
        botUsername: me.ok ? me.result.username : null,
        webhookApiOk: !!hook.ok,
        webhookUrlSet: !!(hook.ok && hook.result.url),
        webhookUrlMatches: !!(hook.ok && hook.result.url === new URL(request.url).origin + "/telegram/webhook"),
        pendingUpdates: hook.ok ? hook.result.pending_update_count : null,
        lastWebhookError: hook.ok ? (hook.result.last_error_message || null) : (hook.description || "getWebhookInfo failed"),
        lastWebhookErrorDate: hook.ok ? (hook.result.last_error_date || null) : null
      });
    }
    if (url.pathname === "/telegram/webhook" && request.method === "POST") return webhook(request, env);
    if (url.pathname.startsWith("/api/")) {
      const tg = await requireUser(request, env);
      if (!tg) return json({ error: "Открой игру через Telegram" }, 401);
      try { return await api(request, env, url, tg); }
      catch (e) { return json({ error: e.message || "Server error" }, 500); }
    }
    return json({ service: "Xi Coin v4 Cloudflare Worker", ok: true });
  }
};