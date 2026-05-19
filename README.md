# AI 語音轉文字逐字稿工具 (AI Audio Transcriber)

這是一個基於 Google Gemini 1.5 Flash 與 Groq Whisper 的專業級語音轉文字工具。支援大檔案分割處理、段落重點分析、以及 Google Drive 雲端檔案串接。

## 核心功能
- **多平台模型支援**：可切換使用 Google Gemini 或 Groq 模型進行轉錄。
- **Google Drive 整合**：直接從雲端硬碟選取音訊檔案，無需手動上傳。
- **自動存檔**：轉錄進度會自動儲存在瀏覽器中，不小心重新整理也不怕丟失。
- **Markdown 輸出**：轉錄結果支援 Markdown 格式，方便複製到 Notion 或 Obsidian。

## 開發者指南：如何在本地執行

如果您是從 GitHub 或 ZIP 取得此專案，請依照以下步驟設定：

### 1. 安裝環境
確保您的電腦已安裝 [Node.js](https://nodejs.org/) (建議 v18 以上)。

在專案目錄執行：
```bash
npm install
```

### 2. 設定環境變數
將 `.env.example` 重新命名為 `.env`，並填入您的 API Keys：
- `GEMINI_API_KEY`: 從 [Google AI Studio](https://aistudio.google.com/app/apikey) 取得。
- `VITE_GROQ_API_KEY`: 從 [Groq Console](https://console.groq.com/keys) 取得 (選填)。

### 3. Google Drive / Firebase 設定
如果您要使用 Google Drive 功能，您需要建立一個 Firebase 專案並啟用 Google 登入與 Drive 權限：
1. 在專案根目錄放置 `firebase-applet-config.json`。
2. 確保 Firebase 設定中包含 `https://www.googleapis.com/auth/drive.readonly` 權限範圍。

### 4. 啟動開發伺服器
```bash
npm run dev
```
啟動後開啟 `http://localhost:3000` 即可預覽。

### 5. 建置生產版本
```bash
npm run build
npm start
```

## 技術棧
- **Frontend**: React, Vite, Tailwind CSS, Lucide React, Framer Motion
- **Backend**: Express (用於代理 API 請求，保護 API Key)
- **AI**: Google Generative AI (Gemini), Groq API
