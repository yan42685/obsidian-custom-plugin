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

        // 将当前卡片内容写入缓冲区
        await this.app.vault.modify(tempFile, this.card.content);

        this.modalEl.addClass("fleeting-glass-modal");
        this.modalEl.addClass("fleeting-minimal-modal");

        // 恢复 Modal 尺寸设置
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
        this.activeLeaf = new (WorkspaceLeaf as any)(this.app);
        
        // 修复：确保 activeLeaf 存在并伪装父级以支持 AnyBlock
        if (this.activeLeaf) {
            (this.activeLeaf as any).parent = this.app.workspace.rootSplit;
            await this.activeLeaf.openFile(tempFile, { active: false, state: { mode: "source" } });
            editorWrapper.appendChild((this.activeLeaf as any).containerEl);

            const view = this.activeLeaf.view as MarkdownView;

            const footer = contentEl.createDiv({ 
                attr: { style: "display:flex; justify-content:flex-end; padding: 10px 0;" } 
            });

            new ButtonComponent(footer)
                .setButtonText("保存")
                .setCta()
                .onClick(async () => {
                    await this.onSave(view.editor.getValue());
                });

            // 聚焦并定位光标
            setTimeout(() => {
                view.editor.focus();
                const lineCount = view.editor.lineCount();
                view.editor.setCursor({ line: lineCount - 1, ch: view.editor.getLine(lineCount - 1).length });
                this.app.workspace.trigger("layout-change");
            }, 250);
        }

        this.modalEl.addEventListener("keydown", async (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                const view = this.activeLeaf?.view as MarkdownView;
                if (view) await this.onSave(view.editor.getValue());
            }
        });
    }

    // 修复：补全缺失的方法
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
        if (!(file instanceof TFile)) {
            file = await this.app.vault.create(path, "");
        }
        return file as TFile;
    }

    async onClose() {
        if (this.activeLeaf) {
            this.activeLeaf.detach();
            this.activeLeaf = null;
        }
        const tempFile = this.app.vault.getAbstractFileByPath(normalizePath(this.tempFilePath));
        if (tempFile instanceof TFile) {
            await this.app.vault.modify(tempFile, "");
        }
        this.contentEl.empty();
    }
}