import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type QuestionType = 'pg' | 'pg_kompleks' | 'isian' | 'benar_salah';
type DifficultyLevel = 'standar' | 'hots' | 'dasar';

interface BatchSpec {
  type: QuestionType;
  count: number;
}

interface RawAiQuestion {
  type?: string;
  topic?: string;
  question?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  optionE?: string;
  correctKey?: string;
  correctKeys?: string[];
  explanation?: string;
}

export interface NormalizedQuestion {
  type: QuestionType;
  topic: string;
  question: string;
  options?: {
    A: string;
    B: string;
    C: string;
    D: string;
    E: string;
  };
  answer: string | string[];
  explanation: string;
}

const ALLOWED_TYPES: ReadonlySet<string> = new Set(['pg', 'pg_kompleks', 'isian', 'benar_salah']);
const ALLOWED_DIFFICULTIES: ReadonlySet<string> = new Set(['standar', 'hots', 'dasar']);
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;

let cachedAiClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedAiClient || cachedApiKey !== apiKey) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return cachedAiClient;
}

function cleanText(val: unknown, maxLen: number): string {
  return String(val ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function pickTopicFromSyllabus(rawTopic: string, syllabusItems: string[], fallbackIdx: number): string {
  const cleaned = cleanText(rawTopic, 250);
  if (cleaned) {
    const exact = syllabusItems.find((s) => s.toLowerCase() === cleaned.toLowerCase());
    if (exact) return exact;
    const partial = syllabusItems.find(
      (s) => s.toLowerCase().includes(cleaned.toLowerCase()) || cleaned.toLowerCase().includes(s.toLowerCase())
    );
    if (partial) return partial;
  }
  return syllabusItems[fallbackIdx % syllabusItems.length];
}

function normalizeAiQuestion(
  raw: RawAiQuestion,
  expectedType: QuestionType | undefined,
  syllabusItems: string[],
  idx: number
): NormalizedQuestion | null {
  const rawType = cleanText(raw?.type, 30).toLowerCase();
  const type: QuestionType = ALLOWED_TYPES.has(rawType)
    ? (rawType as QuestionType)
    : expectedType || 'pg';

  const question = cleanText(raw?.question, 900);
  if (!question || question.length < 10) return null;

  const topic = pickTopicFromSyllabus(raw?.topic || '', syllabusItems, idx);
  const explanation = cleanText(raw?.explanation, 500) || `Pembahasan terkait materi ${topic}.`;

  if (type === 'pg') {
    const options = {
      A: cleanText(raw?.optionA, 350),
      B: cleanText(raw?.optionB, 350),
      C: cleanText(raw?.optionC, 350),
      D: cleanText(raw?.optionD, 350),
      E: cleanText(raw?.optionE, 350),
    };
    if (!options.A || !options.B || !options.C || !options.D || !options.E) return null;

    let answer = cleanText(raw?.correctKey, 10).toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E'].includes(answer)) {
      const fromArr = Array.isArray(raw?.correctKeys) ? cleanText(raw.correctKeys[0], 10).toUpperCase() : '';
      answer = ['A', 'B', 'C', 'D', 'E'].includes(fromArr) ? fromArr : 'A';
    }

    return { type: 'pg', topic, question, options, answer, explanation };
  }

  if (type === 'pg_kompleks') {
    const options = {
      A: cleanText(raw?.optionA, 350),
      B: cleanText(raw?.optionB, 350),
      C: cleanText(raw?.optionC, 350),
      D: cleanText(raw?.optionD, 350),
      E: cleanText(raw?.optionE, 350),
    };
    if (!options.A || !options.B || !options.C || !options.D || !options.E) return null;

    const rawKeys = Array.isArray(raw?.correctKeys)
      ? raw.correctKeys
      : cleanText(raw?.correctKey, 30)
          .split(/[,;|\s]+/)
          .filter(Boolean);

    let keys = Array.from(
      new Set(
        rawKeys
          .map((k) => cleanText(k, 5).toUpperCase())
          .filter((k) => OPTION_KEYS.includes(k as (typeof OPTION_KEYS)[number]))
      )
    ).sort();

    if (keys.length < 2) {
      keys = keys.length === 1 && keys[0] !== 'A' ? ['A', keys[0]].sort() : ['A', 'B'];
    }

    const formattedQuestion = question.toLowerCase().includes('lebih dari satu')
      ? question
      : `${question} (Jawaban lebih dari satu)`;

    return { type: 'pg_kompleks', topic, question: formattedQuestion, options, answer: keys, explanation };
  }

  if (type === 'isian') {
    const keyStr = cleanText(raw?.correctKey, 40).replace(',', '.');
    const numericMatch = keyStr.match(/-?\d+(\.\d+)?/);
    if (!numericMatch) return null;
    const answer = numericMatch[0];
    const formattedQuestion = question.toLowerCase().includes('angka saja')
      ? question
      : `${question} (Tuliskan angka saja)`;

    return { type: 'isian', topic, question: formattedQuestion, answer, explanation };
  }

  if (type === 'benar_salah') {
    const lower = cleanText(raw?.correctKey, 20).toLowerCase();
    let answer: 'Benar' | 'Salah' = 'Benar';
    if (lower.includes('salah') || lower === 'false' || lower === 's') {
      answer = 'Salah';
    } else if (lower.includes('benar') || lower === 'true' || lower === 'b') {
      answer = 'Benar';
    } else {
      return null;
    }

    return { type: 'benar_salah', topic, question, answer, explanation };
  }

  return null;
}

function buildGenerationPrompt(params: {
  subject: string;
  mainTopic: string;
  syllabusItems: string[];
  batchSpecs: BatchSpec[];
  difficulty: DifficultyLevel;
  customInstruction: string;
  batchIndex: number;
  totalBatches: number;
  avoidSummaries: string[];
}): string {
  const totalCount = params.batchSpecs.reduce((sum, s) => sum + s.count, 0);
  const specLines = params.batchSpecs
    .map((s) => {
      if (s.type === 'pg') {
        return `- ${s.count} soal bertipe "pg" (Pilihan Ganda 5 opsi A, B, C, D, E; 1 kunci jawaban paling tepat di correctKey; distribusikan kunci jawaban secara seimbang antara A, B, C, D, dan E).`;
      }
      if (s.type === 'pg_kompleks') {
        return `- ${s.count} soal bertipe "pg_kompleks" (Pilihan Ganda Kompleks 5 opsi A, B, C, D, E; 2 sampai 4 jawaban benar pada array correctKeys; akhiri pertanyaan dengan "(Jawaban lebih dari satu)").`;
      }
      if (s.type === 'isian') {
        return `- ${s.count} soal bertipe "isian" (Isian Singkat dengan jawaban PASTI BERUPA ANGKA TUNGGAL pada correctKey, misal "25" atau "120"; akhiri pertanyaan dengan "(Tuliskan angka saja)").`;
      }
      return `- ${s.count} soal bertipe "benar_salah" (Pernyataan deklaratif yang jelas benar atau salahnya; correctKey tepat "Benar" atau "Salah").`;
    })
    .join('\n');

  const difficultyGuide =
    params.difficulty === 'hots'
      ? 'Tingkat Kesulitan: HOTS (C4-C5) — utamakan studi kasus, analisis, penerapan konsep, dan penalaran logis.'
      : params.difficulty === 'dasar'
        ? 'Tingkat Kesulitan: Dasar (C1-C2) — fokus pada pemahaman definisi, konsep inti, dan identifikasi langsung.'
        : 'Tingkat Kesulitan: Standar Kurikulum Merdeka (Seimbang antara pemahaman konsep C1-C2 dan penerapan/analisis C3-C4).';

  const syllabusLines = params.syllabusItems.map((item, i) => `${i + 1}. ${item}`).join('\n');
  const avoidBlock =
    params.avoidSummaries.length > 0
      ? `\nHindari mengulang topik/kalimat pertanyaan yang mirip dengan daftar soal berikut:\n- ${params.avoidSummaries.join('\n- ')}`
      : '';

  const customBlock = params.customInstruction
    ? `\nInstruksi Tambahan Admin: ${params.customInstruction}`
    : '';

  return [
    `Anda adalah penyusun soal ujian resmi CBT dalam Bahasa Indonesia yang sangat teliti dan akurat.`,
    `Buat TEPAT ${totalCount} butir soal ujian baru (Batch ${params.batchIndex} dari ${params.totalBatches}) yang 100% sesuai dengan Cakupan Materi berikut:`,
    ``,
    `Mata Pelajaran: ${params.subject}`,
    `Materi Pokok: ${params.mainTopic}`,
    `Cakupan Materi (field "topic" WAJIB menggunakan salah satu teks persis dari daftar ini dan tersebar merata):`,
    syllabusLines,
    ``,
    difficultyGuide,
    customBlock,
    ``,
    `Komposisi soal yang WAJIB dihasilkan pada batch ini (total ${totalCount} soal, sesuai urutan):`,
    specLines,
    ``,
    `Aturan Ketat Format JSON:`,
    `1. Semua pertanyaan, pilihan jawaban, dan pembahasan ditulis dalam Bahasa Indonesia yang baku, jelas, dan tidak ambigu.`,
    `2. Setiap soal WAJIB memiliki pembahasan singkat (field "explanation") yang menjelaskan mengapa kunci jawabannya benar.`,
    `3. Untuk tipe "pg" dan "pg_kompleks", kelima opsi (optionA s.d. optionE) wajib diisi lengkap dan tidak boleh kosong atau sama persis.`,
    `4. Untuk tipe "isian", jawaban (correctKey) HARUS hanya angka (tanpa satuan atau kata tambahan).`,
    `5. Untuk tipe "benar_salah", jawaban (correctKey) HARUS tepat "Benar" atau "Salah".`,
    avoidBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

async function generateBatchWithRetry(
  ai: GoogleGenAI,
  prompt: string,
  expectedCount: number,
  expectedTypes: QuestionType[],
  syllabusItems: string[],
  maxAttempts = 3
): Promise<NormalizedQuestion[]> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Anda adalah generator soal ujian CBT profesional. Kembalikan hanya array JSON valid sesuai skema tanpa teks di luar JSON.',
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  description: 'Salah satu dari: pg, pg_kompleks, isian, benar_salah',
                },
                topic: {
                  type: Type.STRING,
                  description: 'Butir materi dari daftar Cakupan Materi',
                },
                question: {
                  type: Type.STRING,
                  description: 'Teks pertanyaan lengkap',
                },
                optionA: { type: Type.STRING },
                optionB: { type: Type.STRING },
                optionC: { type: Type.STRING },
                optionD: { type: Type.STRING },
                optionE: { type: Type.STRING },
                correctKey: {
                  type: Type.STRING,
                  description: 'Untuk pg: A/B/C/D/E; isian: angka saja; benar_salah: Benar atau Salah',
                },
                correctKeys: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Untuk pg_kompleks: array huruf kunci benar (A-E)',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Pembahasan singkat kunci jawaban',
                },
              },
              required: ['type', 'topic', 'question', 'explanation'],
            },
          },
        },
      });

      const rawText = (response.text ?? '[]').trim();
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        throw new Error('Respons AI bukan array JSON.');
      }

      const normalized: NormalizedQuestion[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const expectedType = expectedTypes[i] || expectedTypes[expectedTypes.length - 1] || 'pg';
        const item = normalizeAiQuestion(parsed[i], expectedType, syllabusItems, i);
        if (item) normalized.push(item);
      }

      if (normalized.length === 0) {
        throw new Error('AI tidak menghasilkan butir soal yang memenuhi format.');
      }

      return normalized.slice(0, expectedCount);
    } catch (err) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNonRetryable =
        errMsg.includes('API_KEY_INVALID') ||
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('NOT_FOUND') ||
        errMsg.includes('403') ||
        errMsg.includes('404');

      if (isNonRetryable || attempt >= maxAttempts) {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gagal menghasilkan soal AI.');
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '256kb' }));

  app.post('/api/ai/generate-questions', async (req: Request, res: Response) => {
    try {
      const requestedWith = req.get('X-Requested-With');
      if (requestedWith !== 'CBT-MAZRO-Admin') {
        res.status(403).json({ error: 'Permintaan hanya diizinkan dari Portal Admin CBT MAZRO.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY belum tersedia. Pastikan API key sudah dikonfigurasi di panel Settings > Secrets.',
        });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const subject = cleanText(body.subject, 160);
      const mainTopic = cleanText(body.mainTopic, 300);

      if (!subject || !mainTopic) {
        res.status(400).json({ error: 'Mata Pelajaran dan Materi Pokok wajib tersedia di Cakupan Materi.' });
        return;
      }

      const rawSyllabus = Array.isArray(body.syllabusItems) ? body.syllabusItems : [];
      const syllabusItems: string[] = rawSyllabus
        .map((s: unknown) => cleanText(s, 250))
        .filter((s: string) => s.length > 0)
        .slice(0, 30);

      if (syllabusItems.length === 0) {
        res.status(400).json({ error: 'Minimal harus ada satu poin pada Cakupan Materi Ujian.' });
        return;
      }

      const rawSpecs = Array.isArray(body.batchSpecs) ? body.batchSpecs : [];
      const batchSpecs: BatchSpec[] = [];
      let totalRequested = 0;

      for (const spec of rawSpecs) {
        if (!spec || typeof spec !== 'object') continue;
        const typeStr = cleanText((spec as Record<string, unknown>).type, 30).toLowerCase();
        const countNum = Number((spec as Record<string, unknown>).count);
        if (!ALLOWED_TYPES.has(typeStr)) continue;
        if (!Number.isInteger(countNum) || countNum < 1 || countNum > 25) continue;
        batchSpecs.push({ type: typeStr as QuestionType, count: countNum });
        totalRequested += countNum;
      }

      if (batchSpecs.length === 0 || totalRequested < 1 || totalRequested > 25) {
        res.status(400).json({ error: 'Jumlah soal per batch harus antara 1 sampai 25 butir.' });
        return;
      }

      const difficultyRaw = cleanText(body.difficulty, 20).toLowerCase();
      const difficulty: DifficultyLevel = ALLOWED_DIFFICULTIES.has(difficultyRaw)
        ? (difficultyRaw as DifficultyLevel)
        : 'standar';

      const customInstruction = cleanText(body.customInstruction, 500);
      const batchIndex = Math.max(1, Number.isInteger(Number(body.batchIndex)) ? Number(body.batchIndex) : 1);
      const totalBatches = Math.max(batchIndex, Number.isInteger(Number(body.totalBatches)) ? Number(body.totalBatches) : 1);
      const avoidSummaries = Array.isArray(body.avoidSummaries)
        ? body.avoidSummaries.map((s: unknown) => cleanText(s, 120)).filter(Boolean).slice(-60)
        : [];

      const expectedTypes: QuestionType[] = [];
      batchSpecs.forEach((spec) => {
        for (let i = 0; i < spec.count; i++) {
          expectedTypes.push(spec.type);
        }
      });

      const prompt = buildGenerationPrompt({
        subject,
        mainTopic,
        syllabusItems,
        batchSpecs,
        difficulty,
        customInstruction,
        batchIndex,
        totalBatches,
        avoidSummaries,
      });

      const questions = await generateBatchWithRetry(
        ai,
        prompt,
        totalRequested,
        expectedTypes,
        syllabusItems
      );

      res.json({ questions });
    } catch (err) {
      console.error('Error generating AI questions:', err);
      const rawMsg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menghubungi layanan AI.';

      if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('403')) {
        res.status(403).json({
          error: 'Akses Gemini API ditolak atau API key tidak valid. Periksa GEMINI_API_KEY di panel Settings > Secrets.',
        });
        return;
      }
      if (rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('429')) {
        res.status(429).json({
          error: 'Kuota permintaan AI sedang penuh (429). Silakan tunggu beberapa saat dan coba lagi.',
        });
        return;
      }

      res.status(502).json({
        error: `Gagal menghasilkan soal dari AI: ${rawMsg.slice(0, 220)}`,
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`CBT ONLINE MAZRO server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
