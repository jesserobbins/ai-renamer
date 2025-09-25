const fs = require('fs').promises
const path = require('path')

const processFile = require('./processFile')
const chooseModel = require('./chooseModel')
const processDirectory = require('./processDirectory')
const {
  humanizeFolderName,
  normalizeSubjectKey,
  sanitizeSubjectFolderName
} = require('./subjectUtils')

module.exports = async ({
  inputPath,
  defaultCase,
  defaultModel,
  defaultChars,
  defaultFrames,
  defaultApiKey,
  defaultBaseURL,
  defaultLanguage,
  defaultProvider,
  defaultCustomPrompt,
  defaultIncludeSubdirectories,
  defaultConvertBinary,
  defaultVerbose,
  defaultForceChange,
  defaultLogPath,

  defaultLog,
  defaultUseFilenameHint,
  defaultMetadataHints,
  defaultAppendTags,
  defaultPitchDeckOnly,
  defaultCompanyFocus,
  defaultPeopleFocus,
  defaultProjectFocus,
  defaultAcceptOnEnter,
  defaultDryRun,
  defaultSummary,
  defaultMaxFileSizeMB,
  defaultOnlyExtensions,
  defaultIgnoreExtensions,
  defaultOrganizeBySubject,
  defaultSubjectDestination,
  defaultMoveUnknownSubjects,
  runtimeFocusOverrides

}) => {
  let companyFocus = false
  let peopleFocus = false
  let projectFocus = false

  try {
    const provider = defaultProvider || 'ollama'
    console.log(`⚪ Provider: ${provider}`)

    const apiKey = defaultApiKey
    if (apiKey) {
      console.log('⚪ API key: **********')
    }

    let baseURL = defaultBaseURL
    if (provider === 'ollama' && !baseURL) {
      baseURL = 'http://127.0.0.1:11434'
    } else if (provider === 'lm-studio' && !baseURL) {
      baseURL = 'http://127.0.0.1:1234'
    } else if (provider === 'openai' && !baseURL) {
      baseURL = 'https://api.openai.com'
    }
    console.log(`⚪ Base URL: ${baseURL}`)

    const model = defaultModel || await chooseModel({ baseURL, provider })
    console.log(`⚪ Model: ${model}`)

    const frames = defaultFrames || 3
    console.log(`⚪ Frames: ${frames}`)

    const _case = defaultCase || 'kebabCase'
    console.log(`⚪ Case: ${_case}`)

    const chars = defaultChars || 20
    console.log(`⚪ Chars: ${chars}`)

    const language = defaultLanguage || 'English'
    console.log(`⚪ Language: ${language}`)

    const interpretBoolean = (value, fallback = false) => {
      if (value === undefined) return fallback
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') {
        const lowered = value.toLowerCase()
        if (lowered === 'true') return true
        if (lowered === 'false') return false
      }

      return fallback
    }

    const includeSubdirectories = interpretBoolean(defaultIncludeSubdirectories, false)
    console.log(`⚪ Include subdirectories: ${includeSubdirectories}`)

    const customPrompt = defaultCustomPrompt || null
    if (customPrompt) {
      console.log(`⚪ Custom Prompt: ${customPrompt}`)
    }


    const convertBinary = interpretBoolean(defaultConvertBinary, false)
    console.log(`⚪ Convert legacy Office binaries: ${convertBinary}`)

    const verbose = interpretBoolean(defaultVerbose, false)
    console.log(`⚪ Verbose logging: ${verbose}`)

    const forceChange = interpretBoolean(defaultForceChange, false)
    console.log(`⚪ Skip confirmation prompts: ${forceChange}`)


    const acceptOnEnter = interpretBoolean(defaultAcceptOnEnter, false)
    console.log(`⚪ Accept on Enter: ${acceptOnEnter}`)

    const dryRun = interpretBoolean(defaultDryRun, false)
    console.log(`⚪ Dry run mode: ${dryRun}`)

    const summaryEnabled = interpretBoolean(defaultSummary, false)
    console.log(`⚪ Summary report: ${summaryEnabled}`)

    const maxFileSizeMB = typeof defaultMaxFileSizeMB === 'number' && defaultMaxFileSizeMB > 0
      ? defaultMaxFileSizeMB
      : null
    console.log(`⚪ Max file size: ${maxFileSizeMB ? `${maxFileSizeMB} MB` : 'unlimited'}`)

    const normalizeExtensionSet = (value) => {
      const source = value instanceof Set
        ? Array.from(value)
        : Array.isArray(value)
          ? value
          : typeof value === 'string'
            ? value.split(',')
            : []
      return new Set(source
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter(Boolean)
        .map((item) => (item.startsWith('.') ? item : `.${item}`)))
    }

    const allowedExtensions = normalizeExtensionSet(defaultOnlyExtensions)
    const ignoredExtensions = normalizeExtensionSet(defaultIgnoreExtensions)

    console.log(`⚪ Allowed extensions filter: ${allowedExtensions.size > 0 ? Array.from(allowedExtensions).join(', ') : 'all'}`)
    console.log(`⚪ Ignored extensions filter: ${ignoredExtensions.size > 0 ? Array.from(ignoredExtensions).join(', ') : 'none'}`)

    const organizeBySubject = interpretBoolean(defaultOrganizeBySubject, false)
    console.log(`⚪ Organize by subject folders: ${organizeBySubject}`)

    const moveUnknownSubjects = interpretBoolean(defaultMoveUnknownSubjects, false)
    console.log(`⚪ Move low-confidence subjects to Unknown: ${moveUnknownSubjects}`)

    const logEnabled = defaultLog !== undefined ? interpretBoolean(defaultLog, true) : true
    console.log(`⚪ Write run log: ${logEnabled}`)

    const useFilenameHint = interpretBoolean(defaultUseFilenameHint, true)
    console.log(`⚪ Use filename hint: ${useFilenameHint}`)

    const metadataHints = interpretBoolean(defaultMetadataHints, true)
    console.log(`⚪ Use metadata hints: ${metadataHints}`)

    const appendTags = interpretBoolean(defaultAppendTags, false)
    console.log(`⚪ Append Finder tags: ${appendTags}`)

    const pitchDeckOnly = interpretBoolean(defaultPitchDeckOnly, false)
    console.log(`⚪ Startup pitch deck mode: ${pitchDeckOnly}`)

    const focusPriority = ['company', 'project', 'people']
    const focusSelections = []
    const registerFocus = ({ key, runtimeValue, defaultValue }) => {
      const source = runtimeValue !== undefined ? 'cli' : 'config'
      const value = runtimeValue !== undefined
        ? interpretBoolean(runtimeValue, false)
        : interpretBoolean(defaultValue, false)
      if (value) {
        focusSelections.push({ type: key, source })
      }
    }

    const overrides = runtimeFocusOverrides || {}

    registerFocus({ key: 'company', runtimeValue: overrides.company, defaultValue: defaultCompanyFocus })
    registerFocus({ key: 'people', runtimeValue: overrides.people, defaultValue: defaultPeopleFocus })
    registerFocus({ key: 'project', runtimeValue: overrides.project, defaultValue: defaultProjectFocus })

    const focusFlags = focusSelections.map(selection => selection.type)
    companyFocus = focusSelections.some(selection => selection.type === 'company')
    peopleFocus = focusSelections.some(selection => selection.type === 'people')
    projectFocus = focusSelections.some(selection => selection.type === 'project')

    let promptFocus = 'balanced'
    if (focusSelections.length === 1) {
      promptFocus = focusSelections[0].type
    } else if (focusSelections.length > 1) {
      const cliSelections = focusSelections.filter(selection => selection.source === 'cli')
      const selectionPool = cliSelections.length > 0 ? cliSelections : focusSelections

      for (const candidate of focusPriority) {
        const match = selectionPool.find(selection => selection.type === candidate)
        if (match) {
          promptFocus = match.type
          break
        }
      }

      const origin = cliSelections.length > 0 ? 'preferred CLI override' : 'configured priority'
      console.log(`⚪ Multiple prompt focus flags detected (${focusFlags.join(', ')}). Using ${promptFocus} focus (${origin}).`)
    }

    if (focusSelections.length === 0) {
      console.log('⚪ Prompt focus: balanced')
    } else {
      console.log(`⚪ Prompt focus: ${promptFocus}`)
    }


    const deriveCommandLabel = () => {
      const argvSegments = process.argv.slice(1)
      for (let i = argvSegments.length - 1; i >= 0; i--) {
        const base = path.basename(argvSegments[i])
        if (base.toLowerCase().includes('ai-renamer')) {
          return 'ai-renamer'
        }
      }

      const scriptName = process.argv[1] ? path.basename(process.argv[1]) : null
      if (scriptName === 'index.js') return 'ai-renamer'
      if (scriptName) return scriptName.replace(/\.js$/i, '')

      const binary = process.argv[0] ? path.basename(process.argv[0]) : 'ai-renamer'
      return binary || 'ai-renamer'
    }

    const sanitizeForFilename = (value) => {
      return value
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'ai-renamer'
    }

    const commandLabel = sanitizeForFilename(deriveCommandLabel())
    const timestamp = new Date().toISOString().replace(/[:]/g, '-')
    const defaultLogFileName = `${commandLabel}-${timestamp}.log`

    const stats = await fs.stat(inputPath)
    const maxFileSizeBytes = maxFileSizeMB ? maxFileSizeMB * 1024 * 1024 : null

    const inputRootDirectory = stats.isDirectory()
      ? path.resolve(inputPath)
      : path.resolve(path.dirname(inputPath))

    const subjectDestinationRoot = defaultSubjectDestination
      ? path.resolve(defaultSubjectDestination)
      : inputRootDirectory

    let subjectOrganization = null

    if (organizeBySubject) {
      try {
        await fs.mkdir(subjectDestinationRoot, { recursive: true })
      } catch (dirErr) {
        console.log(`⚠️ Unable to prepare subject destination (${subjectDestinationRoot}): ${dirErr.message}`)
      }

      const subjectFolderMap = new Map()
      const subjectFolderNameSet = new Set()
      const subjectHintSet = new Set()

      try {
        const entries = await fs.readdir(subjectDestinationRoot, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const folderName = entry.name
          const normalized = normalizeSubjectKey(folderName)
          const absolutePath = path.join(subjectDestinationRoot, folderName)
          if (normalized) {
            subjectFolderMap.set(normalized, { folderName, absolutePath })
          }
          subjectFolderNameSet.add(folderName.toLowerCase())
          const humanized = humanizeFolderName(folderName)
          if (humanized) {
            subjectHintSet.add(humanized)
          }
        }
      } catch (scanErr) {
        console.log(`⚠️ Unable to scan existing subject folders: ${scanErr.message}`)
      }

      const unknownFolderName = sanitizeSubjectFolderName('Unknown', 'Unknown')
      const unknownKey = normalizeSubjectKey(unknownFolderName)
      subjectFolderNameSet.add(unknownFolderName.toLowerCase())
      if (unknownKey && !subjectFolderMap.has(unknownKey)) {
        subjectFolderMap.set(unknownKey, {
          folderName: unknownFolderName,
          absolutePath: path.join(subjectDestinationRoot, unknownFolderName)
        })
      }

      subjectOrganization = {
        enabled: true,
        destinationRoot: subjectDestinationRoot,
        folderMap: subjectFolderMap,
        folderNameSet: subjectFolderNameSet,
        hintSet: subjectHintSet,
        moveLowConfidence: moveUnknownSubjects,
        unknownFolderName
      }

      console.log(`⚪ Subject destination: ${subjectDestinationRoot}`)
      if (subjectHintSet.size > 0) {
        const hintPreview = Array.from(subjectHintSet).slice(0, 8)
        const suffix = subjectHintSet.size > hintPreview.length ? '…' : ''
        console.log(`⚪ Existing subject folders detected: ${hintPreview.join(', ')}${suffix}`)
      }
    } else if (defaultSubjectDestination) {
      console.log(`⚪ Subject destination (unused): ${subjectDestinationRoot}`)
    }

    const resolvedLogPath = logEnabled
      ? (defaultLogPath
        ? path.resolve(defaultLogPath)
        : path.join(subjectDestinationRoot, defaultLogFileName))
      : null

    if (logEnabled) {
      console.log(`⚪ Log file: ${resolvedLogPath}`)
    }


    console.log('--------------------------------------------------')

    const runStats = {
      processed: 0,
      renamed: 0,
      skipped: 0,
      dryRun: 0,
      errors: 0
    }

    const skipReasonCounts = new Map()
    const dryRunPreviews = []

    const incrementSkipReason = (reason) => {
      if (!reason) return
      const current = skipReasonCounts.get(reason) || 0
      skipReasonCounts.set(reason, current + 1)
    }

    const trackResult = ({ type, reason, preview }) => {
      if (type === 'processed') {
        runStats.processed += 1
        return
      }

      if (type === 'renamed') {
        runStats.renamed += 1
        return
      }

      if (type === 'dry-run') {
        runStats.dryRun += 1
        if (preview && dryRunPreviews.length < 5) {
          dryRunPreviews.push(preview)
        }
        return
      }

      if (type === 'skipped') {
        runStats.skipped += 1
        incrementSkipReason(reason)
        return
      }

      if (type === 'error') {
        runStats.errors += 1
        incrementSkipReason(reason)
      }
    }

    const options = {
      model,
      _case,
      chars,
      frames,
      apiKey,
      baseURL,
      language,
      provider,
      inputPath,
      inputRootDirectory,
      includeSubdirectories,
      customPrompt,
      convertBinary,
      verbose,
      forceChange,
      logEnabled,
      resolvedLogPath,
      useFilenameHint,
      metadataHints,
      appendTags,
      pitchDeckOnly,
      promptFocus,
      acceptOnEnter,
      companyFocus,
      peopleFocus,
      projectFocus,
      dryRun,
      maxFileSizeBytes,
      allowedExtensions,
      ignoredExtensions,
      trackResult,
      subjectOrganization

    }

    const logEntries = []

    const recordLogEntry = entry => {
      if (!logEnabled) return
      logEntries.push(entry)
    }

    if (stats.isDirectory()) {
      await processDirectory({ options: { ...options, recordLogEntry }, inputPath })
    } else if (stats.isFile()) {
      await processFile({ ...options, recordLogEntry, filePath: inputPath })
    }

    if (logEnabled) {
      try {
        await fs.mkdir(path.dirname(resolvedLogPath), { recursive: true })

        const recoveryCommands = logEntries
          .filter(entry => entry && entry.revertCommand)
          .map(entry => entry.revertCommand)
        const recoveryCommandsRelative = logEntries
          .filter(entry => entry && entry.revertCommandRelative)
          .map(entry => entry.revertCommandRelative)


        const logPayload = {
          generatedAt: new Date().toISOString(),
          command: process.argv,
          inputPath,
          settings: {
            provider,
            baseURL,
            model,
            frames,
            case: _case,
            chars,
            language,
            includeSubdirectories,
            customPrompt,
            convertBinary,
            verbose,
            forceChange,
            acceptOnEnter,
            useFilenameHint,
            metadataHints,
            appendTags,
            pitchDeckOnly,
            promptFocus,
            companyFocus,
            peopleFocus,
            projectFocus,
            dryRun,
            summary: summaryEnabled,
            organizeBySubject,
            subjectDestination: organizeBySubject ? subjectDestinationRoot : null,
            moveLowConfidenceSubjects: subjectOrganization ? subjectOrganization.moveLowConfidence : moveUnknownSubjects,
            maxFileSizeMB,
            allowedExtensions: Array.from(allowedExtensions),
            ignoredExtensions: Array.from(ignoredExtensions)
          },
          renames: logEntries,
          recovery: {
            commands: recoveryCommands,
            relativeCommands: recoveryCommandsRelative
          }
        }

        if (recoveryCommands.length > 0) {
          logPayload.recovery.script = [
            '#!/bin/sh',
            'set -e',
            ...recoveryCommands
          ].join('\n')

        }

        await fs.writeFile(resolvedLogPath, JSON.stringify(logPayload, null, 2))
        console.log(`📝 Run log saved to ${resolvedLogPath}`)
      } catch (err) {
        console.log(`🔴 Failed to write log: ${err.message}`)
      }
    }

    if (summaryEnabled) {
      console.log('--------------------------------------------------')
      console.log('📊 Run summary')
      console.log(`   Processed: ${runStats.processed}`)
      console.log(`   Renamed: ${runStats.renamed}`)
      console.log(`   Dry-run approvals: ${runStats.dryRun}`)
      console.log(`   Skipped: ${runStats.skipped}`)
      console.log(`   Errors: ${runStats.errors}`)

      if (skipReasonCounts.size > 0) {
        console.log('   Skip reasons:')
        const sortedReasons = Array.from(skipReasonCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
        for (const [reason, count] of sortedReasons) {
          console.log(`     • ${reason}: ${count}`)
        }
      }

      if (dryRunPreviews.length > 0) {
        console.log('   Sample dry-run previews:')
        for (const preview of dryRunPreviews) {
          console.log(`     • ${preview}`)
        }
      }
    }
  } catch (err) {
    console.log(err.message)
  }
}
