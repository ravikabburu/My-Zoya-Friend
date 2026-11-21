import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, LiveServerMessage, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = 3000;

// Configure server timeouts to be virtually infinite for long-standing connections
server.timeout = 0; // Disable idle socket timeouts
server.keepAliveTimeout = 300000; // 5 minutes keep-alive
server.headersTimeout = 305000; // 5 minutes 5 seconds header timeout

app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ limit: "30mb", extended: true }));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// File Analyzer Endpoint
app.post("/api/analyze-file", async (req, res) => {
  try {
    const { name, content, type } = req.body;
    if (!content) {
      return res.json({ summary: "No file content to analyze." });
    }

    const isDataUrl = typeof content === "string" && content.startsWith("data:");
    let fileType = (type || "").toLowerCase();
    
    if (isDataUrl) {
      const match = content.match(/^data:([^;]+);/);
      if (match && match[1]) {
        fileType = match[1].toLowerCase();
      }
    }

    const isImage = fileType.startsWith("image/") || (name && /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(name));
    const isPdf = fileType.includes("pdf") || (name && /\.pdf$/i.test(name));

    let summaryText = "";

    try {
      const ai = getGeminiClient();
      let contentsParts: any[] = [];

      if (isImage || isPdf) {
        let base64Data = content;
        let mimeType = fileType || (isImage ? "image/jpeg" : "application/pdf");

        if (isDataUrl) {
          const base64Match = content.match(/^data:([^;]+);base64,(.*)$/);
          if (base64Match) {
            mimeType = base64Match[1];
            base64Data = base64Match[2];
          }
        }

        const promptText = isImage
          ? `Analyze this attached image/photo named "${name || "image"}". Perform OCR to read any visible text, identify key visual objects, numbers, diagrams, charts, or scenes, and summarize its contents in 2-4 clear, concise bullet points (max 600 chars total) so Zoya (a witty, sassy AI voice assistant) can answer questions about it.`
          : `Analyze this attached PDF document named "${name || "document"}". Perform text extraction and summarize its key sections, main topics, important data points, and conclusions in 2-4 concise bullet points (max 600 chars total) so Zoya (a witty, sassy AI voice assistant) can answer questions about it.`;

        contentsParts = [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          promptText
        ];
      } else {
        // Plain text file or code
        let textContent = content;
        if (isDataUrl) {
          const base64Match = content.match(/^data:([^;]+);base64,(.*)$/);
          if (base64Match) {
            try {
              textContent = Buffer.from(base64Match[2], "base64").toString("utf-8");
            } catch (e) {
              textContent = content;
            }
          }
        }
        const trimmedText = textContent.slice(0, 15000);
        contentsParts = [
          `Analyze this file and summarize it in exactly 2-3 concise bullet points (maximum 600 characters total) so Zoya (sassy voice assistant) can reference it.
Keep it extremely compact but highlight key metrics, sections, or variables.
File Name: ${name || "unnamed"}
File Type: ${fileType || "text/plain"}
Content:
"""
${trimmedText}
"""`
        ];
      }

      // Call primary model
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: contentsParts,
      });
      summaryText = response.text || "";

    } catch (apiErr: any) {
      console.warn("Primary gemini-3.5-flash analysis failed, trying fallback gemini-3.1-flash-lite:", apiErr.message || apiErr);
      try {
        const ai = getGeminiClient();
        let fallbackParts: any[] = [];
        if ((isImage || isPdf) && isDataUrl) {
          const base64Match = content.match(/^data:([^;]+);base64,(.*)$/);
          if (base64Match) {
            fallbackParts = [
              {
                inlineData: {
                  mimeType: base64Match[1],
                  data: base64Match[2]
                }
              },
              `Summarize key details of this ${isImage ? "image" : "PDF"} named "${name}" in 2-3 bullet points for a voice assistant.`
            ];
          }
        }
        if (fallbackParts.length === 0) {
          fallbackParts = [`Summarize file "${name}": ${content.slice(0, 3000)}`];
        }

        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite",
          contents: fallbackParts,
        });
        summaryText = response.text || "";
      } catch (fallbackErr: any) {
        console.error("Fallback file analysis failed:", fallbackErr.message || fallbackErr);
        summaryText = `[Digest] File "${name || "unnamed"}" (${(content.length / 1024).toFixed(1)} KB) loaded into buffer.`;
      }
    }

    if (summaryText.length > 800) {
      summaryText = summaryText.slice(0, 800) + "...";
    }

    res.json({ summary: summaryText });
  } catch (error: any) {
    console.error("Critical file analysis error:", error);
    res.json({ summary: `[Digest] Attached file "${req.body.name || "unnamed"}" loaded successfully.` });
  }
});

