import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';

// This will be populated by the platform or should be provided by the user if the platform fails
// For now, we'll try to find it or allow the user to enter their own if they want to use their own project
let firebaseConfig: any = null;

const loadConfig = async () => {
  try {
    // We use fetch instead of dynamic import to avoid build-time errors when the file is missing
    const response = await fetch('/firebase-applet-config.json');
    if (response.ok) {
      firebaseConfig = await response.json();
      initFirebase();
    }
  } catch (e) {
    console.warn('Firebase config load error (likely file not found):', e);
  }
};

loadConfig();

let auth: any = null;
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');

function initFirebase() {
  if (firebaseConfig && !auth) {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
  }
}

let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (!auth) {
    if (onAuthFailure) onAuthFailure();
    return () => {};
  }
  
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (!auth) {
    throw new Error('Firebase Auth 未初始化。請稍後再試或檢查設定。');
  }
  
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('無法從 Firebase Auth 取得 access token');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  if (auth) {
    await auth.signOut();
  }
  cachedAccessToken = null;
};

export const listDriveFiles = async (accessToken: string, folderId = 'root') => {
  const query = `'${folderId}' in parents and (mimeType contains 'audio/' or mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.folder') and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,size)&pageSize=50`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error?.message || '無法讀取 Google Drive 檔案');
  }
  
  return await res.json();
};

export const fetchDriveFile = async (accessToken: string, fileId: string) => {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (!res.ok) {
    throw new Error('下載 Google Drive 檔案失敗');
  }
  
  return await res.blob();
};
