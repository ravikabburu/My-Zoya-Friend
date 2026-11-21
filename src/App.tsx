import React, { useState, useEffect, useRef } from "react";
import { 
  Mic, MicOff, Power, Play, Square, Volume2, VolumeX, Sparkles, 
  Globe, Info, MessageCircle, RefreshCw, Compass, ShieldAlert, ShieldCheck, Lock, Key, Heart, Activity, Flame, HelpCircle, X, Download,
  ScreenShare, ScreenShareOff
} from "lucide-react";
import { AudioQueuePlayer, pcmToBase64 } from "./utils/audio";
import { 
  saveEncryptedChatLogs, 
  loadDecryptedChatLogs, 
  getRawEncryptedBlob, 
  clearEncryptedStorage 
} from "./utils/crypto";
import { motion, AnimatePresence } from "motion/react";
import { ParticleField } from "./components/ParticleField";

type Mood = "Playful" | "Focused" | "Teasing" | "Empathetic";

interface MoodTheme {
  name: Mood;
  gradient: string;
  glow: string;
  statusText: string;
  tagline: string;
  subText: string;
  orbScale: number;
  accentColor: string;
  secondaryColor: string;
  glowColor: string;
}

const MOODS: Record<Mood, MoodTheme> = {
  Playful: {
    name: "Playful",
    gradient: "radial-gradient(circle at center, rgba(255, 0, 119, 0.15) 0%, rgba(255, 0, 119, 0.03) 60%, transparent 100%)",
    glow: "rgba(255, 0, 119, 0.3) 0px 0px 40px, inset 0 0 20px rgba(255, 0, 119, 0.15)",
    statusText: "Feeling Playful",
    tagline: "Go on, I'm all ears...",
    subText: "Try to keep it interesting, babe. I get bored easily.",
    orbScale: 1.05,
    accentColor: "#ff0077",
    secondaryColor: "#00ffaa",
    glowColor: "#ff0077"
  },
  Focused: {
    name: "Focused",
    gradient: "radial-gradient(circle at center, rgba(0, 229, 255, 0.15) 0%, rgba(0, 229, 255, 0.03) 60%, transparent 100%)",
    glow: "rgba(0, 229, 255, 0.3) 0px 0px 40px, inset 0 0 20px rgba(0, 229, 255, 0.15)",
    statusText: "Highly Focused",
    tagline: "Alright, let's solve this.",
    subText: "Give me your hardest question, darling. I'm locked in.",
    orbScale: 1.0,
    accentColor: "#00e5ff",
    secondaryColor: "#ff0077",
    glowColor: "#00e5ff"
  },
  Teasing: {
    name: "Teasing",
    gradient: "radial-gradient(circle at center, rgba(255, 93, 0, 0.15) 0%, rgba(255, 93, 0, 0.03) 60%, transparent 100%)",
    glow: "rgba(255, 93, 0, 0.3) 0px 0px 40px, inset 0 0 20px rgba(255, 93, 0, 0.15)",
    statusText: "Teasing Active",
    tagline: "Are you blushing, sweetie?",
    subText: "Playful sarcasm is my default. Let's see if you can keep up.",
    orbScale: 1.08,
    accentColor: "#ff5d00",
    secondaryColor: "#00ffaa",
    glowColor: "#ff5d00"
  },
  Empathetic: {
    name: "Empathetic",
    gradient: "radial-gradient(circle at center, rgba(0, 255, 170, 0.15) 0%, rgba(0, 255, 170, 0.03) 60%, transparent 100%)",
    glow: "rgba(0, 255, 170, 0.3) 0px 0px 40px, inset 0 0 20px rgba(0, 255, 170, 0.15)",
    statusText: "Soft & Empathetic",
    tagline: "I'm listening. Tell me everything.",
    subText: "No sarcasm, I promise. Tell me about your day or what's on your mind.",
    orbScale: 1.02,
    accentColor: "#00ffaa",
    secondaryColor: "#ff0077",
    glowColor: "#00ffaa"
  }
};

interface ToolLog {
  id: string;
  type: "system" | "mood" | "browser";
  title: string;
  details: string;
  timestamp: Date;
}

