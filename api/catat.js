// api/catat.js
import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import Groq from 'groq-sdk';

// Inisialisasi bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Inisialisasi Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Inisialisasi Groq AI
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Inisialisasi Google APIs
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_id: process.env.GOOGLE_CLIENT_ID,
  },
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ],
});

const drive = google.drive({ version: 'v3', auth });
const sheets = google.sheets({ version: 'v4', auth });

// ID template spreadsheet (ganti dengan ID template Anda)
const TEMPLATE_SPREADSHEET_ID = process.env.TEMPLATE_SPREADSHEET_ID;

// Fungsi helper untuk extract folder ID dari URL Google Drive
function extractFolderIdFromUrl(url) {
  try {
    const regex = /\/folders\/([a-zA-Z0-9-_]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  } catch (error) {
    console.error('Error extracting folder ID:', error);
    return null;
  }
}

// Fungsi untuk extract spreadsheet ID dari URL
function extractSpreadsheetIdFromUrl(url) {
  try {
    const regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const match = url.match(regex);
    return match ? match[1] : null;
  } catch (error) {
    console.error('Error extracting spreadsheet ID:', error);
    return null;
  }
}

// Fungsi untuk mengecek akses folder Google Drive
async function checkFolderAccess(folderId) {
  try {
    const response = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType'
    });
    
    console.log('Folder access successful:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('Error accessing folder:', error.message);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk menyalin template spreadsheet
async function copyTemplateToFolder(folderId, fileName) {
  try {
    const copyResponse = await drive.files.copy({
      fileId: TEMPLATE_SPREADSHEET_ID,
      requestBody: {
        name: fileName,
        parents: [folderId]
      }
    });

    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${copyResponse.data.id}`;
    
    console.log('Template copied successfully:', {
      id: copyResponse.data.id,
      url: spreadsheetUrl
    });
    
    return { success: true, id: copyResponse.data.id, url: spreadsheetUrl };
  } catch (error) {
    console.error('Error copying template:', error.message);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk mengecek user di database
async function checkUserExists(chatId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('chat_id', chatId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking user:', error);
      return { success: false, error: error.message };
    }

    return { success: true, exists: !!data, data };
  } catch (error) {
    console.error('Error in checkUserExists:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk menyimpan ke pending_update
async function saveToPendingUpdate(chatId, firstName, folderLink) {
  try {
    const { data, error } = await supabase
      .from('pending_update')
      .insert({
        chat_id: chatId,
        first_name: firstName,
        folder_link: folderLink,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('Error saving to pending_update:', error);
      return { success: false, error: error.message };
    }

    console.log('Data saved to pending_update:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Error in saveToPendingUpdate:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk menyimpan/update user
async function saveOrUpdateUser(chatId, firstName, folderLink, spreadsheetLink) {
  try {
    const { data, error } = await supabase
      .from('users')
      .upsert({
        chat_id: chatId,
        first_name: firstName,
        folder_link: folderLink,
        spreadsheet_link: spreadsheetLink,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'chat_id'
      });

    if (error) {
      console.error('Error saving/updating user:', error);
      return { success: false, error: error.message };
    }

    console.log('User data saved/updated:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Error in saveOrUpdateUser:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk menghapus pending update
async function deletePendingUpdate(chatId) {
  try {
    const { error } = await supabase
      .from('pending_update')
      .delete()
      .eq('chat_id', chatId);

    if (error) {
      console.error('Error deleting pending update:', error);
      return { success: false, error: error.message };
    }

    console.log('Pending update deleted for chat_id:', chatId);
    return { success: true };
  } catch (error) {
    console.error('Error in deletePendingUpdate:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk mengklasifikasikan transaksi dengan AI Groq
async function classifyTransaction(message, type) {
  try {
    const currentDate = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
    
    const prompt = `
Analisis pesan transaksi berikut dan berikan output dalam format JSON yang tepat:

Pesan: "${message}"
Tipe: "${type === 'keluar' ? 'Pengeluaran' : 'Pendapatan'}"

Instruksi:
1. Ekstrak jumlah uang dari pesan (hapus kata seperti "rb", "ribu", "juta", dll dan konversi ke angka)
   - "rb" atau "ribu" = x1000
   - "jt" atau "juta" = x1000000
2. Tentukan kategori yang sesuai
3. Ekstrak keterangan/deskripsi
4. Jika tidak ada tanggal dalam pesan, gunakan tanggal hari ini: ${currentDate}

Kategori untuk Pengeluaran:
- Makanan & Minuman
- Transportasi
- Kendaraan
- Belanja
- Hiburan
- Kesehatan
- Pendidikan
- Tagihan & Utilitas
- Pengeluaran Lainnya

Kategori untuk Pendapatan:
- Gaji
- Bonus
- Freelance
- Investasi
- Bisnis
- Pendapatan Lainnya

PENTING: Berikan HANYA output JSON yang valid, tanpa teks tambahan, komentar, atau penjelasan apapun.

Format output JSON:
{
  "klasifikasi": "${type === 'keluar' ? 'Pengeluaran' : 'Pendapatan'}",
  "kategori": "kategori_yang_sesuai",
  "jumlah": jumlah_dalam_angka,
  "keterangan": "deskripsi_singkat",
  "tanggal": "${currentDate}"
}
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a financial transaction classifier. Return ONLY valid JSON without any additional text, comments, or explanations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "llama3-8b-8192",
      temperature: 0.1,
      max_tokens: 300,
    });

    let response = completion.choices[0]?.message?.content?.trim();
    console.log('Groq AI Raw Response:', response);

    // Clean response - remove any markdown code blocks or extra text
    if (response.includes('```json')) {
      response = response.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }
    if (response.includes('```')) {
      response = response.replace(/```/g, '');
    }

    // Find JSON object in response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      response = jsonMatch[0];
    }

    console.log('Cleaned Response for parsing:', response);

    // Try to parse JSON
    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      console.error('Failed to parse response:', response);
      
      // Fallback: create manual classification
      return await fallbackClassification(message, type, currentDate);
    }

    // Validate required fields
    if (!parsed.klasifikasi || !parsed.kategori || !parsed.jumlah || !parsed.keterangan || !parsed.tanggal) {
      console.error('Missing required fields in parsed response:', parsed);
      return await fallbackClassification(message, type, currentDate);
    }

    return { success: true, data: parsed };

  } catch (error) {
    console.error('Error in AI classification:', error);
    
    // Fallback classification
    try {
      const currentDate = new Date().toISOString().split('T')[0];
      return await fallbackClassification(message, type, currentDate);
    } catch (fallbackError) {
      console.error('Fallback classification also failed:', fallbackError);
      return { success: false, error: error.message };
    }
  }
}

// Fungsi fallback untuk klasifikasi manual
async function fallbackClassification(message, type, currentDate) {
  try {
    console.log('Using fallback classification for message:', message);
    
    // Extract amount
    let amount = 0;
    const amountRegex = /(\d+(?:\.\d+)?)\s*(rb|ribu|jt|juta|k)?/i;
    const amountMatch = message.match(amountRegex);
    
    if (amountMatch) {
      let num = parseFloat(amountMatch[1]);
      const unit = amountMatch[2]?.toLowerCase();
      
      if (unit === 'rb' || unit === 'ribu' || unit === 'k') {
        num *= 1000;
      } else if (unit === 'jt' || unit === 'juta') {
        num *= 1000000;
      }
      
      amount = Math.round(num);
    }

    // Simple category classification
    let category;
    const lowerMessage = message.toLowerCase();
    
    if (type === 'keluar') {
      if (lowerMessage.includes('makan') || lowerMessage.includes('minum') || lowerMessage.includes('nasi') || lowerMessage.includes('sate') || lowerMessage.includes('kopi')) {
        category = 'Makanan & Minuman';
      } else if (lowerMessage.includes('bensin') || lowerMessage.includes('ojek') || lowerMessage.includes('taxi') || lowerMessage.includes('bus')) {
        category = 'Transportasi';
      } else if (lowerMessage.includes('motor') || lowerMessage.includes('mobil') || lowerMessage.includes('service')) {
        category = 'Kendaraan';
      } else if (lowerMessage.includes('beli') || lowerMessage.includes('belanja') || lowerMessage.includes('baju') || lowerMessage.includes('sepatu')) {
        category = 'Belanja';
      } else {
        category = 'Pengeluaran Lainnya';
      }
    } else {
      if (lowerMessage.includes('gaji') || lowerMessage.includes('salary')) {
        category = 'Gaji';
      } else if (lowerMessage.includes('bonus')) {
        category = 'Bonus';
      } else if (lowerMessage.includes('freelance') || lowerMessage.includes('project')) {
        category = 'Freelance';
      } else {
        category = 'Pendapatan Lainnya';
      }
    }

    // Extract description (remove amount and common words)
    let description = message
      .replace(amountRegex, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!description) {
      description = type === 'keluar' ? 'Pengeluaran' : 'Pendapatan';
    }

    const result = {
      klasifikasi: type === 'keluar' ? 'Pengeluaran' : 'Pendapatan',
      kategori: category,
      jumlah: amount,
      keterangan: description,
      tanggal: currentDate
    };

    console.log('Fallback classification result:', result);
    return { success: true, data: result };

  } catch (error) {
    console.error('Error in fallback classification:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk menulis ke spreadsheet
async function writeToSpreadsheet(spreadsheetId, sheetName, data) {
  try {
    // Data yang akan ditulis ke spreadsheet
    const values = [[
      data.tanggal,
      data.kategori,
      data.jumlah,
      data.keterangan
    ]];

    const resource = {
      values: values
    };

    const result = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A:D`, // Assuming columns A-D (Tanggal, Kategori, Jumlah, Keterangan)
      valueInputOption: 'RAW',
      resource: resource
    });

    console.log('Data written to spreadsheet:', result.data);
    return { success: true, data: result.data };

  } catch (error) {
    console.error('Error writing to spreadsheet:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk memformat currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0
  }).format(amount);
}

