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
  // Gunakan hanya 1 User Agent yang paling stabil
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ],
  STATE_TTL: 2 * 60 // 2 menit dalam detik
};

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`)
};

function getUA() {
  // Selalu return user agent yang sama untuk konsistensi
  return CONFIG.USER_AGENTS[0];
}

// Fungsi helper untuk cek rate limit
async function isRateLimited(userId) {
  if (!redis) return false;
  try {
    const key = `ratelimit:${userId}`;
    const limit = 10;
    const window = 60;

    const currentUsage = await redis.incr(key);
    if (currentUsage === 1) {
      await redis.expire(key, window);
    }
    
    return currentUsage > limit;
  } catch (err) {
    log.error(`Rate limit error: ${err.message}`);
    return false;
  }
}

async function getRateLimitTTL(userId) {
  if (!redis) return 0;
  try {
    const key = `ratelimit:${userId}`;
    return await redis.ttl(key);
  } catch (err) {
    return 0;
  }
}

// Fungsi untuk menyimpan state user ke Redis
async function setUserState(userId, state) {
  if (!redis) return;
  try {
    const key = `user:state:${userId}`;
    await redis.set(key, state, { ex: CONFIG.STATE_TTL });
    log.debug(`State saved for user ${userId}`);
  } catch (err) {
    log.error(`Failed to save state for user ${userId}: ${err.message}`);
  }
}

async function getUserState(userId) {
  if (!redis) return null;
  try {
    const key = `user:state:${userId}`;
    const data = await redis.get(key);
    if (!data) return null;
    
    if (typeof data === 'object') return data;
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

// Fungsi ytmp dengan sessionUA yang konsisten
async function ytmp(url, format = 'mp3', retryCount = 0, sessionUA = null) {
  log.debug(`Processing URL: ${url} | Format: ${format} | Attempt ${retryCount + 1}/3`);
  
  // Gunakan UA yang konsisten untuk seluruh proses
  const userAgent = sessionUA || getUA();
  
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];
    
    // Buat cookie jar baru untuk setiap sesi
    const jar = new tough.CookieJar();
    
    // Header yang konsisten menggunakan UA yang sama
    const headers = {
      'User-Agent': userAgent,
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
      'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    };
    
    const client = wrapper(axios.create({ 
      jar, 
      timeout: CONFIG.TIMEOUT, 
      maxRedirects: 5, 
      headers 
    }));
    
    log.debug('[Step 1] Initializing session...');
    const initUrl = 'https://a.ymcdn.org/api/v1/init';
    const init = await client.get(initUrl, { 
      params: { p: 'y', '23': '1llum1n471', _: Date.now() } 
    });
    
    if (init.data.error) throw new Error(`[Init] ${init.data.error}`);
    if (!init.data.convertURL) throw new Error('[Init] Gagal inisialisasi - no convertURL');
    log.debug('[Step 1] Session initialized successfully');
    
    await delay(300, true);
    log.debug(`[Step 2] Sending convert request (${format})...`);
    
    const convert = await client.get(init.data.convertURL, { 
      params: { v: videoId, f: format, _: Date.now() } 
    });
    log.debug(`[Step 2] Convert response received`);
    
    if (convert.data.error && convert.data.error !== 'in_progress') {
      throw new Error(`[Convert] ${convert.data.error}`);
    }
    
    // Cek apakah langsung dapat download URL
    if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
      log.debug('[Step 2] Got direct download URL!');
      const title = await getVideoTitle(url);
      return { downloadUrl: convert.data.downloadURL, title, format };
    }
    
    // Polling untuk progress
    if (convert.data.progressURL) {
      log.debug('[Step 3] Starting polling...');
      let polls = 0;
      
      while (polls < CONFIG.MAX_POLLS) {
        polls++;
        
        try {
          // Gunakan delay acak untuk menghindari deteksi bot
          await delay(CONFIG.POLL_INTERVAL, true);
          
          const prog = await client.get(convert.data.progressURL, {
            headers: {
              'Referer': 'https://id.ytmp3.mobi/v1/',
              'Origin': 'https://id.ytmp3.mobi/v1'
            }
          });
          
          const progressData = prog.data;
          
          if (progressData.downloadURL && progressData.downloadURL !== '#') {
            log.debug('[Step 3] Got download URL from polling!');
            const title = await getVideoTitle(url);
            return { downloadUrl: progressData.downloadURL, title, format };
          }
          
          if (progressData.progress) {
            log.debug(`[Step 3] Progress: ${progressData.progress}%`);
          }
          
          if (progressData.error && progressData.error !== 'in_progress') {
            throw new Error(`[Polling] ${progressData.error}`);
          }
          
        } catch (err) {
          log.debug(`[Step 3] Poll error: ${err.message}`);
          
          // Jika 404, coba gunakan downloadURL awal jika ada
          if (err.response?.status === 404 && convert.data.downloadURL && convert.data.downloadURL !== '#') {
            log.debug('[Step 3] Fallback to initial download URL');
            const title = await getVideoTitle(url);
            return { downloadUrl: convert.data.downloadURL, title, format };
          }
          
          // Lanjutkan polling jika error tidak fatal
          if (polls < CONFIG.MAX_POLLS) {
            continue;
          }
        }
      }
      
      throw new Error('[Polling] Timeout - konversi terlalu lama');
    }
    
    throw new Error('[Convert] Gagal mendapatkan link download');
    
  } catch (err) {
    log.error(`[Conversion] Error: ${err.message}`);
    
    const shouldRetry = retryCount < CONFIG.MAX_RETRIES - 1 && 
      (err.message.includes('Timeout') || 
       err.message.includes('ECONNREFUSED') || 
       err.message.includes('socket hang up') ||
       err.message.includes('rate') || 
       err.message.includes('limit') ||
       err.message.includes('2-1')); // Tambahkan error 2-1 untuk retry
    
    if (shouldRetry) {
      const backoffDelay = 2000 + Math.random() * 3000;
      log.info(`[Retry] Attempt ${retryCount + 2}/3 after ${Math.round(backoffDelay)}ms`);
      await delay(backoffDelay);
      return ytmp(url, format, retryCount + 1, userAgent);
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

// Middleware global hanya untuk logging
bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log.info(`${ctx.from?.first_name || 'User'}: ${ctx.message?.text || ctx.callbackQuery?.data || 'Interaction'} (${ms}ms)`);
});

bot.start(async (ctx) => {
  const welcomeMessage = `🎬 *YouTube Downloader Bot* 🎬

