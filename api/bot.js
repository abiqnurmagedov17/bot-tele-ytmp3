const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');

const CONFIG = {
  TIMEOUT: 30000,
  MAX_POLLS: 40,
  POLL_INTERVAL: 1500,
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
  ]
};

const userStates = new Map();

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
  return clean || 'video';
}

function makeUniqueUrl(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /(?:v=|\/|shorts\/)([a-zA-Z0-9_-]{11})/
  ];
  
  let videoId = null;
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      videoId = match[1];
      break;
    }
  }
  
  if (!videoId) return url;
  
  const uniqueParam = `cacheBuster=${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  
  if (url.includes('youtu.be/')) {
    return `https://youtu.be/${videoId}?${uniqueParam}`;
  } else if (url.includes('shorts/')) {
    return `https://youtube.com/shorts/${videoId}?${uniqueParam}`;
  } else {
    return `https://youtube.com/watch?v=${videoId}&${uniqueParam}`;
  }
}

async function getVideoTitle(url) {
  try {
    const videoId = url.match(/(?:v=|\/|shorts\/)([a-zA-Z0-9_-]{11})/)[1];
    const response = await axios.get(`https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`, { 
      timeout: 5000 
    });
    return response.data?.title || `video_${Date.now()}`;
  } catch (err) {
    return `video_${Date.now()}`;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ytmp3(url, format = 'mp3', retryCount = 0) {
  const uniqueUrl = makeUniqueUrl(url);
  log.debug(`Processing URL: ${uniqueUrl} | Format: ${format} | Attempt ${retryCount + 1}/3`);
  
  try {
    const match = uniqueUrl.match(/(?:v=|\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];

    const jar = new tough.CookieJar();
    
    const headers = {
      'User-Agent': getUA(),
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Referer': 'https://ytmp3.mobi/en8/',
      'Origin': 'https://ytmp3.mobi',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    };

    const client = wrapper(axios.create({
      jar,
      timeout: CONFIG.TIMEOUT,
      maxRedirects: 5,
      headers
    }));

    log.debug('Step 1: Initializing session...');
    const initUrl = 'https://a.ymcdn.org/api/v1/init';
    const init = await client.get(initUrl, {
      params: { 
        p: 'y', 
        '23': '1llum1n471', 
        _: Date.now(),
        r: Math.random().toString(36).substring(2, 15)
      }
    });
    
    if (init.data.error) throw new Error(init.data.error);
    if (!init.data.convertURL) throw new Error('Gagal inisialisasi - no convertURL');
    
    log.debug('Session initialized successfully');
    
    await delay(800);

    log.debug(`Step 2: Sending convert request (${format})...`);
    const convert = await client.get(init.data.convertURL, {
      params: { 
        v: videoId, 
        f: format,
        _: Date.now() 
      }
    });
    
    log.debug(`Convert response: ${JSON.stringify(convert.data).substring(0, 200)}...`);
    
    if (convert.data.error && convert.data.error !== 'in_progress') {
      throw new Error(convert.data.error);
    }

    if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
      log.debug('Got direct download URL');
      const title = await getVideoTitle(url);
      return { downloadUrl: convert.data.downloadURL, title, format };
    }

    if (convert.data.progressURL) {
      log.debug('Step 3: Starting polling...');
      let polls = 0;
      
      while (polls < CONFIG.MAX_POLLS) {
        polls++;
        
        try {
          const prog = await client.get(convert.data.progressURL, {
            headers: {
              'Referer': 'https://ytmp3.mobi/en8/',
              'Origin': 'https://ytmp3.mobi'
            }
          });
          
          const progressData = prog.data;
          log.debug(`Poll ${polls}: progress=${progressData.progress}, hasURL=${!!progressData.downloadURL}`);
          
          if (progressData.downloadURL && progressData.downloadURL !== '#') {
            const title = await getVideoTitle(url);
            return { downloadUrl: progressData.downloadURL, title, format };
          }
          
          if (progressData.error && progressData.error !== 'in_progress') {
            throw new Error(progressData.error);
          }
          
        } catch (err) {
          log.debug(`Poll error: ${err.message}`);
          
          if (err.response?.status === 404) {
            if (convert.data.downloadURL && convert.data.downloadURL !== '#') {
              const title = await getVideoTitle(url);
              return { downloadUrl: convert.data.downloadURL, title, format };
            }
          }
          
          await delay(1000);
        }
        
        await delay(CONFIG.POLL_INTERVAL);
      }
      
      throw new Error('Timeout - konversi terlalu lama');
    }
    
    throw new Error('Gagal mendapatkan link download');

  } catch (err) {
    log.error(`Conversion error: ${err.message}`);
    
    if (retryCount < 2) {
      log.info(`Retrying conversion... (${retryCount + 2}/3)`);
      await delay(2000);
      return ytmp3(url, format, retryCount + 1);
    }
    
    throw err;
  }
}

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  log.info(`${ctx.from?.first_name || 'User'}: ${ctx.message?.text || ctx.callbackQuery?.data || 'Interaction'} (${ms}ms)`);
});

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
    '/status - Cek status proses',
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (state) {
    ctx.reply(`⏳ Sedang memproses: ${state.url} (${state.format || 'mp3'})`);
  } else {
    ctx.reply('✅ Tidak ada proses yang sedang berjalan');
  }
});

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const messageText = ctx.message.text.trim();
  
  if (userStates.has(userId)) {
    ctx.reply('⏳ Mohon tunggu, proses sebelumnya masih berjalan...');
    return;
  }
  
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = messageText.match(youtubeRegex);
  
  if (!match) {
    ctx.reply('❌ Mohon kirim link YouTube yang valid.\n\nContoh: https://youtube.com/watch?v=xxxxx');
    return;
  }
  
  const url = messageText;
  
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

