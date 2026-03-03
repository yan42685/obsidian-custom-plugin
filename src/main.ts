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
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	MyPluginSettingTab,
} from "./settings";

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new MyPluginSettingTab(this.app, this));

		// 注册命令：你可以通过快捷键或命令面板 (Ctrl+P) 唤起
		this.addCommand({
			id: "open-fleeting-input",
			name: "Open Fleeting Input (Markdown Preview)",
			callback: () => {
				new FleetingModal(this.app, this.settings).open();
			},
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

		await this.app.vault.modify(tempFile, "");

		this.modalEl.addClass("fleeting-minimal-modal");
		const closeBtn = this.modalEl.querySelector(
			".modal-close-button",
		) as HTMLElement;
		if (closeBtn) closeBtn.style.display = "none";

		this.modalEl.style.width = "650px";
		this.modalEl.style.height = "450px";
		this.modalEl.style.display = "flex";
		this.modalEl.style.flexDirection = "column";

		contentEl.createEl("h2", {
			text: "✍️ Fleeting Thoughts",
			attr: {
				style: "margin: 0 0 15px 0; font-size: 1.2em; color: var(--interactive-accent);",
			},
		});

		const editorWrapper = contentEl.createDiv({
			cls: "fleeting-editor-wrapper markdown-source-view mod-cm6 is-live-preview",
			attr: { style: "flex: 1; overflow: hidden;" },
		});

		// --- 彻底修复点：使用底层 API 创建一个不挂载到工作区的 Leaf ---
		// @ts-ignore
		const leaf = new (WorkspaceLeaf as any)(this.app); // 直接 new 而不是通过 workspace 获取
		this.activeLeaf = leaf;

		// 关键：在打开文件时明确指定不要 active，也不要记录历史
		await leaf.openFile(tempFile, {
			active: false,
			state: { mode: "source" },
		});

		const leafContainer = (leaf as any).containerEl;
		editorWrapper.appendChild(leafContainer);

		const view = leaf.view as MarkdownView;

		// 强制 Live Preview 模式
		if (view.getMode() !== "source") {
			await view.setState(
				{ ...view.getState(), mode: "source" },
				{ history: false },
			);
		}

		// 键盘拦截逻辑保持不变...
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

		// 仅针对我们这个游离 leaf 强制聚焦，而不要去触发 workspace 的 setActiveLeaf
		setTimeout(() => {
			view.editor.focus();
		}, 150);
	}
	async onClose() {
		// 销毁叶子，防止它留在后台或干扰布局
		if (this.activeLeaf) {
			this.activeLeaf.detach();
			this.activeLeaf = null;
		}

		// 关闭后清空缓冲区
		const tempFile = this.app.vault.getAbstractFileByPath(
			normalizePath(this.tempFilePath),
		);
		if (tempFile instanceof TFile) {
			await this.app.vault.modify(tempFile, "");
		}
		this.contentEl.empty();
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