// Handler untuk perintah /start
bot.start((ctx) => {
  const welcomeMessage = `
🎉 *Selamat datang di Bot Catatan Keuangan Pribadi!* 🎉

Bot ini akan membantu Anda mengelola catatan keuangan pribadi menggunakan Google Spreadsheet.

📋 *Cara penggunaan:*
1. Kirimkan link folder Google Drive Anda
2. Bot akan membuat file spreadsheet catatan keuangan di folder tersebut
3. Anda bisa mulai mencatat keuangan menggunakan spreadsheet yang telah dibuat

⚠️ *Pastikan:*
- Link yang dikirim adalah link folder Google Drive (bukan file)
- Folder Google Drive dapat diakses oleh bot
- Anda memiliki izin edit pada folder tersebut

Silakan kirimkan link folder Google Drive Anda untuk memulai! 📁
  `;

  ctx.replyWithMarkdown(welcomeMessage);
});

// Handler untuk perintah /keluar (pengeluaran)
bot.command('keluar', async (ctx) => {
  const chatId = ctx.chat.id;
  const message = ctx.message.text.replace('/keluar', '').trim();

  if (!message) {
    return ctx.reply('❌ Mohon sertakan detail pengeluaran. Contoh: /keluar makan sate 20rb');
  }

  try {
    // Cek apakah user sudah terdaftar
    const userCheck = await checkUserExists(chatId);
    if (!userCheck.success || !userCheck.exists) {
      return ctx.reply('❌ Anda belum terdaftar. Silakan kirimkan link folder Google Drive terlebih dahulu.');
    }

    const userData = userCheck.data;
    const spreadsheetId = extractSpreadsheetIdFromUrl(userData.spreadsheet_link);

    if (!spreadsheetId) {
      return ctx.reply('❌ Spreadsheet tidak ditemukan. Silakan setup ulang dengan mengirimkan link folder.');
    }

    ctx.reply('⏳ Sedang memproses pengeluaran...');

    // Klasifikasi dengan AI
    const classification = await classifyTransaction(message, 'keluar');
    if (!classification.success) {
      console.error('Classification failed:', classification.error);
      return ctx.reply('❌ Gagal menganalisis transaksi. Silakan coba lagi.');
    }

    const transactionData = classification.data;

    // Tulis ke spreadsheet
    const writeResult = await writeToSpreadsheet(spreadsheetId, 'Pengeluaran', transactionData);
    if (!writeResult.success) {
      console.error('Write to spreadsheet failed:', writeResult.error);
      return ctx.reply('❌ Gagal mencatat ke spreadsheet. Silakan coba lagi.');
    }

    // Kirim konfirmasi ke user
    const confirmationMessage = `
✅ *Berhasil mencatat Pengeluaran:*

📅 *Tanggal:* ${transactionData.tanggal}
🏷️ *Kategori:* ${transactionData.kategori}
💰 *Jumlah:* ${formatCurrency(transactionData.jumlah)}
📝 *Keterangan:* ${transactionData.keterangan}
    `;

    ctx.replyWithMarkdown(confirmationMessage);

  } catch (error) {
    console.error('Error in /keluar handler:', error);
    ctx.reply('❌ Terjadi kesalahan saat mencatat pengeluaran. Silakan coba lagi.');
  }
});

