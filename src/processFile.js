/**
 * The file processing pipeline is responsible for preparing every piece of
 * context that feeds the rename model and for committing the rename once the
 * user signs off.  Because it ties together metadata gathering, OCR/video
 * frame extraction, interactive prompts, and run logging, the control flow can
 * be hard to follow without some breadcrumbs.  The helpers and comments in
 * this module aim to document the high-level choreography so future changes can
 * slot into the right step without breaking the user experience.
 */

const fs = require('fs').promises
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const readline = require('readline')

const isImage = require('./isImage')
const isVideo = require('./isVideo')
const saveFile = require('./saveFile')
const getNewName = require('./getNewName')
const detectPitchDeck = require('./detectPitchDeck')
const extractFrames = require('./extractFrames')
const readFileContent = require('./readFileContent')
const deleteDirectory = require('./deleteDirectory')
const isProcessableFile = require('./isProcessableFile')
const getMacOSTags = require('./getMacOSTags')
const {
  sanitizeSubjectFolderName,
  isLowConfidenceSubject,
  normalizeSubjectKey
} = require('./subjectUtils')

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m'
}

/**
 * Formats the rename preview for interactive prompts by dimming any unchanged
 * directory segments and highlighting the filenames that are about to change.
 *
 * @param {{ original: string, updated: string }} previewPaths absolute or
 *   relative file paths from/to which the rename would occur.
 * @returns {string} formatted ANSI-aware preview string.
 */
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

/**
 * Wraps a value in shell-safe double quotes so the generated recovery commands
 * in the run log can be copied directly into a terminal without additional
 * escaping.
 */
const quoteForShell = value => {
  const escaped = value.replace(/(["\\`$])/g, '\\$1')
  return `"${escaped}"`
}

/**
 * Centralizes the verbose logging guard so we can sprinkle detailed progress
 * updates throughout the pipeline without repeating the conditional.
 */
const logVerbose = (verbose, message) => {
  if (!verbose) return
  console.log(message)
}

/**
 * Asks the user to confirm a rename proposal unless the run is forced.  The
 * extra branching around blank answers exists so the `--accept-default` flag
 * can flip the default choice for power users who want to speed through
 * sessions.
 */
const promptForConfirmation = async ({ question, forceChange, nonInteractiveMessage, defaultAccept }) => {
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

      if (normalized.length === 0) {
        resolve(Boolean(defaultAccept))
        return
      }

      if (normalized === 'y' || normalized === 'yes') {
        resolve(true)
        return
      }

      if (normalized === 'n' || normalized === 'no') {
        resolve(false)
        return
      }

      resolve(false)
    })
  })
}

