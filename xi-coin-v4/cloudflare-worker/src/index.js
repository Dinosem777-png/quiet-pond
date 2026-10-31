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
  power: { title: "Xi Power +0.010", description: "Permanent +0.010 XI per click", stars: 150 },
  energy: { title: "Energy +5000", description: "Permanent +5000 maximum energy", stars: 80 },
  boost: { title: "VIP x2", description: "Permanent x2 click income", stars: 300 }
};
async function telegram(env, method, payload) {
  const r = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || "Telegram API error");
  return j.result;
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
  await db.prepare("INSERT OR IGNORE INTO users (tg_id, username, ref_code, referrer_id) VALUES (?, ?, ?, ?)")
    .bind(String(tg.id), tg.username || "", code, referrerId).run();
  return await db.prepare("SELECT * FROM users WHERE tg_id = ?").bind(String(tg.id)).first();
}
async function regenerateEnergy(db, u) {
  const now = Date.now();
  const last = Date.parse(String(u.energy_updated_at || new Date(now).toISOString()).replace(" ", "T") + (String(u.energy_updated_at || "").includes("Z") ? "" : "Z"));
  const elapsed = Math.max(0, now - (Number.isFinite(last) ? last : now));
  const gained = Math.floor(elapsed / 60000);
  if (gained > 0 || Number(u.energy) > Number(u.max_energy)) {
    const energy = Math.min(Number(u.max_energy), Number(u.energy) + gained);
    await db.prepare("UPDATE users SET energy = ?, energy_updated_at = ? WHERE id = ?")
      .bind(energy, new Date(now).toISOString(), u.id).run();
    u = { ...u, energy, energy_updated_at: new Date(now).toISOString() };
  }
  return u;
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
    const gain = Number(u.click_power) * Number(u.vip_multiplier || 1);
    const changed = await db.prepare("UPDATE users SET balance = balance + ?, energy = energy - 1, energy_updated_at = ? WHERE id = ? AND energy > 0").bind(gain, new Date().toISOString(), u.id).run();
    if (!changed.meta.changes) return json({ error: "Нет энергии" }, 400);
    if (u.referrer_id) await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").bind(gain * 0.05, u.referrer_id).run();
    return json({ user: await db.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first() });
  }
  if (url.pathname === "/api/upgrade" && method === "POST") {
    const u = await getUser(db, tg);
    if (body.type === "click") {
      const cost = Math.max(0.1, 0.1 * Math.pow(1.7, u.level - 1));
      const r = await db.prepare("UPDATE users SET balance = balance - ?, click_power = click_power + 0.001, level = level + 1 WHERE id = ? AND balance >= ?").bind(cost, u.id, cost).run();
      if (!r.meta.changes) return json({ error: "Недостаточно XI" }, 400);
    } else {
      const cost = Math.max(0.15, 0.15 * Math.pow(1.7, u.level - 1));
      const r = await db.prepare("UPDATE users SET balance = balance - ?, max_energy = max_energy + 500, energy = energy + 500 WHERE id = ? AND balance >= ?").bind(cost, u.id, cost).run();
      if (!r.meta.changes) return json({ error: "Недостаточно XI" }, 400);
    }
    return json({ user: await db.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first() });
  }
  if (url.pathname === "/api/transfer" && method === "POST") {
    const u = await getUser(db, tg);
    const to = String(body.to || "").replace(/^@/, "").trim();
    const amount = Number(body.amount);
    if (!to || !Number.isFinite(amount) || amount < 0.001 || amount > 1e12) return json({ error: "Проверь получателя и сумму" }, 400);
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
    await db.prepare("UPDATE users SET balance = balance + ?, daily_streak = ?, last_daily_day = ? WHERE id = ?")
      .bind(reward, streak, day, u.id).run();
    return json({ user: await db.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first(), dailyReward: reward });
  }
  if (url.pathname === "/api/ad-reward" && method === "POST") {
    const u = await getUser(db, tg);
    const day = new Date().toISOString().slice(0, 10);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM ads WHERE tg_id = ? AND day = ?").bind(String(tg.id), day).first();
    if (count.n >= 20) return json({ error: "Лимит рекламы на сегодня: 20" }, 429);
    await db.prepare("INSERT INTO ads (tg_id, day) VALUES (?, ?)").bind(String(tg.id), day).run();
    await db.prepare("UPDATE users SET balance = balance + 1 WHERE id = ?").bind(u.id).run();
    return json({ user: await db.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first(), reward: 1 });
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
        if (key === "power") await env.DB.prepare("UPDATE users SET click_power = click_power + 0.010 WHERE tg_id = ?").bind(tgId).run();
        if (key === "energy") await env.DB.prepare("UPDATE users SET max_energy = max_energy + 5000, energy = energy + 5000 WHERE tg_id = ?").bind(tgId).run();
        if (key === "boost") await env.DB.prepare("UPDATE users SET vip_multiplier = 2 WHERE tg_id = ?").bind(tgId).run();
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