// Handler untuk perintah /masuk (pendapatan)
bot.command('masuk', async (ctx) => {
  const chatId = ctx.chat.id;
  const message = ctx.message.text.replace('/masuk', '').trim();

  if (!message) {
    return ctx.reply('❌ Mohon sertakan detail pendapatan. Contoh: /masuk gaji bulanan 5juta');
  }

  try {
    // Cek apakah user sudah terdaftar
    const userCheck = await checkUserExists(chatId);
    if (!userCheck.success || !userCheck.exists) {
      return ctx.reply('❌ Anda belum terdaftar. Silakan kirimkan link folder Google Drive terlebih dahulu.');
    }

    const userData = userCheck.data;
    const spreadsheetId = extractSpreadsheetIdFromUrl(userData.spreadsheet_link);

    if (!spreadsheetId) {
      return ctx.reply('❌ Spreadsheet tidak ditemukan. Silakan setup ulang dengan mengirimkan link folder.');
    }

    ctx.reply('⏳ Sedang memproses pendapatan...');

    // Klasifikasi dengan AI
    const classification = await classifyTransaction(message, 'masuk');
    if (!classification.success) {
      console.error('Classification failed:', classification.error);
      return ctx.reply('❌ Gagal menganalisis transaksi. Silakan coba lagi.');
    }

    const transactionData = classification.data;

    // Tulis ke spreadsheet
    const writeResult = await writeToSpreadsheet(spreadsheetId, 'Pendapatan', transactionData);
    if (!writeResult.success) {
      console.error('Write to spreadsheet failed:', writeResult.error);
      return ctx.reply('❌ Gagal mencatat ke spreadsheet. Silakan coba lagi.');
    }

    // Kirim konfirmasi ke user
    const confirmationMessage = `
✅ *Berhasil mencatat Pendapatan:*

📅 *Tanggal:* ${transactionData.tanggal}
🏷️ *Kategori:* ${transactionData.kategori}
💰 *Jumlah:* ${formatCurrency(transactionData.jumlah)}
📝 *Keterangan:* ${transactionData.keterangan}
    `;

    ctx.replyWithMarkdown(confirmationMessage);

  } catch (error) {
    console.error('Error in /masuk handler:', error);
    ctx.reply('❌ Terjadi kesalahan saat mencatat pendapatan. Silakan coba lagi.');
  }
});

