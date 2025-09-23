const fs = require('fs').promises
const path = require('path')

const processFile = require('./processFile')
const chooseModel = require('./chooseModel')
const processDirectory = require('./processDirectory')

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
  defaultCompanyFocus,
  defaultPeopleFocus,
  defaultProjectFocus
}) => {
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

    const logEnabled = defaultLog !== undefined ? interpretBoolean(defaultLog, true) : true
    console.log(`⚪ Write run log: ${logEnabled}`)

    const useFilenameHint = interpretBoolean(defaultUseFilenameHint, true)
    console.log(`⚪ Use filename hint: ${useFilenameHint}`)

    const metadataHints = interpretBoolean(defaultMetadataHints, true)
    console.log(`⚪ Use metadata hints: ${metadataHints}`)

    const appendTags = interpretBoolean(defaultAppendTags, false)
    console.log(`⚪ Append Finder tags: ${appendTags}`)

    const companyFocus = interpretBoolean(defaultCompanyFocus, false)
    const peopleFocus = interpretBoolean(defaultPeopleFocus, false)
    const projectFocus = interpretBoolean(defaultProjectFocus, false)

    const focusFlags = []
    if (companyFocus) focusFlags.push('company')
    if (peopleFocus) focusFlags.push('people')
    if (projectFocus) focusFlags.push('project')

    const focusPriority = ['project', 'company', 'people']
    let promptFocus = 'balanced'
    if (focusFlags.length === 1) {
      promptFocus = focusFlags[0]
    } else if (focusFlags.length > 1) {
      for (const candidate of focusPriority) {
        if (focusFlags.includes(candidate)) {
          promptFocus = candidate
          break
        }
      }
      console.log(`⚪ Multiple prompt focus flags detected (${focusFlags.join(', ')}). Using ${promptFocus} focus.`)
    }

    if (focusFlags.length === 0) {
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

    const resolvedLogPath = logEnabled
      ? path.resolve(defaultLogPath || defaultLogFileName)
      : null

    if (logEnabled) {
      console.log(`⚪ Log file: ${resolvedLogPath}`)
    }

    console.log('--------------------------------------------------')

    const stats = await fs.stat(inputPath)
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
      promptFocus,
      companyFocus,
      peopleFocus,
      projectFocus
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
            useFilenameHint,
            metadataHints,
            appendTags,
            promptFocus,
            companyFocus,
            peopleFocus,
            projectFocus
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
  } catch (err) {
    console.log(err.message)
  }
}
