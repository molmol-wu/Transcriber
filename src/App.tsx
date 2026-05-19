/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  FileAudio, 
  Upload, 
  Loader2, 
  CheckCircle2, 
  Copy, 
  Download, 
  Clock, 
  Users,
  AlertCircle,
  FileText,
  Settings,
  X,
  Cloud,
  ChevronRight as ChevronRightIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { sliceAudio } from './lib/audioProcessing';
import { initAuth, googleSignIn, logout as driveLogout } from './lib/drive';
import { DrivePicker } from './components/DrivePicker';
import { User } from 'firebase/auth';

interface TranscriptSegment {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  text?: string;
  error?: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [fullTranscript, setFullTranscript] = useState('');
  const [progress, setProgress] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [engine, setEngine] = useState<'gemini' | 'groq' | 'assemblyai'>('gemini');
  const [speakerHint, setSpeakerHint] = useState('');
  const [speakerCount, setSpeakerCount] = useState('2');
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [showIframeWarning, setShowIframeWarning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [userKeys, setUserKeys] = useState({
    gemini: '',
    groq: '',
    assemblyai: ''
  });

  // Persistence: Load from localStorage on mount
  React.useEffect(() => {
    const savedSegments = localStorage.getItem('segments');
    const savedFull = localStorage.getItem('fullTranscript');
    const savedInfo = localStorage.getItem('transcriptionInfo');
    const savedKeys = localStorage.getItem('userApiKeys');
    
    if (savedKeys) {
      try {
        setUserKeys(JSON.parse(savedKeys));
      } catch (e) {
        console.error('Failed to load user keys', e);
      }
    }
    
    if (savedSegments && savedFull) {
      try {
        setSegments(JSON.parse(savedSegments));
        setFullTranscript(savedFull);
        if (savedInfo) {
          const info = JSON.parse(savedInfo);
          setEngine(info.engine || 'gemini');
          setSpeakerHint(info.speakerHint || '');
          setSpeakerCount(info.speakerCount || '2');
        }
        setSessionId(localStorage.getItem('sessionId') || Date.now().toString());
      } catch (e) {
        console.error('Failed to load saved session', e);
      }
    }
  }, []);

  // Persistence: Save to localStorage whenever segments or transcript changes
  React.useEffect(() => {
    if (segments.length > 0) {
      localStorage.setItem('segments', JSON.stringify(segments));
      localStorage.setItem('fullTranscript', fullTranscript);
      localStorage.setItem('transcriptionInfo', JSON.stringify({
        engine, speakerHint, speakerCount
      }));
    }
  }, [segments, fullTranscript, engine, speakerHint, speakerCount]);

  // Recalculate full transcript whenever segments change
  React.useEffect(() => {
    const text = segments
      .filter(s => s.status === 'completed' && s.text)
      .map(s => s.text)
      .join('\n\n');
    setFullTranscript(text);
  }, [segments]);

  const scrollToBottomRef = useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (isProcessing) {
      scrollToBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isProcessing, segments]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Save keys to localStorage
  const saveUserKeys = (keys: typeof userKeys) => {
    setUserKeys(keys);
    localStorage.setItem('userApiKeys', JSON.stringify(keys));
    checkHealth(keys);
  };

  const getHeaders = (keys = userKeys) => {
    const headers: Record<string, string> = {};
    if (keys.gemini) headers['x-gemini-key'] = keys.gemini;
    if (keys.groq) headers['x-groq-key'] = keys.groq;
    if (keys.assemblyai) headers['x-assemblyai-key'] = keys.assemblyai;
    return headers;
  };

  const checkHealth = (keys = userKeys) => {
    fetch('/api/health', { headers: getHeaders(keys) })
      .then(res => res.json())
      .then(data => setIsConfigured(data.apiKeyConfigured))
      .catch(() => setIsConfigured(false));
  };

  // Check health and iframe status
  React.useEffect(() => {
    checkHealth();
    
    // Init Drive Auth
    const unsubscribe = initAuth(
      (user, token) => {
        setDriveUser(user);
        setDriveToken(token);
      },
      () => {
        setDriveUser(null);
        setDriveToken(null);
      }
    );

    if (window.self !== window.top) {
      setShowIframeWarning(true);
    }

    return () => unsubscribe();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setNewFile(selectedFile);
    }
  };

  const setNewFile = (selectedFile: File | Blob, name?: string) => {
    const fileToSet = selectedFile instanceof File ? selectedFile : new File([selectedFile], name || 'drive-audio.wav', { type: selectedFile.type });
    
    if (segments.length > 0 && !file) {
      setFile(fileToSet);
      return;
    }
    
    const proceed = segments.length === 0 || confirm('偵測到已有轉錄進度，更換檔案將會清除所有進度。確定嗎？');
    if (proceed) {
      setFile(fileToSet);
      setFullTranscript('');
      setSegments([]);
      setProgress(0);
      localStorage.removeItem('segments');
      localStorage.removeItem('fullTranscript');
    } else {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && droppedFile.type.startsWith('audio/')) {
      setNewFile(droppedFile);
    }
  };

  const retrySegment = async (id: number) => {
    if (!audioChunksRef.current[id]) {
      console.error(`Audio chunk for segment ${id} is missing`);
      setSegments(prev => prev.map(s => s.id === id ? { ...s, status: 'error', error: '找不到待處理的音訊片段，請嘗試恢復轉錄。' } : s));
      return;
    }
    
    console.log(`Retrying segment ${id}...`);
    
    try {
      setSegments(prev => prev.map(s => s.id === id ? { ...s, status: 'processing', error: undefined } : s));

      const formData = new FormData();
      formData.append('audio', audioChunksRef.current[id], `retry_segment_${id}.wav`);
      formData.append('engine', engine);
      
      const previousTexts = segments
        .filter(s => s.id < id && s.status === 'completed')
        .map(s => s.text)
        .join('\n');
      const lastSnippet = previousTexts.slice(-500);
      
      const context = `發言者提示：${speakerHint || '（未提供）'}\n預期說話者人數：${speakerCount}\n\n前段上下文：${lastSnippet}`;
      formData.append('speakerContext', context);
      formData.append('prompt', `這是音訊的重試部分（索引 ${id}）。請精準轉錄為繁體中文文字。`);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: getHeaders(),
        body: formData,
        signal: AbortSignal.timeout(180000) // 3 minute timeout for retry
      }).catch(err => {
        if (err.name === 'TimeoutError') throw new Error('伺服器回應逾時，請重試。');
        throw new Error('網路連線失敗 (Failed to fetch)，請檢查網路或嘗試在新分頁開啟。');
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        let errorMsg = '重試失敗';
        if (response.status === 429) {
          try {
            const errorData = JSON.parse(responseText);
            errorMsg = errorData.error || '速率限制已達上限，請稍後重試。';
          } catch (e) {
            errorMsg = 'API 頻率已達上限，建議切換引擎。';
          }
          errorMsg += " (建議更換引擎後重試)";
        } else if (responseText.includes('<!doctype html>') || responseText.includes('<html')) {
          errorMsg = '伺服器未預期回應 (HTML)。可能是因處理時間過長導致連線逾時，或伺服器正在重新啟動。請點擊「重試」或「跳過」。';
        } else if (responseText.includes('Cookie check') || responseText.includes('auth_flow_may_set_cookies')) {
          errorMsg = '存取失效 (Cookie check)，請點擊上方按鈕在新分頁開啟';
          setShowIframeWarning(true);
        } else {
          try {
            const data = JSON.parse(responseText);
            errorMsg = data.error || errorMsg;
          } catch(e) { 
            errorMsg = responseText.slice(0, 100) || errorMsg;
          }
        }
        throw new Error(errorMsg);
      }

      try {
        const data = JSON.parse(responseText);
        setSegments(prev => prev.map(s => s.id === id ? { ...s, status: 'completed', text: data.text } : s));
      } catch (e) {
        throw new Error(`回傳格式錯誤 (非 JSON)。回應開頭：${responseText.slice(0, 50)}...`);
      }
    } catch (error: any) {
      console.error(`Retry failed for segment ${id}:`, error);
      setSegments(prev => prev.map(s => s.id === id ? { ...s, status: 'error', error: error.message } : s));
    }
  };

