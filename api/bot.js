const { Telegraf } = require('telegraf');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');

// Konfigurasi
const CONFIG = {
  TIMEOUT: 30000,
  MAX_POLLS: 40, // Tambah polling count
  POLL_INTERVAL: 1500, // Naikkan interval
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ]
};

// State untuk tracking progress per user
const userStates = new Map();

// Logger sederhana
const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`)
};

function getUA() {
  return CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];
}

function sanitizeFilename(name) {
  const clean = name.replace(/[^\w\s.-]/gi, '').trim().substring(0, 100);
  return clean || 'audio';
}

async function getVideoTitle(url) {
  try {
    const videoId = url.match(/(?:v=|\/|shorts\/)([a-zA-Z0-9_-]{11})/)[1];
    const response = await axios.get(`https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`, { 
      timeout: 5000 
    });
    return response.data?.title || `audio_${Date.now()}`;
  } catch (err) {
    return `audio_${Date.now()}`;
  }
}

// Fungsi delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi utama konversi dengan retry mechanism (MP3)
async function ytmp3(url, retryCount = 0) {
  log.debug(`Processing URL (MP3): ${url} (Attempt ${retryCount + 1}/3)`);
  
  try {
    const match = url.match(/(?:v=|\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];

    // Buat session baru setiap kali - PENTING!
    const jar = new tough.CookieJar();
    
    // Headers yang lebih lengkap seperti browser asli
    const headers = {
      'User-Agent': getUA(),
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Referer': 'https://ytmp3.mobi/',
      'Origin': 'https://ytmp3.mobi',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    };

    const client = wrapper(axios.create({
      jar,
      timeout: CONFIG.TIMEOUT,
      maxRedirects: 5,
      headers
    }));

    // Step 1: Init session
    log.debug('Step 1: Initializing session...');
    const initUrl = 'https://a.ymcdn.org/api/v1/init';
    const init = await client.get(initUrl, {
      params: { 
        p: 'y', 
        '23': '1llum1n471', 
        _: Date.now() 
      }
    });
    
    if (init.data.error) throw new Error(init.data.error);
    if (!init.data.convertURL) throw new Error('Gagal inisialisasi - no convertURL');
    
    log.debug('Session initialized successfully');
    
    // Delay kecil sebelum request berikutnya
    await delay(500);

    // Step 2: Convert request
    log.debug('Step 2: Sending convert request...');
    const convert = await client.get(init.data.convertURL, {
      params: { 
        v: videoId, 
        f: 'mp3', 
        _: Date.now() 
      }
    });
    
    log.debug(`Convert response: ${JSON.stringify(convert.data)}`);
    
    if (convert.data.error && convert.data.error !== 'in_progress') {
      throw new Error(convert.data.error);
    }

    // Cek apakah langsung dapat download URL
    if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
      log.debug('Got direct download URL');
      const title = await getVideoTitle(url);
      return { downloadUrl: convert.data.downloadURL, title };
    }

    // Step 3: Polling progress
    if (convert.data.progressURL) {
      log.debug('Step 3: Starting polling...');
      let polls = 0;
      
      while (polls < CONFIG.MAX_POLLS) {
        polls++;
        
        try {
          const prog = await client.get(convert.data.progressURL, {
            headers: {
              'Referer': 'https://ytmp3.mobi/',
              'Origin': 'https://ytmp3.mobi'
            }
          });
          
          const progressData = prog.data;
          log.debug(`Poll ${polls}: progress=${progressData.progress}, hasURL=${!!progressData.downloadURL}`);
          
          if (progressData.downloadURL && progressData.downloadURL !== '#') {
            const title = await getVideoTitle(url);
            return { downloadUrl: progressData.downloadURL, title };
          }
          
          if (progressData.error && progressData.error !== 'in_progress') {
            throw new Error(progressData.error);
          }
          
        } catch (err) {
          log.debug(`Poll error: ${err.message}`);
          
          // Jika 404, mungkin URL sudah expired, coba ambil dari data awal
          if (err.response?.status === 404) {
            if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
              const title = await getVideoTitle(url);
              return { downloadUrl: convert.data.downloadURL, title };
            }
          }
          
          // Error lain saat polling, lanjutkan tapi dengan delay lebih lama
          await delay(1000);
        }
        
        await delay(CONFIG.POLL_INTERVAL);
      }
      
      throw new Error('Timeout - konversi terlalu lama');
    }
    
    throw new Error('Gagal mendapatkan link download');

  } catch (err) {
    log.error(`Conversion error (MP3): ${err.message}`);
    
    // Retry mechanism
    if (retryCount < 2) {
      log.info(`Retrying MP3 conversion... (${retryCount + 2}/3)`);
      await delay(2000);
      return ytmp3(url, retryCount + 1);
    }
    
    throw err;
  }
}

// Fungsi utama konversi MP4 dengan retry mechanism
async function ytmp4(url, retryCount = 0) {
  log.debug(`Processing URL (MP4): ${url} (Attempt ${retryCount + 1}/3)`);
  
  try {
    const match = url.match(/(?:v=|\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];

    // Buat session baru setiap kali - PENTING!
    const jar = new tough.CookieJar();
    
    // Headers yang lebih lengkap seperti browser asli
    const headers = {
      'User-Agent': getUA(),
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
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
      timeout: CONFIG.TIMEOUT,
      maxRedirects: 5,
      headers
    }));

    // Step 1: Init session
    log.debug('Step 1: Initializing session for MP4...');
    const initUrl = 'https://a.ymcdn.org/api/v1/init';
    const init = await client.get(initUrl, {
      params: { 
        p: 'y', 
        '23': '1llum1n471', 
        _: Date.now() 
      }
    });
    
    if (init.data.error) throw new Error(init.data.error);
    if (!init.data.convertURL) throw new Error('Gagal inisialisasi - no convertURL');
    
    log.debug('Session initialized successfully for MP4');
    
    // Delay kecil sebelum request berikutnya
    await delay(500);

    // Step 2: Convert request for MP4
    log.debug('Step 2: Sending convert request for MP4...');
    const convert = await client.get(init.data.convertURL, {
      params: { 
        v: videoId, 
        f: 'mp4', 
        _: Date.now() 
      }
    });
    
    log.debug(`Convert response (MP4): ${JSON.stringify(convert.data)}`);
    
    if (convert.data.error && convert.data.error !== 'in_progress') {
      throw new Error(convert.data.error);
    }

    // Cek apakah langsung dapat download URL
    if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
      log.debug('Got direct download URL for MP4');
      const title = await getVideoTitle(url);
      return { downloadUrl: convert.data.downloadURL, title };
    }

    // Step 3: Polling progress
    if (convert.data.progressURL) {
      log.debug('Step 3: Starting polling for MP4...');
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
          log.debug(`Poll ${polls} (MP4): progress=${progressData.progress}, hasURL=${!!progressData.downloadURL}`);
          
          if (progressData.downloadURL && progressData.downloadURL !== '#') {
            const title = await getVideoTitle(url);
            return { downloadUrl: progressData.downloadURL, title };
          }
          
          if (progressData.error && progressData.error !== 'in_progress') {
            throw new Error(progressData.error);
          }
          
        } catch (err) {
          log.debug(`Poll error (MP4): ${err.message}`);
          
          // Jika 404, mungkin URL sudah expired, coba ambil dari data awal
          if (err.response?.status === 404) {
            if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
              const title = await getVideoTitle(url);
              return { downloadUrl: convert.data.downloadURL, title };
            }
          }
          
          // Error lain saat polling, lanjutkan tapi dengan delay lebih lama
          await delay(1000);
        }
        
        await delay(CONFIG.POLL_INTERVAL);
      }
      
      throw new Error('Timeout - konversi MP4 terlalu lama');
    }
    
    throw new Error('Gagal mendapatkan link download MP4');

  } catch (err) {
    log.error(`Conversion error (MP4): ${err.message}`);
    
    // Retry mechanism
    if (retryCount < 2) {
      log.info(`Retrying MP4 conversion... (${retryCount + 2}/3)`);
      await delay(2000);
      return ytmp4(url, retryCount + 1);
    }
    
    throw err;
  }
}

// Inisialisasi bot dengan token dari environment variable
const bot = new Telegraf(process.env.BOT_TOKEN);

// Middleware untuk logging
bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log.info(`${ctx.from?.first_name || 'User'}: ${ctx.message?.text || ctx.callbackQuery?.data || 'Interaction'} (${ms}ms)`);
});

// Command /start
bot.start((ctx) => {
  const welcomeMessage = `
