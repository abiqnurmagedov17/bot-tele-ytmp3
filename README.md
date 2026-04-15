```markdown
# 🎬 YouTube Downloader Bot

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/abiqnurmagedov17/bot-tele-ytmp3)

Bot Telegram untuk mendownload video YouTube dalam format **MP3** (Audio) dan **MP4** (Video) secara gratis dan tanpa batasan durasi.

---

## ✨ Fitur

- 🎵 Download audio YouTube (MP3)
- 🎬 Download video YouTube (MP4)
- ⚡ Proses cepat tanpa antrian
- 🔗 Link download langsung
- 🆓 Gratis tanpa batasan durasi
- 📱 Support YouTube Shorts

---

## 🚀 Cara Penggunaan

1. **Mulai bot:** Cari `@YourBotUsername` di Telegram atau klik [di sini](https://t.me/YourBotUsername)
2. **Kirim link YouTube** yang ingin didownload
3. **Pilih format** MP3 atau MP4
4. **Tunggu proses** konversi (15-45 detik)
5. **Download** file melalui link yang diberikan

### 📎 Contoh Link yang Didukung:
```

https://youtube.com/watch?v=xxxxx
https://youtu.be/xxxxx
https://youtube.com/shorts/xxxxx

```

### 📋 Perintah Bot:
| Command | Fungsi |
|---------|--------|
| `/start` | Memulai bot dan menampilkan pesan selamat datang |
| `/help` | Menampilkan bantuan dan cara penggunaan |
| `/status` | Mengecek status proses yang sedang berjalan |

---

## 🛠️ Teknologi yang Digunakan

- [Node.js](https://nodejs.org/) - Runtime JavaScript
- [Telegraf](https://telegraf.js.org/) - Framework Bot Telegram
- [Axios](https://axios-http.com/) - HTTP Client
- [Vercel](https://vercel.com/) - Hosting Serverless
- [ytmp3.mobi API](https://ytmp3.mobi/) - Third-party API (Scraping)

---

## 📦 Deploy Sendiri

### Prasyarat:
- [Node.js](https://nodejs.org/) v18+
- [Git](https://git-scm.com/)
- Akun [Vercel](https://vercel.com/)
- Bot Token dari [@BotFather](https://t.me/BotFather)

### Langkah-langkah Deploy:

1. **Clone repository**
```bash
git clone https://github.com/abiqnurmagedov17/bot-tele-ytmp3.git
cd bot-tele-ytmp3
```

1. Install dependencies

```bash
npm install
```

1. Deploy ke Vercel

```bash
npm i -g vercel
vercel
```

1. Set Environment Variable

```
BOT_TOKEN = your_telegram_bot_token_here
```

1. Set Webhook Telegram

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-vercel-app.vercel.app/api/bot"
```

---

⚠️ Disclaimer

Bot ini menggunakan API pihak ketiga hasil scraping dari ytmp3.mobi. API ini dapat berubah atau mati sewaktu-waktu tanpa pemberitahuan. Gunakan dengan bijak.

Pemilik bot tidak bertanggung jawab atas:

· Konten yang didownload oleh pengguna
· Penyalahgunaan bot untuk konten berhak cipta
· Kerusakan atau masalah yang timbul dari penggunaan bot

---

👤 Owner

· Nama: Abiq Nurmagedov
· GitHub: github.com/abiqnurmagedov17
· Telegram: @abiqnurmagedov

---

📄 Lisensi

Proyek ini dilisensikan di bawah MIT License.

---

🤝 Kontribusi

Kontribusi selalu diterima! Silakan buat Issue atau Pull Request jika ingin berkontribusi.

1. Fork repository
2. Buat branch fitur (git checkout -b fitur-baru)
3. Commit perubahan (git commit -m 'Menambah fitur baru')
4. Push ke branch (git push origin fitur-baru)
5. Buat Pull Request

---

📞 Kontak & Bantuan

Jika ada pertanyaan atau masalah, silakan hubungi melalui:

· Telegram
· GitHub Issues

---

⭐ Jangan lupa kasih bintang jika proyek ini bermanfaat! ⭐

```

---

## Catatan:

Ganti bagian berikut sesuai dengan data kamu:
- `@YourBotUsername` → username bot Telegram kamu
- `https://t.me/YourBotUsername` → link bot Telegram kamu
- `your-vercel-app.vercel.app` → URL Vercel kamu (`bot-tele-ytmp3.vercel.app`)

Simpan file sebagai `README.md` di root folder project, lalu commit dan push ke GitHub!