import { syntaxTree } from "@codemirror/language";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from "@codemirror/view";

/**
 * 虚拟间距 Widget
 * 使用箭头函数定义 toDOM 以确保在 Obsidian 环境下原型链稳定
 */
class SpaceWidget extends WidgetType {
	constructor() {
		super();
	}

	toDOM = () => {
		const span = document.createElement("span");
		// 关键：移除 height, overflow, vertical-align: middle
		// 使用基准线对齐，并确保它不占用高度
		span.style.cssText = `
            display: inline-block;
            width: 0.25em;
            vertical-align: baseline;
            pointer-events: none;
            user-select: none;
            background: transparent !important;
        `;
		span.setAttribute("data-type", "virtual-gap");
		return span;
	};

	eq(other: WidgetType) {
		return other instanceof SpaceWidget;
	}
}

export class AutoFormatting {
	/**
	 * 核心逻辑：扫描可见区域并构建装饰器
	 */
	private static buildDecorations(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();

		// 基础防御：若文档未就绪则返回空
		if (!view.state?.doc?.length) return Decoration.none;

		try {
			const { state } = view;
			const tree = syntaxTree(state);
			const doc = state.doc;

			for (const { from, to } of view.visibleRanges) {
				const text = doc.sliceString(from, to);

				/**
				 * 核心修复正则：使用零宽正向断言 (?=...)
				 * 匹配：[中](后面跟着英数) OR [英数](后面跟着中)
				 * 这样不会消耗掉字符，能连续匹配 "阿Q" 这种交界处
				 */
				const regex =
					/([\u4e00-\u9fa5](?=[a-zA-Z0-9]))|([a-zA-Z0-9](?=[\u4e00-\u9fa5]))/g;
				let match;

				while ((match = regex.exec(text)) !== null) {
					// 计算缝隙的绝对位置
					const pos = from + match.index + 1;

					// 边界安全检查
					if (pos <= 0 || pos >= doc.length) continue;

					/**
					 * 语法解析过滤：
					 * 避开代码块、数学公式、链接、元数据等
					 */
					try {
						if (tree) {
							const node = tree.resolveInner(pos, 1);
							const name = node.name.toLowerCase();
							const excluded = [
								"code",
								"math",
								"comment",
								"meta",
								"tag",
								"link",
								"url",
							];
							if (excluded.some((ex) => name.includes(ex)))
								continue;
						}
					} catch (e) {
						// 语法树解析异常时跳过当前点，确保整体不崩溃
						continue;
					}

					// 插入零宽 Widget 装饰器
					builder.add(
						pos,
						pos,
						Decoration.widget({
							widget: new SpaceWidget(),
							side: -1, // 关键修复：改为 -1，让间距“属于”左边的字符
						}),
					);
				}
			}
		} catch (e) {
			console.error("AutoFormatting 执行严重错误:", e);
		}

		return builder.finish();
	}

	/**
	 * ViewPlugin 封装：负责监听编辑器更新
	 */
	private static plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				// 初始化，包装在 try-catch 中防止阻塞文件打开
				try {
					this.decorations = AutoFormatting.buildDecorations(view);
				} catch {
					this.decorations = Decoration.none;
				}
			}

			update(update: ViewUpdate) {
				// 仅在文档内容改变或视口滚动时触发重绘
				if (update.docChanged || update.viewportChanged) {
					try {
						this.decorations = AutoFormatting.buildDecorations(
							update.view,
						);
					} catch (e) {
						this.decorations = Decoration.none;
					}
				}
			}
		},
		{
			// 声明此插件提供装饰器
			decorations: (v) => v.decorations,
		},
	);

	/**
	 * 外部初始化接口
	 */
	static init(): Extension {
		return this.plugin;
	}
}
