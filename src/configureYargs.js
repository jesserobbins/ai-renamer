const os = require('os')
const path = require('path')
const yargs = require('yargs')
const fs = require('fs').promises
const { hideBin } = require('yargs/helpers')

const CONFIG_FILE = path.join(os.homedir(), 'ai-renamer.json')

const normalizeBoolean = (value, fallback = undefined) => {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }

  return fallback
}

const loadConfig = async () => {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(data)

    return {
      ...parsed,
      defaultConvertBinary: normalizeBoolean(parsed.defaultConvertBinary, false),
      defaultVerbose: normalizeBoolean(parsed.defaultVerbose, false),
      defaultForceChange: normalizeBoolean(parsed.defaultForceChange, false),
      defaultLog: normalizeBoolean(parsed.defaultLog),
      defaultIncludeSubdirectories: normalizeBoolean(parsed.defaultIncludeSubdirectories, false),
      defaultUseFilenameHint: normalizeBoolean(parsed.defaultUseFilenameHint, true),
      defaultMetadataHints: normalizeBoolean(parsed.defaultMetadataHints, true),
      defaultAppendTags: normalizeBoolean(parsed.defaultAppendTags, false),
      defaultCompanyFocus: normalizeBoolean(parsed.defaultCompanyFocus, false),
      defaultPeopleFocus: normalizeBoolean(parsed.defaultPeopleFocus, false),
      defaultProjectFocus: normalizeBoolean(parsed.defaultProjectFocus, false)
    }
  } catch (err) {
    return {}
  }
}

const saveConfig = async ({ config }) => {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2))
}

