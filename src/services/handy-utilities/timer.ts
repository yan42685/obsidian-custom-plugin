import { Notice, Plugin, Setting } from "obsidian";

interface TimerState {
	stopwatchStart: number | null;
	stopwatchNotice: Notice | null;
	timeLeft: number;
	floatingEl: HTMLDivElement | null;
	currentInterval: number | null;
}

export class TimerManager {
	private state: TimerState = {
		stopwatchStart: null,
		stopwatchNotice: null,
		timeLeft: 0,
		floatingEl: null,
		currentInterval: null,
	};
	private presetsContainer: HTMLDivElement | null = null;

	constructor(private plugin: Plugin & { settings: any }) {
		this.registerCommands();
		// [2026-03-06] 优化：在构造函数中统一注册一次 Interval，避免每次开始计时都叠加注册
		this.plugin.registerInterval(
			window.setInterval(() => this.onTick(), 1000),
		);
	}

	private registerCommands(): void {
		this.plugin.addCommand({
			id: "stopwatch-start",
			name: "开始秒表计时",
			hotkeys: [{ modifiers: ["Alt"], key: "z" }],
			callback: () => {
				if (this.state.stopwatchNotice) {
					this.state.stopwatchNotice.hide();
					this.state.stopwatchNotice = null;
				}
				this.state.stopwatchStart = Date.now();
				new Notice("秒表已开始");
			},
		});

		this.plugin.addCommand({
			id: "stopwatch-stop",
			name: "停止秒表计时",
			hotkeys: [{ modifiers: ["Alt"], key: "x" }],
			callback: () => {
				if (this.state.stopwatchStart) {
					const elapsed =
						(Date.now() - this.state.stopwatchStart) / 1000;
					this.state.stopwatchNotice = new Notice(
						`计时结束：${elapsed.toFixed(2)} 秒`,
						15000,
					);
					this.state.stopwatchStart = null;
				} else {
					new Notice("当前没有正在运行的秒表");
				}
			},
		});

		this.plugin.addCommand({
			id: "toggle-pomodoro-window",
			hotkeys: [{ modifiers: ["Alt"], key: "c" }],
			name: "打开/隐藏番茄钟悬浮窗",
			callback: () => this.toggleFloatingWindow(),
		});
	}

	private toggleFloatingWindow(): void {
		if (this.state.floatingEl) {
			this.state.floatingEl.remove();
			this.state.floatingEl = null;
			return;
		}
		this.renderFloatingWindow();
	}

	private renderFloatingWindow(): void {
		const el = document.body.createDiv({ cls: "timer-floating-win" });
		this.state.floatingEl = el;

		const savedX = this.plugin.settings.timerPosX;
		const savedY = this.plugin.settings.timerPosY;

		Object.assign(el.style, {
			position: "fixed",
			top: savedY === -1 ? "20%" : `${savedY}px`,
			left: savedX === -1 ? "auto" : `${savedX}px`,
			right: savedX === -1 ? "20px" : "auto",
			zIndex: "5000",
			padding: "15px",
			backgroundColor: "var(--background-secondary)",
			border: "1px solid var(--divider-color)",
			borderRadius: "12px",
			boxShadow: "0 8px 16px rgba(0,0,0,0.2)",
			minWidth: "180px",
			cursor: "move",
			userSelect: "none",
			touchAction: "none",
		});

		this.makeDraggable(el);

		el.createEl("h4", { text: "⏲️ 番茄钟" }).style.margin = "0 0 10px 0";

		const input = el.createEl("input", { type: "number" });
		input.value = (this.plugin.settings.timerMinutes || 25).toString();
		input.style.width = "100%";
		this.plugin.registerDomEvent(input, "mousedown", (e) =>
			e.stopPropagation(),
		);

		// 核心修改：唯一按钮容器
		this.presetsContainer = el.createDiv({ cls: "timer-presets" });

		const display = el.createDiv({ cls: "timer-display" });
		display.style.cssText =
			"font-size:2em; text-align:center; margin:10px 0; font-variant-numeric: tabular-nums;";

		// 如果此时倒计时正在跑，打开窗口时直接显示剩余时间
		if (this.state.timeLeft > 0) {
			const m = Math.floor(this.state.timeLeft / 60);
			const s = this.state.timeLeft % 60;
			display.textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
		} else {
			display.textContent = "00:00";
		}

		// 统一由这个方法生成按钮
		this.renderPresetsButtons(input);

		const startBtn = el.createEl("button", {
			text: "手动开始",
			cls: "mod-cta",
		});
		startBtn.style.width = "100%";
		this.plugin.registerDomEvent(startBtn, "mousedown", (e) =>
			e.stopPropagation(),
		);

		startBtn.onclick = async () => {
			const mins = parseInt(input.value, 10) || 25;
			this.plugin.settings.timerMinutes = mins;
			// @ts-ignore
			await this.plugin.saveSettings();
			this.startCountdown(mins, display);
		};
	}

