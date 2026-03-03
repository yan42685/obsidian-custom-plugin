// services/handy-utilities.ts
import { Plugin } from "obsidian";

export class HandyUtilities {
	plugin: Plugin;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	/**
	 * 注册所有便捷命令
	 */
	registerAllCommands(): void {
		this.registerToggleSidebarCommand();
	}

	/**
	 * 注册切换侧边栏的命令 (Ctrl + -)
	 */
	private registerToggleSidebarCommand(): void {
		this.plugin.addCommand({
			id: "toggle-sidebars",
			name: "Toggle Sidebars",
			hotkeys: [{ modifiers: ["Ctrl"], key: "-" }],
			callback: () => {
				this.toggleSidebarDirectly();
			},
		});
	}

	/**
	 * 切换左右侧边栏 (直接操作 API 版)
	 */
	private toggleSidebarDirectly(): void {
		const { workspace } = this.plugin.app;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const leftSplit = (workspace as any).leftSplit;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const rightSplit = (workspace as any).rightSplit;

		if (!leftSplit || !rightSplit) return;

		const isLeftCollapsed = leftSplit.collapsed;
		const isRightCollapsed = rightSplit.collapsed;

		// 判断是否有至少一个侧边栏是打开的
		const anySidebarOpen = !isLeftCollapsed || !isRightCollapsed;

		if (anySidebarOpen) {
			// 如果有任何一个侧边栏是打开的，关闭所有侧边栏
			leftSplit.collapse();
			rightSplit.collapse();
		} else {
			// 如果两侧边栏都关闭，则同时打开左右两侧边栏
			leftSplit.expand();
			rightSplit.expand();
		}
	}

}