  const startTranscription = async (resume = false) => {
    if (!file) {
      alert('請先點擊上方的「重新選擇檔案」以關聯音訊檔案。');
      fileInputRef.current?.click();
      return;
    }

    setIsProcessing(true);
    if (!resume) {
      setFullTranscript('');
      setProgress(0);
    }

    try {
      let audioChunks = audioChunksRef.current;
      let workingSegments = [...segments];
      
      if (!resume || audioChunks.length === 0) {
        // Step 1: Segmentation
        const SEGMENT_DURATION = 120; 
        audioChunks = await sliceAudio(file, SEGMENT_DURATION);
        audioChunksRef.current = audioChunks;
        
        workingSegments = audioChunks.map((_, i) => ({
          id: i,
          status: 'pending'
        }));
        setSegments(workingSegments);
      }

      let accumulatedScript = workingSegments
        .filter(s => s.status === 'completed')
        .map(s => s.text)
        .join('\n\n');

      // Helper for individual segment attempt with internal retry
      const processSegmentWithRetry = async (idx: number, retries = 1): Promise<string> => {
        try {
          setSegments(prev => prev.map(s => s.id === idx ? { ...s, status: 'processing', error: undefined } : s));

          const formData = new FormData();
          formData.append('audio', audioChunks[idx], `segment_${idx}.wav`);
          formData.append('engine', engine);
          
          const lastSnippet = accumulatedScript.slice(-500);
          const context = `發言者提示：${speakerHint || '（未提供）'}\n預期說話者人數：${speakerCount}\n\n前段上下文：${lastSnippet}`;
          formData.append('speakerContext', context);
          formData.append('prompt', `請完整精確地將這段音訊轉錄為文字。
你的輸出規範：
1. 格式：[時間戳記] 說話者：內容 (例如 [00:00:15] 陳先生：會議開始)
2. 語言：必須且僅能使用「正體中文」（繁體中文）。
3. 嚴格禁止：不要輸出任何關於指令的確認語彙（如「好的」、「收到」），也不要重複此指令。
4. 內容：如果沒有背景人聲，請回傳「（環境雜音）」。
這是長音檔的第 ${idx + 1} 部分。`);

          const response = await fetch('/api/transcribe', {
            method: 'POST',
            headers: getHeaders(),
            body: formData,
            signal: AbortSignal.timeout(240000) // 4 minutes
          }).catch(err => {
            if (err.name === 'TimeoutError') throw new Error('伺服器處理逾時 (4分鐘)，請重試。');
            throw new Error('網路連線失敗 (Failed to fetch)，可能是連線中斷或檔案太大。');
          });

          const responseText = await response.text();
          
          if (!response.ok) {
            let errorMsg = `伺服器錯誤: ${response.status}`;
            if (response.status === 429) {
              try {
                const errorData = JSON.parse(responseText);
                errorMsg = errorData.error || '速率限制已達上限，請稍後重試或切換引擎。';
              } catch (e) {
                errorMsg = 'API 頻率已達上限，建議切換引擎。';
              }
              // Add a hint to switch engine to error
              errorMsg += " (建議點擊「換 Gemini」重試)";
            } else if (responseText.includes('<!doctype html>') || responseText.includes('<html')) {
              errorMsg = '伺服器未預期回應 (HTML)。可能是因處理時間過長導致連線逾時，或伺服器正在重新啟動。請點擊「重試」或「跳過」。';
            } else if (responseText.includes('Cookie check') || responseText.includes('auth_flow_may_set_cookies')) {
              errorMsg = '存取失效，請點擊上方按鈕修復。';
              setShowIframeWarning(true);
            } else {
              try {
                const errorData = JSON.parse(responseText);
                errorMsg = errorData.error || errorMsg;
              } catch (e) {
                errorMsg = responseText.slice(0, 100) || errorMsg;
              }
            }
            throw new Error(errorMsg);
          }

          try {
            const data = JSON.parse(responseText);
            return data.text;
          } catch (e) {
            console.error('Failed to parse JSON from server response:', responseText);
            if (responseText.includes('<!doctype html>') || responseText.includes('<html')) {
              throw new Error('伺服器未預期回應 (HTML)。可能是因處理時間過長導致連線逾時，或伺服器正在重新啟動。請點擊「重試」或「跳過」。');
            }
            throw new Error(`回傳格式錯誤 (非 JSON)。回應開頭：${responseText.slice(0, 100)}...`);
          }
        } catch (err: any) {
          if (retries > 0 && err.message.includes('fetch')) {
            console.log(`Retrying segment ${idx}, ${retries} left...`);
            await new Promise(r => setTimeout(r, 2000));
            return processSegmentWithRetry(idx, retries - 1);
          }
          throw err;
        }
      };

      for (let i = 0; i < audioChunks.length; i++) {
        if (workingSegments[i]?.status === 'completed') continue;

        try {
          const segmentText = await processSegmentWithRetry(i);
          
          workingSegments[i] = { ...workingSegments[i], status: 'completed', text: segmentText };
          setSegments([...workingSegments]);
          accumulatedScript += (accumulatedScript ? '\n\n' : '') + segmentText;
          setProgress(Math.round(((i + 1) / audioChunks.length) * 100));
        } catch (error: any) {
          console.error(`Error in segment ${i}:`, error);
          workingSegments[i] = { ...workingSegments[i], status: 'error', error: error.message };
          setSegments([...workingSegments]);
          // Stop the sequence on error to prevent cascading errors or hitting quotas if something is fundamentally wrong
          break; 
        }
        
        // Small delay between segments to let browser/server breathe
        await new Promise(r => setTimeout(r, 800));
      }

    } catch (error: any) {
      console.error('Transcription flow error:', error);
    } finally {
      setIsProcessing(false);
    }
  };


