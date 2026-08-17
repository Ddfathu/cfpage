// ====== PENGATURAN UTAMA ======
const SCANNER_UUID = "1f37ac4f-fdd0-49df-9406-1eda70a1d512"; 
const FALLBACK_URLS = [];

// --- HELPER KV STORE ---
async function getUrls(env) {
  try {
    if (env && env.URL_STORE) {
      const data = await env.URL_STORE.get("worker_urls");
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch (e) {}
  return FALLBACK_URLS; 
}

async function saveUrls(env, urls) {
  try {
    if (env && env.URL_STORE) await env.URL_STORE.put("worker_urls", JSON.stringify(urls));
  } catch (e) {}
}

async function getAdminPassword(env) {
  try {
    if (env && env.URL_STORE) return await env.URL_STORE.get("admin_password");
  } catch (e) {}
  return null;
}

async function setAdminPassword(env, password) {
  try {
    if (env && env.URL_STORE) await env.URL_STORE.put("admin_password", password);
  } catch (e) {}
}

async function getSessionToken(env) {
  try {
    if (env && env.URL_STORE) return await env.URL_STORE.get("admin_session");
  } catch (e) {}
  return null;
}

async function setSessionToken(env, token) {
  try {
    if (env && env.URL_STORE) await env.URL_STORE.put("admin_session", token, { expirationTtl: 86400 * 7 });
  } catch (e) {}
}

async function getCfAccounts(env) {
  try {
    if (env && env.URL_STORE) {
      const data = await env.URL_STORE.get("cf_accounts");
      if (data) return JSON.parse(data);
    }
  } catch (e) {}
  return [];
}

async function saveCfAccounts(env, accounts) {
  try {
    if (env && env.URL_STORE) await env.URL_STORE.put("cf_accounts", JSON.stringify(accounts));
  } catch (e) {}
}

async function getTeleConfig(env) {
  try {
    if (env && env.URL_STORE) {
      const data = await env.URL_STORE.get("tele_config");
      if (data) return JSON.parse(data);
    }
  } catch (e) {}
  return { token: "", chatId: "" };
}

async function saveTeleConfig(env, config) {
  try {
    if (env && env.URL_STORE) await env.URL_STORE.put("tele_config", JSON.stringify(config));
  } catch (e) {}
}

function cleanUrlInput(rawUrl) {
  if (!rawUrl) return '';
  return rawUrl.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

async function isAuthenticated(request, env) {
  try {
    const cookieHeader = request.headers.get("Cookie") || "";
    const match = cookieHeader.match(/session_token=([^;]+)/);
    if (!match) return false;
    
    const userToken = match[1];
    const validToken = await getSessionToken(env);
    return validToken && userToken === validToken;
  } catch (e) {
    return false;
  }
}

// --- SCANNER STATUS ---
async function checkUrlStatus(url) {
  const testPaths = ['/vmess', '/103.6.207.108-8080', '/vless', '/vless-argo', '/trojan', '/'];
  const cleanHost = cleanUrlInput(url).split('/')[0];
  let lastStatus = "DOWN";

  for (const path of testPaths) {
    try {
      const res = await fetch(`https://${cleanHost}${path}`, { 
        method: 'GET', 
        headers: {
          'Upgrade': 'websocket',
          'Connection': 'Upgrade',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
          'X-Sub-Id': SCANNER_UUID,
          'Authorization': `Bearer ${SCANNER_UUID}`
        },
        redirect: 'manual' 
      });
      
      lastStatus = res.status;
      if (res.status === 101) return { isAlive: true, status: 101, path: path };
    } catch (e) {
      continue;
    }
  }
  return { isAlive: false, status: lastStatus, path: "" };
}

// --- BOT TELEGRAM HELPER & HANDLER ---
async function sendTeleMessage(token, chatId, text, keyboard = null) {
  if (!token || !chatId) return { ok: false };
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML"
  };
  if (keyboard) payload.reply_markup = keyboard;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch(e) {
    return { ok: false, description: e.message };
  }
}

async function editTeleMessage(token, chatId, messageId, text, keyboard = null) {
  if (!token || !chatId) return;
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: "HTML"
  };
  if (keyboard) payload.reply_markup = keyboard;

  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch(e) {}
}

function getTeleMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: "🔍 Cek Status Tunnel", callback_data: "check_status" },
        { text: "📜 List Tunnel Server", callback_data: "list_urls" }
      ],
      [
        { text: "➕ Tambah Tunnel", callback_data: "ask_add_url" },
        { text: "🗑️ Hapus Tunnel", callback_data: "ask_del_url" }
      ],
      [
        { text: "🌐 List Custom Domain", callback_data: "list_domains" }
      ]
    ]
  };
}

