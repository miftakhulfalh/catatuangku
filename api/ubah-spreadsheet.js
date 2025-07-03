import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const TEMPLATE_SPREADSHEET_ID = '1RhcbhF8_7KfFf8USC3zo_9PvE8BFq50b0dGsnsZ5w_g'; // Ganti dengan ID spreadsheet template kamu
const TEMPLATE_SHEET_ID = 1015531701; // Ganti dengan sheetId dari sheet template (misal 0 untuk sheet pertama)

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

  const { chat_id } = req.query;
  const offset = parseInt(req.query.offset || '0', 10);
  const batchSize = 20;

  try {
    let users = [];

    if (chat_id) {
      // Mode per-user
      const { data, error } = await supabase
        .from('users_duplicate')
        .select('chat_id, spreadsheet_link')
        .eq('chat_id', Number(chat_id)) // atau .eq('chat_id', chat_id.trim()) jika string
        .single();


      if (error || !data) {
        return res.status(404).json({ error: 'User tidak ditemukan' });
      }

      users.push(data);
    } else {
      // Mode batch
      const { data, error } = await supabase
        .from('users_duplicate')
        .select('chat_id, spreadsheet_link')
        .range(offset, offset + batchSize - 1);

      if (error) throw error;
      users = data;
    }

    let success = 0;
    let failed = 0;

    for (const user of users) {
      try {
        const targetSpreadsheetId = extractSpreadsheetId(user.spreadsheet_link);
        if (!targetSpreadsheetId) {
          failed++;
          continue;
        }

        // Cek apakah sheet "REKAP" sudah ada
        const meta = await sheets.spreadsheets.get({
          spreadsheetId: targetSpreadsheetId
        });

        const rekapSheet = meta.data.sheets.find(
          s => s.properties.title === 'REKAP'
        );

        // Hapus jika sudah ada
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

        // Copy sheet dari template
        const copyResponse = await sheets.spreadsheets.sheets.copyTo({
          spreadsheetId: TEMPLATE_SPREADSHEET_ID,
          sheetId: TEMPLATE_SHEET_ID,
          requestBody: {
            destinationSpreadsheetId: targetSpreadsheetId
          }
        });

        const newSheetId = copyResponse.data.sheetId;

        // Rename sheet jadi "REKAP"
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
        console.error(`❌ Gagal proses ${user.chat_id}:`, err.message);
        failed++;
      }
    }

    return res.status(200).json({
      message: `✅ ${success} sukses, ❌ ${failed} gagal.`,
      mode: chat_id ? 'per-user' : 'batch',
      processed: users.length
    });

  } catch (err) {
    console.error('Fatal error:', err.message);
    return res.status(500).json({
      error: 'Gagal memproses permintaan',
      detail: err.message
    });
  }
}

function extractSpreadsheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}
