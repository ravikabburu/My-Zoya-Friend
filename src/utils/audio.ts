/**
 * Audio helpers for Float32 and PCM16 conversions and gapless playback.
 */

export function float32ToPCM16(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function pcmToBase64(float32Array: Float32Array): string {
  const pcmBuffer = float32ToPCM16(float32Array);
  const bytes = new Uint8Array(pcmBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Safely converts base64 PCM16 into Float32Array for Web Audio playback.
 * Clamps to valid 16-bit boundaries to prevent RangeErrors and handles base64url padding safely.
 */
export function base64ToFloat32(base64: string): Float32Array {
  try {
    if (!base64 || typeof base64 !== "string") return new Float32Array(0);
    const cleanBase64 = base64.trim().replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(cleanBase64);
    const len = binary.length;
    const sampleCount = Math.floor(len / 2);
    if (sampleCount === 0) return new Float32Array(0);

    const bytes = new Uint8Array(sampleCount * 2);
    for (let i = 0; i < sampleCount * 2; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const view = new DataView(bytes.buffer);
    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      float32[i] = view.getInt16(i * 2, true) / 32768.0;
    }
    return float32;
  } catch (err) {
    console.warn("Failed to decode base64 audio chunk:", err);
    return new Float32Array(0);
  }
}

/**
 * High-fidelity, gapless Web Audio queue player for 24kHz Gemini Live PCM audio.
 * Manages precise scheduling, user-gesture unlock, and speaking state.
 */
export class AudioQueuePlayer {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private nextStartTime: number = 0;
  private activeSources: Set<AudioBufferSourceNode> = new Set();
  private sampleRate: number;
  public onStateChange: ((state: "speaking" | "idle") => void) | null = null;
  public isSpeaking: boolean = false;
  private idleCheckTimer: any = null;

  constructor(sampleRate: number = 24000) {
    this.sampleRate = sampleRate;
  }

  /**
   * Initializes or returns the AudioContext.
   */
  public getContext(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      try {
        this.ctx = new AudioContextClass({ sampleRate: this.sampleRate });
      } catch (e) {
        this.ctx = new AudioContextClass();
      }
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 1.0;
      this.gainNode.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Unlocks and resumes the AudioContext within a direct user interaction.
   */
  public async resume(): Promise<void> {
    try {
      const ctx = this.getContext();
      if (ctx.state === "suspended") {
        await ctx.resume();
        console.log("AudioQueuePlayer: AudioContext resumed successfully, state is", ctx.state);
      }
    } catch (err) {
      console.warn("AudioQueuePlayer: Error resuming AudioContext:", err);
    }
  }

  /**
   * Enqueues an audio chunk (base64 PCM16) for immediate gapless playback.
   */
  public playChunk(base64Data: string): void {
    const ctx = this.getContext();

    // Auto-resume attempt if suspended
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const float32 = base64ToFloat32(base64Data);
    if (float32.length === 0) return;

    try {
      const audioBuffer = ctx.createBuffer(1, float32.length, this.sampleRate);
      audioBuffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      // Connect through gain node to destination
      if (this.gainNode) {
        source.connect(this.gainNode);
      } else {
        source.connect(ctx.destination);
      }

      const currentTime = ctx.currentTime;
      // If nextStartTime has fallen behind currentTime (queue underrun or first chunk),
      // align slightly in the future to give the Web Audio scheduler a smooth start buffer.
      // Crucially, never pull nextStartTime backward when it is in the future, as chunks
      // stream faster than real-time and must play sequentially without overlapping.
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.025;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;

      this.activeSources.add(source);
      this.setSpeakingState(true);

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          if (this.idleCheckTimer) clearTimeout(this.idleCheckTimer);
          // Wait 60ms to bridge between streaming packets before marking idle
          this.idleCheckTimer = setTimeout(() => {
            if (this.activeSources.size === 0) {
              this.setSpeakingState(false);
              this.nextStartTime = 0;
            }
          }, 60);
        }
      };
    } catch (err) {
      console.warn("AudioQueuePlayer: Failed to play audio chunk:", err);
    }
  }

  private setSpeakingState(speaking: boolean): void {
    if (this.isSpeaking !== speaking) {
      this.isSpeaking = speaking;
      if (this.onStateChange) {
        this.onStateChange(speaking ? "speaking" : "idle");
      }
    }
  }

  /**
   * Immediately stops all currently playing audio chunks and flushes the queue.
   */
  public stop(): void {
    if (this.idleCheckTimer) {
      clearTimeout(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    this.activeSources.forEach((source) => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Source may already have ended
      }
    });

    this.activeSources.clear();
    this.nextStartTime = 0;
    this.setSpeakingState(false);
  }

  /**
   * Shuts down the player and closes AudioContext.
   */
  public close(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== "closed") {
      this.ctx.close().catch(() => {});
      this.ctx = null;
      this.gainNode = null;
    }
  }
}


