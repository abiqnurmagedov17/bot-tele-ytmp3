const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const { Redis } = require('@upstash/redis');

// Inisialisasi Redis
let redis;
try {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('[INFO] Redis initialized successfully');
} catch (err) {
  console.error('[ERROR] Failed to initialize Redis:', err.message);
  redis = null;
}

const CONFIG = {
  TIMEOUT: 30000,
  MAX_POLLS: 50,
  POLL_INTERVAL: 2000,
  MAX_RETRIES: 3,
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  ],
  RATE_LIMIT_DELAY: 500,
  STATE_TTL: 2 * 60 // 2 menit dalam detik
};

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`)
};

function getUA() {
  return CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];
}

// Fungsi untuk menyimpan state user ke Redis (tanpa JSON.stringify manual)
async function setUserState(userId, state) {
  if (!redis) return;
  try {
    const key = `user:state:${userId}`;
    // Hapus JSON.stringify, biarkan library yang menangani objeknya
    await redis.set(key, state, { ex: CONFIG.STATE_TTL });
    log.debug(`State saved for user ${userId}`);
  } catch (err) {
    log.error(`Failed to save state for user ${userId}: ${err.message}`);
  }
}

// Fungsi untuk mengambil state user dari Redis
async function getUserState(userId) {
  if (!redis) return null;
  try {
    const key = `user:state:${userId}`;
    const data = await redis.get(key);
    if (!data) return null;
    
    // Jika data sudah berupa objek (otomatis dari library), langsung kembalikan
    if (typeof data === 'object') return data;
    
    // Jika data berupa string, baru di-parse
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (e) {
        log.error(`Failed to parse state data: ${e.message}`);
        return null;
      }
    }
    
    return data;
  } catch (err) {
    log.error(`Failed to get state for user ${userId}: ${err.message}`);
    return null;
  }
}

// Fungsi untuk menghapus state user dari Redis
async function deleteUserState(userId) {
  if (!redis) return;
  try {
    const key = `user:state:${userId}`;
    await redis.del(key);
    log.debug(`State deleted for user ${userId}`);
  } catch (err) {
    log.error(`Failed to delete state for user ${userId}: ${err.message}`);
  }
}

function sanitizeFilename(name) {
  const clean = name.replace(/[^\w\s.-]/gi, '').trim().substring(0, 100);
  return clean || 'audio';
}

async function getVideoTitle(url) {
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) return `video_${Date.now()}`;
    const videoId = match[1];
    // Perbaiki URL dengan menggunakan template literal yang benar ($ bukan 0)
    const response = await axios.get(`https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`, { timeout: 5000 });
    return response.data?.title || `video_${Date.now()}`;
  } catch (err) {
    log.warn(`Failed to get video title: ${err.message}`);
    return `video_${Date.now()}`;
  }
}

function delay(ms, withJitter = false) {
  const actualDelay = withJitter ? ms + Math.random() * ms : ms;
  return new Promise(resolve => setTimeout(resolve, actualDelay));
}

async function ytmp(url, format = 'mp3', retryCount = 0) {
  log.debug(`Processing URL: ${url} | Format: ${format} | Attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES}`);
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];
    const jar = new tough.CookieJar();
    const currentUA = getUA();
    const headers = {
      'User-Agent': currentUA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Referer': 'https://id.ytmp3.mobi/v1/',
      'Origin': 'https://id.ytmp3.mobi/v1',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'sec-ch-ua': '"Google Chrome";v="137", "Chromium";v="137", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Android"'
    };
    const client = wrapper(axios.create({ jar, timeout: CONFIG.TIMEOUT, maxRedirects: 5, headers }));
    log.debug('[Step 1] Initializing session...');
    const initUrl = 'https://a.ymcdn.org/api/v1/init';
    const init = await client.get(initUrl, { params: { p: 'y', '23': '1llum1n471', _: Date.now() } });
    if (init.data.error) throw new Error(`[Init] ${init.data.error}`);
    if (!init.data.convertURL) throw new Error('[Init] Gagal inisialisasi - no convertURL');
    log.debug('[Step 1] Session initialized successfully');
    await delay(300, true);
    log.debug(`[Step 2] Sending convert request (${format})...`);
    const convert = await client.get(init.data.convertURL, { params: { v: videoId, f: format, _: Date.now() } });
    log.debug(`[Step 2] Convert response: ${JSON.stringify(convert.data).substring(0, 200)}...`);
    if (convert.data.error && convert.data.error !== 'in_progress') throw new Error(`[Convert] ${convert.data.error}`);
    if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
      log.debug('[Step 2] Got direct download URL! Giving it to user untouched.');
      const title = await getVideoTitle(url);
      return { downloadUrl: convert.data.downloadURL, title, format };
    }
    if (convert.data.progressURL) {
      log.debug('[Step 3] Starting polling...');
      let polls = 0;
      while (polls < CONFIG.MAX_POLLS) {
        polls++;
        try {
          const prog = await client.get(convert.data.progressURL, { headers: { 'Referer': 'https://id.ytmp3.mobi/v1/', 'Origin': 'https://id.ytmp3.mobi/v1' } });
          const progressData = prog.data;
          if (progressData.downloadURL && progressData.downloadURL !== '#') {
            log.debug('[Step 3] Got download URL from polling! Giving it to user untouched.');
            const title = await getVideoTitle(url);
            return { downloadUrl: progressData.downloadURL, title, format };
          }
          if (progressData.error && progressData.error !== 'in_progress') throw new Error(`[Polling] ${progressData.error}`);
        } catch (err) {
          log.debug(`[Step 3] Poll error: ${err.message}`);
          if (err.response?.status === 404) {
            if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
              const title = await getVideoTitle(url);
              return { downloadUrl: convert.data.downloadURL, title, format };
            }
          }
          await delay(500, true);
        }
        await delay(CONFIG.POLL_INTERVAL, true);
      }
      throw new Error('[Polling] Timeout - konversi terlalu lama');
    }
    throw new Error('[Convert] Gagal mendapatkan link download');
  } catch (err) {
    log.error(`[Conversion] Error: ${err.message}`);
    const shouldRetry = retryCount < CONFIG.MAX_RETRIES - 1 && (err.message.includes('Timeout') || err.message.includes('ECONNREFUSED') || err.message.includes('socket hang up') || err.message.includes('rate') || err.message.includes('limit'));
    if (shouldRetry) {
      const backoffDelay = 2000 + Math.random() * 3000;
      log.info(`[Retry] Attempt ${retryCount + 2}/${CONFIG.MAX_RETRIES} after ${Math.round(backoffDelay)}ms`);
      await delay(backoffDelay);
      return ytmp(url, format, retryCount + 1);
    }
    throw err;
  }
}

async function checkApiStatus() {
  const apis = [
    { name: 'YTMP3 API', url: 'https://a.ymcdn.org/api/v1/init', params: { p: 'y', '23': '1llum1n471', _: Date.now() } },
    { name: 'NoEmbed API', url: 'https://noembed.com/embed', params: { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' } }
  ];
  const results = [];
  for (const api of apis) {
    try {
      const start = Date.now();
      const res = await axios.get(api.url, { params: api.params, timeout: 8000, headers: { 'User-Agent': getUA() } });
      results.push({ name: api.name, status: 'online', responseTime: `${Date.now() - start}ms`, statusCode: res.status });
    } catch (err) {
      results.push({ name: api.name, status: 'offline', error: err.message, statusCode: err.response?.status || 'N/A' });
    }
  }
  return results;
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware untuk rate limit dengan Redis
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const key = `ratelimit:${userId}`;
  const limit = 10; // Maksimal 10 request
  const window = 60; // Dalam 60 detik

  if (redis) {
    try {
      const currentUsage = await redis.incr(key);
      if (currentUsage === 1) {
        await redis.expire(key, window);
      }
      if (currentUsage > limit) {
        const ttl = await redis.ttl(key);
        return ctx.reply(`🚦 *Rate Limit Tercapai!*\nMohon tunggu ${ttl} detik lagi.`, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      log.error('Redis Rate Limit Error:', err);
    }
  }

  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log.info(`${ctx.from?.first_name || 'User'}: ${ctx.message?.text || ctx.callbackQuery?.data || 'Interaction'} (${ms}ms)`);
  await delay(CONFIG.RATE_LIMIT_DELAY);
});

bot.start(async (ctx) => {
  const welcomeMessage = `🎬 *YouTube Downloader Bot* 🎬\n\nHalo ${ctx.from.first_name || 'Kak'}!\n\nKirimkan link YouTube, lalu pilih format:\n• *MP3* - Audio only\n• *MP4* - Video with audio\n\n*Cara penggunaan:*\n1. Kirim link YouTube\n2. Pilih format MP3 atau MP4\n3. Tunggu proses konversi\n4. Dapatkan link download\n\n━━━━━━━━━━━━━━━━━━━━\n👤 *Owner Bot:* Abiq Nurmagedov\n📦 *GitHub:* github.com/abiqnurmagedov17\n\n⚠️ *Note:*\nBot ini menggunakan API pihak ketiga hasil scraping dan bisa mati sewaktu-waktu.\nGunakan dengan bijak!\n━━━━━━━━━━━━━━━━━━━━\n\nKirim link YouTube sekarang! 🚀`;
  ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

bot.help((ctx) => {
  ctx.reply('📖 *Bantuan*\n\nKirimkan link YouTube, lalu pilih format.\n\n*Format:*\n• MP3 - Audio (musik, podcast)\n• MP4 - Video (tanpa watermark)\n\n*Contoh link:*\n• https://youtube.com/watch?v=xxxxx\n• https://youtu.be/xxxxx\n• https://youtube.com/shorts/xxxxx\n\n*Perintah:*\n/start - Mulai bot\n/help - Bantuan\n/status - Cek status proses\n/ping - Cek status API\n/health - Cek status bot\n/limit - Cek kuota download\n/retry - Generate link baru', { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  const state = await getUserState(userId);
  if (state) ctx.reply(`⏳ Sedang memproses: ${state.url} (${state.format || 'mp3'})`);
  else ctx.reply('✅ Tidak ada proses yang sedang berjalan');
});

bot.command('ping', async (ctx) => {
  const msg = await ctx.reply('🏓 *Mengecek API...*', { parse_mode: 'Markdown' });
  try {
    const apis = await checkApiStatus();
    let text = '🏓 *Status API*\n\n';
    apis.forEach(api => {
      if (api.status === 'online') text += `✅ *${api.name}*\n   🟢 ONLINE | ${api.responseTime} | HTTP ${api.statusCode}\n\n`;
      else text += `❌ *${api.name}*\n   🔴 OFFLINE | ${api.error}\n\n`;
    });
    text += apis.every(a => a.status === 'online') ? '✨ Semua API OK!' : '⚠️ Ada API yang bermasalah';
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, text, { parse_mode: 'Markdown' });
  } catch (err) {
    log.error(`Ping error: ${err.message}`);
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, null, '❌ Gagal cek API', { parse_mode: 'Markdown' });
  }
});

bot.command('health', async (ctx) => {
  const mem = process.memoryUsage();
  const health = { 
    status: 'ok', 
    uptime: `${Math.floor(process.uptime())}s`, 
    memory: { 
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`, 
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB` 
    },
    redisStatus: redis ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString() 
  };
  ctx.reply(`📊 *Health Check*\n\`\`\`json\n${JSON.stringify(health, null, 2)}\`\`\``, { parse_mode: 'Markdown' });
});