module.exports = async () => {
  const config = await loadConfig()

  const argv = yargs(hideBin(process.argv))
    .option('help', {
      alias: 'h',
      type: 'boolean',
      description: 'Show help'
    })
    .option('provider', {
      alias: 'p',
      type: 'string',
      description: 'Set the provider (e.g. ollama, openai, lm-studio)'
    })
    .option('api-key', {
      alias: 'a',
      type: 'string',
      description: 'Set the API key if you\'re using openai as provider'
    })
    .option('base-url', {
      alias: 'u',
      type: 'string',
      description: 'Set the API base URL (e.g. http://127.0.0.1:11434 for ollama)'
    })
    .option('model', {
      alias: 'm',
      type: 'string',
      description: 'Set the model to use (e.g. gemma2, llama3, gpt-4o)'
    })
    .option('frames', {
      alias: 'f',
      type: 'number',
      description: 'Set the maximum number of frames to extract from videos (e.g. 3, 5, 10)'
    })
    .option('case', {
      alias: 'c',
      type: 'string',
      description: 'Set the case style (e.g. camelCase, pascalCase, snakeCase, kebabCase)'
    })
    .option('chars', {
      alias: 'x',
      type: 'number',
      description: 'Set the maximum number of characters in the new filename (e.g. 25)'
    })
    .option('language', {
      alias: 'l',
      type: 'string',
      description: 'Set the output language (e.g. English, Turkish)'
    })
    .option('include-subdirectories', {
      alias: 's',
      type: 'boolean',
      description: 'Include files in subdirectories when processing',
      default: config.defaultIncludeSubdirectories || false
    })
    .option('custom-prompt', {
      alias: 'r',
      type: 'string',
      description: 'Add a custom prompt to the LLM (e.g. "Only describe the background")'
    })
    .option('convertbinary', {
      alias: 'convert-binary',
      type: 'boolean',
      description: 'Convert legacy binary Microsoft Office documents before parsing',
      default: config.defaultConvertBinary || false
    })
    .option('verbose', {
      alias: 'V',
      type: 'boolean',
      description: 'Enable verbose logging',
      default: config.defaultVerbose || false
    })
    .option('force-change', {
      alias: 'F',
      type: 'boolean',
      description: 'Apply suggested filenames without prompting for confirmation',
      default: config.defaultForceChange || false
    })
    .option('log-path', {
      type: 'string',
      description: 'Path to write the run log (defaults to command name plus timestamp)',
      default: config.defaultLogPath
    })
    .option('log', {
      type: 'boolean',
      description: 'Write a run log detailing all accepted renames',
      default: config.defaultLog !== undefined ? config.defaultLog : true
    })
    .option('use-filename-hint', {
      type: 'boolean',
      description: 'Include the current filename in the prompt for additional context',
      default: config.defaultUseFilenameHint !== undefined ? config.defaultUseFilenameHint : true
    })
    .option('metadata-hints', {
      type: 'boolean',
      description: 'Provide file metadata (dates, size) to the model when available',
      default: config.defaultMetadataHints !== undefined ? config.defaultMetadataHints : true
    })
    .option('append-tags', {
      type: 'boolean',
      description: 'Append macOS Finder tags to the generated filename before the date segment',
      default: config.defaultAppendTags || false
    })
    .option('company-focus', {
      type: 'boolean',
      description: 'Bias the prompt to identify the company or organization first when building filenames',
      default: config.defaultCompanyFocus || false
    })
    .option('people-focus', {
      type: 'boolean',
      description: 'Bias the prompt to identify people, teams, or committees first when building filenames',
      default: config.defaultPeopleFocus || false
    })
    .option('project-focus', {
      type: 'boolean',
      description: 'Bias the prompt to identify projects or initiatives first when building filenames',
      default: config.defaultProjectFocus || false
    }).argv

  if (argv.help) {
    yargs.showHelp()
    process.exit(0)
  }

  if (argv.provider) {
    config.defaultProvider = argv.provider
    await saveConfig({ config })
  }

  if (argv['api-key']) {
    config.defaultApiKey = argv['api-key']
    await saveConfig({ config })
  }

  if (argv['base-url']) {
    config.defaultBaseURL = argv['base-url']
    await saveConfig({ config })
  }

  if (argv.model) {
    config.defaultModel = argv.model
    await saveConfig({ config })
  }

  if (argv.frames) {
    config.defaultFrames = argv.frames
    await saveConfig({ config })
  }

  if (argv.case) {
    config.defaultCase = argv.case
    await saveConfig({ config })
  }

  if (argv.chars) {
    config.defaultChars = argv.chars
    await saveConfig({ config })
  }

  if (argv.language) {
    config.defaultLanguage = argv.language
    await saveConfig({ config })
  }

  const includeSubdirectoriesProvided = process.argv.some((arg) => {
    return arg === '--include-subdirectories' || arg === '--no-include-subdirectories' || arg === '-s' || arg.startsWith('--include-subdirectories=') || arg.startsWith('--no-include-subdirectories=')
  })

  if (includeSubdirectoriesProvided) {
    config.defaultIncludeSubdirectories = argv['include-subdirectories']
    await saveConfig({ config })
  }

  if (argv['custom-prompt']) {
    config.defaultCustomPrompt = argv['custom-prompt']
    await saveConfig({ config })
  }

  if (process.argv.includes('--convertbinary') || process.argv.includes('--convert-binary') || process.argv.includes('--no-convertbinary') || process.argv.includes('--no-convert-binary')) {
    config.defaultConvertBinary = argv.convertbinary
    await saveConfig({ config })
  }

  const verboseProvided = process.argv.some((arg) => {
    return arg === '--verbose' || arg === '--no-verbose' || arg === '-V' || arg.startsWith('--verbose=') || arg.startsWith('--no-verbose=')
  })

  if (verboseProvided) {
    config.defaultVerbose = argv.verbose
    await saveConfig({ config })
  }

  const forceProvided = process.argv.some((arg) => {
    return arg === '--force-change' || arg === '--no-force-change' || arg === '-F' || arg.startsWith('--force-change=') || arg.startsWith('--no-force-change=')
  })

  if (forceProvided) {
    config.defaultForceChange = argv['force-change']
    await saveConfig({ config })
  }

  if (argv['log-path']) {
    config.defaultLogPath = argv['log-path']
    await saveConfig({ config })
  }

  const logProvided = process.argv.some((arg) => {
    return arg === '--log' || arg === '--no-log' || arg.startsWith('--log=') || arg.startsWith('--no-log=')
  })

  if (logProvided) {
    config.defaultLog = argv.log
    await saveConfig({ config })
  }

  const filenameHintProvided = process.argv.some((arg) => {
    return arg === '--use-filename-hint' ||
      arg === '--no-use-filename-hint' ||
      arg.startsWith('--use-filename-hint=') ||
      arg.startsWith('--no-use-filename-hint=')
  })

  if (filenameHintProvided) {
    config.defaultUseFilenameHint = argv['use-filename-hint']
    await saveConfig({ config })
  }

  const metadataHintsProvided = process.argv.some((arg) => {
    return arg === '--metadata-hints' ||
      arg === '--no-metadata-hints' ||
      arg.startsWith('--metadata-hints=') ||
      arg.startsWith('--no-metadata-hints=')
  })

  if (metadataHintsProvided) {
    config.defaultMetadataHints = argv['metadata-hints']
    await saveConfig({ config })
  }

  const appendTagsProvided = process.argv.some((arg) => {
    return arg === '--append-tags' || arg === '--no-append-tags' || arg.startsWith('--append-tags=') || arg.startsWith('--no-append-tags=')
  })

  if (appendTagsProvided) {
    config.defaultAppendTags = argv['append-tags']
    await saveConfig({ config })
  }

  const companyFocusProvided = process.argv.some((arg) => {
    return arg === '--company-focus' || arg === '--no-company-focus' || arg.startsWith('--company-focus=') || arg.startsWith('--no-company-focus=')
  })

  if (companyFocusProvided) {
    config.defaultCompanyFocus = argv['company-focus']
    await saveConfig({ config })
  }

  const peopleFocusProvided = process.argv.some((arg) => {
    return arg === '--people-focus' || arg === '--no-people-focus' || arg.startsWith('--people-focus=') || arg.startsWith('--no-people-focus=')
  })

  if (peopleFocusProvided) {
    config.defaultPeopleFocus = argv['people-focus']
    await saveConfig({ config })
  }

  const projectFocusProvided = process.argv.some((arg) => {
    return arg === '--project-focus' || arg === '--no-project-focus' || arg.startsWith('--project-focus=') || arg.startsWith('--no-project-focus=')
  })

  if (projectFocusProvided) {
    config.defaultProjectFocus = argv['project-focus']
    await saveConfig({ config })
  }

  return { argv, config }
}