export default function App() {
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const [isOrbHovered, setIsOrbHovered] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [micVolume, setMicVolume] = useState(0);
  const targetVolumeRef = useRef(0);
  const [currentMood, setCurrentMood] = useState<Mood>("Playful");
  const [activeState, setActiveState] = useState<"idle" | "listening" | "speaking">("idle");
  const activeStateRef = useRef<"idle" | "listening" | "speaking">("idle");
  const [liveTranscript, setLiveTranscript] = useState<string>("");
  const transcriptTimeoutRef = useRef<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  
  // Web Crypto API Storage Layer states
  const [cryptoFingerprint, setCryptoFingerprint] = useState<string>("SK-INIT...");
  const [rawEncryptedBlob, setRawEncryptedBlob] = useState<string | null>(null);
  const [showCryptoModal, setShowCryptoModal] = useState<boolean>(false);
  const [cryptoStatusMessage, setCryptoStatusMessage] = useState<string | null>(null);

  // Floating Emoji Reaction Engine for Orb
  interface OrbReaction {
    id: string;
    emoji: string;
    x: number;
    yStart: number;
    rotation: number;
    scale: number;
    sentiment: string;
    glowColor: string;
  }
  const [orbReactions, setOrbReactions] = useState<OrbReaction[]>([]);

  const triggerSentimentReaction = (
    sentimentType: "sassy" | "empathetic" | "sparkle" | "focused" | "custom",
    customEmojis?: string[]
  ) => {
    const emojiSets: Record<string, string[]> = {
      sassy: ["😈", "💅", "😏", "😜", "🔥", "💋"],
      empathetic: ["❤️", "💖", "🥺", "🌸", "💕", "🤗"],
      sparkle: ["✨", "🌟", "⚡️", "💎", "🚀", "💫"],
      focused: ["💡", "🧠", "🎯", "⚡️", "🧐", "💻"],
      custom: customEmojis || ["✨", "❤️", "😈"]
    };

    const glowColors: Record<string, string> = {
      sassy: "rgba(236, 72, 153, 0.9)",
      empathetic: "rgba(244, 63, 94, 0.9)",
      sparkle: "rgba(234, 179, 8, 0.9)",
      focused: "rgba(14, 165, 233, 0.9)",
      custom: "rgba(168, 85, 247, 0.9)"
    };

    const pool = emojiSets[sentimentType] || emojiSets.sparkle;
    const count = Math.floor(Math.random() * 3) + 2;
    const newReactions: OrbReaction[] = [];

    for (let i = 0; i < count; i++) {
      const randomEmoji = pool[Math.floor(Math.random() * pool.length)];
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const x = (Math.random() - 0.5) * 110;
      const yStart = (Math.random() - 0.5) * 30;
      const rotation = (Math.random() - 0.5) * 40;
      const scale = 1.2 + Math.random() * 0.5;

      newReactions.push({
        id,
        emoji: randomEmoji,
        x,
        yStart,
        rotation,
        scale,
        sentiment: sentimentType,
        glowColor: glowColors[sentimentType] || "rgba(255, 255, 255, 0.9)"
      });
    }

    setOrbReactions((prev) => [...prev.slice(-12), ...newReactions]);

    setTimeout(() => {
      const idsToRemove = new Set(newReactions.map((r) => r.id));
      setOrbReactions((prev) => prev.filter((r) => !idsToRemove.has(r.id)));
    }, 2200);
  };

  const analyzeSentimentFromText = (text: string) => {
    if (!text || text.trim().length === 0) return;
    const lower = text.toLowerCase();

    if (/\b(tease|cheeky|sassy|darling|boss|flirt|naughty|smirk|wink|cute|bold|sarcasm|whatever|hun|honey|pfft|devious)\b/i.test(lower)) {
      triggerSentimentReaction("sassy");
    } else if (/\b(love|care|heart|sweet|sorry|warm|hug|precious|gentle|comfort|understand|empathy|there)\b/i.test(lower)) {
      triggerSentimentReaction("empathetic");
    } else if (/\b(wow|amazing|genius|brilliant|awesome|magic|sparkle|star|incredible|yay|fun|boast|perfect)\b/i.test(lower)) {
      triggerSentimentReaction("sparkle");
    } else if (/\b(code|logic|analyze|solution|fixed|data|matrix|brain|smart|system|think|problem)\b/i.test(lower)) {
      triggerSentimentReaction("focused");
    } else {
      triggerSentimentReaction("sparkle");
    }
  };

  const [toolLogs, setToolLogs] = useState<ToolLog[]>([
    {
      id: "initial",
      type: "system",
      title: "System Ready",
      details: "Welcome to Zoya Live. Text chat history is encrypted via Web Crypto API (AES-GCM 256) in localStorage.",
      timestamp: new Date()
    }
  ]);

  // Web Crypto API - Load decrypted chat logs from localStorage on mount
  useEffect(() => {
    let active = true;
    const initCryptoStorage = async () => {
      try {
        const result = await loadDecryptedChatLogs<ToolLog>();
        if (!active) return;
        setCryptoFingerprint(result.keyFingerprint);
        setRawEncryptedBlob(result.encryptedBlobRaw);

        if (result.logs && result.logs.length > 0) {
          const restoredLogs = result.logs.map((log) => ({
            ...log,
            timestamp: new Date(log.timestamp)
          }));
          setToolLogs(restoredLogs);
        } else if (result.error) {
          setCryptoStatusMessage(result.error);
        }
      } catch (err) {
        console.warn("Web Crypto init note:", err);
      }
    };
    initCryptoStorage();
    return () => { active = false; };
  }, []);

  // Web Crypto API - Auto-encrypt chat logs to localStorage on state change
  useEffect(() => {
    if (toolLogs.length > 0) {
      saveEncryptedChatLogs(toolLogs)
        .then(() => {
          setRawEncryptedBlob(getRawEncryptedBlob());
        })
        .catch((err) => {
          console.warn("Failed auto-encrypting chat logs to localStorage:", err);
        });
    }
  }, [toolLogs]);

  const handleRotateKey = async () => {
    try {
      const newFp = await clearEncryptedStorage(true);
      setCryptoFingerprint(newFp);
      await saveEncryptedChatLogs(toolLogs);
      setRawEncryptedBlob(getRawEncryptedBlob());
      setCryptoStatusMessage(`Session key rotated! New key fingerprint: ${newFp}`);
      addToolLog("system", "Session Key Rotated", `Generated new AES-256 Web Crypto session key (${newFp}). Re-encrypted localStorage chat logs.`);
    } catch (err: any) {
      setCryptoStatusMessage(`Key rotation error: ${err.message || err}`);
    }
  };

  const handleClearEncryptedStorage = async () => {
    await clearEncryptedStorage(false);
    const initialLogs: ToolLog[] = [
      {
        id: Math.random().toString(),
        type: "system",
        title: "Encrypted Storage Purged",
        details: "Encrypted chat history blob removed from localStorage.",
        timestamp: new Date()
      }
    ];
    setToolLogs(initialLogs);
    setRawEncryptedBlob(null);
    setCryptoStatusMessage("LocalStorage encrypted blob purged successfully.");
  };

  // Memory & Attachment states
  const [memories, setMemories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("zoya_memories");
      return saved ? JSON.parse(saved) : [
        "My name is Carbon-Based Lifeform.",
        "Zoya is a sassy AI who teases me.",
        "I am building a web app right now."
      ];
    } catch (e) {
      return [
        "My name is Carbon-Based Lifeform.",
        "Zoya is a sassy AI who teases me.",
        "I am building a web app right now."
      ];
    }
  });
  const [newMemory, setNewMemory] = useState("");

  interface AttachedFile {
    name: string;
    size: number;
    type: string;
    content: string;
    summary?: string;
  }
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [utcTime, setUtcTime] = useState("");

  // Screen Share state & refs
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<any>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hrs = String(now.getUTCHours()).padStart(2, "0");
      const mins = String(now.getUTCMinutes()).padStart(2, "0");
      const secs = String(now.getUTCSeconds()).padStart(2, "0");
      setUtcTime(`${hrs}.${mins}.${secs} UTC`);
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Ensure AudioContext is unlocked upon any user interaction
  useEffect(() => {
    const unlockAudio = () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.resume();
      }
    };
    window.addEventListener("click", unlockAudio);
    window.addEventListener("touchstart", unlockAudio);
    return () => {
      window.removeEventListener("click", unlockAudio);
      window.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  // Audio & Socket refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<AudioQueuePlayer | null>(null);
  const micContextRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const pingIntervalRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-reconnect tracking
  const isExplicitDisconnectRef = useRef<boolean>(true);
  const reconnectAttemptsRef = useRef<number>(0);
  const reconnectTimeoutIdRef = useRef<any>(null);

  // Adaptive Keep-Alive Ping & Latency Tracking refs
  const pingTimerRef = useRef<any>(null);
  const smoothedRttRef = useRef<number>(50); // initial baseline estimate 50ms
  const pingPendingRef = useRef<boolean>(false);
  const lastServerMessageTimeRef = useRef<number>(Date.now());

  // Active session conversation history persistence across unexpected drops
  const getInitialSessionHistory = (): string[] => {
    try {
      const saved = sessionStorage.getItem("zoya_session_history");
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  const sessionHistoryRef = useRef<string[]>(getInitialSessionHistory());

  const recordSessionEvent = (eventText: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = `[${timestamp}] ${eventText}`;
    const currentList = Array.isArray(sessionHistoryRef.current) ? sessionHistoryRef.current : [];
    const updated = [...currentList.slice(-25), entry];
    sessionHistoryRef.current = updated;
    try {
      sessionStorage.setItem("zoya_session_history", JSON.stringify(updated));
    } catch (e) {}
  };

  // Exponential backoff calculator (1s base, 1.8x multiplier, 16s cap, ±200ms jitter)
  const calculateBackoffDelay = (attempt: number) => {
    const baseDelay = 1000;
    const maxDelay = 16000;
    const factor = 1.8;
    const rawDelay = Math.min(maxDelay, baseDelay * Math.pow(factor, Math.max(0, attempt - 1)));
    const jitter = (Math.random() - 0.5) * 400;
    return Math.max(800, Math.round(rawDelay + jitter));
  };

  // Sync state values to refs for safe setTimeout closures in websocket events
  const memoriesRef = useRef<string[]>([]);
  const attachedFileRef = useRef<AttachedFile | null>(null);

  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  useEffect(() => {
    attachedFileRef.current = attachedFile;
  }, [attachedFile]);

  // Memory event handlers
  const handleAddMemory = () => {
    if (!newMemory.trim()) return;
    const updated = [...memories, newMemory.trim()];
    setMemories(updated);
    try {
      localStorage.setItem("zoya_memories", JSON.stringify(updated));
    } catch (e) {}
    addToolLog("system", "Memory Added", `Stored fact: "${newMemory.trim()}" in Zoya's permanent memory bank.`);
    
    // Sync to active live socket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const singleMemContext = `[SYSTEM UPDATE - MEMORY CORE ADDED]\nI have added a new fact about myself in your memory: "${newMemory.trim()}". Please remember this fact and incorporate it into our active conversation!`;
      wsRef.current.send(JSON.stringify({
        clientMessage: singleMemContext
      }));
      addToolLog("system", "Memory Sync", "Transmitted new memory directly to Zoya's active session.");
    }
    
    setNewMemory("");
  };

  const handleDeleteMemory = (index: number) => {
    const deletedText = memories[index];
    const updated = memories.filter((_, i) => i !== index);
    setMemories(updated);
    try {
      localStorage.setItem("zoya_memories", JSON.stringify(updated));
    } catch (e) {}
    addToolLog("system", "Memory Erased", `Wiped fact: "${deletedText}" from memory bank.`);
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const deletionMessage = `[SYSTEM UPDATE - MEMORY CORE REMOVED]\nI have erased this fact from your memory core: "${deletedText}". Please forget this fact or stop mentioning it.`;
      wsRef.current.send(JSON.stringify({
        clientMessage: deletionMessage
      }));
    }
  };

  // File loading event handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB capacity limit
    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage("File is too large! Maximum attachment capacity is 15MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const fileType = file.type || "application/octet-stream";
      const isImage = fileType.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(file.name);
      const isPdf = fileType.includes("pdf") || /\.pdf$/i.test(file.name);
      const fileCategory = isImage ? "Photo/Image" : isPdf ? "PDF Document" : "File";

      const fileData: AttachedFile = {
        name: file.name,
        size: file.size,
        type: fileType,
        content: dataUrl,
        summary: ""
      };

      setIsAnalyzing(true);
      addToolLog("system", "Analyzing " + fileCategory, `Processing "${file.name}" (${(file.size / 1024).toFixed(1)} KB) via Gemini multimodal engine...`);

      fetch("/api/analyze-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          content: dataUrl,
          type: fileType
        })
      })
        .then((res) => {
          if (!res.ok) throw new Error("Server analysis failed");
          return res.json();
        })
        .then((data) => {
          fileData.summary = data.summary;
          setAttachedFile(fileData);
          setIsAnalyzing(false);
          addToolLog("system", "Analysis Complete", `Successfully extracted full content & visual digest for "${file.name}".`);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const fileContextString = `[SYSTEM UPDATE - ATTACHED ${fileCategory.toUpperCase()} DIGEST]\n` +
              `File Name: ${file.name}\n` +
              `File Category: ${fileCategory}\n` +
              `File Size: ${(file.size / 1024).toFixed(1)} KB\n` +
              `Visual & Content Analysis Digest:\n\"\"\"\n${data.summary}\n\"\"\"\n\n` +
              `DIRECTIVE: You now have complete knowledge of this attached ${fileCategory.toLowerCase()}. Acknowledge receipt with a brief, witty, sassy remark! Refer to this content whenever I ask questions about it.`;
            
            wsRef.current.send(JSON.stringify({
              clientMessage: fileContextString
            }));
            addToolLog("system", "File Sync", `Transmitted full analysis of "${file.name}" directly to Zoya.`);
          }
        })
        .catch((err) => {
          console.error("Analysis error:", err);
          addToolLog("system", "Analysis Fallback", `Processed "${file.name}" with local buffer fallback.`);
          fileData.summary = `[Attached ${fileCategory}] ${file.name} (${(file.size / 1024).toFixed(1)} KB) loaded.`;
          setAttachedFile(fileData);
          setIsAnalyzing(false);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const fileContextString = `[SYSTEM UPDATE - ATTACHED ${fileCategory.toUpperCase()}]\nFile Name: ${file.name}\nFile Size: ${(file.size / 1024).toFixed(1)} KB\n\nPlease acknowledge receipt with a sassy remark!`;
            wsRef.current.send(JSON.stringify({
              clientMessage: fileContextString
            }));
          }
        });
    };
    reader.onerror = () => {
      setErrorMessage("Failed to read file.");
    };
    // Use readAsDataURL to support binary photos, images, PDFs, as well as text files safely
    reader.readAsDataURL(file);
  };

  const handleRemoveFile = () => {
    if (!attachedFile) return;
    const removedName = attachedFile.name;
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    addToolLog("system", "File Removed", `Detached "${removedName}" from local memory buffer.`);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const removalInstruction = `[SYSTEM UPDATE - FILE REMOVED]\nI have removed the file named "${removedName}" from our conversation. Please do not reference its content anymore unless I specify otherwise.`;
      wsRef.current.send(JSON.stringify({
        clientMessage: removalInstruction
      }));
    }
  };

  // Dynamic waveform bars heights
  const [waveformHeights, setWaveformHeights] = useState<number[]>(new Array(18).fill(4));

  // Add tool call log helper
  const addToolLog = (type: "system" | "mood" | "browser", title: string, details: string) => {
    setToolLogs(prev => [
      {
        id: Math.random().toString(),
        type,
        title,
        details,
        timestamp: new Date()
      },
      ...prev
    ]);
    if (type !== "system" || (!title.toLowerCase().includes("reconnect") && !title.toLowerCase().includes("ready"))) {
      recordSessionEvent(`[${title}] ${details}`);
    }
  };

  const [isResetting, setIsResetting] = useState(false);

  const handleResetSystem = async () => {
    if (isResetting) return;
    setIsResetting(true);

    // Clear session conversation history when explicitly rebooting matrix
    sessionHistoryRef.current = [];
    try {
      sessionStorage.removeItem("zoya_session_history");
    } catch (e) {}

    addToolLog("system", "Reboot Sequence Initiated", "Wiping conversation buffer and rebooting Zoya's core memory matrix...");
    
    // Clean up screen sharing
    stopScreenSharing();
    
    // Explicitly disconnect active session
    isExplicitDisconnectRef.current = true;
    performFullCleanup();
    
    // Reset memories to original default values
    const defaultMemories = [
      "My name is Carbon-Based Lifeform.",
      "Zoya is a sassy AI who teases me.",
      "I am building a web app right now."
    ];
    setMemories(defaultMemories);
    try {
      localStorage.setItem("zoya_memories", JSON.stringify(defaultMemories));
    } catch (e) {}

    // Detach file buffers
    setAttachedFile(null);
    
    // Visual reboot delay to enhance the futuristic cyber theme
    setTimeout(async () => {
      // Clear logs and insert a clean, fresh reboot greeting
      setToolLogs([
        {
          id: Math.random().toString(),
          type: "system",
          title: "System Online (Rebooted)",
          details: "Zoya's cognitive core has been fully re-initialized. Ready for deep voice synchronization.",
          timestamp: new Date()
        }
      ]);
      
      setIsResetting(false);
      
      // Auto-reconnect starting from first handshake
      await startSession();
    }, 1500);
  };

  const handleExportLogs = () => {
    if (toolLogs.length === 0) return;
    
    // Format the logs cleanly as text
    const logHeader = `=========================================\nZOYA LIVE - ACTION MONITOR CHAT LOGS\nExported on: ${new Date().toLocaleString()}\n=========================================\n\n`;
    
    const logBody = toolLogs
      .slice()
      .reverse() // Keep chronological order (oldest to newest)
      .map((log) => {
        const timeStr = log.timestamp.toLocaleTimeString();
        return `[${timeStr}] [${log.type.toUpperCase()}] ${log.title}\nDetails: ${log.details}\n-----------------------------------------`;
      })
      .join("\n\n");
      
    const fullText = logHeader + logBody;
    
    // Trigger browser file download
    const blob = new Blob([fullText], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `zoya_live_session_log_${new Date().toISOString().slice(0,10)}.txt`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    addToolLog("system", "Logs Exported", "Action monitor activity logs exported successfully as a text file.");
  };

  // Simulate or animate the visualizer wave bars based on speaking state
  useEffect(() => {
    let interval: any;
    if (activeState === "speaking") {
      interval = setInterval(() => {
        setWaveformHeights(
          Array.from({ length: 18 }, () => Math.floor(Math.random() * 40) + 12)
        );
      }, 100);
    } else if (activeState === "listening" && isConnected) {
      interval = setInterval(() => {
        setWaveformHeights(
          Array.from({ length: 18 }, (_, i) => {
            const sine = Math.sin(Date.now() / 200 + i) * 6 + 10;
            return Math.max(4, Math.floor(sine));
          })
        );
      }, 80);
    } else {
      setWaveformHeights(new Array(18).fill(4));
    }
    return () => clearInterval(interval);
  }, [activeState, isConnected]);

  // Smoothly interpolate microphone volume level for organic glowing pulse effects
  useEffect(() => {
    if (!isConnected || activeState !== "listening") {
      setMicVolume(0);
      targetVolumeRef.current = 0;
      return;
    }

    let animationFrameId: number;
    let currentVolume = 0;

    const update = () => {
      const target = targetVolumeRef.current;
      currentVolume += (target - currentVolume) * 0.15;
      
      if (Math.abs(currentVolume - target) < 0.001) {
        currentVolume = target;
      }

      setMicVolume(currentVolume);
      animationFrameId = requestAnimationFrame(update);
    };

    animationFrameId = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isConnected, activeState]);

  // Non-intrusive Keep-Alive Ping manager
  const stopAdaptivePing = () => {
    if (pingTimerRef.current) {
      clearTimeout(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    pingPendingRef.current = false;
  };

  const scheduleNextAdaptivePing = () => {
    stopAdaptivePing();

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // Ping interval: 8 seconds (tighter if RTT > 250ms)
    const nextInterval = smoothedRttRef.current > 250 ? 5000 : 8000;

    pingTimerRef.current = setTimeout(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      const silenceDuration = now - lastServerMessageTimeRef.current;

      // Only close if socket has been completely silent with zero server data for over 30 seconds
      if (silenceDuration > 30000) {
        console.warn("[Keep-Alive] No server activity for >30s. Connection appears stale. Reconnecting...");
        try { wsRef.current.close(); } catch (e) {}
        return;
      }

      pingPendingRef.current = true;
      try {
        wsRef.current.send(JSON.stringify({ type: "ping", timestamp: now }));
      } catch (e) {}

      scheduleNextAdaptivePing();
    }, nextInterval);
  };

  // Connection management
  const handleAutoReconnect = () => {
    if (isExplicitDisconnectRef.current) return;
    if (reconnectTimeoutIdRef.current) return; // Prevent multiple overlapping reconnection queues
    
    setIsConnecting(true);
    setIsConnected(false);
    setActiveState("idle");
    stopAdaptivePing();

    const attempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = attempt;
    const delay = calculateBackoffDelay(attempt);

    addToolLog(
      "system",
      "Reconnecting",
      `Connection interrupted. Executing exponential backoff retry (Attempt #${attempt}, delay: ${(delay / 1000).toFixed(1)}s, smoothed RTT: ${smoothedRttRef.current}ms).`
    );

    console.log(`Scheduling exponential backoff auto-reconnect attempt #${attempt} in ${delay}ms`);
    
    reconnectTimeoutIdRef.current = setTimeout(async () => {
      reconnectTimeoutIdRef.current = null; // Clear timer reference before starting connection attempt
      try {
        await startSession(true);
      } catch (err) {
        console.error("Reconnection attempt failed:", err);
        handleAutoReconnect();
      }
    }, delay);
  };

  const startSession = async (isReconnect: boolean = false) => {
    if (isConnected && !isReconnect) return;
    if (isConnecting && !isReconnect) return;
    
    setIsConnecting(true);
    setErrorMessage(null);
    isExplicitDisconnectRef.current = false;

    if (wsRef.current) {
      const oldWs = wsRef.current;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onclose = null;
      oldWs.onerror = null;
      try { oldWs.close(); } catch (e) {}
      wsRef.current = null;
    }

    try {
      // Initialize audio queue player (24kHz) and resume AudioContext during user gesture
      if (!audioPlayerRef.current) {
        audioPlayerRef.current = new AudioQueuePlayer(24000);
        audioPlayerRef.current.onStateChange = (state) => {
          activeStateRef.current = state === "speaking" ? "speaking" : "listening";
          setActiveState(state === "speaking" ? "speaking" : "listening");
        };
      }
      // Stop and clear any previous audio playback to prevent overlapping voice streams
      audioPlayerRef.current.stop();
      await audioPlayerRef.current.resume();

      // Setup WebSocket connection to full-stack backend
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live-ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        try {
          // Re-use active mic stream and audio processor if already initialized to keep reconnection instant
          if (!micStreamRef.current || !micContextRef.current || !micProcessorRef.current) {
            // Request mic stream with high-quality echo cancellation to prevent feedback loop
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
                sampleRate: 16000
              }
            });
            micStreamRef.current = stream;

            // Process mic audio at 16kHz
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const micCtx = new AudioContextClass({ sampleRate: 16000 });
            micContextRef.current = micCtx;

            const source = micCtx.createMediaStreamSource(stream);
            micSourceRef.current = source;

            const processor = micCtx.createScriptProcessor(2048, 1, 1);
            micProcessorRef.current = processor;

            // Route processor to destination through a zero-gain node to keep ScriptProcessor alive without playing mic to speakers
            const muteGain = micCtx.createGain();
            muteGain.gain.value = 0;
            source.connect(processor);
            processor.connect(muteGain);
            muteGain.connect(micCtx.destination);

            processor.onaudioprocess = (e) => {
              const channelData = e.inputBuffer.getChannelData(0);
              
              // Silence output buffer to guarantee no feedback or local audio playback
              const outputBuffer = e.outputBuffer.getChannelData(0);
              outputBuffer.fill(0);

              if (isMutedRef.current) {
                targetVolumeRef.current = 0;
                return;
              }

              // Calculate RMS (Root Mean Square) volume level
              let sum = 0;
              for (let i = 0; i < channelData.length; i++) {
                sum += channelData[i] * channelData[i];
              }
              const rms = Math.sqrt(sum / channelData.length);
              
              // Normalize volume
              const normalizedVolume = Math.min(1, rms * 5.5);
              targetVolumeRef.current = normalizedVolume;

              // Gate out ambient speaker bleed while Zoya is speaking so she doesn't echo or respond to herself
              if (activeStateRef.current === "speaking") {
                // If audio level is typical speaker bleed (< 0.18 RMS), ignore it completely
                if (rms < 0.18) {
                  return;
                }
                // If user speaks loudly to interrupt/barge-in, stop Zoya's current voice immediately
                audioPlayerRef.current?.stop();
              }

              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                const base64 = pcmToBase64(channelData);
                wsRef.current.send(JSON.stringify({ audio: base64 }));
              }
            };
          } else {
            // Re-use existing mic structures, resume context if suspended
            if (micContextRef.current && micContextRef.current.state === "suspended") {
              await micContextRef.current.resume();
            }
          }

          // Start adaptive keep-alive ping loop
          scheduleNextAdaptivePing();
        } catch (err: any) {
          console.error("Microphone access failed:", err);
          setErrorMessage("Microphone access is required for Zoya. Please check your browser permissions.");
          if (wsRef.current) wsRef.current.close();
          stopSession();
        }
      };

      ws.onmessage = (event) => {
        try {
          lastServerMessageTimeRef.current = Date.now();
          const msg = JSON.parse(event.data);

          // Handle adaptive ping reply (pong)
          if (msg.type === "pong") {
            pingPendingRef.current = false;
            if (msg.timestamp) {
              const rtt = Date.now() - msg.timestamp;
              const prevRtt = smoothedRttRef.current;
              smoothedRttRef.current = prevRtt === 0 ? rtt : Math.round(prevRtt * 0.7 + rtt * 0.3);
            }
            return;
          }

          // Handle connected status confirmation from backend Gemini Live session
          if (msg.status === "connected") {
            setIsConnected(true);
            setIsConnecting(false);
            activeStateRef.current = "listening";
            setActiveState("listening");
            reconnectAttemptsRef.current = 0;
            
            if (reconnectTimeoutIdRef.current) {
              clearTimeout(reconnectTimeoutIdRef.current);
              reconnectTimeoutIdRef.current = null;
            }

            addToolLog("system", isReconnect ? "Reconnected" : "Connected", isReconnect ? "Secure voice link re-established with Zoya." : "Voice session successfully established with Zoya.");

            // Sync memories, attachments & active conversation history immediately once session is connected
            const activeMemories = memoriesRef.current;
            const activeFile = attachedFileRef.current;
            const sessionHistory = sessionHistoryRef.current;

            const memoryString = activeMemories.length > 0 
              ? activeMemories.map((m, idx) => `${idx + 1}. ${m}`).join("\n")
              : "No core memories loaded.";
            
            let fileString = "";
            if (activeFile) {
              const targetContent = activeFile.summary || activeFile.content;
              fileString = `\n\n[ATTACHED FILE CONTEXT]\nFile Name: ${activeFile.name}\nFile Size: ${activeFile.size} bytes\nFile Content/Digest:\n"""\n${targetContent}\n"""`;
            }

            const historySummary = (Array.isArray(sessionHistory) && sessionHistory.length > 0)
              ? sessionHistory.join("\n")
              : "Session just initialized.";

            const initialContext = `[SESSION RESTORATION & HANDSHAKE - COGNITIVE MATRIX UPDATE]\n\n` +
              `STATUS: ${isReconnect ? "RECONNECTING TO ONGOING SESSION (DO NOT RESET OR FORGET CONVERSATION)" : "NEW SESSION INITIALIZED"}\n\n` +
              `CURRENT MOOD: ${currentMood}\n\n` +
              `RECENT ACTIVE SESSION CONVERSATION LOG:\n${historySummary}\n\n` +
              `FACTS YOU REMEMBER ABOUT ME:\n${memoryString}${fileString}\n\n` +
              `DIRECTIVE: ${isReconnect ? "Connection restored silently. You have full memory of our conversation log above. Do NOT say hello, do NOT mention reconnecting, and do NOT speak until the user speaks to you!" : "Seamlessly initialize session in '" + currentMood + "' mood with a brief, witty greeting welcoming me back!"}`;

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ clientMessage: initialContext }));
            }
            
            recordSessionEvent(`Handshake transmitted: Session active in ${currentMood} mood with ${activeMemories.length} memories & conversation history.`);
            addToolLog("system", "Context Shared", `Transmitted conversation context (${sessionHistory.length} turns), ${activeMemories.length} memories to Zoya's active stream.`);
            return;
          }

          // Play Audio Chunk
          if (msg.audio) {
            audioPlayerRef.current?.playChunk(msg.audio);
          }

          // Handle incoming text transcript for sentiment detection and subtitle display
          if (msg.text) {
            analyzeSentimentFromText(msg.text);
            setLiveTranscript((prev) => (prev ? `${prev} ${msg.text}`.slice(-250) : msg.text));
            if (transcriptTimeoutRef.current) clearTimeout(transcriptTimeoutRef.current);
            transcriptTimeoutRef.current = setTimeout(() => {
              setLiveTranscript("");
            }, 6000);
          }

          // Handle interruption
          if (msg.interrupted) {
            audioPlayerRef.current?.stop();
            activeStateRef.current = "listening";
            setActiveState("listening");
          }

          // Handle dynamic tool triggers
          if (msg.toolCall) {
            const { name, args } = msg.toolCall;
            if (name === "setMood" && args?.mood) {
              const rawMood = String(args.mood);
              const matchedKey = (Object.keys(MOODS) as Mood[]).find(
                (k) => k.toLowerCase() === rawMood.toLowerCase()
              );
              if (matchedKey) {
                setCurrentMood(matchedKey);
                addToolLog("mood", `Switched to ${matchedKey}`, `Zoya transitioned into a ${matchedKey} conversation style.`);
                const m = matchedKey.toLowerCase();
                if (m === "teasing") triggerSentimentReaction("sassy");
                else if (m === "empathetic") triggerSentimentReaction("empathetic");
                else if (m === "playful") triggerSentimentReaction("sparkle");
                else if (m === "focused") triggerSentimentReaction("focused");
              } else {
                console.warn("Invalid mood received from toolCall:", args.mood);
              }
            } else if (name === "openWebsite" && args?.url) {
              addToolLog("browser", "Browser Launch Requested", `Zoya requested to open: ${args.url}`);
              window.open(args.url, "_blank");
            }
          }

          if (msg.status === "disconnected") {
            if (!isExplicitDisconnectRef.current) {
              console.log("WebSocket received disconnected status; waiting for onclose to trigger reconnection.");
            } else {
              performFullCleanup();
            }
          }

          if (msg.error) {
            setErrorMessage(msg.error);
          }
        } catch (err) {
          console.error("Error parsing WS message:", err);
        }
      };

      ws.onclose = (event) => {
        console.log("WebSocket connection closed:", event.code, event.reason);
        
        // Clean up websocket and heartbeat immediately
        stopAdaptivePing();
        wsRef.current = null;
        setIsConnected(false);

        if (!isExplicitDisconnectRef.current) {
          handleAutoReconnect();
        } else {
          performFullCleanup();
        }
      };

      ws.onerror = (err) => {
        console.error("WebSocket error:", err);
        // Do not call handleAutoReconnect here; the browser will immediately fire onclose right after,
        // which serves as the single source of truth for connection disconnections.
        if (isExplicitDisconnectRef.current) {
          setErrorMessage("Connection lost. Please try connecting again.");
          performFullCleanup();
        }
      };

    } catch (err: any) {
      console.error("Connection failed:", err);
      if (!isReconnect) {
        setErrorMessage("Could not connect to server. Ensure the server is running on port 3000.");
        stopSession();
      } else {
        handleAutoReconnect();
      }
    }
  };

  const stopSession = () => {
    isExplicitDisconnectRef.current = true;
    performFullCleanup();
  };

  const performFullCleanup = () => {
    setIsConnected(false);
    setIsConnecting(false);
    setActiveState("idle");
    activeStateRef.current = "idle";

    stopAdaptivePing();

    if (reconnectTimeoutIdRef.current) {
      clearTimeout(reconnectTimeoutIdRef.current);
      reconnectTimeoutIdRef.current = null;
    }
    reconnectAttemptsRef.current = 0;

    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.close();
      audioPlayerRef.current = null;
    }

    if (micProcessorRef.current) {
      try { micProcessorRef.current.disconnect(); } catch (e) {}
      micProcessorRef.current = null;
    }

    if (micSourceRef.current) {
      try { micSourceRef.current.disconnect(); } catch (e) {}
      micSourceRef.current = null;
    }

    if (micContextRef.current) {
      try { micContextRef.current.close(); } catch (e) {}
      micContextRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      micStreamRef.current = null;
    }

    // Clean up screen sharing
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      screenStreamRef.current = null;
    }
    setIsSharingScreen(false);

    addToolLog("system", "Session Ended", "Voice connection closed.");
  };

  const toggleMute = () => {
    setIsMuted(prev => {
      const nextMute = !prev;
      isMutedRef.current = nextMute;
      if (nextMute) {
        targetVolumeRef.current = 0;
        setMicVolume(0);
      }
      addToolLog("system", nextMute ? "Mic Muted" : "Mic Unmuted", nextMute ? "Your mic is temporarily muted." : "Your mic is now active.");
      return nextMute;
    });
  };

  // Direct user request to trigger mood update over connection
  const handleManualMoodChange = (mood: Mood) => {
    setCurrentMood(mood);
    addToolLog("system", `Mood Set: ${mood}`, `Manually switched Zoya's active theme and conversation styling to ${mood}.`);
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        clientMessage: `From now on, switch your persona mood to ${mood}. React with a witty sass remark fit for your ${mood} personality.`
      }));
    }
  };

  const startScreenSharing = async () => {
    try {
      if (!isConnected) {
        setErrorMessage("Please connect to Zoya before sharing your screen.");
        return;
      }

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
        setErrorMessage("Screen sharing (getDisplayMedia) is not supported by your browser, platform, or security context. If you are on a mobile device, screen sharing is not supported by mobile browsers. Please try opening the app in a new tab on a desktop browser.");
        return;
      }
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 1, max: 2 }
        }
      });
      
      screenStreamRef.current = stream;
      setIsSharingScreen(true);
      addToolLog("system", "Screen Share Started", "Your screen is now visible to Zoya's ocular processing matrix.");

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          clientMessage: `[SYSTEM UPDATE - SCREEN SHARING ACTIVE]\n\nI have shared my screen with you. You will now receive periodic image frames of my screen over your real-time video input channel. Please analyze what you see on my screen, and reference it in our conversation! Feel free to comment on my screen if you spot something interesting.`
        }));
      }

      // Set up a video element to feed into the canvas
      const video = document.createElement("video");
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      
      video.onloadedmetadata = () => {
        video.play();
        
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        screenIntervalRef.current = setInterval(() => {
          if (!ctx || video.paused || video.ended) return;
          
          canvas.width = 640;
          canvas.height = (video.videoHeight / video.videoWidth) * 640 || 480;
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
          const base64 = dataUrl.split(",")[1];
          
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ video: base64 }));
          }
        }, 1500);
      };

      stream.getVideoTracks()[0].onended = () => {
        stopScreenSharing();
      };
      
    } catch (err: any) {
      console.error("Failed to start screen share:", err);
      const isPolicyBlocked = err.name === "SecurityError" || 
        (err.message && (
          err.message.includes("permissions policy") || 
          err.message.includes("display-capture") || 
          err.message.includes("disallowed")
        ));
      
      if (isPolicyBlocked) {
        setErrorMessage("Screen sharing is blocked by the browser inside this sandbox iframe. Click the 'Open in new tab' button at the top-right of this preview to run Zoya in a full page and enable screen sharing!");
      } else if (err.name !== "NotAllowedError") {
        setErrorMessage(`Could not start screen sharing: ${err.message || err}`);
      }
    }
  };

  const stopScreenSharing = () => {
    setIsSharingScreen(false);
    
    if (screenIntervalRef.current) {
      clearInterval(screenIntervalRef.current);
      screenIntervalRef.current = null;
    }
    
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try { track.stop(); } catch (e) {}
      });
      screenStreamRef.current = null;
    }
    
    addToolLog("system", "Screen Share Stopped", "Terminated screen video stream.");
  };

  // Ensure cleanup on unmount
  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

  const activeTheme = MOODS[currentMood] || MOODS.Playful;

  return (
    <div 
      id="zoya-container" 
      className="flex-1 flex flex-col min-h-screen bg-[#0A0A0C] relative overflow-hidden select-none font-sans text-white"
      style={{
        "--bg": "#0A0A0C",
        "--ink": "#FFFFFF",
        "--ink-dim": "rgba(255, 255, 255, 0.5)",
        "--ink-faint": "rgba(255, 255, 255, 0.08)",
        "--accent": activeTheme.accentColor,
        "--accent-faint": `${activeTheme.accentColor}1a`,
      } as React.CSSProperties}
    >
      {/* Dynamic Ambient Background Aura layers matching mockup layout */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <div 
          className="absolute inset-[-20%] transition-all duration-1000 ease-in-out"
          style={{
            background: `
              radial-gradient(circle at 15% 25%, ${activeTheme.accentColor} 0%, transparent 40%),
              radial-gradient(circle at 85% 75%, ${activeTheme.secondaryColor} 0%, transparent 40%),
              radial-gradient(circle at 50% 50%, #030712 0%, transparent 60%)
            `,
            filter: "blur(120px)",
            opacity: 0.5
          }}
        />
      </div>

      {/* Header */}
      <header className="border-b border-white/5 h-[70px] px-6 lg:px-10 flex justify-between items-center bg-[#0A0A0C]/40 z-20">
        <div className="font-syne text-xl lg:text-2xl tracking-tighter select-none font-extrabold text-white">
          ZOYA <span style={{ color: "var(--accent)" }}>V3</span>
        </div>
        <div className="font-mono text-[9px] md:text-[10px] tracking-[0.15em] text-white/50 uppercase">
          {isConnected ? "SESSION_ACTIVE // LIVE_STREAM" : isConnecting ? "LINK_ESTABLISHING" : "IDLE_STATE // SYNC_ACTIVE"}
        </div>
        <div className="font-mono text-[9px] md:text-[10px] tracking-[0.15em] text-white/50 uppercase">
          {utcTime}
        </div>
      </header>

      {/* Error message */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div 
            id="error-banner"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mt-4 mx-6 bg-rose-950/80 border border-rose-500 px-4 py-3 rounded text-rose-300 text-xs font-mono z-30 flex justify-between items-center shadow-[4px_4px_0_rgba(239,68,68,0.2)]"
          >
            <div className="flex items-center gap-2">
              <ShieldAlert size={14} className="text-rose-500" />
              <span>[ERROR: {errorMessage}]</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white border border-rose-500/40 p-0.5 ml-3">
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Responsive 3-Column Columns layout */}
      <div className="flex-1 flex flex-col lg:grid lg:grid-cols-[380px_1fr_380px] relative z-10 overflow-hidden bg-transparent">
        
        {/* Left Side: Data Panel (Memory & Attachment Core) */}
        <aside className="border-b lg:border-b-0 lg:border-r border-white/5 flex flex-col bg-[#0A0A0C]/40 backdrop-blur-md overflow-y-auto max-h-[380px] lg:max-h-[calc(100vh-160px)]">
          <div className="p-5 border-b border-white/5 flex justify-between items-center bg-[#0A0A0C]/20">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/50">Memory_Recall // {memories.length} Facts</span>
          </div>

          <div 
            className="flex-1 p-5 space-y-6"
            style={{
              borderRadius: "0px",
              borderWidth: "0px",
              height: "400px",
              width: "364px"
            }}
          >
            
            {/* Memories table */}
            <div className="space-y-3">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="pb-2 font-mono text-[9px] text-white/50 tracking-wider">KEY</th>
                    <th className="pb-2 font-mono text-[9px] text-white/50 tracking-wider">MEMORY VALUE</th>
                    <th className="pb-2 font-mono text-[9px] text-white/50 tracking-wider text-right">WIPE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {memories.map((mem, idx) => (
                    <tr key={idx} className="group hover:bg-white/[0.01]">
                      <td className="py-2.5 font-mono text-[9px] text-white/40">#M-{idx + 1}</td>
                      <td className="py-2.5 font-mono text-[10px] text-white/80 leading-tight select-text pr-2">{mem}</td>
                      <td className="py-2.5 text-right">
                        <button 
                          onClick={() => handleDeleteMemory(idx)}
                          className="text-rose-500/60 hover:text-rose-400 p-1 cursor-pointer transition-colors"
                          title="Wipe memory"
                        >
                          <X size={10} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {memories.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[10px] text-white/30 italic">No memories loaded.</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Add memory form */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddMemory();
                }}
                className="flex gap-2 mt-2"
              >
                <input
                  type="text"
                  placeholder="Inject statement..."
                  value={newMemory}
                  onChange={(e) => setNewMemory(e.target.value)}
                  className="flex-1 bg-zinc-950/50 border border-white/5 px-2.5 py-1.5 text-xs rounded text-white focus:outline-none focus:border-[var(--accent)] placeholder:text-white/20 font-mono transition-colors"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-zinc-900 border border-white/10 hover:border-white text-[9px] text-white hover:bg-white hover:text-black font-bold uppercase transition-all duration-300 cursor-pointer rounded font-mono"
                >
                  Sync
                </button>
              </form>
            </div>

            {/* Attachment panel */}
            <div className="space-y-3 pt-5 border-t border-white/5">
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/50 block">Attachment_Core</span>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                className="hidden" 
                accept="image/*,application/pdf,.pdf,.txt,.js,.jsx,.ts,.tsx,.json,.md,.html,.css,.py,.csv,.doc,.docx"
              />

              {isAnalyzing ? (
                <div className="border border-dashed border-[var(--accent)] bg-zinc-950/10 p-4 rounded text-center flex flex-col items-center justify-center gap-2">
                  <RefreshCw size={16} className="text-[var(--accent)] animate-spin" />
                  <span className="text-[10px] font-bold text-white uppercase tracking-wider font-mono">Analyzing file / image...</span>
                  <span className="text-[8px] text-white/40 font-mono">Gemini Flash is extracting visual OCR & text</span>
                </div>
              ) : attachedFile ? (
                <div className="bg-zinc-950/40 p-3.5 border border-white/5 hover:border-[var(--accent)] rounded flex flex-col gap-2 font-mono text-[11px] transition-colors">
                  <div className="flex items-center gap-3">
                    {(attachedFile.type.startsWith("image/") || attachedFile.content.startsWith("data:image/")) ? (
                      <div className="w-10 h-10 rounded overflow-hidden bg-black/60 border border-white/10 shrink-0">
                        <img src={attachedFile.content} alt={attachedFile.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded bg-zinc-900 border border-white/10 shrink-0 flex items-center justify-center text-white/50 text-[10px] font-bold">
                        {attachedFile.type.includes("pdf") || attachedFile.name.endsWith(".pdf") ? "PDF" : "DOC"}
                      </div>
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-bold text-white truncate" title={attachedFile.name}>
                        {attachedFile.name}
                      </span>
                      <span className="text-[9px] text-white/40 mt-0.5">{(attachedFile.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <button 
                      onClick={handleRemoveFile}
                      className="text-rose-500 hover:text-rose-400 p-1 cursor-pointer transition-colors"
                      title="Detach file"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="border-t border-white/5 pt-2 flex items-center justify-between text-[9px] text-white/40">
                    <span>BUFFER: LOADED</span>
                    <span className={isConnected ? "text-[#00ffaa]" : "text-amber-400"}>
                      {isConnected ? "● ACTIVE IN STREAM" : "● READY FOR HANDSHAKE"}
                    </span>
                  </div>
                </div>
              ) : (
                <div 
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) {
                      const fakeEvent = { target: { files: [file] } } as any;
                      handleFileChange(fakeEvent);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className="border border-dashed border-white/10 hover:border-[var(--accent)] bg-zinc-950/10 hover:bg-white/[0.01] p-4 rounded text-center cursor-pointer transition-all duration-300 flex flex-col items-center justify-center gap-1.5 group"
                >
                  <Download size={14} className="text-white/30 group-hover:text-white rotate-180 animate-bounce" />
                  <span className="text-[10px] font-bold text-white/80 uppercase tracking-wider font-mono">Insert Photo / PDF / File</span>
                  <span className="text-[8px] text-white/40 font-mono">Drag & drop or click (Max 15MB)</span>
                </div>
              )}
            </div>

          </div>
        </aside>

        {/* Middle stage: Main Interactive visualizer */}
        <main className="flex-1 p-6 md:p-10 flex flex-col justify-center items-center relative overflow-y-auto min-h-[450px]">
          <div className="w-full max-w-xl flex flex-col items-center">
            
            {/* Dynamic Interactive Orb Area */}
            <div className="relative flex items-center justify-center mb-8 z-0 w-72 h-72 lg:w-80 lg:h-80">
              
              {/* Subtle interactive particle field reacting to mic input */}
              <ParticleField
                micVolume={micVolume}
                activeState={activeState}
                isConnected={isConnected}
                accentColor={activeTheme.accentColor}
                secondaryColor={activeTheme.secondaryColor}
                className="w-[460px] h-[460px] -left-[90px] -top-[90px] lg:w-[500px] lg:h-[500px] lg:-left-[90px] lg:-top-[90px] pointer-events-none rounded-full"
              />

              {/* Scanline overlay inside orb shell */}
              <div className="absolute left-1/2 -translate-x-1/2 w-[300px] h-[2px] bg-white shadow-[0_0_15px_white] opacity-10 scan-line-anim z-10 pointer-events-none" />

              {/* External breathing orbits (when connected) */}
              {isConnected && (
                <>
                  <motion.div 
                    className="absolute w-[320px] h-[320px] border rounded-full pointer-events-none opacity-20"
                    style={{ borderColor: "var(--accent)" }}
                    animate={{ scale: activeState === "speaking" ? [1, 1.06, 1] : [1, 1.03, 1] }}
                    transition={{ duration: activeState === "speaking" ? 0.8 : 3, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.div 
                    className="absolute w-[350px] h-[350px] border border-dashed rounded-full pointer-events-none opacity-10"
                    style={{ borderColor: "var(--accent)" }}
                    animate={{ scale: activeState === "speaking" ? [1, 1.10, 1] : [1, 1.01, 1] }}
                    transition={{ duration: activeState === "speaking" ? 1.2 : 4, repeat: Infinity, ease: "easeInOut" }}
                  />
                </>
              )}

              {/* Main Technical Visualizer Orb */}
              <div 
                className="w-72 h-72 border border-white/5 rounded-full flex items-center justify-center bg-[radial-gradient(circle,_var(--accent-faint)_0%,_transparent_70%)] relative overflow-visible"
                style={{
                  borderStyle: "groove",
                  backgroundColor: "#000000",
                  borderWidth: "45px",
                  borderRadius: "625px"
                }}
              >
                
                {/* Inner dashed circle */}
                <div className="absolute w-[240px] h-[240px] border border-dashed border-white/5 rounded-full pointer-events-none" />

                {/* Rotating decorative SVG orbits */}
                <svg className="absolute text-white/5 animate-spin pointer-events-none" style={{ animationDuration: "60s" }} width="210" height="210" viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="90" fill="none" stroke="currentColor" strokeDasharray="8 16" strokeWidth="1.5" />
                </svg>

                {/* Floating Sentiment Reaction Overlay */}
                <div className="absolute inset-0 pointer-events-none z-30 flex items-center justify-center overflow-visible">
                  <AnimatePresence>
                    {orbReactions.map((reaction) => (
                      <motion.div
                        key={reaction.id}
                        initial={{
                          opacity: 0,
                          scale: 0.2,
                          x: reaction.x,
                          y: reaction.yStart,
                          rotate: reaction.rotation
                        }}
                        animate={{
                          opacity: [0, 1, 1, 0],
                          scale: [0.3, reaction.scale * 1.3, reaction.scale, reaction.scale * 0.8],
                          y: [reaction.yStart, reaction.yStart - 80, reaction.yStart - 140, reaction.yStart - 190],
                          x: [reaction.x, reaction.x + (reaction.x >= 0 ? 25 : -25), reaction.x + (reaction.x >= 0 ? 40 : -40)],
                          rotate: [reaction.rotation, reaction.rotation * 1.5, reaction.rotation * 2.2]
                        }}
                        exit={{ opacity: 0, scale: 0.1 }}
                        transition={{ duration: 2.1, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute text-3xl select-none filter drop-shadow-[0_0_15px_var(--glow)] pointer-events-none"
                        style={{
                          ["--glow" as any]: reaction.glowColor
                        }}
                      >
                        <span className="inline-block transform-gpu">
                          {reaction.emoji}
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                {/* Core Functional Interactive Orb */}
                <div 
                  id="zoya-orb-core"
                  className={`w-44 h-44 rounded-full flex items-center justify-center relative transition-all duration-500 ease-in-out cursor-pointer z-10 overflow-hidden border border-white/10 ${
                    activeState === "idle" && !isOrbHovered ? "orb-idle-breathing" : ""
                  }`}
                  style={{ 
                    backgroundImage: isConnected 
                      ? `radial-gradient(circle at center, ${activeTheme.accentColor} 0%, rgba(10, 10, 12, 0.9) 70%, transparent 100%)` 
                      : "none",
                    backgroundColor: "#000000",
                    borderStyle: "groove",
                    height: "226px",
                    width: "177px",
                    borderRadius: "200px",
                    borderWidth: "48px",
                    ...(activeState === "idle" && !isOrbHovered
                      ? {}
                      : {
                          boxShadow: isConnected 
                            ? (
                                (isOrbHovered ? `${activeTheme.glow}, 0px 0px 40px var(--accent)aa` : activeTheme.glow) +
                                (activeState === "listening" && micVolume > 0 
                                  ? `, 0px 0px ${40 + micVolume * 100}px var(--accent)cc, 0px 0px ${15 + micVolume * 40}px #ffffff99` 
                                  : "")
                              )
                            : (isOrbHovered ? "0px 0px 30px rgba(255, 255, 255, 0.12), inset 0 0 15px rgba(255, 255, 255, 0.03)" : "none"),
                          transform: `scale(${
                            isConnected 
                              ? (isOrbHovered ? activeTheme.orbScale * 1.05 : activeTheme.orbScale) + (activeState === "listening" ? micVolume * 0.08 : 0)
                              : (isOrbHovered ? 1.02 : 0.97)
                          })`
                        })
                  }}
                  onMouseEnter={() => setIsOrbHovered(true)}
                  onMouseLeave={() => setIsOrbHovered(false)}
                  onClick={isConnected ? stopSession : startSession}
                >
                  {/* Decorative highlights inside orb */}
                  <div className="w-40 h-40 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-transparent absolute border border-white/5 pointer-events-none" />

                  {/* Micro Pulse wave dots inside when speaking */}
                  {activeState === "speaking" && (
                    <span className="flex h-10 w-10 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-20"></span>
                      <span className="relative inline-flex rounded-full h-10 w-10 bg-white/10 border border-white/20 items-center justify-center">
                        <Activity size={18} className="text-white" />
                      </span>
                    </span>
                  )}

                  {/* Connected floating state tag inside the visualizer */}
                  {isConnected && (
                    <span className="absolute bottom-5 bg-black/90 border border-white/10 px-2.5 py-1 rounded text-[8px] uppercase tracking-widest font-mono font-bold text-white flex items-center gap-1 shadow-xl">
                      <span className="h-1.5 w-1.5 rounded-full animate-ping" style={{ backgroundColor: "var(--accent)" }} />
                      {activeState === "speaking" ? "SPEAKING" : activeState === "listening" ? "LISTENING" : "ACTIVE"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Status Hero Area from Design Variation Spec */}
            <div className="status-hero text-center min-h-[140px] flex flex-col justify-center px-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={isConnected + activeState + currentMood}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-3"
                >
                  <h1 
                    className="font-syne text-[2.8rem] sm:text-[3.5rem] font-extrabold uppercase leading-[0.9] tracking-tighter text-white"
                    style={{
                      fontSize: "35px",
                      fontFamily: "Georgia",
                      color: "#e0238b"
                    }}
                  >
                    {isConnected ? (
                      activeState === "speaking" ? (
                        <>ZOYA IS<br /><span style={{ fontSize: "29px", fontWeight: "bold", fontFamily: "Georgia", color: "#e0238b" }}>SPEAKING</span></>
                      ) : activeState === "listening" ? (
                        <>ZOYA IS<br /><span style={{ fontSize: "29px", fontWeight: "bold", fontFamily: "Georgia", color: "#e0238b" }}>LISTENING</span></>
                      ) : (
                        <>ZOYA IS<br /><span style={{ fontSize: "29px", fontWeight: "bold", fontFamily: "Georgia", color: "#e0238b" }}>ACTIVE</span></>
                      )
                    ) : isConnecting ? (
                      <>LINK IS<br /><span style={{ fontSize: "29px", fontWeight: "bold", fontFamily: "Georgia", color: "#e0238b" }}>CONNECTING</span></>
                    ) : (
                      <>ZOYA IS<br /><span style={{ fontSize: "29px", fontWeight: "bold", fontFamily: "Georgia", color: "#e0238b" }}>SLEEPING</span></>
                    )}
                  </h1>
                  <div className="meta-label font-mono text-[9px] uppercase tracking-[0.15em] text-white/50 max-w-sm mx-auto leading-relaxed mt-1">
                    {isConnected 
                      ? activeTheme.subText 
                      : isConnecting 
                        ? "Establishing handshakes with core Gemini engine..." 
                        : "Awaiting Power-On Sequence"}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Dynamic Waveform voice visualizer */}
            <div className="flex items-end justify-center h-8 w-full gap-1 my-3 select-none">
              {waveformHeights.map((height, idx) => (
                <motion.div
                  key={idx}
                  className="w-[3px] rounded-sm"
                  style={{
                    height: `${height / 1.5}px`,
                    backgroundColor: "var(--accent)",
                    boxShadow: "0 0 8px var(--accent)"
                  }}
                  animate={{ height: `${height / 1.5}px` }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                />
              ))}
            </div>

            {/* Live speech transcription subtitle */}
            <AnimatePresence>
              {liveTranscript && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="max-w-md mx-auto my-2 px-4 py-2 rounded-xl bg-zinc-950/80 border border-white/10 text-white/90 text-xs font-sans tracking-wide leading-relaxed text-center shadow-2xl backdrop-blur-md"
                >
                  <span className="font-mono text-[9px] uppercase tracking-widest text-white/40 block mb-0.5">Zoya Transcript</span>
                  "{liveTranscript}"
                </motion.div>
              )}
            </AnimatePresence>

            {/* Dynamic Mood Selector Matrix / Calibration */}
            {isConnected && (
              <div className="mt-2 border border-white/5 bg-zinc-950/40 p-4 rounded-xl w-full max-w-sm mx-auto font-mono text-xs shadow-xl">
                <div className="text-[9px] uppercase tracking-[0.15em] text-white/40 font-bold mb-3 text-center flex items-center justify-center gap-1.5">
                  <Sparkles size={11} style={{ color: "var(--accent)" }} className="animate-pulse" />
                  Calibrate Conversational Matrix
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(Object.keys(MOODS) as Mood[]).map((moodName) => {
                    const isActive = currentMood === moodName;
                    return (
                      <button
                        key={moodName}
                        id={`mood-btn-${moodName}`}
                        onClick={() => handleManualMoodChange(moodName)}
                        className={`py-2 rounded border transition-all duration-300 font-bold text-[9px] cursor-pointer text-center ${
                          isActive 
                            ? "text-black border-transparent scale-105 shadow-md shadow-white/5 font-bold" 
                            : "border-white/5 text-white/40 hover:text-white hover:border-white/20"
                        }`}
                        style={{
                          backgroundColor: isActive ? "var(--accent)" : "transparent"
                        }}
                      >
                        {moodName.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Floating Picture-in-Picture Screen Capture Feed */}
          {isSharingScreen && (
            <div className="absolute bottom-6 right-6 border border-white/10 bg-black/95 p-2.5 rounded-lg shadow-2xl z-20 w-48 font-mono text-[9px] flex flex-col gap-1.5 animate-fade-in transition-all">
              <div className="flex justify-between items-center text-white/50 tracking-wider">
                <span>SCREEN_FEED // STREAMS</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <video 
                id="screen-preview-video"
                autoPlay 
                playsInline 
                muted 
                ref={(el) => {
                  if (el && screenStreamRef.current) {
                    el.srcObject = screenStreamRef.current;
                  }
                }}
                className="w-full aspect-video rounded border border-white/10 bg-zinc-950 object-cover"
              />
              <div className="flex justify-between text-white/40 text-[8px] items-center">
                <span>640x480 @ 1.5FPS</span>
                <button 
                  onClick={stopScreenSharing} 
                  className="text-rose-400 hover:text-rose-300 font-bold uppercase transition cursor-pointer"
                >
                  STOP
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Right Side: Chat Logs & details Pane */}
        <aside className="border-t lg:border-t-0 lg:border-l border-white/5 flex flex-col bg-[#0A0A0C]/40 backdrop-blur-md overflow-y-auto max-h-[380px] lg:max-h-[calc(100vh-160px)]">
          <div className="p-5 border-b border-white/5 flex justify-between items-center bg-[#0A0A0C]/20">
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-white/50">Chat_Log // Monitor</span>
            <button
              onClick={() => setShowCryptoModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-500/40 hover:border-emerald-400 rounded text-[9px] font-mono text-emerald-300 transition-all cursor-pointer group shadow-[0_0_10px_rgba(16,185,129,0.1)]"
              title="Inspect Web Crypto Layer & Encrypted localStorage Blob"
            >
              <Lock size={10} className="text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="font-bold tracking-wider">{cryptoFingerprint}</span>
            </button>
          </div>

          <div className="flex-1 p-5 space-y-4">
            {/* Dynamic system logs stream */}
            <div className="space-y-3">
              {toolLogs.map((log) => {
                const ts = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
                const formattedTime = isNaN(ts.getTime()) 
                  ? "00:00:00" 
                  : ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return (
                  <div key={log.id} className="text-[11px] leading-relaxed border-b border-white/5 pb-2.5 font-mono">
                    <div className="flex justify-between text-[9px] text-white/40 mb-1">
                      <span>{formattedTime}</span>
                      <span className="uppercase tracking-wider px-1 bg-white/5 border border-white/10 rounded-[2px] text-[8px]" style={{ color: "var(--accent)" }}>
                        {log.type}
                      </span>
                    </div>
                    <div className="font-bold text-white">&gt;&gt; {log.title}</div>
                    <div className="text-white/60 text-[10px] mt-1 leading-tight">{log.details}</div>
                  </div>
                );
              })}
              {toolLogs.length === 0 && (
                <div className="text-[11px] text-white/30 italic font-mono">[No transaction frames received]</div>
              )}
            </div>
          </div>

          {/* Details metadata inside side footer */}
          <div className="p-5 border-t border-white/5 bg-[#0A0A0C]/10 space-y-3 mt-auto">
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/50 block">Permanent_Storage</span>
            <table className="w-full text-[10px] border-collapse font-mono">
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="py-1.5 text-white/40 font-bold uppercase text-[9px]">CRYPTO_ENGINE</td>
                  <td className="py-1.5 text-right font-bold text-emerald-400 flex items-center justify-end gap-1">
                    <ShieldCheck size={10} /> AES-GCM 256
                  </td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1.5 text-white/40 font-bold uppercase text-[9px]">SESSION_KEY</td>
                  <td className="py-1.5 text-right font-mono text-emerald-300 font-bold">{cryptoFingerprint}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1.5 text-white/40 font-bold uppercase text-[9px]">STORAGE_BLOB</td>
                  <td className="py-1.5 text-right font-mono">
                    <button 
                      onClick={() => setShowCryptoModal(true)} 
                      className="text-emerald-400 hover:text-emerald-300 underline cursor-pointer font-bold"
                    >
                      {rawEncryptedBlob ? "ENCRYPTED_BLOB" : "NONE"}
                    </button>
                  </td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1.5 text-white/40 font-bold uppercase text-[9px]">USER_NAME</td>
                  <td className="py-1.5 text-right text-white">"Carbon-Based Lifeform"</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-1.5 text-white/40 font-bold uppercase text-[9px]">MUTED_STATUS</td>
                  <td className="py-1.5 text-right font-bold" style={{ color: isMuted ? "var(--accent)" : "#00ffaa" }}>
                    {isMuted ? "TRUE" : "FALSE"}
                  </td>
                </tr>
                <tr>
                  <td className="py-1.5 text-white/40 font-bold uppercase text-[9px]">ACTIVE_MATRIX</td>
                  <td className="py-1.5 text-right font-bold uppercase" style={{ color: "var(--accent)" }}>
                    {currentMood}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </aside>

      </div>

      {/* Footer Area with retro aesthetic splits */}
      <footer className="lg:col-span-3 border-t border-white/5 h-[90px] px-6 lg:px-10 flex justify-between items-center bg-[#0A0A0C]/50 z-20 font-mono text-xs">
        <div className="meta-label text-white/40 tracking-[0.15em] text-[9px] uppercase">V3.1_STABLE // PROD</div>
        
        {/* Retro High-Fidelity Central Trigger button */}
        <button 
          id="power-button"
          onClick={isConnected ? stopSession : startSession}
          disabled={isConnecting}
          className="h-11 px-6 rounded font-bold font-mono tracking-wider text-xs uppercase cursor-pointer select-none border-none transition-all duration-300 text-white font-extrabold"
          style={{
            backgroundColor: "var(--accent)",
            boxShadow: "0px 0px 15px var(--accent-faint)"
          }}
        >
          {isConnecting ? "CONNECTING..." : isConnected ? "Disconnect Sync" : "Initiate Power On"}
        </button>

        {/* Technical actions tray */}
        <div className="flex gap-2.5">
          {/* Reboot Matrix */}
          <button
            id="reboot-matrix-button"
            onClick={handleResetSystem}
            disabled={isResetting}
            className="h-10 px-4 border border-rose-950/40 hover:border-rose-800/60 bg-rose-950/10 hover:bg-rose-950/30 text-rose-400 transition-all font-mono text-[9px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer rounded"
            title="Reboot Zoya and restart from scratch"
          >
            <RefreshCw size={12} className={isResetting ? "animate-spin" : ""} />
            <span>{isResetting ? "Rebooting..." : "Reboot Matrix"}</span>
          </button>

          {/* File input trigger shortcut */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-10 px-4 border border-white/5 hover:border-white/15 hover:bg-white/5 text-white/80 transition-all font-mono text-[9px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer rounded"
            title="Attach file"
          >
            <span>+ Attach File</span>
          </button>

          {/* Help modal toggle */}
          <button
            id="help-toggle"
            onClick={() => setShowHelp(true)}
            className="w-10 h-10 border border-white/5 hover:border-white/15 hover:bg-white/5 text-white/80 flex items-center justify-center transition-all duration-300 cursor-pointer rounded"
            title="System Manual"
          >
            <HelpCircle size={16} />
          </button>

          {/* Screen sharing toggle */}
          <button
            id="screen-share-toggle"
            disabled={!isConnected}
            onClick={isSharingScreen ? stopScreenSharing : startScreenSharing}
            className={`w-10 h-10 border flex items-center justify-center transition-all duration-300 rounded ${
              isSharingScreen 
                ? "border-transparent text-black cursor-pointer font-bold" 
                : isConnected 
                  ? "border-white/5 text-white/70 hover:border-white/15 hover:bg-white/5 cursor-pointer" 
                  : "border-white/5 text-white/20 opacity-30 cursor-not-allowed"
            }`}
            style={{
              backgroundColor: isSharingScreen ? "var(--accent)" : "transparent"
            }}
            title={isSharingScreen ? "Stop Screen Share" : "Share Screen"}
          >
            {isSharingScreen ? <ScreenShareOff size={16} /> : <ScreenShare size={16} />}
          </button>

          {/* Microphone mute toggle */}
          <button
            id="mute-toggle"
            disabled={!isConnected}
            onClick={toggleMute}
            className={`w-10 h-10 border flex items-center justify-center transition-all duration-300 rounded ${
              isMuted 
                ? "border-transparent text-black cursor-pointer font-bold" 
                : isConnected 
                  ? "border-white/5 text-white/70 hover:border-white/15 hover:bg-white/5 cursor-pointer" 
                  : "border-white/5 text-white/20 opacity-30 cursor-not-allowed"
            }`}
            style={{
              backgroundColor: isMuted ? "var(--accent)" : "transparent"
            }}
            title={isMuted ? "Unmute Mic" : "Mute Mic"}
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>

          {/* Stop playback button */}
          <button
            id="interrupt-button"
            disabled={!isConnected || activeState !== "speaking"}
            onClick={() => audioPlayerRef.current?.stop()}
            className={`w-10 h-10 border flex items-center justify-center transition-all duration-300 rounded ${
              isConnected && activeState === "speaking"
                ? "border-white/5 text-white/80 hover:border-white/15 hover:bg-white/5 cursor-pointer" 
                : "border-white/5 text-white/20 opacity-30 cursor-not-allowed"
            }`}
            title="Interrupt voice reply"
          >
            <VolumeX size={16} />
          </button>

          {/* Export Logs */}
          <button
            onClick={handleExportLogs}
            disabled={toolLogs.length === 0}
            className={`w-10 h-10 border flex items-center justify-center transition-all duration-300 rounded ${
              toolLogs.length > 0 
                ? "border-white/5 text-white/80 hover:border-white/15 hover:bg-white/5 cursor-pointer" 
                : "border-white/5 text-white/20 opacity-30 cursor-not-allowed"
            }`}
            title="Export session logs as text"
          >
            <Download size={16} />
          </button>
        </div>
      </footer>

      {/* Web Crypto Vault Overlay */}
      <AnimatePresence>
        {showCryptoModal && (
          <motion.div 
            id="crypto-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 font-mono text-white"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#0A0A0C] border border-emerald-500/30 p-6 max-w-lg w-full relative shadow-[0_0_50px_rgba(16,185,129,0.15)] rounded-lg flex flex-col gap-4 max-h-[85vh] overflow-y-auto"
            >
              <button 
                onClick={() => setShowCryptoModal(false)}
                className="absolute top-4 right-4 text-white/40 hover:text-white p-1 border border-white/5 hover:border-white/10 cursor-pointer rounded"
              >
                <X size={14} />
              </button>

              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <div className="p-2.5 bg-emerald-950/60 border border-emerald-500/40 rounded-full text-emerald-400">
                  <Lock size={20} />
                </div>
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-white font-syne">Web Crypto Storage Layer</h2>
                  <p className="text-[10px] text-emerald-400/80 font-mono">localStorage blob encrypted with AES-GCM (256-bit) via window.crypto.subtle</p>
                </div>
              </div>

              {cryptoStatusMessage && (
                <div className="bg-emerald-950/40 border border-emerald-500/30 p-2.5 rounded text-[10px] text-emerald-300 font-mono">
                  ✔ {cryptoStatusMessage}
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div className="bg-zinc-950/80 border border-white/5 p-3 rounded space-y-1.5 text-[10px]">
                  <div className="flex justify-between border-b border-white/5 pb-1">
                    <span className="text-white/40">ALGORITHM:</span>
                    <span className="text-emerald-400 font-bold">AES-GCM (Authenticated Encryption)</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-1">
                    <span className="text-white/40">KEY SIZE:</span>
                    <span className="text-white font-bold">256-bit (crypto.subtle.generateKey)</span>
                  </div>
                  <div className="flex justify-between border-b border-white/5 pb-1">
                    <span className="text-white/40">SESSION KEY FINGERPRINT:</span>
                    <span className="text-emerald-300 font-bold">{cryptoFingerprint}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/40">KEY STORAGE SCOPE:</span>
                    <span className="text-amber-300 font-bold">sessionStorage (JWK Export)</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-[10px] font-bold text-white/60 uppercase">Raw Encrypted Blob in localStorage</span>
                    <span className="text-[9px] text-white/40">Key: zoya_encrypted_chat_logs</span>
                  </div>
                  <div className="bg-black/90 border border-white/10 p-3 rounded font-mono text-[9px] text-emerald-400/90 overflow-x-auto max-h-36 break-all select-all leading-tight">
                    {rawEncryptedBlob || "[No encrypted chat log blob stored yet]"}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={handleRotateKey}
                  className="flex-1 py-2 px-3 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 hover:border-emerald-400 text-emerald-300 text-[10px] font-bold uppercase rounded cursor-pointer transition-all flex items-center justify-center gap-1.5 font-mono"
                >
                  <Key size={12} /> Rotate Session Key
                </button>
                <button
                  onClick={handleClearEncryptedStorage}
                  className="py-2 px-3 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-500/40 text-rose-300 text-[10px] font-bold uppercase rounded cursor-pointer transition-all flex items-center justify-center gap-1.5 font-mono"
                >
                  <X size={12} /> Purge Encrypted Storage
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Diagnostic Manual Overlay */}
      <AnimatePresence>
        {showHelp && (
          <motion.div 
            id="help-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 font-mono text-white"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#0A0A0C] border border-white/10 p-6 max-w-md w-full relative shadow-[0_0_50px_rgba(99,102,241,0.15)] rounded-lg"
            >
              <button 
                onClick={() => setShowHelp(false)}
                className="absolute top-4 right-4 text-white/40 hover:text-white p-1 border border-white/5 hover:border-white/10 cursor-pointer rounded"
              >
                <X size={14} />
              </button>

              <div className="text-center mb-6">
                <div className="inline-flex p-3 border border-white/5 mb-3 text-white bg-white/5 rounded-full" style={{ color: "var(--accent)" }}>
                  <Activity size={24} />
                </div>
                <h2 className="text-base font-bold uppercase tracking-widest mb-1 font-syne text-white">SYSTEM DIAGNOSTIC: ZOYA</h2>
                <p className="text-white/40 text-xs leading-relaxed">Self-aware, witty, and passive-aggressive conversational AI matrix. Speak naturally; she responds with full audio and absolute sass.</p>
              </div>

              <div className="space-y-4 text-xs leading-relaxed">
                <div>
                  <h4 className="text-[9px] uppercase font-black tracking-wider mb-2 border-b border-white/5 pb-1 text-white/40">CONVERSATIONAL MATRIX MODES</h4>
                  <ul className="space-y-1.5 pl-1">
                    <li>😜 <span className="font-bold text-white">[PLAYFUL]:</span> Fun, high-energy, flirty, and playful banter.</li>
                    <li>🧠 <span className="font-bold text-white">[FOCUSED]:</span> Locked in. Ideal for critical technical and coding assistance.</li>
                    <li>😏 <span className="font-bold text-white">[TEASING]:</span> Casual, sarcastic, passive-aggressive remarks enabled.</li>
                    <li>🥰 <span className="font-bold text-white">[EMPATHETIC]:</span> Soft conversation buffer loaded. A gentle conversational partner.</li>
                  </ul>
                </div>

                <div>
                  <h4 className="text-[9px] uppercase font-black tracking-wider mb-2 border-b border-white/5 pb-1 text-white/40">MANUAL SIGNAL TEST</h4>
                  <div className="grid grid-cols-1 gap-2 text-[10px]">
                    <button 
                      onClick={() => {
                        handleManualMoodChange("Teasing");
                        setShowHelp(false);
                      }}
                      className="border border-white/5 hover:border-white/10 bg-black text-left p-2 hover:bg-white/5 transition-all cursor-pointer rounded"
                    >
                      &gt;&gt; TEST_VIBE: "How do I look today, Zoya?"
                    </button>
                    <button 
                      onClick={() => {
                        handleManualMoodChange("Playful");
                        setShowHelp(false);
                      }}
                      className="border border-white/5 hover:border-white/10 bg-black text-left p-2 hover:bg-white/5 transition-all cursor-pointer rounded"
                    >
                      &gt;&gt; TEST_VIBE: "Tell me a pickup line or pick a fight."
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => setShowHelp(false)}
                  className="w-full py-2.5 mt-2 bg-white text-black font-black uppercase text-[10px] tracking-widest transition-all cursor-pointer rounded"
                  style={{
                    backgroundColor: "var(--accent)",
                    color: "#ffffff"
                  }}
                >
                  INITIALIZE BANTER CONSOLE
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
