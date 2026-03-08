import {
	App,
	Editor,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownView,
	Plugin,
	TFile,
} from "obsidian";

class RangeEmbedRenderer {
	// 修复 image_818578.png: 明确 Plugin 类型以调用 register 方法
	constructor(
		private app: App,
		private plugin: Plugin,
	) {}

	public init(): void {
		this.plugin.registerMarkdownPostProcessor((el, ctx) => {
			this.processEmbeds(el, ctx);
		});

		this.plugin.registerInterval(
			window.setInterval(() => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view && view.getMode() === "source") {
					this.processEmbeds(view.contentEl, {
						sourcePath: view.file?.path ?? "",
					} as MarkdownPostProcessorContext);
				}
			}, 600) // 缩短轮询间隔提升响应感
		);
	}

	private async processEmbeds(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext,
	): Promise<void> {
		// 增加选择器范围，捕获实时预览中的错误节点
		const embeds = el.querySelectorAll(
			".internal-embed:not(.custom-range-processed), " +
			".file-embed-error:not(.custom-range-processed), " +
			"div[data-href*='#^']:not(.custom-range-processed)"
		);

		for (const embedEl of Array.from(embeds)) {
			const htmlEl = embedEl as HTMLElement;
			let src = htmlEl.getAttribute("src") || htmlEl.getAttribute("data-href");

			if (!src) {
				const parent = htmlEl.closest("[data-href]");
				src = parent?.getAttribute("data-href") ?? null;
			}

			// 修复 image_818556.png 等: 严格校验格式
			if (!src || !src.includes("-")) continue;

			const match = src.match(/#\^([a-z0-9]+)-([a-z0-9]+)$/);
			if (!match) continue;

			// 修复 image_81853a.png: 确保 ID 为 string
			const startId = match[1];
			const endId = match[2];
			const linkPath = src.split("#")[0] ?? "";

			if (!startId || !endId || !linkPath) continue;

			const file = this.app.metadataCache.getFirstLinkpathDest(
				linkPath,
				ctx.sourcePath,
			);

			if (file instanceof TFile) {
				htmlEl.classList.add("custom-range-processed");
				// 修复 image_812347.png: 确保调用实例方法
				await this.renderRange(file, startId, endId, htmlEl, ctx.sourcePath);
			}
		}
	}

	private async renderRange(
		file: TFile,
		startId: string,
		endId: string,
		containerEl: HTMLElement,
		sourcePath: string,
	): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(file);
		// 如果索引未就绪，移除标记让下一轮轮询重试
		if (!cache || !cache.sections) {
			containerEl.classList.remove("custom-range-processed");
			return;
		}

		const startSection = cache.sections.find((s) => s.id === startId);
		const endSection = cache.sections.find((s) => s.id === endId);

		if (!startSection || !endSection) {
			containerEl.classList.remove("custom-range-processed");
			return;
		}

		const startLine = Math.min(startSection.position.start.line, endSection.position.start.line);
		const endLine = Math.max(startSection.position.end.line, endSection.position.end.line);

		// 使用 cachedRead 优化性能
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");
		const rangeText = lines.slice(startLine, endLine + 1).join("\n");

		containerEl.empty();
		containerEl.addClass("custom-range-embed");
		containerEl.removeClass("file-embed-error"); // 强行移除错误状态

		const innerEl = containerEl.createDiv("markdown-embed-content");
		await MarkdownRenderer.renderMarkdown(rangeText, innerEl, sourcePath, this.plugin);
	}
}

export class CopyBlockLinkManager {
	private renderer: RangeEmbedRenderer;
	constructor(private plugin: Plugin) {
		this.renderer = new RangeEmbedRenderer(this.plugin.app, this.plugin);
	}

	private generateUniqueId(file: TFile): string {
		const fileCache = this.plugin.app.metadataCache.getFileCache(file);
		const existingIds = new Set((fileCache?.sections || []).map((s) => s.id).filter((id): id is string => !!id));
		let id: string;
		do {
			id = Math.random().toString(36).substring(2, 6);
		} while (existingIds.has(id));
		return id;
	}

	private async getOrGenerateId(editor: Editor, file: TFile, line: number): Promise<string> {
		const lineText = editor.getLine(line);
		const match = lineText.match(/\^([a-z0-9]+)$/);
		
		// 修复 image_819bde.png: 类型安全返回
		if (match && match[1]) return match[1];

		const id = this.generateUniqueId(file);
		const fileCache = this.plugin.app.metadataCache.getFileCache(file);
		const section = fileCache?.sections?.find(s => s.position.start.line <= line && s.position.end.line >= line);
		
		const spacer = section && ["blockquote", "code", "table"].includes(section.type) ? "\n\n" : " ";
		editor.replaceRange(`${spacer}^${id}`, { line, ch: lineText.length });
		
		// 关键优化：强制文件处理以刷新元数据索引
		await this.plugin.app.vault.process(file, (data) => data);
		return id;
	}

	public async handleRequest(editor: Editor, view: MarkdownView, isEmbed: boolean): Promise<void> {
		const file = view.file;
		if (!file) return;

		let fromLine = editor.getCursor("from").line;
		let toLine = editor.getCursor("to").line;

		// 解决首尾空行问题：自动收缩边界至有内容的行
		while (fromLine < toLine && !editor.getLine(fromLine).trim()) fromLine++;
		while (toLine > fromLine && !editor.getLine(toLine).trim()) toLine--;

		let subpath = "";
		if (fromLine === toLine) {
			const id = await this.getOrGenerateId(editor, file, fromLine);
			subpath = `#^${id}`;
		} else {
			const endId = await this.getOrGenerateId(editor, file, toLine);
			const startId = await this.getOrGenerateId(editor, file, fromLine);
			subpath = `#^${startId}-${endId}`;
		}

		const link = this.plugin.app.fileManager.generateMarkdownLink(file, "", subpath);
		navigator.clipboard.writeText(isEmbed ? `!${link}` : link);
		
		const finalPos = editor.getCursor("to");
		editor.setSelection(finalPos, finalPos);
	}

	public init(): void {
		this.renderer.init();
		this.plugin.addCommand({
			id: "copy-range-embed",
			name: "Copy range embed",
			editorCallback: (editor, view) => {
				if (view instanceof MarkdownView) this.handleRequest(editor, view, true);
			},
		});
	}
}