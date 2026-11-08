import { Modal, Setting } from 'obsidian'

export default class UndoModal extends Modal {
  constructor(plugin) {
    super(plugin.app)
    this.plugin = plugin
  }

  async parseDay(day) {
    const { file, oldContent } = day
    let currentContent = await this.plugin.app.vault.read(file)

    const oldContentLineCount = oldContent.split('\n').length
    const currentContentLineCount = currentContent.split('\n').length
    const diff = Math.abs(oldContentLineCount - currentContentLineCount)

    let s = ''
    if (oldContentLineCount > currentContentLineCount) {
      s = `- ${file.basename}.${file.extension}: add ${diff} line${diff > 1 ? 's':''}.`
    } else if (oldContentLineCount < currentContentLineCount) {
      s = `- ${file.basename}.${file.extension}: remove ${diff} line${diff > 1 ? 's':''}.`
    } else {
      if (oldContent == currentContent) {
        s = `- ${file.basename}.${file.extension}: will not be modified.`
      } else {
        s = `- ${file.basename}.${file.extension}: will be modified to its previous state, with the same number of lines (but different content).`
      }
    }

    return s
  }

  async confirmUndo(undoHistoryInstance) {
    // today's note is not snapshotted when Templater is enabled
    if (undoHistoryInstance.today.file != undefined) {
      await this.plugin.app.vault.modify(undoHistoryInstance.today.file, undoHistoryInstance.today.oldContent);
    }
    if (undoHistoryInstance.previousDay.file != undefined) {
      await this.plugin.app.vault.modify(undoHistoryInstance.previousDay.file, undoHistoryInstance.previousDay.oldContent);
    }
    const backlog = undoHistoryInstance.backlog
    if (backlog?.file != undefined) {
      if (backlog.created) {
        // the rollover made this note, so undo removes it again
        // trashFile needs Obsidian 1.6.6; vault.trash is the older call
        const { fileManager, vault } = this.plugin.app
        if (typeof fileManager.trashFile === 'function') {
          await fileManager.trashFile(backlog.file)
        } else {
          await vault.trash(backlog.file, true)
        }
      } else {
        await this.plugin.app.vault.modify(backlog.file, backlog.oldContent)
      }
    }
    this.plugin.undoHistory = []
  }

  async onOpen() {
    let { contentEl, plugin } = this
    contentEl.createEl('h3', { text: 'Undo last rollover' });
    contentEl.createEl('div', { text: "A single rollover command can be undone, which will load the state of the files the rollover modified before it occurred: today's note, the previous day's note if its todos were marked, cancelled or deleted, and the backlog note if todos were sent to it (a backlog note the rollover created is deleted). With Templater enabled, only the previous day's note and the backlog note are restored. Any text you may have added to those file(s) during that time may be deleted." });
    contentEl.createEl('div', { text: 'Note that rollover actions can only be undone for up to 2 minutes after the command occurred, and will be removed from history if the app closes.' })
    contentEl.createEl('h4', { text: 'Changes made with undo:' })

    const undoHistoryInstance = plugin.undoHistory[0]
    let modTextArray = []
    if (undoHistoryInstance.today.file != undefined) {
      modTextArray.push(await this.parseDay(undoHistoryInstance.today))
    } else {
      modTextArray.push("- Today's note will not be changed. Remove the rolled over todos from it yourself if you want them gone.")
    }
    if (undoHistoryInstance.previousDay.file != undefined) {
      modTextArray.push(await this.parseDay(undoHistoryInstance.previousDay))
    }
    const backlog = undoHistoryInstance.backlog
    if (backlog?.file != undefined) {
      modTextArray.push(backlog.created
        ? `- ${backlog.file.basename}.${backlog.file.extension}: will be deleted.`
        : await this.parseDay(backlog))
    }
    modTextArray.forEach(txt => {
      contentEl.createEl('div', { text: txt })
    })

    new Setting(contentEl)
      .addButton(button => button
        .setButtonText('Confirm Undo')
        .onClick(async (e) => {
          await this.confirmUndo(undoHistoryInstance)
          this.close()
        })
      )
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}
