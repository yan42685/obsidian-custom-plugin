import { Notice, Plugin } from "obsidian";
import { AutoFormatting } from "./auto-formatting";

export class StartupManager {
	private plugin: Plugin;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	public init(): void {
		// 1. 初始化 Markmap 增强功能
		new MarkmapManager();

		// 2. 执行启动布局聚焦逻辑
		this.plugin.app.workspace.onLayoutReady(() => {
			this.focusFirstPinnedTab();
		});

		this.plugin.registerEditorExtension(AutoFormatting.init());
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
			this.plugin.app.workspace.setActiveLeaf(firstPinnedLeaf, { focus: true });
		}
	}
}

// 让 anyblock支持的 list2markmap 出现全屏按钮
export class MarkmapManager {
	// 默认配置直接固化
	private readonly config = {
		removeOldButtons: true,
		autoFit: true,
		exitOnAnyKey: true,
		styleId: "mm-full-style",
	};

	constructor() {
		// 实例化即运行
		this.injectCSS();
		this.bindGlobalEvents();
		// 初始扫描当前 DOM 中已存在的 Markmap
		this.scanAndInject();
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

	private scanAndInject(): void {
		document.querySelectorAll("svg.ab-markmap-svg").forEach((el) => {
			this.inject(el as SVGElement);
		});
	}

	private fit(svg: SVGElement): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mm = (svg as any).instance || (svg as any).__markmap;
		if (mm && typeof mm.fit === "function") {
			mm.fit();
		} else {
			svg.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		}
	}

	private removeOld(svg: SVGElement): void {
		const targetArea = svg.parentElement?.parentElement?.parentElement;
		if (targetArea) {
			const btns = targetArea.querySelectorAll(".ab-button");
			btns.forEach((btn) => btn.remove());
		}
	}

	private inject(svg: SVGElement): void {
		if (svg.parentElement?.classList.contains("mm-full-wrapper")) return;
		this.removeOld(svg);

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
					setTimeout(() => this.fit(svg), 400);
				} catch {
					new Notice("无法进入全屏模式");
				}
			} else {
				if (document.exitFullscreen) void document.exitFullscreen();
			}
		};
		wrapper.appendChild(btn);
	}

	private bindGlobalEvents(): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const onAni = (e: any): void => {
			if (e.animationName === "mmReady") {
				this.inject(e.target as SVGElement);
			}
		};

		document.addEventListener("animationstart", onAni, { capture: true });

		const onKey = (e: KeyboardEvent): void => {
			if (
				document.fullscreenElement &&
				!["Control", "Alt", "Shift", "Meta"].includes(e.key)
			) {
				void document.exitFullscreen();
			}
		};
		document.addEventListener("keydown", onKey, { capture: true });

		// 5秒后停止监听新生成的动画，防止长期占用资源
		setTimeout(() => {
			document.removeEventListener("animationstart", onAni);
			console.log("[MarkmapManager] 动态监听已自毁");
		}, 5000);
	}
}