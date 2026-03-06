import {
    MarkdownView,
    moment,
    normalizePath,
    Notice,
    Plugin,
    TFile,
} from "obsidian";
// 确保已安装: npm install upng-js 和 @types/upng-js
import * as UPNG from "upng-js";

export class ImageCompressor {
	constructor(private plugin: Plugin) {}

	setup(): void {
		// [2026-03-06] 使用捕获模式拦截粘贴，确保在原图生成前介入
		this.plugin.registerDomEvent(
			document,
			"paste",
			async (e: ClipboardEvent) => {
				const { items } = e.clipboardData || {};
				if (!items) return;

				const imageItems = Array.from(items).filter((item) =>
					item.type.startsWith("image"),
				);
				if (imageItems.length === 0) return;

				e.preventDefault();
				e.stopImmediatePropagation();

				const activeView =
					this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (!activeView) return;

				for (const item of imageItems) {
					const file = item.getAsFile();
					if (file) {
						await this.processImage(file, activeView);
					}
				}
			},
			true,
		);
	}

	private async processImage(
		file: File,
		targetView: MarkdownView,
	): Promise<void> {
		const originalSize = file.size;
		const imgUrl = URL.createObjectURL(file);

		try {
			const img = await this.loadImage(imgUrl);

			// --- 尺寸预处理逻辑 ---
			const MAX_WIDTH = 2560;
			let targetWidth = img.width;
			let targetHeight = img.height;

			if (img.width > MAX_WIDTH) {
				targetWidth = MAX_WIDTH;
				targetHeight = (img.height * MAX_WIDTH) / img.width;
			}

			// --- 压缩处理 (使用 UPNG 替代 WebP) ---
			// 颜色数设为 256 以达到类似 TinyPNG 的有损压缩效果
			const compressedBuffer = await this.compressWithUPNG(
				img,
				targetWidth,
				targetHeight,
			);
			if (!compressedBuffer) throw new Error("Compression failed");

			const compressedSize = compressedBuffer.byteLength;

			// 后缀名改为 .png (UPNG 生成的是标准的有损索引色 PNG)
			const fileName = `Pasted_image_${moment().format("YYYYMMDDHHmmssSSS")}.png`;

			// 获取附件路径逻辑
			// @ts-ignore
			const settingPath =
				(this.plugin.app.vault as any).getConfig(
					"attachmentFolderPath",
				) || "";
			const filePath = normalizePath(`${settingPath}/${fileName}`);

			const { vault } = this.plugin.app;
			const existingFile = vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
				await vault.delete(existingFile);
			}

			await vault.createBinary(filePath, compressedBuffer);

			// 插入到锁定的编辑器 (根据你的规则：引号内加空格，普通文本不加)
			targetView.editor.replaceSelection(` ![[${fileName}]] `);

			const savings =
				((originalSize - compressedSize) / originalSize) * 100;
			const wasResized = img.width > MAX_WIDTH ? " (已缩小分辨率)" : "";
			new Notice(
				`📸 **图片压缩成功**${wasResized}\n` +
					`${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (-${savings.toFixed(0)}%)`,
				4000,
			);
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

	/**
	 * 使用 UPNG 进行有损量化压缩
	 * @param img 图片元素
	 * @param width 目标宽度
	 * @param height 目标高度
	 * @param cnum 颜色数量 (1-256)，256 是有损压缩的最佳平衡点
	 */
	/**
	 * [2026-03-07] 多决策压缩系统：
	 * 1. 强制白底预处理（消除 Alpha 通道冗余）
	 * 2. 阶梯式量化算法（256 -> 128 -> 64）直到体积达标或触底
	 */
	/**
	 * [2026-03-07] 多决策压缩系统：
	 * 1. 强制白底预处理（显著降低 PNG 编码负担）
	 * 2. 阶梯式量化算法（自动根据体积探测 256 或 128 色）
	 */
	private async compressWithUPNG(
		img: HTMLImageElement,
		width: number,
		height: number,
	): Promise<ArrayBuffer | null> {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });

		if (!ctx) return null;

		// [优化] 填充纯白底，彻底抛弃透明度信息
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, width, height);

		// [优化] 微弱平滑预处理，这是逼近在线工具压缩率的“秘诀”
		ctx.filter = "blur(0.25px) contrast(1.02)";
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(img, 0, 0, width, height);

		const imageData = ctx.getImageData(0, 0, width, height);
		const rawBuffer = imageData.data.buffer;

		return new Promise((resolve) => {
			setTimeout(() => {
				try {
					// 直接使用 128 色作为首选方案（性价比最高）
					let compressed = UPNG.encode(
						[rawBuffer],
						width,
						height,
						128,
					);

					// 如果文件依然大于 250KB，强制下探到 64 色
					if (compressed.byteLength > 250 * 1024) {
						const extra = UPNG.encode(
							[rawBuffer],
							width,
							height,
							64,
						);
						if (extra.byteLength < compressed.byteLength * 0.85) {
							compressed = extra;
						}
					}

					resolve(compressed);
				} catch (e) {
					resolve(null);
				} finally {
					canvas.width = 0;
					canvas.height = 0;
				}
			}, 0);
		});
	}
}
