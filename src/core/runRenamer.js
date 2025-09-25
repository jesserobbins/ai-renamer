const fs = require('fs/promises')
const fssync = require('fs')
const path = require('path')
const { discoverFiles } = require('./discoverFiles')
const { applyFilters } = require('./applyFilters')
const { extractContent } = require('../extractors/contentExtractor')
const { buildPrompt } = require('./promptBuilder')
const { createProviderClient } = require('../providers/createProviderClient')
const { applyCase } = require('../utils/caseFormat')
const { sanitizeFilename, truncateFilename, ensureUniqueName } = require('../utils/sanitize')
const { getExtension } = require('../utils/fileType')
const { createSubjectManager } = require('./subjectManager')
const { createSummary } = require('./summary')
const { parseModelResponse } = require('../utils/parseModelResponse')
const { createInstructionSet } = require('./instructionSet')

function normaliseModelResult (rawResult) {
  if (!rawResult || typeof rawResult !== 'object') {
    throw new Error('Model response missing expected JSON object')
  }

  if (rawResult.data && typeof rawResult.data === 'string') {
    return normaliseModelResult(parseModelResponse(rawResult.data))
  }

  const filename = rawResult.filename || rawResult.fileName || rawResult.name
  const subject = rawResult.subject ?? rawResult.topic ?? null
  const summary = rawResult.summary || rawResult.reason || ''
  const subjectConfidence = rawResult.subject_confidence ?? rawResult.subjectConfidence ?? null

  if (!filename) {
    throw new Error('Model response missing "filename" field')
  }

  return {
    filename,
    subject,
    summary,
    subjectConfidence: typeof subjectConfidence === 'number' ? subjectConfidence : null
  }
}

async function runRenamer (targetPath, options, logger) {
  const stats = await fs.stat(targetPath)
  const rootDirectory = stats.isDirectory() ? targetPath : path.dirname(targetPath)
  const files = await discoverFiles(targetPath, options.includeSubdirectories)
  if (!files.length) {
    logger.warn('No files found to process.')
    return
  }

  const provider = createProviderClient(options, logger)
  const instructionSet = await createInstructionSet(options, logger)

  let subjectManager = null
  if (options.organizeBySubject) {
    const subjectBase = path.resolve(options.subjectDestination || rootDirectory)
    subjectManager = await createSubjectManager({
      baseDirectory: subjectBase,
      moveUnknownSubjects: Boolean(options.moveUnknownSubjects)
    }, logger)
  }

  const summary = createSummary()

  for (const filePath of files) {
    try {
      const filterResult = await applyFilters(filePath, options)
      if (filterResult.skipped) {
        logger.info(`Skipping ${filePath}: ${filterResult.reason}`)
        summary.addSkip({ file: filePath, reason: filterResult.reason })
        continue
      }

      logger.info(`Processing ${filePath}`)
      const content = await extractContent(filePath, options)
      const subjectHints = subjectManager ? subjectManager.getHints() : []
      const prompt = buildPrompt({ content, options, subjectHints, instructionSet })
      const modelResponse = await provider.generateFilename(prompt)
      const { filename, subject, summary: fileSummary, subjectConfidence } = normaliseModelResult(modelResponse)

      const cleanedSubject = instructionSet?.sanitizeSubject ? instructionSet.sanitizeSubject(subject) : subject
      const effectiveSubject = cleanedSubject || null
      const effectiveConfidence = effectiveSubject
        ? subjectConfidence
        : 0

      const extension = getExtension(filePath).replace('.', '')
      const baseWithoutExt = filename.replace(/\.[^./]+$/, '')
      const formattedBase = applyCase(baseWithoutExt, options.case || 'kebabCase')
      const truncatedBase = options.chars ? truncateFilename(formattedBase, options.chars) : formattedBase
      const sanitizedName = sanitizeFilename(truncatedBase, extension)

      let destinationDirectory = path.dirname(filePath)
      let resolvedSubject = effectiveSubject

      if (subjectManager) {
        const subjectResolution = await subjectManager.resolveDestination({
          subject: effectiveSubject,
          confidence: effectiveConfidence
        })
        if (subjectResolution) {
          destinationDirectory = subjectResolution.directory
          resolvedSubject = subjectResolution.subject
        }
      }

      await fs.mkdir(destinationDirectory, { recursive: true })

      const finalName = ensureUniqueName(destinationDirectory, sanitizedName, fssync.existsSync)
      const destinationPath = path.join(destinationDirectory, finalName)

      if (options.dryRun) {
        logger.info(`[dry-run] ${path.basename(filePath)} -> ${finalName}`)
        if (destinationDirectory !== path.dirname(filePath)) {
          logger.info(`[dry-run] would move to ${destinationDirectory}`)
        }
        summary.addRename({
          original: filePath,
          newName: destinationPath,
          subject: resolvedSubject,
          confidence: effectiveConfidence,
          notes: fileSummary
        })
        continue
      }

      await fs.rename(filePath, destinationPath)
      logger.info(`Renamed to ${destinationPath}`)
      summary.addRename({
        original: filePath,
        newName: destinationPath,
        subject: resolvedSubject,
        confidence: effectiveConfidence,
        notes: fileSummary
      })
      if (destinationDirectory !== path.dirname(filePath)) {
        summary.addMove({ file: destinationPath, destination: destinationDirectory, subject: resolvedSubject })
      }
    } catch (error) {
      logger.error(`Error processing ${filePath}: ${error.message}`)
      summary.addError({ file: filePath, error: error.message })
    }
  }

  if (options.summary) {
    summary.print(logger)
  }

  return summary.export()
}

module.exports = {
  runRenamer
}