module.exports = async options => {
  const { filePath } = options
  let framesOutputDir
  let ext
  let verboseFlag = false
  let relativeFilePath = ''

  const trackResult = typeof options.trackResult === 'function'
    ? options.trackResult
    : null

  const promptFocus = typeof options.promptFocus === 'string'
    ? options.promptFocus
    : 'balanced'

  const recordOutcome = (type, payload = {}) => {
    if (!trackResult) return
    trackResult({ type, ...payload })
  }

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
      appendTags,
      pitchDeckOnly,
      acceptOnEnter,
      dryRun = false,
      maxFileSizeBytes,
      allowedExtensions,
      ignoredExtensions,
      subjectOrganization,
      inputRootDirectory
    } = options

    verboseFlag = verbose


    const fileName = path.basename(filePath)
    ext = path.extname(filePath).toLowerCase()
    relativeFilePath = path.relative(inputPath, filePath) || fileName

    recordOutcome('processed')


    // Capture filesystem metadata up front so we can both feed it to the
    // language model (when enabled) and stash it in the audit log.
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
      if (maxFileSizeBytes && Number.isFinite(stats.size) && stats.size > maxFileSizeBytes) {
        const readableSize = prettySize || `${stats.size} bytes`
        console.log(`⚪ Max size filter: skipping ${relativeFilePath} (${readableSize})`)
        recordOutcome('skipped', { reason: `exceeds max size (${readableSize})` })
        return
      }
    } catch (metadataError) {
      logVerbose(verbose, `⚪ Unable to read metadata for ${relativeFilePath}: ${metadataError.message}`)
    }

    if (appendTags || metadataHints) {
      // Finder tags double as optional filename suffixes and as extra metadata
      // for the model.  We only attempt to read them when either feature is
      // enabled to avoid unnecessary AppleScript invocations.
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

    if (fileName === '.DS_Store') {
      recordOutcome('skipped', { reason: 'ignored system file' })
      return
    }

    const allowedSet = allowedExtensions instanceof Set ? allowedExtensions : null
    if (allowedSet && allowedSet.size > 0 && !allowedSet.has(ext)) {
      console.log(`⚪ Extension filter: skipping ${relativeFilePath} (${ext || 'no extension'})`)
      const extensionLabel = ext || 'no extension'
      recordOutcome('skipped', { reason: `filtered by allow list (${extensionLabel})` })
      return
    }

    const ignoredSet = ignoredExtensions instanceof Set ? ignoredExtensions : null
    if (ignoredSet && ignoredSet.has(ext)) {
      console.log(`⚪ Ignored extension: skipping ${relativeFilePath} (${ext || 'no extension'})`)
      const extensionLabel = ext || 'no extension'
      recordOutcome('skipped', { reason: `filtered by ignore list (${extensionLabel})` })
      return
    }

    if (!isProcessableFile({ filePath })) {
      console.log(`🟡 Unsupported file: ${relativeFilePath}`)
      const extensionLabel = ext || 'no extension'
      recordOutcome('skipped', { reason: `unsupported file type (${extensionLabel})` })
      return
    }

    if (pitchDeckOnly && ext !== '.pdf') {
      console.log(`⚪ Pitch deck mode: skipping non-PDF file ${relativeFilePath}`)
      const extensionLabel = ext || 'no extension'
      recordOutcome('skipped', { reason: `pitch deck mode (non-PDF ${extensionLabel})` })
      return
    }

    let content
    let videoPrompt
    let images = []

    let pitchDeckDetection = null
    // Images and videos bypass text extraction altogether and instead use the
    // captured frames/stills as prompt context.

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

      // Everything else is treated as a document-like asset; we try to pull
      // text out of it, optionally converting legacy Office binaries first.
      logVerbose(verbose, `📄 Extracting text content from: ${relativeFilePath}`)
      content = await readFileContent({ filePath, convertBinary, verbose })

      if (!content) {
        console.log(`🔴 No text content: ${relativeFilePath}`)
        recordOutcome('skipped', { reason: 'no text content extracted' })
        return
      }
      logVerbose(verbose, `✅ Extracted ${content.length} characters from ${relativeFilePath}`)

      if (pitchDeckOnly) {
        pitchDeckDetection = detectPitchDeck({ text: content })
        if (!pitchDeckDetection.isPitchDeck) {
          const reason = pitchDeckDetection.summary
            ? ` (${pitchDeckDetection.summary})`
            : ''
          console.log(`⚪ Pitch deck detection: no startup deck indicators${reason}. Skipping ${relativeFilePath}.`)
          const detectionReason = pitchDeckDetection.summary
            ? `pitch deck filter — ${pitchDeckDetection.summary}`
            : 'pitch deck filter'
          recordOutcome('skipped', { reason: detectionReason })
          return
        }
        const detectionLabel = pitchDeckDetection.confidence
          ? ` (confidence: ${pitchDeckDetection.confidence})`
          : ''
        const detail = pitchDeckDetection.summary ? ` ${pitchDeckDetection.summary}` : ''
        console.log(`⚪ Pitch deck detection: startup deck confirmed${detectionLabel}.${detail}`)
      }
    }

    // At this point we have every relevant hint; hand off to the rename engine
    // so it can craft a prompt and parse the model's response.
    const shouldIncludeSubjectHints = promptFocus !== 'company'
    const subjectHintsForPrompt = shouldIncludeSubjectHints && subjectOrganization && subjectOrganization.hintSet instanceof Set
      ? Array.from(subjectOrganization.hintSet)
      : []

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
      macTags: finderTags,
      pitchDeckMode: Boolean(pitchDeckOnly),
      pitchDeckDetection,
      subjectHints: subjectHintsForPrompt
    })

    if (!newNameResult) {
      recordOutcome('skipped', { reason: 'no rename suggestion produced' })
      return
    }

    if (newNameResult.skipped) {
      let skipSummary = null
      if (newNameResult.context && newNameResult.context.summary) {
        skipSummary = newNameResult.context.summary
        console.log(`ℹ️ ${skipSummary}`)
      }
      console.log(`⚪ Skipped rename: ${relativeFilePath}`)
      const skipReason = skipSummary
        ? `model requested skip — ${skipSummary}`
        : 'model requested skip'
      recordOutcome('skipped', { reason: skipReason })
      return
    }

    if (!newNameResult.filename) {
      recordOutcome('skipped', { reason: 'no filename returned from model' })
      return
    }

    const { filename: proposedName, context: nameContext } = newNameResult

    if (nameContext && nameContext.summary) {
      console.log(`ℹ️ ${nameContext.summary}`)
    }

    const subjectDetails = (() => {
      const contextSubject = nameContext && typeof nameContext.subject === 'string'
        ? nameContext.subject.trim()
        : null
      const normalizedFromContext = nameContext && typeof nameContext.subjectNormalized === 'string' && nameContext.subjectNormalized
        ? nameContext.subjectNormalized
        : contextSubject
          ? normalizeSubjectKey(contextSubject)
          : null
      const confidenceFromContext = nameContext && typeof nameContext.subjectConfidence === 'string'
        ? nameContext.subjectConfidence
        : 'unknown'
      const sourceFromContext = nameContext && typeof nameContext.subjectSource === 'string'
        ? nameContext.subjectSource
        : 'model'
      return {
        name: contextSubject || null,
        normalizedKey: normalizedFromContext || null,
        confidence: confidenceFromContext || 'unknown',
        source: sourceFromContext || 'model'
      }
    })()

    if (subjectOrganization && subjectOrganization.hintSet instanceof Set) {
      if (subjectDetails.name) {
        subjectOrganization.hintSet.add(subjectDetails.name)
      }
      if (nameContext && typeof nameContext.subjectMatchedHint === 'string') {
        subjectOrganization.hintSet.add(nameContext.subjectMatchedHint)
      }
    }

    const determineSubjectMovePlan = () => {
      if (!subjectOrganization || !subjectOrganization.enabled) return null
      const {
        destinationRoot,
        folderMap,
        folderNameSet,
        moveLowConfidence,
        unknownFolderName
      } = subjectOrganization
      if (!destinationRoot || !(folderMap instanceof Map) || !(folderNameSet instanceof Set)) {
        return null
      }

      const normalizedKey = subjectDetails.normalizedKey || (subjectDetails.name ? normalizeSubjectKey(subjectDetails.name) : null)
      const lowConfidence = isLowConfidenceSubject({
        subject: subjectDetails.name,
        confidence: subjectDetails.confidence
      })

      if ((lowConfidence || !normalizedKey) && moveLowConfidence) {
        const unknownKey = normalizeSubjectKey(unknownFolderName)
        const existing = unknownKey ? folderMap.get(unknownKey) : null
        const folderName = existing ? existing.folderName : unknownFolderName
        const targetPath = existing ? existing.absolutePath : path.join(destinationRoot, folderName)
        if (unknownKey) {
          folderMap.set(unknownKey, { folderName, absolutePath: targetPath })
        }
        folderNameSet.add(folderName.toLowerCase())
        return {
          folderName,
          targetPath,
          normalizedKey: unknownKey,
          reason: 'low-confidence',
          subjectName: subjectDetails.name,
          confidence: subjectDetails.confidence
        }
      }

      if (!normalizedKey) {
        return null
      }

      if (folderMap.has(normalizedKey)) {
        const existing = folderMap.get(normalizedKey)
        return {
          folderName: existing.folderName,
          targetPath: existing.absolutePath,
          normalizedKey,
          reason: 'existing',
          subjectName: subjectDetails.name,
          confidence: subjectDetails.confidence
        }
      }

      if (!subjectDetails.name) {
        return null
      }

      const baseFolderName = sanitizeSubjectFolderName(subjectDetails.name, 'Subject')
      let candidateFolder = baseFolderName || 'Subject'
      let counter = 2
      while (folderNameSet.has(candidateFolder.toLowerCase())) {
        candidateFolder = `${baseFolderName || 'Subject'}-${counter}`
        counter += 1
      }

      const targetPath = path.join(destinationRoot, candidateFolder)
      folderMap.set(normalizedKey, { folderName: candidateFolder, absolutePath: targetPath })
      folderNameSet.add(candidateFolder.toLowerCase())
      if (subjectOrganization.hintSet instanceof Set && subjectDetails.name) {
        subjectOrganization.hintSet.add(subjectDetails.name)
      }

      return {
        folderName: candidateFolder,
        targetPath,
        normalizedKey,
        reason: 'new',
        subjectName: subjectDetails.name,
        confidence: subjectDetails.confidence
      }
    }

    const subjectMovePlan = determineSubjectMovePlan()

    if (subjectOrganization && subjectOrganization.enabled) {
      const subjectLabel = subjectDetails.name || 'Unknown'
      const confidenceLabel = subjectDetails.confidence || 'unknown'
      console.log(`📁 Subject candidate: ${subjectLabel} (${confidenceLabel})`)
      if (subjectMovePlan) {
        switch (subjectMovePlan.reason) {
          case 'low-confidence':
            console.log(`📁 Subject routing: directing to ${subjectMovePlan.folderName} for low-confidence matches`)
            break
          case 'existing':
            console.log(`📁 Subject routing: using existing folder ${subjectMovePlan.folderName}`)
            break
          case 'new':
            console.log(`📁 Subject routing: planning new folder ${subjectMovePlan.folderName}`)
            break
          default:
            console.log(`📁 Subject routing: moving to ${subjectMovePlan.folderName}`)
        }
      } else {
        console.log('📁 Subject routing: keeping current directory')
      }
    }

    const proposedRelativeNewPath = path.join(path.dirname(relativeFilePath), `${proposedName}${ext}`)
    const renamePreview = formatRenamePreview({
      original: relativeFilePath,
      updated: proposedRelativeNewPath
    })
    const defaultHint = acceptOnEnter ? '(Y/n)' : '(y/N)'
    const confirmationPrompt = `${ansi.cyan}?${ansi.reset} ${ansi.bold}Rename${ansi.reset} ${renamePreview}? ${defaultHint}: `

    const confirmed = await promptForConfirmation({
      question: confirmationPrompt,
      forceChange,
      nonInteractiveMessage: `🟡 Skipping rename for ${relativeFilePath} because confirmations are required but no interactive terminal is available. Use --force-change to bypass prompts.`,
      defaultAccept: acceptOnEnter
    })


    if (!confirmed) {
      console.log(`⚪ Skipped rename: ${relativeFilePath}`)
      recordOutcome('skipped', { reason: 'user declined confirmation' })
      return
    }

    // In dry-run mode we present the approved preview and bail out before
    // touching the filesystem so users can verify results safely.
    if (dryRun) {
      console.log(`🟢 [dry-run] ${renamePreview}`)
      if (subjectOrganization && subjectOrganization.enabled) {
        if (subjectMovePlan) {
          const previewDestination = path.join(subjectMovePlan.folderName, `${proposedName}${ext}`)
          console.log(`📦 [dry-run] Would move to ${previewDestination}`)
        } else {
          console.log('📦 [dry-run] Would leave the file in its current directory')
        }
      }
      recordOutcome('dry-run', { preview: renamePreview })
      return
    }

    // We only touch the original file once the user consents; saveFile handles
    // collision-safe renaming and returns the actual name written to disk.

    const newFileName = await saveFile({ ext, newName: proposedName, filePath })
    const renameResultPreview = formatRenamePreview({
      original: relativeFilePath,
      updated: path.join(path.dirname(relativeFilePath), newFileName)
    })
    console.log(`🟢 Renamed: ${renameResultPreview}`)
    recordOutcome('renamed')

    let finalAbsolutePath = path.resolve(path.dirname(filePath), newFileName)
    let relativeNewFilePath = inputRootDirectory
      ? path.relative(inputRootDirectory, finalAbsolutePath)
      : path.relative(inputPath, finalAbsolutePath)
    if (!relativeNewFilePath || relativeNewFilePath === '') {
      relativeNewFilePath = newFileName
    }

    let subjectFolderApplied = null
    let subjectMoveReason = null

    if (subjectOrganization && subjectOrganization.enabled && subjectMovePlan) {
      try {
        await fs.mkdir(subjectMovePlan.targetPath, { recursive: true })
        const destinationPath = path.join(subjectMovePlan.targetPath, newFileName)
        await fs.rename(finalAbsolutePath, destinationPath)
        finalAbsolutePath = destinationPath
        relativeNewFilePath = inputRootDirectory
          ? path.relative(inputRootDirectory, destinationPath)
          : path.relative(inputPath, destinationPath)
        if (!relativeNewFilePath || relativeNewFilePath === '') {
          relativeNewFilePath = path.basename(destinationPath)
        }
        subjectFolderApplied = subjectMovePlan.folderName
        subjectMoveReason = subjectMovePlan.reason
        console.log(`📦 Moved to subject folder: ${subjectFolderApplied}/${newFileName}`)
      } catch (moveError) {
        console.log(`🔴 Failed to move into subject folder (${subjectMovePlan.folderName}): ${moveError.message}`)
      }
    }

    if (typeof recordLogEntry === 'function') {

      // The recovery log stores everything needed to undo the rename later and
      // helps future debugging by recording the reasoning the model supplied.
      const originalAbsolutePath = path.resolve(filePath)
      const confirmationSource = forceChange ? 'force-change flag' : 'user confirmed'
      const revertCommand = `mv ${quoteForShell(finalAbsolutePath)} ${quoteForShell(originalAbsolutePath)}`
      const revertCommandRelative = `mv ${quoteForShell(relativeNewFilePath)} ${quoteForShell(relativeFilePath)}`
      const logEntry = {
        originalPath: originalAbsolutePath,

        newPath: finalAbsolutePath,
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
        revertCommandRelative,
        subject: subjectDetails.name,
        subjectConfidence: subjectDetails.confidence,
        subjectSource: subjectDetails.source,
        subjectFolder: subjectFolderApplied,
        subjectMoveReason

      }
      if (!dryRun) {
        recordLogEntry(logEntry)
      }
    }
  } catch (err) {
    console.log(err.message)
    recordOutcome('error', { reason: err.message })
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