async function handleTelegramWebhook(request, env) {
  const teleConfig = await getTeleConfig(env);
  if (!teleConfig.token) return new Response("OK");

  try {
    const update = await request.json();

    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message.chat.id;
      const messageId = query.message.message_id;
      const data = query.data;

      if (data.startsWith("confirm_del:")) {
        const urlToDel = data.replace("confirm_del:", "");
        let urls = await getUrls(env);
        const index = urls.indexOf(urlToDel);

        if (index !== -1) {
          urls.splice(index, 1);
          await saveUrls(env, urls);
          await editTeleMessage(teleConfig.token, chatId, messageId, `🗑️ <b>URL Berhasil Dihapus:</b>\n<code>${urlToDel}</code>`, getTeleMainMenu());
        } else {
          await editTeleMessage(teleConfig.token, chatId, messageId, `⚠️ <b>URL sudah tidak ada di KV Store.</b>`, getTeleMainMenu());
        }
      } else if (data === "cancel_del") {
        await editTeleMessage(teleConfig.token, chatId, messageId, "❌ <i>Penghapusan dibatalkan.</i>", getTeleMainMenu());
      } else if (data === "check_status") {
        await sendTeleMessage(teleConfig.token, chatId, "⏳ <b>Sedang mengecek semua status tunnel...</b>");
        const urls = await getUrls(env);
        if (urls.length === 0) {
          await sendTeleMessage(teleConfig.token, chatId, "❌ Belum ada URL tersimpan di list.");
        } else {
          let report = "📊 <b>Laporan Status Tunnel Server:</b>\n\n";
          for (const u of urls) {
            const st = await checkUrlStatus(u);
            if (st.isAlive) {
              report += `✅ <code>${u}</code> -> <b>101 ALIVE</b> (${st.path})\n`;
            } else {
              report += `❌ <code>${u}</code> -> <b>ERR: ${st.status}</b>\n`;
            }
          }
          await sendTeleMessage(teleConfig.token, chatId, report, getTeleMainMenu());
        }
      } else if (data === "list_urls") {
        const urls = await getUrls(env);
        let msg = "🔗 <b>List Tunnel Server:</b> \n\n";
        if (urls.length === 0) msg += "Belum ada URL tersimpan.";
        else urls.forEach((u, i) => msg += `${i + 1}. <code>${u}</code>\n`);
        await sendTeleMessage(teleConfig.token, chatId, msg, getTeleMainMenu());
      } else if (data === "ask_add_url") {
        await sendTeleMessage(teleConfig.token, chatId, "✍️ <b>Kirimkan URL Tunnel Server Baru:</b>\n\nContoh:\n<code>my-tunnel.trycloudflare.com</code>\natau gunakan command:\n<code>/add my-tunnel.trycloudflare.com</code>");
      } else if (data === "ask_del_url") {
        const urls = await getUrls(env);
        if (urls.length === 0) {
          await sendTeleMessage(teleConfig.token, chatId, "❌ Belum ada URL untuk dihapus.", getTeleMainMenu());
        } else {
          let msg = "🗑️ <b>Pilih Nomor URL yang Ingin Dihapus:</b>\n\nKetik <code>/del &lt;nomor&gt;</code>\n\nDaftar URL:\n";
          urls.forEach((u, i) => msg += `${i + 1}. <code>${u}</code>\n`);
          await sendTeleMessage(teleConfig.token, chatId, msg);
        }
      } else if (data === "list_domains") {
        await sendTeleMessage(teleConfig.token, chatId, "📌 Untuk kelola custom domain, silakan buka menu dashboard di browser.", getTeleMainMenu());
      }
      return new Response("OK");
    }

    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (teleConfig.chatId !== chatId.toString()) {
        teleConfig.chatId = chatId.toString();
        await saveTeleConfig(env, teleConfig);
      }

      if (text.startsWith("/start") || text.startsWith("/menu")) {
        await sendTeleMessage(teleConfig.token, chatId, "⚡ <b>Selamat datang di Worker Manager Bot!</b>\n\nSilakan pilih menu di bawah ini:", getTeleMainMenu());
      } else if (text.startsWith("/add ")) {
        const rawUrl = text.replace("/add ", "").trim();
        const clean = cleanUrlInput(rawUrl);
        if (clean) {
          let urls = await getUrls(env);
          if (!urls.includes(clean)) {
            urls.push(clean);
            await saveUrls(env, urls);
            await sendTeleMessage(teleConfig.token, chatId, `✅ <b>Berhasil menambahkan URL:</b>\n<code>${clean}</code>`, getTeleMainMenu());
          } else {
            await sendTeleMessage(teleConfig.token, chatId, `⚠️ URL <code>${clean}</code> sudah ada di dalam list!`, getTeleMainMenu());
          }
        }
      } else if (text.startsWith("/del ")) {
        const numStr = text.replace("/del ", "").trim();
        const idx = parseInt(numStr, 10) - 1;
        let urls = await getUrls(env);
        if (!isNaN(idx) && idx >= 0 && idx < urls.length) {
          const removed = urls.splice(idx, 1);
          await saveUrls(env, urls);
          await sendTeleMessage(teleConfig.token, chatId, `✅ <b>Berhasil menghapus URL:</b>\n<code>${removed[0]}</code>`, getTeleMainMenu());
        } else {
          await sendTeleMessage(teleConfig.token, chatId, "❌ Nomor index URL tidak valid!");
        }
      } else if (text.includes("trycloudflare.com") || (text.includes(".") && !text.startsWith("/"))) {
        const clean = cleanUrlInput(text);
        if (clean) {
          let urls = await getUrls(env);
          if (!urls.includes(clean)) {
            urls.push(clean);
            await saveUrls(env, urls);
            await sendTeleMessage(teleConfig.token, chatId, `✅ <b>Berhasil menyimpan URL Tunnel Baru:</b>\n<code>${clean}</code>`, getTeleMainMenu());
          } else {
            await sendTeleMessage(teleConfig.token, chatId, `⚠️ URL <code>${clean}</code> sudah tersimpan sebelumnya.`, getTeleMainMenu());
          }
        }
      } else {
        await sendTeleMessage(teleConfig.token, chatId, "🤖 <b>Menu Utama Worker Manager:</b>", getTeleMainMenu());
      }
    }
  } catch (e) {}

  return new Response("OK");
}

