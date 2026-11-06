// Preloaded with -r. Native dialogs at startup block the main process before Playwright can attach,
// so this answers them with the first button and records what was shown.
const { dialog } = require('electron')
const { appendFileSync } = require('node:fs')

const record = (entry) => appendFileSync(process.env.HMMS_DIALOG_LOG, `${JSON.stringify(entry)}\n`)

dialog.showMessageBox = async (options) => {
  record({ title: options.title, buttons: options.buttons })
  return { response: 0, checkboxChecked: false }
}
dialog.showErrorBox = (title, content) => record({ title, content })
