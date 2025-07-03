import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const BOT_TOKEN = process.env.BOT_TOKEN;

const NOTIFICATION_MESSAGE = `
<b>📢 Update 2025-07-03: Menambahkan Sheet Rekap</b>

🆕 Kami telah menambahkan sheet baru: REKAP di spreadsheet Anda. 

Sheet ini berguna untuk melihat rekapitulasi pendapatan dan pengeluaran per bulan. Anda dapat memilih filter Bulan dan Tahun untuk melihat rekapnya.

Pilih menu 'Buka Spreadsheet' di bawah untuk melihat perubahan di spreadsheet Anda.

Note:
- Jika spreadsheet Anda yang belum ada sheet 'REKAP' bisa chat ke @catatanuangku_helper.
- Jika ada sheet dengan nama 'Copy of REKAP' bisa dihapus manual, gunakan saja sheet 'REKAP'

Ada saran pengembangan lain? Chat ke @catatanuangku_helper

Klik /start jika menu tidak muncul. 
`;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { data: users, error } = await supabase
      .from('users_duplicate')
      .select('chat_id');

    if (error) throw error;

    let success = 0;
    let failed = 0;

    const replyMarkup = {
      keyboard: [
        ['Buka Spreadsheet', 'Rekap', 'Bantuan'],
        ['Tentang', 'Kontak', 'Support']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    for (const { chat_id } of users) {
      const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          text: NOTIFICATION_MESSAGE.trim(),
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        })
      });

      if (response.ok) {
        success++;
      } else {
        failed++;
      }
    }

    return res.status(200).json({
      message: `✅ Terkirim ke ${success} user. ❌ Gagal ke ${failed} user.`
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Gagal mengirim pesan',
      detail: err.message
    });
  }
}
