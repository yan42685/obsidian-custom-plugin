import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import MyPlugin from "./main";
import { TimerManager } from "services/handy-utilities/timer";

export interface MyPluginSettings {
	storagePath: string;
    timerPosX: number;
    timerPosY: number;
    timerPresets: number[];
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	storagePath: "all_notes/unsorted/Fleeting thoughts.md",
    timerPosX: -1,
    timerPosY: -1,
    timerPresets: [12, 45, 60] // 默认三个预设
};

export class MyPluginSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h2", { text: "Mini Flomo 插件设置" });

		const pathSetting = new Setting(containerEl)
			.setName("存储路径")
			.setDesc("请设置 Markdown 文件的相对路径。注意：必须以 .md 结尾。");

		pathSetting.addText((text) =>
			text
				.setPlaceholder("folder/your-note.md")
				.setValue(this.plugin.settings.storagePath)
				.onChange(async (value) => {
					const trimmedValue = value.trim();

					// 1. 基础合法性验证正则 (排除 Windows/Mac 不允许的特殊字符)
					const invalidChars = /[\\*\"|?<>:]/;

					if (invalidChars.test(trimmedValue)) {
						pathSetting.controlEl.addClass("setting-error");
						new Notice('路径包含非法字符 (如 : * ? " < > |)');
						return;
					}

					// 2. 必须包含 .md 后缀验证
					if (!trimmedValue.toLowerCase().endsWith(".md")) {
						pathSetting.controlEl.addClass("setting-error");
						// 这里不强制阻断输入，但给予视觉警告
					} else {
						pathSetting.controlEl.removeClass("setting-error");
					}

					// 3. 保存设置
					this.plugin.settings.storagePath = trimmedValue;
					await this.plugin.saveSettings();
				}),
		);

		// 添加一个重置按钮
		new Setting(containerEl)
			.setName("重置为默认")
			.setDesc("将路径恢复为初始值")
			.addButton((btn) =>
				btn.setButtonText("恢复默认").onClick(async () => {
					this.plugin.settings.storagePath =
						DEFAULT_SETTINGS.storagePath;
					await this.plugin.saveSettings();
					this.display(); // 刷新 UI
					new Notice("已恢复默认设置");
				}),
			);
		containerEl.createEl("h3", { text: "计时器设置" });
		TimerManager.addSettings(containerEl, this.plugin);
	}
}
