// api/catat.js
import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

// Inisialisasi bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Inisialisasi Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
