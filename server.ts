import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { AssemblyAI } from 'assemblyai';
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Set up Multer for memory storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit per chunk
});

// Set up clients with fallbacks or lazy initialization
const getGenAI = (key?: string) => new GoogleGenerativeAI(key || process.env.GEMINI_API_KEY || "");
const getGroq = (key?: string) => new Groq({ apiKey: key || process.env.GROQ_API_KEY || "" });
const getAssemblyAI = (key?: string) => new AssemblyAI({ apiKey: key || process.env.ASSEMBLYAI_API_KEY || "" });

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Middleware to log requests (useful for debugging 404s/fallthroughs)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[API Request] ${req.method} ${req.path}`);
  }
  next();
});

// API: Health check
app.get("/api/health", (req, res) => {
  const hasGemini = (!!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY") || !!req.headers['x-gemini-key'];
  const hasGroq = (!!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== "") || !!req.headers['x-groq-key'];
  const hasAssemblyAI = (!!process.env.ASSEMBLYAI_API_KEY && process.env.ASSEMBLYAI_API_KEY !== "") || !!req.headers['x-assemblyai-key'];

  res.json({ 
    status: "ok", 
    apiKeyConfigured: hasGemini || hasGroq || hasAssemblyAI
  });
});

// API: Transcribe audio chunk
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    const { prompt, speakerContext, engine = "gemini" } = req.body;
    
    // Get keys from headers if provided
    const userGeminiKey = req.headers['x-gemini-key'] as string;
    const userGroqKey = req.headers['x-groq-key'] as string;
    const userAssemblyAIKey = req.headers['x-assemblyai-key'] as string;

    console.log(`[${timestamp}] [Transcribe] Engine: ${engine}, File: ${req.file?.originalname}, Size: ${req.file?.size} bytes`);
    
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    if (req.file.size > 50 * 1024 * 1024) { 
       return res.status(400).json({ error: "音段檔案太大 (超過 50MB)，請嘗試增加分割頻率。" });
    }

    if (engine === "groq") {
      const groqKey = userGroqKey || process.env.GROQ_API_KEY;
      if (!groqKey || groqKey === "MY_GROQ_API_KEY" || groqKey.trim() === "") {
        return res.status(500).json({ error: "Groq API 金鑰未正確設定。" });
      }

      const groqClient = getGroq(groqKey);
      // Groq Whisper needs the file as a Blob/File
      const transcription = await groqClient.audio.transcriptions.create({
        file: new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype }),
        model: "whisper-large-v3",
        response_format: "verbose_json",
        language: "zh",
        prompt: prompt || "這是一段關於會計師考試、審計、財務報表及董事會股東會內容的逐字稿。包含專業術語如：簽證、審計學、內稽內控、合併報表、證交法、公允價值、凱鈿行動科技、ADNEX、Workflow。請使用繁體中文。"
      });

      // Format Whisper response to include some structure
      const transcriptionAny = transcription as any;
      const formattedText = transcriptionAny.segments?.map((s: any) => {
        const time = new Date(s.start * 1000).toISOString().substr(11, 8);
        return `[${time}] ${s.text}`;
      }).join("\n") || transcription.text;

      return res.json({ text: formattedText });
    }

    if (engine === "assemblyai") {
      const aaiKey = userAssemblyAIKey || process.env.ASSEMBLYAI_API_KEY;
      if (!aaiKey || aaiKey.trim() === "") {
        return res.status(500).json({ error: "AssemblyAI API 金鑰未正確設定。" });
      }

      console.log(`[${timestamp}] [Transcribe] Using AssemblyAI for ${req.file.originalname}`);
      
      const aaiClient = getAssemblyAI(aaiKey);
      const transcript = await aaiClient.transcripts.transcribe({
        audio: req.file.buffer,
        language_code: "zh",
        speech_model: "universal-2" as any,
        speaker_labels: true,
        punctuate: true,
        format_text: true,
      });

      if (transcript.status === "error") {
        throw new Error(`AssemblyAI Error: ${transcript.error}`);
      }

      // Format with speaker labels if available
      let formattedText = "";
      if (transcript.utterances && transcript.utterances.length > 0) {
        formattedText = transcript.utterances.map(u => {
          const hours = Math.floor(u.start / 3600000);
          const minutes = Math.floor((u.start % 3600000) / 60000);
          const seconds = Math.floor((u.start % 60000) / 1000);
          const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
          return `[${time}] 說話者 ${u.speaker}: ${u.text}`;
        }).join("\n");
      } else {
        formattedText = transcript.text || "";
      }

      return res.json({ text: formattedText });
    }

    // Default to Gemini
    const apiKey = userGeminiKey || process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
      return res.status(500).json({ error: "Gemini API 金鑰尚未正確設定。" });
    }

    const modelName = "gemini-1.5-flash"; 
    console.log(`[${timestamp}] [Transcribe] Initializing Gemini model: ${modelName}`);

    const audioPart = {
      inlineData: {
        data: req.file.buffer.toString("base64"),
        mimeType: req.file.mimetype,
      },
    };

    const systemInstruction = `你是一位專業的繁體中文逐字稿專家、速記員與財會法律顧問。你的任務是將音訊轉換為高品質的繁體中文逐字稿，特別針對以下領域：會計師 (CPA) 考試、審計學、財務報表解析、董事會與股東會會議記錄。

