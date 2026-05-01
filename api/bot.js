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

const STATIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const log = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`)
};

// FIX: Fungsi escape yang lebih kuat untuk MarkdownV2
function escapeMarkdownV2(text) {
  if (!text) return '';
  return text.toString().replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

async function isRateLimited(userId) {
  if (!redis) return false;
  try {
    const key = `ratelimit:${userId}`;
    const currentUsage = await redis.incr(key);
    if (currentUsage === 1) await redis.expire(key, 60);
    return currentUsage > 10;
  } catch (err) {
    return false;
  }
}

async function getRateLimitTTL(userId) {
  if (!redis) return 0;
  try {
    return await redis.ttl(`ratelimit:${userId}`);
  } catch (err) {
    return 0;
  }
}

async function setUserState(userId, state) {
  if (!redis) return;
  try {
    await redis.set(`user:state:${userId}`, state, { ex: CONFIG.STATE_TTL });
  } catch (err) {
    log.error(`State save error: ${err.message}`);
  }
}

async function getUserState(userId) {
  if (!redis) return null;
  try {
    const data = await redis.get(`user:state:${userId}`);
    if (!data) return null;
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch (err) {
    return null;
  }
}

async function deleteUserState(userId) {
  if (redis) await redis.del(`user:state:${userId}`);
}

// FIX: Perbaikan Template Literal ${videoId}
async function getVideoTitle(url) {
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) return `video_${Date.now()}`;
    const videoId = match[1];
    // Menggunakan NoEmbed karena lebih stabil untuk Vercel
    const response = await axios.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`, { timeout: 5000 });
    return response.data?.title || `video_${Date.now()}`;
  } catch (err) {
    return `video_${Date.now()}`;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ytmp(url, format = 'mp3', retryCount = 0) {
  const backend = '.ymcdn.org';
  try {
    const match = url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    const videoId = match[1];
    const jar = new tough.CookieJar();
    const headers = {
      'User-Agent': STATIC_UA,
      'Referer': 'https://id.ytmp3.mobi/v1/',
      'Origin': 'https://id.ytmp3.mobi/v1'
    };
    const client = wrapper(axios.create({ jar, timeout: CONFIG.TIMEOUT, headers }));

    const init = await client.get(`https://a${backend}/api/v1/init`, {
      params: { p: 'y', '23': '1llum1n471', _: Math.random() }
    });

    const convert = await client.get(`${init.data.convertURL}&v=${videoId}&f=${format}&=${Math.random()}`);
    
    let polls = 0;
    while (polls < CONFIG.MAX_POLLS) {
      polls++;
      await delay(CONFIG.POLL_INTERVAL);
      const prog = await client.get(convert.data.progressURL);
      if (prog.data.progress >= 3) {
        const title = await getVideoTitle(url);
        return { downloadUrl: convert.data.downloadURL, title, format };
      }
    }
    throw new Error('Timeout');
  } catch (err) {
    if (retryCount < CONFIG.MAX_RETRIES) return ytmp(url, format, retryCount + 1);
    throw err;
  }
}

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('🎬 *YouTube Downloader*\nKirim link YouTube untuk memulai\\.', { parse_mode: 'MarkdownV2' }));

bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const url = ctx.message.text.trim();
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  
  if (!youtubeRegex.test(url)) return ctx.reply('❌ Link tidak valid\\.');
  
  const limited = await isRateLimited(userId);
  if (limited) return ctx.reply('🚦 Rate limit reached\\. Tunggu sebentar\\.');

  await setUserState(userId, { url, step: 'choose_format' });
  await ctx.reply('🎬 *Pilih format:*', Markup.inlineKeyboard([
    [Markup.button.callback('🎵 MP3', 'format_mp3'), Markup.button.callback('🎬 MP4', 'format_mp4')]
  ]));
});

bot.action(/format_(mp3|mp4)/, async (ctx) => {
  const format = ctx.match[1];
  const userId = ctx.from.id;
  const state = await getUserState(userId);
  
  if (!state) return ctx.answerCbQuery('Sesi expired!');
  
  await ctx.answerCbQuery(`Memproses ${format.toUpperCase()}...`);
  await ctx.editMessageText('⏳ Sedang mengkonversi...');

  try {
    const result = await ytmp(state.url, format);
    const escapedTitle = escapeMarkdownV2(result.title);
    const escapedUrl = escapeMarkdownV2(result.downloadUrl);

    const msg = `✅ *Konversi Berhasil\\!*\n\n📝 *Judul:* ${escapedTitle}\n🎚️ *Format:* ${format.toUpperCase()}\n\n🔗 *LINK DOWNLOAD:* \n${escapedUrl}\n\n⚠️ _Klik link di atas untuk memutar atau unduh langsung\\._`;

    const videoId = state.url.match(/(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/)[1];
    
    await ctx.deleteMessage();
    await ctx.replyWithPhoto(`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, {
      caption: msg,
      parse_mode: 'MarkdownV2'
    });

  } catch (err) {
    log.error(err.message);
    ctx.reply('❌ Gagal memproses link\\. Silakan coba lagi\\.');
  } finally {
    await deleteUserState(userId);
  }
});

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } else {
    res.status(200).send('Bot is running');
  }
};