Halo ${ctx.from.first_name || 'Kak'}!

Kirimkan link YouTube, lalu pilih format:
• *MP3* - Audio only
• *MP4* - Video with audio

*Cara penggunaan:*
1. Kirim link YouTube
2. Pilih format MP3 atau MP4
3. Tunggu proses konversi
4. *SEGERA klik tombol download* (link hanya bertahan 30-60 detik!)

━━━━━━━━━━━━━━━━━━━━
👤 *Owner Bot:* Abiq Nurmagedov
📦 *GitHub:* github.com/abiqnurmagedov17

⚠️ *PENTING:* 
• Link download cepat EXPIRED (30-60 detik)
• SEGERA klik tombol download setelah muncul
• Jangan share link ke orang lain
━━━━━━━━━━━━━━━━━━━━

Kirim link YouTube sekarang! 🚀`;
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
  
  if (!redis) {
    return ctx.reply('⚠️ *Rate limiting tidak tersedia* (Redis tidak terhubung)', { parse_mode: 'Markdown' });
  }
  
  try {
    const key = `ratelimit:${userId}`;
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
  
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = messageText.match(youtubeRegex);
  
  if (!match) {
    return ctx.reply('❌ Mohon kirim link YouTube yang valid.\n\nContoh: https://youtube.com/watch?v=xxxxx');
  }
  
  const existingState = await getUserState(userId);
  if (existingState) {
    return ctx.reply('⏳ Mohon tunggu, proses sebelumnya masih berjalan...');
  }
  
  const limited = await isRateLimited(userId);
  if (limited) {
    const ttl = await getRateLimitTTL(userId);
    return ctx.reply(`🚦 *Rate Limit Tercapai!*\nMohon tunggu ${ttl} detik lagi.\n\nLimit: 10 request per menit.`, { parse_mode: 'Markdown' });
  }
  
  const url = messageText;
  await setUserState(userId, { url, step: 'choose_format', startTime: Date.now() });
  await ctx.reply('🎬 *Pilih format download:*', Markup.inlineKeyboard([
    [Markup.button.callback('🎵 MP3 (Audio)', 'format_mp3'), 
     Markup.button.callback('🎬 MP4 (Video)', 'format_mp4')],
    [Markup.button.callback('❌ Batal', 'format_cancel')]
  ]));
});

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
    // Generate session UA yang konsisten untuk seluruh proses
    const sessionUA = getUA();
    
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing');
    
    await ctx.editMessageText(`🔍 Menganalisa link...`); 
    await delay(500);
    const loadingMsg = ctx.callbackQuery.message;
    
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, 
      `⏳ *Proses Konversi*\n` +
      `[▓▓▓░░░░░░░] 25%\n\n` +
      `📡 Menghubungkan ke server...`, { parse_mode: 'Markdown' });
    await delay(500);
    
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, 
      `⏳ *Proses Konversi*\n` +
      `[▓▓▓▓▓░░░░░] 50%\n\n` +
      `🔄 Meracik ${formatName}...`, { parse_mode: 'Markdown' });
    await delay(500);
    
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, 
      `⏳ *Proses Konversi*\n` +
      `[▓▓▓▓▓▓▓░░░] 75%\n\n` +
      `⚙️ Memproses ${formatName}...`, { parse_mode: 'Markdown' });
    
    await ctx.telegram.sendChatAction(ctx.chat.id, 'upload_document');
    
    // Panggil ytmp dengan sessionUA yang konsisten
    const result = await ytmp(url, format, 0, sessionUA);
    
    if (!result || !result.downloadUrl) throw new Error('[Process] Gagal mendapatkan link download');
    
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    
    const title = result.title || (format === 'mp3' ? 'Audio' : 'Video');
    const emoji = format === 'mp3' ? '🎵' : '🎬';
    
    // Peringatan yang lebih tegas tentang link cepat expired
    const successMessage = `