// Handler untuk pesan teks (link folder)
bot.on('text', async (ctx) => {
  const message = ctx.message.text;
  const chatId = ctx.chat.id;
  const firstName = ctx.from.first_name || 'User';

  // Skip jika bukan link Google Drive folder
  if (!message.includes('drive.google.com/drive/folders/')) {
    return ctx.reply('❌ Harap kirimkan link folder Google Drive yang valid.');
  }

  try {
    // Extract folder ID dari URL
    const folderId = extractFolderIdFromUrl(message);
    if (!folderId) {
      return ctx.reply('❌ Format link folder Google Drive tidak valid.');
    }

    // Simpan ke pending_update terlebih dahulu
    const pendingSaveResult = await saveToPendingUpdate(chatId, firstName, message);
    if (!pendingSaveResult.success) {
      console.error('Failed to save to pending_update:', pendingSaveResult.error);
      return ctx.reply('❌ Terjadi kesalahan saat menyimpan data. Silakan coba lagi.');
    }

    // Cek apakah user sudah terdaftar
    const userCheck = await checkUserExists(chatId);
    if (!userCheck.success) {
      console.error('Failed to check user:', userCheck.error);
      return ctx.reply('❌ Terjadi kesalahan saat mengecek data pengguna. Silakan coba lagi.');
    }

    // Jika user sudah terdaftar, tanyakan apakah ingin mengganti
    if (userCheck.exists) {
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('Ya', 'replace_yes'), Markup.button.callback('Tidak', 'replace_no')]
      ]);

      return ctx.reply(
        '📁 Anda sudah pernah menambahkan folder. Apakah ingin mengganti dengan yang baru?',
        keyboard
      );
    }

    // Proses untuk user baru
    await processNewFolder(ctx, folderId, firstName, message);

  } catch (error) {
    console.error('Error in text handler:', error);
    ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
  }
});

