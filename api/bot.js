const { Telegraf } = require('telegraf');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');

// Konfigurasi
const CONFIG = {
  TIMEOUT: 30000,
  MAX_POLLS: 30,
  POLL_INTERVAL: 1000,
  USER_AGENTS: [
    'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
    'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36',
    'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
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

// Fungsi utama konversi - setiap panggilan buat session baru
async function ytmp3(url) {
  log.debug(`Processing URL: ${url}`);
  
  try {
    const match = url.match(/(?:v=|\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];

    // Buat session baru setiap kali
    const jar = new tough.CookieJar();
    const client = wrapper(axios.create({
      jar,
      timeout: CONFIG.TIMEOUT,
      maxRedirects: 5,
      headers: {
        'User-Agent': getUA(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9',
        'Connection': 'keep-alive',
        'Referer': 'https://id.ytmp3.mobi/v1/',
        'Origin': 'https://id.ytmp3.mobi'
      }
    }));

    const init = await client.get('https://a.ymcdn.org/api/v1/init', {
      params: { p: 'y', '23': '1llum1n471', _: Math.random() }
    });
    
    if (init.data.error) throw new Error(init.data.error);
    if (!init.data.convertURL) throw new Error('Gagal inisialisasi');

    const convert = await client.get(init.data.convertURL, {
      params: { v: videoId, f: 'mp3', _: Math.random() }
    });
    
    if (convert.data.error && convert.data.error !== 'in_progress') {
      throw new Error(convert.data.error);
    }

    if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
      const title = await getVideoTitle(url);
      return { downloadUrl: convert.data.downloadURL, title };
    }

    if (convert.data.progressURL) {
      let polls = 0;
      
      while (polls < CONFIG.MAX_POLLS) {
        polls++;
        
        try {
          const prog = await client.get(convert.data.progressURL);
          const progressData = prog.data;
          
          if (progressData.downloadURL && progressData.downloadURL !== '#') {
            const title = await getVideoTitle(url);
            return { downloadUrl: progressData.downloadURL, title };
          }
          
          if (progressData.error && progressData.error !== 'in_progress') {
            throw new Error(progressData.error);
          }
          
        } catch (err) {
          if (err.response?.status === 404) {
            if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
              const title = await getVideoTitle(url);
              return { downloadUrl: convert.data.downloadURL, title };
            }
          }
          // Skip error lain saat polling, lanjutkan
        }
        
        await new Promise(r => setTimeout(r, CONFIG.POLL_INTERVAL));
      }
      
      throw new Error('Timeout - konversi terlalu lama');
    }
    
    throw new Error('Gagal mendapatkan link download');

  } catch (err) {
    log.error(`Conversion error: ${err.message}`);
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
🎵 *YouTube to MP3 Bot* 🎵

Halo ${ctx.from.first_name || 'Kak'}!

Kirimkan link YouTube, bot akan memberikan link download MP3.

*Fitur:*
• Konversi YouTube ke MP3
• Link download langsung
• Tanpa batasan durasi
• Gratis!

*Cara penggunaan:*
1. Copy link YouTube
2. Kirim link ke bot ini
3. Tunggu proses konversi
4. Dapatkan link download MP3

Kirim link YouTube sekarang! 🚀
  `;
  
  ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

// Command /help
bot.help((ctx) => {
  ctx.reply(
    '📖 *Bantuan*\n\n' +
    'Kirimkan link YouTube untuk mendapatkan link download MP3.\n\n' +
    '*Contoh link:*\n' +
    '• https://youtube.com/watch?v=xxxxx\n' +
    '• https://youtu.be/xxxxx\n' +
    '• https://youtube.com/shorts/xxxxx\n\n' +
    '*Perintah:*\n' +
    '/start - Mulai bot\n' +
    '/help - Bantuan\n' +
    '/status - Cek status proses',
    { parse_mode: 'Markdown' }
  );
});

// Command /status
bot.command('status', (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (state) {
    ctx.reply(`⏳ Sedang memproses: ${state.url}`);
  } else {
    ctx.reply('✅ Tidak ada proses yang sedang berjalan');
  }
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
  
  try {
    // Set state processing
    userStates.set(userId, { url, startTime: Date.now() });
    
    // Kirim pesan loading
    const loadingMsg = await ctx.reply('🔍 Menganalisa link YouTube...');
    
    // Update progress
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      '⚙️ Menghubungkan ke server konversi...'
    );
    
    // Proses konversi
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      '🔄 Mengkonversi video ke MP3...\n\n⏳ Ini mungkin memakan waktu 10-30 detik.'
    );
    
    const result = await ytmp3(url);
    
    if (!result || !result.downloadUrl) {
      throw new Error('Gagal mendapatkan link download');
    }
    
    // Hapus pesan loading
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    
    // Kirim link download
    const title = result.title || 'Audio';
    const filename = sanitizeFilename(title) + '.mp3';
    
    const successMessage = 
      `✅ *Konversi Berhasil!*\n\n` +
      `🎵 *Judul:* ${title}\n` +
      `📁 *File:* ${filename}\n\n` +
      `🔗 *Link Download:*\n` +
      `[Klik di sini untuk download](${result.downloadUrl})\n\n` +
      `⚠️ *Penting:*\n` +
      `• Link berlaku ~1 jam\n` +
      `• Jika link expired, kirim ulang link YouTube\n` +
      `• Gunakan browser atau download manager`;
    
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
    } else if (err.message.includes('410') || err.message.includes('expired')) {
      errorMessage += 'Link download expired. Silakan kirim ulang link YouTube untuk konversi baru.';
    } else {
      errorMessage += `*Error:* ${err.message}\n\nSilakan coba lagi nanti atau coba video lain.`;
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
    res.status(200).send('YouTube to MP3 Bot is running!');
  }
};

// Untuk development local
if (require.main === module) {
  log.info('Starting bot in polling mode...');
  bot.launch();
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}