
## 🛠️ Teknologi yang Digunakan

| Teknologi | Deskripsi |
|-----------|-----------|
| [Node.js](https://nodejs.org/) | JavaScript runtime environment |
| [Telegraf](https://telegraf.js.org/) | Framework bot Telegram modern |
| [Axios](https://axios-http.com/) | HTTP client untuk request API |
| [NodeCache](https://www.npmjs.com/package/node-cache) | In-memory caching untuk performa |
| [Pino](https://getpino.io/) | Structured logging yang performant |
| [Vercel](https://vercel.com/) | Platform serverless hosting |
| [ytmp3.mobi API](https://ytmp3.mobi/) | Third-party scraping API |

---

## 📦 Deploy Sendiri

### ✅ Prasyarat

- [Node.js](https://nodejs.org/) v18 atau lebih baru
- [Git](https://git-scm.com/) terinstall
- Akun [Vercel](https://vercel.com/)
- Bot Token dari [@BotFather](https://t.me/BotFather)

### 📋 Langkah-Langkah

1. **Clone Repository**
```bash
git clone https://github.com/abiqnurmagedov17/bot-tele-ytmp3.git
cd bot-tele-ytmp3
```

2. **Install Dependencies**
```bash
npm install
```

3. **Install Vercel CLI (Opsional)**
```bash
npm install -g vercel
```

4. **Deploy ke Vercel**
```bash
vercel
```
> Atau deploy langsung via dashboard Vercel dengan menghubungkan repository GitHub.

5. **Konfigurasi Environment Variables**
   
   Buat file `.env` atau set via Vercel Dashboard:

```env
# ─────────────────────────────
# 🤖 Telegram Bot
# ─────────────────────────────
BOT_TOKEN=your_telegram_bot_token_here

# ─────────────────────────────
# ⚙️ Performance & Limits
# ─────────────────────────────
TIMEOUT=30000
MAX_POLLS=50
POLL_INTERVAL=2000
MAX_RETRIES=3

# Rate limiting (per user)
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX=10

# Cache & State TTL (dalam detik)
STATE_TTL=120
CACHE_TTL=600

# ─────────────────────────────
# 🪵 Logging
# ─────────────────────────────
LOG_LEVEL=info
# Options: fatal, error, warn, info, debug, trace, silent
```

6. **Setup Webhook Telegram**
```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=https://your-vercel-app.vercel.app/api/bot"
```

### 🔧 File Konfigurasi Tambahan

**`vercel.json`** (opsional, untuk custom config):
```json
{
  "functions": {
    "api/bot.js": {
      "maxDuration": 60
    }
  },
  "regions": ["sin1"]
}
```

**`.gitignore`**:
```gitignore
node_modules/
.env
.env.local
logs/
*.log
.DS_Store
```

---

## ⚠️ Disclaimer

> Bot ini menggunakan API pihak ketiga (*scraping*) dari `ytmp3.mobi`. API tersebut dapat berubah, terbatas, atau tidak tersedia sewaktu-waktu tanpa pemberitahuan.

**Penggunaan bot ini sepenuhnya menjadi tanggung jawab pengguna.** Pemilik bot **tidak bertanggung jawab** atas:
- 📁 Konten yang didownload oleh pengguna
- ⚖️ Pelanggaran hak cipta atau penyalahgunaan bot
- 🔧 Kerusakan, error, atau masalah teknis yang timbul dari penggunaan bot

💡 **Saran:** Gunakan hanya untuk konten yang Anda miliki atau konten berlisensi publik/Creative Commons.

---

## ❓ FAQ

### Q: Kenapa download gagal dengan error "code: 2-1"?
**A:** Link download dari API sudah expired. Coba kirim ulang link YouTube-nya.

### Q: Berapa lama proses konversi?
**A:** Rata-rata 15-45 detik, tergantung durasi video dan beban server API.

### Q: Apa arti `/limit` menunjukkan "RATE LIMITED"?
**A:** Kamu sudah mencapai batas 10 request/menit. Tunggu ~60 detik untuk reset otomatis.

### Q: Bisa download video privat/unlisted?
**A:** Tidak. Bot hanya bisa mendownload video yang publicly accessible.

### Q: Kenapa bot kadang lambat?
**A:** Bisa karena: (1) API pihak ketiga sedang sibuk, (2) Cold start Vercel, atau (3) Video durasi panjang.

---

## 👤 Owner & Kontributor

| Role | Nama | Kontak |
|------|------|--------|
| 👨‍💻 Owner | Abiq Nurmagedov | [GitHub](https://github.com/abiqnurmagedov17) • [Telegram](https://t.me/abiqqqqqq) |

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](./LICENSE).  
Silakan gunakan, modifikasi, dan distribusikan sesuai ketentuan lisensi.

---

## 🤝 Kontribusi

Kontribusi sangat diterima! 🎉  
Jika Anda ingin meningkatkan bot ini, silakan:

1. Fork repository ini
2. Buat branch fitur baru (`git checkout -b fitur/nama-fitur`)
3. Commit perubahan (`git commit -m 'feat: menambahkan fitur X'`)
4. Push ke branch (`git push origin fitur/nama-fitur`)
5. Buka **Pull Request** dan jelaskan perubahan yang dibuat

### 🐛 Melaporkan Bug / Request Fitur

- Gunakan [GitHub Issues](https://github.com/abiqnurmagedov17/bot-tele-ytmp3/issues)
- Jelaskan secara detail: langkah reproduksi, expected vs actual result
- Lampirkan log error jika ada (dari `/health` atau console)

### 💡 Ide Fitur yang Bisa Dikembangkan

- [ ] Support playlist YouTube
- [ ] Custom quality selector (144p, 360p, 720p, 1080p)
- [ ] Multi-language support
- [ ] Admin panel untuk monitoring

---

## 📞 Kontak & Bantuan

Punya pertanyaan atau kendala? Hubungi melalui:

- 💬 **Telegram**: [@abiqnurmagedov](https://t.me/abiqqqqqq)
- 🐙 **GitHub Issues**: [Buka Issue Baru](https://github.com/abiqnurmagedov17/bot-tele-ytmp3/issues)
- 📧 **Email**: abiq@rommiui.com

---

## 📈 Changelog

### v1.1.0 (Latest)
- ✨ Tambah command `/limit` untuk cek kuota download
- ✨ Tambah command `/health` untuk monitoring bot
- 🚀 Optimasi caching dengan NodeCache
- 🪵 Structured logging dengan Pino
- 🛡️ Rate limiting per-user yang lebih robust
- 🔧 Exponential backoff retry logic

### v1.0.0 (Initial Release)
- 🎵 Download MP3 dari YouTube
- 🎬 Download MP4 dari YouTube
- ⚡ Webhook support untuk Vercel

---

<p align="center">
  ⭐ <b>Jangan lupa beri bintang jika proyek ini bermanfaat!</b> ⭐
</p>

<p align="center">
  <sub>Dibuat oleh ❤️ Abiq Nurmagedov</sub>
</p>