import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FileAudio, 
  ChevronRight, 
  Search, 
  ArrowLeft,
  Loader2,
  FolderOpen
} from 'lucide-react';
import { listDriveFiles, fetchDriveFile } from '../lib/drive';
import { motion, AnimatePresence } from 'motion/react';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

interface DrivePickerProps {
  accessToken: string;
  onFileSelect: (file: Blob, name: string) => void;
  onClose: () => void;
}

export const DrivePicker: React.FC<DrivePickerProps> = ({ accessToken, onFileSelect, onClose }) => {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<{id: string, name: string}[]>([{id: 'root', name: '我的雲端硬碟'}]);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    fetchFiles(path[path.length - 1].id);
  }, [path]);

  const fetchFiles = async (folderId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDriveFiles(accessToken, folderId);
      // Sort: Folders first, then files
      const sorted = data.files.sort((a: DriveFile, b: DriveFile) => {
        const isAFolder = a.mimeType === 'application/vnd.google-apps.folder';
        const isBFolder = b.mimeType === 'application/vnd.google-apps.folder';
        if (isAFolder && !isBFolder) return -1;
        if (!isAFolder && isBFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(sorted);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleItemClick = async (file: DriveFile) => {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      setPath([...path, {id: file.id, name: file.name}]);
    } else {
      try {
        setDownloading(file.id);
        const blob = await fetchDriveFile(accessToken, file.id);
        onFileSelect(blob, file.name);
      } catch (err: any) {
        alert('下載檔案失敗：' + err.message);
      } finally {
        setDownloading(null);
      }
    }
  };

  const goBack = () => {
    if (path.length > 1) {
      setPath(path.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-col h-[500px] bg-[#151619]">
      <div className="p-4 border-b border-[#252830] flex items-center gap-3">
        {path.length > 1 ? (
          <button onClick={goBack} className="p-1 hover:bg-[#252830] rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
        ) : (
          <FolderOpen size={20} className="text-orange-500" />
        )}
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-1 text-xs text-[#8E9299]">
            {path.slice(-2).map((p, i) => (
              <React.Fragment key={p.id}>
                <span className="truncate max-w-[100px]">{p.name}</span>
                {i === 0 && path.length > 1 && <ChevronRight size={12} />}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-[#8E9299]">
            <Loader2 className="animate-spin" size={32} />
            <p className="text-sm">讀取檔案中...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <p className="text-red-400 text-sm mb-4">{error}</p>
            <button 
              onClick={() => fetchFiles(path[path.length - 1].id)}
              className="px-4 py-2 bg-[#252830] rounded-lg text-sm"
            >
              重試
            </button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#4a4d55]">
            <Folder size={48} className="mb-2 opacity-20" />
            <p className="text-sm">此資料夾內無支援的音訊檔案</p>
          </div>
        ) : (
          files.map(file => (
            <button
              key={file.id}
              onClick={() => handleItemClick(file)}
              disabled={!!downloading}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[#252830] transition-all text-left group disabled:opacity-50"
            >
              {file.mimeType === 'application/vnd.google-apps.folder' ? (
                <Folder className="text-blue-400 shrink-0" size={20} />
              ) : (
                <FileAudio className="text-orange-400 shrink-0" size={20} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#E2E8F0] font-medium truncate">{file.name}</p>
                {file.size && (
                  <p className="text-[10px] text-[#4a4d55]">
                    {Math.round(parseInt(file.size) / 1024 / 1024 * 100) / 100} MB
                  </p>
                )}
              </div>
              {downloading === file.id ? (
                <Loader2 className="animate-spin text-orange-500" size={16} />
              ) : file.mimeType === 'application/vnd.google-apps.folder' ? (
                <ChevronRight size={16} className="text-[#4a4d55] group-hover:text-white transition-colors" />
              ) : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
};
