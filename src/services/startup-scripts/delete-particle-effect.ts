// @ts-nocheck
import { EditorView, ViewUpdate } from "@codemirror/view";

interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export class DeleteParticleEffect {
	private static instance: DeleteParticleEffect | null = null;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private particles: Float32Array;
	private readonly maxParticles = 20000;
	private activeCount = 0;
	private isRendering = false; // 控制渲染开关

	private readonly colors = [
		"#006666",
		"#2f4f4f",
		"#088da5",
		"#004d4d",
		"#5f9ea0",
	];

	private constructor() {
		this.canvas = document.createElement("canvas");
		this.canvas.id = "kinetic-shatter-canvas";
		// 6个属性：x, y, vx, vy, life, size
		this.particles = new Float32Array(this.maxParticles * 6);

		Object.assign(this.canvas.style, {
			position: "fixed",
			top: "0",
			left: "0",
			pointerEvents: "none",
			zIndex: "2147483647",
		});

		document.body.appendChild(this.canvas);
		const context = this.canvas.getContext("2d", { alpha: true });
		if (!context) throw new Error("Could not get canvas context");
		this.ctx = context;

		this.handleResize();
		window.addEventListener("resize", this.handleResize);
	}

	public static setup(plugin: {
		registerEditorExtension: (ext: any) => void;
	}): void {
		const engine = this.getInstance();
		// 初始化一个内部时间戳记录器（如果类里没定义，可以挂在实例上）
		(engine as any).lastShatterTime = 0;

		plugin.registerEditorExtension(
			EditorView.updateListener.of((update: ViewUpdate) => {
				if (!update.docChanged) return;

				// 1. 获取当前时间
				const now = Date.now();

				// 2. 判定是否为用户触发的事务
				const isUserAction = update.transactions.some(
					(tr) =>
						tr.isUserEvent("delete") ||
						tr.isUserEvent("input") ||
						tr.isUserEvent("move"),
				);
				if (!isUserAction) return;

				update.changes.iterChanges((fromA, toA, fromB, toB) => {
					// toA > fromA 表示内容减少（删除）
					if (toA > fromA) {
						const charCount = toA - fromA;

						// --- 自动化过滤逻辑核心 ---
						const lastTime = (engine as any).lastShatterTime;
						const timeDiff = now - lastTime;
						(engine as any).lastShatterTime = now;

						/**
						 * 判定策略：
						 * 如果间隔极短 (< 15ms) 且删除字符数很少 (1个字符)
						 * 这种情况 99% 是 Espanso 在执行自动退格（Backspace * N）
						 * 我们直接跳过，不喷发粒子
						 */
						if (timeDiff < 15 && charCount === 1) {
							return;
						}

						const view = update.view;
						// 特效判定：删除超过 5 个字符视为“大爆炸”
						const isLarge = charCount > 5;

						let coords = view.coordsAtPos(fromA);
						if (!coords) {
							coords = view.coordsAtPos(
								view.state.selection.main.head,
							);
						}

						if (coords) {
							if (isLarge) {
								const estimatedWidth = Math.min(
									view.contentDOM.clientWidth / 2,
									charCount * 4,
								);
								const rect: Rect = {
									left: coords.left,
									top: coords.top,
									width: estimatedWidth,
									height: Math.max(
										coords.bottom - coords.top,
										20,
									),
								};
								engine.shatter(rect, true, charCount);
							} else {
								// 单字或小规模删除
								const rect: Rect = {
									left: coords.left,
									top: coords.top,
									width: 15,
									height: 20,
								};
								engine.shatter(rect, false, 1);
							}
						}
					}
				});
			}),
		);
	}

	public static getInstance(): DeleteParticleEffect {
		if (!this.instance) this.instance = new DeleteParticleEffect();
		return this.instance;
	}

	// 使用箭头函数绑定 this，方便移除监听器
	private handleResize = (): void => {
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	};

	public shatter(rect: Rect, isLarge: boolean, charCount: number): void {
		const p = this.particles;
		const count = Math.min(charCount * 12, isLarge ? 1000 : 35);

		for (let i = 0; i < count; i += 1) {
			if (this.activeCount >= this.maxParticles) break;
			const idx = this.activeCount * 6;

			p[idx] = rect.left + Math.random() * rect.width;
			p[idx + 1] = rect.top + Math.random() * rect.height;

			const angleOffset = Math.random() * 2.2 - 1.1;
			const angle = Math.PI * 1.5 + angleOffset;
			const speed = Math.random() * (isLarge ? 4 : 2.5) + 1;

			p[idx + 2] = Math.cos(angle) * speed;
			p[idx + 3] = Math.sin(angle) * speed - 0.8;
			p[idx + 4] = 3.5 + Math.random() * 2.5;
			p[idx + 5] = Math.random() * 2 + 0.6;

			this.activeCount += 1;
		}

		// 如果当前没在渲染，开启循环
		if (!this.isRendering && this.activeCount > 0) {
			this.isRendering = true;
			requestAnimationFrame(this.render);
		}
	}

	private render = (): void => {
		if (this.activeCount === 0) {
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
			this.isRendering = false;
			return; // 停止 rAF 循环
		}

		const { ctx, canvas, particles } = this;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const floor = canvas.height - 10;

		for (let i = 0; i < this.activeCount; i += 1) {
			const idx = i * 6;

			particles[idx] += particles[idx + 2];
			particles[idx + 1] += particles[idx + 3];
			particles[idx + 3] += 0.12; // 重力

			particles[idx + 4] -= 0.015;

			if (particles[idx + 1] >= floor) {
				particles[idx + 1] = floor;
				particles[idx + 4] -= 0.05;
			}

			if (particles[idx + 4] <= 0) {
				const lastIdx = (this.activeCount - 1) * 6;
				particles.set(particles.subarray(lastIdx, lastIdx + 6), idx);
				this.activeCount -= 1;
				i -= 1;
				continue;
			}

			ctx.globalAlpha = Math.min(1, particles[idx + 4]);
			ctx.fillStyle =
				this.colors[
					Math.floor(
						(particles[idx] + particles[idx + 1]) %
							this.colors.length,
					)
				];

			const size = particles[idx + 5];
			ctx.fillRect(particles[idx], particles[idx + 1], size, size);
		}

		requestAnimationFrame(this.render);
	};

	/**
	 * 必须提供销毁方法，防止 Obsidian 插件重载时产生多个实例和监听器
	 */
	public destroy(): void {
		window.removeEventListener("resize", this.handleResize);
		this.canvas.remove();
		DeleteParticleEffect.instance = null;
	}
}
