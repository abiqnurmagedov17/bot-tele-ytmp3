/**
 * 🎬 YouTube Downloader Bot - Production Edition
 * Author: Abiq Nurmagedov
 * GitHub: github.com/abiqnurmagedov17
 * 
 * Features:
 * - Rate limiting & anti-spam
 * - Exponential backoff retry
 * - Structured logging
 * - In-memory caching
 * - Environment config validation
 * - User-friendly error handling
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const NodeCache = require('node-cache');
const pino = require('pino');

// ═══════════════════════════════════════════════════════════
// ⚙️ CONFIGURATION & ENVIRONMENT
// ═══════════════════════════════════════════════════════════

const config = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  TIMEOUT: parseInt(process.env.TIMEOUT) || 30000,
  MAX_POLLS: parseInt(process.env.MAX_POLLS) || 50,
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL) || 2000,
  MAX_RETRIES: parseInt(process.env.MAX_RETRIES) || 3,
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX) || 10,
  STATE_TTL: parseInt(process.env.STATE_TTL) || 120,
  CACHE_TTL: parseInt(process.env.CACHE_TTL) || 600,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0'
  ]
};

if (!config.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN environment variable is required!');
  process.exit(1);}

// ═══════════════════════════════════════════════════════════
// 🪵 LOGGER (Pino with console fallback)
// ═══════════════════════════════════════════════════════════

let logger;
try {
  logger = pino({
    level: config.LOG_LEVEL,
    transport: {
      targets: [{ target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss Z' } }]
    }
  });
} catch {
  // Fallback ke console jika pino-pretty tidak terinstall
  logger = {
    info: (msg, meta) => console.log(`[INFO] ${msg} ${meta ? JSON.stringify(meta) : ''}`),
    warn: (msg, meta) => console.warn(`[WARN] ${msg} ${meta ? JSON.stringify(meta) : ''}`),
    error: (msg, meta) => console.error(`[ERROR] ${msg} ${meta ? JSON.stringify(meta) : ''}`),
    debug: (msg, meta) => console.debug(`[DEBUG] ${msg} ${meta ? JSON.stringify(meta) : ''}`),
    child: () => logger
  };
}

// ═══════════════════════════════════════════════════════════
// 🗄️ CACHE & STATE MANAGEMENT
// ═══════════════════════════════════════════════════════════

const userStates = new NodeCache({ stdTTL: config.STATE_TTL, checkperiod: 30 });
const conversionCache = new NodeCache({ stdTTL: config.CACHE_TTL, checkperiod: 60 });
const rateLimits = new Map();

// ═══════════════════════════════════════════════════════════
// 🛠️ UTILITIES
// ═══════════════════════════════════════════════════════════

function getUA() {
  return config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)];
}

function delay(ms, withJitter = false) {
  const actualDelay = withJitter ? ms + Math.random() * ms * 0.5 : ms;
  return new Promise(resolve => setTimeout(resolve, actualDelay));
}

function sanitizeFilename(name) {
  if (!name) return `audio_${Date.now()}`;
  const clean = name.replace(/[^\w\s.-]/gi, '').trim().substring(0, 100);
  return clean || `file_${Date.now()}`;}

function isValidYouTubeUrl(url) {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  return regex.test(url);
}

function extractVideoId(url) {
  const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

async function getVideoTitle(url) {
  try {
    const videoId = extractVideoId(url);
    if (!videoId) return `video_${Date.now()}`;
    
    const response = await axios.get(`https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`, { 
      timeout: 5000,
      headers: { 'User-Agent': getUA() }
    });
    return response.data?.title || `video_${Date.now()}`;
  } catch (err) {
    logger.debug({ error: err.message }, 'Failed to fetch video title');
    return `video_${Date.now()}`;
  }
}

async function isUrlAlive(url) {
  try {
    const res = await axios.head(url, { 
      timeout: 5000,
      maxRedirects: 3,
      headers: { 'User-Agent': getUA() },
      validateStatus: status => status < 400
    });
    return res.status === 200;
  } catch (err) {
    logger.debug({ url, error: err.message }, 'URL validation failed');
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// 🔄 RETRY LOGIC WITH EXPONENTIAL BACKOFF
// ═══════════════════════════════════════════════════════════

async function retryWithBackoff(fn, maxRetries = config.MAX_RETRIES, baseDelay = 1000) {
  let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = err.message.includes('Timeout') ||
                         err.message.includes('ECONNREFUSED') ||
                         err.message.includes('socket hang up') ||
                         err.message.toLowerCase().includes('rate') ||
                         err.message.toLowerCase().includes('limit');
      
      if (!isRetryable || attempt === maxRetries - 1) break;
      
      const exponentialDelay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 500;
      const totalDelay = exponentialDelay + jitter;
      
      logger.warn({ attempt: attempt + 1, maxRetries, delay: Math.round(totalDelay) }, 
        `Retry after error: ${err.message}`);
      await delay(totalDelay);
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════════════════════════
// 🎯 YTMP SERVICE (Core Conversion Logic)
// ═══════════════════════════════════════════════════════════

async function ytmpInternal(url, format = 'mp3', onProgress) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('URL YouTube tidak valid');

  logger.debug({ videoId, format }, 'Starting conversion process');

  const jar = new tough.CookieJar();
  const currentUA = getUA();
  
  const headers = {
    'User-Agent': currentUA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://id.ytmp3.mobi/v1/',
    'Origin': 'https://id.ytmp3.mobi',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
  const client = wrapper(axios.create({
    jar,
    timeout: config.TIMEOUT,
    maxRedirects: 5,
    headers
  }));

  // Step 1: Initialize session
  logger.debug('[Step 1] Initializing session...');
  const init = await client.get('https://a.ymcdn.org/api/v1/init', {
    params: { p: 'y', '23': '1llum1n471', _: Date.now() }
  });
  
  if (init.data.error) throw new Error(`[Init] ${init.data.error}`);
  if (!init.data.convertURL) throw new Error('[Init] Gagal inisialisasi - no convertURL');
  
  await delay(500, true);

  // Step 2: Send convert request
  logger.debug(`[Step 2] Sending convert request (${format})...`);
  const convert = await client.get(init.data.convertURL, {
    params: { v: videoId, f: format, _: Date.now() }
  });
  
  if (convert.data.error && convert.data.error !== 'in_progress') {
    throw new Error(`[Convert] ${convert.data.error}`);
  }

  // Direct download URL available
  if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
    logger.debug('[Step 2] Got direct download URL');
    await delay(1500, true);
    
    const title = await getVideoTitle(url);
    const downloadUrl = convert.data.downloadURL;
    const isValid = await isUrlAlive(downloadUrl);
    
    return { 
      downloadUrl, 
      title, 
      format, 
      isValid,
      warning: !isValid ? '⚠️ Link mungkin sudah expired, segera download!' : null
    };
  }

  // Step 3: Polling for progress
  if (convert.data.progressURL) {
    logger.debug('[Step 3] Starting polling...');    let polls = 0;
    let lastProgress = -1;
    
    while (polls < config.MAX_POLLS) {
      polls++;
      
      try {
        const prog = await client.get(convert.data.progressURL, {
          headers: { 'Referer': 'https://id.ytmp3.mobi/v1/', 'Origin': 'https://id.ytmp3.mobi' }
        });
        
        const progressData = prog.data;
        
        // Report progress if callback provided
        if (onProgress && progressData.progress !== lastProgress) {
          lastProgress = progressData.progress;
          onProgress(Math.min(90, 60 + progressData));
          logger.debug({ poll: polls, progress: progressData.progress }, 'Progress update');
        }
        
        if (progressData.downloadURL && progressData.downloadURL !== '#') {
          logger.debug('[Step 3] Got download URL from polling');
          await delay(1500, true);
          
          const title = await getVideoTitle(url);
          const downloadUrl = progressData.downloadURL;
          const isValid = await isUrlAlive(downloadUrl);
          
          return { 
            downloadUrl, 
            title, 
            format, 
            isValid,
            warning: !isValid ? '⚠️ Link mungkin sudah expired, segera download!' : null
          };
        }
        
        if (progressData.error && progressData.error !== 'in_progress') {
          throw new Error(`[Polling] ${progressData.error}`);
        }
        
      } catch (err) {
        logger.debug({ poll: polls, error: err.message }, 'Poll error');
        
        // Fallback to initial convert URL if 404
        if (err.response?.status === 404 && convert.data.downloadURL && convert.data.downloadURL !== '#') {
          await delay(1000, true);
          const title = await getVideoTitle(url);
          const downloadUrl = convert.data.downloadURL;
          const isValid = await isUrlAlive(downloadUrl);          
          return { 
            downloadUrl, 
            title, 
            format, 
            isValid,
            warning: !isValid ? '⚠️ Link mungkin sudah expired, segera download!' : null
          };
        }
        await delay(1000, true);
      }
      
      await delay(config.POLL_INTERVAL, true);
    }
    
    throw new Error('[Polling] Timeout - konversi terlalu lama');
  }
  
  throw new Error('[Convert] Gagal mendapatkan link download');
}

// Wrapper dengan caching
async function ytmp(url, format = 'mp3', onProgress) {
  const cacheKey = `${url}_${format}`;
  const cached = conversionCache.get(cacheKey);
  
  if (cached) {
    logger.debug({ cacheKey }, 'Cache hit!');
    return { ...cached, cached: true };
  }
  
  const result = await retryWithBackoff(() => ytmpInternal(url, format, onProgress));
  conversionCache.set(cacheKey, result);
  return result;
}

// ═══════════════════════════════════════════════════════════
// 📊 API STATUS CHECKER
// ═══════════════════════════════════════════════════════════

async function checkApiStatus() {
  const apis = [
    { name: 'YTMP3 API (a.ymcdn.org)', url: 'https://a.ymcdn.org/api/v1/init', params: { p: 'y', '23': '1llum1n471', _: Date.now() } },
    { name: 'NoEmbed API', url: 'https://noembed.com/embed', params: { url: 'https://youtube.com/watch?v=dQw4w9WgXcQ' } }
  ];
  
  const results = [];
  
  for (const api of apis) {
    try {      const startTime = Date.now();
      const response = await axios.get(api.url, { 
        params: api.params,
        timeout: 10000,
        headers: { 'User-Agent': getUA() }
      });
      const responseTime = Date.now() - startTime;
      
      results.push({
        name: api.name,
        status: 'online',
        statusCode: response.status,
        responseTime: `${responseTime}ms`
      });
    } catch (err) {
      results.push({
        name: api.name,
        status: 'offline',
        error: err.message,
        statusCode: err.response?.status || 'N/A'
      });
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════
// 💬 ERROR MAPPING (User-Friendly Messages)
// ═══════════════════════════════════════════════════════════

const ERROR_MESSAGES = {
  'URL YouTube tidak valid': '❌ Link YouTube tidak dikenali. Cek ulang ya!',
  'Timeout': '⏰ Server lagi sibuk, coba 1-2 menit lagi',
  'Video tidak ditemukan': '🔍 Video mungkin di-private atau dihapus',
  'rate limit': '🚦 Terlalu cepat! Tunggu sebentar ya',
  'konversi terlalu lama': '⏳ Proses terlalu lama, server mungkin overload',
  'default': '😅 Ada kendala teknis. Coba lagi atau lapor ke owner'
};

function getUserFriendlyError(err) {
  if (!err?.message) return ERROR_MESSAGES.default;
  const msg = err.message.toLowerCase();
  
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (key !== 'default' && msg.includes(key.toLowerCase())) {
      return value;
    }
  }
  return ERROR_MESSAGES.default;}

// ═══════════════════════════════════════════════════════════
// 🤖 BOT INITIALIZATION
// ═══════════════════════════════════════════════════════════

const bot = new Telegraf(config.BOT_TOKEN);

// Middleware: Logging & Rate Limiting
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  const userName = ctx.from?.first_name || 'Unknown';
  const action = ctx.message?.text || ctx.callbackQuery?.data || 'interaction';
  const start = Date.now();
  
  // Rate limiting per-user
  if (userId) {
    const now = Date.now();
    const userLimit = rateLimits.get(userId) || { count: 0, resetAt: now + config.RATE_LIMIT_WINDOW };
    
    if (now > userLimit.resetAt) {
      rateLimits.set(userId, { count: 1, resetAt: now + config.RATE_LIMIT_WINDOW });
    } else if (userLimit.count >= config.RATE_LIMIT_MAX) {
      logger.warn({ userId, userName }, 'Rate limit exceeded');
      return ctx.reply('🚦 *Rate limit!* Tunggu 1 menit sebelum coba lagi.', { parse_mode: 'Markdown' });
    } else {
      userLimit.count++;
    }
  }
  
  try {
    await next();
    const ms = Date.now() - start;
    logger.info({ userId, userName, action, duration: ms }, 'Request completed');
  } catch (err) {
    logger.error({ userId, action, error: err.message }, 'Request failed');
    throw err;
  }
  
  // Small delay to prevent flooding
  await delay(300);
});

// ═══════════════════════════════════════════════════════════
// 📜 COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════

bot.start((ctx) => {
  const welcomeMessage = `
🎬 *YouTube Downloader Bot* 🎬
Halo ${ctx.from.first_name || 'Kak'}!

Kirimkan link YouTube, lalu pilih format:
• *MP3* - Audio only
• *MP4* - Video with audio

*Cara penggunaan:*
1. Kirim link YouTube
2. Pilih format MP3 atau MP4
3. Tunggu proses konversi
4. Dapatkan link download

━━━━━━━━━━━━━━━━━━━━
👤 *Owner Bot:* Abiq Nurmagedov
📦 *GitHub:* github.com/abiqnurmagedov17

⚠️ *Note:*
Bot ini menggunakan API pihak ketiga 
hasil scraping dan bisa mati sewaktu-waktu.
Gunakan dengan bijak!
━━━━━━━━━━━━━━━━━━━━

Kirim link YouTube sekarang! 🚀
  `;
  ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

bot.help((ctx) => {
  ctx.reply(
    '📖 *Bantuan*\n\n' +
    'Kirimkan link YouTube, lalu pilih format.\n\n' +
    '*Format:*\n' +
    '• MP3 - Audio (musik, podcast)\n' +
    '• MP4 - Video (tanpa watermark)\n\n' +
    '*Contoh link:*\n' +
    '• https://youtube.com/watch?v=xxxxx\n' +
    '• https://youtu.be/xxxxx\n' +
    '• https://youtube.com/shorts/xxxxx\n\n' +
    '*Perintah:*\n' +
    '/start - Mulai bot\n' +
    '/help - Bantuan\n' +
    '/status - Cek status proses\n' +
    '/ping - Cek status API\n' +
    '/health - Health check bot',
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', (ctx) => {  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (state) {
    ctx.reply(`⏳ Sedang memproses: ${state.url} (${state.format || 'mp3'})`);
  } else {
    ctx.reply('✅ Tidak ada proses yang sedang berjalan');
  }
});

bot.command('ping', async (ctx) => {
  const statusMsg = await ctx.reply('🏓 *Mengecek status API...*', { parse_mode: 'Markdown' });
  
  try {
    const apiStatus = await checkApiStatus();
    
    let statusText = '🏓 *Status API*\n\n';
    
    for (const api of apiStatus) {
      if (api.status === 'online') {
        statusText += `✅ *${api.name}*\n`;
        statusText += `   Status: ONLINE\n`;
        statusText += `   Response: ${api.responseTime}\n`;
        statusText += `   HTTP: ${api.statusCode}\n\n`;
      } else {
        statusText += `❌ *${api.name}*\n`;
        statusText += `   Status: OFFLINE\n`;
        statusText += `   Error: ${api.error}\n`;
        statusText += `   HTTP: ${api.statusCode}\n\n`;
      }
    }
    
    const allOnline = apiStatus.every(api => api.status === 'online');
    statusText += allOnline ? '✨ *Semua API dalam keadaan baik*' : '⚠️ *Beberapa API sedang bermasalah*';
    
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, statusText, { parse_mode: 'Markdown' });
  } catch (err) {
    logger.error({ error: err.message }, 'Ping command error');
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '❌ Gagal mengecek status API. Silakan coba lagi nanti.', { parse_mode: 'Markdown' });
  }
});

bot.command('health', async (ctx) => {
  const health = {
    status: 'ok',
    uptime: `${Math.floor(process.uptime())}s`,
    memory: {
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    },    activeUsers: userStates.keys().length,
    cacheStats: conversionCache.getStats(),
    timestamp: new Date().toISOString()
  };
  
  ctx.reply(`📊 *Health Check*\n\`\`\`json\n${JSON.stringify(health, null, 2)}\`\`\``, { 
    parse_mode: 'Markdown' 
  });
});

// ═══════════════════════════════════════════════════════════
// 📨 MESSAGE HANDLERS
// ═══════════════════════════════════════════════════════════

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text.trim();
  
  // Check if user has active process
  if (userStates.has(userId)) {
    ctx.reply('⏳ Mohon tunggu, proses sebelumnya masih berjalan...');
    return;
  }
  
  // Validate YouTube URL
  if (!isValidYouTubeUrl(messageText)) {
    ctx.reply('❌ Mohon kirim link YouTube yang valid.\n\nContoh: https://youtube.com/watch?v=xxxxx');
    return;
  }
  
  const url = messageText;
  
  // Set user state
  userStates.set(userId, { url, step: 'choose_format', startTime: Date.now() });
  
  await ctx.reply(
    '🎬 *Pilih format download:*',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🎵 MP3 (Audio)', 'format_mp3'),
        Markup.button.callback('🎬 MP4 (Video)', 'format_mp4')
      ],
      [Markup.button.callback('❌ Batal', 'format_cancel')]
    ])
  );
});

// ═══════════════════════════════════════════════════════════
// ⚡ CALLBACK QUERY HANDLERS
// ═══════════════════════════════════════════════════════════
bot.action('format_mp3', async (ctx) => {
  await processFormat(ctx, 'mp3');
});

bot.action('format_mp4', async (ctx) => {
  await processFormat(ctx, 'mp4');
});

bot.action('format_cancel', async (ctx) => {
  const userId = ctx.from.id;
  userStates.del(userId);
  await ctx.editMessageText('❌ Proses dibatalkan.');
});

// ═══════════════════════════════════════════════════════════
// 🔄 FORMAT PROCESSING (Main Logic)
// ═══════════════════════════════════════════════════════════

async function processFormat(ctx, format) {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (!state || state.step !== 'choose_format') {
    await ctx.editMessageText('⏰ Sesi telah berakhir. Kirim link YouTube lagi.');
    userStates.del(userId);
    return;
  }
  
  const url = state.url;
  const formatName = format === 'mp3' ? 'MP3 (Audio)' : 'MP4 (Video)';
  
  // Update state
  userStates.set(userId, { url, format, step: 'processing', startTime: Date.now() });
  
  const loadingMsg = ctx.callbackQuery.message;
  
  try {
    // Progress simulation with real updates
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, '🔍 Menganalisa link... (15%)');
    await delay(600);
    
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, '⚙️ Menghubungkan ke server... (35%)');
    await delay(500);
    
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, `🔄 Mengkonversi ke ${formatName}... (60%)`);
    
    // Real conversion with progress callback
    const result = await ytmp(url, format, (progress) => {
      ctx.telegram.editMessageText(        ctx.chat.id,
        loadingMsg.message_id,
        null,
        `🔄 Progress: ${progress}%`
      ).catch(() => {}); // Ignore if message already edited
    });
    
    await ctx.telegram.editMessageText(ctx.chat.id, loadingMsg.message_id, null, '✅ Finalisasi... (95%)');
    await delay(300);
    
    if (!result || !result.downloadUrl) {
      throw new Error('[Process] Gagal mendapatkan link download');
    }
    
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    
    // Prepare response
    const title = result.title || (format === 'mp3' ? 'Audio' : 'Video');
    const extension = format === 'mp3' ? '.mp3' : '.mp4';
    const filename = sanitizeFilename(title) + extension;
    
    const emoji = format === 'mp3' ? '🎵' : '🎬';
    const typeText = format === 'mp3' ? 'Audio' : 'Video';
    const cacheBadge = result.cached ? '⚡ *Cached* | ' : '';
    
    const warningText = result.warning ? `\n${result.warning}\n` : '';
    
    const successMessage = 
      `${emoji} ${cacheBadge}*Konversi Berhasil!*\n\n` +
      `📝 *Judul:* ${title}\n` +
      `📁 *File:* ${filename}\n` +
      `🎚️ *Format:* ${typeText}\n\n` +
      `🔗 *Link Download:*\n` +
      `[📥 Klik di sini untuk download](${result.downloadUrl})\n` +
      warningText +
      `\n⚠️ *PENTING - BACA!*\n` +
      `• Link bisa expired dalam hitungan menit\n` +
      `• Error "code: 2-1" = link sudah mati\n` +
      `• Kalau gagal, kirim ulang link YouTube`;
    
    await ctx.reply(successMessage, { 
      parse_mode: 'Markdown', 
      disable_web_page_preview: false,
      link_preview_options: { is_disabled: false }
    });
    
  } catch (err) {
    logger.error({ userId, url, format, error: err.message }, 'Conversion failed');
    
    const errorMessage = getUserFriendlyError(err);    await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
    
  } finally {
    userStates.del(userId);
  }
}

// ═══════════════════════════════════════════════════════════
// 🚨 GLOBAL ERROR HANDLER
// ═══════════════════════════════════════════════════════════

bot.catch((err, ctx) => {
  logger.error({ error: err.message, stack: err.stack, ctx: ctx?.updateType }, 'Unhandled bot error');
  
  const safeReply = async () => {
    try {
      await ctx?.reply?.('❌ Terjadi kesalahan sistem. Silakan coba lagi nanti.');
    } catch (e) {
      // Ignore if can't send message
    }
  };
  safeReply();
});

// ═══════════════════════════════════════════════════════════
// 🚀 BOT LAUNCH
// ═══════════════════════════════════════════════════════════

// Webhook handler for serverless/Vercel
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (err) {
      logger.error({ error: err.message }, 'Webhook error');
      res.status(500).send('Error');
    }
  } else {
    res.status(200).send('🎬 YouTube Downloader Bot is running!');
  }
};

// Polling mode for local development
if (require.main === module) {
  logger.info('🚀 Starting bot in polling mode...');
  
  bot.launch().then(() => {
    logger.info('✅ Bot is ready!');
  }).catch(err => {    logger.error({ error: err.message }, 'Failed to launch bot');
    process.exit(1);
  });
  
  // Graceful shutdown
  const shutdown = (signal) => {
    logger.info(`🛑 Received ${signal}, shutting down gracefully...`);
    bot.stop(signal);
    process.exit(0);
  };
  
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}