必須嚴格執行以下要求：
1. **多人音軌識別 (Speaker Diarization)**：
   - 必須透過音聲特徵區分不同的說話者，格式為 [姓名/角色 或 說話者 n]。
   - 如果使用者提供了發言者資訊，請嘗試判斷並對號入座。
   - 即使說話者重疊，也要嘗試分行標註。
2. **精準時間戳記**：
   - 在每個說話者更換或長段落開始前標示 [HH:MM:SS]。
3. **專業術語校正**：
   - 確保公司與產品名稱正確：凱鈿行動科技股份有限公司 (Kdan Mobile)、Document、ADNEX、Workflow。
   - 財會專業術語：例如「簽證」、「內控」、「公允價值」、「保留意見」、「工作底稿」、「合併個體」。
   - 法律術語：例如「證交法」、「公司法」、「解任」、「決議」。
4. **格式規範**：
   - 排除無意義的口頭禪（如：那個、然後、呃...）。
   - 保持文句專業且流暢。
${speakerContext ? `\n上下文與預期發言者資訊：\n${speakerContext}` : ""}
`;

    const genAIClient = getGenAI(apiKey);
    const model = genAIClient.getGenerativeModel({ 
      model: modelName,
      systemInstruction,
    });

    console.log(`[${timestamp}] [Transcribe] Sending request to Gemini API...`);

    const result = await model.generateContent({
      contents: [{ 
        role: "user", 
        parts: [
          { text: prompt || "請逐字轉錄這段錄音，並標註說話者與時間點。" },
          audioPart 
        ] 
      }],
      generationConfig: {
        temperature: 0.2,
      },
    });

    const transcriptionText = result.response.text();
    console.log(`[${timestamp}] [Transcribe] Successfully got transcription (${transcriptionText.length} chars)`);
    res.json({ text: transcriptionText });
    } catch (error: any) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [Transcribe] Error:`, error);
    
    // Specific handling for Groq Rate Limits
    if (error.status === 429 || (error.message && error.message.includes("Rate limit"))) {
      let customMsg = "Groq 轉錄頻率已達上限 (429)。";
      if (error.message && error.message.includes("Please try again in")) {
        const timeMatch = error.message.match(/Please try again in ([^.]+)/);
        if (timeMatch) {
          customMsg += ` 請在 ${timeMatch[1]} 後重試，或切換至 Gemini 引擎繼續。`;
        }
      } else {
        customMsg += " 建議您切換至 Gemini 引擎以繼續轉錄。";
      }
      return res.status(429).json({ error: customMsg, isRateLimit: true });
    }

    res.status(500).json({ error: error.message || "Failed to transcribe audio" });
  }
});

// Global error handler for API routes to ensure JSON response
app.use((err: any, req: any, res: any, next: any) => {
  if (req.path.startsWith('/api/')) {
    console.error('API Error:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
    });
  }
  next(err);
});

// Vite middleware setup
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

setupVite();
