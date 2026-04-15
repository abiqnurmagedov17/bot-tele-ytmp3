# 🎬 YouTube Downloader Bot

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/abiqnurmagedov17/bot-tele-ytmp3)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen)](https://nodejs.org/)

> Bot Telegram untuk mendownload video YouTube dalam format **MP3** (Audio) dan **MP4** (Video) secara gratis, cepat, dan tanpa batasan durasi.

---

## ✨ Fitur

- 🎵 **Download Audio** — Konversi YouTube ke MP3 dengan kualitas terbaik
- 🎬 **Download Video** — Simpan video YouTube dalam format MP4
- ⚡ **Proses Cepat** — Tanpa antrian, konversi 00-05 detik
- 🔗 **Link Langsung** — File siap download tanpa redirect
- 🆓 **100% Gratis** — Tanpa batasan durasi atau watermark
- 📱 **YouTube Shorts Support** — Download Shorts dengan mudah

---

## 🚀 Cara Penggunaan

1. **Mulai Bot**  
   Cari `@yetemp3down_bot` di Telegram atau klik [di sini](https://t.me/yetemp3down_bot)

2. **Kirim Link YouTube**  
   Paste link video YouTube yang ingin didownload

3. **Pilih Format**  
   Pilih antara **MP3** (audio) atau **MP4** (video)

4. **Tunggu Proses**  
   Bot akan memproses permintaan (estimasi: 15-45 detik)

5. **Download File**  
   Klik link yang diberikan untuk mengunduh file

### 🔗 Format Link yang Didukung

```text
https://youtube.com/watch?v=xxxxx
https://youtu.be/xxxxx
https://youtube.com/shorts/xxxxx
https://m.youtube.com/watch?v=xxxxx
```

### 📋 Daftar Perintah

| Command | Deskripsi ||---------|-----------|
| `/start` | Memulai bot dan menampilkan pesan selamat datang |
| `/help` | Menampilkan panduan penggunaan lengkap |
| `/status` | Mengecek status proses konversi yang sedang berjalan |
| `/ping` | Mengecek koneksi bot (opsional) |

---

## 🛠️ Teknologi yang Digunakan

| Teknologi | Deskripsi |
|-----------|-----------|
| [Node.js](https://nodejs.org/) | JavaScript runtime environment |
| [Telegraf](https://telegraf.js.org/) | Framework bot Telegram modern |
| [Axios](https://axios-http.com/) | HTTP client untuk request API |
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
   vercel```
   > Atau deploy langsung via dashboard Vercel dengan menghubungkan repository GitHub.

5. **Konfigurasi Environment Variables**
   
   Buat file `.env` atau set via Vercel Dashboard:
```env
   BOT_TOKEN=your_telegram_bot_token_here
```

6. **Setup Webhook Telegram**
```bash
   curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=https://your-vercel-app.vercel.app/api/bot"
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

---

## 📞 Kontak & Bantuan

Punya pertanyaan atau kendala? Hubungi melalui:

- 💬 **Telegram**: [@abiqnurmagedov](https://t.me/abiqqqqqq)
- 🐙 **GitHub Issues**: [Buka Issue Baru](https://github.com/abiqnurmagedov17/bot-tele-ytmp3/issues)

---

<p align="center">
  ⭐ <b>Jangan lupa beri bintang jika proyek ini bermanfaat!</b> ⭐
</p>

<p align="center">
  <sub>Dibuat oleh ❤️ Abiq Nurmagedov</sub>
</p>