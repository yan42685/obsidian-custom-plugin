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
	private tempFilePath: string = "meta_files/templates/input_buffer.md";
	// 关键修复：在这里声明变量，解决 image_9bd51d.png 的报错
	private activeLeaf: WorkspaceLeaf | null = null;

	constructor(app: App, settings: MyPluginSettings) {
		super(app);
		this.settings = settings;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const tempFile = await this.ensureTempFile();
		if (!tempFile) return;

		this.modalEl.addClass("fleeting-glass-modal");
		this.modalEl.addClass("fleeting-minimal-modal");

		const closeBtn = this.modalEl.querySelector(
			".modal-close-button",
		) as HTMLElement;
		if (closeBtn) closeBtn.style.display = "none";

		// this.modalEl.style.width = "650px";
		this.modalEl.style.width = "1000px";
		this.modalEl.style.height = "618px";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		const header = contentEl.createDiv({
			cls: "fleeting-header-container",
			attr: {
				style: "display: flex; justify-content: space-between; align-items: center;",
			},
		});

		header.createEl("h2", {
			text: "✍️ Fleeting Thoughts",
			cls: "fleeting-title",
		});

		// 添加和 ReviewModal 一样的提示样式
		header.createEl("span", {
			text: "Ctrl+Enter Save",
			attr: { style: "font-size: 0.75em; color: var(--text-muted);" },
		});

		// 加上 markdown-rendered 类名以适配 AnyBlock
		const editorWrapper = contentEl.createDiv({
			cls: "fleeting-editor-wrapper markdown-source-view mod-cm6 is-live-preview markdown-rendered",
			attr: { style: "flex: 1; overflow: hidden;" },
		});

		// @ts-ignore
		const leaf = new (WorkspaceLeaf as any)(this.app);
		this.activeLeaf = leaf;

		// 关键 Hack：伪装父级以支持第三方插件
		if (this.activeLeaf) {
			(this.activeLeaf as any).parent = this.app.workspace.rootSplit;
		}

		await leaf.openFile(tempFile, {
			active: true,
			state: { mode: "source" },
		});

		const leafContainer = (leaf as any).containerEl;
		editorWrapper.appendChild(leafContainer);

		const view = leaf.view as MarkdownView;

		if (view.getMode() !== "source") {
			await view.setState(
				{ ...view.getState(), mode: "source" },
				{ history: false },
			);
		}

		// 保持原有的 Ctrl+Enter 保存逻辑
		this.modalEl.addEventListener(
			"keydown",
			async (e: KeyboardEvent) => {
				if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
					e.preventDefault();
					e.stopPropagation();
					const content = view.editor.getValue();
					if (content.trim()) {
						await this.appendToVault(content);
						this.close();
					}
				}
			},
			true,
		);

		requestAnimationFrame(() => {
			view.editor.focus();

			// 每次打开先清空缓冲区
			view.editor.setValue("");

			// 恢复完整的 Vim 插入模式逻辑
			// @ts-ignore
			const isVimEnabled = this.app.vault.getConfig("vimMode");
			if (isVimEnabled) {
				const cmContent = editorWrapper.querySelector(".cm-content");
				if (cmContent) {
					const keyEvent = new KeyboardEvent("keydown", {
						key: "i",
						keyCode: 73,
						code: "KeyI",
						which: 73,
						bubbles: true,
						cancelable: true,
					});
					cmContent.dispatchEvent(keyEvent);
					if (view.editor.getValue() === "i") {
						view.editor.setValue("");
					}
				}
			}

			// 录入时光标在开头
			view.editor.setCursor({ line: 0, ch: 0 });
			// 触发 AnyBlock 扫描渲染
			this.app.workspace.trigger("layout-change");
		});
	}
	async onClose() {
		// 1. 先销毁叶子，解除编辑器对文件的占用
		if (this.activeLeaf) {
			this.activeLeaf.detach();
			this.activeLeaf = null;
		}

		// 2. 给 Obsidian 一点时间释放文件, 避免同时保存和清空
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
		super.onClose();
	}

	private async appendToVault(content: string) {
		const targetPath = normalizePath(this.settings.storagePath);
		const now = new Date();
		const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

		// 关键修复：去掉时间戳后的 \n\n，让正文紧跟时间
		const finalEntry = `\n---\n-- ${dateStr}\n${content}\n`;

		let targetFile = this.app.vault.getAbstractFileByPath(targetPath);
		try {
			if (targetFile instanceof TFile) {
				await this.app.vault.append(targetFile, finalEntry);
			} else {
				const folderPath = targetPath.substring(
					0,
					targetPath.lastIndexOf("/"),
				);
				if (
					folderPath &&
					!(
						this.app.vault.getAbstractFileByPath(
							folderPath,
						) instanceof TFolder
					)
				) {
					await this.app.vault.createFolder(folderPath);
				}
				await this.app.vault.create(targetPath, finalEntry);
			}
			new Notice("✅ Saved");
		} catch (e: any) {
			// 关键修复：使用 : any 解决 image_9c5fe4.png 的报错
			new Notice("❌ Error: " + (e.message || "Unknown error"));
		}
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
			let current = "";
			for (const s of folderPath.split("/")) {
				current += (current ? "/" : "") + s;
				if (
					!(
						this.app.vault.getAbstractFileByPath(current) instanceof
						TFolder
					)
				) {
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