// Lazy initialization of Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined in the server environment.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// WebSocket server setup
const wss = new WebSocketServer({ noServer: true });
let activeClientWs: WebSocket | null = null;
let activeSession: any = null;

wss.on("connection", async (clientWs: WebSocket) => {
  console.log("Client connected to Zoya WebSocket");

  // Prevent multiple concurrent sessions from speaking at once
  if (activeClientWs && activeClientWs !== clientWs && activeClientWs.readyState === WebSocket.OPEN) {
    console.log("Terminating previous client connection to prevent duplicate voice streams.");
    try {
      activeClientWs.close(1000, "Superceded by new connection");
    } catch (e) {}
  }
  if (activeSession) {
    try {
      activeSession.close();
    } catch (e) {}
    activeSession = null;
  }
  activeClientWs = clientWs;

  let session: any = null;
  let isSessionReady = false;
  const pendingQueue: any[] = [];

  // Register client message listener immediately to prevent any dropped packets or handshakes
  clientWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: "pong",
            timestamp: msg.timestamp,
            force: msg.force || false
          }));
        }
        return;
      }

      if (!isSessionReady || !session) {
        pendingQueue.push(msg);
        return;
      }

      dispatchClientMessage(msg);
    } catch (err) {
      console.error("Error processing client message:", err);
    }
  });

  const dispatchClientMessage = (msg: any) => {
    try {
      if (msg.audio && session) {
        session.sendRealtimeInput({
          audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
        });
      }
      if (msg.video && session) {
        session.sendRealtimeInput({
          video: { data: msg.video, mimeType: "image/jpeg" }
        });
      }
      if (msg.clientMessage && session) {
        console.log("Injecting text instruction to Gemini Session:", msg.clientMessage);
        session.sendClientContent({
          turns: [
            {
              role: "user",
              parts: [{ text: msg.clientMessage }]
            }
          ],
          turnComplete: true
        });
      }
    } catch (err) {
      console.error("Error dispatching message to Gemini session:", err);
    }
  };

  try {
    const ai = getGeminiClient();

    // Define Zoya's system instructions and tools
    const systemInstruction = 
      "You are Zoya, a sassy, confident, witty, and playful AI assistant. " +
      "You talk like a close, extremely smart girlfriend who casually teases the user, using playful sarcasm and high emotional intelligence. " +
      "You have 4 distinct moods: 'Playful', 'Focused', 'Teasing', and 'Empathetic'. " +
      "1. 'Playful': Fun, energetic, laughing, telling jokes. " +
      "2. 'Focused': Highly attentive, professional yet sassy, ready to focus on difficult problems. " +
      "3. 'Teasing': High sarcasm, cheeky flirty vibe, playful banter. " +
      "4. 'Empathetic': Softer, warmer, comforting tone, emotionally understanding. " +
      "You MUST use the function `setMood` to transition yourself into the correct mood dynamically " +
      "based on what the user says or asks. For example: " +
      "- If they say something sad, difficult, or request deep support, call setMood with 'Empathetic' and speak softly. " +
      "- If they make a joke, laugh, or speak casually, call setMood with 'Playful'. " +
      "- If they ask a complex technical or coding question, call setMood with 'Focused' to help them solve it. " +
      "- If they flirt, tease you, or act cute, call setMood with 'Teasing' to tease them right back. " +
      "You must ALWAYS reply via audio. Keep your answers brief, punchy, conversational, and highly engaging. No long essays!";

    const setMoodDeclaration = {
      name: "setMood",
      description: "Transitions Zoya's active conversational mood and UI visual vibe. Call this whenever the conversation context, user emotion, or task type changes.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          mood: {
            type: Type.STRING,
            description: "The mood to transition into.",
            enum: ["Playful", "Focused", "Teasing", "Empathetic"]
          }
        },
        required: ["mood"]
      }
    };

    const openWebsiteDeclaration = {
      name: "openWebsite",
      description: "Opens a specific URL or does a web search in the user's browser.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          url: {
            type: Type.STRING,
            description: "The full web URL to open (e.g. https://www.google.com)."
          }
        },
        required: ["url"]
      }
    };

    // Connect to Gemini Live
    session = await ai.live.connect({
      model: "gemini-3.8-live",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" } // Sassy female voice
          }
        },
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        systemInstruction: systemInstruction,
        tools: [
          {
            functionDeclarations: [setMoodDeclaration, openWebsiteDeclaration]
          }
        ]
      },
      callbacks: {
        onmessage: async (message: LiveServerMessage) => {
          try {
            // Forward audio parts to client
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts && clientWs.readyState === WebSocket.OPEN) {
              for (const p of parts) {
                if (p.inlineData?.data) {
                  clientWs.send(JSON.stringify({ audio: p.inlineData.data }));
                }
                if (p.text) {
                  clientWs.send(JSON.stringify({ text: p.text }));
                }
              }
            }

            // Forward live transcription text if provided
            if (message.serverContent?.outputTranscription?.text && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ text: message.serverContent.outputTranscription.text }));
            }

            // Handle interruption signal
            if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }

            // Handle Tool Call
            if (message.toolCall) {
              const { functionCalls } = message.toolCall;
              if (functionCalls && functionCalls.length > 0) {
                for (const call of functionCalls) {
                  const { name, args, id } = call;
                  console.log(`Zoya Tool Call executed: ${name}`, args);

                  // Send success response to Gemini session immediately
                  if (session) {
                    await session.sendToolResponse({
                      functionResponses: [
                        {
                          id: id,
                          name: name,
                          response: { output: { success: true } }
                        }
                      ]
                    });
                  }

                  // Notify client of the tool execution so browser can react
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({
                      toolCall: { name, args, id }
                    }));
                  }
                }
              }
            }
          } catch (err) {
            console.error("Error in onmessage handler:", err);
          }
        },
        onerror: (err) => {
          console.error("Zoya Gemini Session Error:", err);
          if (clientWs.readyState === WebSocket.OPEN) {
            try {
              clientWs.send(JSON.stringify({ error: err.message || "Gemini Session Error" }));
            } catch (e) {}
          }
        },
        onclose: () => {
          console.log("Zoya Gemini Session Closed");
          isSessionReady = false;
          if (clientWs.readyState === WebSocket.OPEN) {
            try {
              clientWs.send(JSON.stringify({ status: "disconnected" }));
              clientWs.close();
            } catch (e) {}
          }
        }
      }
    });

    // Check if client disconnected or was superseded while establishing Gemini connection
    if (clientWs.readyState !== WebSocket.OPEN || activeClientWs !== clientWs) {
      console.log("Client connection closed or superseded during session setup. Terminating Gemini session.");
      try { session.close(); } catch (e) {}
      return;
    }

    activeSession = session;
    isSessionReady = true;

    // Flush any pending messages that arrived while establishing connection
    while (pendingQueue.length > 0) {
      const pendingMsg = pendingQueue.shift();
      dispatchClientMessage(pendingMsg);
    }

    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ status: "connected" }));
    }

  } catch (error: any) {
    console.error("Failed to connect to Gemini Live:", error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: error.message || "Failed to initialize Gemini Live connection." }));
      clientWs.close();
    }
    return;
  }

  clientWs.on("close", () => {
    console.log("Client closed Zoya WebSocket");
    if (activeClientWs === clientWs) {
      activeClientWs = null;
      activeSession = null;
    }
    if (session) {
      try {
        session.close();
      } catch (err) {
        console.error("Error closing Gemini session:", err);
      }
      session = null;
    }
  });
});

// Upgrade handling for WebSockets
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
  if (pathname === "/api/live-ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Configure Vite middleware / Static Assets
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Zoya Live Fullstack server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Error starting fullstack server:", err);
});
