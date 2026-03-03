import {
	App,
	MarkdownView,
	Modal,
	normalizePath,
	Notice,
	Plugin,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from "obsidian";
import { ReviewManager } from "services/review-manager";
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	MyPluginSettingTab,
} from "./settings";

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	reviewManager: ReviewManager;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new MyPluginSettingTab(this.app, this));
		this.reviewManager = new ReviewManager(this.app, this.settings);

		// 注册命令：你可以通过快捷键或命令面板 (Ctrl+P) 唤起
		this.addCommand({
			id: "input-fleeting-thoughts",
			name: "Input Fleeting Thoughts",
			callback: () => {
				new FleetingModal(this.app, this.settings).open();
			},
		});

		this.addCommand({
			id: "review-fleeting-thoughts",
			name: "Review Fleeting Thoughts",
			callback: () => this.reviewManager.startReview(),
		});

		console.log("Custom Plugin loaded successfully.");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

export class FleetingModal extends Modal {
	private settings: MyPluginSettings;
	private tempFilePath = "meta_files/templates/input_buffer.md";
	private activeLeaf: WorkspaceLeaf | null = null;
	private vimTimeout: number | null = null;

	constructor(app: App, settings: MyPluginSettings) {
		super(app);
		this.settings = settings;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const tempFile = await this.ensureTempFile();
		if (!tempFile) return;

		// 预置一个空行，确保 AnyBlock 能渲染
		await this.app.vault.modify(tempFile, "\n"); // 一个空行

		this.setupModalStyle();
		this.createHeader(contentEl);
		
		const editorWrapper = this.createEditorWrapper(contentEl);
		const view = await this.setupEditor(editorWrapper, tempFile);
		
		// 等待编辑器完全加载后，隐藏第一个空行
		setTimeout(() => {
			this.hideFirstLine(view);
		}, 500);
		
		this.setupEventListeners(view);
		this.setupEditorBehavior(view);
	}

	/**
	 * 隐藏编辑器的第一行（空行）
	 */
	private hideFirstLine(view: MarkdownView) {
		// 通过 CSS 隐藏第一行
		const style = document.createElement('style');
		style.id = 'fleeting-hide-first-line';
		style.textContent = `
			.fleeting-editor-wrapper .cm-line:first-child {
				height: 0;
				opacity: 0;
				pointer-events: none;
				overflow: hidden;
				font-size: 0;
				line-height: 0;
				margin: 0;
				padding: 0;
			}
		`;
		
		// 移除旧的 style 避免重复
		const oldStyle = document.getElementById('fleeting-hide-first-line');
		if (oldStyle) oldStyle.remove();
		
		// 添加到 modal 中
		this.modalEl.appendChild(style);
	}

	private setupModalStyle() {
		this.modalEl.addClass("fleeting-glass-modal", "fleeting-minimal-modal");
		const closeBtn = this.modalEl.querySelector(".modal-close-button") as HTMLElement;
		if (closeBtn) closeBtn.style.display = "none";
		
		Object.assign(this.modalEl.style, {
			width: "650px",
			height: "450px",
			display: "flex",
			flexDirection: "column"
		});
	}

	private createHeader(contentEl: HTMLElement) {
		const header = contentEl.createDiv({ cls: "fleeting-header-container" });
		header.createEl("h2", { text: "✍️ Fleeting Thoughts", cls: "fleeting-title" });
	}

	private createEditorWrapper(contentEl: HTMLElement) {
		return contentEl.createDiv({
			cls: "fleeting-editor-wrapper markdown-source-view mod-cm6 is-live-preview markdown-rendered",
			attr: { style: "flex: 1; overflow: hidden;" }
		});
	}

	private async setupEditor(editorWrapper: HTMLElement, tempFile: TFile) {
		// @ts-ignore
		const leaf = new (WorkspaceLeaf as any)(this.app);
		this.activeLeaf = leaf;
		(this.activeLeaf as any).parent = this.app.workspace.rootSplit;

		await leaf.openFile(tempFile, { active: false, state: { mode: "source" } });
		editorWrapper.appendChild((leaf as any).containerEl);

		const view = leaf.view as MarkdownView;
		if (view.getMode() !== "source") {
			await view.setState({ ...view.getState(), mode: "source" }, { history: false });
		}
		return view;
	}

