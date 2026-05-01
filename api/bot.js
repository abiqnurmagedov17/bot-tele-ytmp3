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
  STATE_TTL: 2 * 60
};

// STATIC USER AGENT: Sangat penting agar audio tidak terputus/korup
const STATIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`)
};

// Helper untuk Redis State
async function setUserState(userId, state) {
  if (redis) await redis.set(`user:state:${userId}`, state, { ex: CONFIG.STATE_TTL });
}

async function getUserState(userId) {
  if (!redis) return null;
  const data = await redis.get(`user:state:${userId}`);
  return data ? (typeof data === 'string' ? JSON.parse(data) : data) : null;
}

async function deleteUserState(userId) {
  if (redis) await redis.del(`user:state:${userId}`);
}

async function isRateLimited(userId) {
  if (!redis) return false;
  const key = `ratelimit:${userId}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, 60);
  return current > 10;
}

// Fungsi Ambil Judul Video
async function getVideoTitle(url) {
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) return `video_${Date.now()}`;
    const videoId = match[1];
    // Memperbaiki typo link title
    const response = await axios.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`, { timeout: 5000 });
    return response.data?.title || `video_${Date.now()}`;
  } catch (err) {
    return `video_${Date.now()}`;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi Inti Konversi
async function ytmp(url, format = 'mp3', retryCount = 0) {
  const backend = '.ymcdn.org';
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = match[1];
    const jar = new tough.CookieJar();
    
    // Header Konsisten
    const headers = {
      'User-Agent': STATIC_UA,
      'Accept': '*/*',
      'Referer': 'https://id.ytmp3.mobi/v1/',
      'Origin': 'https://id.ytmp3.mobi/v1'
    };
    
    const client = wrapper(axios.create({ jar, timeout: CONFIG.TIMEOUT, headers }));

    // STEP 1: Init
    const init = await client.get(`https://a${backend}/api/v1/init`, {
      params: { p: 'y', '23': '1llum1n471', _: Math.random() }
    });

    // STEP 2: Convert
    const convertUrl = `${init.data.convertURL}&v=${videoId}&f=${format}&=${Math.random()}`;
    const convert = await client.get(convertUrl);
    
    let polls = 0;
    while (polls < CONFIG.MAX_POLLS) {
      polls++;
      await delay(CONFIG.POLL_INTERVAL);
      const prog = await client.get(convert.data.progressURL);
      
      if (prog.data.progress >= 3) {
        const title = await getVideoTitle(url);
        return { downloadUrl: convert.data.downloadURL, title, format };
      }
      if (prog.data.error) throw new Error(`API_Error_${prog.data.error}`);
    }
    throw new Error('Timeout');
  } catch (err) {
    if (retryCount < CONFIG.MAX_RETRIES) return ytmp(url, format, retryCount + 1);
    throw err;
  }
}

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('🎬 *YouTube Downloader*\nKirimkan link YouTube untuk memulai.'));

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const url = ctx.message.text.trim();
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  
  if (!youtubeRegex.test(url)) return ctx.reply('❌ Link YouTube tidak valid.');
  if (await isRateLimited(userId)) return ctx.reply('🚦 Terlalu banyak permintaan. Tunggu 1 menit.');

  await setUserState(userId, { url, step: 'choose' });
  await ctx.reply('🎬 *Pilih Format:*', Markup.inlineKeyboard([
    [Markup.button.callback('🎵 MP3', 'f_mp3'), Markup.button.callback('🎬 MP4', 'f_mp4')],
    [Markup.button.callback('❌ Batal', 'f_cancel')]
  ]));
});

bot.action(/f_(mp3|mp4)/, async (ctx) => {
  const format = ctx.match[1];
  const userId = ctx.from.id;
  const state = await getUserState(userId);
  
  if (!state) return ctx.answerCbQuery('Sesi berakhir!');
  
  await ctx.answerCbQuery(`Memproses ${format.toUpperCase()}...`);
  const loading = await ctx.editMessageText('⏳ Sedang memproses konversi, mohon tunggu...');

  try {
    const result = await ytmp(state.url, format);
    const videoId = state.url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)[1];
    
    const caption = `
✅ *Konversi Berhasil!*

📝 *Judul:* ${result.title}
🎚️ *Format:* ${format.toUpperCase()}

⚠️ _Link cepat expired (30-60 detik). Segera download!_`;

    await ctx.deleteMessage(loading.message_id);
    await ctx.replyWithPhoto(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, {
      caption: caption,
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url(`📥 DOWNLOAD ${format.toUpperCase()}`, result.downloadUrl)],
        [Markup.button.callback('🔄 Download Lagi', 'f_retry')]
      ])
    });

  } catch (err) {
    log.error(err.message);
    ctx.reply('❌ Gagal mengkonversi video. Server sedang sibuk.');
  } finally {
    await deleteUserState(userId);
  }
});

bot.action('f_cancel', async (ctx) => {
  await deleteUserState(ctx.from.id);
  await ctx.editMessageText('❌ Proses dibatalkan.');
});

bot.action('f_retry', async (ctx) => {
  await ctx.answerCbQuery('Kirim link YouTube kembali untuk mengulang.');
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } else {
    res.status(200).send('Bot is running');
  }
};
