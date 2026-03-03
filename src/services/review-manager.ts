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
import { MyPluginSettings } from "../settings";

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

			this.modal.onClose = () => {
				this.modal = null;
				this.strategy = null; // 关闭时重置策略状态
			};

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
		const lines = text.replace(/\r/g, "").split("\n");
		const cards: ThoughtCard[] = [];

		for (let i = 0; i < lines.length; i++) {
			if (
				lines[i]?.trim() === "---" &&
				lines[i + 1]?.trim().startsWith("-- ")
			) {
				const startLine = i;
				const timestamp = lines[i + 1]!.trim().replace("-- ", "");
				let j = i + 2;
				const contentLines: string[] = [];
				while (j < lines.length && lines[j]?.trim() !== "---") {
					// 修复：Argument of type 'string | undefined' 报错
					const line = lines[j];
					if (typeof line === "string") contentLines.push(line);
					j++;
				}
				cards.push({
					startLine,
					endLine: j,
					timestamp,
					content: contentLines.join("\n").trim(),
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
		const lines = text.replace(/\r/g, "").split("\n");
		const newBlock = ["---", `-- ${card.timestamp}`, newContent, ""];
		lines.splice(
			card.startLine,
			card.endLine - card.startLine,
			...newBlock,
		);
		await this.app.vault.modify(file, lines.join("\n"));
		new Notice("✅ 保存成功");
		card.content = newContent;
	}
}

class ReviewModal extends Modal {
	private tempFilePath: string = "meta_files/templates/input_buffer.md";
	private activeLeaf: WorkspaceLeaf | null = null;
	// 修复：取消私有属性声明，避免继承报错
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
		const tempFile = this.app.vault.getAbstractFileByPath(
			normalizePath(this.tempFilePath),
		);
		if (tempFile instanceof TFile) {
			await this.app.vault.modify(tempFile, this.card.content);
			if (this.titleElement)
				this.titleElement.setText(`🗓 ${this.card.timestamp}`);

			const view = this.activeLeaf?.view as MarkdownView;
			if (view) {
				view.editor.setValue(this.card.content);
				this.setupEditorBehavior(view);
			}
		}
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// 修复：确保 ensureTempFile 存在
		const tempFile = await this.ensureTempFile();
		if (!tempFile) return;
		await this.app.vault.modify(tempFile, this.card.content);

		this.modalEl.addClass("fleeting-glass-modal", "fleeting-minimal-modal");
		// 修复尺寸
		Object.assign(this.modalEl.style, {
			width: "650px",
			height: "450px",
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
			text: "Ctrl+J 下一个 | Ctrl+K 上一个",
			attr: { style: "font-size: 0.75em; color: var(--text-muted);" },
		});

		const editorWrapper = contentEl.createDiv({
			cls: "fleeting-editor-wrapper markdown-source-view mod-cm6 is-live-preview markdown-rendered",
			attr: { style: "flex: 1; overflow: hidden;" },
		});

		// @ts-ignore
		this.activeLeaf = new (WorkspaceLeaf as any)(this.app);

		// 修复：安全使用 activeLeaf
		if (this.activeLeaf) {
			(this.activeLeaf as any).parent = this.app.workspace.rootSplit;
			await this.activeLeaf.openFile(tempFile, {
				active: false,
				state: { mode: "source" },
			});
			editorWrapper.appendChild((this.activeLeaf as any).containerEl);

			const view = this.activeLeaf.view as MarkdownView;
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
		setTimeout(() => {
			view.editor.focus();
			// @ts-ignore 同步 Vim 模式与 AnyBlock 渲染
			if (this.app.vault.getConfig("vimMode")) {
				const cm = (view.editor as any).cm;
				if (cm) cm.dispatch({ effects: [] });
			}
			const line = view.editor.lineCount() - 1;
			view.editor.setCursor({
				line,
				ch: view.editor.getLine(line).length,
			});
			this.app.workspace.trigger("layout-change");
		}, 100);
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

	onClose() {
		if (this.activeLeaf) {
			this.activeLeaf.detach();
			this.activeLeaf = null;
		}
		const tempFile = this.app.vault.getAbstractFileByPath(
			normalizePath(this.tempFilePath),
		);
		if (tempFile instanceof TFile) {
			this.app.vault.modify(tempFile, "");
		}
		super.onClose();
	}
}

// TODO: 改成 fsrs 算法
export class ReviewStrategy {
    private indices: number[] = [];
    private pointer = 0;
    private readonly total: number;

    constructor(totalCount: number) {
        this.total = totalCount;
        this.indices = Array.from({ length: totalCount }, (_, i) => i);
        // 初始第一轮不需要考虑“上一轮最后一张”，传 -1 即可
        this.shuffle(-1);
    }

    /**
     * 洗牌算法：Fisher-Yates 
     * @param lastIndex 上一轮最后显示的索引，用于首尾去重
     */
    private shuffle(lastIndex: number): void {
        // 1. 标准 Fisher-Yates 洗牌
        for (let i = this.total - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = this.indices[i];
            const target = this.indices[j];
            
            // ESLint: 显式检查以符合 strictNullChecks
            if (temp !== undefined && target !== undefined) {
                this.indices[i] = target;
                this.indices[j] = temp;
            }
        }

        // 2. 核心限制：确保第二轮第一个不等于上一轮最后一个
        // 只有在总数大于 1 时才有必要且可能进行交换
        if (this.total > 1 && this.indices[0] === lastIndex) {
            // 将重复的第一个元素与后面任意一个位置交换（这里取第二个位置 i=1）
            const first = this.indices[0];
            const second = this.indices[1];
            if (first !== undefined && second !== undefined) {
                this.indices[0] = second;
                this.indices[1] = first;
            }
        }

        this.pointer = 0;
    }

    /**
     * 获取下一个索引
     * @param currentIndex 当前正在显示的索引，用于在新一轮开始时校验
     */
    public getNextIndex(currentIndex: number): number {
        if (this.pointer >= this.total) {
            // 触发新一轮洗牌，并传入当前索引作为“上一轮最后一个”
            this.shuffle(currentIndex);
        }

        const next = this.indices[this.pointer];
        this.pointer++;
        
        // ESLint: 确保返回值始终为 number
        return next ?? 0;
    }

    public getPrevIndex(): number {
        // 指针位置补偿：pointer 总是指向“下一个”，所以当前是 pointer-1，上一个是 pointer-2
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