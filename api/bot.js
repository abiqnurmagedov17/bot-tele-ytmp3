const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');

const CONFIG = {
  TIMEOUT: 30000,
  MAX_POLLS: 50,
  POLL_INTERVAL: 2000,
  MAX_RETRIES: 3,
  UA_TTL: 24 * 60 * 60 * 1000, // 24 jam
  MAX_FAIL_COUNT: 3,
  CLEANUP_INTERVAL: 60 * 60 * 1000, // 1 jam
  RATE_LIMIT_DELAY: 500,
  STATE_TTL: 2 * 60 * 1000,
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux i686; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  ]
};

// Storage
const userStates = new Map();
const stateTimeouts = new Map();
const userUA = new Map(); // userId -> { ua, createdAt, failCount }

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`)
};

// ============ USER AGENT MANAGEMENT ============
function getRandomUA() {
  return CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];
}

function getOrCreateUAForUser(userId) {
  if (userUA.has(userId)) {
    const userData = userUA.get(userId);
    log.debug(`Using existing UA for user ${userId}: ${userData.ua.substring(0, 40)}...`);
    return userData.ua;
  }
  
  const newUA = getRandomUA();
  userUA.set(userId, { 
    ua: newUA, 
    createdAt: Date.now(),
    failCount: 0
  });
  
  log.debug(`Created new UA for user ${userId}: ${newUA.substring(0, 40)}...`);
  return newUA;
}

function rotateUAForUser(userId) {
  const newUA = getRandomUA();
  const existing = userUA.get(userId);
  const newFailCount = (existing?.failCount || 0) + 1;
  
  userUA.set(userId, { 
    ua: newUA, 
    createdAt: Date.now(),
    failCount: newFailCount
  });
  
  log.warn(`Rotated UA for user ${userId} (fail count: ${newFailCount}) | New UA: ${newUA.substring(0, 40)}...`);
  return newUA;
}

function shouldRotateUA(userId) {
  const userData = userUA.get(userId);
  return userData && userData.failCount >= CONFIG.MAX_FAIL_COUNT;
}

// Periodic cleanup UA
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [userId, data] of userUA.entries()) {
    if (now - data.createdAt > CONFIG.UA_TTL) {
      userUA.delete(userId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    log.info(`Cleaned up ${cleaned} expired UA entries`);
  }
}, CONFIG.CLEANUP_INTERVAL);

// ============ USER STATE MANAGEMENT ============
function setUserState(userId, state) {
  if (stateTimeouts.has(userId)) {
    clearTimeout(stateTimeouts.get(userId));
  }
  
  userStates.set(userId, state);
  
  const timeout = setTimeout(() => {
    log.debug(`Auto-cleanup state for user ${userId}`);
    userStates.delete(userId);
    stateTimeouts.delete(userId);
  }, CONFIG.STATE_TTL);
  
  stateTimeouts.set(userId, timeout);
}

function deleteUserState(userId) {
  if (stateTimeouts.has(userId)) {
    clearTimeout(stateTimeouts.get(userId));
    stateTimeouts.delete(userId);
  }
  userStates.delete(userId);
}

// ============ HELPER FUNCTIONS ============
function sanitizeFilename(name) {
  const clean = name.replace(/[^\w\s.-]/gi, '').trim().substring(0, 100);
  return clean || 'audio';
}

async function getVideoTitle(url) {
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) return `video_${Date.now()}`;
    const videoId = match[1];
    const response = await axios.get(`https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`, { 
      timeout: 5000 
    });
    return response.data?.title || `video_${Date.now()}`;
  } catch (err) {
    return `video_${Date.now()}`;
  }
}

function delay(ms, withJitter = false) {
  const actualDelay = withJitter ? ms + Math.random() * ms : ms;
  return new Promise(resolve => setTimeout(resolve, actualDelay));
}

function getProgressBar(percent) {
  const filled = Math.floor(percent / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

async function updateProgress(ctx, messageId, percent, status) {
  const progressBar = getProgressBar(percent);
  const text = `⚙️ *${status}*\n\n${progressBar} ${percent}%\n\n⏳ Mohon tunggu...`;
  
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      messageId,
      null,
      text,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    // Ignore edit message errors
  }
}

// ============ YTMP3 CONVERSION ============
async function ytmp(url, format = 'mp3', userId = null, retryCount = 0) {
  log.debug(`Processing | User: ${userId} | Format: ${format} | Attempt: ${retryCount + 1}/${CONFIG.MAX_RETRIES}`);
  
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];

    const jar = new tough.CookieJar();
    
    // 🔥 PAKAI UA PER USER ATAU RANDOM
    let currentUA;
    if (userId) {
      currentUA = getOrCreateUAForUser(userId);
      // Cek apakah perlu rotate karena terlalu banyak gagal
      if (shouldRotateUA(userId)) {
        log.warn(`User ${userId} has high fail count, rotating UA`);
        currentUA = rotateUAForUser(userId);
      }
    } else {
      currentUA = getRandomUA();
    }
    
    const headers = {
      'User-Agent': currentUA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Referer': 'https://id.ytmp3.mobi/v1/',
      'Origin': 'https://id.ytmp3.mobi',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'sec-ch-ua': '"Google Chrome";v="121", "Chromium";v="121", "Not?A_Brand";v="24"',
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
      params: { 
        p: 'y', 
        '23': '1llum1n471', 
        _: Date.now() 
      }
    });
    
    if (init.data.error) throw new Error(`[Init] ${init.data.error}`);
    if (!init.data.convertURL) throw new Error('[Init] Gagal inisialisasi - no convertURL');
    
    await delay(300, true);

    log.debug(`[Step 2] Sending convert request (${format})...`);
    const convert = await client.get(init.data.convertURL, {
      params: { 
        v: videoId, 
        f: format, 
        _: Date.now() 
      }
    });
    
    // 🔥 CEK APAKAH LANGSUNG DAPET URL
    if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
      log.debug('[Step 2] Got direct download URL!');
      const title = await getVideoTitle(url);
      return { downloadUrl: convert.data.downloadURL, title, format };
    }

    // 🔥 POLLING PROGRESS
    if (convert.data.progressURL) {
      log.debug('[Step 3] Starting polling...');
      let polls = 0;
      
      while (polls < CONFIG.MAX_POLLS) {
        polls++;
        
        try {
          const prog = await client.get(convert.data.progressURL, {
            headers: {
              'Referer': 'https://id.ytmp3.mobi/v1/',
              'Origin': 'https://id.ytmp3.mobi'
            }
          });
          
          const progressData = prog.data;
          
          if (progressData.downloadURL && progressData.downloadURL !== '#') {
            log.debug('[Step 3] Got download URL from polling!');
            const title = await getVideoTitle(url);
            return { downloadUrl: progressData.downloadURL, title, format };
          }
          
          if (progressData.error && progressData.error !== 'in_progress') {
            throw new Error(`[Polling] ${progressData.error}`);
          }
          
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
    
    // 🔥 ROTATE UA JIKA KENA BLOCK
    const isBlocked = err.response?.status === 403 || 
                      err.response?.status === 429 ||
                      err.message.includes('blocked') ||
                      err.message.includes('forbidden');
    
    if (isBlocked && userId) {
      log.warn(`User ${userId} may be blocked, rotating UA`);
      rotateUAForUser(userId);
    }
    
    const shouldRetry = retryCount < CONFIG.MAX_RETRIES - 1 && 
      (err.message.includes('Timeout') ||
       err.message.includes('ECONNREFUSED') ||
       err.message.includes('socket hang up') ||
       err.message.includes('rate') ||
       err.message.includes('limit') ||
       isBlocked);
    
    if (shouldRetry) {
      const backoffDelay = 2000 + Math.random() * 3000;
      log.info(`[Retry] Attempt ${retryCount + 2}/${CONFIG.MAX_RETRIES} after ${Math.round(backoffDelay)}ms`);
      await delay(backoffDelay);
      return ytmp(url, format, userId, retryCount + 1);
    }
    
    throw err;
  }
}

// ============ TELEGRAM BOT ============
const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware
bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log.info(`${ctx.from?.first_name || 'User'} (${ctx.from?.id}): ${ctx.message?.text || ctx.callbackQuery?.data || 'Interaction'} (${ms}ms)`);
  await delay(CONFIG.RATE_LIMIT_DELAY);
});

// Command: /start
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
4. Klik tombol download

━━━━━━━━━━━━━━━━━━━━
👤 *Owner:* Abiq Nurmagedov
📦 *GitHub:* github.com/abiqnurmagedov17

⚠️ *Note:*
Link cepat expired, segera download!
━━━━━━━━━━━━━━━━━━━━

Kirim link YouTube sekarang! 🚀
  `;
  
  ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

