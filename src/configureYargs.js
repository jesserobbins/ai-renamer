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

const normalizeStringArray = (value) => {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : String(item || '')))
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(segment => segment.trim())
      .filter(Boolean)
  }
  return []
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
      defaultPitchDeckOnly: normalizeBoolean(parsed.defaultPitchDeckOnly, false),
      defaultCompanyFocus: normalizeBoolean(parsed.defaultCompanyFocus, false),
      defaultPeopleFocus: normalizeBoolean(parsed.defaultPeopleFocus, false),
      defaultProjectFocus: normalizeBoolean(parsed.defaultProjectFocus, false),
      defaultAcceptOnEnter: normalizeBoolean(parsed.defaultAcceptOnEnter, false),
      defaultDryRun: normalizeBoolean(parsed.defaultDryRun, false),
      defaultSummary: normalizeBoolean(parsed.defaultSummary, false),
      defaultOrganizeBySubject: normalizeBoolean(parsed.defaultOrganizeBySubject, false),
      defaultMoveUnknownSubjects: normalizeBoolean(parsed.defaultMoveUnknownSubjects, false),
      defaultMaxFileSizeMB: typeof parsed.defaultMaxFileSizeMB === 'number' && !Number.isNaN(parsed.defaultMaxFileSizeMB)
        ? parsed.defaultMaxFileSizeMB
        : undefined,
      defaultOnlyExtensions: normalizeStringArray(parsed.defaultOnlyExtensions),
      defaultIgnoreExtensions: normalizeStringArray(parsed.defaultIgnoreExtensions),
      defaultSubjectDestination: typeof parsed.defaultSubjectDestination === 'string'
        ? parsed.defaultSubjectDestination
        : undefined

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
    .option('pitch-deck-only', {
      type: 'boolean',
      description: 'Only rename PDFs detected as startup pitch decks using the dedicated filename template',
      default: config.defaultPitchDeckOnly || false
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
    })
    .option('accept-default', {
      type: 'boolean',
      description: 'Treat an empty confirmation response as acceptance instead of rejection',
      default: config.defaultAcceptOnEnter || false
    })
    .option('dry-run', {
      type: 'boolean',
      description: 'Preview suggested names without touching the filesystem',
      default: config.defaultDryRun || false
    })
    .option('summary', {
      type: 'boolean',
      description: 'Print a run summary with rename/skip counts after completion',
      default: config.defaultSummary || false
    })
    .option('organize-by-subject', {
      type: 'boolean',
      description: 'Move renamed files into folders grouped by their inferred subject (company, project, or person)',
      default: config.defaultOrganizeBySubject || false
    })
    .option('subject-destination', {
      type: 'string',
      description: 'Directory where subject folders (and the run log by default) should be created',
      default: config.defaultSubjectDestination
    })
    .option('move-unknown-subjects', {
      type: 'boolean',
      description: 'Send low-confidence subject matches into an Unknown folder instead of leaving them in place',
      default: config.defaultMoveUnknownSubjects || false
    })
    .option('max-file-size', {
      type: 'number',
      description: 'Skip files larger than the provided size in megabytes',
      default: config.defaultMaxFileSizeMB
    })
    .option('only-extensions', {
      type: 'string',
      description: 'Only process files whose extensions are in the comma-separated list (e.g. pdf,docx)',
      default: config.defaultOnlyExtensions && config.defaultOnlyExtensions.length > 0
        ? config.defaultOnlyExtensions.join(',')
        : undefined
    })
    .option('ignore-extensions', {
      type: 'string',
      description: 'Skip files whose extensions are in the comma-separated list (e.g. jpg,png)',
      default: config.defaultIgnoreExtensions && config.defaultIgnoreExtensions.length > 0
        ? config.defaultIgnoreExtensions.join(',')
        : undefined
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

  const pitchDeckProvided = process.argv.some((arg) => {
    return arg === '--pitch-deck-only' || arg === '--no-pitch-deck-only' ||
      arg.startsWith('--pitch-deck-only=') || arg.startsWith('--no-pitch-deck-only=')
  })

  if (pitchDeckProvided) {
    config.defaultPitchDeckOnly = argv['pitch-deck-only']
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

  const acceptDefaultProvided = process.argv.some((arg) => {
    return arg === '--accept-default' || arg === '--no-accept-default' || arg.startsWith('--accept-default=') || arg.startsWith('--no-accept-default=')
  })

  if (acceptDefaultProvided) {
    config.defaultAcceptOnEnter = argv['accept-default']
    await saveConfig({ config })
  }

  const dryRunProvided = process.argv.some((arg) => {
    return arg === '--dry-run' || arg === '--no-dry-run' || arg.startsWith('--dry-run=') || arg.startsWith('--no-dry-run=')
  })

  if (dryRunProvided) {
    config.defaultDryRun = argv['dry-run']
    await saveConfig({ config })
  }

  const summaryProvided = process.argv.some((arg) => {
    return arg === '--summary' || arg === '--no-summary' || arg.startsWith('--summary=') || arg.startsWith('--no-summary=')
  })

  if (summaryProvided) {
    config.defaultSummary = argv.summary
    await saveConfig({ config })
  }

  const organizeSubjectsProvided = process.argv.some((arg) => {
    return arg === '--organize-by-subject' || arg === '--no-organize-by-subject' ||
      arg.startsWith('--organize-by-subject=') || arg.startsWith('--no-organize-by-subject=')
  })

  if (organizeSubjectsProvided) {
    config.defaultOrganizeBySubject = argv['organize-by-subject']
    await saveConfig({ config })
  }

  if (argv['subject-destination'] !== undefined) {
    if (argv['subject-destination']) {
      config.defaultSubjectDestination = argv['subject-destination']
    } else {
      delete config.defaultSubjectDestination
    }
    await saveConfig({ config })
  }

  const moveUnknownProvided = process.argv.some((arg) => {
    return arg === '--move-unknown-subjects' || arg === '--no-move-unknown-subjects' ||
      arg.startsWith('--move-unknown-subjects=') || arg.startsWith('--no-move-unknown-subjects=')
  })

  if (moveUnknownProvided) {
    config.defaultMoveUnknownSubjects = argv['move-unknown-subjects']
    await saveConfig({ config })
  }

  if (argv['max-file-size'] !== undefined) {
    const parsedSize = Number(argv['max-file-size'])
    if (!Number.isNaN(parsedSize) && parsedSize > 0) {
      config.defaultMaxFileSizeMB = parsedSize
    } else {
      delete config.defaultMaxFileSizeMB
    }
    await saveConfig({ config })
  }

  if (argv['only-extensions'] !== undefined) {
    config.defaultOnlyExtensions = normalizeStringArray(argv['only-extensions'])
    await saveConfig({ config })
  }

  if (argv['ignore-extensions'] !== undefined) {
    config.defaultIgnoreExtensions = normalizeStringArray(argv['ignore-extensions'])
    await saveConfig({ config })
  }

  config.runtimeFocusOverrides = {
    company: companyFocusProvided ? argv['company-focus'] : undefined,
    people: peopleFocusProvided ? argv['people-focus'] : undefined,
    project: projectFocusProvided ? argv['project-focus'] : undefined
  }

  return { argv, config }
}