${emoji} *Konversi Berhasil!*

📝 *Judul:* ${title}
🎚️ *Format:* ${format.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━
⚠️ *PERINGATAN PENTING!*
━━━━━━━━━━━━━━━━━━━━

🔴 *Link hanya bertahan 30-60 DETIK!*
✅ *SEGERA klik tombol download di bawah!*
❌ *Jangan di-share ke orang lain!*
🔄 *Jika expired, gunakan tombol "Download Lagi"*

━━━━━━━━━━━━━━━━━━━━
⬇️ *Klik tombol di bawah untuk download*`;

    const videoMatch = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = videoMatch ? videoMatch[1] : null;
    
    if (videoId) {
      await ctx.replyWithPhoto(
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        {
          caption: successMessage,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url(`⚡ DOWNLOAD ${format.toUpperCase()} SEKARANG ⚡`, result.downloadUrl)],
            [Markup.button.callback('🔄 Download Lagi (Jika Expired)', 'format_retry')]
          ])
        }
      );
    } else {
      await ctx.reply(successMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.url(`⚡ DOWNLOAD ${format.toUpperCase()} SEKARANG ⚡`, result.downloadUrl)],
          [Markup.button.callback('🔄 Download Lagi (Jika Expired)', 'format_retry')]
        ])
      });
    }
    
  } catch (err) {
    log.error(`[User ${userId}] Error: ${err.message}`);
    let errorMessage = '❌ *Gagal memproses link*\n\n';
    
    if (err.message.includes('URL YouTube tidak valid')) {
      errorMessage += 'Link YouTube tidak valid.';
    } else if (err.message.includes('Timeout')) {
      errorMessage += 'Proses konversi terlalu lama. Silakan coba lagi.';
    } else if (err.message.includes('2-1') || err.message.includes('expired')) {
      errorMessage += 'Link download expired atau server sibuk.\nGunakan tombol "Download Lagi" atau kirim ulang link.';
    } else if (err.message.includes('Video tidak ditemukan')) {
      errorMessage += 'Video tidak ditemukan. Periksa kembali linknya.';
    } else {
      errorMessage += `Server mungkin sibuk. Coba lagi nanti.\n\nError: ${err.message.substring(0, 100)}`;
    }
    
    await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
  } finally { 
    await deleteUserState(userId); 
  }
}

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
  await ctx.editMessageText('🔄 *Pilih format download ulang:*\n\n⚠️ Link baru akan dibuat, segera download karena cepat expired!', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🎵 MP3 (Audio)', 'format_mp3'), 
       Markup.button.callback('🎬 MP4 (Video)', 'format_mp4')],
      [Markup.button.callback('❌ Batal', 'format_cancel')]
    ])
  });
});

// Global error handler
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