// Command: /help
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
    '/reset - Reset sesi (jika error)',
    { parse_mode: 'Markdown' }
  );
});

// Command: /status
bot.command('status', (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  const uaData = userUA.get(userId);
  
  let statusMsg = '📊 *Status Bot*\n\n';
  
  if (state) {
    statusMsg += `⏳ *Proses berjalan:*\n`;
    statusMsg += `• URL: ${state.url}\n`;
    statusMsg += `• Format: ${state.format || 'belum dipilih'}\n`;
    statusMsg += `• Step: ${state.step}\n\n`;
  } else {
    statusMsg += `✅ Tidak ada proses berjalan\n\n`;
  }
  
  if (uaData) {
    statusMsg += `🆔 *User Agent Info:*\n`;
    statusMsg += `• Fail count: ${uaData.failCount}/${CONFIG.MAX_FAIL_COUNT}\n`;
    statusMsg += `• Age: ${Math.round((Date.now() - uaData.createdAt) / 1000 / 60)} menit\n`;
  }
  
  ctx.reply(statusMsg, { parse_mode: 'Markdown' });
});

// Command: /reset
bot.command('reset', (ctx) => {
  const userId = ctx.from.id;
  deleteUserState(userId);
  if (userUA.has(userId)) {
    rotateUAForUser(userId); // Reset dengan UA baru
  }
  ctx.reply('✅ Sesi telah direset. Silakan kirim link YouTube baru.');
});

