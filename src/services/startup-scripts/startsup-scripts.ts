import { MarkdownView, Notice, Plugin } from "obsidian";

export class StartupManager {
	private plugin: Plugin;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	public init(): void {
		// 1. 初始化 Markmap 增强功能
		new MarkmapManager(this.plugin);

		// 2. 执行启动布局聚焦逻辑
		this.plugin.app.workspace.onLayoutReady(() => {
			this.focusFirstPinnedTab();
		});
	}

	// 自动聚焦pin的tab
	private focusFirstPinnedTab(): void {
		let firstPinnedLeaf: any = null;
		this.plugin.app.workspace.iterateAllLeaves((leaf) => {
			if (firstPinnedLeaf) return;
			if (leaf.getViewState().pinned) {
				firstPinnedLeaf = leaf;
			}
		});

		if (firstPinnedLeaf) {
			this.plugin.app.workspace.setActiveLeaf(firstPinnedLeaf, {
				focus: true,
			});
		}
	}
}

// 让 anyblock支持的 list2markmap 出现全屏按钮

export class MarkmapManager {
	private readonly config = {
		styleId: "mm-full-style",
		自毁时间: 5000,
	};

	constructor(private plugin: Plugin) {
		this.injectCSS();
		this.initLogic();
	}

	private initLogic(): void {
		const onAni = (e: AnimationEvent): void => {
			if (e.animationName === "mmReady") {
				this.inject(e.target as SVGElement);
			}
		};

		this.plugin.registerDomEvent(
			document,
			"animationstart",
			onAni as EventListener,
			{ capture: true },
		);

		this.plugin.registerDomEvent(
			document,
			"keydown",
			(e: KeyboardEvent) => {
				if (
					document.fullscreenElement &&
					!["Control", "Alt", "Shift", "Meta"].includes(e.key)
				) {
					void document.exitFullscreen();
				}
			},
			{ capture: true },
		);

		// 优化点：启动时根据布局状态决定扫描策略
		if (this.plugin.app.workspace.layoutReady) {
			this.scanActiveViewOnly();
		} else {
			this.plugin.app.workspace.onLayoutReady(() =>
				this.scanActiveViewOnly(),
			);
		}

		setTimeout(() => {
			document.removeEventListener(
				"animationstart",
				onAni as EventListener,
				{ capture: true },
			);
			console.log("[MarkmapManager] 动态监听已自毁");
		}, this.config.自毁时间);
	}

	/**
	 * 核心优化：仅扫描当前活动的 Markdown 视图
	 */
	private scanActiveViewOnly(): void {
		const activeView =
			this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			// 仅在当前视图的内容元素（contentEl）中查找
			activeView.contentEl
				.querySelectorAll("svg.ab-markmap-svg")
				.forEach((el) => {
					this.inject(el as SVGElement);
				});
		}
	}

	private injectCSS(): void {
		if (document.getElementById(this.config.styleId)) return;
		const style = document.createElement("style");
		style.id = this.config.styleId;
		style.innerHTML = `
            @keyframes mmReady { from { opacity: 0.99; } to { opacity: 1; } }
            .ab-markmap-svg { animation: mmReady 0.001s; }
            .mm-full-wrapper { position: relative !important; display: block; width: 100%; }
            .mm-full-wrapper:fullscreen {
                background: var(--background-primary) !important;
                width: 100vw !important; height: 100vh !important;
                display: flex !important; align-items: center; justify-content: center;
                overflow: hidden !important; margin: 0 !important;
            }
            .mm-full-wrapper:fullscreen svg.ab-markmap-svg {
                width: 100% !important; height: 100% !important;
                max-width: none !important; max-height: none !important;
            }
            .mm-btn {
                position: absolute; top: 12px; right: 12px; z-index: 1000;
                padding: 6px 12px; cursor: pointer;
                background: var(--interactive-accent); color: var(--text-on-accent);
                border: none; border-radius: 6px; opacity: 0; 
                transition: all 0.2s ease; font-size: 18px;
            }
            .mm-full-wrapper:hover .mm-btn { opacity: 0.7; }
            .mm-btn:hover { opacity: 1 !important; transform: scale(1.1); }
        `;
		document.head.appendChild(style);
	}

	private inject(svg: SVGElement): void {
		if (svg.parentElement?.classList.contains("mm-full-wrapper")) return;

		const targetArea = svg.parentElement?.parentElement?.parentElement;
		targetArea
			?.querySelectorAll(".ab-button")
			.forEach((btn) => btn.remove());

		const wrapper = document.createElement("div");
		wrapper.className = "mm-full-wrapper";
		svg.parentNode?.insertBefore(wrapper, svg);
		wrapper.appendChild(svg);

		const btn = document.createElement("button");
		btn.innerHTML = "⛶";
		btn.className = "mm-btn";
		btn.onclick = async (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (!document.fullscreenElement) {
				try {
					await wrapper.requestFullscreen();
					setTimeout(() => {
						const mm =
							(svg as any).instance || (svg as any).__markmap;
						mm?.fit?.() ||
							svg.dispatchEvent(
								new MouseEvent("dblclick", { bubbles: true }),
							);
					}, 400);
				} catch {
					new Notice("无法进入全屏模式");
				}
			} else {
				void document.exitFullscreen();
			}
		};
		wrapper.appendChild(btn);
	}
}