// ---------------- DASHBOARD WEB UI HTML ----------------
function renderHTML(isSetup = false) {
  if (isSetup) {
    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup Password Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: sans-serif; }
    body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #1e293b; padding: 24px; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    h2 { color: #38bdf8; margin-bottom: 15px; }
    p { font-size: 14px; color: #94a3b8; margin-bottom: 20px; }
    input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; margin-bottom: 15px; outline: none; }
    button { width: 100%; padding: 12px; border: none; border-radius: 6px; background: #0284c7; color: white; font-weight: bold; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔐 Setup Password Admin</h2>
    <p>Buat password admin pertama kali.</p>
    <form action="/api/setup" method="POST">
      <input type="password" name="password" placeholder="Masukkan Password Baru" required minlength="4">
      <button type="submit">Simpan Password</button>
    </form>
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Worker Manager</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #0f172a; color: #f8fafc; padding: 20px; display: flex; justify-content: center; min-height: 100vh; }
    .container { width: 100%; max-width: 650px; background: #1e293b; padding: 24px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    h2 { color: #38bdf8; margin: 0; }
    .btn-logout { background: #475569; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .section-title { font-size: 15px; margin: 15px 0 10px 0; color: #38bdf8; font-weight: bold; }
    .form-group { display: flex; gap: 10px; margin-bottom: 15px; }
    input[type="text"], input[type="password"], input[type="email"], select { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; outline: none; margin-bottom: 10px; }
    select { cursor: pointer; }
    button { padding: 12px 18px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.2s; width: 100%; }
    .btn-add { background: #0284c7; color: white; }
    .btn-orange { background: #f59e0b; color: white; margin-top: 5px; }
    .btn-tele { background: #0088cc; color: white; margin-top: 5px; }
    .btn-check { background: #10b981; color: white; margin-bottom: 20px; }
    .btn-del { background: #ef4444; color: white; padding: 6px 10px; font-size: 12px; width: auto; }
    .btn-copy { background: #3b82f6; color: white; padding: 6px 10px; font-size: 12px; width: auto; }
    ul { list-style: none; }
    li { background: #0f172a; padding: 12px 16px; border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; word-break: break-all; border: 1px solid #334155; }
    .status-badge { font-size: 12px; padding: 4px 8px; border-radius: 4px; margin-right: 8px; font-weight: bold; }
    .status-badge.alive { background: #065f46; color: #34d399; }
    .status-badge.dead { background: #7f1d1d; color: #f87171; }
    .status-badge.pending { background: #334155; color: #94a3b8; }
    .url-text { flex: 1; margin-right: 10px; }
    .actions { display: flex; align-items: center; gap: 6px; }
    .box { background: #111827; padding: 18px; border-radius: 8px; border: 1px solid #374151; margin-bottom: 25px; }
    .sub-box { background: #1f2937; padding: 12px; border-radius: 6px; border: 1px solid #374151; margin-bottom: 15px; }
    label { font-size: 13px; color: #9ca3af; margin-bottom: 5px; display: block; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>⚡ Worker Manager</h2>
      <a href="/logout"><button class="btn-logout">Logout</button></a>
    </div>

    <!-- BOT TELEGRAM INTEGRATION -->
    <div class="box">
      <div class="section-title">🤖 Bot Telegram Integration</div>
      <label>Bot Token Telegram:</label>
      <input type="password" id="teleToken" placeholder="123456789:ABCdefGhIJKlmNoPQrsTUVwxyZ" autocomplete="off">
      
      <label>Chat ID Telegram Kamu:</label>
      <input type="text" id="teleChatId" placeholder="123456789" autocomplete="off">

      <div style="display: flex; gap: 10px;">
        <button class="btn-tele" onclick="saveAndSetWebhook()">🔗 Set Webhook & Simpan</button>
        <button class="btn-check" style="margin-top: 5px;" onclick="sendTestTeleMessage()">🚀 Tes Kirim Pesan</button>
      </div>
    </div>

    <!-- PENGATURAN AKUN CLOUDFLARE -->
    <div class="box">
      <div class="section-title">🔑 Setting Cloudflare API Account</div>
      
      <div style="display: flex; gap: 10px; margin-bottom: 10px;">
        <select id="accSelect" onchange="selectAccount()">
          <option value="">-- Pilih Akun Tersimpan --</option>
        </select>
        <button class="btn-del" style="height: 42px;" onclick="deleteCurrentAcc()">Hapus</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px;">
        <input type="email" id="cfEmail" placeholder="Email Cloudflare" autocomplete="off">
        <input type="password" id="cfKey" placeholder="Global API Key atau API Token" autocomplete="off">
        <button class="btn-add" onclick="addCfAccount()">+ Simpan / Tambah Akun CF</button>
      </div>

      <div class="sub-box">
        <label>Mendaftarkan Domain Baru ke CF (Add Zone):</label>
        <input type="text" id="newZoneDomain" placeholder="domainbarugua.com" autocomplete="off">
        <button class="btn-add" onclick="addNewZone()">➕ Daftarkan Domain Utama</button>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <label>Pilih Worker Target:</label>
        <select id="workerSelect">
          <option value="">-- Loading Worker... --</option>
        </select>

        <label>Pilih Domain Utama CF:</label>
        <select id="zoneSelect" onchange="loadAttachedDomains()">
          <option value="">-- Loading Domain... --</option>
        </select>

        <label>Subdomain (Kosongkan jika root):</label>
        <input type="text" id="newSubdomain" name="custom_subdomain_input" placeholder="vmess / sg" autocomplete="off">

        <button class="btn-orange" onclick="attachCustomDomain()">➕ Hubungkan Custom Domain ke Worker</button>
      </div>
    </div>

    <div class="box">
      <div class="section-title">🌐 Custom Domain Terhubung ke Worker</div>
      <ul id="domainList"><li>Pilih domain di dropdown untuk lihat daftar...</li></ul>
    </div>
    
    <div class="section-title">🔗 List Tunnel Server</div>
    <div class="form-group">
      <input type="text" id="newUrl" placeholder="Contoh: test.trycloudflare.com" autocomplete="off">
      <button class="btn-add" style="width: auto;" onclick="addUrl()">Tambah</button>
    </div>

    <button class="btn-check" onclick="checkAllStatus()">🔍 Cek Semua Status URL</button>

    <ul id="urlList"><li>Memuat URL...</li></ul>
  </div>

  <script>
    let savedAccounts = [];

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(() => {
        alert('📋 Berhasil disalin: ' + text);
      }).catch(() => {
        alert('Gagal menyalin teks');
      });
    }

    async function initApp() {
      try {
        loadTeleConfig();
        const res = await fetch('/api/cf-accounts');
        if (res.status === 401) return window.location.href = '/';
        savedAccounts = await res.json();

        if (Array.isArray(savedAccounts) && savedAccounts.length > 0) {
          renderAccountsDropdown();
          const lastIndex = localStorage.getItem('selected_cf_acc');
          if (lastIndex !== null && savedAccounts[lastIndex]) {
            document.getElementById('accSelect').value = lastIndex;
            selectAccount();
          } else {
            document.getElementById('accSelect').value = "0";
            selectAccount();
          }
        }
        loadUrls();
      } catch (e) {}
    }

    async function loadTeleConfig() {
      try {
        const res = await fetch('/api/tele-config');
        const data = await res.json();
        if (data.token) document.getElementById('teleToken').value = data.token;
        if (data.chatId) document.getElementById('teleChatId').value = data.chatId;
      } catch (e) {}
    }

    async function saveAndSetWebhook() {
      const token = document.getElementById('teleToken').value.trim();
      const chatId = document.getElementById('teleChatId').value.trim();

      if (!token) return alert('Token Bot Telegram wajib diisi!');

      const res = await fetch('/api/tele-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, chatId })
      });

      const data = await res.json();
      if (data.success) {
        alert('✅ Webhook & Bot Telegram Berhasil Disimpan!');
      } else {
        alert('❌ Gagal: ' + (data.error || 'Cek Token Bot Telegram'));
      }
    }

    async function sendTestTeleMessage() {
      const token = document.getElementById('teleToken').value.trim();
      const chatId = document.getElementById('teleChatId').value.trim();

      if (!token || !chatId) return alert('Isi Token Bot & Chat ID dulu!');

      const res = await fetch('/api/tele-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, chatId })
      });

      const data = await res.json();
      if (data.success) {
        alert('🚀 Pesan Tes Berhasil Terkirim!');
      } else {
        alert('❌ Gagal Kirim: ' + (data.error || 'Cek Chat ID / Token'));
      }
    }

    function renderAccountsDropdown() {
      const select = document.getElementById('accSelect');
      select.innerHTML = '<option value="">-- Pilih Akun Tersimpan --</option>';
      savedAccounts.forEach((acc, idx) => {
        select.innerHTML += '<option value="' + idx + '">' + (acc.email || ('Token (' + acc.apiKey.substring(0,6) + '...)')) + '</option>';
      });
    }

    function selectAccount() {
      const idx = document.getElementById('accSelect').value;
      if (idx !== "" && savedAccounts[idx]) {
        localStorage.setItem('selected_cf_acc', idx);
        const acc = savedAccounts[idx];
        document.getElementById('cfEmail').value = acc.email || '';
        document.getElementById('cfKey').value = acc.apiKey || '';
        fetchWorkersAndZones(acc.email, acc.apiKey);
      } else {
        localStorage.removeItem('selected_cf_acc');
      }
    }

    async function addCfAccount() {
      const email = document.getElementById('cfEmail').value.trim();
      const apiKey = document.getElementById('cfKey').value.trim();
      if (!apiKey) return alert('API Key / Token wajib diisi!');

      await fetch('/api/cf-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, apiKey })
      });
      alert('Akun Cloudflare tersimpan!');
      initApp();
    }

    async function deleteCurrentAcc() {
      const idx = document.getElementById('accSelect').value;
      if (idx === "") return alert('Pilih akun dulu!');
      if (!confirm('Hapus akun ini dari KV?')) return;

      await fetch('/api/cf-accounts?index=' + idx, { method: 'DELETE' });
      localStorage.removeItem('selected_cf_acc');
      document.getElementById('cfEmail').value = '';
      document.getElementById('cfKey').value = '';
      initApp();
    }

    async function fetchWorkersAndZones(email, apiKey) {
      const wSelect = document.getElementById('workerSelect');
      const zSelect = document.getElementById('zoneSelect');

      wSelect.innerHTML = '<option>Loading Workers...</option>';
      zSelect.innerHTML = '<option>Loading Zones...</option>';

      try {
        const res = await fetch('/api/cf-init-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, apiKey })
        });
        const data = await res.json();

        if (data.success) {
          wSelect.innerHTML = '';
          if (data.workers && data.workers.length > 0) {
            data.workers.forEach(w => {
              wSelect.innerHTML += '<option value="' + w.id + '">' + w.id + '</option>';
            });
          } else {
            const currentWorkerHost = window.location.hostname.split('.')[0];
            wSelect.innerHTML = '<option value="' + currentWorkerHost + '">' + currentWorkerHost + '</option>';
          }

          zSelect.innerHTML = '';
          if (data.zones && data.zones.length > 0) {
            data.zones.forEach(z => {
              zSelect.innerHTML += '<option value="' + z.id + '" data-name="' + z.name + '">' + z.name + '</option>';
            });
            loadAttachedDomains();
          } else {
            zSelect.innerHTML = '<option value="">Zone/Domain tidak ditemukan</option>';
          }
        } else {
          wSelect.innerHTML = '<option value="">Cek API Key / Hak Akses</option>';
          zSelect.innerHTML = '<option value="">Cek API Key / Hak Akses</option>';
        }
      } catch(e) {
        wSelect.innerHTML = '<option value="">Gagal konek API</option>';
        zSelect.innerHTML = '<option value="">Gagal konek API</option>';
      }
    }

    async function addNewZone() {
      const email = document.getElementById('cfEmail').value.trim();
      const apiKey = document.getElementById('cfKey').value.trim();
      const domain = document.getElementById('newZoneDomain').value.trim();

      if (!domain) return alert('Masukkan domain utama!');

      const res = await fetch('/api/add-zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, apiKey, domain })
      });

      const data = await res.json();
      if (data.success) {
        let nsInfo = "✅ Domain " + domain + " berhasil didaftarkan!\\n\\n📌 Silakan ganti Nameserver ke:\\n";
        if (data.nameServers && data.nameServers.length > 0) {
          data.nameServers.forEach((ns, i) => {
            nsInfo += "NS " + (i+1) + ": " + ns + "\\n";
          });
        }
        alert(nsInfo);
        document.getElementById('newZoneDomain').value = '';
        fetchWorkersAndZones(email, apiKey);
      } else {
        alert('❌ Gagal: ' + (data.error || 'Cek API Key'));
      }
    }

    async function attachCustomDomain() {
      const email = document.getElementById('cfEmail').value.trim();
      const apiKey = document.getElementById('cfKey').value.trim();
      const workerName = document.getElementById('workerSelect').value;
      
      const zSelect = document.getElementById('zoneSelect');
      const zoneId = zSelect.value;
      const zoneOption = zSelect.options[zSelect.selectedIndex];
      const zoneName = zoneOption ? zoneOption.getAttribute('data-name') : '';

      let sub = document.getElementById('newSubdomain').value.trim().toLowerCase();
      if (!zoneId) return alert('Pilih Domain Utama!');
      if (!workerName) return alert('Pilih Worker Target!');

      let fullHostname = zoneName;
      if (sub) {
        sub = sub.replace(/^https?:\\/\\//i, '').replace(/\\/+$/, '').replace(/\\.+$/, '');
        if (sub.endsWith('.' + zoneName) || sub === zoneName) {
          fullHostname = sub;
        } else {
          fullHostname = sub + '.' + zoneName;
        }
      }

      const res = await fetch('/api/attach-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, apiKey, zoneId, workerName, hostname: fullHostname })
      });

      const data = await res.json();
      if (data.success) {
        alert('✅ Custom Domain ' + fullHostname + ' berhasil dihubungkan!');
        document.getElementById('newSubdomain').value = '';
        loadAttachedDomains();
      } else {
        alert('❌ Gagal: ' + (data.error || 'Terjadi kesalahan'));
      }
    }

    async function loadAttachedDomains() {
      const email = document.getElementById('cfEmail').value.trim();
      const apiKey = document.getElementById('cfKey').value.trim();
      const zSelect = document.getElementById('zoneSelect');
      const zoneId = zSelect.value;
      const listEl = document.getElementById('domainList');

      if (!zoneId) return;

      listEl.innerHTML = '<li>Memuat Custom Domain...</li>';

      const res = await fetch('/api/list-attached-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, apiKey, zoneId })
      });

      const data = await res.json();
      listEl.innerHTML = '';

      if (data.success && Array.isArray(data.domains) && data.domains.length > 0) {
        data.domains.forEach(d => {
          const nameShow = (typeof d === 'object') ? (d.hostname || d.domain || JSON.stringify(d)) : d;
          const serviceShow = (typeof d === 'object' && d.service) ? d.service : 'worker';
          listEl.innerHTML += '<li>' +
            '<div class="url-text">' +
              '<span class="status-badge alive">' + nameShow + '</span>' +
              '<span style="font-size:12px; color:#94a3b8;">Target: ' + serviceShow + '</span>' +
            '</div>' +
            '<div class="actions">' +
              '<button class="btn-copy" onclick="copyToClipboard(\\'' + nameShow + '\\')">Copy</button>' +
              '<button class="btn-del" onclick="detachDomain(\\'' + (d.id || nameShow) + '\\')">Hapus</button>' +
            '</div>' +
          '</li>';
        });
      } else {
        listEl.innerHTML = '<li style="justify-content:center; color:#94a3b8;">Belum ada Custom Domain terhubung</li>';
      }
    }

    async function detachDomain(domainId) {
      if (!confirm('Yakin mau hapus Custom Domain ini?')) return;
      const email = document.getElementById('cfEmail').value.trim();
      const apiKey = document.getElementById('cfKey').value.trim();
      const zoneId = document.getElementById('zoneSelect').value;

      const res = await fetch('/api/detach-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, apiKey, zoneId, domainId })
      });

      const data = await res.json();
      if (data.success) {
        loadAttachedDomains();
      } else {
        alert('❌ Gagal menghapus!');
      }
    }

    async function loadUrls() {
      const listEl = document.getElementById('urlList');
      try {
        const res = await fetch('/api/urls');
        if (res.status === 401) return window.location.href = '/';
        const data = await res.json();
        listEl.innerHTML = '';

        if (!Array.isArray(data) || data.length === 0) {
          listEl.innerHTML = '<li style="justify-content:center; color:#94a3b8;">Belum ada URL tersimpan</li>';
          return;
        }

        data.forEach((url, index) => {
          listEl.innerHTML += '<li>' +
            '<div class="url-text">' +
              '<span id="badge-' + index + '" class="status-badge pending">READY</span>' +
              '<span>' + url + '</span>' +
            '</div>' +
            '<div class="actions">' +
              '<button class="btn-copy" onclick="copyToClipboard(\\'' + url + '\\')">Copy</button>' +
              '<button class="btn-del" onclick="deleteUrl(' + index + ')">Hapus</button>' +
            '</div>' +
          '</li>';
        });
      } catch (e) {
        listEl.innerHTML = '<li style="justify-content:center; color:#ef4444;">Gagal memuat list URL</li>';
      }
    }

    async function addUrl() {
      const input = document.getElementById('newUrl');
      let url = input.value.trim();
      if (!url) return alert('URL tidak boleh kosong!');
      
      await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      input.value = '';
      loadUrls();
    }

    async function deleteUrl(index) {
      if (!confirm('Yakin mau hapus URL ini?')) return;
      await fetch('/api/urls?index=' + index, { method: 'DELETE' });
      loadUrls();
    }

    async function checkAllStatus() {
      const res = await fetch('/api/urls');
      const data = await res.json();
      
      if (Array.isArray(data)) {
        data.forEach(async (url, index) => {
          const badge = document.getElementById('badge-' + index);
          if (badge) {
            badge.className = 'status-badge pending';
            badge.innerText = 'CHECKING...';
          }
          
          const checkRes = await fetch('/api/check?url=' + encodeURIComponent(url));
          const statusData = await checkRes.json();

          if (badge) {
            if (statusData.isAlive) {
              badge.className = 'status-badge alive';
              badge.innerText = '101 (' + statusData.path + ')';
            } else {
              badge.className = 'status-badge dead';
              badge.innerText = 'ERR: ' + statusData.status;
            }
          }
        });
      }
    }

    initApp();
  </script>
</body>
</html>`;
}

function renderLoginHTML(error = '') {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Admin Worker</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: sans-serif; }
    body { background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
    .card { background: #1e293b; padding: 24px; border-radius: 12px; width: 100%; max-width: 380px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    h2 { color: #38bdf8; margin-bottom: 20px; }
    input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #334155; background: #0f172a; color: #fff; margin-bottom: 15px; outline: none; }
    button { width: 100%; padding: 12px; border: none; border-radius: 6px; background: #10b981; color: white; font-weight: bold; cursor: pointer; }
    .error { color: #ef4444; font-size: 13px; margin-bottom: 15px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔑 Login Admin</h2>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form action="/login" method="POST">
      <input type="password" name="password" placeholder="Password Admin" required>
      <button type="submit">Masuk Dashboard</button>
    </form>
  </div>
</body>
</html>`;
}

// ---------------- API HANDLER UTAMA ----------------
async function handleApi(request, env) {
  if (!(await isAuthenticated(request, env))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/urls") {
    if (request.method === "GET") return new Response(JSON.stringify(await getUrls(env)), { headers: { "Content-Type": "application/json" } });
    if (request.method === "POST") {
      const body = await request.json();
      let urls = await getUrls(env);
      let clean = cleanUrlInput(body.url);
      if (clean && !urls.includes(clean)) { urls.push(clean); await saveUrls(env, urls); }
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (request.method === "DELETE") {
      const index = parseInt(url.searchParams.get("index"), 10);
      let urls = await getUrls(env);
      if (!isNaN(index) && index >= 0 && index < urls.length) { urls.splice(index, 1); await saveUrls(env, urls); }
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }
  }

  if (path === "/api/tele-config" && request.method === "GET") {
    return new Response(JSON.stringify(await getTeleConfig(env)), { headers: { "Content-Type": "application/json" } });
  }

  if (path === "/api/tele-setup" && request.method === "POST") {
    const body = await request.json();
    await saveTeleConfig(env, { token: body.token, chatId: body.chatId });

    const webhookUrl = `https://${url.hostname}/telegram-webhook`;
    try {
      const teleRes = await fetch(`https://api.telegram.org/bot${body.token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const teleData = await teleRes.json();
      return new Response(JSON.stringify({ success: teleData.ok, error: teleData.description }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  if (path === "/api/tele-test" && request.method === "POST") {
    const body = await request.json();
    await saveTeleConfig(env, { token: body.token, chatId: body.chatId });

    try {
      const msg = `⚡ <b>Pages Manager Test</b>\n\nBot Telegram berhasil terhubung ke Pages: <code>${url.hostname}</code>`;
      const resSend = await sendTeleMessage(body.token, body.chatId, msg, getTeleMainMenu());
      
      if (resSend && resSend.ok) {
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
      } else {
        return new Response(JSON.stringify({ success: false, error: resSend.description || "Gagal mengirim pesan" }), { headers: { "Content-Type": "application/json" } });
      }
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  if (path === "/api/cf-accounts") {
    if (request.method === "GET") return new Response(JSON.stringify(await getCfAccounts(env)), { headers: { "Content-Type": "application/json" } });
    if (request.method === "POST") {
      const body = await request.json();
      let accounts = await getCfAccounts(env);
      const idx = accounts.findIndex(a => a.email === body.email && a.apiKey === body.apiKey);
      if (idx === -1) accounts.push(body); else accounts[idx] = body;
      await saveCfAccounts(env, accounts);
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (request.method === "DELETE") {
      const index = parseInt(url.searchParams.get("index"), 10);
      let accounts = await getCfAccounts(env);
      if (!isNaN(index) && index >= 0 && index < accounts.length) { accounts.splice(index, 1); await saveCfAccounts(env, accounts); }
      return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }
  }

  if (path === "/api/cf-init-data" && request.method === "POST") {
    const body = await request.json();
    const headers = {};
    if (body.email && body.email.includes('@')) {
      headers["X-Auth-Email"] = body.email;
      headers["X-Auth-Key"] = body.apiKey;
    } else {
      headers["Authorization"] = "Bearer " + body.apiKey;
    }

    try {
      const zRes = await fetch("https://api.cloudflare.com/client/v4/zones?per_page=50", { headers });
      const zData = await zRes.json();
      const zones = zData.success ? zData.result.map(z => ({ id: z.id, name: z.name })) : [];

      let workers = [];
      if (zData.success && zData.result.length > 0) {
        const accId = zData.result[0].account.id;
        try {
          const wRes = await fetch("https://api.cloudflare.com/client/v4/accounts/" + accId + "/workers/scripts", { headers });
          const wData = await wRes.json();
          if (wData.success && Array.isArray(wData.result)) {
            const sorted = wData.result.sort((a, b) => new Date(b.modified_on) - new Date(a.modified_on));
            workers = sorted.map(w => ({ id: w.id, modified: w.modified_on }));
          }
        } catch(e) {}
      }

      return new Response(JSON.stringify({ success: true, zones, workers }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  if (path === "/api/add-zone" && request.method === "POST") {
    const body = await request.json();
    const headers = { "Content-Type": "application/json" };
    if (body.email && body.email.includes('@')) {
      headers["X-Auth-Email"] = body.email;
      headers["X-Auth-Key"] = body.apiKey;
    } else {
      headers["Authorization"] = "Bearer " + body.apiKey;
    }

    try {
      const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
      const accData = await accRes.json();
      if (!accData.success || accData.result.length === 0) throw new Error("Account ID tidak ditemukan");

      const accountId = accData.result[0].id;

      const res = await fetch("https://api.cloudflare.com/client/v4/zones", {
        method: "POST",
        headers,
        body: JSON.stringify({
          account: { id: accountId },
          name: body.domain,
          type: "full"
        })
      });

      const data = await res.json();
      if (data.success) {
        const ns = data.result ? data.result.name_servers : [];
        return new Response(JSON.stringify({ success: true, nameServers: ns }), { headers: { "Content-Type": "application/json" } });
      } else {
        const msg = data.errors && data.errors.length > 0 ? data.errors[0].message : "Gagal daftarkan zone";
        return new Response(JSON.stringify({ success: false, error: msg }), { status: 400 });
      }
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  if (path === "/api/attach-domain" && request.method === "POST") {
    const body = await request.json();
    const headers = { "Content-Type": "application/json" };
    if (body.email && body.email.includes('@')) {
      headers["X-Auth-Email"] = body.email;
      headers["X-Auth-Key"] = body.apiKey;
    } else {
      headers["Authorization"] = "Bearer " + body.apiKey;
    }

    try {
      const res = await fetch("https://api.cloudflare.com/client/v4/zones/" + body.zoneId + "/workers/domains", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          environment: "production",
          hostname: body.hostname,
          service: body.workerName
        })
      });

      const data = await res.json();
      if (data.success) {
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
      } else {
        const msg = data.errors && data.errors.length > 0 ? data.errors[0].message : "Gagal attach domain ke worker";
        return new Response(JSON.stringify({ success: false, error: msg }), { status: 400 });
      }
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  if (path === "/api/list-attached-domains" && request.method === "POST") {
    const body = await request.json();
    const headers = {};
    if (body.email && body.email.includes('@')) {
      headers["X-Auth-Email"] = body.email;
      headers["X-Auth-Key"] = body.apiKey;
    } else {
      headers["Authorization"] = "Bearer " + body.apiKey;
    }

    try {
      const res = await fetch("https://api.cloudflare.com/client/v4/zones/" + body.zoneId + "/workers/domains", { headers });
      const data = await res.json();
      if (data.success) {
        const domains = data.result.map(d => ({
          id: d.id,
          hostname: d.hostname,
          service: d.service
        }));
        return new Response(JSON.stringify({ success: true, domains }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: false }), { status: 400 });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  if (path === "/api/detach-domain" && request.method === "POST") {
    const body = await request.json();
    const headers = {};
    if (body.email && body.email.includes('@')) {
      headers["X-Auth-Email"] = body.email;
      headers["X-Auth-Key"] = body.apiKey;
    } else {
      headers["Authorization"] = "Bearer " + body.apiKey;
    }

    try {
      const res = await fetch("https://api.cloudflare.com/client/v4/zones/" + body.zoneId + "/workers/domains/" + body.domainId, {
        method: "DELETE",
        headers
      });

      const data = await res.json();
      return new Response(JSON.stringify({ success: data.success }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
    }
  }

  if (path === "/api/check") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) return new Response("URL required", { status: 400 });
    const result = await checkUrlStatus(targetUrl);
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  }

  return new Response("Not Found", { status: 404 });
}

// ---------------- HANDLER PROXY UTAMA ----------------
async function handleProxy(request, env) {
  const WORKER_URLS = await getUrls(env);
  if (WORKER_URLS.length === 0) return new Response("List kosong", { status: 503 });

  const shuffled = [...WORKER_URLS].sort(() => Math.random() - 0.5);
  const reqClone = request.clone();

  for (const targetHost of shuffled) {
    try {
      const targetUrl = new URL(request.url);
      const cleanHostStr = cleanUrlInput(targetHost);
      if (!cleanHostStr) continue;

      const parts = cleanHostStr.split('/');
      const cleanHost = parts[0]; 
      const basePath = parts.slice(1).join('/'); 

      targetUrl.hostname = cleanHost;
      targetUrl.protocol = 'https:';
      if (basePath) targetUrl.pathname = '/' + basePath + (targetUrl.pathname === '/' ? '' : targetUrl.pathname);

      const loopReq = reqClone.clone();
      const response = await fetch(new Request(targetUrl, {
        method: loopReq.method,
        headers: loopReq.headers,
        body: loopReq.body,
        redirect: 'manual' 
      }));

      if (response.status !== 429 && response.status !== 530) {
        return response;
      }
    } catch (e) {
      continue;
    }
  }
  return new Response("Semua tepar", { status: 503 });
}

// ---------------- PAGES FUNCTIONS ENTRY POINT ----------------
export async function onRequest(context) {
  const { request, env } = context;

  try {
    const url = new URL(request.url);

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      return await handleTelegramWebhook(request, env);
    }

    if (url.pathname === "/logout") {
      return new Response("Logged out", {
        status: 302,
        headers: { "Location": "/", "Set-Cookie": "session_token=; Path=/; HttpOnly; Secure; Max-Age=0" }
      });
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const formData = await request.formData();
      const password = formData.get("password");
      const savedPassword = await getAdminPassword(env);

      if (savedPassword && password === savedPassword) {
        const token = crypto.randomUUID();
        await setSessionToken(env, token);
        return new Response("OK", {
          status: 302,
          headers: { "Location": "/", "Set-Cookie": `session_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800` }
        });
      }
      return new Response(renderLoginHTML("Password Salah!"), { headers: { "Content-Type": "text/html" } });
    }

    if (url.pathname === "/api/setup" && request.method === "POST") {
      const savedPassword = await getAdminPassword(env);
      if (!savedPassword) {
        const formData = await request.formData();
        const newPassword = formData.get("password");
        if (newPassword && newPassword.trim().length >= 4) {
          await setAdminPassword(env, newPassword.trim());
        }
      }
      return new Response("Setup complete", { status: 302, headers: { "Location": "/" } });
    }

    if (url.pathname.startsWith("/api/")) {
      return await handleApi(request, env);
    }

    const upgradeHeader = request.headers.get("Upgrade");
    const acceptHeader = request.headers.get("Accept") || "";

    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return await handleProxy(request, env);
    }

    if (
      url.pathname === "/" || 
      url.pathname === "/ui" || 
      url.pathname === "/admin" || 
      acceptHeader.includes("text/html")
    ) {
      const savedPassword = await getAdminPassword(env);
      if (!savedPassword) return new Response(renderHTML(true), { headers: { "Content-Type": "text/html" } });
      if (await isAuthenticated(request, env)) return new Response(renderHTML(false), { headers: { "Content-Type": "text/html" } });
      return new Response(renderLoginHTML(), { headers: { "Content-Type": "text/html" } });
    }

    return await handleProxy(request, env);
  } catch (err) {
    return new Response(`Pages Internal Error: ${err.message}`, { status: 500 });
  }
}