bot.action('format_mp3', async (ctx) => {
  await processFormat(ctx, 'mp3');
});

bot.action('format_mp4', async (ctx) => {
  await processFormat(ctx, 'mp4');
});

bot.action('format_cancel', async (ctx) => {
  const userId = ctx.from.id;
  userStates.delete(userId);
  await ctx.editMessageText('❌ Proses dibatalkan.');
});

async function processFormat(ctx, format) {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (!state || state.step !== 'choose_format') {
    await ctx.editMessageText('⏰ Sesi telah berakhir. Kirim link YouTube lagi.');
    userStates.delete(userId);
    return;
  }
  
  const url = state.url;
  const formatName = format === 'mp3' ? 'MP3 (Audio)' : 'MP4 (Video)';
  
  userStates.set(userId, { url, format, step: 'processing', startTime: Date.now() });
  
  try {
    await ctx.editMessageText(`🔍 Menganalisa link YouTube...\nFormat: ${formatName}`);
    
    const loadingMsg = ctx.callbackQuery.message;
    
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      `⚙️ Menghubungkan ke server konversi...\nFormat: ${formatName}`
    );
    
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      null,
      `🔄 Mengkonversi video ke ${formatName}...\n\n⏳ Ini mungkin memakan waktu 15-45 detik.`
    );
    
    const result = await ytmp3(url, format);
    
    if (!result || !result.downloadUrl) {
      throw new Error('Gagal mendapatkan link download');
    }
    
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    
    const title = result.title || (format === 'mp3' ? 'Audio' : 'Video');
    const extension = format === 'mp3' ? '.mp3' : '.mp4';
    const filename = sanitizeFilename(title) + extension;
    
    const emoji = format === 'mp3' ? '🎵' : '🎬';
    const typeText = format === 'mp3' ? 'Audio' : 'Video';
    
    const successMessage = 
      `${emoji} *Konversi Berhasil!*\n\n` +
      `📝 *Judul:* ${title}\n` +
      `📁 *File:* ${filename}\n` +
      `🎚️ *Format:* ${typeText}\n\n` +
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
    
  } catch (err) {
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
  } finally {
    userStates.delete(userId);
  }
}

bot.catch((err, ctx) => {
  log.error(`Bot error: ${err}`);
  ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.').catch(() => {});
});

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
    res.status(200).send('YouTube Downloader Bot is running!');
  }
};

if (require.main === module) {
  log.info('Starting bot in polling mode...');
  bot.launch();
  
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}