🎵 *YouTube to MP3/MP4 Bot* 🎵

Halo ${ctx.from.first_name || 'Kak'}!

Kirimkan link YouTube, bot akan memberikan link download.

*Fitur:*
• Konversi YouTube ke MP3
• Konversi YouTube ke MP4
• Link download langsung
• Tanpa batasan durasi
• Gratis!

*Cara penggunaan:*
1. Copy link YouTube
2. Kirim link ke bot ini
3. Pilih format yang diinginkan (MP3 atau MP4)
4. Tunggu proses konversi
5. Dapatkan link download

Kirim link YouTube sekarang! 🚀
  `;
  
  ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

// Command /help
bot.help((ctx) => {
  ctx.reply(
    '📖 *Bantuan*\n\n' +
    'Kirimkan link YouTube untuk mendapatkan link download.\n\n' +
    '*Contoh link:*\n' +
    '• https://youtube.com/watch?v=xxxxx\n' +
    '• https://youtu.be/xxxxx\n' +
    '• https://youtube.com/shorts/xxxxx\n\n' +
    '*Perintah:*\n' +
    '/start - Mulai bot\n' +
    '/help - Bantuan\n' +
    '/status - Cek status proses\n' +
    '/mp3 - Konversi ke MP3 (audio)\n' +
    '/mp4 - Konversi ke MP4 (video)',
    { parse_mode: 'Markdown' }
  );
});

// Command /status
bot.command('status', (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (state) {
    ctx.reply(`⏳ Sedang memproses: ${state.url} (Format: ${state.format || 'MP3'})`);
  } else {
    ctx.reply('✅ Tidak ada proses yang sedang berjalan');
  }
});

// Command /mp3
bot.command('mp3', (ctx) => {
  ctx.reply('🎵 Kirimkan link YouTube untuk dikonversi ke MP3 (audio).');
});

// Command /mp4
bot.command('mp4', (ctx) => {
  ctx.reply('🎬 Kirimkan link YouTube untuk dikonversi ke MP4 (video).');
});

// Handler untuk pesan teks (link YouTube)
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text.trim();
  
  // Cek apakah user sedang dalam proses
  if (userStates.has(userId)) {
    ctx.reply('⏳ Mohon tunggu, proses sebelumnya masih berjalan...');
    return;
  }
  
  // Cek apakah pesan mengandung URL YouTube
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = messageText.match(youtubeRegex);
  
  if (!match) {
    ctx.reply('❌ Mohon kirim link YouTube yang valid.\n\nContoh: https://youtube.com/watch?v=xxxxx');
    return;
  }
  
  const url = messageText;
  
  // Tampilkan pilihan format
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🎵 MP3 (Audio)', callback_data: `mp3_${url}` },
          { text: '🎬 MP4 (Video)', callback_data: `mp4_${url}` }
        ]
      ]
    }
  };
  
  await ctx.reply('Pilih format yang diinginkan:', keyboard);
});

// Handler untuk callback query (pilihan format)
bot.on('callback_query', async (ctx) => {
  const userId = ctx.from.id;
  const callbackData = ctx.callbackQuery.data;
  
  // Cek apakah user sedang dalam proses
  if (userStates.has(userId)) {
    await ctx.answerCbQuery('⏳ Mohon tunggu, proses sebelumnya masih berjalan...');
    return;
  }
  
  // Parse callback data
  const [format, url] = callbackData.split('_');
  
  if (!format || !url) {
    await ctx.answerCbQuery('Format tidak valid');
    return;
  }
  
  try {
    // Set state processing
    userStates.set(userId, { url, format, startTime: Date.now() });
    
    await ctx.answerCbQuery(`Memproses konversi ke ${format.toUpperCase()}...`);
    
    // Kirim pesan loading
    const loadingMsg = await ctx.reply('🔍 Menganalisa link YouTube...');
    
    // Update progress
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      '⚙️ Menghubungkan ke server konversi...'
    );
    
    // Proses konversi berdasarkan format
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      `🔄 Mengkonversi video ke ${format.toUpperCase()}...\n\n⏳ Ini mungkin memakan waktu 15-45 detik.`
    );
    
    let result;
    if (format === 'mp3') {
      result = await ytmp3(url);
    } else if (format === 'mp4') {
      result = await ytmp4(url);
    } else {
      throw new Error('Format tidak didukung');
    }
    
    if (!result || !result.downloadUrl) {
      throw new Error('Gagal mendapatkan link download');
    }
    
    // Hapus pesan loading
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    
    // Kirim link download
    const title = result.title || 'Media';
    const extension = format === 'mp3' ? 'mp3' : 'mp4';
    const filename = sanitizeFilename(title) + '.' + extension;
    const formatEmoji = format === 'mp3' ? '🎵' : '🎬';
    const formatName = format === 'mp3' ? 'MP3 (Audio)' : 'MP4 (Video)';
    
    const successMessage = 
      `✅ *Konversi Berhasil!*\n\n` +
      `${formatEmoji} *Format:* ${formatName}\n` +
      `🎵 *Judul:* ${title}\n` +
      `📁 *File:* ${filename}\n\n` +
      `🔗 *Link Download:*\n` +
      `[Klik di sini untuk download](${result.downloadUrl})\n\n` +
      `⚠️ *Penting:*\n` +
      `• Link hanya berlaku beberapa menit\n` +
      `• Jika error "code: 2-1", link sudah expired\n` +
      `• Kirim ulang link YouTube untuk dapat link baru`;
    
    await ctx.reply(successMessage, { 
      parse_mode: 'Markdown', 
      disable_web_page_preview: false 
    });
    
    // Clear state
    userStates.delete(userId);
    
  } catch (err) {
    // Clear state
    userStates.delete(userId);
    
    log.error(`Error for user ${userId}: ${err.message}`);
    
    let errorMessage = '❌ *Gagal memproses link*\n\n';
    
    if (err.message.includes('URL YouTube tidak valid')) {
      errorMessage += 'Link YouTube tidak valid.';
    } else if (err.message.includes('Timeout')) {
      errorMessage += 'Proses konversi terlalu lama. Silakan coba lagi.';
    } else if (err.message.includes('Video tidak ditemukan')) {
      errorMessage += 'Video tidak ditemukan. Periksa kembali linknya.';
    } else {
      errorMessage += `Silakan coba lagi dengan video lain.\n\n_Error: ${err.message}_`;
    }
    
    await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
  }
});

// Error handler
bot.catch((err, ctx) => {
  log.error(`Bot error: ${err}`);
  ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.').catch(() => {});
});

// Vercel serverless handler
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } catch (err) {
      log.error(`Webhook error: ${err}`);
      res.status(500).send('Error');
    }
  } else {
    res.status(200).send('YouTube to MP3/MP4 Bot is running!');
  }
};

// Untuk development local
if (require.main === module) {
  log.info('Starting bot in polling mode...');
  bot.launch();
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}