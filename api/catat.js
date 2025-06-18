// api/catat.js
import { Telegraf, Markup } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import fetch from 'node-fetch';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inisialisasi bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Inisialisasi Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      fetch: fetch,
    },
    db: {
      schema: 'public'
    }
  }
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

// Fungsi untuk menghitung total user
async function getTotalUsers() {
  try {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error('Error fetching total users:', error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error('Unexpected error in getTotalUsers:', err);
    return 0;
  }
}

// Fungsi untuk resize dan kompres gambar
const processingSet = new Set(); // Untuk mencegah duplikasi proses

// Fungsi untuk resize gambar sebelum OCR (mengurangi ukuran file)
async function resizeImageForOCR(imageBuffer, maxWidth = 1024) {
  try {
    // Jika Anda menggunakan sharp library (install: npm install sharp)
    const sharp = require('sharp');
    
    const resized = await sharp(imageBuffer)
      .resize(maxWidth, null, { 
        withoutEnlargement: true,
        fit: 'inside'
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    return resized;
  } catch (error) {
    console.log('Sharp not available, using original image:', error.message);
    return imageBuffer;
  }
}

// Update fungsi processReceiptOCR di bot utama
async function processReceiptOCR(imageUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000); // 50 detik timeout
  
  try {
    console.log('Starting custom Tesseract OCR process...');

    // URL API Tesseract Anda sendiri
    const OCR_API_URL = process.env.CUSTOM_OCR_API_URL || 'https://tesseract.vercel.app/api/ocr';

    // Unduh gambar terlebih dahulu
    const fileResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 8000, // Kurangi timeout download
      signal: controller.signal,
      maxContentLength: 5 * 1024 * 1024, // Max 5MB
      maxBodyLength: 5 * 1024 * 1024
    });
    
    let imageBuffer = Buffer.from(fileResponse.data);
    
    // Resize gambar jika terlalu besar
    if (imageBuffer.length > 2 * 1024 * 1024) { // Jika lebih dari 2MB
      console.log(`Resizing large image: ${imageBuffer.length} bytes`);
      imageBuffer = await resizeImageForOCR(imageBuffer);
      console.log(`Resized to: ${imageBuffer.length} bytes`);
    }

    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    
    // Kirim ke API dengan timeout yang lebih kecil
    const response = await axios.post(
      OCR_API_URL,
      {
        imageBase64: base64Image,
        options: {
          tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:-/ ',
          tessedit_pageseg_mode: '6',
          tessedit_ocr_engine_mode: '1'
        }
      },
      {
        timeout: 20000, // Kurangi timeout API call
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );

    clearTimeout(timeoutId);
    
    const result = response.data;
    
    if (result.success && result.text) {
      return { 
        success: true, 
        text: result.text,
        confidence: result.confidence,
        processingTime: result.processingTime
      };
    } else {
      return { 
        success: false, 
        error: result.error || 'Failed to extract text from image' 
      };
    }

  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error in optimized OCR processing:', error);
    
    if (error.name === 'AbortError') {
      return { success: false, error: 'OCR processing timeout (25s)' };
    }
    
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return { success: false, error: 'Connection timeout to OCR service' };
    }
    
    return { success: false, error: error.message };
  }
}