bot.command('limit', async (ctx) => {
  const userId = ctx.from.id;
  const userName = ctx.from.username || ctx.from.first_name || 'User';
  const key = `ratelimit:${userId}`;
  
  if (!redis) {
    return ctx.reply('⚠️ *Rate limiting tidak tersedia* (Redis tidak terhubung)', { parse_mode: 'Markdown' });
  }
  
  try {
    const currentUsage = await redis.get(key);
    const usage = currentUsage ? parseInt(currentUsage) : 0;
    const ttl = await redis.ttl(key);
    const remaining = Math.max(0, 10 - usage);
    
    let text = `📊 *Limit Usage*\n\n👤 *User:* @${userName}\n🔄 *Used:* ${usage}/10 requests\n✅ *Remaining:* ${remaining}\n⏱️ *Reset in:* ${ttl > 0 ? ttl : 0}s\n\n`;
    text += remaining > 0 ? `✨ *Status:* ACTIVE` : `🚦 *Status:* RATE LIMITED\n⏳ Tunggu ${ttl}s`;
    ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (err) {
    log.error(`Limit error: ${err.message}`);
    ctx.reply('❌ Gagal mengambil data limit', { parse_mode: 'Markdown' });
  }
});

bot.command('retry', async (ctx) => {
  const userId = ctx.from.id;
  const state = await getUserState(userId);
  if (!state || !state.url) return ctx.reply('❌ Tidak ada proses sebelumnya. Kirim link YouTube dulu.');
  await setUserState(userId, { url: state.url, step: 'choose_format', startTime: Date.now() });
  ctx.reply(`🔄 *Link di-refresh!* Pilih format:\n\n\`${state.url}\``, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🎵 MP3', 'format_mp3'), Markup.button.callback('🎬 MP4', 'format_mp4')], [Markup.button.callback('❌ Batal', 'format_cancel')]]) });
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text.trim();
  const existingState = await getUserState(userId);
  if (existingState) return ctx.reply('⏳ Mohon tunggu, proses sebelumnya masih berjalan...');
  
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = messageText.match(youtubeRegex);
  if (!match) return ctx.reply('❌ Mohon kirim link YouTube yang valid.\n\nContoh: https://youtube.com/watch?v=xxxxx');
  
  const url = messageText;
  await setUserState(userId, { url, step: 'choose_format', startTime: Date.now() });
  await ctx.reply('🎬 *Pilih format download:*', Markup.inlineKeyboard([[Markup.button.callback('🎵 MP3 (Audio)', 'format_mp3'), Markup.button.callback('🎬 MP4 (Video)', 'format_mp4')], [Markup.button.callback('❌ Batal', 'format_cancel')]]));
});

// Perbaiki handler action dengan menambahkan await dan answerCbQuery
bot.action('format_mp3', async (ctx) => { 
  await ctx.answerCbQuery('🎵 Mengkonversi ke MP3...');
  await processFormat(ctx, 'mp3'); 
});

bot.action('format_mp4', async (ctx) => { 
  await ctx.answerCbQuery('🎬 Mengkonversi ke MP4...');
  await processFormat(ctx, 'mp4'); 
});

bot.action('format_cancel', async (ctx) => { 
  const userId = ctx.from.id; 
  await ctx.answerCbQuery('❌ Proses dibatalkan');
  await deleteUserState(userId); 
  await ctx.editMessageText('❌ Proses dibatalkan.'); 
});

async function processFormat(ctx, format) {
  const userId = ctx.from.id;
  const state = await getUserState(userId);
  if (!state || state.step !== 'choose_format') { 
    await ctx.editMessageText('⏰ Sesi telah berakhir. Kirim link YouTube lagi.'); 
    await deleteUserState(userId); 
    return; 
  }
  const url = state.url;
  const formatName = format === 'mp3' ? 'MP3 (Audio)' : 'MP4 (Video)';
  await setUserState(userId, { url, format, step: 'processing', startTime: Date.now() });
  try {
    // Kirim typing action
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    
    await ctx.editMessageText(`🔍 Menganalisa link...`); await delay(500);
    const loadingMsg = ctx.callbackQuery.message;
    
    // Progress bar statis 25%
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, 
      `⏳ *Proses Konversi*\n` +
      `[▓▓▓░░░░░░░] 25%\n\n` +
      `📡 Menghubungkan ke server...`, { parse_mode: 'Markdown' });
    await delay(500);
    
    // Progress bar statis 50%
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, 
      `⏳ *Proses Konversi*\n` +
      `[▓▓▓▓▓░░░░░] 50%\n\n` +
      `🔄 Meracik ${formatName}...`, { parse_mode: 'Markdown' });
    await delay(500);
    
    // Progress bar statis 75%
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, 
      `⏳ *Proses Konversi*\n` +
      `[▓▓▓▓▓▓▓░░░] 75%\n\n` +
      `⚙️ Memproses ${formatName}...`, { parse_mode: 'Markdown' });
    
    // Upload document action
    await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_document');
    
    const result = await ytmp(url, format);
    if (!result || !result.downloadUrl) throw new Error('[Process] Gagal mendapatkan link download');
    
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    
    const title = result.title || (format === 'mp3' ? 'Audio' : 'Video');
    const emoji = format === 'mp3' ? '🎵' : '🎬';
    
    // Tampilan pesan yang lebih cantik
    const successMessage = `
✨ *Ready to Download!*

${emoji} *Judul:* ${title}
🎚️ *Format:* ${format.toUpperCase()}
🚀 *Status:* Berhasil dikonversi

_Klik tombol di bawah untuk mengunduh file. Link akan kadaluarsa dalam beberapa menit._`;

    // Dapatkan videoId untuk thumbnail
    const videoMatch = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoMatch ? videoMatch[1] : null;
    
    if (videoId) {
      await ctx.replyWithPhoto(
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        {
          caption: successMessage,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url(`📥 Download ${format.toUpperCase()}`, result.downloadUrl)],
            [Markup.button.callback('🔄 Download Lagi', 'format_retry')]
          ])
        }
      );
    } else {
      // Fallback jika tidak bisa dapat thumbnail
      await ctx.reply(successMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(`📥 Download ${format.toUpperCase()}`, result.downloadUrl)],
          [Markup.button.callback('🔄 Download Lagi', 'format_retry')]
        ])
      });
    }
  } catch (err) {
    log.error(`[User ${userId}] Error: ${err.message}`);
    let errorMessage = '❌ *Gagal memproses link*\n\n';
    if (err.message.includes('URL YouTube tidak valid')) errorMessage += 'Link YouTube tidak valid.';
    else if (err.message.includes('Timeout')) errorMessage += 'Proses konversi terlalu lama. Silakan coba lagi.';
    else if (err.message.includes('Video tidak ditemukan')) errorMessage += 'Video tidak ditemukan. Periksa kembali linknya.';
    else errorMessage += `Server mungkin sibuk. Coba lagi nanti.`;
    await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
  } finally { 
    await deleteUserState(userId); 
  }
}

