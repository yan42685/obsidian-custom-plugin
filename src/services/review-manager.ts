import { App, ButtonComponent, MarkdownView, Modal, normalizePath, Notice, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { MyPluginSettings } from "../settings";

interface ThoughtCard {
    startLine: number;
    endLine: number;
    timestamp: string;
    content: string;
}

export class ReviewManager {
    constructor(private app: App, private settings: MyPluginSettings) {}

    async startReview() {
        const cards = await this.parseCards();
        if (cards.length === 0) {
            new Notice("未找到匹配卡片 📭");
            return;
        }
        
        // 修复：确保随机抽取的卡片不为 undefined
        const selectedCard = cards[Math.floor(Math.random() * cards.length)];
        if (selectedCard) {
            new ReviewModal(this.app, this.settings, selectedCard, async (newVal) => {
                await this.updateVault(selectedCard, newVal);
            }).open();
        }
    }

    private async parseCards(): Promise<ThoughtCard[]> {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.storagePath));
        if (!(file instanceof TFile)) return [];

        const text = await this.app.vault.read(file);
        const lines = text.replace(/\r/g, "").split("\n");
        const cards: ThoughtCard[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]?.trim();
            const nextLine = lines[i + 1]?.trim();

            if (line === "---" && nextLine && nextLine.startsWith("-- ")) {
                const startLine = i;
                const timestamp = nextLine.replace("-- ", "").trim();
                let j = i + 2;
                const contentLines: string[] = [];

                while (j < lines.length) {
                    if (lines[j]?.trim() === "---") break;
                    contentLines.push(lines[j]!); 
                    j++;
                }

                cards.push({ 
                    startLine, 
                    endLine: j, 
                    timestamp, 
                    content: contentLines.join("\n").trim() 
                });
                i = j - 1; 
            }
        }
        return cards;
    }

    private async updateVault(card: ThoughtCard, newContent: string) {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.storagePath));
        if (!(file instanceof TFile)) return;

        const text = await this.app.vault.read(file);
        const lines = text.replace(/\r/g, "").split("\n");
        const newBlock = ["---", `-- ${card.timestamp}`, newContent, ""]; 
        lines.splice(card.startLine, card.endLine - card.startLine, ...newBlock);
        
        await this.app.vault.modify(file, lines.join("\n"));
        new Notice("✅ 保存成功");
    }
}

class ReviewModal extends Modal {
    private tempFilePath: string = "meta_files/templates/input_buffer.md";
    private activeLeaf: WorkspaceLeaf | null = null;

    constructor(
        app: App, 
        private settings: MyPluginSettings,
        private card: ThoughtCard,
        private onSave: (val: string) => Promise<void>
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const tempFile = await this.ensureTempFile();
        if (!tempFile) return;

        // 注入当前卡片内容到缓冲区
        await this.app.vault.modify(tempFile, this.card.content);

        this.modalEl.addClass("fleeting-glass-modal");
        this.modalEl.addClass("fleeting-minimal-modal");

        const closeBtn = this.modalEl.querySelector(".modal-close-button") as HTMLElement;
        if (closeBtn) closeBtn.style.display = "none";

        this.modalEl.style.width = "650px";
        this.modalEl.style.height = "450px";
        this.modalEl.style.display = "flex";
        this.modalEl.style.flexDirection = "column";

        const header = contentEl.createDiv({ cls: "fleeting-header-container" });
        header.createEl("h2", { text: `🗓 ${this.card.timestamp}`, cls: "fleeting-title" });

        const editorWrapper = contentEl.createDiv({
            cls: "fleeting-editor-wrapper markdown-source-view mod-cm6 is-live-preview markdown-rendered",
            attr: { style: "flex: 1; overflow: hidden;" },
        });

        // @ts-ignore
        const leaf = new (WorkspaceLeaf as any)(this.app);
        this.activeLeaf = leaf;
        
        if (this.activeLeaf) {
            (this.activeLeaf as any).parent = this.app.workspace.rootSplit;
        }

        await leaf.openFile(tempFile, { active: false, state: { mode: "source" } });
        editorWrapper.appendChild((leaf as any).containerEl);

        const view = leaf.view as MarkdownView;

        // 回顾页面的底部保存按钮
        const footer = contentEl.createDiv({ 
            attr: { style: "display:flex; justify-content:flex-end; padding: 10px 0;" } 
        });

        new ButtonComponent(footer)
            .setButtonText("保存")
            .setCta()
            .onClick(async () => {
                await this.onSave(view.editor.getValue());
            });

        setTimeout(() => {
            view.editor.focus();

            // 复刻 Vim 插入模式逻辑
            // @ts-ignore
            const isVimEnabled = this.app.vault.getConfig("vimMode");
            if (isVimEnabled) {
                const cmContent = editorWrapper.querySelector(".cm-content");
                if (cmContent) {
                    const keyEvent = new KeyboardEvent("keydown", {
                        key: "i", keyCode: 73, code: "KeyI", which: 73,
                        bubbles: true, cancelable: true,
                    });
                    cmContent.dispatchEvent(keyEvent);
                }
            }

            // 关键区别：回顾时光标置于文本末尾
            const lineCount = view.editor.lineCount();
            const lastLine = lineCount - 1;
            view.editor.setCursor({ line: lastLine, ch: view.editor.getLine(lastLine).length });
            
            this.app.workspace.trigger("layout-change");
        }, 250);

        // 回顾页面支持 Ctrl+S 保存
        this.modalEl.addEventListener("keydown", async (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                await this.onSave(view.editor.getValue());
            }
        });
    }

    private async ensureTempFile(): Promise<TFile | null> {
        const path = normalizePath(this.tempFilePath);
        const folderPath = path.substring(0, path.lastIndexOf("/"));
        if (folderPath && !(this.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder)) {
            let current = "";
            for (const s of folderPath.split("/")) {
                current += (current ? "/" : "") + s;
                if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) {
                    await this.app.vault.createFolder(current);
                }
            }
        }
        let file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) file = await this.app.vault.create(path, "");
        return file as TFile;
    }

    async onClose() {
        if (this.activeLeaf) {
            this.activeLeaf.detach();
            this.activeLeaf = null;
        }
        const tempFile = this.app.vault.getAbstractFileByPath(normalizePath(this.tempFilePath));
        if (tempFile instanceof TFile) await this.app.vault.modify(tempFile, "");
        this.contentEl.empty();
    }
}