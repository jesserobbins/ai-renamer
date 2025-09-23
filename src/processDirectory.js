const path = require('path')
const fs = require('fs').promises

const processFile = require('./processFile')

const logVerbose = (verbose, message) => {
  if (!verbose) return
  console.log(message)
}

const processDirectory = async ({ options, inputPath }) => {
  try {
    const { verbose } = options
    logVerbose(verbose, `📁 Entering directory: ${inputPath}`)
    const files = await fs.readdir(inputPath)
    for (const file of files) {
      const filePath = path.join(inputPath, file)
      const fileStats = await fs.stat(filePath)
      if (fileStats.isFile()) {
        await processFile({ ...options, filePath })
      } else if (fileStats.isDirectory() && options.includeSubdirectories) {
        logVerbose(verbose, `📂 Descending into subdirectory: ${filePath}`)
        await processDirectory({ options, inputPath: filePath })
      }
    }
  } catch (err) {
    console.log(err.message)
  }
}

module.exports = processDirectory
