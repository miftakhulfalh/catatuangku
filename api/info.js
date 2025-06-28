import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const BOT_TOKEN = process.env.BOT_TOKEN;

const NOTIFICATION_MESSAGE = `
<b>Update 2025-06-28: Multiple Transaction</b>

Kini bot bisa memproses multiple transaction atau banyak pengeluaran/pendapatan dalam satu pesan.

1. Dengan separator "dan" 
Contoh:
<blockquote>/keluar makan bakso 20rb dan parkir 2rb</blockquote>

2. Dengan separator koma (,)
Contoh:
<blockquote>/masuk gaji 2jt, uang saku 500rb, freelance desain 100rb</blockquote>

3. Dengan separator new line (enter)
Contoh:
<blockquote>/keluar nonton bioskop 40rb
makan 55rb
parkir 7rb</blockquote>

Note: cukup pakai 1 perintah /keluar untuk separator new line (enter)

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
