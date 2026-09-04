import { useCallback, useEffect, useRef, useState } from "react";

const WIDTH = 520;
const HEIGHT = 220;
const GROUND = 180;
const PLAYER_SIZE = 22;

type Obstacle = { x: number; width: number; height: number; passed: boolean };
type GameState = {
  y: number;
  velocity: number;
  obstacles: Obstacle[];
  score: number;
  spawnIn: number;
  over: boolean;
};

function freshState(): GameState {
  return { y: GROUND - PLAYER_SIZE, velocity: 0, obstacles: [], score: 0, spawnIn: 55, over: false };
}

export function GeometryDash() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(freshState());
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => Number(localStorage.getItem("geometry-dash-best") || 0));

  const draw = useCallback((state: GameState) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

       ctx.fillStyle = "#f7f1df";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
       ctx.fillStyle = "#d8c9a5";
    for (let x = -(state.score * 3 % 32); x < WIDTH; x += 32) ctx.fillRect(x, 20, 1, 130);
       ctx.fillStyle = "#e8dfc7";
    ctx.fillRect(0, GROUND, WIDTH, HEIGHT - GROUND);
       ctx.fillStyle = "#77705f";
    ctx.fillRect(0, GROUND, WIDTH, 4);

       ctx.fillStyle = "#4b3621";
    ctx.fillRect(50, state.y, PLAYER_SIZE, PLAYER_SIZE);
       ctx.fillStyle = "#f7f1df";
    ctx.fillRect(56, state.y + 5, 4, 4);
    ctx.fillRect(64, state.y + 5, 4, 4);

    for (const obstacle of state.obstacles) {
       ctx.fillStyle = "#46505a";
      ctx.beginPath();
      ctx.moveTo(obstacle.x, GROUND);
      ctx.lineTo(obstacle.x + obstacle.width / 2, GROUND - obstacle.height);
      ctx.lineTo(obstacle.x + obstacle.width, GROUND);
      ctx.closePath();
      ctx.fill();
    }

    ctx.font = "bold 18px monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`SCORE ${state.score}`, 12, 25);
    if (!running || state.over) {
      ctx.fillStyle = "rgba(5, 8, 22, 0.7)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.textAlign = "center";
      ctx.font = "bold 25px monospace";
      ctx.fillStyle = "#ffffff";
       ctx.fillText(state.over ? "GAME OVER" : "DINO RUN", WIDTH / 2, 90);
      ctx.font = "14px monospace";
      ctx.fillStyle = "#ffd447";
      ctx.fillText(state.over ? "Click or press Space to try again" : "Click or press Space to start", WIDTH / 2, 120);
      ctx.textAlign = "left";
    }
  }, [running]);

  useEffect(() => { draw(stateRef.current); }, [draw]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let previous = performance.now();
    const loop = (now: number) => {
      const state = stateRef.current;
      const step = Math.min(2, Math.max(0.5, (now - previous) / 16.67));
      previous = now;
      state.velocity += 0.72 * step;
      state.y += state.velocity * step;
      if (state.y >= GROUND - PLAYER_SIZE) {
        state.y = GROUND - PLAYER_SIZE;
        state.velocity = 0;
      }

      state.spawnIn -= step;
      if (state.spawnIn <= 0) {
        state.obstacles.push({
          x: WIDTH + 10,
          width: 20 + Math.random() * 12,
          height: 24 + Math.random() * 22,
          passed: false,
        });
        state.spawnIn = 68 + Math.random() * 55;
      }
      const speed = (3.5 + Math.min(3, state.score / 18)) * step;
      state.obstacles.forEach((obstacle) => { obstacle.x -= speed; });
      for (const obstacle of state.obstacles) {
        if (!obstacle.passed && obstacle.x + obstacle.width < 50) {
          obstacle.passed = true;
          state.score++;
          setScore(state.score);
        }
      }
      state.obstacles = state.obstacles.filter((obstacle) => obstacle.x + obstacle.width > -10);

      const playerLeft = 50;
      const playerRight = playerLeft + PLAYER_SIZE;
      const playerBottom = state.y + PLAYER_SIZE;
      if (state.obstacles.some((obstacle) =>
        playerRight > obstacle.x &&
        playerLeft < obstacle.x + obstacle.width &&
        playerBottom > GROUND - obstacle.height
      )) {
        state.over = true;
        setRunning(false);
        const newBest = Math.max(best, state.score);
        setBest(newBest);
        localStorage.setItem("geometry-dash-best", String(newBest));
        draw(state);
        return;
      }
      draw(state);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [best, draw, running]);

  const start = useCallback(() => {
    const state = freshState();
    stateRef.current = state;
    setScore(0);
    setRunning(true);
  }, []);

  const jump = useCallback(() => {
    const state = stateRef.current;
    if (!running || state.over) { start(); return; }
    if (state.y >= GROUND - PLAYER_SIZE - 2) state.velocity = -10;
  }, [running, start]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") { event.preventDefault(); jump(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump]);

  return (
    <div className="w-full h-full flex flex-col bg-[#111a38] text-white text-xs p-2 gap-2">
      <div className="flex items-center gap-3 shrink-0">
       <div className="font-bold tracking-wide">DINO RUN</div>
        <div className="text-yellow-300">Best: {best}</div>
        <div className="flex-1" />
        <button className="win98-button text-black px-2 py-0.5" onClick={start}>{running ? "Restart" : "Start"}</button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="max-w-full max-h-full border-2 border-[#6c79b8] cursor-pointer"
          style={{ imageRendering: "pixelated" }}
          onPointerDown={(event) => { event.preventDefault(); jump(); }}
        />
      </div>
       <div className="text-center text-[10px] text-[#4b3621] shrink-0">Click or press Space to jump over cacti.</div>
    </div>
  );
}