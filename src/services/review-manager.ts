import { App, ButtonComponent, MarkdownView, Modal, normalizePath, Notice, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { MyPluginSettings } from "../settings";

interface ThoughtCard {
    startLine: number;
    endLine: number;
    timestamp: string;
    content: string;
}

export class ReviewManager {
    private currentCards: ThoughtCard[] = [];
    private currentIndex: number = -1;

    constructor(private app: App, private settings: MyPluginSettings) {}

    async startReview() {
        this.currentCards = await this.parseCards();
        if (this.currentCards.length === 0) {
            new Notice("未找到匹配卡片 📭");
            return;
        }
        // 随机开始第一张
        this.currentIndex = Math.floor(Math.random() * this.currentCards.length);
        this.openModal();
    }

    // 提供给 Modal 调用：切换下一张
    public nextCard() {
        if (this.currentCards.length === 0) return;
        this.currentIndex = (this.currentIndex + 1) % this.currentCards.length;
        this.openModal();
    }

    // 提供给 Modal 调用：切换上一张
    public prevCard() {
        if (this.currentCards.length === 0) return;
        this.currentIndex = (this.currentIndex - 1 + this.currentCards.length) % this.currentCards.length;
        this.openModal();
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

    private openModal() {
        const card = this.currentCards[this.currentIndex];
        if (card) {
            new ReviewModal(this.app, this.settings, card, this, async (newVal) => {
                await this.updateVault(card, newVal);
            }).open();
        }
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
        
        // 保存后更新内存中的数据，防止切换回来时变回旧内容
        card.content = newContent;
    }
}

class ReviewModal extends Modal {
    private tempFilePath: string = "meta_files/templates/input_buffer.md";
    private activeLeaf: WorkspaceLeaf | null = null;

    constructor(
        app: App, 
        private settings: MyPluginSettings,
        private card: ThoughtCard,
        private manager: ReviewManager,
        private onSave: (val: string) => Promise<void>
    ) {
        super(app);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        const tempFile = await this.ensureTempFile();
        if (!tempFile) return;

        await this.app.vault.modify(tempFile, this.card.content);

        this.modalEl.addClass("fleeting-glass-modal");
        this.modalEl.addClass("fleeting-minimal-modal");

        const closeBtn = this.modalEl.querySelector(".modal-close-button") as HTMLElement;
        if (closeBtn) closeBtn.style.display = "none";

        this.modalEl.style.width = "650px";
        this.modalEl.style.height = "450px";
        this.modalEl.style.display = "flex";
        this.modalEl.style.flexDirection = "column";

        // --- 顶部栏：包含标题和快捷键提示 ---
        const header = contentEl.createDiv({ cls: "fleeting-header-container", attr: { style: "display: flex; justify-content: space-between; align-items: center;" } });
        header.createEl("h2", { text: `🗓 ${this.card.timestamp}`, cls: "fleeting-title" });
        
        // 右上角小字提示
        header.createEl("span", { 
            text: "Ctrl+J next | Ctrl+K previous", 
            attr: { style: "font-size: 0.75em; color: var(--text-muted); opacity: 0.8;" } 
        });

        const editorWrapper = contentEl.createDiv({
            cls: "fleeting-editor-wrapper markdown-source-view mod-cm6 is-live-preview markdown-rendered",
            attr: { style: "flex: 1; overflow: hidden;" },
        });

        // @ts-ignore
        this.activeLeaf = new (WorkspaceLeaf as any)(this.app);
        if (this.activeLeaf) {
            (this.activeLeaf as any).parent = this.app.workspace.rootSplit;
            await this.activeLeaf.openFile(tempFile, { active: false, state: { mode: "source" } });
            editorWrapper.appendChild((this.activeLeaf as any).containerEl);
        }

        const view = this.activeLeaf!.view as MarkdownView;

        const footer = contentEl.createDiv({ 
            attr: { style: "display:flex; justify-content:flex-end; padding: 10px 0;" } 
        });

        new ButtonComponent(footer)
            .setButtonText("保存")
            .setCta()
            .onClick(async () => {
                await this.onSave(view.editor.getValue());
            });

        // 统一键盘监听
        this.modalEl.addEventListener("keydown", async (e: KeyboardEvent) => {
            // Ctrl+S 保存
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                await this.onSave(view.editor.getValue());
            }
            // Ctrl+J 下一个
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
                e.preventDefault();
                this.close();
                this.manager.nextCard();
            }
            // Ctrl+K 上一个
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                this.close();
                this.manager.prevCard();
            }
        }, true);

        setTimeout(() => {
            view.editor.focus();

            // Vim 插入模式判定
            // @ts-ignore
            const isVimEnabled = this.app.vault.getConfig("vimMode");
            if (isVimEnabled) {
                const cmContent = editorWrapper.querySelector(".cm-content");
                if (cmContent) {
                    cmContent.dispatchEvent(new KeyboardEvent("keydown", {
                        key: "i", keyCode: 73, code: "KeyI", which: 73,
                        bubbles: true, cancelable: true,
                    }));
                }
            }

            // 光标置于末尾
            const lineCount = view.editor.lineCount();
            const lastLine = lineCount - 1;
            view.editor.setCursor({ line: lastLine, ch: view.editor.getLine(lastLine).length });
            
            this.app.workspace.trigger("layout-change");
        }, 250);
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