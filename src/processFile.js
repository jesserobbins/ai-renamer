const fs = require('fs').promises
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const readline = require('readline')

const isImage = require('./isImage')
const isVideo = require('./isVideo')
const saveFile = require('./saveFile')
const getNewName = require('./getNewName')
const extractFrames = require('./extractFrames')
const readFileContent = require('./readFileContent')
const deleteDirectory = require('./deleteDirectory')
const isProcessableFile = require('./isProcessableFile')
const getMacOSTags = require('./getMacOSTags')

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m'
}

const formatRenamePreview = ({ original, updated }) => {
  const originalDir = path.dirname(original)
  const updatedDir = path.dirname(updated)
  const originalName = path.basename(original)
  const updatedName = path.basename(updated)

  const renderDir = dir => {
    if (!dir || dir === '.') return ''
    return dir + path.sep
  }

  const originalDirDisplay = renderDir(originalDir)
  const updatedDirDisplay = renderDir(updatedDir)
  const dirMatches = originalDirDisplay === updatedDirDisplay

  const renderSide = (dirDisplay, name, color) => {
    const sharedDir = dirDisplay
      ? `${ansi.dim}${dirDisplay}${ansi.reset}`
      : ''
    return `${sharedDir}${color}${name}${ansi.reset}`
  }

  const fromDisplay = renderSide(originalDirDisplay, originalName, ansi.red)
  const toDisplay = dirMatches
    ? `${ansi.dim}${originalDirDisplay}${ansi.reset}${ansi.green}${updatedName}${ansi.reset}`
    : renderSide(updatedDirDisplay, updatedName, ansi.green)

  return `${fromDisplay} ${ansi.dim}→${ansi.reset} ${toDisplay}`
}

const quoteForShell = value => {
  const escaped = value.replace(/(["\\`$])/g, '\\$1')
  return `"${escaped}"`
}

const logVerbose = (verbose, message) => {
  if (!verbose) return
  console.log(message)
}

const promptForConfirmation = async ({ question, forceChange, nonInteractiveMessage }) => {
  if (forceChange) return true

  if (!process.stdin.isTTY) {
    if (nonInteractiveMessage) {
      console.log(nonInteractiveMessage)
    }
    return false
  }

  return await new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    rl.question(question, answer => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      resolve(normalized === 'y' || normalized === 'yes')
    })
  })
}

