// services/simple-sidebar-manager.ts
import { ItemView, Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_KUAKUA = "kuakua-view";

class KuakuaView extends ItemView {
    constructor(leaf: WorkspaceLeaf, private plugin: Plugin) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_KUAKUA;
    }

    getDisplayText(): string {
        return "夸夸箱"; // 这个会成为可拖动的标签名
    }

    getIcon(): string {
        return "heart";
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.style.padding = "10px";

        const savedContent = await this.plugin.loadData() || "";

        container.createEl("h2", { 
            text: "💖 夸夸箱",
            attr: { style: "margin-bottom: 12px;" }
        });

        const textarea = container.createEl("textarea", {
            attr: {
                style: `
                    width: 100%;
                    min-height: 200px;
                    background: var(--background-primary-alt);
                    border-radius: 6px;
                    padding: 12px;
                    color: var(--text-normal);
                    border: 1px solid var(--background-modifier-border);
                    font-family: inherit;
                    resize: vertical;
                `,
                placeholder: "把给你的夸夸粘贴在这里..."
            }
        });

        textarea.value = savedContent;

        textarea.addEventListener("input", () => {
            this.plugin.saveData(textarea.value);
        });

        const countEl = container.createEl("p", {
            attr: { 
                style: "margin-top: 8px; font-size: 12px; color: var(--text-muted); text-align: right;"
            }
        });
        countEl.setText(`${textarea.value.length} 字符`);

        textarea.addEventListener("input", () => {
            countEl.setText(`${textarea.value.length} 字符`);
        });
    }
}

export class SimpleSidebarManager {
    constructor(private plugin: Plugin) {
        // 注册视图
        this.plugin.registerView(
            VIEW_TYPE_KUAKUA,
            (leaf) => new KuakuaView(leaf, this.plugin)
        );

        // 不添加 ribbon 图标，而是让用户通过命令或侧边栏标签打开
        // 或者添加一个简单的命令
        this.plugin.addCommand({
            id: "open-kuakua",
            name: "Open kuakua",
            callback: () => this.openKuakuaView()
        });
    }

    async openKuakuaView() {
        const { workspace } = this.plugin.app;
        
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_KUAKUA)[0];
        
        if (!leaf) {
            leaf = workspace.getRightLeaf(false) || undefined;
            if (!leaf) return;
            
            await leaf.setViewState({
                type: VIEW_TYPE_KUAKUA,
                active: true,
            });
        }

        workspace.revealLeaf(leaf);
    }

    closeView() {
        this.plugin.app.workspace
            .getLeavesOfType(VIEW_TYPE_KUAKUA)
            .forEach(leaf => leaf.detach());
    }
}