import { MarkdownView, moment, normalizePath, Notice, Plugin, TFile } from "obsidian";

export class ImageCompressor {
	constructor(private plugin: Plugin) {}

	setup(): void {
		// [2026-03-06] 使用捕获模式拦截粘贴，确保在原图生成前介入
		this.plugin.registerDomEvent(document, "paste", async (e: ClipboardEvent) => {
			const { items } = e.clipboardData || {};
			if (!items) return;

			const imageItems = Array.from(items).filter(item => item.type.startsWith("image"));
			if (imageItems.length === 0) return;

			e.preventDefault();
			e.stopImmediatePropagation();

			const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return;

			for (const item of imageItems) {
				const file = item.getAsFile();
				if (file) {
					await this.processImage(file, activeView);
				}
			}
		}, true); 
	}

	private async processImage(file: File, targetView: MarkdownView): Promise<void> {
		const originalSize = file.size;
		const imgUrl = URL.createObjectURL(file);
		
		try {
			const img = await this.loadImage(imgUrl);
			
			// --- 尺寸预处理逻辑 ---
			const MAX_WIDTH = 2560; // 设定最大宽度限制（2K 级别）
			let targetWidth = img.width;
			let targetHeight = img.height;

			if (img.width > MAX_WIDTH) {
				targetWidth = MAX_WIDTH;
				targetHeight = (img.height * MAX_WIDTH) / img.width; // 等比缩放
			}

			// --- 压缩处理 ---
			const blob = await this.compressToWebP(img, targetWidth, targetHeight, 0.75);
			if (!blob) throw new Error("Compression failed");

			// 还原回原始命名逻辑：Pasted_image_时间戳
			const fileName = `Pasted_image_${moment().format("YYYYMMDDHHmmssSSS")}.webp`;

			// @ts-ignore
			const settingPath = this.plugin.app.vault.getConfig("attachmentFolderPath") || "";
			const filePath = normalizePath(`${settingPath}/${fileName}`);

			const { vault } = this.plugin.app;
			const existingFile = vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
				await vault.delete(existingFile);
			}

			await vault.createBinary(filePath, await blob.arrayBuffer());

			// 插入到锁定的编辑器
			targetView.editor.replaceSelection(`![[${fileName}]]`);

			const savings = ((originalSize - blob.size) / originalSize) * 100;
			const wasResized = img.width > MAX_WIDTH ? " (已缩小分辨率)" : "";
			new Notice(`📸 **图片压缩成功**${wasResized}\n${(originalSize / 1024).toFixed(1)}KB → ${(blob.size / 1024).toFixed(1)}KB (-${savings.toFixed(0)}%)`, 4000);

		} catch (err) {
			new Notice("⚠️ 图片处理失败");
			console.error("Image Compressor Error:", err);
		} finally {
			URL.revokeObjectURL(imgUrl);
		}
	}

	private loadImage(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("Image load failed"));
			img.src = url;
		});
	}

	private compressToWebP(img: HTMLImageElement, width: number, height: number, quality: number): Promise<Blob | null> {
		return new Promise((resolve) => {
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) return resolve(null);
			
			// 绘制时指定目标尺寸，实现等比缩小
			ctx.drawImage(img, 0, 0, width, height);
			canvas.toBlob((b) => resolve(b), "image/webp", quality);
		});
	}
}