module.exports = async options => {
  const { filePath } = options
  let framesOutputDir
  let ext
  let verboseFlag = false
  let relativeFilePath = ''

  try {
    const {
      frames,
      inputPath,
      convertBinary,
      verbose,
      forceChange,
      recordLogEntry,
      metadataHints,
      useFilenameHint,
      appendTags
    } = options

    verboseFlag = verbose

    const fileName = path.basename(filePath)
    ext = path.extname(filePath).toLowerCase()
    relativeFilePath = path.relative(inputPath, filePath) || fileName

    let fileMetadata = null
    let finderTags = []
    try {
      const stats = await fs.stat(filePath)
      const createdAt = stats.birthtime instanceof Date && !Number.isNaN(stats.birthtime.getTime())
        ? stats.birthtime.toISOString()
        : null
      const modifiedAt = stats.mtime instanceof Date && !Number.isNaN(stats.mtime.getTime())
        ? stats.mtime.toISOString()
        : null

      const prettySize = (() => {
        if (!Number.isFinite(stats.size)) return null
        if (stats.size < 1024) return `${stats.size} B`
        const units = ['KB', 'MB', 'GB', 'TB']
        let value = stats.size / 1024
        let unitIndex = 0
        while (value >= 1024 && unitIndex < units.length - 1) {
          value /= 1024
          unitIndex += 1
        }
        return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
      })()

      fileMetadata = {
        size: Number.isFinite(stats.size) ? stats.size : null,
        sizeLabel: prettySize,
        createdAt,
        modifiedAt
      }

      logVerbose(verbose, `🗂️ Metadata — size: ${prettySize || stats.size || 'unknown'}, created: ${createdAt || 'n/a'}, modified: ${modifiedAt || 'n/a'}`)
    } catch (metadataError) {
      logVerbose(verbose, `⚪ Unable to read metadata for ${relativeFilePath}: ${metadataError.message}`)
    }

    if (appendTags || metadataHints) {
      const tags = await getMacOSTags({
        filePath,
        verboseLogger: message => logVerbose(verbose, message)
      })

      if (tags.length > 0) {
        finderTags = tags
        if (fileMetadata) {
          fileMetadata = { ...fileMetadata, tags }
        } else {
          fileMetadata = { tags }
        }
      }
    }

    logVerbose(verbose, `🔍 Processing file: ${relativeFilePath}`)

    if (fileName === '.DS_Store') return

    if (!isProcessableFile({ filePath })) {
      console.log(`🟡 Unsupported file: ${relativeFilePath}`)
      return
    }

    let content
    let videoPrompt
    let images = []
    if (isImage({ ext })) {
      logVerbose(verbose, `🖼️ Detected image: ${relativeFilePath}`)
      images.push(filePath)
    } else if (isVideo({ ext })) {
      logVerbose(verbose, `🎞️ Detected video: ${relativeFilePath} — extracting frames`)
      framesOutputDir = `/tmp/ai-renamer/${uuidv4()}`
      const _extractedFrames = await extractFrames({
        frames,
        framesOutputDir,
        inputFile: filePath
      })
      images = _extractedFrames.images
      videoPrompt = _extractedFrames.videoPrompt
      logVerbose(verbose, `🎯 Extracted ${images.length} frame(s) from ${relativeFilePath}`)
    } else {
      logVerbose(verbose, `📄 Extracting text content from: ${relativeFilePath}`)
      content = await readFileContent({ filePath, convertBinary, verbose })
      if (!content) {
        console.log(`🔴 No text content: ${relativeFilePath}`)
        return
      }
      logVerbose(verbose, `✅ Extracted ${content.length} characters from ${relativeFilePath}`)
    }

    const newNameResult = await getNewName({
      ...options,
      images,
      content,
      videoPrompt,
      relativeFilePath,
      originalFileName: fileName,
      fileMetadata,
      metadataHints,
      useFilenameHint,
      appendTags,
      macTags: finderTags
    })
    if (!newNameResult || !newNameResult.filename) return

    const { filename: proposedName, context: nameContext } = newNameResult

    if (nameContext && nameContext.summary) {
      console.log(`ℹ️ ${nameContext.summary}`)
    }

    const proposedRelativeNewPath = path.join(path.dirname(relativeFilePath), `${proposedName}${ext}`)
    const renamePreview = formatRenamePreview({
      original: relativeFilePath,
      updated: proposedRelativeNewPath
    })
    const confirmationPrompt = `${ansi.cyan}?${ansi.reset} ${ansi.bold}Rename${ansi.reset} ${renamePreview}? (y/N): `

    const confirmed = await promptForConfirmation({
      question: confirmationPrompt,
      forceChange,
      nonInteractiveMessage: `🟡 Skipping rename for ${relativeFilePath} because confirmations are required but no interactive terminal is available. Use --force-change to bypass prompts.`
    })

    if (!confirmed) {
      console.log(`⚪ Skipped rename: ${relativeFilePath}`)
      return
    }

    const newFileName = await saveFile({ ext, newName: proposedName, filePath })
    const relativeNewFilePath = path.join(path.dirname(relativeFilePath), newFileName)
    const renameResultPreview = formatRenamePreview({
      original: relativeFilePath,
      updated: relativeNewFilePath
    })
    console.log(`🟢 Renamed: ${renameResultPreview}`)

    if (typeof recordLogEntry === 'function') {
      const newAbsolutePath = path.resolve(path.dirname(filePath), newFileName)
      const originalAbsolutePath = path.resolve(filePath)
      const confirmationSource = forceChange ? 'force-change flag' : 'user confirmed'
      const revertCommand = `mv ${quoteForShell(newAbsolutePath)} ${quoteForShell(originalAbsolutePath)}`
      const revertCommandRelative = `mv ${quoteForShell(relativeNewFilePath)} ${quoteForShell(relativeFilePath)}`
      const logEntry = {
        originalPath: originalAbsolutePath,
        newPath: newAbsolutePath,
        originalName: path.basename(filePath),
        newName: newFileName,
        originalRelativePath: relativeFilePath,
        newRelativePath: relativeNewFilePath,
        acceptedAt: new Date().toISOString(),
        confirmation: confirmationSource,
        context: nameContext,
        fileMetadata,
        finderTags,
        revertCommand,
        revertCommandRelative
      }
      recordLogEntry(logEntry)
    }
  } catch (err) {
    console.log(err.message)
  } finally {
    if (ext && isVideo({ ext }) && framesOutputDir) {
      logVerbose(verboseFlag, `🧹 Cleaning up extracted frames for ${relativeFilePath || filePath}`)
      try {
        await deleteDirectory({ folderPath: framesOutputDir })
      } catch (cleanupError) {
        console.log(`🔴 Failed to clean up frames for ${relativeFilePath || filePath}: ${cleanupError.message}`)
      }
    }
  }
}
