import {
	App,
	ButtonComponent,
	MarkdownView,
	Modal,
	normalizePath,
	Notice,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from "obsidian";
import { MyPluginSettings } from "../../settings";

interface ThoughtCard {
	startLine: number;
	endLine: number;
	timestamp: string;
	content: string;
}

export class ReviewManager {
	private currentCards: ThoughtCard[] = [];
	private currentIndex: number = -1;
	private modal: ReviewModal | null = null;
	private strategy: ReviewStrategy | null = null;

	constructor(
		private app: App,
		private settings: MyPluginSettings,
	) {}

	async startReview() {
		this.currentCards = await this.parseCards();
		if (this.currentCards.length === 0) {
			new Notice("未找到匹配卡片 📭");
			return;
		}
		// 初始化策略并获取第一个随机索引
		this.strategy = new ReviewStrategy(this.currentCards.length);
		this.currentIndex = this.strategy.getNextIndex(this.currentIndex);

		if (!this.modal) {
			const card = this.currentCards[this.currentIndex];
			if (!card) return;

			this.modal = new ReviewModal(
				this.app,
				this.settings,
				card,
				this,
				async (newVal) => {
					const targetCard = this.currentCards[this.currentIndex];
					if (targetCard) await this.updateVault(targetCard, newVal);
				},
			);

			this.modal.open();
		}
	}

	public async switchCard(direction: "next" | "prev") {
		// 确保 strategy 存在
		if (this.currentCards.length === 0 || !this.modal || !this.strategy)
			return;

		// ✅ 正确：调用 strategy 获取下一个（或上一个）索引
		if (direction === "next") {
			this.currentIndex = this.strategy.getNextIndex(this.currentIndex);
		} else {
			this.currentIndex = this.strategy.getPrevIndex();
		}

		const nextCard = this.currentCards[this.currentIndex];
		if (nextCard) {
			// 在更新内容的同时，顺便把进度条显示出来
			await this.modal.updateContent(nextCard);
		}
	}

	private async parseCards(): Promise<ThoughtCard[]> {
		const file = this.app.vault.getAbstractFileByPath(
			normalizePath(this.settings.storagePath),
		);
		if (!(file instanceof TFile)) return [];

		const text = await this.app.vault.read(file);
		// 使用 filter(Boolean) 可能会误删空白行，所以我们保留原样，但在循环中处理
		const lines = text.replace(/\r/g, "").split("\n");
		const cards: ThoughtCard[] = [];

		for (let i = 0; i < lines.length; i++) {
			// ✅ 修复：使用可选链或显式检查处理可能存在的 undefined
			const line = lines[i]?.trim();

			// 匹配格式: -- 2026/03/05 ... --
			if (line && line.startsWith("-- ") && line.endsWith(" --")) {
				const startLine = i;
				const timestamp = line.substring(3, line.length - 3).trim();

				let j = i + 1;
				const contentLines: string[] = [];

				while (j < lines.length) {
					const nextLine = lines[j]?.trim();
					// 如果遇到下一个 Header，停止收集内容
					if (
						nextLine &&
						nextLine.startsWith("-- ") &&
						nextLine.endsWith(" --")
					) {
						break;
					}

					// ✅ 修复：推入内容前确保 line 是 string 类型
					const currentContentLine = lines[j];
					if (typeof currentContentLine === "string") {
						contentLines.push(currentContentLine);
					}
					j++;
				}

				// 【处理结尾空行逻辑】：
				// 按照你的要求，移除内容数组末尾的最后一个空行
				// 我们先 join，再检查末尾
				let content = contentLines.join("\n");
				if (content.endsWith("\n")) {
					content = content.slice(0, -1);
				}

				cards.push({
					startLine,
					endLine: j,
					timestamp,
					// 这里建议使用 trimEnd() 移除结尾多余空行，
					// 但保留开头的空格（如果用户故意输入的话）
					content: content.trimEnd(),
				});

				i = j - 1;
			}
		}
		return cards;
	}

	private async updateVault(card: ThoughtCard, newContent: string) {
		const file = this.app.vault.getAbstractFileByPath(
			normalizePath(this.settings.storagePath),
		);
		if (!(file instanceof TFile)) return;

		const text = await this.app.vault.read(file);
		// 统一处理换行符，防止物理行匹配失败
		const lines = text.replace(/\r/g, "").split("\n");

		const targetHeader = `-- ${card.timestamp} --`;
		let realStartLine = -1;
		let realEndLine = -1;

		// 【修复】：直接匹配目标 Header，不再寻找旧的 "---"
		for (let i = 0; i < lines.length; i++) {
			const currentLine = lines[i]?.trim();

			if (currentLine === targetHeader) {
				realStartLine = i;
				let j = i + 1;

				// 寻找块的终点：直到遇到下一个卡片头或文件末尾
				while (j < lines.length) {
					const nextLine = lines[j]?.trim();
					if (
						nextLine &&
						nextLine.startsWith("-- ") &&
						nextLine.endsWith(" --")
					) {
						break;
					}
					j++;
				}
				realEndLine = j;
				break;
			}
		}

		if (realStartLine === -1) {
			console.error("DEBUG: Failed to locate card!");
			console.log("Looking for:", `"${targetHeader}"`);
			new Notice("❌ 无法在文件中定位此卡片，可能已被手动修改");
			return;
		}

		// 【结构对齐】：Header + 内容 + 尾随空行
		// 使用 trim() 确保内容干净，防止空行无限堆叠
		const newBlock = [targetHeader, ...newContent.trim().split("\n"), ""];

		// 执行物理替换
		lines.splice(realStartLine, realEndLine - realStartLine, ...newBlock);

		await this.app.vault.modify(file, lines.join("\n"));
		new Notice(" ✅ 保存成功 ");

		// 同步内存
		card.content = newContent.trim();
	}
}

class ReviewModal extends Modal {
	private tempFilePath: string = "meta_files/templates/review_buffer.md";
	private activeLeaf: WorkspaceLeaf | null = null;
	private vimTimeout: number | null = null;
	titleElement: HTMLElement;

	constructor(
		app: App,
		private settings: MyPluginSettings,
		private card: ThoughtCard,
		private manager: ReviewManager,
		private onSave: (val: string) => Promise<void>,
	) {
		super(app);
	}

	async updateContent(newCard: ThoughtCard) {
		this.card = newCard;

		// 不需要操作文件，直接更新编辑器
		if (this.titleElement)
			this.titleElement.setText(`🗓 ${this.card.timestamp}`);

		const view = this.activeLeaf?.view as MarkdownView;
		if (view) {
			view.editor.setValue(this.card.content); // 直接设置编辑器内容
			this.setupEditorBehavior(view);
		}
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const tempFile = await this.ensureTempFile();
		if (!tempFile) return;

		this.modalEl.addClass("fleeting-glass-modal", "fleeting-minimal-modal");
		Object.assign(this.modalEl.style, {
			width: "1000px",
			height: "618px",
			display: "flex",
			flexDirection: "column",
		});

		const header = contentEl.createDiv({
			cls: "fleeting-header-container",
			attr: {
				style: "display: flex; justify-content: space-between; align-items: center;",
			},
		});
		this.titleElement = header.createEl("h2", {
			text: `🗓 ${this.card.timestamp}`,
			cls: "fleeting-title",
		});
		header.createEl("span", {
			text: "Ctrl+J Next | Ctrl+K Prev | Ctrl+S Save",
			attr: { style: "font-size: 0.75em; color: var(--text-muted);" },
		});

		const editorWrapper = contentEl.createDiv({
			cls: "fleeting-editor-wrapper markdown-source-view mod-cm6 is-live-preview markdown-rendered",
			attr: { style: "flex: 1; overflow: hidden;" },
		});

		// @ts-ignore
		this.activeLeaf = new (WorkspaceLeaf as any)(this.app);

		if (this.activeLeaf) {
			(this.activeLeaf as any).parent = this.app.workspace.rootSplit;
			await this.activeLeaf.openFile(tempFile, {
				active: true,
				state: { mode: "source" },
			});
			editorWrapper.appendChild((this.activeLeaf as any).containerEl);

			const view = this.activeLeaf.view as MarkdownView;
			view.editor.setValue(this.card.content);
			this.setupEditorBehavior(view);

			const footer = contentEl.createDiv({
				attr: {
					style: "display:flex; justify-content:flex-end; padding: 10px 0;",
				},
			});
			new ButtonComponent(footer)
				.setButtonText("保存")
				.setCta()
				.onClick(() => this.onSave(view.editor.getValue()));

			this.modalEl.addEventListener(
				"keydown",
				(e) => this.handleKeyDown(e, view),
				true,
			);
		}
	}

	private handleKeyDown(e: KeyboardEvent, view: MarkdownView) {
		const isMod = e.ctrlKey || e.metaKey;
		if (isMod && e.key === "s") {
			e.preventDefault();
			this.onSave(view.editor.getValue());
		}
		if (isMod && (e.key === "j" || e.key === "J")) {
			e.preventDefault();
			this.manager.switchCard("next");
		}
		if (isMod && (e.key === "k" || e.key === "K")) {
			e.preventDefault();
			this.manager.switchCard("prev");
		}
	}

	private setupEditorBehavior(view: MarkdownView) {
		requestAnimationFrame(() => {
			// 1. 暴力聚焦：直接找 DOM 元素
			const cmContent = view.containerEl.querySelector(
				".cm-content",
			) as HTMLElement;
			if (cmContent) {
				cmContent.focus();
			} else {
				view.editor.focus();
			}

			this.app.workspace.trigger("layout-change");
		});
	}

	private async ensureTempFile(): Promise<TFile | null> {
		const path = normalizePath(this.tempFilePath);
		const folderPath = path.substring(0, path.lastIndexOf("/"));
		if (
			folderPath &&
			!(
				this.app.vault.getAbstractFileByPath(folderPath) instanceof
				TFolder
			)
		) {
			await this.app.vault.createFolder(folderPath);
		}
		let file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile))
			file = await this.app.vault.create(path, "");
		return file as TFile;
	}

	async onClose() {
		if (this.vimTimeout) {
			window.clearTimeout(this.vimTimeout);
			this.vimTimeout = null;
		}

		// 1. 先销毁叶子，解除编辑器对文件的占用
		if (this.activeLeaf) {
			this.activeLeaf.detach();
			this.activeLeaf = null;
		}

		// 2. 给 Obsidian 一点时间释放文件
		await new Promise((resolve) => setTimeout(resolve, 500));

		// 3. 再清空文件
		try {
			const bufferFile = this.app.vault.getAbstractFileByPath(
				normalizePath(this.tempFilePath),
			);
			if (bufferFile instanceof TFile) {
				await this.app.vault.modify(bufferFile, "");
				console.log("Buffer file cleared");
			}
		} catch (e) {
			console.error("Failed to clear buffer:", e);
		}

		this.contentEl.empty();

		// 4. 直接通知 manager 清理状态
		if (this.manager) {
			// 需要在 ReviewModal 中保存 manager 引用
			(this.manager as any).modal = null;
			(this.manager as any).strategy = null;
		}

		super.onClose();
	}
}