// Handler untuk tombol retry
bot.action('format_retry', async (ctx) => {
  await ctx.answerCbQuery('🔄 Mengulang proses...');
  const userId = ctx.from.id;
  const state = await getUserState(userId);
  if (!state || !state.url) {
    await ctx.answerCbQuery('⚠️ Sesi berakhir, kirim link YouTube lagi');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    return;
  }
  await setUserState(userId, { url: state.url, step: 'choose_format', startTime: Date.now() });
  await ctx.editMessageText('🔄 *Pilih format download ulang:*', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🎵 MP3 (Audio)', 'format_mp3'), 
       Markup.button.callback('🎬 MP4 (Video)', 'format_mp4')],
      [Markup.button.callback('❌ Batal', 'format_cancel')]
    ])
  });
});

// Global error handler untuk unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

bot.catch((err, ctx) => { 
  log.error(`[Bot] Error: ${err.message}`, err.stack); 
  ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.').catch(() => {}); 
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try { 
      await bot.handleUpdate(req.body); 
      res.status(200).send('OK'); 
    }
    catch (err) { 
      log.error(`[Webhook] Error: ${err.message}`, err.stack); 
      res.status(500).send('Error'); 
    }
  } else {
    res.status(200).send('YouTube Downloader Bot is running!');
  }
};

if (require.main === module) {
  log.info('Starting bot in polling mode...');
  bot.launch();
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}