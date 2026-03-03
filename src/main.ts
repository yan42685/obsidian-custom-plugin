import {
	App,
	Modal,
	Plugin,
} from "obsidian";
import { FleetingModal } from "services/fleeting-thoughts/input-modal";
import { ReviewManager } from "services/fleeting-thoughts/review-manager";
import { HandyUtilities } from "services/handy-utilities/handy-utilities";
import { MarkmapManager } from "services/startup-scripts/startsup-scripts";
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
		new HandyUtilities(this).registerAllCommands();
		new MarkmapManager();

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