  const resetAll = () => {
    if (confirm('確定要清除所有資料並重新開始嗎？')) {
      setFile(null);
      setSegments([]);
      setFullTranscript('');
      setProgress(0);
      setIsProcessing(false);
      audioChunksRef.current = [];
      localStorage.removeItem('segments');
      localStorage.removeItem('fullTranscript');
      localStorage.removeItem('transcriptionInfo');
      localStorage.removeItem('sessionId');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const skipSegment = (id: number) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, status: 'completed', text: '（已跳過此節段）' } : s));
  };

  const editSegmentText = (id: number, currentText: string) => {
    const newText = prompt('編輯逐字稿內容：', currentText);
    if (newText !== null) {
      setSegments(prev => prev.map(s => s.id === id ? { ...s, text: newText } : s));
    }
  };

  const markAsCompleted = (id: number) => {
    const text = prompt('請輸入此音段的逐字稿（可留空）：', '');
    if (text !== null) {
      setSegments(prev => prev.map(s => s.id === id ? { ...s, status: 'completed', text: text || '（手動完成）' } : s));
    }
  };

  const resumeFromHere = (id: number) => {
    if (!file) {
      alert('請先重新選擇音訊檔案！');
      return;
    }
    // Clear status of all segments from this id onwards
    setSegments(prev => prev.map(s => s.id >= id ? { ...s, status: 'pending', error: undefined } : s));
    startTranscription(true);
  };

  const retryAllErrors = async () => {
    const errorIds = segments.filter(s => s.status === 'error').map(s => s.id);
    if (errorIds.length === 0) return;
    
    setIsProcessing(true);
    for (const id of errorIds) {
      await retrySegment(id);
    }
    setIsProcessing(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(fullTranscript);
    alert('已複製到剪貼簿');
  };

  const downloadTranscript = () => {
    const blob = new Blob([fullTranscript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file?.name?.split('.')[0] || 'transcript'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e1e1e1] font-sans selection:bg-orange-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-[#252830] bg-[#151619] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-lg">
            <FileAudio className="text-white size-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">智音逐字稿</h1>
            <p className="text-xs text-[#8E9299] uppercase tracking-widest font-mono">AI Audio Transcriber</p>
          </div>
        </div>
        
        {fullTranscript && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-md hover:bg-[#252830] transition-colors text-[#8E9299] border border-[#252830]"
              title="API 設定"
            >
              <Settings size={20} />
            </button>
            <button 
              onClick={copyToClipboard}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-[#252830] transition-colors text-sm border border-[#252830]"
            >
              <Copy size={16} /> 複製
            </button>
            <button 
              onClick={downloadTranscript}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-orange-500 hover:bg-orange-600 text-white transition-colors text-sm"
            >
              <Download size={16} /> 下載 TXT
            </button>
          </div>
        )}
        
        {!fullTranscript && (
           <button 
             onClick={() => setShowSettings(true)}
             className="p-2 rounded-md hover:bg-[#252830] transition-colors text-[#8E9299] border border-[#252830]"
             title="API 設定"
           >
             <Settings size={20} />
           </button>
        )}
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-8">
        {/* Iframe Warning / Connection Error */}
        {(showIframeWarning || segments.some(s => s.status === 'error' && s.error?.includes('HTML'))) && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-orange-500 border border-orange-400 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 text-white shadow-xl"
          >
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-lg">
                <AlertCircle size={20} />
              </div>
              <div className="text-sm">
                <p className="font-bold">連線狀態優化建議</p>
                <p className="opacity-90">偵測到瀏覽器安全限制（如 Chrome 無痕或偏好設定），可能導致轉錄中斷。建議使用獨立分頁執行。</p>
              </div>
            </div>
            <button 
              onClick={() => window.open(window.location.href, '_blank')}
              className="px-6 py-2 bg-white text-orange-600 rounded-lg font-bold hover:bg-orange-50 transition-all text-sm whitespace-nowrap shadow-sm"
            >
              在新分頁中打開（解決 401/HTML 錯誤）
            </button>
          </motion.div>
        )}

        {/* API Key Warning */}
        {isConfigured === false && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/50 rounded-xl p-4 flex items-start gap-3 text-red-200 shadow-lg"
          >
            <AlertCircle className="shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold">API 金鑰未設定</p>
              <p className="opacity-80">請至 AI Studio 的 <strong>Settings</strong> 或 <strong>Secrets</strong> 面板設定相關 API 金鑰 (Gemini, Groq, AssemblyAI) 才能開始轉錄。</p>
            </div>
          </motion.div>
        )}

        {/* Connection Error / Cookie Check Help */}
        {segments.some(s => s.status === 'error' && s.error?.includes('HTML')) && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-orange-500/10 border border-orange-500/50 rounded-xl p-6 text-center space-y-4 shadow-xl"
          >
            <div className="flex justify-center">
              <div className="bg-orange-500 p-3 rounded-full text-white">
                <AlertCircle size={24} />
              </div>
            </div>
            <div className="max-w-md mx-auto">
              <h3 className="text-lg font-bold text-orange-200">連接中斷或需要身份驗證</h3>
              <p className="text-sm text-[#8E9299] mt-2">
                由於瀏覽器安全性限制（常見於 Chrome 無痕模式、Safari 或封鎖第三方 Cookie），導致 API 被攔截。請點擊下方按鈕以修復。
              </p>
            </div>
            <div className="flex justify-center gap-4">
              <button 
                onClick={() => window.open(window.location.href, '_blank')}
                className="px-6 py-2 bg-orange-500 rounded-lg text-white font-bold hover:bg-orange-600 transition-all text-sm"
              >
                在新視窗中驗證並繼續
              </button>
            </div>
          </motion.div>
        )}

        {/* Persistence Warning */}
        {segments.length > 0 && !file && !isProcessing && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-orange-500/10 border border-orange-500/50 rounded-xl p-4 flex items-center gap-3 text-orange-200 shadow-lg"
          >
            <AlertCircle className="shrink-0" size={18} />
            <div className="text-xs">
              <p className="font-bold">自動載入上次進度</p>
              <p className="opacity-80">請<strong>重新選擇音訊檔案</strong>，以便進行續傳或重做。</p>
            </div>
          </motion.div>
        )}

        {/* Upload Section */}
        {!isProcessing && (!fullTranscript || !file) && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`
              border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer
              ${file ? 'border-orange-500 bg-orange-500/5' : 'border-[#252830] hover:border-[#3a3e4b] bg-[#151619]'}
              ${fullTranscript && !file ? 'border-red-500/50 bg-red-500/5' : ''}
            `}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileChange}
              accept="audio/*"
            />
            <div className="flex flex-col items-center gap-4">
              <div className={`p-4 rounded-full ${file ? 'bg-orange-500 text-white' : 'bg-[#252830] text-[#8E9299]'}`}>
                <Upload size={32} />
              </div>
              <div>
                <p className="text-lg font-medium">
                  {file ? file.name : (fullTranscript ? '⚠️ 請重新選擇音訊檔案以繼續' : '點擊或拖放音檔到此處')}
                </p>
                <p className="text-sm text-[#8E9299] mt-1">
                  {fullTranscript && !file ? '瀏覽器重整後需重新關聯檔案才能繼續處理剩餘片段' : '支援 MP3, WAV, M4A 等常見格式'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-2" onClick={e => e.stopPropagation()}>
                {driveUser ? (
                  <div className="flex items-center gap-2 bg-[#1A1C23] border border-[#252830] p-1 pr-3 rounded-full">
                    {driveUser.photoURL && <img src={driveUser.photoURL} alt="" className="size-6 rounded-full" referrerPolicy="no-referrer" />}
                    <span className="text-[10px] text-[#8E9299] max-w-[80px] truncate">{driveUser.displayName}</span>
                    <button 
                      onClick={() => setShowDrivePicker(true)}
                      className="flex items-center gap-1 px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold rounded-full transition-all border border-blue-500/30"
                    >
                      <Cloud size={12} /> 雲端選檔
                    </button>
                    <button 
                       onClick={() => driveLogout()}
                       className="p-1 text-[#4a4d55] hover:text-red-400"
                       title="登出 Google"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={async () => {
                      try {
                        await googleSignIn();
                      } catch (err: any) {
                        alert(err.message);
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-[#1A1C23] hover:bg-[#252830] text-[#8E9299] hover:text-white text-xs font-bold rounded-full transition-all border border-[#252830]"
                  >
                    <Cloud size={14} className="text-blue-400" /> 連結 Google Drive
                  </button>
                )}
              </div>
              {file && (
                <div onClick={(e) => e.stopPropagation()} className="mt-6 w-full max-w-sm mx-auto space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-left">
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold text-orange-400 mb-1 block uppercase tracking-[0.1em]">
                        說話者與背景資訊 (選填)
                      </label>
                      <textarea 
                        value={speakerHint}
                        onChange={(e) => setSpeakerHint(e.target.value)}
                        placeholder="例如：主講人：王會計師，發言人：張秘書。這是一場審計工作底稿審查會。"
                        rows={2}
                        className="w-full bg-[#1A1C23] border border-[#2D3139] rounded-xl px-4 py-3 text-xs text-white focus:border-orange-500/50 focus:outline-none transition-all resize-none placeholder:text-[#4A4D55]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-orange-400 mb-1 block uppercase tracking-[0.1em]">
                        預估人數
                      </label>
                      <select 
                        value={speakerCount}
                        onChange={(e) => setSpeakerCount(e.target.value)}
                        className="w-full bg-[#1A1C23] border border-[#2D3139] rounded-xl px-4 py-2.5 text-xs text-white focus:border-orange-500/50 focus:outline-none transition-all"
                      >
                        {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} 人</option>)}
                        <option value="many">多人 (6+)</option>
                      </select>
                    </div>
                  </div>
                    <div className="flex bg-[#252830] p-1 rounded-xl w-full">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setEngine('gemini'); }}
                        className={`flex-1 px-3 py-2 rounded-lg text-[11px] transition-all ${engine === 'gemini' ? 'bg-orange-500 text-white' : 'text-[#8E9299]'}`}
                      >
                        Gemini
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setEngine('groq'); }}
                        className={`flex-1 px-3 py-2 rounded-lg text-[11px] transition-all ${engine === 'groq' ? 'bg-orange-500 text-white' : 'text-[#8E9299]'}`}
                      >
                        Groq
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); setEngine('assemblyai'); }}
                        className={`flex-1 px-3 py-2 rounded-lg text-[11px] transition-all ${engine === 'assemblyai' ? 'bg-orange-500 text-white' : 'text-[#8E9299]'}`}
                      >
                        AssemblyAI
                      </button>
                    </div>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        startTranscription();
                      }}
                      className="w-full px-8 py-3 rounded-full bg-orange-500 hover:bg-orange-600 text-white font-bold transition-all shadow-lg shadow-orange-500/20"
                    >
                      開始轉錄（{engine === 'gemini' ? 'Gemini' : engine === 'groq' ? 'Groq Whisper' : 'AssemblyAI'}）
                    </button>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Processing State */}
        {(isProcessing || segments.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-4">
              <div className="bg-[#151619] rounded-xl border border-[#252830] p-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#8E9299] mb-4 flex items-center gap-2">
                  <Clock size={14} /> 處理進度
                </h3>
                <div className="space-y-3">
                  {segments.map((segment) => (
                    <div key={segment.id} className="group flex items-center justify-between text-sm p-2 rounded bg-[#0f1115] hover:bg-[#1A1C23] transition-colors">
                      <span className="flex items-center gap-2">
                        {segment.status === 'processing' && <Loader2 size={14} className="animate-spin text-orange-500" />}
                        {segment.status === 'completed' && <CheckCircle2 size={14} className="text-green-500" />}
                        {segment.status === 'pending' && <div className="size-3.5 rounded-full border border-[#252830]" />}
                        {segment.status === 'error' && <AlertCircle size={14} className="text-red-500" />}
                        音段 {segment.id + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${segment.status === 'processing' ? 'text-orange-500' : 'text-[#8E9299]'}`}>
                          {segment.status === 'processing' ? '處理中...' : 
                           segment.status === 'completed' ? '已完成' : 
                           segment.status === 'error' ? '出錯' : '等待中'}
                        </span>
                        {segment.status === 'error' && !isProcessing && (
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex gap-1">
                              {segment.error?.includes('Groq') && engine === 'groq' && (
                                <div className="flex gap-1">
                                  <button 
                                    onClick={() => {
                                      setEngine('gemini');
                                      retrySegment(segment.id);
                                    }}
                                    className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded border border-blue-500/50 hover:bg-blue-500 hover:text-white transition-all shadow-sm"
                                  >
                                    換 Gemini
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setEngine('assemblyai');
                                      retrySegment(segment.id);
                                    }}
                                    className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded border border-purple-500/50 hover:bg-purple-500 hover:text-white transition-all shadow-sm"
                                  >
                                    換 Assembly
                                  </button>
                                </div>
                              )}
                              <button 
                                onClick={() => skipSegment(segment.id)}
                                className="text-[10px] bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded border border-gray-500/50 hover:bg-gray-500 hover:text-white transition-all shadow-sm"
                              >
                                跳過
                              </button>
                              <button 
                                onClick={() => retrySegment(segment.id)}
                                className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded border border-red-500/50 hover:bg-red-500 hover:text-white transition-all shadow-sm active:scale-95"
                              >
                                重試
                              </button>
                            </div>
                            {segment.error && (
                              <span className="text-[9px] text-red-400/70 mt-1 max-w-[120px] break-words text-right" title={segment.error}>
                                {segment.error}
                              </span>
                            )}
                          </div>
                        )}
                        {segment.status === 'completed' && !isProcessing && (
                           <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                             <button 
                               onClick={() => editSegmentText(segment.id, segment.text || '')}
                               className="text-[10px] text-[#8E9299] hover:text-orange-400"
                             >
                               編輯
                             </button>
                             <button 
                               onClick={() => resumeFromHere(segment.id)}
                               className="text-[10px] text-[#8E9299] hover:text-orange-400"
                             >
                               從此重做
                             </button>
                           </div>
                        )}
                        {segment.status === 'pending' && !isProcessing && (
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => markAsCompleted(segment.id)}
                              className="text-[10px] text-[#8E9299] hover:text-green-400"
                            >
                              標註完成
                            </button>
                            <button 
                              onClick={() => resumeFromHere(segment.id)}
                              className="text-[10px] text-[#8E9299] hover:text-orange-400"
                            >
                              從此開始
                            </button>
                          </div>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
                {isProcessing && (
                  <div className="mt-6">
                    <div className="flex justify-between text-xs mb-1 font-mono">
                      <span>總進度</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-[#252830] rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-orange-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
                
                <div className="flex flex-wrap gap-2 mt-4">
                  {!isProcessing && segments.length > 0 && segments.some(s => s.status !== 'completed') && (
                    <div className="bg-orange-500/10 border border-orange-500/30 p-3 rounded-lg mb-4 text-[11px] text-orange-200">
                      <p className="font-bold mb-1">💡 處理建議</p>
                      {segments.some(s => s.error?.includes('Groq')) ? (
                        <p>偵測到 Groq 頻率限制 (429)。建議您將引擎切換為「Gemini」或「AssemblyAI」，然後點擊「恢復轉錄」以繼續。</p>
                      ) : (
                        <p>如果頻繁出錯，可能是音檔過大或連線不穩。你可以嘗試「跳過」該音段再點擊「恢復轉錄」。</p>
                      )}
                    </div>
                  )}
                  
                  {!isProcessing && segments.some(s => s.status === 'error' || s.status === 'pending') && segments.length > 0 && (
                    <>
                      <button 
                        onClick={() => startTranscription(true)}
                        className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-orange-500/10 flex items-center justify-center gap-2"
                      >
                        恢復轉錄 (Resume)
                      </button>
                      <button 
                        onClick={retryAllErrors}
                        className="flex-1 py-2 bg-red-500/20 text-red-100 hover:bg-red-500 text-xs font-bold rounded-lg transition-all border border-red-500/50 flex items-center justify-center gap-2"
                      >
                        重試所有錯誤
                      </button>
                    </>
                  )}
                  {!isProcessing && (
                    <button 
                      onClick={resetAll}
                      className="w-full py-2 bg-[#252830] hover:bg-[#3a3e4b] text-[#8E9299] hover:text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2"
                    >
                      重新開始 (Reset)
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-[#151619] rounded-xl border border-[#252830] p-4 text-xs text-[#8E9299] space-y-4">
                <div className="flex items-center gap-2">
                  <Users size={14} /> <span>智慧說話者辨識</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={14} /> <span>精確時間戳記 [HH:MM:SS]</span>
                </div>
                <div className="flex items-center gap-2 text-orange-500 font-bold">
                  <AlertCircle size={14} /> <span>Gemini 1.5 Flash 驅動</span>
                </div>
              </div>

              <div className="bg-[#151619] rounded-xl border border-[#252830] p-4 space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#8E9299] flex items-center gap-2">
                  <AlertCircle size={14} /> 上傳與使用限制
                </h3>
                <ul className="text-xs text-[#8E9299] space-y-2 list-disc list-inside">
                  <li>單一檔案建議不要超過 200MB</li>
                  <li>自動分割間隔：2 分鐘（平衡穩定性與語法連貫性）</li>
                  <li>支援格式：MP3, WAV, M4A, AAC, OGG</li>
                  <li>由於 AI 處理需要時間，長音檔請耐心等候</li>
                  <li>若出現 413 錯誤，代表音檔格式密度過大，請嘗試先轉成低位元率 MP3</li>
                </ul>
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="bg-[#151619] rounded-xl border border-[#252830] min-h-[500px] flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-[#252830] flex items-center justify-between bg-[#1c1d22]">
                  <div className="flex items-center gap-2">
                    <FileText size={16} />
                    <span className="text-sm font-medium">逐字稿預覽</span>
                  </div>
                  {isProcessing && (
                    <div className="flex items-center gap-2 text-xs text-orange-500 font-mono">
                      <Loader2 size={12} className="animate-spin" />
                      正在生成...
                    </div>
                  )}
                </div>
                <div className="p-6 flex-1 overflow-auto max-h-[700px] prose prose-invert prose-orange max-w-none">
                  {fullTranscript ? (
                    <div className="markdown-body">
                      <Markdown>{fullTranscript}</Markdown>
                      <div ref={scrollToBottomRef} />
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center text-[#8E9299]">
                      <p className="text-center">
                        {isProcessing ? '正在拼湊音段中，請稍候...' : '音檔上傳後將顯示逐字稿'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer info */}
      <footer className="max-w-5xl mx-auto p-6 text-center text-[#4a4d55] text-xs">
        &copy; {new Date().getFullYear()} 智音逐字稿 &middot; Powered by Google Gemini 1.5 Flash &middot; 專業級 AI 語音轉文字工具
      </footer>

      {/* Drive Picker Modal */}
      <AnimatePresence>
        {showDrivePicker && driveToken && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#151619] border border-[#252830] rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-[#252830] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cloud className="text-blue-400" />
                  <h3 className="font-bold text-lg">選擇 Google Drive 檔案</h3>
                </div>
                <button onClick={() => setShowDrivePicker(false)} className="p-2 hover:bg-[#252830] rounded-full">
                  <X size={20} />
                </button>
              </div>
              
              <DrivePicker 
                accessToken={driveToken} 
                onFileSelect={(blob, name) => {
                  setNewFile(blob, name);
                  setShowDrivePicker(false);
                }} 
                onClose={() => setShowDrivePicker(false)} 
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-[#151619] border border-[#252830] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-[#252830] flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white">API 設定</h2>
                  <p className="text-xs text-[#8E9299]">設定您自己的 API 金鑰 (存於瀏覽器)</p>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-[#252830] rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-orange-400 uppercase tracking-wider">Gemini API Key</label>
                  <input 
                    type="password"
                    value={userKeys.gemini}
                    onChange={(e) => saveUserKeys({...userKeys, gemini: e.target.value})}
                    placeholder="貼上您的 Gemini API Key"
                    className="w-full bg-[#0f1115] border border-[#252830] rounded-xl px-4 py-3 text-sm focus:border-orange-500 focus:outline-none transition-all"
                  />
                  <p className="text-[10px] text-[#4a4d55]">用於高品質轉錄與說話者標註</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-orange-400 uppercase tracking-wider">Groq API Key</label>
                  <input 
                    type="password"
                    value={userKeys.groq}
                    onChange={(e) => saveUserKeys({...userKeys, groq: e.target.value})}
                    placeholder="貼上您的 Groq API Key"
                    className="w-full bg-[#0f1115] border border-[#252830] rounded-xl px-4 py-3 text-sm focus:border-orange-500 focus:outline-none transition-all"
                  />
                  <p className="text-[10px] text-[#4a4d55]">用於極速 Whisper 轉錄 (無標註)</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-orange-400 uppercase tracking-wider">AssemblyAI API Key</label>
                  <input 
                    type="password"
                    value={userKeys.assemblyai}
                    onChange={(e) => saveUserKeys({...userKeys, assemblyai: e.target.value})}
                    placeholder="貼上您的 AssemblyAI API Key"
                    className="w-full bg-[#0f1115] border border-[#252830] rounded-xl px-4 py-3 text-sm focus:border-orange-500 focus:outline-none transition-all"
                  />
                  <p className="text-[10px] text-[#4a4d55]">用於高精度多人對話識別</p>
                </div>
                
                <div className="bg-orange-500/10 border border-orange-500/20 p-3 rounded-lg flex gap-3 items-start">
                  <AlertCircle size={16} className="text-orange-500 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-orange-200/80">
                    注意：這些金鑰會儲存在您電腦的 LocalStorage 中，不會在上傳音檔以外的情形傳送至伺服器。若清空瀏覽器快取，則需重新設定。
                  </p>
                </div>
              </div>
              
              <div className="p-6 bg-[#1A1C23] border-t border-[#252830]">
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl transition-all shadow-lg shadow-orange-500/20"
                >
                  完成並儲存
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