// Fallback OCR yang lebih cepat
async function processReceiptOCRFallbackOptimized(imageUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 detik timeout
  
  try {
    console.log('Using optimized fallback OCR.space API...');
    
    const ocrApiKey = process.env.OCR_SPACE_API_KEY;
    if (!ocrApiKey) {
      throw new Error('OCR API key not configured');
    }

    // Download dengan timeout kecil
    const fileResponse = await axios.get(imageUrl, { 
      responseType: 'arraybuffer',
      timeout: 5000, // 5 detik untuk download
      signal: controller.signal,
      maxContentLength: 3 * 1024 * 1024 // Max 3MB
    });

    let imageBuffer = Buffer.from(fileResponse.data);
    
    // Resize jika perlu
    if (imageBuffer.length > 1.5 * 1024 * 1024) { // Jika lebih dari 1.5MB
      imageBuffer = await resizeImageForOCR(imageBuffer, 800); // Resize ke 800px max
    }

    const form = new FormData();
    form.append('file', imageBuffer, {
      filename: 'receipt.jpg',
      contentType: 'image/jpeg'
    });
    form.append('apikey', ocrApiKey);
    form.append('language', 'eng');
    form.append('detectOrientation', 'true');
    form.append('OCREngine', '2');
    form.append('scale', 'true'); // Auto-scale untuk hasil lebih baik
    form.append('isTable', 'true'); // Optimized untuk table/receipt

    const response = await axios.post(
      'https://api.ocr.space/parse/image', 
      form,
      {
        headers: { ...form.getHeaders() },
        timeout: 12000, // 12 detik timeout
        signal: controller.signal
      }
    );
    
    clearTimeout(timeoutId);
    const result = response.data;
    
    if (!result.IsErroredOnProcessing && result.ParsedResults && result.ParsedResults.length > 0) {
      const extractedText = result.ParsedResults[0].ParsedText;
      return { success: true, text: extractedText };
    } else {
      return { 
        success: false, 
        error: result.ErrorMessage || 'Failed to extract text from image' 
      };
    }

  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Optimized fallback OCR error:', error);
    
    if (error.name === 'AbortError') {
      return { success: false, error: 'Fallback OCR timeout (15s)' };
    }
    
    return { success: false, error: error.message };
  }
}

// Fungsi untuk mencegah proses duplikasi
function createProcessingKey(chatId, fileId) {
  return `${chatId}_${fileId}`;
}