// Handler untuk callback "Ya" (ganti folder)
bot.action('replace_yes', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const chatId = ctx.chat.id;
    const firstName = ctx.from.first_name || 'User';

    // Ambil data dari pending_update
    const { data: pendingData, error } = await supabase
      .from('pending_update')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !pendingData) {
      console.error('Error getting pending data:', error);
      return ctx.reply('❌ Terjadi kesalahan saat mengambil data. Silakan kirim ulang link folder.');
    }

    const folderLink = pendingData.folder_link;
    const folderId = extractFolderIdFromUrl(folderLink);

    if (!folderId) {
      return ctx.reply('❌ Format link folder tidak valid.');
    }

    await ctx.reply('⏳ Sedang memproses folder baru...');
    await processNewFolder(ctx, folderId, firstName, folderLink, true);

  } catch (error) {
    console.error('Error in replace_yes handler:', error);
    ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
  }
});

// Handler untuk callback "Tidak" (tidak ganti folder)
bot.action('replace_no', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const chatId = ctx.chat.id;

    // Hapus dari pending_update
    await deletePendingUpdate(chatId);

    ctx.reply('✅ Link folder tidak diperbarui. Anda dapat melanjutkan mencatat keuangan dengan folder yang sudah ada.');
  } catch (error) {
    console.error('Error in replace_no handler:', error);
    ctx.reply('❌ Terjadi kesalahan.');
  }
});

// Fungsi helper untuk delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi untuk memproses folder baru
async function processNewFolder(ctx, folderId, firstName, folderLink, isUpdate = false) {
  try {
    const chatId = ctx.chat.id;

    // Cek akses folder
    const folderAccess = await checkFolderAccess(folderId);
    if (!folderAccess.success) {
      console.error('Folder access failed:', folderAccess.error);
      return ctx.reply('❌ Penyimpanan folder gagal. Pastikan folder dapat diakses oleh bot dan memiliki izin yang tepat.');
    }

    ctx.reply('✅ Folder berhasil diakses. Sedang membuat spreadsheet...');

    // Salin template spreadsheet
    const fileName = `Catatan Keuangan - ${firstName}`;
    const copyResult = await copyTemplateToFolder(folderId, fileName);
    
    if (!copyResult.success) {
      console.error('Template copy failed:', copyResult.error);
      return ctx.reply('❌ Gagal membuat spreadsheet catatan keuangan. Silakan coba lagi.');
    }
    console.log('✅ Template copied successfully');
    
    // Simpan ke database users
    const saveResult = await saveOrUpdateUser(chatId, firstName, folderLink, copyResult.url);
    if (!saveResult.success) {
      console.error('Failed to save user:', saveResult.error);
      return ctx.reply('❌ Gagal menyimpan data pengguna. Silakan coba lagi.');
    }
     console.log('✅ User data saved successfully');
    
    // Hapus SEMUA data dengan chat_id yang sama dari pending_update
    // (untuk user baru maupun update)
    const deleteResult = await deletePendingUpdate(chatId);
    if (!deleteResult.success) {
      console.error('Failed to delete pending update:', deleteResult.error);
      // Log error tapi jangan gagalkan proses utama
    }
    console.log('✅ Pending update deleted successfully');

    await delay(1000);

    const successMessage = `
🎉 *${isUpdate ? 'Folder berhasil diperbarui!' : 'Setup berhasil!'}* 🎉

📊 Spreadsheet catatan keuangan Anda telah dibuat dengan nama:
*${fileName}*

🔗 *Link Spreadsheet:*
${copyResult.url}

✅ Anda sekarang dapat mulai mencatat keuangan pribadi menggunakan spreadsheet tersebut.

💡 *Tips:* Bookmark link spreadsheet di atas untuk akses yang lebih mudah!
    `;

    console.log('📤 Sending success message...');
    await ctx.replyWithMarkdown(successMessage);
    console.log('✅ Success message sent');

  } catch (error) {
    console.error('Error in processNewFolder:', error);
    ctx.reply('❌ Terjadi kesalahan saat memproses folder. Silakan coba lagi.');
  }
}

// Error handler
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('❌ Terjadi kesalahan pada bot. Silakan coba lagi.');
});

// Handler untuk Vercel
export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      // Handle webhook dari Telegram
      await bot.handleUpdate(req.body);
      res.status(200).json({ ok: true });
    } else {
      // Handle GET request (untuk testing)
      res.status(200).json({ message: 'Bot is running!' });
    }
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