// Handle text messages (YouTube links)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text.trim();
  
  if (userStates.has(userId)) {
    ctx.reply('⏳ Mohon tunggu, proses sebelumnya masih berjalan...\nGunakan /reset jika ingin membatalkan.');
    return;
  }
  
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = messageText.match(youtubeRegex);
  
  if (!match) {
    ctx.reply('❌ Mohon kirim link YouTube yang valid.\n\nContoh: https://youtube.com/watch?v=xxxxx');
    return;
  }
  
  const url = messageText;
  
  setUserState(userId, { url, step: 'choose_format', startTime: Date.now() });
  
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

// Button handlers
bot.action('format_mp3', async (ctx) => {
  await processFormat(ctx, 'mp3');
});

bot.action('format_mp4', async (ctx) => {
  await processFormat(ctx, 'mp4');
});

bot.action('format_cancel', async (ctx) => {
  const userId = ctx.from.id;
  deleteUserState(userId);
  await ctx.editMessageText('❌ Proses dibatalkan.');
});

// Main processing function
async function processFormat(ctx, format) {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (!state || state.step !== 'choose_format') {
    await ctx.editMessageText('⏰ Sesi telah berakhir. Kirim link YouTube lagi.');
    deleteUserState(userId);
    return;
  }
  
  const url = state.url;
  const formatName = format === 'mp3' ? 'MP3 (Audio)' : 'MP4 (Video)';
  
  setUserState(userId, { url, format, step: 'processing', startTime: Date.now() });
  
  // Simpan chatId untuk progress update
  const chatId = ctx.chat.id;
  let progressMsg = null;
  
  try {
    // Kirim pesan progress awal
    progressMsg = await ctx.reply(
      '🔍 *Memulai konversi...*\n\n' +
      `${getProgressBar(0)} 0%\n\n` +
      '⏳ Mengambil informasi video...',
      { parse_mode: 'Markdown' }
    );
    
    await delay(500);
    
    // Progress: 20% - Fetching video info
    await updateProgress(ctx, progressMsg.message_id, 20, 'Mengambil informasi video...');
    await delay(800);
    
    // Progress: 40% - Connecting
    await updateProgress(ctx, progressMsg.message_id, 40, 'Menghubungkan ke server...');
    await delay(500);
    
    // Progress: 60% - Converting
    await updateProgress(ctx, progressMsg.message_id, 60, `Mengkonversi ke ${formatName}...`);
    
    // Proses konversi dengan userId untuk UA tracking
    const result = await ytmp(url, format, userId);
    
    if (!result || !result.downloadUrl) {
      throw new Error('Gagal mendapatkan link download');
    }
    
    // Progress: 90% - Finalizing
    await updateProgress(ctx, progressMsg.message_id, 90, 'Menyiapkan link download...');
    await delay(300);
    
    // Hapus pesan progress
    await ctx.telegram.deleteMessage(chatId, progressMsg.message_id);
    
    const title = result.title || (format === 'mp3' ? 'Audio' : 'Video');
    const extension = format === 'mp3' ? '.mp3' : '.mp4';
    const filename = sanitizeFilename(title) + extension;
    
    const emoji = format === 'mp3' ? '🎵' : '🎬';
    const typeText = format === 'mp3' ? 'Audio' : 'Video';
    
    // 🔥 PESAN SUKSES DENGAN TOMBOL BISA DIKLIK LANGSUNG
    const successMessage = 
      `${emoji} *Konversi Berhasil!*\n\n` +
      `📝 *Judul:* ${title}\n` +
      `📁 *File:* ${filename}\n` +
      `🎚️ *Format:* ${typeText}\n\n` +
      `⚠️ *Link cepat expired!* Segera download.`;
    
    await ctx.reply(successMessage, { 
      parse_mode: 'Markdown', 
      disable_web_page_preview: true,
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.url('⬇️ DOWNLOAD SEKARANG ⬇️', result.downloadUrl)],
        [Markup.button.url('📋 Backup Link', result.downloadUrl)]
      ])
    });
    
    // Optional: Auto-delete success message after 5 minutes
    setTimeout(async () => {
      try {
        // Just log, don't delete user's message
        log.debug(`Download link expired for user ${userId}`);
      } catch(e) {}
    }, 5 * 60 * 1000);
    
  } catch (err) {
    log.error(`[User ${userId}] Error: ${err.message}`);
    
    // Hapus pesan progress jika ada
    if (progressMsg) {
      try {
        await ctx.telegram.deleteMessage(chatId, progressMsg.message_id);
      } catch(e) {}
    }
    
    let errorMessage = '❌ *Gagal memproses link*\n\n';
    
    if (err.message.includes('URL YouTube tidak valid')) {
      errorMessage += 'Link YouTube tidak valid. Periksa kembali linknya.';
    } else if (err.message.includes('Timeout')) {
      errorMessage += 'Proses konversi terlalu lama. Silakan coba lagi.\n\nGunakan /reset jika masih error.';
    } else if (err.message.includes('Video tidak ditemukan')) {
      errorMessage += 'Video tidak ditemukan. Mungkin video private atau dihapus.';
    } else if (err.message.includes('blocked') || err.message.includes('403')) {
      errorMessage += 'Server memblokir request. Coba lagi nanti.\n\nUA sudah dirotate otomatis.';
    } else {
      errorMessage += `Server mungkin sibuk. Coba lagi nanti.\n\nGunakan /reset jika masih error.`;
    }
    
    await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
  } finally {
    deleteUserState(userId);
  }
}

// Error handler
bot.catch((err, ctx) => {
  log.error(`[Bot] Error: ${err}`);
  ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.\nGunakan /reset untuk memulai ulang.').catch(() => {});
});

// ============ EXPORT FOR VERCEL ============
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (err) {
      log.error(`[Webhook] Error: ${err}`);
      res.status(500).send('Error');
    }
  } else {
    res.status(200).send('YouTube Downloader Bot is running!');
  }
};

// ============ LOCAL DEVELOPMENT ============
if (require.main === module) {
  log.info('Starting bot in polling mode...');
  bot.launch();
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}