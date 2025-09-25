const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')

const defaultOptions = {
  provider: 'ollama',
  model: '',
  apiKey: '',
  baseUrl: '',
  frames: 3,
  case: 'kebabCase',
  chars: 80,
  language: 'English',
  includeSubdirectories: false,
  customPrompt: '',
  instructionsFile: '',
  subjectStopwords: '',
  dryRun: false,
  summary: false,
  maxFileSize: 0,
  onlyExtensions: '',
  ignoreExtensions: '',
  organizeBySubject: false,
  subjectDestination: '',
  moveUnknownSubjects: false
}

const CLI_OPTIONS = {
  provider: {
    alias: 'p',
    describe: 'Set the model provider (ollama, lm-studio, openai)',
    type: 'string'
  },
  apiKey: {
    alias: 'a',
    describe: 'API key for OpenAI-compatible providers',
    type: 'string'
  },
  baseUrl: {
    alias: 'u',
    describe: 'Base URL for the provider endpoint',
    type: 'string'
  },
  model: {
    alias: 'm',
    describe: 'Model identifier to use',
    type: 'string'
  },
  frames: {
    alias: 'f',
    describe: 'Maximum number of frames to extract from videos',
    type: 'number'
  },
  case: {
    alias: 'c',
    describe: 'Case style for generated filenames',
    type: 'string'
  },
  chars: {
    alias: 'x',
    describe: 'Maximum characters allowed in the filename',
    type: 'number'
  },
  language: {
    alias: 'l',
    describe: 'Language to prefer for output filenames',
    type: 'string'
  },
  includeSubdirectories: {
    alias: 's',
    describe: 'Include subdirectories when scanning',
    type: 'boolean'
  },
  customPrompt: {
    alias: 'r',
    describe: 'Custom instructions appended to the model prompt',
    type: 'string'
  },
  instructionsFile: {
    describe: 'Path to a file containing additional system instructions',
    type: 'string'
  },
  subjectStopwords: {
    describe: 'Comma-separated tokens to strip from detected subject names',
    type: 'string'
  },
  dryRun: {
    describe: 'Preview renames without writing to disk',
    type: 'boolean'
  },
  summary: {
    describe: 'Print a summary report after processing',
    type: 'boolean'
  },
  maxFileSize: {
    describe: 'Skip files larger than the provided size in MB',
    type: 'number'
  },
  onlyExtensions: {
    describe: 'Process only files with these comma-separated extensions',
    type: 'string'
  },
  ignoreExtensions: {
    describe: 'Skip files with these comma-separated extensions',
    type: 'string'
  },
  organizeBySubject: {
    describe: 'Move files into subject folders inferred by the model',
    type: 'boolean'
  },
  subjectDestination: {
    describe: 'Destination directory for organized subjects',
    type: 'string'
  },
  moveUnknownSubjects: {
    describe: 'Move low-confidence subjects into an Unknown folder',
    type: 'boolean'
  }
}

function createCli (config = {}) {
  const parser = yargs(hideBin(process.argv))
    .usage('Usage: $0 <path> [options]')
    .positional('path', {
      describe: 'File or directory to process',
      type: 'string'
    })
    .example('$0 ~/Downloads/Pitches --dry-run --summary', 'Preview renames and print a summary report')
    .wrap(null)

  const defaults = { ...defaultOptions, ...config }

  Object.entries(CLI_OPTIONS).forEach(([name, option]) => {
    parser.option(name, {
      ...option,
      default: defaults[name]
    })
  })

  return parser
}

module.exports = {
  createCli,
  defaultOptions
}