	// 统一渲染逻辑
	private renderPresetsButtons(inputEl: HTMLInputElement): void {
		if (!this.presetsContainer) return;

		this.presetsContainer.empty();
		this.presetsContainer.style.cssText =
			"display:flex; gap:5px; margin:8px 0;";

		const presets = this.plugin.settings.timerPresets || [5, 25, 45];

		presets.forEach((m: number) => {
			const btn = this.presetsContainer!.createEl("button", {
				text: `${m}m`,
				cls: "mod-subtle",
			});
			this.plugin.registerDomEvent(btn, "mousedown", (e) =>
				e.stopPropagation(),
			);
			btn.onclick = () => {
				inputEl.value = m.toString();
				const display = this.state.floatingEl?.querySelector(
					".timer-display",
				) as HTMLElement;
				if (display) this.startCountdown(m, display);
			};
		});
	}

	public refreshPresetsDisplay(): void {
		// 只有当悬浮窗真正存在于 DOM 中时才刷新
		if (this.state.floatingEl && this.presetsContainer) {
			const input = this.state.floatingEl.querySelector(
				"input",
			) as HTMLInputElement;
			if (input) {
				// 重新调用渲染逻辑，它会执行 empty() 并根据最新的 settings 生成按钮
				this.renderPresetsButtons(input);
			}
		}
	}

	private onTick(): void {
		if (this.state.timeLeft > 0) {
			this.state.timeLeft--;
			const display =
				this.state.floatingEl?.querySelector(".timer-display");
			if (display) {
				const m = Math.floor(this.state.timeLeft / 60);
				const s = this.state.timeLeft % 60;
				display.textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
			}

			if (this.state.timeLeft === 0) {
				new Notice("⏰ 时间到！", 10000);
				new Audio(
					"https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3",
				)
					.play()
					.catch(() => {});
			}
		}
	}

	private startCountdown(mins: number, display: HTMLElement): void {
		this.state.timeLeft = mins * 60;
		const m = Math.floor(this.state.timeLeft / 60);
		const s = this.state.timeLeft % 60;
		display.textContent = `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
		new Notice(`🍅 番茄钟开始：${mins} 分钟`);
	}

	private makeDraggable(el: HTMLElement): void {
		let isDown = false;
		let offset = { x: 0, y: 0 };

		this.plugin.registerDomEvent(el, "mousedown", (e) => {
			isDown = true;
			offset = {
				x: el.offsetLeft - e.clientX,
				y: el.offsetTop - e.clientY,
			};
		});

		this.plugin.registerDomEvent(document, "mousemove", (e) => {
			if (!isDown) return;
			el.style.left = e.clientX + offset.x + "px";
			el.style.top = e.clientY + offset.y + "px";
			el.style.right = "auto";
		});

		this.plugin.registerDomEvent(document, "mouseup", async () => {
			if (isDown) {
				isDown = false;
				this.plugin.settings.timerPosX = el.offsetLeft;
				this.plugin.settings.timerPosY = el.offsetTop;
				// @ts-ignore
				await this.plugin.saveSettings();
			}
		});
	}

	public static addSettings(containerEl: HTMLElement, plugin: any): void {
		containerEl.createEl("h3", { text: "计时器预设时间" });

		const presets = plugin.settings.timerPresets || [5, 25, 45];

		presets.forEach((value: number, index: number) => {
			new Setting(containerEl)
				.setName(`预设按钮 ${index + 1} (分钟)`)
				.addText((text) =>
					text.setValue(value.toString()).onChange(async (v) => {
						const mins = parseInt(v, 10);
						if (!isNaN(mins)) {
							// 1. 更新数据
							plugin.settings.timerPresets[index] = mins;
							await plugin.saveSettings();

							// 2. 核心：通过 plugin 找到活着的 timerManager 实例并刷新
							// 这里的 plugin.timerManager 就是我们在 main.ts 里挂载的那个
							if (plugin.timerManager) {
								plugin.timerManager.refreshPresetsDisplay();
							}
						}
					}),
				);
		});
	}
}
