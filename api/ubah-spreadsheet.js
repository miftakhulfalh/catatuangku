import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 🔧 Ganti ini dengan template sheet yang kamu punya
const TEMPLATE_SPREADSHEET_ID = '1RhcbhF8_7KfFf8USC3zo_9PvE8BFq50b0dGsnsZ5w_g'; // ID spreadsheet sumber
const TEMPLATE_SHEET_ID = 1015531701; // ID sheet sumber yang ingin dicopy (bisa dapat dari metadata)

// Setup auth service account
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

const sheets = google.sheets({ version: 'v4', auth });

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { data: users, error } = await supabase
      .from('users_duplicate')
      .select('chat_id, spreadsheet_link');

    if (error) throw error;

    let success = 0;
    let failed = 0;

    for (const user of users) {
      try {
        const targetSpreadsheetId = extractSpreadsheetId(user.spreadsheet_link);
        if (!targetSpreadsheetId) {
          failed++;
          continue;
        }
    
        // STEP 0: Cek apakah sheet bernama "REKAP" sudah ada → hapus jika ada
        const meta = await sheets.spreadsheets.get({
          spreadsheetId: targetSpreadsheetId
        });
    
        const rekapSheet = meta.data.sheets.find(
          s => s.properties.title === 'REKAP'
        );
    
        if (rekapSheet) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId: targetSpreadsheetId,
            requestBody: {
              requests: [
                {
                  deleteSheet: {
                    sheetId: rekapSheet.properties.sheetId
                  }
                }
              ]
            }
          });
        }
    
        // STEP 1: Copy sheet dari template
        const copyResponse = await sheets.spreadsheets.sheets.copyTo({
          spreadsheetId: TEMPLATE_SPREADSHEET_ID,
          sheetId: TEMPLATE_SHEET_ID,
          requestBody: {
            destinationSpreadsheetId: targetSpreadsheetId
          }
        });
    
        const newSheetId = copyResponse.data.sheetId;
    
        // STEP 2: Rename sheet hasil copy jadi "REKAP"
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: targetSpreadsheetId,
          requestBody: {
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId: newSheetId,
                    title: 'REKAP'
                  },
                  fields: 'title'
                }
              }
            ]
          }
        });
    
        success++;
      } catch (err) {
        console.error('Gagal proses user:', user.chat_id, err.message);
        failed++;
      }
    }


    return res.status(200).json({
      message: `✅ Sheet berhasil dicopy & diubah ke ${success} user. ❌ Gagal di ${failed} user.`
    });

  } catch (err) {
    console.error('Fatal error:', err);
    return res.status(500).json({
      error: 'Gagal memproses',
      detail: err.message
    });
  }
}

// Fungsi untuk ekstrak spreadsheetId dari link
function extractSpreadsheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}