// Versi processPhotoSync yang dioptimalkan dengan timeout management
async function processPhotoSyncOptimized(ctx, chatId, photoFileId) {
  const processingKey = createProcessingKey(chatId, photoFileId);
  
  // Cek apakah sedang diproses
  if (processingSet.has(processingKey)) {
    console.log(`Photo ${photoFileId} already being processed for chat ${chatId}`);
    await ctx.reply('📸 Foto sedang diproses, mohon tunggu...');
    return;
  }

  // Tandai sebagai sedang diproses
  processingSet.add(processingKey);
  
  // Timeout untuk seluruh proses (50 detik untuk Vercel)
  const globalTimeout = setTimeout(() => {
    processingSet.delete(processingKey);
    console.log(`Global timeout reached for ${processingKey}`);
  }, 50000);

  const statusMessages = [];
  
  try {
    console.log(`Processing photo for chat ${chatId}, file: ${photoFileId}`);

    // Step 1: Quick user check
    let statusMsg = await ctx.telegram.sendMessage(chatId, '👤 Memverifikasi...');
    statusMessages.push(statusMsg.message_id);

    const userCheck = await Promise.race([
      checkUserExists(chatId),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('User check timeout')), 8000)
      )
    ]);

    if (!userCheck.success || !userCheck.exists) {
      await ctx.telegram.editMessageText(
        chatId,
        statusMessages[0],
        null,
        !userCheck.success ? 
          `❌ Error: ${userCheck.error}` : 
          '❌ Belum terdaftar. Kirim link Google Drive dulu.'
      );
      return;
    }

    const userData = userCheck.data;
    const spreadsheetId = extractSpreadsheetIdFromUrl(userData.spreadsheet_link);

    if (!spreadsheetId) {
      await ctx.telegram.editMessageText(
        chatId,
        statusMessages[0],
        null,
        '❌ Spreadsheet tidak valid. Setup ulang dengan link folder.'
      );
      return;
    }

    // Step 2: Get file with quick timeout
    await ctx.telegram.editMessageText(
      chatId,
      statusMessages[0],
      null,
      '📥 Mengunduh foto...'
    );

    const fileLink = await Promise.race([
      ctx.telegram.getFileLink(photoFileId),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('File link timeout')), 5000)
      )
    ]);

    // Step 3: OCR with aggressive timeout
    await ctx.telegram.editMessageText(
      chatId,
      statusMessages[0],
      null,
      '🔍 Membaca teks (max 25s)...'
    );

    // Coba OCR optimized
    let ocrResult = await processReceiptOCROptimized(fileLink.href);
    
    // Fallback jika gagal dan masih ada waktu
    if (!ocrResult.success && process.env.OCR_SPACE_API_KEY) {
      console.log('Custom OCR failed, trying optimized fallback...');
      await ctx.telegram.editMessageText(
        chatId,
        statusMessages[0],
        null,
        '🔄 Mencoba metode alternatif...'
      );
      ocrResult = await processReceiptOCRFallbackOptimized(fileLink.href);
    }

    if (!ocrResult.success) {
      let errorMessage = '❌ Gagal membaca foto.';
      if (ocrResult.error.includes('timeout')) {
        errorMessage += '\n⏱️ Timeout - coba foto lebih kecil/jelas.';
      }
      
      await ctx.telegram.editMessageText(
        chatId,
        statusMessages[0],
        null,
        errorMessage
      );
      return;
    }

    // Step 4: Quick AI analysis
    await ctx.telegram.editMessageText(
      chatId,
      statusMessages[0],
      null,
      '🤖 Menganalisis (max 10s)...'
    );

    const analysisResult = await Promise.race([
      analyzeReceiptText(ocrResult.text),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Analysis timeout')), 10000)
      )
    ]);

    if (!analysisResult.success) {
      await ctx.telegram.editMessageText(
        chatId,
        statusMessages[0],
        null,
        analysisResult.error.includes('Bukan foto struk') ?
          '❌ Bukan foto struk yang valid.' :
          '❌ Gagal menganalisis struk.'
      );
      return;
    }

    // Step 5: Quick save to spreadsheet
    await ctx.telegram.editMessageText(
      chatId,
      statusMessages[0],
      null,
      '💾 Menyimpan...'
    );

    const transactionData = analysisResult.data;
    const sheetName = transactionData.klasifikasi === 'Pengeluaran' ? 'Pengeluaran' : 'Pendapatan';

    const writeResult = await Promise.race([
      writeToSpreadsheet(spreadsheetId, sheetName, transactionData),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Write timeout')), 8000)
      )
    ]);

    if (!writeResult.success) {
      await ctx.telegram.editMessageText(
        chatId,
        statusMessages[0],
        null,
        '❌ Gagal menyimpan ke spreadsheet.'
      );
      return;
    }

    // Success - cleanup and send result
    await ctx.telegram.deleteMessage(chatId, statusMessages[0]);

    const confirmationMessage = `
✅ *Berhasil tercatat:*

📊 *Jenis:* ${transactionData.klasifikasi}
📅 *Tanggal:* ${transactionData.tanggal}
🏷️ *Kategori:* ${transactionData.kategori}
💰 *Jumlah:* ${formatCurrency(transactionData.jumlah)}
📝 *Keterangan:* ${transactionData.keterangan}
🎯 *Keyakinan:* ${transactionData.confidence.toUpperCase()}

${transactionData.confidence === 'low' ? '⚠️ *Catatan:* Keyakinan rendah, periksa di spreadsheet.' : ''}
    `;

    await ctx.telegram.sendMessage(chatId, confirmationMessage, { parse_mode: 'Markdown' });
    console.log(`Successfully processed photo for chat ${chatId}`);

  } catch (error) {
    console.error('Error in processPhotoSyncOptimized:', error);
    
    // Cleanup status messages
    for (const msgId of statusMessages) {
      try {
        await ctx.telegram.deleteMessage(chatId, msgId);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    let errorMsg = '❌ Terjadi kesalahan';
    if (error.message.includes('timeout')) {
      errorMsg += ' (timeout)';
    }
    errorMsg += '\n🔄 Silakan coba lagi dengan foto yang lebih kecil dan jelas.';
    
    await ctx.telegram.sendMessage(chatId, errorMsg);
    
  } finally {
    // Cleanup
    clearTimeout(globalTimeout);
    processingSet.delete(processingKey);
  }
}
// Fungsi untuk menganalisis teks struk dengan AI
async function analyzeReceiptText(ocrText) {
  try {
    const currentDate = new Date().toISOString().split('T')[0];
    
    const prompt = `
Analisis teks struk/invoice berikut dan ekstrak informasi keuangan dalam format JSON:

Teks OCR: "${ocrText}"

Instruksi:
1. Tentukan apakah ini adalah struk belanja/invoice yang valid (jika tidak, set "valid_receipt": false)
2. Tentukan apakah ini pengeluaran atau pendapatan berdasarkan konteks
3. Ekstrak tanggal transaksi (jika ada), jika tidak ada gunakan tanggal hari ini: ${currentDate}
4. Cari jumlah total atau grand total (prioritaskan "Total", "Grand Total", "Amount", "Subtotal"). Jika nominal tidak ada tanda titik, asumsikan itu ribuan. Misalnya, "Rp 70000" berarti tujuh puluh ribu, bukan tujuh puluh.
5. Tentukan kategori berdasarkan jenis toko/bisnis atau item yang dibeli
6. Buat keterangan singkat berdasarkan nama toko atau jenis pembelian

Kategori Pengeluaran: Makanan, Minuman, Transportasi, Kendaraan, Belanja, Hiburan, Kesehatan, PDAM, Pendidikan, Listrik, Tagihan, Utilitas, Pengeluaran Lainnya

Kategori Pendapatan: Gaji, Bonus, Freelance, Transfer, Hadiah, Investasi, Bisnis, Pendapatan Lainnya

PENTING: Berikan HANYA output JSON yang valid, tanpa teks tambahan.

Format output JSON:
{
  "valid_receipt": true/false,
  "klasifikasi": "Pengeluaran" atau "Pendapatan",
  "kategori": "kategori_yang_sesuai",
  "jumlah": jumlah_dalam_angka,
  "keterangan": "deskripsi_singkat",
  "tanggal": "YYYY-MM-DD",
  "confidence": "high/medium/low"
}
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are a receipt analyzer. Return ONLY valid JSON without any additional text, comments, or explanations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "llama3-8b-8192",
      temperature: 0.1,
      max_tokens: 400,
    });

    let response = completion.choices[0]?.message?.content?.trim();
    console.log('AI Receipt Analysis Raw Response:', response);

    // Clean response
    if (response.includes('```json')) {
      response = response.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }
    if (response.includes('```')) {
      response = response.replace(/```/g, '');
    }

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      response = jsonMatch[0];
    }

    console.log('Cleaned Receipt Analysis Response:', response);

    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch (parseError) {
      console.error('JSON Parse Error in receipt analysis:', parseError);
      return { success: false, error: 'Failed to parse AI response' };
    }

    // Validate response
    if (!parsed.valid_receipt) {
      return { success: false, error: 'Bukan foto struk atau invoice yang valid' };
    }

    if (!parsed.klasifikasi || !parsed.kategori || !parsed.jumlah || !parsed.keterangan || !parsed.tanggal) {
      console.error('Missing required fields in receipt analysis:', parsed);
      return { success: false, error: 'Data struk tidak lengkap' };
    }

    return { success: true, data: parsed };

  } catch (error) {
    console.error('Error in receipt analysis:', error);
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
- Makanan
- Minuman
- Transportasi
- Kendaraan
- Belanja
- Hiburan
- Kesehatan
- PDAM
- Pendidikan
- Listrik
- Tagihan
- Utilitas
- Pengeluaran Lainnya

Kategori untuk Pendapatan:
- Gaji
- Bonus
- Freelance
- Transfer
- Hadiah
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
      valueInputOption: 'USER_ENTERED',
      resource: resource
    });

    console.log('Data written to spreadsheet:', result.data);
    return { success: true, data: result.data };

  } catch (error) {
    console.error('Error writing to spreadsheet:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk membaca data dari spreadsheet
async function readFromSpreadsheet(spreadsheetId, ranges) {
  try {
    const result = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: spreadsheetId,
      ranges: ranges
    });

    console.log('Data read from spreadsheet:', result.data);
    return { success: true, data: result.data };

  } catch (error) {
    console.error('Error reading from spreadsheet:', error);
    return { success: false, error: error.message };
  }
}

// Fungsi untuk memformat angka dari spreadsheet
function parseSpreadsheetNumber(value) {
  if (!value) return 0;
  
  // Jika sudah berupa angka
  if (typeof value === 'number') return value;
  
  // Jika berupa string, hapus format currency dan konversi ke angka
  let cleanValue = value.toString().replace(/[^0-9.-]/g, '');
  return parseFloat(cleanValue) || 0;
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
🎉 <b>Selamat datang di Bot Catatan Keuangan Pribadi!</b> 🎉

Bot ini akan membantu Anda mengelola catatan keuangan pribadi menggunakan Google Spreadsheet.

📋 <b>Cara penggunaan:</b>
1. Buat folder baru di Google Drive kamu  
2. Bagikan/share folder tersebut ke email <code>uangku@financial-report-bot.iam.gserviceaccount.com</code> sebagai "Editor"  
3. Copy link folder kamu  
4. Paste atau kirim link folder kamu

🔗 <a href="https://i.ibb.co/XxtL7d4m/cara-share-folder.png">Cara share folder Google Drive</a>

⚠️ <b>Pastikan:</b>
- Link yang dikirim adalah link folder Google Drive (bukan file)  
- Folder dapat diakses oleh bot  
- Anda memiliki izin edit

Silakan kirimkan link folder Google Drive Anda untuk memulai! 📁
  `;

  ctx.reply(welcomeMessage, {
    parse_mode: 'HTML',
    reply_markup: {
      keyboard: [
        ['Buka Spreadsheet', 'Rekap', 'Bantuan'],
        ['Tentang', 'Kontak', 'Support']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  });
});

bot.hears("Buka Spreadsheet", async (ctx) => {
  const chatId = ctx.chat.id;

  // Cek apakah user sudah terdaftar
  const userCheck = await checkUserExists(chatId);
  if (!userCheck.success || !userCheck.exists) {
    return ctx.reply('❌ Anda belum terdaftar. Silakan kirimkan link folder Google Drive terlebih dahulu.');
  }

  const spreadsheetLink = userCheck.data.spreadsheet_link;

  if (!spreadsheetLink) {
    return ctx.reply('❌ Link spreadsheet belum tersedia. Silakan setup ulang dengan mengirimkan link folder.');
  }

  const message = `
🔗 Berikut link spreadsheet Anda:
<a href="${spreadsheetLink}">${spreadsheetLink}</a>
  `;

  return ctx.reply(message, { parse_mode: 'HTML' });
});

bot.hears("Rekap", async (ctx) => {
  const chatId = ctx.chat.id;

  try {
    const userCheck = await checkUserExists(chatId);
    if (!userCheck.success || !userCheck.exists) {
      return ctx.reply('❌ Anda belum terdaftar. Silakan kirimkan link folder Google Drive terlebih dahulu.');
    }

    const userData = userCheck.data;
    const spreadsheetId = extractSpreadsheetIdFromUrl(userData.spreadsheet_link);

    if (!spreadsheetId) {
      return ctx.reply('❌ Spreadsheet tidak ditemukan. Silakan setup ulang dengan mengirimkan link folder.');
    }

    await ctx.reply('⏳ Sedang mengambil data rekap...');

    const ranges = [
      'Dashboard!B2:B5',
      'Dashboard!N4:N8',
      'Dashboard!O4:O8',
      'Dashboard!Q4:Q8',
      'Dashboard!R4:R8'
    ];

    const readResult = await readFromSpreadsheet(spreadsheetId, ranges);
    if (!readResult.success) {
      console.error('Read from spreadsheet failed:', readResult.error);
      return ctx.reply('❌ Gagal mengambil data rekap. Pastikan spreadsheet dapat diakses.');
    }

    const data = readResult.data.valueRanges;
    const summaryData = data[0]?.values || [];
    const totalPengeluaran = summaryData[0] ? parseSpreadsheetNumber(summaryData[0][0]) : 0;
    const totalPemasukan = summaryData[1] ? parseSpreadsheetNumber(summaryData[1][0]) : 0;
    const saldoAkhir = summaryData[2] ? parseSpreadsheetNumber(summaryData[2][0]) : 0;

    const pengeluaranKategori = data[1]?.values || [];
    const pengeluaranJumlah = data[2]?.values || [];
    const pendapatanKategori = data[3]?.values || [];
    const pendapatanJumlah = data[4]?.values || [];

    const currentDate = new Date();
    const bulan = currentDate.toLocaleString('id-ID', { month: 'long' }).toUpperCase();

    let rekapMessage = `
📊 <b>REKAP KEUANGAN BULAN ${bulan}</b>

💰 <b>Ringkasan:</b>
💵 Total Pemasukan: ${formatCurrency(totalPemasukan)}
💸 Total Pengeluaran: ${formatCurrency(totalPengeluaran)}
💳 Saldo Akhir: ${formatCurrency(saldoAkhir)}
`;

    if (pengeluaranKategori.length > 0) {
      rekapMessage += `\n🔴 <b>Rincian Pengeluaran Terakhir:</b>`;
      for (let i = 0; i < Math.min(pengeluaranKategori.length, 5); i++) {
        const kategori = pengeluaranKategori[i]?.[0] || '';
        const jumlah = pengeluaranJumlah[i] ? parseSpreadsheetNumber(pengeluaranJumlah[i][0]) : 0;
        if (kategori && jumlah > 0) {
          rekapMessage += `\n${i + 1}. ${kategori}: ${formatCurrency(jumlah)}`;
        }
      }
    }

    if (pendapatanKategori.length > 0) {
      rekapMessage += `\n\n🟢 <b>Rincian Pendapatan Terakhir:</b>`;
      for (let i = 0; i < Math.min(pendapatanKategori.length, 5); i++) {
        const kategori = pendapatanKategori[i]?.[0] || '';
        const jumlah = pendapatanJumlah[i] ? parseSpreadsheetNumber(pendapatanJumlah[i][0]) : 0;
        if (kategori && jumlah > 0) {
          rekapMessage += `\n${i + 1}. ${kategori}: ${formatCurrency(jumlah)}`;
        }
      }
    }

    rekapMessage += `\n\n🔗 <a href="${userData.spreadsheet_link}">Lihat Detail Spreadsheet</a>`;

    await ctx.reply(rekapMessage, { parse_mode: 'HTML' });

  } catch (error) {
    console.error('Error in Rekap handler:', error);
    ctx.reply('❌ Terjadi kesalahan saat mengambil rekap. Silakan coba lagi.');
  }
});

bot.hears("Bantuan", (ctx) => {
  const bantuanMessage = `
<b>Bantuan</b>

Bot ini membantu Anda mencatat <b>pengeluaran</b> dan <b>pemasukan</b> harian secara otomatis menggunakan Google Spreadsheet.

🧰 <b>Cara Penggunaan:</b>
• Share link folder Google Drive Anda
• Mulai mencatat Pengeluaran dengan awalan /keluar. Contoh:

<blockquote>/keluar makan nasi padang 25rb</blockquote>
atau
<blockquote>/keluar belanja bulanan 250 ribu</blockquote>

• Untuk mencatat Pemasukan/pendapatan dengan awalan /masuk. Contoh:

<blockquote>/masuk gaji bulanan 5jt</blockquote>
atau
<blockquote>/masuk freelance desain grafis 500rb</blockquote>

• Untuk mencatat pengeluaran dengan foto struk, kirimkan foto struk Anda dan bot akan otomatis menganalisisnya
• Lihat Rekap bulanan Anda dengan perintah /rekap atau tombol <b>Rekap</b> di bawah
• Gunakan awalan /ai untuk memulai berinteraksi dengan AI seputar keuangan

📷 Panduan: https://i.ibb.co/RkYbg2Z2/panduan.png

📊 Data Anda disimpan aman di Google Spreadsheet pribadi Anda.

Jika ada kendala hubungi <a href="https://t.me/catatanuangku_helper">@catatanuangku_helper</a>
  `;

  ctx.reply(bantuanMessage, { parse_mode: 'HTML' });
});

bot.hears("Tentang", async (ctx) => {
  const totalUsers = await getTotalUsers();

  const message = `
<b>Tentang Bot</b>

Bot ini membantu Anda mencatat <b>pengeluaran</b> dan <b>pemasukan</b> harian secara otomatis menggunakan Google Spreadsheet.

<b>Fitur Utama:</b>
• Tambah catatan keuangan via chat
• Tambah catatan keuangan via foto struk
• Rekap bulanan otomatis
• AI keuangan
• Spreadsheet pribadi tiap pengguna

🟡 Saat ini, lebih dari <b>${totalUsers.toLocaleString('id-ID')}</b> orang yang terbantu mencatat keuangan mereka tanpa ribet lagi.

📊 Data Anda disimpan aman di Google Spreadsheet pribadi Anda.
  `;

  ctx.reply(message, { parse_mode: 'HTML' });
});

bot.hears("Kontak", (ctx) => {
  const message = `
<b>Kontak</b>

💬 Helper Group: @catatanuangku_helper
📧 Email: miftahelfalh@gmail.com

Bot lainnya: @ArahKiblat_bot
  `;
  ctx.reply(message, { parse_mode: 'HTML' });
});

bot.hears("Support", (ctx) => {
  const message = `
<b>Bantu Support</b>

Dukung biaya server dan pengembangan bot ini melalui Saweria:

🔗 <a href="https://saweria.co/miftakhulfalh">https://saweria.co/miftakhulfalh</a>

Terima kasih telah menggunakan bot ini 🙏🙏🙏
  `;
  ctx.reply(message, { parse_mode: 'HTML' });
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

// Handler untuk perintah /rekap (rekap bulanan)
bot.command('rekap', async (ctx) => {
  const chatId = ctx.chat.id;

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

    ctx.reply('⏳ Sedang mengambil data rekap...');

    // Ranges yang akan dibaca
    const ranges = [
      'Dashboard!B2:B5',      // Total Pemasukan, Pengeluaran, Saldo
      'Dashboard!N4:N8',      // Kategori pengeluaran terakhir
      'Dashboard!O4:O8',      // Jumlah pengeluaran terakhir
      'Dashboard!Q4:Q8',      // Kategori pendapatan terakhir
      'Dashboard!R4:R8'       // Jumlah pendapatan terakhir
    ];

    const readResult = await readFromSpreadsheet(spreadsheetId, ranges);
    if (!readResult.success) {
      console.error('Read from spreadsheet failed:', readResult.error);
      return ctx.reply('❌ Gagal mengambil data rekap. Pastikan spreadsheet dapat diakses.');
    }

    const data = readResult.data.valueRanges;

    // Parse data ringkasan (B2:B5)
    const summaryData = data[0]?.values || [];
    const totalPengeluaran = summaryData[0] ? parseSpreadsheetNumber(summaryData[0][0]) : 0;
    const totalPemasukan = summaryData[1] ? parseSpreadsheetNumber(summaryData[1][0]) : 0;
    const saldoAkhir = summaryData[2] ? parseSpreadsheetNumber(summaryData[2][0]) : 0;

    // Parse data pengeluaran terakhir
    const pengeluaranKategori = data[1]?.values || [];
    const pengeluaranJumlah = data[2]?.values || [];

    // Parse data pendapatan terakhir
    const pendapatanKategori = data[3]?.values || [];
    const pendapatanJumlah = data[4]?.values || [];

    const currentDate = new Date();
    const bulan = currentDate.toLocaleString('id-ID', { month: 'long' }).toUpperCase();

    // Format pesan rekap
    let rekapMessage = `
📊 *REKAP KEUANGAN BULAN ${bulan}* 📊

💰 *Ringkasan:*
💵 Total Pemasukan: ${formatCurrency(totalPemasukan)}
💸 Total Pengeluaran: ${formatCurrency(totalPengeluaran)}
💳 Saldo Akhir: ${formatCurrency(saldoAkhir)}

`;

    // Tambahkan rincian pengeluaran terakhir
    if (pengeluaranKategori.length > 0) {
      rekapMessage += `🔴 *Rincian Pengeluaran Terakhir:*\n`;
      for (let i = 0; i < Math.min(pengeluaranKategori.length, 5); i++) {
        const kategori = pengeluaranKategori[i] ? pengeluaranKategori[i][0] : '';
        const jumlah = pengeluaranJumlah[i] ? parseSpreadsheetNumber(pengeluaranJumlah[i][0]) : 0;
        
        if (kategori && jumlah > 0) {
          rekapMessage += `${i + 1}. ${kategori}: ${formatCurrency(jumlah)}\n`;
        }
      }
      rekapMessage += '\n';
    }

    // Tambahkan rincian pendapatan terakhir
    if (pendapatanKategori.length > 0) {
      rekapMessage += `🟢 *Rincian Pendapatan Terakhir:*\n`;
      for (let i = 0; i < Math.min(pendapatanKategori.length, 5); i++) {
        const kategori = pendapatanKategori[i] ? pendapatanKategori[i][0] : '';
        const jumlah = pendapatanJumlah[i] ? parseSpreadsheetNumber(pendapatanJumlah[i][0]) : 0;
        
        if (kategori && jumlah > 0) {
          rekapMessage += `${i + 1}. ${kategori}: ${formatCurrency(jumlah)}\n`;
        }
      }
    }

    // Tambahkan link spreadsheet
    rekapMessage += `\n🔗 [Lihat Detail Spreadsheet](${userData.spreadsheet_link})`;

    await ctx.replyWithMarkdown(rekapMessage);

  } catch (error) {
    console.error('Error in /rekap handler:', error);
    ctx.reply('❌ Terjadi kesalahan saat mengambil rekap. Silakan coba lagi.');
  }
});

bot.command('ai', async (ctx) => {
  const chatId = ctx.chat.id;
  const messageText = ctx.message?.text;
  
  if (!messageText) {
    return ctx.reply('❌ Format salah. Silakan ketik perintah seperti:\n/ai bagaimana cara menabung?');
  }

  const query = messageText.replace('/ai', '').trim();

  if (!query) {
    return ctx.reply('❌ Mohon ketik pertanyaan setelah perintah /ai.');
  }

  await ctx.reply('🤖 Sedang berpikir...');

  try {
    const aiResponse = await fetch(`${process.env.BASE_URL}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: String(chatId),
        message: query
      })
    });

    const result = await aiResponse.json();

    if (result.reply) {
      return ctx.reply(result.reply);
    } else {
      throw new Error(result.error || 'Jawaban kosong');
    }
  } catch (err) {
    console.error('Gagal menghubungi AI:', err);
    ctx.reply('❌ Gagal mendapatkan balasan dari AI.');
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

// Handler untuk foto
bot.on('photo', async (ctx) => {
  const chatId = ctx.chat.id;
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  
  try {
    // Proses foto secara sinkron dengan update status real-time
    await processPhotoSyncOptimized(ctx, chatId, photo.file_id);

  } catch (error) {
    console.error('Error in photo handler:', error);
    await ctx.reply(`❌ Terjadi kesalahan: ${error.message}\n\n🔄 Silakan coba lagi.`);
  }
});

// Tambahkan periodic cleanup untuk processingSet
setInterval(() => {
  console.log(`Processing set size: ${processingSet.size}`);
  // Set akan dibersihkan otomatis oleh timeout masing-masing proses
}, 60000); // Check setiap menit

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
      return ctx.reply('❌ Penyimpanan folder gagal. Pastikan folder sudah di share/bagikan ke email: uangku@financial-report-bot.iam.gserviceaccount.com dan memiliki izin sebagai EDITOR.\n\n📌 Jika sudah merasa benar, coba kirim ulang link folder.');
    }

    ctx.reply('✅ Folder berhasil diakses. Sedang membuat spreadsheet...');

    // Salin template spreadsheet
    const fileName = `Catatan Keuangan - ${firstName}`;
    const copyResult = await copyTemplateToFolder(folderId, fileName);
    
    if (!copyResult.success) {
      console.error('Template copy failed:', copyResult.error);
      return ctx.reply('❌ Gagal membuat spreadsheet catatan keuangan. Coba klik menu "Buka Spreadsheet" di bawah, jika spreadsheet berhasil dibuat silakan mulai mencatat. Atau cek manual di folder Drive Anda apakah spreadsheet template sudah dibuat. Jika belum ada spreadsheet,silakan coba lagi. Pastikan link folder Drive dibagikan ke email bot sebagai Editor bukan Viewer.');
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
🎉 <b>${isUpdate ? 'Folder berhasil diperbarui!' : 'Setup berhasil!'}</b> 🎉

📊 Spreadsheet catatan keuangan Anda telah dibuat dengan nama:
<b>${fileName}</b>

🔗 <b>Link Spreadsheet:</b>
${copyResult.url}

✅ Anda sekarang dapat mulai mencatat keuangan pribadi menggunakan spreadsheet tersebut.
Gunakan menu Bantuan di bawah untuk mempelajari cara mencatat keuangan.

💡 <b>Tips:</b> Bookmark link spreadsheet di atas untuk akses yang lebih mudah!
`;

console.log('📤 Sending success message...');
await ctx.reply(successMessage, { parse_mode: 'HTML' });
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
      res.status(200).json({ message: 'Bot is running on t.me/catatanuangkubot' });
    }
  } catch (error) {
    console.error('Handler error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
