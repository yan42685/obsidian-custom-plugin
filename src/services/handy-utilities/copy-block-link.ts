import {
    Editor,
    MarkdownView,
    Plugin,
    TFile,
} from "obsidian";

export class CopyBlockLinkManager {
  constructor(private plugin: Plugin) {}

  /**
   * 生成 4 位短 ID 并确保在当前笔记内唯一
   */
  private generateUniqueId(file: TFile): string {
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);
    const existingIds = new Set(
      (fileCache?.sections || [])
        .map((s) => s.id)
        .filter((id): id is string => !!id)
    );

    let id: string;
    let attempts = 0;
    do {
      const length = attempts < 5 ? 4 : 6;
      id = Math.random().toString(36).substring(2, 2 + length);
      attempts++;
    } while (existingIds.has(id));
    return id;
  }

  private sanitizeHeading(heading: string): string {
    return heading
      .replace(/[!"#$%&()*+,.:;<=>?@^`{|}~/\\/[\]\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private copyToClipboard(file: TFile, subpath: string, isEmbed: boolean): void {
    const link = this.plugin.app.fileManager.generateMarkdownLink(file, "", subpath);
    const prefix = isEmbed ? "!" : "";
    navigator.clipboard.writeText(`${prefix}${link}`);
  }

  /**
   * 核心请求处理逻辑
   */
  public handleRequest(editor: Editor, view: MarkdownView, isEmbed: boolean): void {
    const file = view.file;
    if (!file) return;

    const cursor = editor.getCursor("to");
    const lineText = editor.getLine(cursor.line);
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);

    let subpath = "";

    // 1. 优先判定是否为标题
    const heading = fileCache?.headings?.find(h => h.position.start.line === cursor.line);
    
    if (heading) {
      subpath = `#${this.sanitizeHeading(heading.heading)}`;
    } else {
      // 2. 正则匹配：直接读取行末是否已有 ID，绕过缓存延迟
      const match = lineText.match(/\^([a-z0-9]+)$/);
      if (match) {
        subpath = `#^${match[1]}`;
      } else {
        // 3. 注入新 ID
        const id = this.generateUniqueId(file);
        const section = fileCache?.sections?.find(s => 
          s.position.start.line <= cursor.line && s.position.end.line >= cursor.line
        );
        
        const isSpecial = section && ["blockquote", "code", "table", "footnoteDefinition"].includes(section.type);
        const spacer = isSpecial ? "\n\n" : " ";
        
        // 强制插入到当前行末尾
        editor.replaceRange(`${spacer}^${id}`, { line: cursor.line, ch: lineText.length });
        subpath = `#^${id}`;
      }
    }

    // 4. 执行复制
    if (subpath) {
      this.copyToClipboard(file, subpath, isEmbed);
      
      // 5. 取消选中：将选区塌陷至终点位置
      editor.focus();
      const finalPos = editor.getCursor("to");
      editor.setSelection(finalPos, finalPos);
    }
  }

  public init(): void {
    this.plugin.addCommand({
      id: "copy-block-link",
      name: "Copy link to current block or heading",
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) this.handleRequest(editor, view, false);
      },
    });

    this.plugin.addCommand({
      id: "copy-block-embed",
      name: "Copy embed to current block or heading",
      editorCallback: (editor, view) => {
        if (view instanceof MarkdownView) this.handleRequest(editor, view, true);
      },
    });
  }
}