class ReviewStrategy {
	private indices: number[] = [];
	private pointer = 0;
	private readonly total: number;

	constructor(totalCount: number) {
		this.total = totalCount;
		this.indices = Array.from({ length: totalCount }, (_, i) => i);
		this.shuffle(-1);
	}

	private shuffle(lastIndex: number): void {
		for (let i = this.total - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const temp = this.indices[i];
			const target = this.indices[j];
			if (temp !== undefined && target !== undefined) {
				this.indices[i] = target;
				this.indices[j] = temp;
			}
		}

		if (this.total > 1 && this.indices[0] === lastIndex) {
			const first = this.indices[0];
			const second = this.indices[1];
			if (first !== undefined && second !== undefined) {
				this.indices[0] = second;
				this.indices[1] = first;
			}
		}

		this.pointer = 0;
	}

	public getNextIndex(currentIndex: number): number {
		if (this.pointer >= this.total) {
			this.shuffle(currentIndex);
		}
		const next = this.indices[this.pointer];
		this.pointer++;
		return next ?? 0;
	}

	public getPrevIndex(): number {
		if (this.pointer <= 1) {
			return this.indices[0] ?? 0;
		}
		this.pointer--;
		return this.indices[this.pointer - 1] ?? 0;
	}

	public getProgressText(): string {
		return `${this.pointer}/${this.total}`;
	}
}