	private setupEventListeners(view: MarkdownView) {
		this.modalEl.addEventListener("keydown", async (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				
				// 获取内容并忽略第一个空行
				let content = view.editor.getValue();
				content = this.ignoreFirstLine(content);
				
				if (content.trim()) {
					await this.appendToVault(content);
					this.close();
				}
			}
		}, true);
	}

	/**
	 * 忽略第一行（空行），但保留其他内容
	 */
	private ignoreFirstLine(content: string): string {
		const lines = content.split('\n');
		
		// 如果有至少一行，忽略第一行
		if (lines.length > 0) {
			return lines.slice(1).join('\n');
		}
		
		return content;
	}

	private setupEditorBehavior(view: MarkdownView) {
		setTimeout(() => {
			const cmContent = view.containerEl.querySelector(".cm-content") as HTMLElement;
			// 使用 if-else 代替逻辑或
			if (cmContent) {
				cmContent.focus();
			} else {
				view.editor.focus();
			}

			// Vim 模式支持
			// @ts-ignore
			if (this.app.vault.getConfig("vimMode")) {
				this.handleVimMode(cmContent || view.containerEl);
			}

			// 光标定位到第二行（第一个可见行）
			view.editor.setCursor({ line: 1, ch: 0 });
			
			// 触发渲染
			this.triggerAnyBlockRender(view);
		}, 400);
	}

	private handleVimMode(target: HTMLElement) {
		if (this.vimTimeout) window.clearTimeout(this.vimTimeout);
		this.vimTimeout = window.setTimeout(() => {
			target.dispatchEvent(new KeyboardEvent("keydown", {
				key: "a", keyCode: 65, code: "KeyA", bubbles: true, cancelable: true
			}));
			target.dispatchEvent(new KeyboardEvent("keypress", {
				key: "a", keyCode: 65, code: "KeyA", bubbles: true, cancelable: true
			}));
			this.vimTimeout = null;
		}, 1);
	}

	private triggerAnyBlockRender(view: MarkdownView) {
		// 多次触发渲染确保 AnyBlock 捕获
		const trigger = () => this.app.workspace.trigger("layout-change");
		trigger();
		setTimeout(trigger, 100);
		setTimeout(trigger, 300);
	}

	async onClose() {
		// 移除隐藏第一行的样式
		const style = document.getElementById('fleeting-hide-first-line');
		if (style) style.remove();

		if (this.vimTimeout) {
			window.clearTimeout(this.vimTimeout);
			this.vimTimeout = null;
		}
		this.activeLeaf?.detach();
		this.activeLeaf = null;

		const tempFile = this.app.vault.getAbstractFileByPath(normalizePath(this.tempFilePath));
		if (tempFile instanceof TFile) {
			await this.app.vault.modify(tempFile, "");
		}
		this.contentEl.empty();
	}

	private async appendToVault(content: string) {
		const targetPath = normalizePath(this.settings.storagePath);
		const now = new Date();
		const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
		const finalEntry = `\n---\n-- ${dateStr}\n${content}\n`;

		try {
			const targetFile = this.app.vault.getAbstractFileByPath(targetPath);
			if (targetFile instanceof TFile) {
				await this.app.vault.append(targetFile, finalEntry);
			} else {
				const folderPath = targetPath.substring(0, targetPath.lastIndexOf("/"));
				if (folderPath && !(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
					await this.app.vault.createFolder(folderPath);
				}
				await this.app.vault.create(targetPath, finalEntry);
			}
			new Notice("✅ Saved");
		} catch (e: any) {
			new Notice("❌ Error: " + (e.message || "Unknown error"));
		}
	}

	private async ensureTempFile(): Promise<TFile | null> {
		const path = normalizePath(this.tempFilePath);
		const folderPath = path.substring(0, path.lastIndexOf("/"));

		if (folderPath && !(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
			let current = "";
			for (const s of folderPath.split("/")) {
				current += (current ? "/" : "") + s;
				if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
					await this.app.vault.createFolder(current);
				}
			}
		}

		let file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			file = await this.app.vault.create(path, "");
		}
		return file as TFile;
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	// 本应放在main.ts 里面的sample code    this指向plugin
	sampleCode() {
		// // If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// // Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	new Notice("Click");
		// });
		// // When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.debug('setInterval'), 5 * 60 * 1000));
	}

	onOpen() {
		let { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
