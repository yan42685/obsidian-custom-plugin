import { EditorView } from "@codemirror/view";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
}

export class InputParticleEffect {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private pool: Particle[] = [];
  private animationFrame = 0;
  private lastSpawnTime = 0;

  // 针对米色背景优化的深冷色调：深青、墨绿、灰蓝
  private readonly colors = ["#006666", "#2f4f4f", "#088da5", "#004d4d", "#5f9ea0"];
  private resizeHandler = () => this.resize();

  constructor() {
    this.initCanvas();
    this.loop();
  }

  private initCanvas(): void {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "position:fixed;top:0;left:0;pointer-events:none;z-index:9999;";
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  public spawn(view: EditorView): void {
    const now = Date.now();
    // 节流阀：50ms 限制，保证性能
    if (now - this.lastSpawnTime < 50) return;
    this.lastSpawnTime = now;

    const pos = view.state.selection.main.head;
    const coords = view.coordsAtPos(pos);
    if (!coords) return;

    const x = coords.left;
    const y = coords.top; 

    // 每一波喷发 50 个分散粒子
    for (let i = 0; i < 50; i++) {
      this.createParticle(x, y);
    }
  }

  private createParticle(x: number, y: number): void {
    const p = this.pool.pop() || { x: 0, y: 0, vx: 0, vy: 0, size: 0, color: "", life: 0 };
    
    /**
     * 非对称角度逻辑：
     * 1. Math.PI * 1.5 是正上方。
     * 2. 左侧角度范围更大 (往左喷得更开)，右侧范围缩小。
     * 3. 这里的随机值范围 [-1.3, 0.7]：负数向左偏移多，正数向右偏移少。
     */
    const angleOffset = Math.random() * 2.0 - 1.3; 
    const angle = (Math.PI * 1.5) + angleOffset; 
    
    const speed = Math.random() * 2.8 + 1.2; 

    // 初始位置分散
    p.x = x + (Math.random() - 0.5) * 12; 
    p.y = y + (Math.random() - 0.5) * 6;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 0.8; 
    p.size = Math.random() * 1.6 + 0.4; 
    p.color = this.colors[Math.floor(Math.random() * this.colors.length)]!;
    
    // 寿命随机，让动画长短交错
    p.life = 1.0 + Math.random() * 0.8;

    this.particles.push(p);
  }

  private loop = (): void => {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.x += p.vx;
      p.y += p.vy;
      
      /**
       * 精准高度控制：
       * 1. 重力 (0.22) 让粒子向下弯曲。
       * 2. 寿命衰减 (0.038) 确保在行底消散。
       */
      p.vy += 0.22; 
      p.life -= 0.038; 

      if (p.life <= 0) {
        this.pool.push(this.particles.splice(i, 1)[0]!);
        continue;
      }

      this.ctx.save();
      this.ctx.beginPath();
      const trail = 0.5;
      this.ctx.moveTo(p.x, p.y);
      this.ctx.lineTo(p.x - p.vx * trail, p.y - p.vy * trail);
      
      this.ctx.strokeStyle = p.color;
      this.ctx.lineWidth = p.size;
      this.ctx.globalAlpha = Math.min(1, p.life);
      this.ctx.stroke();
      this.ctx.restore();
    }

    this.animationFrame = requestAnimationFrame(this.loop);
  };

  public destroy(): void {
    window.removeEventListener("resize", this.resizeHandler);
    cancelAnimationFrame(this.animationFrame);
    if (this.canvas.parentElement) this.canvas.remove();
  }
}