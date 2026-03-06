import { EditorView, ViewUpdate } from "@codemirror/view";
import {
	App,
	Modal,
	Plugin,
} from "obsidian";
import { FleetingModal } from "services/fleeting-thoughts/input-modal";
import { ReviewManager } from "services/fleeting-thoughts/review-manager";
import { HandyUtilities } from "services/handy-utilities/handy-utilities";
import { TimerManager } from "services/handy-utilities/timer";
import { SimpleSidebarManager } from "services/sidebar-manager.ts/simple-sidebar-manager";
import { DeleteParticleEffect } from "services/startup-scripts/delete-particle-effect";
import { InputParticleEffect } from "services/startup-scripts/input-particle-effect";
import { MarkmapManager } from "services/startup-scripts/startsup-scripts";
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	MyPluginSettingTab,
} from "./settings";

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	reviewManager: ReviewManager;
	sidebarManager: SimpleSidebarManager;
	inputParticleEffect: InputParticleEffect;
	timerManager: TimerManager;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new MyPluginSettingTab(this.app, this));
		// ========================


		this.reviewManager = new ReviewManager(this.app, this.settings);
		new HandyUtilities(this).registerAllCommands();
		new MarkmapManager();
		this.sidebarManager = new SimpleSidebarManager(this);	

		// 打字粒子效果
		this.inputParticleEffect = new InputParticleEffect();

        // 注册编辑器扩展
        this.registerEditorExtension(
            EditorView.updateListener.of((update: ViewUpdate) => {
                // 只有当文档改变（输入文字）时才触发
                if (update.docChanged && update.transactions.some(tr => tr.isUserEvent("input"))) {
                    this.inputParticleEffect.spawn(update.view);
                }
            })
        );
		// 删除文字的物理特效
		DeleteParticleEffect.setup(this);

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

		// ========================

		// 计时器与番茄钟
		this.timerManager = new TimerManager(this);

		console.log("Custom Plugin loaded successfully.");
	}


	onunload(): void {
		this.inputParticleEffect.destroy();
		DeleteParticleEffect.getInstance().destroy();

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

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	// // 本应放在main.ts 里面的sample code    this指向plugin
	// sampleCode() {
	// 	// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
	// 	// Using this function will automatically remove the event listener when this plugin is disabled.
	// 	this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
	// 		new Notice("Click");
	// 	});
	// 	// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
	// 	this.registerInterval(window.setInterval(() => console.debug('setInterval'), 5 * 60 * 1000));
	// }

	onOpen() {
		let { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
