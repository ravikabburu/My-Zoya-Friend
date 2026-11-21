import React, { useEffect, useRef } from "react";

interface ParticleFieldProps {
  micVolume: number; // 0 to 1
  activeState: "idle" | "listening" | "speaking";
  isConnected: boolean;
  accentColor?: string;
  secondaryColor?: string;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  orbitRadius: number;
  angle: number;
  orbitSpeed: number;
  alpha: number;
  phase: number;
  colorType: "accent" | "secondary" | "white";
}

export const ParticleField: React.FC<ParticleFieldProps> = ({
  micVolume,
  activeState,
  isConnected,
  accentColor = "#00ffcc",
  secondaryColor = "#a855f7",
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Store state refs so the requestAnimationFrame callback always reads latest values without re-subscribing
  const volumeRef = useRef(micVolume);
  volumeRef.current = micVolume;

  const stateRef = useRef(activeState);
  stateRef.current = activeState;

  const connectedRef = useRef(isConnected);
  connectedRef.current = isConnected;

  const accentRef = useRef(accentColor);
  accentRef.current = accentColor;

  const secondaryRef = useRef(secondaryColor);
  secondaryRef.current = secondaryColor;

  // Mouse interactivity
  const mouseRef = useRef<{ x: number; y: number; active: boolean }>({
    x: -1000,
    y: -1000,
    active: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;
    let centerX = 0;
    let centerY = 0;

    // Initialize particles
    const particleCount = 65;
    const particles: Particle[] = [];

    const initParticles = () => {
      particles.length = 0;
      const maxOrbit = Math.min(width, height) * 0.48;

      for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const orbitRadius = 25 + Math.random() * (maxOrbit - 25);
        const orbitSpeed = (0.002 + Math.random() * 0.005) * (Math.random() > 0.5 ? 1 : -1);

        particles.push({
          x: centerX + Math.cos(angle) * orbitRadius,
          y: centerY + Math.sin(angle) * orbitRadius,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          baseRadius: 1.2 + Math.random() * 2.2,
          orbitRadius,
          angle,
          orbitSpeed,
          alpha: 0.15 + Math.random() * 0.55,
          phase: Math.random() * Math.PI * 2,
          colorType: Math.random() > 0.35 ? "accent" : Math.random() > 0.5 ? "secondary" : "white",
        });
      }
    };

    // Handle resize
    const handleResize = () => {
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      width = rect.width;
      height = rect.height;
      centerX = width / 2;
      centerY = height / 2;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.scale(dpr, dpr);
      initParticles();
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);
    handleResize();

    // Helper to extract RGBA string with custom alpha
    const getHexColor = (type: "accent" | "secondary" | "white", alpha: number) => {
      let colorStr = accentRef.current;
      if (type === "secondary") colorStr = secondaryRef.current;
      if (type === "white") return `rgba(255, 255, 255, ${Math.min(1, alpha)})`;

      // Convert hex to rgb
      if (colorStr.startsWith("#")) {
        let hex = colorStr.replace("#", "");
        if (hex.length === 3) {
          hex = hex.split("").map(c => c + c).join("");
        }
        if (hex.length === 6) {
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          return `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
        }
      }
      return colorStr;
    };

    let time = 0;

    // Main animation frame loop
    const render = () => {
      time += 0.016; // ~60fps step
      const vol = volumeRef.current; // 0 to 1
      const isConn = connectedRef.current;
      const state = stateRef.current;

      // Clear frame smoothly
      ctx.clearRect(0, 0, width, height);

      // Reactivity multipliers
      const volBoost = vol * 2.5; // Audio intensity multiplier
      const maxDistance = Math.min(width, height) * 0.48;

      // 1. Update and Render Particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Angular orbit movement around center
        const speedMultiplier = isConn
          ? (state === "speaking" ? 2.2 : state === "listening" ? 1.5 + volBoost * 2 : 1.0)
          : 0.6;

        p.angle += p.orbitSpeed * speedMultiplier;

        // Dynamic radial offset reacting to mic volume and state
        let targetRadius = p.orbitRadius;
        if (state === "listening" && vol > 0.01) {
          // Push particles outward on audio loudness
          targetRadius += vol * 45 * Math.sin(p.phase + time * 3);
        } else if (state === "speaking") {
          // Rhythmic breathing harmonic
          targetRadius += Math.sin(time * 4 + p.phase) * 12;
        }

        // Keep inside bounds
        targetRadius = Math.max(20, Math.min(maxDistance + 30, targetRadius));

        // Base polar calculation
        let targetX = centerX + Math.cos(p.angle) * targetRadius;
        let targetY = centerY + Math.sin(p.angle) * targetRadius;

        // Smooth particle movement toward polar target
        p.x += (targetX - p.x) * 0.08 + p.vx;
        p.y += (targetY - p.y) * 0.08 + p.vy;

        // Mouse interaction (gentle repulsion)
        if (mouseRef.current.active) {
          const dx = p.x - mouseRef.current.x;
          const dy = p.y - mouseRef.current.y;
          const distSq = dx * dx + dy * dy;
          const forceRadius = 110;

          if (distSq < forceRadius * forceRadius && distSq > 0) {
            const dist = Math.sqrt(distSq);
            const force = (forceRadius - dist) / forceRadius;
            p.x += (dx / dist) * force * 5;
            p.y += (dy / dist) * force * 5;
          }
        }

        // Particle appearance calculations
        const currentRadius = p.baseRadius * (1 + (state === "listening" ? vol * 1.8 : vol * 0.8));
        const pulseAlpha = Math.sin(time * 2 + p.phase) * 0.15;
        const currentAlpha = Math.max(0.1, Math.min(0.95, p.alpha + pulseAlpha + (vol * 0.4)));

        // Draw individual particle glow dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentRadius, 0, Math.PI * 2);
        ctx.fillStyle = getHexColor(p.colorType, currentAlpha);
        
        if (vol > 0.15 || state === "speaking") {
          ctx.shadowBlur = 8 + vol * 15;
          ctx.shadowColor = accentRef.current;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      }

      // Reset shadow blur before drawing lines
      ctx.shadowBlur = 0;

      // 2. Cyber-Constellation Connecting Lines (when audio is active or hovering)
      const connectThreshold = 85 + (vol * 55); // Dynamic link reach expands with mic input
      const maxLinesPerParticle = 3;

      for (let i = 0; i < particles.length; i++) {
        let connectedCount = 0;
        const p1 = particles[i];

        for (let j = i + 1; j < particles.length; j++) {
          if (connectedCount >= maxLinesPerParticle) break;

          const p2 = particles[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < connectThreshold * connectThreshold) {
            const dist = Math.sqrt(distSq);
            const lineAlpha = (1 - dist / connectThreshold) * (0.12 + vol * 0.35);

            if (lineAlpha > 0.02) {
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.strokeStyle = getHexColor("accent", lineAlpha);
              ctx.lineWidth = 0.8 + (vol * 1.2);
              ctx.stroke();
              connectedCount++;
            }
          }
        }
      }

      // 3. Central Radar Wave Rings (subtle futuristic pulse rings on audio peaks)
      if (isConn && (vol > 0.05 || state === "speaking")) {
        const ringRadius = 90 + (vol * 120) + (Math.sin(time * 5) * 10);
        ctx.beginPath();
        ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = getHexColor("accent", 0.08 + (vol * 0.25));
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 12]);
        ctx.stroke();
        ctx.setLineDash([]); // reset dash
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    // Mouse listeners for interactivity
    const handleMouseMove = (e: MouseEvent) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      if (container) {
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("mouseleave", handleMouseLeave);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 pointer-events-auto z-0 overflow-hidden ${className}`}
      style={{ touchAction: "none" }}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

export default ParticleField;
