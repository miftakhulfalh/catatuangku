// file: api/ai.js

import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    // 🔧 ambil raw body dan parse JSON
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const rawBody = Buffer.concat(buffers).toString();
    const body = JSON.parse(rawBody);

    const { userId, message } = body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'userId dan message wajib.' });
    }

    // ✅ Ambil riwayat chat user
    const { data: history, error } = await supabase
      .from('chat_memory')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(10);

    if (error) throw error;

    const messages = [
      { role: 'system', content: 'Kamu adalah asisten yang sangat kompeten. Jawab sesuai dengan bahasa yang digunakan oleh user, utamakan Bahasa Indonesia. Jawab semua pertanyaan atau pernyataan, terutama yang berkaitan dengan keuangan.' },
      ...(history || []),
      { role: 'user', content: message }
    ];

    const completion = await groq.chat.completions.create({
      model: 'llama3-8b-8192',
      messages
    });

    const reply = completion.choices?.[0]?.message?.content || '(tidak ada balasan)';

    // ✅ Simpan pesan ke Supabase
    await supabase.from('chat_memory').insert([
      { user_id: userId, role: 'user', content: message },
      { user_id: userId, role: 'assistant', content: reply }
    ]);

    return res.status(200).json({ reply });

  } catch (err) {
    console.error('AI error:', err);
    return res.status(500).json({ error: 'Gagal memproses permintaan AI.' });
  }
}
