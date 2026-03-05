import {
	App,
	MarkdownView,
	Modal,
	normalizePath,
	Notice,
	TFile,
	TFolder,
	WorkspaceLeaf,
} from "obsidian";
import { MyPluginSettings } from "settings";

export class FleetingModal extends Modal {
	private settings: MyPluginSettings;
	private tempFilePath: string = "meta_files/templates/input_buffer.md";
	// 关键修复：在这里声明变量，解决 image_9bd51d.png 的报错
	private activeLeaf: WorkspaceLeaf | null = null;

	constructor(app: App, settings: MyPluginSettings) {
		super(app);
		this.settings = settings;
	}

	private handleKeyDown = async (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			const view = this.activeLeaf?.view as MarkdownView;
			if (!view) return;

			const content = view.editor.getValue();
			if (content.trim()) {
				e.preventDefault();
				e.stopPropagation();

				// 先移除监听，防止由于异步延迟导致的连击重复保存
				this.modalEl.removeEventListener(
					"keydown",
					this.handleKeyDown,
					true,
				);

				this.close();
				await this.appendToVault(content);
			}
		}
	};

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
			text: "Ctrl+Enter Confirm Input",
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

		this.modalEl.addEventListener("keydown", this.handleKeyDown, true);

		requestAnimationFrame(() => {
			view.editor.focus();

			// 每次打开先清空缓冲区
			// view.editor.setValue("");

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
				}
			}
			const lineCount = view.editor.lineCount();
			const lastLineText = view.editor.getLine(lineCount - 1);

			view.editor.setCursor({
				line: lineCount - 1,
				ch: lastLineText.length,
			});
			// 触发 AnyBlock 扫描渲染
			this.app.workspace.trigger("layout-change");
		});
	}
	async onClose() {
		this.modalEl.removeEventListener("keydown", this.handleKeyDown, true);

		if (this.activeLeaf) {
			this.activeLeaf.detach();
			this.activeLeaf = null;
		}

		this.contentEl.empty();
		super.onClose();
	}

	private async appendToVault(content: string) {
		const targetPath = normalizePath(this.settings.storagePath);
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, "0");

		const dateStr =
			`${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ` +
			`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

		// 关键修复：去掉时间戳后的 \n\n，让正文紧跟时间
		const finalEntry = `-- ${dateStr} --\n${content.trim()}\n\n`;

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

			// 在保存后，才物理清空 write_buffer.md
			// 给 Obsidian 一点时间释放文件, 避免同时自动保存和此处清空write_buffer
			await new Promise((resolve) => setTimeout(resolve, 500));
			const bufferFile = this.app.vault.getAbstractFileByPath(
				normalizePath(this.tempFilePath),
			);
			if (bufferFile instanceof TFile) {
				await this.app.vault.modify(bufferFile, "");
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
