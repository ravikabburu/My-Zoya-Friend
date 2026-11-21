export interface EncryptedPayload {
  v: number;
  iv: string;
  ciphertext: string;
  timestamp: number;
}

export interface SessionKeyInfo {
  fingerprint: string;
  algorithm: string;
  keyLength: number;
  createdTime: number;
}

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

const SESSION_KEY_STORAGE_KEY = "zoya_crypto_session_key_jwk";
const CHAT_LOG_STORAGE_KEY = "zoya_encrypted_chat_logs";

let cachedKey: CryptoKey | null = null;
let cachedFingerprint: string | null = null;

/**
 * Gets or creates an AES-GCM 256-bit CryptoKey for the current session.
 * The key's JWK is synced across sessionStorage and localStorage so that encrypted
 * logs in localStorage can reliably be decrypted across tab reloads and browser sessions.
 */
export async function getOrCreateSessionKey(): Promise<{ key: CryptoKey; info: SessionKeyInfo }> {
  if (cachedKey && cachedFingerprint) {
    return {
      key: cachedKey,
      info: {
        fingerprint: cachedFingerprint,
        algorithm: "AES-GCM",
        keyLength: 256,
        createdTime: Date.now()
      }
    };
  }

  try {
    const existingJwk = sessionStorage.getItem(SESSION_KEY_STORAGE_KEY) || localStorage.getItem(SESSION_KEY_STORAGE_KEY);
    if (existingJwk) {
      const jwk = JSON.parse(existingJwk);
      const importedKey = await window.crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );
      cachedKey = importedKey;
      cachedFingerprint = await deriveFingerprint(jwk);
      // Keep in both storages to ensure persistence
      try {
        sessionStorage.setItem(SESSION_KEY_STORAGE_KEY, existingJwk);
        localStorage.setItem(SESSION_KEY_STORAGE_KEY, existingJwk);
      } catch (_) {}
      return {
        key: importedKey,
        info: {
          fingerprint: cachedFingerprint,
          algorithm: "AES-GCM",
          keyLength: 256,
          createdTime: Date.now()
        }
      };
    }
  } catch (err) {
    console.warn("Failed to load existing session key, generating a fresh one:", err);
  }

  // Generate new AES-GCM key
  const newKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const exportedJwk = await window.crypto.subtle.exportKey("jwk", newKey);
  const jwkString = JSON.stringify(exportedJwk);
  try {
    sessionStorage.setItem(SESSION_KEY_STORAGE_KEY, jwkString);
    localStorage.setItem(SESSION_KEY_STORAGE_KEY, jwkString);
  } catch (_) {}

  cachedKey = newKey;
  cachedFingerprint = await deriveFingerprint(exportedJwk);

  return {
    key: newKey,
    info: {
      fingerprint: cachedFingerprint,
      algorithm: "AES-GCM",
      keyLength: 256,
      createdTime: Date.now()
    }
  };
}

/**
 * Derive a short SHA-256 fingerprint from the JWK key string for visual verification in the UI.
 */
async function deriveFingerprint(jwk: JsonWebKey): Promise<string> {
  try {
    const rawString = jwk.k || JSON.stringify(jwk);
    const encoder = new TextEncoder();
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", encoder.encode(rawString));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return `SK-${hex.slice(0, 8).toUpperCase()}`;
  } catch (e) {
    return "SK-SESSION-ACTIVE";
  }
}

/**
 * Encrypts arbitrary serializable data into an AES-GCM encrypted payload blob using Web Crypto API.
 */
export async function encryptData<T>(data: T): Promise<string> {
  const { key } = await getOrCreateSessionKey();
  const jsonString = JSON.stringify(data);
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(jsonString);

  // Generate 12-byte random initialization vector
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedData
  );

  const envelope: EncryptedPayload = {
    v: 1,
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
    timestamp: Date.now()
  };

  return JSON.stringify(envelope);
}

/**
 * Decrypts an AES-GCM encrypted payload blob back to its original typed structure using the session key.
 */
export async function decryptData<T>(encryptedBlob: string): Promise<T> {
  const { key } = await getOrCreateSessionKey();
  const envelope: EncryptedPayload = JSON.parse(encryptedBlob);

  if (!envelope.iv || !envelope.ciphertext) {
    throw new Error("Invalid encrypted blob envelope format.");
  }

  const iv = new Uint8Array(base64ToArrayBuffer(envelope.iv));
  const ciphertext = base64ToArrayBuffer(envelope.ciphertext);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  const jsonString = decoder.decode(decryptedBuffer);
  return JSON.parse(jsonString) as T;
}

/**
 * Saves chat logs to localStorage as an encrypted blob.
 */
export async function saveEncryptedChatLogs<T>(logs: T[]): Promise<void> {
  try {
    const encryptedBlob = await encryptData(logs);
    localStorage.setItem(CHAT_LOG_STORAGE_KEY, encryptedBlob);
  } catch (err) {
    console.warn("Failed to encrypt and store chat logs:", err);
  }
}

/**
 * Loads and decrypts chat logs from localStorage using the user's session key.
 * If the stored blob was encrypted under an earlier, expired key or corrupted,
 * it cleans up the stale blob gracefully without throwing errors or breaking the app.
 */
export async function loadDecryptedChatLogs<T>(): Promise<{ logs: T[] | null; encryptedBlobRaw: string | null; keyFingerprint: string; error?: string }> {
  const { info } = await getOrCreateSessionKey();
  const rawBlob = localStorage.getItem(CHAT_LOG_STORAGE_KEY);

  if (!rawBlob) {
    return { logs: null, encryptedBlobRaw: null, keyFingerprint: info.fingerprint };
  }

  try {
    const logs = await decryptData<T[]>(rawBlob);
    return { logs, encryptedBlobRaw: rawBlob, keyFingerprint: info.fingerprint };
  } catch (err: any) {
    console.warn("Stored chat logs could not be decrypted with active session key. Resetting stale encrypted logs.", err);
    try {
      localStorage.removeItem(CHAT_LOG_STORAGE_KEY);
    } catch (_) {}
    return {
      logs: null,
      encryptedBlobRaw: null,
      keyFingerprint: info.fingerprint
    };
  }
}

/**
 * Get raw encrypted blob from localStorage for UI inspection/debugging.
 */
export function getRawEncryptedBlob(): string | null {
  return localStorage.getItem(CHAT_LOG_STORAGE_KEY);
}

/**
 * Purges encrypted chat logs from localStorage and generates a fresh session key if requested.
 */
export async function clearEncryptedStorage(regenerateKey: boolean = false): Promise<string> {
  try {
    localStorage.removeItem(CHAT_LOG_STORAGE_KEY);
  } catch (_) {}
  if (regenerateKey) {
    try {
      sessionStorage.removeItem(SESSION_KEY_STORAGE_KEY);
      localStorage.removeItem(SESSION_KEY_STORAGE_KEY);
    } catch (_) {}
    cachedKey = null;
    cachedFingerprint = null;
    const { info } = await getOrCreateSessionKey();
    return info.fingerprint;
  }
  return cachedFingerprint || "SK-SESSION-ACTIVE";
}
