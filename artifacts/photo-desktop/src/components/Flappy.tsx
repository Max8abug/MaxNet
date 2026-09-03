import { useEffect, useRef, useState } from "react";
import { flappyState, flappyTick, flappyScore, type FlappyPlayer, type FlappyScore } from "../lib/api";
import { useAuth } from "../lib/auth-store";

interface Props { onRequestLogin?: () => void; }

const W = 400, H = 500;
const GRAV = 0.45, JUMP = -7;
const PIPE_W = 50, PIPE_GAP = 140, PIPE_SPEED = 2.2, PIPE_SPACING = 200;
const BIRD_X = 80, BIRD_R = 12;

interface Pipe { x: number; gapY: number; passed: boolean; }

function deterministicGap(seed: number): number {
  // Synced obstacles using simple hash so all players see roughly aligned pipes
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return 80 + Math.floor(((x - Math.floor(x)) * (H - 200)));
}

export function Flappy({ onRequestLogin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const user = useAuth((s) => s.user);
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [highScores, setHighScores] = useState<FlappyScore[]>([]);
  const [others, setOthers] = useState<FlappyPlayer[]>([]);
  const stateRef = useRef({
    y: H / 2, vy: 0, pipes: [] as Pipe[], pipeSeed: 0,
    score: 0, alive: false, frame: 0,
  });

  // Poll for other players + leaderboard
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await flappyState();
        if (!alive) return;
        setHighScores(r.top);
        setOthers(r.players.filter((p) => p.username !== user?.username));
      } catch {}
    };
    load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [user?.username]);

  // Push our own state every 300ms while running
  useEffect(() => {
    if (!running || !user) return;
    const t = setInterval(() => {
      void flappyTick(stateRef.current.y, stateRef.current.score, stateRef.current.alive).catch(() => {});
    }, 300);
    return () => clearInterval(t);
  }, [running, user]);

  function reset() {
    stateRef.current = {
      y: H / 2, vy: 0, pipes: [], pipeSeed: 0, score: 0, alive: true, frame: 0,
    };
    setScore(0);
  }

  function flap() {
    if (!user) { onRequestLogin?.(); return; }
    if (!stateRef.current.alive) {
      reset();
      setRunning(true);
      return;
    }
    stateRef.current.vy = JUMP;
  }

  // Game loop
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const ctx = canvasRef.current!.getContext("2d")!;
    const loop = () => {
      const st = stateRef.current;
      st.frame++;
      // physics
      st.vy += GRAV;
      st.y += st.vy;
      // spawn pipes
      const lastPipe = st.pipes[st.pipes.length - 1];
      if (!lastPipe || lastPipe.x < W - PIPE_SPACING) {
        st.pipeSeed++;
        st.pipes.push({ x: W + PIPE_W, gapY: deterministicGap(st.pipeSeed), passed: false });
      }
      // move pipes
      for (const p of st.pipes) p.x -= PIPE_SPEED;
      st.pipes = st.pipes.filter((p) => p.x + PIPE_W > -10);
      // collisions + scoring
      for (const p of st.pipes) {
        if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
          p.passed = true; st.score++; setScore(st.score);
        }
        if (BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W) {
          if (st.y - BIRD_R < p.gapY || st.y + BIRD_R > p.gapY + PIPE_GAP) {
            st.alive = false;
          }
        }
      }
      if (st.y + BIRD_R > H || st.y - BIRD_R < 0) st.alive = false;

      // draw
      ctx.fillStyle = "#70c5ce"; ctx.fillRect(0, 0, W, H);
      // ground
      ctx.fillStyle = "#ded895"; ctx.fillRect(0, H - 12, W, 12);
      // pipes
      ctx.fillStyle = "#54b04a";
      for (const p of st.pipes) {
        ctx.fillRect(p.x, 0, PIPE_W, p.gapY);
        ctx.fillRect(p.x, p.gapY + PIPE_GAP, PIPE_W, H - (p.gapY + PIPE_GAP));
      }
      // ghosts
      for (const o of others) {
        if (!o.alive) continue;
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath(); ctx.arc(BIRD_X, o.y, BIRD_R, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.font = "10px monospace";
        ctx.fillText(o.username, BIRD_X - 20, o.y - BIRD_R - 4);
      }
      // bird
      ctx.fillStyle = "#ffeb3b";
      ctx.beginPath(); ctx.arc(BIRD_X, st.y, BIRD_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(BIRD_X + 4, st.y - 3, 2, 0, Math.PI * 2); ctx.fill();
      // score
      ctx.fillStyle = "white"; ctx.strokeStyle = "black"; ctx.lineWidth = 3;
      ctx.font = "bold 28px monospace";
      const txt = String(st.score);
      ctx.strokeText(txt, W / 2 - 10, 50); ctx.fillText(txt, W / 2 - 10, 50);

      if (!st.alive) {
        setRunning(false);
        if (user && st.score > 0) void flappyScore(st.score).catch(() => {});
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "white"; ctx.font = "bold 32px monospace";
        ctx.fillText("Game Over", W / 2 - 90, H / 2 - 10);
        ctx.font = "16px monospace";
        ctx.fillText(`Score: ${st.score}`, W / 2 - 50, H / 2 + 20);
        ctx.fillText("Click or Space to restart", W / 2 - 130, H / 2 + 50);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, others, user]);

  // input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === "Space") { e.preventDefault(); flap(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [user]);

  return (
    <div className="w-full h-full flex bg-[#222] text-white text-xs overflow-hidden">
      <div className="flex-1 flex items-center justify-center p-1">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="max-w-full max-h-full"
          style={{ imageRendering: "pixelated" }}
          onPointerDown={(e) => { e.preventDefault(); flap(); }}
        />
      </div>
      <div className="w-32 shrink-0 bg-black/40 p-1 flex flex-col gap-1">
        <div className="font-bold">Score: {score}</div>
        <div className="opacity-70">Click/Space to flap</div>
        {!user && <div className="text-yellow-300">Log in to play & save scores.</div>}
        <div className="mt-2 font-bold">Top scores</div>
        <div className="flex-1 overflow-auto">
          {highScores.length === 0
            ? <div className="opacity-60">none yet</div>
            : highScores.map((s, i) => (
                <div key={s.id} className="flex justify-between gap-1">
                  <span className="truncate">{i + 1}. {s.username}</span>
                  <span className="font-bold">{s.score}</span>
                </div>
              ))}
        </div>
        <div className="mt-1 font-bold">Live</div>
        <div className="flex-1 overflow-auto">
          {others.length === 0
            ? <div className="opacity-60">no one else</div>
            : others.map((o) => (
                <div key={o.username} className={`flex justify-between gap-1 ${o.alive ? "" : "opacity-50"}`}>
                  <span className="truncate">{o.username}</span>
                  <span>{o.score}</span>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
